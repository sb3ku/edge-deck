(() => {
  'use strict';
  const views = new WeakMap();
  const catalog = [
    { type: 'today', title: 'Time & weather', detail: 'Clock, date and a live weather sky', symbol: 'weather' },
    { type: 'clock', title: 'Clock', detail: 'Time and date', symbol: 'clock' },
    { type: 'weather', title: 'Weather', detail: 'Your local forecast', symbol: 'weather' },
    { type: 'tasks', title: 'Agent chats', detail: 'Working Codex and Claude Code chats', symbol: 'tasks' },
    { type: 'printers', title: '3D printers', detail: 'Status and machine controls', symbol: 'printer' },
    { type: 'media', title: 'Music', detail: 'Now playing and playlists', symbol: 'music' },
    { type: 'actions', title: 'Quick actions', detail: 'Audio output, microphone and mute', symbol: 'actions' },
    { type: 'stats', title: 'PC stats', detail: 'CPU, GPU, memory, busiest apps and internet speed', symbol: 'stats' },
    { type: 'gauge', title: 'Gauge', detail: 'One ring: CPU, GPU, memory, video memory or a temperature', symbol: 'gauge' },
    { type: 'switch', title: 'Switch', detail: 'One quick control: Wi-Fi, Bluetooth, sound, microphone or dark mode', symbol: 'toggle' },
    { type: 'timer', title: 'Timer', detail: 'A countdown with presets', symbol: 'timer' },
    { type: 'machine', title: 'Printer', detail: 'One printer at a glance', symbol: 'printer' },
  ];
  // Views with a choice: which reading, which control, which printer.
  const OPTIONS = {
    gauge: { field: 'metric', label: 'Reading', choices: () => [['cpu', 'CPU'], ['gpu', 'GPU'], ['memory', 'Memory'], ['vram', 'Video memory'], ['cpu-temp', 'CPU temperature'], ['gpu-temp', 'GPU temperature']] },
    switch: { field: 'control', label: 'Control', choices: () => [['wifi', 'Wi-Fi'], ['bluetooth', 'Bluetooth'], ['sound', 'Sound'], ['mic', 'Microphone'], ['dark', 'Dark mode'], ['night', 'Night light']] },
    machine: { field: 'printerId', label: 'Printer', choices: cfg => (cfg.printers || []).map(printer => [printer.id, printer.name || printer.model || printer.id]) },
  };
  function optionLabel(item, cfg) {
    const option = OPTIONS[item?.type]; if (!option) return '';
    const choices = option.choices(cfg); const value = item[option.field] ?? choices[0]?.[0];
    return choices.find(([id]) => id === value)?.[1] || '';
  }
  const sizes = [['small', 'Small'], ['medium', 'Medium'], ['wide', 'Wide'], ['tall', 'Tall'], ['large', 'Large']];
  const icons = {
    clock: ['M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z', 'M12 7v5l4 2'],
    weather: ['M7 14a5 5 0 1 1 7-6', 'M7 21h11a4 4 0 1 0-1-8 5 5 0 0 0-9 1 4 4 0 0 0-1 7Z'],
    tasks: ['M7 3h10v4H7Z', 'M7 5H4v16h16V5h-3', 'm8 13 2 2 5-5'],
    printer: ['M5 3h14v18H5Z', 'M8 6h8v11H8Z', 'M9 19h6', 'M12 6v5'],
    stats: ['M3 20h18', 'M6 16v-5', 'M11 16V6', 'M16 16v-8', 'M21 16v-3'],
    stats: ['M3 20h18', 'M6 16v-5', 'M11 16V6', 'M16 16v-8', 'M21 16v-3'],
    music: ['M9 18V5l11-2v13', 'M9 18c0 2-6 3-6 0s6-3 6 0Z', 'M20 16c0 2-6 3-6 0s6-3 6 0Z'],
    actions: ['M4 6h10', 'M18 6h2', 'M16 4v4', 'M4 12h4', 'M12 12h8', 'M10 10v4', 'M4 18h12', 'M20 18h0', 'M18 16v4'],
    app: ['M3 3h7v7H3ZM14 3h7v7h-7ZM3 14h7v7H3ZM14 14h7v7h-7Z'],
    website: ['M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z', 'M3 12h18', 'M12 3c5 5 5 13 0 18-5-5-5-13 0-18Z'],
    empty: ['M4 4h16v16H4Z', 'M8 12h8', 'M12 8v8'],
    gauge: ['M5 17a8 8 0 1 1 14 0', 'm12 13 4-4'],
    switch: ['M7 7h10a5 5 0 0 1 0 10H7a5 5 0 0 1 0-10Z', 'M15 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z'],
    timer: ['M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z', 'M12 9v4l2 2', 'M9 2h6'],
    machine: ['M5 3h14v18H5Z', 'M8 6h8v11H8Z', 'M9 19h6', 'M12 6v5'],
    plus: ['M12 4v16', 'M4 12h16'], up: ['m5 15 7-7 7 7'], down: ['m5 9 7 7 7-7'],
    edit: ['m4 16 12-12 4 4L8 20H4Z', 'm13 7 4 4'],
    remove: ['M5 7h14l-1 14H6Z', 'M3 7h18', 'M9 7V3h6v4', 'M10 11v6', 'M14 11v6'],
    undo: ['M4 3v6h6', 'M4 9a8 8 0 1 1 0 7'], check: ['m5 12 4 4L19 6'],
  };
  let undo = null;
  function el(tag, className = '', text) {
    const node = document.createElement(tag); node.className = className;
    if (text !== undefined) node.textContent = String(text); return node;
  }
  function icon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
    for (const d of icons[name] || icons.app) { const p = document.createElementNS(svg.namespaceURI, 'path'); p.setAttribute('d', d); svg.append(p); }
    return svg;
  }
  function uniqueId(prefix) {
    const value = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : [...crypto.getRandomValues(new Uint8Array(16))].map(value => value.toString(16).padStart(2, '0')).join('');
    return `${prefix}-${value}`;
  }
  function safeMessage(error) {
    const text = typeof error === 'string' ? error : error?.message;
    return typeof text === 'string' && text.length < 600 && !/(?:[a-z]:[\\/]|(?:token|secret|password|access.?code)\s*[:=])/i.test(text)
      ? text.replace(/[\u0000-\u001f\u007f]/g, ' ') : 'The layout could not be saved. Please try again.';
  }
  function config(view) { return view.context.getState()?.config || {}; }
  function cards(cfg) { return (Array.isArray(cfg.widgets) ? cfg.widgets : []).filter(card => card.type !== 'launchers'); }
  function items(card) {
    if (Array.isArray(card.items)) return card.items;
    return catalog.some(item => item.type === card.type) ? [{ id: `${card.id}-main`, type: card.type }] : [];
  }
  function contentName(item, cfg) {
    if (!item?.label && OPTIONS[item?.type]) { const choice = optionLabel(item, cfg); if (choice) return item.type === 'machine' ? choice : `${choice} ${catalog.find(entry => entry.type === item.type).title.toLowerCase()}`; }
    return item?.label || catalog.find(entry => entry.type === item?.type)?.title ||
      (cfg.launchers || []).find(app => app.id === item?.launcherId)?.name || (item?.type === 'website' ? 'Website' : item?.type === 'app' ? 'App shortcut' : 'Empty card');
  }
  function cardName(card, cfg) { return card.title || contentName(items(card).find(item => item.id === card.activeItemId) || items(card)[0], cfg); }
  function normalizeCard(card) {
    card.items = items(card);
    if (!card.items.some(item => item.id === card.activeItemId)) card.activeItemId = card.items[0]?.id || null;
    card.type = card.items.find(item => item.id === card.activeItemId)?.type || 'empty';
    return card;
  }
  function findCard(cfg, id) {
    const card = (cfg.widgets || []).find(card => card.id === id && card.type !== 'launchers');
    if (!card) throw new Error('This card is no longer in your layout.'); return normalizeCard(card);
  }
  function canEmbed(app) { try { const url = new URL(app?.target); return url.protocol === 'https:' && !url.username && !url.password; } catch { return false; } }
  function mounted(view) { return view.root?.isConnected && views.get(view.container) === view; }
  function button(view, label, action, symbol, disabled = false, className = '') {
    const node = el('button', `button layout-button ${className}`); node.type = 'button'; node.disabled = view.busy || disabled;
    node.setAttribute('aria-label', label); node.title = label;
    if (symbol) node.append(icon(symbol)); else node.textContent = label;
    node.addEventListener('click', action); return node;
  }
  async function save(view, change, message, after) {
    if (view.busy) return;
    view.busy = true; view.error = ''; view.notice = ''; draw(view);
    try {
      const cfg = structuredClone(config(view)); change(cfg);
      if (typeof view.context.bridge?.saveConfig !== 'function') throw new Error('Layout editing is unavailable.');
      const next = await view.context.bridge.saveConfig(cfg);
      if (!next?.config) throw new Error('The updated layout could not be read. Refresh the dashboard.');
      view.context.updateState(next); view.notice = message || 'Layout saved.';
      if (after) after(next);
      if (message) view.context.toast?.(message);
    } catch (error) { view.error = safeMessage(error); view.context.toast?.(view.error); }
    finally { view.busy = false; if (mounted(view)) draw(view); }
  }
  function sizePicker(view, card) {
    const field = el('label', 'layout-size-picker'); field.append(el('span', '', 'Size'));
    const select = el('select'); select.setAttribute('aria-label', `Size of ${cardName(card, config(view))}`);
    // Only the sizes designed for what the card shows.
    const allowed = window.EdgeLayout?.allowedSizes ? window.EdgeLayout.allowedSizes(items(card).map(item => item.type)) : sizes.map(([value]) => value);
    for (const [value, name] of sizes) if (allowed.includes(value)) { const option = el('option', '', name); option.value = value; select.append(option); }
    select.value = allowed.includes(card.size) ? card.size : allowed[0]; select.disabled = view.busy;
    select.addEventListener('change', () => save(view, cfg => { findCard(cfg, card.id).size = select.value; }, 'Card size saved.'));
    field.append(select); return field;
  }
  function removeCard(view, id) {
    let removed, index;
    save(view, cfg => {
      index = cfg.widgets.findIndex(card => card.id === id); if (index < 0) throw new Error('This card was already removed.');
      removed = structuredClone(cfg.widgets[index]); cfg.widgets.splice(index, 1);
    }, 'Card removed. Your apps and connections are unchanged.', () => { undo = { kind: 'card', card: removed, index, name: cardName(removed, config(view)) }; view.focusNext = 'Undo removal'; });
  }
  function undoRemoval(view) {
    const record = undo; if (!record) return;
    save(view, cfg => {
      if (record.kind === 'card') {
        if (cfg.widgets.some(card => card.id === record.card.id)) throw new Error('This card is already in your layout.');
        if (cards(cfg).length >= 16) throw new Error('Remove another card before restoring this one.');
        cfg.widgets.splice(Math.min(record.index, cfg.widgets.length), 0, structuredClone(record.card));
      } else {
        const card = findCard(cfg, record.cardId);
        if (card.items.some(item => item.id === record.item.id)) throw new Error('This view is already in the card.');
        if (card.items.length >= 6) throw new Error('Remove another view before restoring this one.');
        const restoreActive = card.activeItemId === record.activeAfter;
        card.items.splice(Math.min(record.index, card.items.length), 0, structuredClone(record.item));
        if (restoreActive && record.activeBefore) card.activeItemId = record.activeBefore;
        normalizeCard(card);
      }
    }, 'Restored.', () => { if (undo === record) undo = null; view.focusNext = view.mode === 'editor' ? 'Add view' : 'Add card'; });
  }
  function feedback(view, root) {
    if (view.error) { const message = el('p', 'layout-feedback is-error', view.error); message.setAttribute('role', 'alert'); root.append(message); }
    else if (view.busy || view.notice) { const message = el('p', 'layout-feedback', view.busy ? 'Saving…' : view.notice); message.setAttribute('role', 'status'); root.append(message); }
    if (undo) {
      const row = el('div', 'layout-undo'); row.append(el('span', '', `${undo.name || 'View'} removed.`), button(view, 'Undo removal', () => undoRemoval(view), 'undo'));
      root.append(row);
    }
  }
  function addCard(view, type, launcherId) {
    const id = uniqueId('card');
    save(view, cfg => {
      if (cards(cfg).length >= 16) throw new Error('Use up to 16 cards. Remove a card before adding another.');
      const content = type === 'empty' ? [] : [{ id: uniqueId('view'), type, ...(launcherId ? { launcherId } : {}) }];
      if (launcherId) {
        const app = cfg.launchers?.find(app => app.id === launcherId); if (!app || (type === 'website' && !canEmbed(app))) throw new Error('Choose an available saved app or HTTPS website.');
      }
      const card = { id, type, title: type === 'empty' ? 'New card' : contentName(content[0], cfg), enabled: true, size: 'medium', items: content, activeItemId: content[0]?.id || null };
      const dock = cfg.widgets.findIndex(card => card.type === 'launchers'); cfg.widgets.splice(dock < 0 ? cfg.widgets.length : dock, 0, card);
    }, 'Card added.', () => { view.gallery = false; view.context.onEditCard?.(id); });
  }
  function addContent(view, type, launcherId) {
    save(view, cfg => {
      const card = findCard(cfg, view.cardId); if (card.items.length >= 6) throw new Error('A card can contain up to six views.');
      if (launcherId) {
        const app = cfg.launchers?.find(app => app.id === launcherId); if (!app || (type === 'website' && !canEmbed(app))) throw new Error('Choose an available saved app or HTTPS website.');
      }
      card.items.push({ id: uniqueId('view'), type, ...(launcherId ? { launcherId } : {}) }); normalizeCard(card);
    }, 'View added to card.', () => { view.gallery = false; view.focusNext = 'Add view'; });
  }
  function gallery(view, root, forCard) {
    const cfg = config(view); const card = cards(cfg).find(card => card.id === view.cardId);
    const full = forCard ? items(card || {}).length >= 6 : cards(cfg).length >= 16;
    const section = el('section', 'layout-add-section');
    const heading = el('div', 'layout-section-heading'); heading.append(el('h3', '', forCard ? 'Add a view' : 'Add a card'), button(view, 'Close gallery', () => { view.gallery = false; view.focusNext = forCard ? 'Add view' : 'Add card'; draw(view); })); section.append(heading);
    const grid = el('div', 'layout-gallery');
    for (const entry of [...catalog, ...(!forCard ? [{ type: 'empty', title: 'Empty card', detail: 'Build your own combination', symbol: 'empty' }] : [])]) {
      const choice = button(view, `${forCard ? 'Add' : 'Create'} ${entry.title}`, () => forCard ? addContent(view, entry.type) : addCard(view, entry.type), null, full, 'layout-gallery-item');
      choice.replaceChildren(icon(entry.symbol), el('strong', '', entry.title), el('span', '', entry.detail)); grid.append(choice);
    }
    section.append(grid);
    if (full) section.append(el('p', 'layout-help', forCard ? 'This card has six views. Remove a view to add another.' : 'You have 40 widgets. Remove one to add another.'));
    const apps = Array.isArray(cfg.launchers) ? cfg.launchers : [];
    const appArea = el('div', 'layout-app-picker'); appArea.append(el('h4', '', 'Saved apps and websites'));
    if (apps.length) {
      const label = el('label', 'layout-form-field'); label.append(el('span', '', 'Choose a saved shortcut')); const select = el('select'); select.setAttribute('aria-label', 'Saved app or website');
      const placeholder = el('option', '', 'Choose an app or website'); placeholder.value = ''; select.append(placeholder);
      for (const app of apps) { const option = el('option', '', app.name); option.value = app.id; select.append(option); }
      select.value = apps.some(app => app.id === view.launcherId) ? view.launcherId : ''; select.disabled = view.busy;
      label.append(select); appArea.append(label);
      const actions = el('div', 'layout-inline-actions');
      const addApp = button(view, 'Add app shortcut', () => forCard ? addContent(view, 'app', select.value) : addCard(view, 'app', select.value), null, full || !select.value);
      const addWebsite = button(view, 'Add website preview', () => forCard ? addContent(view, 'website', select.value) : addCard(view, 'website', select.value), null, full || !canEmbed(apps.find(app => app.id === select.value)));
      select.addEventListener('change', () => { view.launcherId = select.value; addApp.disabled = view.busy || full || !select.value; addWebsite.disabled = view.busy || full || !canEmbed(apps.find(app => app.id === select.value)); });
      actions.append(addApp, addWebsite); appArea.append(actions, el('p', 'layout-help', 'Website previews use saved HTTPS links. Some websites require opening in a browser.'));
    } else appArea.append(el('p', 'layout-help', 'Save an app or website in Apps settings, then add it here.'));
    if (typeof view.context.onChooseApp === 'function') appArea.append(button(view, 'Manage saved apps', () => view.context.onChooseApp()));
    section.append(appArea); root.append(section);
  }
  function renderModePicker(view, root) {
    root.append(el('p', 'layout-intro', 'Choose an arrangement, then make each card your own. A card can hold up to six views.'));
    const chooser = el('div', 'layout-mode-picker'); chooser.setAttribute('aria-label', 'Dashboard layout');
    for (const [mode, name, description] of [['widgets', 'Widgets', 'Small, medium and large, like iOS'], ['auto', 'Auto', 'Fits every card to its content'], ['overview', 'Overview', 'A balanced row of cards'], ['bento', 'Bento', 'Mix compact and larger cards'], ['focus', 'Focus', 'Give your main card more room']]) {
      const choice = button(view, `${name} layout`, () => save(view, cfg => {
        const current = cards(cfg);
        const types = current.map(card => items(card)[0]?.type);
        const untouched = current.length >= 5 && current.every(card => (card.size || 'medium') === 'medium' && items(card).length === 1) && types.every(type => catalog.some(entry => entry.type === type)) && new Set(types).size === types.length;
        if (mode === 'bento' && (cfg.layout?.mode || 'overview') === 'overview' && untouched) {
          // Five cards: two compact + three wide. With Quick actions, four
          // compact cards share the top row and two wide cards the bottom.
          const compact = types.includes('actions') ? ['today', 'clock', 'weather', 'tasks', 'actions'] : ['today', 'clock', 'weather'];
          for (const card of current) card.size = compact.includes(items(card)[0].type) ? 'medium' : 'wide';
        }
        // Widgets: each card starts at the size that suits what it shows.
        if (mode === 'widgets' && (cfg.layout?.mode || 'overview') !== 'widgets' && window.EdgeLayout?.WIDGET_DEFAULTS) {
          for (const card of current) card.size = window.EdgeLayout.WIDGET_DEFAULTS[items(card)[0]?.type] || 'medium';
        }
        cfg.layout = { ...cfg.layout, mode };
      }, `${name} layout saved.`), null, false, 'layout-mode');
      choice.setAttribute('aria-pressed', String((config(view).layout?.mode || 'overview') === mode));
      const preview = el('span', `layout-preview ${mode}`); preview.setAttribute('aria-hidden', 'true'); for (let i = 0; i < 5; i++) preview.append(el('i'));
      choice.replaceChildren(preview, el('strong', '', name), el('span', '', description)); chooser.append(choice);
    }
    root.append(chooser, el('p', 'layout-help', 'Widgets: choose Small, Medium or Large for each card in Edit layout. Auto sizes every card for its content and stacks small ones when space runs out. Adjust card sizes yourself in Overview or Bento; Focus enlarges the first card.'));
  }
  function settings(view, root) {
    const cfg = config(view); const listCards = cards(cfg); feedback(view, root);
    root.append(el('p', 'layout-intro', 'Widgets come in the sizes designed for them. Hold a widget on the deck to edit it, or hold an empty spot to arrange the Home Screen.'));
    const heading = el('div', 'layout-section-heading'); heading.append(el('h3', '', `Widgets · ${listCards.length}/40`), button(view, 'Add widget', () => { if (view.context.onAddWidget) view.context.onAddWidget(); else { view.gallery = true; view.focusNext = 'gallery'; draw(view); } }, 'plus', listCards.length >= 40)); root.append(heading);
    if (view.gallery) gallery(view, root, false);
    const list = el('div', 'layout-card-list');
    for (const [index, card] of listCards.entries()) {
      const row = el('article', 'layout-card-row'); row.dataset.cardId = card.id;
      const info = el('div', 'layout-card-info'); const visual = el('span', 'layout-card-icon'); visual.append(icon(card.type));
      const copy = el('div'); copy.append(el('h4', '', cardName(card, cfg)), el('p', '', items(card).length ? items(card).map(item => contentName(item, cfg)).join(' · ') : 'Empty card'));
      info.append(visual, copy); row.append(info);
      const actions = el('div', 'layout-card-actions');
      const toggle = button(view, `Show ${cardName(card, cfg)}`, () => save(view, next => { const target = findCard(next, card.id); target.enabled = target.enabled === false; }), null, false, 'layout-switch');
      toggle.setAttribute('role', 'switch'); toggle.setAttribute('aria-checked', String(card.enabled !== false)); toggle.textContent = card.enabled !== false ? 'Shown' : 'Hidden';
      const move = direction => save(view, next => {
        const order = cards(next); const at = order.findIndex(item => item.id === card.id); const neighbor = order[at + direction];
        if (at < 0) throw new Error('This card is no longer in your layout.');
        if (!neighbor) throw new Error('The card is already at the end of the layout.');
        const left = next.widgets.findIndex(item => item.id === card.id), right = next.widgets.findIndex(item => item.id === neighbor.id);
        [next.widgets[left], next.widgets[right]] = [next.widgets[right], next.widgets[left]];
      }, 'Card order saved.');
      actions.append(toggle, sizePicker(view, card), button(view, `Move ${cardName(card, cfg)} up`, () => move(-1), 'up', index === 0),
        button(view, `Move ${cardName(card, cfg)} down`, () => move(1), 'down', index === listCards.length - 1),
        button(view, `Edit ${cardName(card, cfg)}`, () => view.context.onEditCard?.(card.id), 'edit', typeof view.context.onEditCard !== 'function'),
        button(view, `Remove ${cardName(card, cfg)} card`, () => removeCard(view, card.id), 'remove', false, 'danger'));
      row.append(actions); list.append(row);
    }
    if (!listCards.length) list.append(el('p', 'layout-empty', 'Your layout is empty. Add a card to start building your dashboard.'));
    root.append(list, el('p', 'layout-help', 'Removing a card changes this dashboard only. Saved apps, printer connections, and Spotify playlists stay available.'));
  }
  function editor(view, root) {
    const cfg = config(view); const card = cards(cfg).find(card => card.id === view.cardId);
    feedback(view, root);
    if (!card) {
      root.append(el('h3', '', 'This card was removed'), el('p', 'layout-help', 'Use Undo above to restore it, or return to your layout.'));
      if (view.context.onClose) root.append(button(view, 'Back to layout', () => view.context.onClose())); return;
    }
    if (!view.titleDirty) view.titleDraft = card.title || '';
    const form = el('form', 'layout-title-form'); const field = el('label', 'layout-form-field'); field.append(el('span', '', 'Card name'));
    const title = el('input'); title.type = 'text'; title.maxLength = 60; title.value = view.titleDraft; title.placeholder = contentName(items(card)[0], cfg); title.disabled = view.busy; title.setAttribute('aria-label', 'Card name');
    title.addEventListener('input', () => { view.titleDraft = title.value; view.titleDirty = true; }); field.append(title);
    const rename = button(view, 'Save name', () => form.requestSubmit()); form.append(field, rename);
    form.addEventListener('submit', event => { event.preventDefault(); save(view, next => { findCard(next, view.cardId).title = view.titleDraft.trim(); }, 'Card name saved.', () => { view.titleDirty = false; }); }); root.append(form);
    const options = el('div', 'layout-editor-options'); options.append(sizePicker(view, card), el('p', 'layout-help', 'Tap a view on the dashboard to switch contents. A card offers the sizes all its views share.')); root.append(options);
    const content = items(card); const heading = el('div', 'layout-section-heading'); heading.append(el('h3', '', `Views · ${content.length}/6`), button(view, 'Add view', () => { view.gallery = true; view.focusNext = 'gallery'; draw(view); }, 'plus', content.length >= 6)); root.append(heading);
    const list = el('div', 'layout-content-list');
    for (const [index, item] of content.entries()) {
      const name = contentName(item, cfg); const row = el('article', 'layout-content-row'); row.dataset.itemId = item.id;
      const info = el('div', 'layout-card-info'); const visual = el('span', 'layout-card-icon'); visual.append(icon(item.type));
      const copy = el('div'); copy.append(el('h4', '', name), el('p', '', item.type === 'website' ? 'Website preview' : item.type === 'app' ? 'App shortcut' : 'Dashboard view'));
      const option = OPTIONS[item.type];
      if (option) {
        const choices = option.choices(cfg);
        const field = el('label', 'layout-form-field layout-item-option'); field.append(el('span', '', option.label));
        const select = el('select'); select.setAttribute('aria-label', `${option.label} for ${name}`);
        if (!choices.length) { const none = el('option', '', 'No printers set up'); none.value = ''; select.append(none); }
        for (const [value, label] of choices) { const choice = el('option', '', label); choice.value = String(value); select.append(choice); }
        select.value = String(item[option.field] ?? choices[0]?.[0] ?? ''); select.disabled = view.busy || !choices.length;
        select.addEventListener('change', () => save(view, next => { const target = findCard(next, card.id).items.find(entry => entry.id === item.id); if (!target) throw new Error('This view was removed.'); target[option.field] = select.value; }, `${option.label} saved.`));
        field.append(select); copy.append(field);
      }
      info.append(visual, copy); row.append(info);
      const actions = el('div', 'layout-content-actions');
      const defaultButton = button(view, `Make ${name} the default view`, () => save(view, next => { const target = findCard(next, card.id); if (!target.items.some(entry => entry.id === item.id)) throw new Error('This view was removed.'); target.activeItemId = item.id; normalizeCard(target); }, 'Default view saved.'), null, false, 'layout-default');
      const isActive = item.id === (card.activeItemId || content[0]?.id); defaultButton.textContent = isActive ? 'Default' : 'Set default'; defaultButton.setAttribute('aria-pressed', String(isActive));
      const move = direction => save(view, next => { const target = findCard(next, card.id); const at = target.items.findIndex(entry => entry.id === item.id); if (at < 0) throw new Error('This view was removed.'); if (!target.items[at + direction]) throw new Error('This view cannot move further.'); [target.items[at], target.items[at + direction]] = [target.items[at + direction], target.items[at]]; normalizeCard(target); }, 'View order saved.');
      const remove = () => {
        let removed, at, activeBefore, activeAfter;
        save(view, next => { const target = findCard(next, card.id); at = target.items.findIndex(entry => entry.id === item.id); if (at < 0) throw new Error('This view was already removed.'); activeBefore = target.activeItemId; removed = structuredClone(target.items[at]); target.items.splice(at, 1); normalizeCard(target); activeAfter = target.activeItemId; }, 'View removed.', () => { undo = { kind: 'item', cardId: card.id, item: removed, index: at, name, activeBefore, activeAfter }; view.focusNext = 'Undo removal'; });
      };
      actions.append(defaultButton, button(view, `Move ${name} view up`, () => move(-1), 'up', index === 0), button(view, `Move ${name} view down`, () => move(1), 'down', index === content.length - 1),
        button(view, `Rename ${name} view`, () => { view.renameId = view.renameId === item.id ? '' : item.id; view.itemDraft = item.label || ''; if (view.renameId) view.focusNext = 'rename-input'; draw(view); }, 'edit'),
        button(view, `Remove ${name} view`, remove, 'remove', false, 'danger')); row.append(actions);
      if (view.renameId === item.id) {
        const renameForm = el('form', 'layout-item-rename'); const input = el('input'); input.type = 'text'; input.maxLength = 60; input.value = view.itemDraft; input.placeholder = name; input.setAttribute('aria-label', `View name for ${name}`); input.disabled = view.busy;
        input.addEventListener('input', () => { view.itemDraft = input.value; });
        renameForm.append(input, button(view, 'Save view name', () => renameForm.requestSubmit()));
        renameForm.addEventListener('submit', event => { event.preventDefault(); save(view, next => { const target = findCard(next, card.id).items.find(entry => entry.id === item.id); if (!target) throw new Error('This view was removed.'); const label = view.itemDraft.trim(); if (label) target.label = label; else delete target.label; }, 'View name saved.', () => { view.renameId = ''; view.focusNext = 'Add view'; }); }); row.append(renameForm);
      }
      list.append(row);
    }
    if (!content.length) list.append(el('p', 'layout-empty', 'This card is ready for your first view. Add a widget, app shortcut, or website.'));
    root.append(list);
    if (view.gallery) gallery(view, root, true);
    root.append(el('p', 'layout-help', 'The default view opens first. Removing a view only removes it from this card.'), button(view, 'Remove this card', () => removeCard(view, card.id), null, false, 'danger layout-remove-card'));
  }
  function draw(view) {
    const active = document.activeElement;
    if (!view.focusNext && view.root?.contains(active)) view.focusNext = active.getAttribute('aria-label');
    const root = el('section', `edge-layout-ui layout-${view.mode}`); root.setAttribute('aria-busy', String(view.busy)); root.dataset.edgeLayoutRoot = view.mode;
    view.root = root; view.container.replaceChildren(root);
    if (view.mode === 'settings') settings(view, root); else editor(view, root);
    const target = view.focusNext === 'gallery' ? root.querySelector('.layout-gallery button') : view.focusNext === 'rename-input' ? root.querySelector('.layout-item-rename input') : [...root.querySelectorAll('[aria-label]')].find(node => node.getAttribute('aria-label') === view.focusNext);
    if (target && !target.disabled) { target.focus({ preventScroll: !['gallery', 'rename-input'].includes(view.focusNext) }); if (document.activeElement === target) view.focusNext = ''; }
    else if (!view.busy) view.focusNext = '';
    return true;
  }
  function render(container, context, mode) {
    let view = views.get(container);
    const changed = !view || view.mode !== mode || (mode === 'editor' && view.cardId !== context.cardId);
    if (changed) { view = { container, context, mode, cardId: context.cardId, busy: false, error: '', notice: '', gallery: false, launcherId: '', titleDraft: '', titleDirty: false, renameId: '', itemDraft: '' }; views.set(container, view); }
    else view.context = context;
    if (!changed && !view.busy && view.root?.contains(document.activeElement) && ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName)) return false;
    return draw(view);
  }
  window.EdgeLayoutUI = Object.freeze({ renderSettings: (container, context) => render(container, context, 'settings'), renderEditor: (container, context) => render(container, context, 'editor') });
})();
