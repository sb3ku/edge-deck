(() => {
  'use strict';
  // Reminders widget: an iOS-style checklist. One list lives in config.reminders
  // and is saved with the settings. Small and Medium show what is still open;
  // Large also lists completed items, clears them, adds and deletes. A tick
  // shows at once, and the row moves away after 1.2 s like iOS (the save waits
  // for that, so a second tap can still undo it).
  const MAX_ITEMS = 100, MAX_TEXT = 120, TICK_DELAY_MS = 1200, HOLD_MS = 600, HOLD_SLOP = 10;
  const LIMITS = Object.freeze({ small: 3, medium: 6, large: 10 });
  const SVG = 'http://www.w3.org/2000/svg';
  const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

  // ---- Pure helpers (also exposed for tests) --------------------------------
  const sizeOf = size => (size === 'small' || size === 'large' ? size : 'medium');
  const itemsOf = reminders => (Array.isArray(reminders?.items) ? reminders.items.filter(item => item && typeof item.id === 'string' && typeof item.text === 'string') : []);
  const openOf = items => items.filter(item => !item.done);
  const doneOf = items => items.filter(item => item.done);
  // The text a reminder may have: trimmed, 1 to 120 characters, no control characters; otherwise ''.
  function cleanText(text) {
    const value = typeof text === 'string' ? text.trim() : '';
    return value && value.length <= MAX_TEXT && !CONTROL.test(value) ? value : '';
  }
  function makeId(now = Date.now(), random = Math.random) { return `r${now.toString(36)}${Math.floor(random() * 36 ** 4).toString(36).padStart(4, '0')}`; }
  // What a size shows: open rows first, then (Large only) completed ones, within the row limit; the rest is "+N more".
  function view(items, size) {
    const kind = sizeOf(size), open = openOf(items), done = doneOf(items);
    // Large keeps one row of room for "+N more" when the list does not fit.
    const total = kind === 'large' ? open.length + done.length : open.length, limit = kind === 'large' && total > LIMITS.large ? LIMITS.large - 1 : LIMITS[kind];
    const shownOpen = open.slice(0, limit), shownDone = kind === 'large' ? done.slice(0, limit - shownOpen.length) : [];
    const hidden = open.length + (kind === 'large' ? done.length : 0) - shownOpen.length - shownDone.length;
    return { size: kind, open, done, shownOpen, shownDone, hidden };
  }
  function addItem(items, text, now = Date.now(), id = makeId(now)) {
    const value = cleanText(text);
    if (!value || items.length >= MAX_ITEMS) return items;
    return [...items, { id, text: value, done: false, doneAt: null, createdAt: new Date(now).toISOString() }];
  }
  function setDone(items, id, done, now = Date.now()) {
    return items.map(item => (item.id === id && item.done !== done ? { ...item, done, doneAt: done ? new Date(now).toISOString() : null } : item));
  }
  function removeItem(items, id) { return items.filter(item => item.id !== id); }
  function clearDone(items) { return items.filter(item => !item.done); }
  function countText(count) { return String(count); }
  function moreText(count) { return `+${count} more`; }

  // ---- State -------------------------------------------------------------------
  const pending = new Map(); // id -> timer of a tick that has not been saved yet
  let saving = false, chain = Promise.resolve(), draft = '', refocus = false;

  // Saves the list produced by `change`. The UI follows at once (optimistic); a
  // failure shows the message and redraws from the state before the change.
  // Taps while a save is running are ignored; `wait` (the tick timer) queues instead.
  function commit(ctx, change, { wait = false } = {}) {
    if (saving && !wait) return Promise.resolve(false);
    const run = async () => {
      saving = true;
      const before = ctx.state();
      try {
        const next = structuredClone(before.config);
        next.reminders = { items: change(itemsOf(before.config.reminders)) };
        ctx.updateState({ ...before, config: next });
        const result = await ctx.bridge.saveConfig(next);
        ctx.updateState(result?.config ? result : { ...ctx.state(), config: result || next });
        return true;
      } catch (error) {
        try { ctx.toast(error?.message || 'Could not save the reminders. Please try again.'); } catch {}
        try { ctx.updateState(before); } catch {}
        return false;
      } finally { saving = false; }
    };
    const result = chain.then(run, run);
    chain = result.catch(() => {});
    return result;
  }
  function tick(ctx, item) {
    if (pending.has(item.id)) { clearTimeout(pending.get(item.id)); pending.delete(item.id); return false; }
    pending.set(item.id, setTimeout(() => {
      pending.delete(item.id);
      commit(ctx, items => setDone(items, item.id, true), { wait: true });
    }, TICK_DELAY_MS));
    return true;
  }

  // ---- DOM ---------------------------------------------------------------------
  function checkIcon() {
    const svg = document.createElementNS(SVG, 'svg'); svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(SVG, 'path'); path.setAttribute('d', 'M6.5 12.5l3.7 3.7 7.3-8'); svg.append(path); return svg;
  }
  function crossIcon() {
    const svg = document.createElementNS(SVG, 'svg'); svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(SVG, 'path'); path.setAttribute('d', 'M7 7l10 10M17 7L7 17'); svg.append(path); return svg;
  }
  function setChecked(row, checked) {
    row.classList.toggle('is-ticking', checked);
    row.querySelector('.rem-check').setAttribute('aria-checked', String(checked));
  }
  function updateCount(root, items) {
    const open = openOf(items).filter(item => !pending.has(item.id)).length;
    const node = root.querySelector('.rem-count'); if (node) node.textContent = countText(open);
  }
  function rowFor(ctx, item, root, items, { deletable }) {
    const done = item.done, ticking = !done && pending.has(item.id);
    const row = ctx.el('div', `rem-row${done ? ' is-done' : ''}${ticking ? ' is-ticking' : ''}`); row.setAttribute('role', 'listitem');
    const check = ctx.el('button', 'rem-check'); check.type = 'button'; check.setAttribute('role', 'checkbox');
    check.setAttribute('aria-checked', String(done || ticking)); check.setAttribute('aria-label', `Complete ${item.text}`);
    const circle = ctx.el('span', 'rem-circle'); circle.append(checkIcon()); check.append(circle);
    check.addEventListener('click', event => {
      event.stopPropagation();
      if (done) { commit(ctx, list => setDone(list, item.id, false)); return; }
      setChecked(row, tick(ctx, item)); updateCount(root, items);
    });
    const text = ctx.el('span', 'rem-text', item.text); text.title = item.text;
    row.append(check, text);
    if (deletable) {
      const remove = ctx.el('button', 'rem-delete'); remove.type = 'button'; remove.setAttribute('aria-label', `Delete ${item.text}`); remove.title = 'Delete';
      remove.append(crossIcon());
      remove.addEventListener('click', event => { event.stopPropagation(); deleteItem(ctx, item); });
      row.append(remove);
      holdToDelete(row, text, () => deleteItem(ctx, item));
    }
    return row;
  }
  function deleteItem(ctx, item) {
    clearTimeout(pending.get(item.id)); pending.delete(item.id);
    commit(ctx, list => removeItem(list, item.id)).then(ok => { if (ok) { try { ctx.toast('Reminder deleted'); } catch {} } });
  }
  // Long-press on a row's text deletes it; moving away or lifting the finger cancels.
  function holdToDelete(row, text, fn) {
    let timer = null, startX = 0, startY = 0;
    const stop = () => { clearTimeout(timer); timer = null; };
    text.addEventListener('pointerdown', event => {
      if (event.button > 0) return;
      stop(); startX = event.clientX; startY = event.clientY;
      timer = setTimeout(() => { timer = null; fn(); }, HOLD_MS);
    });
    text.addEventListener('pointermove', event => { if (timer && Math.hypot(event.clientX - startX, event.clientY - startY) > HOLD_SLOP) stop(); });
    for (const type of ['pointerup', 'pointercancel', 'pointerleave']) text.addEventListener(type, stop);
    row.addEventListener('contextmenu', event => event.preventDefault());
  }
  function addRow(ctx, items, body) {
    const form = ctx.el('form', 'rem-add'); form.noValidate = true;
    const input = ctx.el('input', 'rem-input'); input.type = 'text'; input.maxLength = MAX_TEXT; input.placeholder = 'Add reminder';
    input.setAttribute('aria-label', 'Add reminder'); input.autocomplete = 'off'; input.spellcheck = false; input.value = draft;
    input.addEventListener('input', () => { draft = input.value; });
    input.addEventListener('keydown', event => event.stopPropagation());
    const add = ctx.el('button', 'rem-add-button', 'Add'); add.type = 'submit';
    form.addEventListener('submit', event => {
      event.preventDefault(); event.stopPropagation();
      const text = cleanText(input.value);
      if (!text) { input.focus(); return; }
      if (items.length >= MAX_ITEMS) { try { ctx.toast('You have 100 reminders. Delete one to add another.'); } catch {} return; }
      refocus = true; draft = '';
      commit(ctx, list => addItem(list, text)).then(ok => {
        if (!ok) draft = text;
        const again = body.querySelector('.rem-input');
        if (refocus && again && !again.value) { again.focus(); if (!ok) { again.value = text; } }
        refocus = false;
      });
    });
    form.addEventListener('click', event => event.stopPropagation());
    form.append(input, add);
    return form;
  }
  function emptyState(ctx, kind, allDone) {
    const box = ctx.el('div', 'rem-empty');
    box.append(ctx.el('strong', 'rem-empty-title', allDone ? 'All done' : 'No reminders'),
      ctx.el('span', 'rem-empty-note', allDone ? 'Nothing left to do.' : kind === 'large' ? 'Add one below.' : 'Add one in the Large size or tap to open.'));
    return box;
  }
  function render(body, ctx) {
    const items = itemsOf(ctx.state().config.reminders), shown = view(items, ctx.size), kind = shown.size;
    const root = ctx.el('div', 'rem-widget'); root.dataset.size = kind;
    const head = ctx.el('div', 'rem-head');
    head.append(ctx.el('h3', 'rem-title', 'Reminders'));
    if (kind === 'large' && shown.done.length) {
      const clear = ctx.el('button', 'rem-clear', 'Clear completed'); clear.type = 'button';
      clear.addEventListener('click', event => { event.stopPropagation(); commit(ctx, clearDone); });
      head.append(clear);
    }
    head.append(ctx.el('strong', 'rem-count', countText(shown.open.filter(item => !pending.has(item.id)).length)));
    root.append(head);
    const rows = [...shown.shownOpen, ...shown.shownDone];
    if (!rows.length) root.append(emptyState(ctx, kind, items.length > 0));
    else {
      const list = ctx.el('div', 'rem-list'); list.setAttribute('role', 'list'); list.setAttribute('aria-label', 'Reminders');
      for (const item of rows) list.append(rowFor(ctx, item, root, items, { deletable: kind === 'large' }));
      root.append(list);
    }
    if (shown.hidden > 0) root.append(ctx.el('span', 'rem-more', moreText(shown.hidden)));
    if (kind === 'large') root.append(addRow(ctx, items, body));
    body.append(root);
  }
  function signature(ctx) { return [ctx.state().config.reminders, ctx.size]; }

  window.EdgeWidgets = window.EdgeWidgets || {};
  window.EdgeWidgets.reminders = Object.freeze({ render, signature,
    helpers: Object.freeze({ cleanText, makeId, view, addItem, setDone, removeItem, clearDone, itemsOf, openOf, doneOf, countText, moreText, sizeOf, LIMITS, MAX_ITEMS, MAX_TEXT, TICK_DELAY_MS }) });
})();
