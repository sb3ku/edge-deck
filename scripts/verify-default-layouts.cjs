'use strict';
const assert=require('node:assert/strict');
const path=require('node:path');
// The Home Screen, like iOS: widgets fit their page, pages turn with a swipe,
// Edit Home Screen adds (gallery), edits (only the widget's sizes) and removes
// widgets. Uses temporary settings and restores them.
async function verifyDefaultLayouts(page,directory){
  const baseline=(await page.evaluate(()=>window.edge.getState())).config,viewport=page.viewportSize();
  const read=async()=>(await page.evaluate(()=>window.edge.getState())).config;
  const cfg=structuredClone(baseline);
  cfg.pages=[{id:'verify-home',name:'Home'},{id:'verify-second',name:'Second'}];
  const sizes={weather:'medium',clock:'small',media:'large',printers:'medium',tasks:'medium',stats:'medium',actions:'tall'};
  cfg.widgets=Object.entries(sizes).map(([type,size])=>({id:`verify-${type}`,type,title:'',enabled:true,size,page:'verify-home',items:[{id:`verify-${type}-view`,type}],activeItemId:`verify-${type}-view`}))
    .concat([{id:'verify-gauge',type:'gauge',title:'',enabled:true,size:'small',page:'verify-second',items:[{id:'verify-gauge-view',type:'gauge',metric:'cpu'}],activeItemId:'verify-gauge-view'}]);
  const dock=baseline.widgets.find(card=>card.type==='launchers');if(dock)cfg.widgets.push(structuredClone(dock));
  const checks=[];
  try{
    await page.setViewportSize({width:2560,height:720});
    await page.evaluate(config=>window.edge.saveConfig(config),cfg);await page.reload();
    await page.locator('.page-grid[data-page="verify-home"] .container-card.clock').waitFor();
    assert.equal((await read()).layout.mode,'widgets','Widgets is the only layout');
    // Every widget of the page in front fits, without overlapping or scrolling.
    const geometry=await page.locator('.page-grid[data-current="true"] > .container-card').evaluateAll(cards=>cards.map(card=>{const b=card.getBoundingClientRect();return{x:b.x,y:b.y,right:b.right,bottom:b.bottom,hidden:card.hidden};}));
    assert.equal(geometry.length,7);assert.ok(geometry.every(box=>!box.hidden),'The first page fits its seven widgets');
    for(let i=0;i<geometry.length;i++)for(let j=i+1;j<geometry.length;j++){const a=geometry[i],b=geometry[j];assert.ok(a.right<=b.x+1||b.right<=a.x+1||a.bottom<=b.y+1||b.bottom<=a.y+1,'Widgets do not overlap');}
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth||document.documentElement.scrollHeight>innerHeight),false);
    assert.equal(await page.locator('#page-tabs .page-dot').count(),2,'Two pages show two dots');
    await page.screenshot({path:path.join(directory,'home-first-page.png')});
    // Swipe left: the pages follow the pointer and settle on the second page.
    await page.mouse.move(1900,330);await page.mouse.down();
    for(let x=1880;x>=1000;x-=40)await page.mouse.move(x,334);
    assert.equal(await page.locator('#widgets[data-paging]').count(),1,'The pages follow the pointer');
    await page.mouse.up();
    await page.waitForFunction(()=>document.querySelector('.page-grid[data-page="verify-second"]')?.dataset.current==='true');
    await page.waitForFunction(()=>document.querySelector('.page-dot.is-active')?.getAttribute('aria-label')==='Second, page 2 of 2');
    assert.equal(await page.locator('dialog[open], #widget-menu').count(),0,'A swipe does not open anything');
    await page.getByRole('button',{name:'Home, page 1 of 2',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.page-grid[data-page="verify-home"]')?.dataset.current==='true');
    checks.push('Widgets is the only layout; a page of widgets fits without overlap, a swipe turns the page and the dots follow');
    // Edit Home Screen: remove badges, + and Done.
    await page.locator('#deck-menu').click();await page.locator('#edit-layout').click();
    await page.locator('.page-grid.is-jiggling').first().waitFor();
    assert.equal(await page.locator('.page-grid[data-current="true"] .widget-remove').count(),7);
    // Edit widget offers only the widget's own sizes (agent chats: Medium, Large, Tall).
    await page.getByRole('button',{name:'Edit Agent chats widget',exact:true}).click({force:true}); // widgets wiggle while editing
    const sheet=page.locator('#widget-sheet');await sheet.waitFor({state:'visible'});
    assert.deepEqual(await sheet.locator('.ws-size strong').allTextContents(),['Medium','Large','Tall']);
    await page.screenshot({path:path.join(directory,'home-edit-widget.png')});
    await sheet.getByRole('button',{name:'Done',exact:true}).click();await sheet.waitFor({state:'hidden'});
    // The gallery adds a Timer where there is room.
    await page.getByRole('button',{name:'Add widget',exact:true}).first().click();await sheet.waitFor({state:'visible'});
    await sheet.getByRole('button',{name:'Timer',exact:true}).click();
    assert.equal(await sheet.locator('.ws-copy h3').textContent(),'Timer');
    await page.screenshot({path:path.join(directory,'home-gallery.png')});
    const before=(await read()).widgets.map(card=>card.id);
    await sheet.getByRole('button',{name:'Add widget',exact:true}).click();await sheet.waitFor({state:'hidden'});
    await page.waitForFunction(count=>window.edge.getState().then(state=>state.config.widgets.length>count),before.length);
    const added=(await read()).widgets.find(card=>!before.includes(card.id));
    assert.equal(added.type,'timer');assert.equal(added.size,'small');assert.equal(added.page,'verify-home','A small widget fills the free cell of the page in front');
    // Remove it with the badge and the alert.
    await page.locator(`.container-card[data-id="${added.id}"] .widget-remove`).click({force:true});
    await page.locator('.confirm-dialog').getByRole('button',{name:'Remove',exact:true}).click();
    await page.waitForFunction(id=>window.edge.getState().then(state=>!state.config.widgets.some(card=>card.id===id)),added.id);
    await page.locator('#layout-done').click();
    assert.equal(await page.locator('.page-grid.is-jiggling').count(),0);
    checks.push('Edit Home Screen: Edit widget offers only the widget\'s sizes; the gallery adds a widget where there is room; the badge removes it after confirming');
    // The app dock still shows and hides in Apps settings.
    await page.locator('#deck-menu').click();await page.locator('#customize').click();await page.locator('#settings').getByRole('button',{name:'Apps',exact:true}).click();
    const settings=page.locator('#settings-content');
    const dockSwitch=settings.getByRole('switch',{name:'Show app dock',exact:true});
    const initiallyShown=await dockSwitch.getAttribute('aria-checked')==='true';
    await dockSwitch.click();await page.waitForFunction(shown=>document.querySelector('#launchers').style.display===(shown?'none':''),initiallyShown);
    await dockSwitch.click();await page.waitForFunction(shown=>document.querySelector('#launchers').style.display===(shown?'':'none'),initiallyShown);
    await page.getByRole('button',{name:'Close settings',exact:true}).click();
    checks.push('The app dock remains independently showable/hideable in Apps settings');
    return checks;
  }finally{await page.evaluate(()=>{for(const dialog of document.querySelectorAll('dialog[open]'))dialog.close();});await page.mouse.up().catch(()=>{});await page.evaluate(config=>window.edge.saveConfig(config),baseline);await page.reload();if(viewport)await page.setViewportSize(viewport);}
}
module.exports={verifyDefaultLayouts};
