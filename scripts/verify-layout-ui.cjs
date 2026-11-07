const assert = require('node:assert/strict');
const path = require('node:path');

// Called only by the isolated verification profile. This helper changes local
// layout settings and restores them; it never invokes a device or media command.
async function verifyLayoutUI(page, directory) {
  const baseline = (await page.evaluate(() => window.edge.getState())).config;
  const viewport = page.viewportSize();
  const checks = [];
  const read = () => page.evaluate(async () => (await window.edge.getState()).config);
  const order = async () => (await read()).widgets.filter(card => card.type !== 'launchers').map(card => card.id);
  const waitCard = (id, property, value) => page.waitForFunction(async ({ id, property, value }) => {
    const card = (await window.edge.getState()).config.widgets.find(card => card.id === id);
    return card && JSON.stringify(card[property]) === JSON.stringify(value);
  }, { id, property, value });
  const settled = selector => page.waitForFunction(selector => document.querySelector(`${selector} .edge-layout-ui`)?.getAttribute('aria-busy') === 'false', selector);
  const openLayout = async () => {
    if (!(await page.locator('#settings').isVisible())) await page.locator('#customize').click();
    await page.locator('#settings').getByRole('button', { name: 'Layout', exact: true }).click();
    await settled('#settings');
  };
  const closeSettings = async () => {
    if (await page.locator('#settings').isVisible()) await page.getByRole('button', { name: 'Close settings', exact: true }).click();
  };
  const settings = page.locator('#settings-content');
  const editor = page.locator('#layout-editor');
  const fixture = structuredClone(baseline);
  fixture.layout = { ...fixture.layout, mode: 'overview' };
  fixture.widgets = ['clock', 'weather', 'tasks'].map((type, index) => ({
    id: `layout-test-${index}`, type, title: ['Time', 'Forecast', 'Chats'][index], enabled: true, size: 'medium',
    items: [{ id: `layout-view-${index}`, type }], activeItemId: `layout-view-${index}`,
  }));
  const dock = baseline.widgets.find(card => card.type === 'launchers');
  if (dock) fixture.widgets.push(structuredClone(dock));
  let cdp;
  try {
    await page.setViewportSize({ width: 1600, height: 700 });
    await page.evaluate(config => window.edge.saveConfig(config), fixture);
    await page.reload();
    await page.locator('.container-card[data-id="layout-test-0"]').waitFor();
    for (const [mode, name] of [['bento', 'Bento'], ['focus', 'Focus'], ['overview', 'Overview']]) {
      await openLayout();
      await settings.getByRole('button', { name: `${name} layout`, exact: true }).click();
      await page.waitForFunction(async mode => (await window.edge.getState()).config.layout.mode === mode, mode);
      await settled('#settings');
      assert.equal(await settings.getByRole('button', { name: `${name} layout`, exact: true }).getAttribute('aria-pressed'), 'true');
      assert.deepEqual((await read()).widgets.filter(card => card.type !== 'launchers').map(card => card.size), ['medium', 'medium', 'medium'], 'Custom card layouts keep their chosen sizes');
      await closeSettings();
      if (mode !== 'overview') await page.screenshot({ path: path.join(directory, `layout-${mode}.png`) });
    }
    checks.push('Layout mode picker saves Overview, Bento, and Focus while preserving custom card sizes');

    await openLayout();
    await settings.getByRole('button', { name: 'Add card', exact: true }).click();
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Create Time & weather', 'Gallery moves focus to its first choice');
    await page.screenshot({ path: path.join(directory, 'layout-gallery.png') });
    await settings.getByRole('button', { name: 'Close gallery', exact: true }).click();
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Add card');
    await settings.getByRole('button', { name: 'Add card', exact: true }).click();
    await settings.getByRole('button', { name: 'Create Clock', exact: true }).click();
    await editor.waitFor({ state: 'visible' });
    await settled('#layout-editor');
    const added = (await read()).widgets.find(card => card.type !== 'launchers' && !fixture.widgets.some(original => original.id === card.id));
    assert.ok(added, 'Gallery persists a new card');
    await editor.getByRole('textbox', { name: 'Card name', exact: true }).fill('Focus panel');
    await editor.getByRole('button', { name: 'Save name', exact: true }).click();
    await waitCard(added.id, 'title', 'Focus panel'); await settled('#layout-editor');
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Save name', 'Saving keeps keyboard focus');
    await editor.getByRole('combobox', { name: 'Size of Focus panel', exact: true }).selectOption('wide');
    await waitCard(added.id, 'size', 'wide'); await settled('#layout-editor');
    await editor.getByRole('button', { name: 'Add view', exact: true }).click();
    await editor.getByRole('button', { name: 'Add Weather', exact: true }).click();
    await page.waitForFunction(async id => (await window.edge.getState()).config.widgets.find(card => card.id === id)?.items.length === 2, added.id);
    await settled('#layout-editor');
    const weather = (await read()).widgets.find(card => card.id === added.id).items.find(item => item.type === 'weather');
    await editor.getByRole('button', { name: 'Make Weather the default view', exact: true }).click();
    await waitCard(added.id, 'activeItemId', weather.id); await settled('#layout-editor');
    await editor.getByRole('button', { name: 'Rename Weather view', exact: true }).click();
    await editor.getByRole('textbox', { name: 'View name for Weather', exact: true }).fill('Outlook');
    await editor.getByRole('button', { name: 'Save view name', exact: true }).click();
    await page.waitForFunction(async id => (await window.edge.getState()).config.widgets.find(card => card.id === id)?.items.some(item => item.label === 'Outlook'), added.id);
    await settled('#layout-editor');
    await editor.getByRole('button', { name: 'Remove Outlook view', exact: true }).click();
    await page.waitForFunction(async id => (await window.edge.getState()).config.widgets.find(card => card.id === id)?.items.length === 1, added.id);
    await settled('#layout-editor');
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Undo removal');
    await editor.getByRole('button', { name: 'Undo removal', exact: true }).click();
    await waitCard(added.id, 'activeItemId', weather.id); await settled('#layout-editor');
    await editor.getByRole('button', { name: 'Move Outlook view up', exact: true }).click();
    await page.waitForFunction(async ({ cardId, itemId }) => (await window.edge.getState()).config.widgets.find(card => card.id === cardId)?.items[0]?.id === itemId, { cardId: added.id, itemId: weather.id });
    await settled('#layout-editor');
    await page.screenshot({ path: path.join(directory, 'layout-editor.png') });
    await editor.getByRole('button', { name: 'Remove this card', exact: true }).click();
    await page.waitForFunction(async id => !(await window.edge.getState()).config.widgets.some(card => card.id === id), added.id);
    await settled('#layout-editor');
    await editor.getByRole('button', { name: 'Undo removal', exact: true }).click();
    await waitCard(added.id, 'activeItemId', weather.id); await settled('#layout-editor');
    await page.getByRole('button', { name: 'Close card editor', exact: true }).click();
    await closeSettings();
    const card = page.locator(`.container-card[data-id="${added.id}"]`);
    await card.getByRole('tab', { name: 'Clock & date', exact: true }).click();
    const clock = added.items[0];
    await waitCard(added.id, 'activeItemId', clock.id);
    assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'Clock & date', 'Active tab preserves focus');
    await page.keyboard.press('ArrowLeft');
    await waitCard(added.id, 'activeItemId', weather.id);
    assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'Outlook', 'Arrow navigation preserves roving focus');
    await page.reload(); await card.waitFor();
    const persisted = (await read()).widgets.find(card => card.id === added.id);
    assert.equal(persisted.title, 'Focus panel'); assert.equal(persisted.size, 'wide');
    assert.equal(persisted.items[0].label, 'Outlook'); assert.equal(persisted.activeItemId, weather.id);
    checks.push('Card creation, name, size, view order, default view, deletion/Undo, and accessible tabs persist through reload');

    await page.locator('#edit-layout').click();
    const before = await order();
    const source = page.locator(`.container-card[data-id="${before[0]}"] .card-drag-handle`);
    const point = async locator => { const box = await locator.boundingBox(); assert.ok(box); return { x: box.x + box.width / 2, y: box.y + box.height / 2 }; };
    const start = await point(source);
    const targetBox = await page.locator(`.container-card[data-id="${before[1]}"]`).boundingBox();
    assert.ok(targetBox);
    const destination = { x: targetBox.x + targetBox.width * 0.8, y: targetBox.y + targetBox.height * 0.5 };
    await source.click(); assert.deepEqual(await order(), before, 'A quick tap does not reorder');
    const begin = async () => { await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.waitForTimeout(520); await page.locator('#widgets[data-dragging="true"]').waitFor(); };
    await begin(); await page.mouse.up(); assert.deepEqual(await order(), before, 'Holding in place does not reorder');
    await begin(); await page.mouse.move(destination.x, destination.y); await page.mouse.move(start.x, start.y); await page.mouse.up();
    assert.deepEqual(await order(), before, 'Returning to the source cancels its drop target');
    const fullscreenBefore = (await page.evaluate(() => window.edge.getState())).system.fullscreen;
    await begin(); await page.mouse.move(destination.x, destination.y); await page.keyboard.press('Escape'); await page.mouse.up();
    assert.deepEqual(await order(), before, 'Escape cancels movement');
    assert.equal((await page.evaluate(() => window.edge.getState())).system.fullscreen, fullscreenBefore, 'Cancelling a drag preserves full screen');
    await begin(); await page.mouse.move(destination.x, destination.y, { steps: 6 }); await page.mouse.up();
    await page.waitForFunction(async first => (await window.edge.getState()).config.widgets.filter(card => card.type !== 'launchers')[0].id !== first, before[0]);
    const after = await order(); assert.deepEqual(after, [before[1], before[0], ...before.slice(2)]);
    assert.equal(await page.locator('dialog[open]').count(), 0, 'A completed drop does not open a card action');
    await page.waitForFunction(() => [...document.querySelectorAll('.container-card')].every(card => card.getAnimations().every(animation => animation.playState !== 'running')));
    checks.push('Mouse hold reorders cards; quick taps, holding in place, returning to source, and Escape keep order and full-screen state');

    cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    const touchSource = await point(page.locator(`.container-card[data-id="${after[0]}"] .card-drag-handle`));
    const touchBox = await page.locator(`.container-card[data-id="${after[1]}"]`).boundingBox();
    const touchTarget = { x: touchBox.x + touchBox.width * 0.8, y: touchBox.y + touchBox.height * 0.5 };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...touchSource, id: 1 }] });
    await page.waitForTimeout(520); await page.locator('#widgets[data-dragging="true"]').waitFor();
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...touchTarget, id: 1 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForFunction(async first => (await window.edge.getState()).config.widgets.filter(card => card.type !== 'launchers')[0].id !== first, after[0]);
    assert.deepEqual(await order(), before);
    assert.equal(await page.locator('dialog[open]').count(), 0, 'Touch drop suppresses the card action');
    await page.waitForFunction(() => [...document.querySelectorAll('.container-card')].every(card => card.getAnimations().every(animation => animation.playState !== 'running')));
    checks.push('A real browser touch sequence holds and reorders cards without opening their controls');

    // The normal printer-card opener is intentionally allowed to start a hold.
    // Use its exact class on an isolated overlay with a counter instead of a
    // printer handler, so accidental activation cannot send a device action.
    await page.evaluate(id => {
      window.__dragPrinterClicks = 0;
      const opener = document.createElement('button');
      opener.type = 'button'; opener.className = 'printer-open'; opener.id = 'drag-printer-open-fixture';
      opener.setAttribute('aria-label', 'Isolated printer opener');
      opener.style.cssText = 'position:absolute;inset:auto;left:20px;top:100px;width:160px;height:64px;z-index:50;';
      opener.addEventListener('click', () => { window.__dragPrinterClicks++; });
      document.querySelector(`.container-card[data-id="${id}"]`).append(opener);
    }, before[0]);
    const printerPoint = await point(page.locator('#drag-printer-open-fixture'));
    const printerTargetBox = await page.locator(`.container-card[data-id="${before[1]}"]`).boundingBox();
    assert.ok(printerTargetBox);
    const printerTarget = {x:printerTargetBox.x + printerTargetBox.width * 0.8,y:printerTargetBox.y + printerTargetBox.height * 0.5};
    const beginPrinterTouch = async () => {
      await cdp.send('Input.dispatchTouchEvent', {type:'touchStart',touchPoints:[{...printerPoint,id:1}]});
      await page.waitForTimeout(520);
      await page.locator('#widgets[data-dragging="true"]').waitFor();
      await cdp.send('Input.dispatchTouchEvent', {type:'touchMove',touchPoints:[{...printerTarget,id:1}]});
    };
    await beginPrinterTouch();
    await cdp.send('Input.dispatchTouchEvent', {type:'touchCancel',touchPoints:[]});
    await page.locator('.card-drag-preview').waitFor({state:'hidden'});
    assert.deepEqual(await order(),before,'A cancelled touch keeps the saved order');
    assert.equal(await page.evaluate(() => window.__dragPrinterClicks),0,'Touch cancellation does not click the printer opener');
    assert.equal(await page.locator('dialog[open]').count(),0);

    await beginPrinterTouch();
    await page.screenshot({path:path.join(directory,'layout-drag-preview.png')});
    await cdp.send('Input.dispatchTouchEvent', {type:'touchEnd',touchPoints:[]});
    await page.waitForFunction(async first => (await window.edge.getState()).config.widgets.filter(card => card.type !== 'launchers')[0].id !== first,before[0]);
    const reordered=[before[1],before[0],...before.slice(2)];
    assert.deepEqual(await order(),reordered);
    assert.equal(await page.evaluate(() => window.__dragPrinterClicks),0,'Dropping a held printer opener never clicks it');
    assert.equal(await page.locator('dialog[open]').count(),0);
    await page.reload();
    await page.locator(`.container-card[data-id="${reordered[0]}"]`).waitFor();
    assert.deepEqual(await order(),reordered,'The dragged order persists through reload');
    assert.equal(await page.locator('#widgets > .container-card').first().getAttribute('data-id'),reordered[0]);
    checks.push('Holding a printer opener can move its card without a click; touch cancellation preserves order, and a completed drag survives reload');
  } finally {
    if (cdp) { await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false }).catch(() => {}); await cdp.detach(); }
    await page.mouse.up().catch(() => {});
    await page.evaluate(() => { for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close(); });
    await page.evaluate(config => window.edge.saveConfig(config), baseline);
    await page.reload();
    await page.waitForFunction(() => Boolean(window.edge && document.querySelector('#widgets')));
    if (viewport) await page.setViewportSize(viewport);
  }
  return checks;
}
module.exports = { verifyLayoutUI };
