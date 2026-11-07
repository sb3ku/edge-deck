(() => {
  'use strict';
  // Control Center-style card: output/microphone mute, system volume and the
  // Windows default playback and recording devices.
  const views = new WeakMap();
  const paths = {
    speaker: ['M11 5 6 9H3v6h3l5 4Z', 'M15.5 8.5a5 5 0 0 1 0 7', 'M18.5 5.5a9 9 0 0 1 0 13'],
    muted: ['M11 5 6 9H3v6h3l5 4Z', 'm16 9 6 6', 'm22 9-6 6'],
    mic: ['M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z', 'M5 11a7 7 0 0 0 14 0', 'M12 18v3'],
    micOff: ['M15 9.3V6a3 3 0 0 0-5.7-1.3', 'M9 9v3a3 3 0 0 0 5.1 2.1', 'M19 11a7 7 0 0 1-1.2 3.9', 'M5 11a7 7 0 0 0 11 5.7', 'M12 18v3', 'm3 3 18 18'],
    headphones: ['M4 15v-3a8 8 0 0 1 16 0v3', 'M4 15h3v6H5a1 1 0 0 1-1-1Z', 'M20 15h-3v6h2a1 1 0 0 0 1-1Z'],
    display: ['M3 4h18v12H3Z', 'M9 20h6', 'M12 16v4'],
    speakers: ['M6 3h12v18H6Z', 'M12 15.5a2.5 2.5 0 1 0 0-.1', 'M12 7h0'],
    digital: ['M4 8h16v8H4Z', 'M8 12h0', 'M12 12h0', 'M16 12h0'],
    check: ['m5 12 5 5L20 7'],
  };
  function el(tag, className = '', text) {
    const node = document.createElement(tag); if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text); return node;
  }
  function icon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
    for (const d of paths[name]) { const p = document.createElementNS(svg.namespaceURI, 'path'); p.setAttribute('d', d); svg.append(p); }
    return svg;
  }
  function safe(value, fallback = 'That action could not be completed. Please try again.') {
    const text = typeof value === 'string' ? value : value?.message;
    return typeof text === 'string' && text.length <= 300 ? text : fallback;
  }
  // "Headphones (3mk Fuego)" -> { name: '3mk Fuego', kind: 'Headphones' }
  function describe(device) {
    const raw = String(device?.name || 'Audio device');
    const match = /^(.*?)\s*\((.+)\)$/.exec(raw);
    const kind = match ? match[1] : '', name = match ? match[2] : raw;
    const text = raw.toLowerCase();
    const symbol = /headphone|headset|earbud|buds|airpods|blackshark|fuego/.test(text) ? 'headphones'
      : /nvidia|hdmi|displayport|monitor|odyssey|lg|tv|display/.test(text) ? 'display'
        : /digital|spdif|optical/.test(text) ? 'digital' : 'speakers';
    return { name: name.replace(/\s+(High Definition Audio|USB2?\.0 Audio)$/i, ''), kind: [kind, match && /NVIDIA/i.test(name) ? 'HDMI / DisplayPort' : ''].filter(Boolean).join(' · '), symbol };
  }
  function snapshot(view) { return view.context.getState() || {}; }
  function mounted(view) { return view.root?.isConnected && views.get(view.container) === view; }
  async function send(view, key, action, value, optimistic) {
    if (view.pending[key]) return;
    if (typeof view.context.bridge?.media !== 'function') { view.context.toast?.('Quick actions are available in the desktop app.'); return; }
    view.pending[key] = optimistic ?? true; update(view);
    try {
      const media = await view.context.bridge.media(action, value);
      if (media && typeof media === 'object') {
        if (media.config) view.context.updateState(media); else view.context.updateState({ ...snapshot(view), media });
      }
    } catch (error) { view.context.toast?.(safe(error)); }
    finally { delete view.pending[key]; if (mounted(view)) update(view); }
  }
  function tile(view, key, label) {
    const node = el('button', 'qa-tile'); node.type = 'button'; node.setAttribute('role', 'switch');
    const glyph = el('span', 'qa-tile-glyph'); const copy = el('span', 'qa-tile-copy');
    const title = el('span', 'qa-tile-title', label); const status = el('span', 'qa-tile-status'); copy.append(title, status);
    node.append(glyph, copy);
    node.addEventListener('click', () => {
      const audio = snapshot(view).media?.audio || {}; const field = key === 'output' ? 'outputMuted' : 'inputMuted';
      if (typeof audio[field] !== 'boolean') return;
      send(view, key, key === 'output' ? 'mute-output' : 'mute-input', !audio[field], { muted: !audio[field] });
    });
    return { node, glyph, status, symbol: '' };
  }
  function build(view) {
    const root = el('section', 'quick-actions'); root.setAttribute('aria-label', 'Quick actions'); view.root = root;
    const tiles = el('div', 'qa-tiles'); const output = tile(view, 'output', 'Sound'); const input = tile(view, 'input', 'Microphone');
    tiles.append(output.node, input.node);
    const volume = el('label', 'qa-volume'); const volumeIcon = el('span', 'qa-volume-icon'); volumeIcon.append(icon('speaker'));
    const range = el('input'); range.type = 'range'; range.min = '0'; range.max = '100'; range.step = '1'; range.setAttribute('aria-label', 'System volume');
    const volumeValue = el('span', 'qa-volume-value');
    range.addEventListener('pointerdown', () => { view.dragging = true; });
    range.addEventListener('input', () => { range.style.setProperty('--fill', `${range.value}%`); volumeValue.textContent = `${range.value}%`; });
    range.addEventListener('change', async () => {
      view.dragging = false; view.volumeTarget = Number(range.value);
      if (view.volumeSending) return; view.volumeSending = true;
      try {
        while (view.volumeTarget !== null) {
          const target = view.volumeTarget; view.volumeTarget = null;
          const media = await view.context.bridge.media('volume', target);
          if (media && !media.config) view.context.updateState({ ...snapshot(view), media });
        }
      } catch (error) { view.context.toast?.(safe(error)); }
      finally { view.volumeSending = false; view.volumeTarget = null; if (mounted(view)) update(view); }
    });
    range.addEventListener('pointercancel', () => { view.dragging = false; update(view); });
    volume.append(volumeIcon, range, volumeValue);
    const segments = el('div', 'qa-segments'); segments.setAttribute('role', 'tablist'); segments.setAttribute('aria-label', 'Audio devices');
    const tabs = {};
    for (const [flow, label] of [['outputs', 'Output'], ['inputs', 'Input']]) {
      const tab = el('button', 'qa-segment', label); tab.type = 'button'; tab.setAttribute('role', 'tab');
      tab.addEventListener('click', () => { view.flow = flow; update(view); }); tabs[flow] = tab; segments.append(tab);
    }
    const list = el('div', 'qa-devices'); list.setAttribute('role', 'radiogroup');
    const note = el('p', 'qa-note');
    root.append(tiles, volume, segments, list, note);
    view.nodes = { output, input, range, volumeValue, volumeIcon, tabs, list, note };
    view.rows = new Map(); view.container.replaceChildren(root);
  }
  function deviceRow(view, device) {
    const node = el('button', 'qa-device'); node.type = 'button'; node.setAttribute('role', 'radio');
    const glyph = el('span', 'qa-device-glyph'); const copy = el('span', 'qa-device-copy');
    const name = el('span', 'qa-device-name'); const kind = el('span', 'qa-device-kind'); copy.append(name, kind);
    const mark = el('span', 'qa-device-check'); mark.append(icon('check'));
    node.append(glyph, copy, mark);
    const row = { node, glyph, name, kind, device, symbol: '' };
    node.addEventListener('click', () => {
      if (row.device.isDefault) return;
      const flow = row.flow;
      send(view, flow, flow === 'outputs' ? 'audio-output' : 'audio-input', row.device.id, { selected: row.device.id });
    });
    return row;
  }
  function update(view) {
    if (!view.nodes) return;
    const n = view.nodes; const media = snapshot(view).media || {}; const audio = media.audio || {};
    for (const [key, node, field, on, off] of [['output', n.output, 'outputMuted', 'speaker', 'muted'], ['input', n.input, 'inputMuted', 'mic', 'micOff']]) {
      const pending = view.pending[key];
      const muted = typeof pending?.muted === 'boolean' ? pending.muted : audio[field];
      const known = typeof muted === 'boolean';
      const symbol = known && muted ? off : on;
      if (node.symbol !== symbol) { node.glyph.replaceChildren(icon(symbol)); node.symbol = symbol; }
      node.node.setAttribute('aria-checked', String(known && !muted));
      node.node.classList.toggle('is-on', known && !muted); node.node.classList.toggle('is-muted', known && muted);
      node.node.disabled = !known || !!pending;
      const current = (audio[key === 'output' ? 'outputs' : 'inputs'] || []).find(device => device.isDefault);
      node.status.textContent = !known ? 'Unavailable' : muted ? 'Muted' : current ? describe(current).name : 'On';
    }
    const volumeKnown = Number.isFinite(media.volume);
    n.range.disabled = !volumeKnown || typeof view.context.bridge?.media !== 'function';
    if (!view.dragging && !view.volumeSending && document.activeElement !== n.range) n.range.value = String(volumeKnown ? Math.round(media.volume) : 0);
    n.range.style.setProperty('--fill', `${n.range.value}%`); n.volumeValue.textContent = volumeKnown ? `${n.range.value}%` : '—';
    const volumeSymbol = audio.outputMuted || Number(n.range.value) === 0 ? 'muted' : 'speaker';
    if (view.volumeSymbol !== volumeSymbol) { n.volumeIcon.replaceChildren(icon(volumeSymbol)); view.volumeSymbol = volumeSymbol; }
    for (const [flow, tab] of Object.entries(n.tabs)) { tab.setAttribute('aria-selected', String(view.flow === flow)); tab.tabIndex = view.flow === flow ? 0 : -1; }
    const devices = Array.isArray(audio[view.flow]) ? audio[view.flow] : [];
    const pending = view.pending[view.flow];
    const keep = new Set();
    devices.forEach((device, index) => {
      const key = `${view.flow}:${device.id}`; let row = view.rows.get(key);
      if (!row) { row = deviceRow(view, device); view.rows.set(key, row); }
      keep.add(key); row.device = device; row.flow = view.flow;
      const info = describe(device); row.name.textContent = info.name; row.kind.textContent = info.kind || (view.flow === 'outputs' ? 'Output' : 'Input');
      if (row.symbol !== info.symbol) { row.glyph.replaceChildren(icon(view.flow === 'inputs' ? 'mic' : info.symbol)); row.symbol = info.symbol; }
      const selected = pending?.selected ? pending.selected === device.id : device.isDefault;
      row.node.setAttribute('aria-checked', String(selected)); row.node.classList.toggle('is-selected', selected);
      row.node.classList.toggle('is-pending', pending?.selected === device.id);
      row.node.disabled = !!pending;
      if (n.list.children[index] !== row.node) n.list.insertBefore(row.node, n.list.children[index] || null);
    });
    for (const [key, row] of view.rows) if (!keep.has(key)) { row.node.remove(); view.rows.delete(key); }
    const message = audio.error ? 'Windows audio devices could not be read.' : !devices.length ? (media.audio ? `No ${view.flow === 'outputs' ? 'playback' : 'recording'} devices are active.` : 'Connecting to Windows audio…') : '';
    n.note.textContent = message; n.note.hidden = !message;
  }
  function render(container, context) {
    let view = views.get(container);
    if (!view) { view = { container, context, flow: 'outputs', pending: {}, dragging: false, volumeSending: false, volumeTarget: null }; views.set(container, view); }
    view.context = context;
    if (!view.root || view.root.parentElement !== container) build(view);
    update(view); return true;
  }
  window.EdgeQuickActions = Object.freeze({ render });
})();
