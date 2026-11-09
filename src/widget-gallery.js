(() => {
  'use strict';
  // The widget gallery and Edit widget, like iOS. The gallery lists the
  // sources (Clock, Weather, Music, ...) beside a search field; choosing one
  // shows its widgets as swipeable live previews, one kind and size per page,
  // with Add widget. Edit widget offers only the sizes the widget has, its
  // options (which reading, control or printer) and the page it is on.
  const SIZE_NAMES = { small: 'Small', medium: 'Medium', large: 'Large', tall: 'Tall' };
  // Suggestions open the gallery: a few widgets that suit most decks.
  const SUGGESTIONS = [['dial', 'small', { face: 'digital' }], ['weather', 'medium'], ['sun-path', 'small'], ['media', 'small'], ['gauge', 'small'], ['timer', 'small'], ['switch', 'small'], ['machine', 'small'], ['stats', 'medium'], ['tasks', 'medium']];
  // Options a widget has, edited in Edit widget.
  const cityChoices = () => (window.EdgeLayout?.CITIES || []).map(city => [city.id, city.name]);
  const faces = [['numbers', 'Numbers'], ['bars', 'Bars'], ['quarters', 'Quarters']];
  const field = (name, label, choices) => ({ label, choices, get: item => item[name], set: (item, value) => { item[name] = value; } });
  const cityAt = index => ({ label: `City ${index + 1}`, choices: cityChoices, get: item => (item.cities || [])[index], set: (item, value) => { const list = [...(item.cities || window.EdgeLayout.WORLD_CLOCK_DEFAULT)]; list[index] = value; item.cities = list; } });
  const OPTIONS = {
    gauge: [field('metric', 'Reading', () => [['cpu', 'CPU'], ['gpu', 'GPU'], ['memory', 'Memory'], ['vram', 'Video memory'], ['cpu-temp', 'CPU temperature'], ['gpu-temp', 'GPU temperature']])],
    switch: [field('control', 'Control', () => [['wifi', 'Wi-Fi'], ['bluetooth', 'Bluetooth'], ['sound', 'Sound'], ['mic', 'Microphone'], ['dark', 'Dark mode'], ['night', 'Night light']])],
    machine: [field('printerId', 'Printer', cfg => (cfg.printers || []).map(printer => [printer.id, printer.name || printer.model || printer.id]))],
    dial: [field('face', 'Face', () => [['digital', 'Digital'], ...faces])],
    city: [field('city', 'City', cityChoices), field('face', 'Face', () => [['digital', 'Digital'], ...faces])],
    'world-clock': [0, 1, 2, 3].map(cityAt),
  };
  let sheet = null, view = null;

  // ---- Pages of the gallery ---------------------------------------------------
  function kindOf(ctx, type) { return ctx.layout.WIDGET_KINDS.find(kind => kind.type === type); }
  function defaults(ctx, type) {
    const cfg = ctx.getState().config || {};
    if (type === 'gauge') return { metric: 'cpu' };
    if (type === 'switch') return { control: 'wifi' };
    if (type === 'machine') { const first = (cfg.printers || []).find(printer => printer.configured) || (cfg.printers || [])[0]; return first ? { printerId: first.id } : {}; }
    if (type === 'city') return { city: 'cupertino' };
    if (type === 'world-clock') return { cities: [...ctx.layout.WORLD_CLOCK_DEFAULT] };
    return {};
  }
  // Each page: one kind at one size (apps: one page per saved app or website).
  function pagesFor(ctx, sourceId) {
    const cfg = ctx.getState().config || {};
    const pages = [];
    const push = (kind, size, extra = {}, title = kind.title, detail = kind.detail) => pages.push({ type: kind.type, size, item: { ...defaults(ctx, kind.type), ...extra }, title, detail, source: kind.source });
    if (sourceId === 'suggestions') {
      for (const [type, size, extra] of SUGGESTIONS) { const kind = kindOf(ctx, type); const variant = (kind?.variants || []).find(entry => Object.entries(extra || {}).every(([key, value]) => entry.item?.[key] === value)); if (kind && kind.source && kind.sizes.includes(size)) push(kind, size, extra || {}, variant?.title || kind.title, variant?.detail || kind.detail); }
      return pages;
    }
    for (const kind of ctx.layout.WIDGET_KINDS.filter(entry => entry.source === sourceId)) {
      if (kind.type === 'app' || kind.type === 'website') {
        for (const app of cfg.launchers || []) {
          if (kind.type === 'website' && !/^https:\/\//i.test(app.target || '')) continue;
          for (const size of kind.sizes) push(kind, size, { launcherId: app.id }, app.name, kind.type === 'website' ? `A live preview of ${safeHost(app.target)}.` : `Open ${app.name} from the deck.`);
        }
        continue;
      }
      for (const variant of kind.variants || [{}]) for (const size of kind.sizes) push(kind, size, variant.item || {}, variant.title || kind.title, variant.detail || kind.detail);
    }
    return pages;
  }
  function safeHost(target) { try { return new URL(target).hostname; } catch { return 'the website'; } }
  function searchPages(ctx, text) {
    const query = text.trim().toLowerCase(); if (!query) return [];
    const sources = ctx.layout.WIDGET_SOURCES;
    const all = sources.flatMap(source => pagesFor(ctx, source.id).map(page => ({ ...page, sourceTitle: source.title })));
    return all.filter(page => `${page.title} ${page.detail} ${page.sourceTitle}`.toLowerCase().includes(query));
  }

  // ---- The sheet ------------------------------------------------------------
  function ensureSheet(ctx) {
    if (sheet) return sheet;
    sheet = ctx.el('dialog', 'widget-sheet'); sheet.id = 'widget-sheet'; sheet.setAttribute('aria-labelledby', 'widget-sheet-title');
    sheet.addEventListener('click', event => { if (event.target === sheet) sheet.close(); });
    // A toast shown while the sheet was open lives in it; keep it when the sheet empties.
    sheet.addEventListener('close', () => { const notice = document.getElementById('toast'); if (notice && sheet.contains(notice)) document.body.append(notice); sheet.replaceChildren(); view = null; });
    document.body.append(sheet);
    return sheet;
  }
  function open(ctx, next) {
    ensureSheet(ctx); view = next; draw();
    if (!sheet.open) {
      sheet.showModal();
      if (!matchMedia('(prefers-reduced-motion: reduce)').matches && !document.documentElement.classList.contains('low-power')) sheet.animate([{ transform: 'translateY(40px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 300, easing: 'cubic-bezier(.2,.8,.2,1)' });
    }
  }
  function openGallery(ctx) { open(ctx, { mode: 'gallery', ctx, source: 'suggestions', query: '', index: 0, busy: false }); }
  function openEditor(ctx, cardId) { open(ctx, { mode: 'editor', ctx, cardId, busy: false }); }
  function draw() {
    if (!view || !sheet) return;
    const focusedLabel = document.activeElement && sheet.contains(document.activeElement) ? document.activeElement.getAttribute('aria-label') || document.activeElement.textContent : '';
    const notice = document.getElementById('toast'); if (notice && sheet.contains(notice)) document.body.append(notice);
    sheet.replaceChildren(view.mode === 'gallery' ? galleryView(view) : editorView(view));
    if (notice && !notice.hidden) sheet.append(notice);
    sheet.dataset.mode = view.mode;
    const target = [...sheet.querySelectorAll('button, input, select')].find(node => (node.getAttribute('aria-label') || node.textContent) === focusedLabel && !node.disabled);
    (target || sheet.querySelector(view.mode === 'gallery' ? '.ws-search input' : '.ws-size.is-active, .ws-done'))?.focus({ preventScroll: true });
    // Previews are drawn once they are in the page (they measure themselves).
    for (const frame of sheet.querySelectorAll('.ws-frame')) frame.drawPreview?.();
  }
  function closeButton(ctx) {
    const node = ctx.button('', () => sheet.close(), { className: 'quiet-button ws-close', icon: 'close', label: view.mode === 'gallery' ? 'Close widget gallery' : 'Close Edit widget' });
    return node;
  }
  // A live preview, scaled down to fit its stage.
  function stage(ctx, type, size, item, maxWidth, maxHeight) {
    const preview = ctx.preview(type, size, item);
    const scale = Math.min(1, maxWidth / preview.width, maxHeight / preview.height);
    const frame = ctx.el('div', 'ws-frame'); frame.style.width = `${Math.round(preview.width * scale)}px`; frame.style.height = `${Math.round(preview.height * scale)}px`;
    preview.node.style.transform = `scale(${scale})`; preview.node.style.transformOrigin = '0 0';
    frame.append(preview.node); frame.drawPreview = preview.draw; frame.setAttribute('aria-hidden', 'true');
    return frame;
  }

  // ---- Gallery ----------------------------------------------------------------
  function galleryView(v) {
    const ctx = v.ctx, root = ctx.el('div', 'ws-panel ws-gallery');
    const side = ctx.el('aside', 'ws-side');
    const search = ctx.el('label', 'ws-search'); search.append(ctx.icon('search'));
    const input = ctx.el('input'); input.type = 'search'; input.placeholder = 'Search widgets'; input.value = v.query; input.setAttribute('aria-label', 'Search widgets'); input.maxLength = 40;
    input.addEventListener('input', () => { v.query = input.value; v.index = 0; draw(); const field = sheet.querySelector('.ws-search input'); if (field) { field.focus(); field.setSelectionRange(field.value.length, field.value.length); } });
    search.append(input); side.append(search);
    const list = ctx.el('nav', 'ws-sources'); list.setAttribute('aria-label', 'Widget sources');
    const sources = [{ id: 'suggestions', title: 'Suggestions', symbol: 'sparkle' }, ...ctx.layout.WIDGET_SOURCES];
    for (const source of sources) {
      if (source.id !== 'suggestions' && !pagesFor(ctx, source.id).length) continue;
      const active = !v.query && v.source === source.id;
      const entry = ctx.button('', () => { v.source = source.id; v.query = ''; v.index = 0; draw(); }, { className: `ws-source${active ? ' is-active' : ''}`, label: source.title });
      entry.setAttribute('aria-pressed', String(active));
      const glyph = ctx.el('span', `ws-source-icon is-${source.id}`); glyph.append(ctx.icon(source.symbol));
      entry.append(glyph, ctx.el('span', 'ws-source-name', source.title), ctx.icon('right'));
      list.append(entry);
    }
    side.append(list);
    const main = ctx.el('section', 'ws-main');
    const pages = v.query ? searchPages(ctx, v.query) : pagesFor(ctx, v.source);
    v.index = Math.max(0, Math.min(pages.length - 1, v.index));
    const source = sources.find(entry => entry.id === v.source);
    const head = ctx.el('header', 'ws-head'); const title = ctx.el('h2', '', v.query ? `Results for “${v.query.trim()}”` : source?.title || 'Widgets'); title.id = 'widget-sheet-title';
    head.append(title, closeButton(ctx)); main.append(head);
    if (!pages.length) {
      const empty = ctx.el('div', 'ws-empty');
      empty.append(ctx.el('h3', '', v.query ? 'No widgets found' : 'Nothing to add yet'), ctx.el('p', '', v.query ? 'Try another word, such as weather, printer or timer.' : 'Save an app or website in Customize → Apps, then add it here.'));
      if (!v.query && v.source === 'apps') empty.append(ctx.button('Open Apps settings', () => { sheet.close(); ctx.showSettings('apps'); }, { className: 'button subtle' }));
      main.append(empty); root.append(side, main); return root;
    }
    const page = pages[v.index];
    const copy = ctx.el('div', 'ws-copy'); copy.append(ctx.el('h3', '', page.title), ctx.el('p', '', page.detail));
    const carousel = ctx.el('div', 'ws-carousel');
    const go = step => { const next = v.index + step; if (next < 0 || next >= pages.length) return; v.index = next; v.direction = step; draw(); };
    const prev = ctx.button('', () => go(-1), { className: 'quiet-button ws-step', icon: 'left', label: 'Previous widget', disabled: v.index === 0 });
    const next = ctx.button('', () => go(1), { className: 'quiet-button ws-step', icon: 'right', label: 'Next widget', disabled: v.index === pages.length - 1 });
    const holder = ctx.el('div', 'ws-stage');
    const frame = stage(ctx, page.type, page.size, page.item, 640, 330);
    holder.append(frame, ctx.el('span', 'ws-size-label', SIZE_NAMES[page.size] || page.size));
    if (v.direction && !matchMedia('(prefers-reduced-motion: reduce)').matches && !document.documentElement.classList.contains('low-power')) frame.animate([{ transform: `translateX(${v.direction * 60}px)`, opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 260, easing: 'cubic-bezier(.2,.8,.2,1)' });
    v.direction = 0;
    // Swipe the preview to see the next widget, like iOS.
    let start = null;
    holder.addEventListener('pointerdown', event => { start = { x: event.clientX, y: event.clientY, id: event.pointerId }; try { holder.setPointerCapture(event.pointerId); } catch {} });
    holder.addEventListener('pointerup', event => { if (!start || event.pointerId !== start.id) return; const dx = event.clientX - start.x, dy = event.clientY - start.y; start = null; if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? 1 : -1); });
    holder.addEventListener('pointercancel', () => { start = null; });
    carousel.append(prev, holder, next);
    const dots = ctx.el('div', 'ws-dots'); dots.setAttribute('aria-label', `Widget ${v.index + 1} of ${pages.length}`); dots.setAttribute('role', 'img');
    for (let i = 0; i < pages.length; i++) dots.append(ctx.el('i', i === v.index ? 'is-active' : ''));
    const add = ctx.button('Add widget', async () => {
      if (v.busy) return; v.busy = true; add.disabled = true;
      try { await ctx.addWidget(page.type, page.size, page.item); sheet.close(); }
      catch (error) { ctx.toast(error.message || 'The widget could not be added.'); v.busy = false; add.disabled = false; }
    }, { className: 'button primary ws-add', icon: 'plus' });
    main.append(copy, carousel, dots, add);
    root.append(side, main); return root;
  }

  // ---- Edit widget -------------------------------------------------------------
  function editorView(v) {
    const ctx = v.ctx, cfg = ctx.getState().config || {};
    const card = (cfg.widgets || []).find(widget => widget.id === v.cardId);
    const root = ctx.el('div', 'ws-panel ws-editor');
    if (!card) { setTimeout(() => sheet?.close()); return root; }
    const items = Array.isArray(card.items) ? card.items : [];
    const item = items.find(entry => entry.id === card.activeItemId) || items[0] || { type: 'empty' };
    const allowed = ctx.layout.allowedSizes(items.length ? items.map(entry => entry.type) : ['empty']);
    const head = ctx.el('header', 'ws-head'); const title = ctx.el('h2', '', `Edit ${ctx.cardTitle(card)}`); title.id = 'widget-sheet-title';
    head.append(title, closeButton(ctx)); root.append(head);
    const body = ctx.el('div', 'ws-editor-body');
    const preview = ctx.el('div', 'ws-stage ws-editor-stage');
    preview.append(stage(ctx, item.type, card.size || 'medium', Object.fromEntries(Object.entries(item).filter(([key]) => !['id', 'type'].includes(key))), 620, 420));
    const form = ctx.el('div', 'ws-editor-form');
    const change = async (mutate, message) => {
      if (v.busy) return; v.busy = true; draw();
      try { await ctx.saveCard(card.id, mutate); if (message) ctx.toast(message); }
      catch (error) { ctx.toast(error.message || 'The widget could not be changed.'); }
      finally { v.busy = false; draw(); }
    };
    // Size: only the sizes this widget has; one that would not fit says so.
    const sizes = ctx.el('div', 'ws-sizes'); sizes.setAttribute('role', 'group'); sizes.setAttribute('aria-label', 'Size');
    for (const size of allowed) {
      const current = (card.size || 'medium') === size, fits = current || ctx.fitsSize(card.id, size);
      const choice = ctx.button('', () => change(next => { next.size = size; }), { className: `ws-size${current ? ' is-active' : ''}`, label: `${SIZE_NAMES[size]}${fits ? '' : ', no room on this page'}`, disabled: v.busy || !fits });
      choice.setAttribute('aria-pressed', String(current));
      const shape = ctx.el('span', `ws-size-shape is-${size}`); shape.setAttribute('aria-hidden', 'true'); shape.append(ctx.el('i'));
      choice.append(shape, ctx.el('strong', '', SIZE_NAMES[size]), ctx.el('small', '', fits ? sizeHint(size) : 'No room here'));
      sizes.append(choice);
    }
    form.append(section(ctx, 'Size', sizes));
    // The widget's own options (which reading, control, printer, face or cities).
    const options = OPTIONS[item.type] || [];
    if (options.length) {
      const grid = ctx.el('div', `ws-options${options.length > 2 ? ' is-many' : ''}`);
      for (const option of options) {
        const choices = option.choices(cfg);
        const label = ctx.el('label', 'ws-option'); label.append(ctx.el('span', '', option.label));
        const select = ctx.el('select', 'ws-select'); select.setAttribute('aria-label', option.label); select.disabled = v.busy || !choices.length;
        if (!choices.length) { const none = ctx.el('option', '', 'No printers set up'); none.value = ''; select.append(none); }
        for (const [value, text] of choices) { const entry = ctx.el('option', '', text); entry.value = String(value); select.append(entry); }
        select.value = String(option.get(item) ?? choices[0]?.[0] ?? '');
        select.addEventListener('change', () => change(next => { const target = (next.items || []).find(entry => entry.id === item.id); if (target) option.set(target, select.value); }, `${option.label} saved.`));
        label.append(select); grid.append(label);
      }
      form.append(section(ctx, 'Options', grid));
    }
    // Page: move the widget to another page with room.
    const pages = ctx.pages();
    if (pages.length > 1) {
      const row = ctx.el('div', 'ws-pages'); row.setAttribute('role', 'group'); row.setAttribute('aria-label', 'Page');
      const here = card.page || pages[0].id;
      for (const page of pages) {
        const current = page.id === here, fits = current || ctx.fitsSize(card.id, card.size || 'medium', page.id);
        const choice = ctx.button(page.name, () => change(next => { next.page = page.id; }, `Moved to ${page.name}.`), { className: `ws-page${current ? ' is-active' : ''}`, label: `${page.name}${fits ? '' : ', no room'}`, disabled: v.busy || !fits });
        choice.setAttribute('aria-pressed', String(current)); row.append(choice);
      }
      form.append(section(ctx, 'Page', row));
    }
    const actions = ctx.el('div', 'ws-editor-actions');
    actions.append(
      ctx.button('More options', () => { sheet.close(); ctx.openCardEditor(card.id); }, { className: 'button subtle', icon: 'settings' }),
      ctx.button('Remove widget', async () => { sheet.close(); await ctx.removeWidget(card.id); }, { className: 'button danger', icon: 'trash' }),
    );
    form.append(actions);
    body.append(preview, form); root.append(body);
    root.append(ctx.button('Done', () => sheet.close(), { className: 'button primary ws-done' }));
    return root;
  }
  function sizeHint(size) { return { small: '1 × 1', medium: '2 × 1', large: '2 × 2', tall: '1 × 2' }[size] || ''; }
  function section(ctx, label, content) { const box = ctx.el('section', 'ws-section'); box.append(ctx.el('h3', '', label), content); return box; }
  // Redraws an open sheet when the dashboard's state changes (for example after a save).
  function refresh() { if (sheet?.open && view && !view.busy && !sheet.contains(document.activeElement?.matches?.('input, select') ? document.activeElement : null)) draw(); }

  window.EdgeWidgetGallery = Object.freeze({ openGallery, openEditor, refresh, helpers: { pagesFor, searchPages, SUGGESTIONS, OPTIONS } });
})();
