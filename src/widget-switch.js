(() => {
  'use strict';
  // Switch widget: one quick control (Wi-Fi, Bluetooth, sound, microphone, dark
  // mode or Night light), a Quick controls tile grown into its own card.
  // Small is one big switch; Medium adds the control's detail and a settings
  // button; Large and Tall add the network or device list under it. Lists are
  // fetched here and cached per control, so several Switch cards share them.
  const LABELS = { wifi: 'Wi-Fi', bluetooth: 'Bluetooth', sound: 'Sound', mic: 'Microphone', dark: 'Dark mode', night: 'Night light' };
  const PAGES = { wifi: 'wifi', bluetooth: 'bluetooth', sound: 'sound', mic: 'sound', dark: 'personalize', night: 'nightlight' };
  const OFFLINE = 'Quick controls are available in the desktop app.';
  const OFFLINE_LISTS = { wifi: 'Networks are listed in the desktop app.', bluetooth: 'Devices are listed in the desktop app.' };
  const ROW = 56, GAP = 6, MORE = 26, TOP_GAP = 14; // list geometry, matched by the CSS
  const paths = {
    speaker: ['M11 5 6 9H3v6h3l5 4Z', 'M15.5 8.5a5 5 0 0 1 0 7', 'M18.5 5.5a9 9 0 0 1 0 13'],
    muted: ['M11 5 6 9H3v6h3l5 4Z', 'm16 9 6 6', 'm22 9-6 6'],
    mic: ['M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z', 'M5 11a7 7 0 0 0 14 0', 'M12 18v3'],
    micOff: ['M15 9.3V6a3 3 0 0 0-5.7-1.3', 'M9 9v3a3 3 0 0 0 5.1 2.1', 'M19 11a7 7 0 0 1-1.2 3.9', 'M5 11a7 7 0 0 0 11 5.7', 'M12 18v3', 'm3 3 18 18'],
    headphones: ['M4 15v-3a8 8 0 0 1 16 0v3', 'M4 15h3v6H5a1 1 0 0 1-1-1Z', 'M20 15h-3v6h2a1 1 0 0 0 1-1Z'],
    display: ['M3 4h18v12H3Z', 'M9 20h6', 'M12 16v4'],
    speakers: ['M6 3h12v18H6Z', 'M12 15.5a2.5 2.5 0 1 0 0-.1', 'M12 7h0'],
    digital: ['M4 8h16v8H4Z', 'M8 12h0', 'M12 12h0', 'M16 12h0'],
    gamepad: ['M6 9h12a4 4 0 0 1 3.8 5.2l-1 3a2 2 0 0 1-3.4.7L15 15H9l-2.4 2.9a2 2 0 0 1-3.4-.7l-1-3A4 4 0 0 1 6 9Z', 'M8 11v3M6.5 12.5h3', 'M16 12h0M18 13.5h0'],
    check: ['m5 12 5 5L20 7'],
    chevron: ['m9 6 6 6-6 6'],
    wifi: ['M2 8.5a15 15 0 0 1 20 0', 'M5 12a10 10 0 0 1 14 0', 'M8.5 15.5a5 5 0 0 1 7 0', 'M12 19h0'],
    wifiOff: ['M2 8.5a15 15 0 0 1 20 0', 'M5 12a10 10 0 0 1 14 0', 'M8.5 15.5a5 5 0 0 1 7 0', 'M12 19h0', 'm3 3 18 18'],
    bluetooth: ['m7 7 10 10-5 4V3l5 4L7 17'],
    moon: ['M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z'],
    sun: ['M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z', 'M12 2v2', 'M12 20v2', 'M4.9 4.9l1.4 1.4', 'M17.7 17.7l1.4 1.4', 'M2 12h2', 'M20 12h2', 'M4.9 19.1l1.4-1.4', 'M17.7 6.3l1.4-1.4'],
    night: ['M12 3v2', 'M5.6 5.6l1.4 1.4', 'M3 12h2', 'M19 12h2', 'M17 7l1.4-1.4', 'M6 16a6 6 0 1 1 12 0', 'M3 20h18'],
  };
  const views = new Map(); // item id -> { body, ctx, pending, armed, timer, ... }
  const lists = new Map(); // 'wifi' | 'bluetooth' -> { items, error, at, loading }

  // ---- Pure helpers (exposed for tests) ---------------------------------------
  function safe(value, fallback = 'That action could not be completed. Please try again.') {
    const text = typeof value === 'string' ? value : value?.message;
    return typeof text === 'string' && text.length <= 300 ? text : fallback;
  }
  // "Headphones (3mk Fuego)" -> { name: '3mk Fuego', kind: 'Headphones', symbol: 'headphones' }
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
  function shortName(name) { return describe({ name }).name; }
  // A cached list ({ items }) or a bare array; null while nothing has arrived.
  function entries(list) { return Array.isArray(list) ? list : Array.isArray(list?.items) ? list.items : null; }
  function orderNetworks(list) {
    return (Array.isArray(list) ? list : []).filter(n => n && typeof n.ssid === 'string' && n.ssid)
      .sort((a, b) => (b.connected === true) - (a.connected === true) || (b.saved === true) - (a.saved === true) || (Number(b.signal) || 0) - (Number(a.signal) || 0) || a.ssid.localeCompare(b.ssid));
  }
  function orderDevices(list) {
    return (Array.isArray(list) ? list : []).filter(d => d && typeof d.name === 'string' && d.name)
      .sort((a, b) => (b.connected === true) - (a.connected === true) || a.name.localeCompare(b.name));
  }
  function plural(count, word, tail = '') { return `${count} ${word}${count === 1 ? '' : 's'}${tail}`; }
  function radioStatus(value, ready) { return typeof value !== 'boolean' ? (ready ? 'Not available' : 'Checking…') : value ? 'On' : 'Off'; }
  function percent(value) { return `${Math.max(0, Math.min(100, Math.round(Number(value) || 0)))}%`; }
  // The state as it will be once pending actions land, so a tap shows at once.
  function withPending(controls, audio, pending = {}) {
    const c = { ...(controls || {}) }, a = audio && typeof audio === 'object' ? { ...audio } : audio;
    for (const key of ['wifi', 'bluetooth', 'dark']) if (typeof pending[key]?.value === 'boolean') c[key] = pending[key].value;
    if (a) {
      if (typeof pending.output?.muted === 'boolean') a.outputMuted = pending.output.muted;
      if (typeof pending.input?.muted === 'boolean') a.inputMuted = pending.input.muted;
    }
    return { controls: c, audio: a };
  }
  // What the big switch shows: { on, known, muted, symbol, status }.
  function statusFor(control, controls, audio, cache = {}) {
    const c = controls || {}, a = audio || {};
    if (control === 'wifi' || control === 'bluetooth' || control === 'dark') {
      const value = c[control], known = typeof value === 'boolean';
      const current = control === 'wifi' && value === true ? (entries(cache.wifi) || []).find(n => n?.connected)?.ssid : '';
      const symbol = control === 'wifi' ? (value === false ? 'wifiOff' : 'wifi') : control === 'bluetooth' ? 'bluetooth' : value === false ? 'sun' : 'moon';
      return { on: known && value, known, muted: false, symbol, status: known && value && current ? current : radioStatus(value, c.ready) };
    }
    if (control === 'sound' || control === 'mic') {
      const output = control === 'sound', muted = output ? a.outputMuted : a.inputMuted, known = typeof muted === 'boolean';
      const current = (Array.isArray(a[output ? 'outputs' : 'inputs']) ? a[output ? 'outputs' : 'inputs'] : []).find(d => d?.isDefault);
      return { on: known && !muted, known, muted: known && muted, symbol: known && muted ? (output ? 'muted' : 'micOff') : output ? 'speaker' : 'mic',
        status: !known ? (audio ? 'Unavailable' : 'Checking…') : muted ? 'Muted' : current ? describe(current).name : 'On' };
    }
    return { on: false, known: true, muted: false, symbol: 'night', status: 'Settings' };
  }
  // The Medium detail column: { title, lines, art? }.
  function detailFor(control, controls, audio, cache = {}) {
    const c = controls || {}, a = audio || {};
    const unknown = value => ({ title: radioStatus(value, c.ready), lines: [c.ready ? 'Not supported on this PC' : 'Reading Windows settings…'] });
    if (control === 'wifi') {
      if (typeof c.wifi !== 'boolean') return unknown(c.wifi);
      if (!c.wifi) return { title: 'Wi-Fi is off', lines: ['Turn it on to see networks'] };
      const items = entries(cache.wifi);
      if (!items) return cache.wifi?.error ? { title: 'Networks could not be read', lines: [cache.wifi.error] } : { title: 'Looking for networks…', lines: [] };
      const current = items.find(n => n?.connected), saved = items.filter(n => n?.saved).length;
      return { title: current?.ssid || 'Not connected', lines: [current ? `Signal ${percent(current.signal)}` : plural(items.length, 'network', ' in range'), plural(saved, 'saved network')] };
    }
    if (control === 'bluetooth') {
      if (typeof c.bluetooth !== 'boolean') return unknown(c.bluetooth);
      if (!c.bluetooth) return { title: 'Bluetooth is off', lines: ['Turn it on to connect devices'] };
      const items = entries(cache.bluetooth);
      if (!items) return cache.bluetooth?.error ? { title: 'Devices could not be read', lines: [cache.bluetooth.error] } : { title: 'Looking for devices…', lines: [] };
      const names = orderDevices(items).filter(d => d.connected).map(d => d.name);
      if (!names.length) return { title: 'No devices connected', lines: [items.length ? plural(items.length, 'paired device') : 'Pair one in Bluetooth settings'] };
      return { title: names[0], lines: names.length === 1 ? ['Connected'] : [names.slice(1, 3).join(', ') + (names.length > 3 ? ` +${names.length - 3}` : ''), `${names.length} devices connected`] };
    }
    if (control === 'sound' || control === 'mic') {
      if (!audio) return { title: 'Checking…', lines: ['Reading Windows audio…'] };
      const output = control === 'sound', devices = Array.isArray(a[output ? 'outputs' : 'inputs']) ? a[output ? 'outputs' : 'inputs'] : [];
      const current = devices.find(d => d?.isDefault), muted = output ? a.outputMuted : a.inputMuted;
      if (!current) return { title: output ? 'No output device' : 'No microphone', lines: [a.error ? 'Windows audio devices could not be read' : `No ${output ? 'playback' : 'recording'} devices are active`] };
      const info = describe(current), lines = [info.kind || (output ? 'Output' : 'Input')];
      if (!output) lines.push(typeof muted !== 'boolean' ? 'Unavailable' : muted ? 'Muted' : 'Not muted');
      return { title: info.name, lines };
    }
    if (control === 'dark') {
      if (typeof c.dark !== 'boolean') return { ...unknown(c.dark), art: 'dark' };
      return c.dark ? { title: 'Dark theme', lines: ['Windows apps use the dark theme'], art: 'dark' } : { title: 'Light theme', lines: ['Windows apps use the light theme'], art: 'light' };
    }
    return { title: 'Warmer colours', lines: ['Schedule and strength are in Windows settings'], art: 'night' };
  }
  // The Large and Tall list: { rows, note, loading? }. A row's action is what a
  // tap does; `loading` marks a list that is on its way (its place stays put).
  function rowsFor(control, controls, audio, cache = {}, armed = null, pending = {}) {
    const c = controls || {}, a = audio || {};
    if (control === 'wifi') {
      if (typeof c.wifi !== 'boolean') return { rows: [], note: '' };
      if (!c.wifi) return { rows: [], note: 'Wi-Fi is off.' };
      const items = entries(cache.wifi);
      if (!items) return cache.wifi?.error ? { rows: [], note: cache.wifi.error } : { rows: [], note: 'Looking for networks…', loading: true };
      if (!items.length) return { rows: [], note: 'No networks found.' };
      return { note: '', rows: orderNetworks(items).map(n => {
        const status = n.connected ? 'Connected' : n.saved ? 'Saved' : n.secure ? 'Secured' : 'Open', isArmed = !!n.connected && armed === n.ssid;
        return { key: `wifi:${n.ssid}`, symbol: 'wifi', title: n.ssid, subtitle: `${status} · ${percent(n.signal)}`, selected: !!n.connected, pending: !!pending[`wifi:${n.ssid}`],
          action: n.connected ? 'disconnect' : n.saved ? 'connect' : 'settings', armed: isArmed, trailing: n.connected ? (isArmed ? 'Disconnect' : '') : undefined };
      }) };
    }
    if (control === 'bluetooth') {
      if (typeof c.bluetooth !== 'boolean') return { rows: [], note: '' };
      if (!c.bluetooth) return { rows: [], note: 'Bluetooth is off.' };
      const items = entries(cache.bluetooth);
      if (!items) return cache.bluetooth?.error ? { rows: [], note: cache.bluetooth.error } : { rows: [], note: 'Looking for devices…', loading: true };
      if (!items.length) return { rows: [], note: 'No paired devices. Pair one in Bluetooth settings.' };
      return { note: '', rows: orderDevices(items).map(d => ({ key: `bt:${d.name}`, symbol: d.kind === 'AudioVideo' ? 'headphones' : d.kind === 'Peripheral' ? 'gamepad' : 'bluetooth',
        title: d.name, subtitle: d.connected ? 'Connected' : 'Paired', selected: !!d.connected, pending: false, action: 'settings' })) };
    }
    if (control === 'sound' || control === 'mic') {
      const output = control === 'sound', flow = output ? 'outputs' : 'inputs';
      const devices = (Array.isArray(a[flow]) ? a[flow] : []).filter(d => d && d.id !== undefined && d.id !== null);
      if (!devices.length) return { rows: [], note: a.error ? 'Windows audio devices could not be read.' : `No ${output ? 'playback' : 'recording'} devices are active.` };
      const picked = pending[flow]?.selected ?? null;
      return { note: '', rows: devices.map(d => {
        const info = describe(d), selected = picked !== null ? picked === d.id : !!d.isDefault;
        return { key: `${flow}:${d.id}`, id: d.id, flow, symbol: output ? info.symbol : 'mic', title: info.name, subtitle: info.kind || (output ? 'Output' : 'Input'),
          selected, check: selected, pending: picked === d.id, action: d.isDefault ? 'none' : 'select' };
      }) };
    }
    return { rows: [], note: '' };
  }
  // What assistive tech hears for a row: what it is, and what a tap does.
  function rowLabel(control, row) {
    const flow = row.flow === 'inputs' ? 'microphone' : 'output';
    if (row.action === 'none') return `${row.title}, ${row.subtitle}, current ${flow}`;
    if (row.action === 'select') return `Use ${row.title} as the ${flow}`;
    if (row.action === 'settings') return `${row.title}, ${row.subtitle.toLowerCase()}. Opens ${LABELS[control]} settings`;
    if (row.action === 'disconnect') return row.armed ? `Disconnect from ${row.title}` : `${row.title}, ${row.subtitle.toLowerCase()}. Tap twice to disconnect`;
    return `Connect to ${row.title}, ${row.subtitle.toLowerCase()}`;
  }
  // Which list a card needs and how often: the Wi-Fi name on a Small card once a
  // minute, the detail and the lists every 10 s. Nothing while the radio is off
  // or missing: the service would only fail, and the card already says why.
  function listPlan(control, variant, controls) {
    if (controls?.[control] !== true) return null;
    if (control === 'wifi') return { kind: 'wifi', period: variant === 'small' ? 60000 : 10000 };
    if (control === 'bluetooth' && variant !== 'small') return { kind: 'bluetooth', period: 10000 };
    return null;
  }
  // How many rows fit in `room` px (gaps included); when more exist the last
  // slot becomes the "+n more" line. Without a measurement, `fallback` rows fit.
  function fitRows(room, count, fallback = 5) {
    const space = room > 0 ? room : fallback * (ROW + GAP) - GAP;
    if (count <= Math.floor((space + GAP) / (ROW + GAP))) return { shown: count, more: 0 };
    const shown = Math.max(0, Math.floor((space - MORE) / (ROW + GAP)));
    return { shown, more: count - shown };
  }

  // ---- DOM helpers ---------------------------------------------------------------
  function el(tag, className = '', text) {
    const node = document.createElement(tag); if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text); return node;
  }
  function icon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
    for (const d of paths[name] || []) { const p = document.createElementNS(svg.namespaceURI, 'path'); p.setAttribute('d', d); svg.append(p); }
    return svg;
  }
  function controlOf(ctx) { return LABELS[ctx.item?.control] ? ctx.item.control : 'wifi'; }
  // Widgets mode draws each size; every other mode gets the Medium layout.
  function variantFor(ctx) { const size = ctx.mode === 'widgets' ? ctx.size : 'medium'; return size === 'small' || size === 'large' || size === 'tall' ? size : 'medium'; }
  function mounted(view) { return !!view.body?.isConnected && views.get(view.id) === view; }
  function drop(view) { clearInterval(view.timer); clearTimeout(view.armTimer); view.observer?.disconnect(); view.timer = 0; views.delete(view.id); }
  // The list fit depends on the body's height, which can change without the
  // state changing (edit mode, a window resize), so a height change redraws.
  function watch(view) {
    if (typeof ResizeObserver !== 'function' || view.watched === view.body) return;
    view.observer?.disconnect();
    view.watched = view.body; view.height = view.body.clientHeight;
    view.observer = new ResizeObserver(() => {
      if (!mounted(view)) { drop(view); return; }
      const height = view.body.clientHeight, changed = height !== view.height; view.height = height;
      if (changed && height > 0 && !view.dragging) draw(view);
    });
    view.observer.observe(view.body);
  }
  function cache() { return { wifi: lists.get('wifi'), bluetooth: lists.get('bluetooth') }; }

  // ---- Actions -------------------------------------------------------------------
  async function system(view, key, action, value) {
    if (view.pending[key]) return;
    if (typeof view.ctx.bridge?.systemControl !== 'function') { view.ctx.toast?.(OFFLINE); return; }
    view.pending[key] = { value: typeof value === 'boolean' ? value : null }; draw(view);
    try { const next = await view.ctx.bridge.systemControl(action, value); if (next?.config) view.ctx.updateState(next); }
    catch (error) { view.ctx.toast?.(safe(error)); }
    finally { delete view.pending[key]; if (mounted(view)) draw(view); }
  }
  async function media(view, key, action, value, optimistic) {
    if (view.pending[key]) return;
    if (typeof view.ctx.bridge?.media !== 'function') { view.ctx.toast?.(OFFLINE); return; }
    view.pending[key] = optimistic || { value }; draw(view);
    try {
      const next = await view.ctx.bridge.media(action, value);
      if (next && typeof next === 'object') view.ctx.updateState(next.config ? next : { ...(view.ctx.state() || {}), media: next });
    } catch (error) { view.ctx.toast?.(safe(error)); }
    finally { delete view.pending[key]; if (mounted(view)) draw(view); }
  }
  function settings(view, control) { const page = PAGES[control]; return system(view, `settings:${page}`, 'settings', page); }
  function toggle(view, control) {
    const state = view.ctx.state() || {}, c = state.controls || {}, a = state.media?.audio || {}, bridge = view.ctx.bridge || {};
    if (control === 'night') { system(view, 'nightlight', 'nightlight'); return; }
    if (control === 'sound' || control === 'mic') {
      const output = control === 'sound', muted = output ? a.outputMuted : a.inputMuted;
      if (typeof muted !== 'boolean' && typeof bridge.media === 'function') return;
      media(view, output ? 'output' : 'input', output ? 'mute-output' : 'mute-input', !muted, { muted: !muted }); return;
    }
    const on = c[control];
    if (typeof on !== 'boolean' && typeof bridge.systemControl === 'function') return;
    system(view, control, control, !on);
  }
  function rowAction(view, control, row) {
    if (row.action === 'settings') settings(view, control);
    else if (row.action === 'connect') system(view, row.key, 'wifi-connect', row.title).then(() => loadList(view, 'wifi'));
    else if (row.action === 'select') media(view, row.flow, row.flow === 'outputs' ? 'audio-output' : 'audio-input', row.id, { selected: row.id });
    else if (row.action === 'disconnect') {
      clearTimeout(view.armTimer);
      if (view.armed !== row.title) { // first tap arms, the second disconnects
        view.armed = row.title; view.armTimer = setTimeout(() => { view.armed = null; if (mounted(view)) draw(view); }, 5000); draw(view); return;
      }
      view.armed = null; system(view, row.key, 'wifi-disconnect').then(() => loadList(view, 'wifi'));
    }
  }

  // ---- Lists -----------------------------------------------------------------------
  function listFor(kind) { let entry = lists.get(kind); if (!entry) { entry = { items: null, error: '', at: 0, loading: false }; lists.set(kind, entry); } return entry; }
  async function loadList(view, kind) {
    const entry = listFor(kind), bridge = view.ctx.bridge;
    if (entry.loading) return;
    const redraw = () => { for (const other of [...views.values()]) { if (!mounted(other)) drop(other); else if (controlOf(other.ctx) === kind) draw(other); } };
    if (typeof bridge?.systemList !== 'function') { // the plain browser: say so instead of looking forever
      if (entry.error !== OFFLINE_LISTS[kind]) { entry.error = OFFLINE_LISTS[kind]; entry.at = Date.now(); redraw(); }
      return;
    }
    entry.loading = true;
    try { const items = await bridge.systemList(kind); entry.items = Array.isArray(items) ? items : []; entry.error = ''; }
    catch (error) { entry.error = safe(error); }
    finally { entry.loading = false; entry.at = Date.now(); redraw(); }
  }
  function schedule(view) {
    const control = controlOf(view.ctx), controls = view.ctx.state()?.controls, plan = listPlan(control, variantFor(view.ctx), controls), key = plan ? `${plan.kind}:${plan.period}` : '';
    if (view.planKey !== key) { clearInterval(view.timer); view.timer = 0; view.planKey = key; }
    if (OFFLINE_LISTS[control] && controls?.[control] !== true) { const stale = lists.get(control); if (stale) stale.at = 0; } // refetch as soon as the radio is back
    if (!plan) return;
    const entry = listFor(plan.kind);
    if (!entry.loading && Date.now() - entry.at >= plan.period) loadList(view, plan.kind);
    if (!view.timer) view.timer = setInterval(() => { if (!mounted(view)) drop(view); else loadList(view, plan.kind); }, plan.period);
  }

  // ---- Drawing ---------------------------------------------------------------------
  function mainButton(view, control, info, available) {
    const node = el('button', 'switch-main'); node.type = 'button'; node.dataset.key = 'main';
    if (control !== 'night') { node.setAttribute('role', 'switch'); node.setAttribute('aria-checked', String(info.on)); }
    const pending = !!view.pending[control === 'sound' ? 'output' : control === 'mic' ? 'input' : control === 'night' ? 'nightlight' : control];
    if (pending) { node.setAttribute('aria-busy', 'true'); node.disabled = true; }
    else if (!available) node.setAttribute('aria-disabled', 'true'); // a tap explains where the controls live
    else if (!info.known) node.disabled = true;
    const glyph = el('span', 'switch-glyph'); glyph.append(icon(info.symbol));
    const copy = el('span', 'switch-copy'); copy.append(el('span', 'switch-label', LABELS[control]), el('span', 'switch-status', info.status));
    node.append(glyph, copy);
    node.addEventListener('click', () => toggle(view, control));
    return node;
  }
  function moreButton(view, control, available) {
    const node = el('button', 'switch-more'); node.type = 'button'; node.dataset.key = 'more';
    node.setAttribute('aria-label', `${LABELS[control]} settings`); node.append(icon('chevron'));
    if (view.pending[`settings:${PAGES[control]}`]) { node.setAttribute('aria-busy', 'true'); node.disabled = true; }
    else if (!available) node.setAttribute('aria-disabled', 'true');
    node.addEventListener('click', () => settings(view, control));
    return node;
  }
  // Sends a volume: one request in flight, the newest value waits and goes next.
  // The slider shows the value being sent until the service confirms it.
  async function sendVolume(view, target) {
    view.volumeTarget = view.volumeShown = target;
    if (view.volumeSending) return; view.volumeSending = true;
    try {
      while (view.volumeTarget !== null) {
        const value = view.volumeTarget; view.volumeTarget = null;
        const next = await view.ctx.bridge.media('volume', value);
        if (next && typeof next === 'object') view.ctx.updateState(next.config ? next : { ...(view.ctx.state() || {}), media: next });
      }
    } catch (error) { view.ctx.toast?.(safe(error)); }
    finally { view.volumeSending = false; view.volumeTarget = view.volumeShown = null; if (mounted(view)) draw(view); }
  }
  function volumeRow(view, audio, volume, available) {
    const row = el('label', 'switch-volume'), glyph = el('span', 'switch-volume-icon'), value = el('span', 'switch-volume-value');
    const range = el('input'); range.type = 'range'; range.min = '0'; range.max = '100'; range.step = '1'; range.setAttribute('aria-label', 'System volume'); range.dataset.key = 'volume';
    const shown = view.volumeShown ?? volume, known = Number.isFinite(shown);
    range.value = String(known ? Math.round(shown) : 0); range.disabled = !known || !available;
    const paint = () => { range.style.setProperty('--fill', `${range.value}%`); value.textContent = known ? `${range.value}%` : '—'; };
    paint(); glyph.append(icon(audio?.outputMuted || Number(range.value) === 0 ? 'muted' : 'speaker'));
    // A redraw that arrived mid-drag runs once the finger lifts (after the change event has sent).
    const release = () => { view.dragging = false; if (view.redraw) { view.redraw = false; setTimeout(() => { if (!view.dragging && mounted(view)) draw(view); }, 0); } };
    range.addEventListener('pointerdown', () => { view.dragging = true; view.held = null; });
    range.addEventListener('input', () => { paint(); if (view.dragging) view.held = Number(range.value); });
    range.addEventListener('pointerup', release); range.addEventListener('pointercancel', release);
    range.addEventListener('change', () => { view.dragging = false; view.held = null; sendVolume(view, Number(range.value)); });
    row.append(glyph, range, value);
    return row;
  }
  function side(view, control, controls, audio, volume, available) {
    const node = el('div', 'switch-side'), detail = el('div', 'switch-detail'), info = detailFor(control, controls, audio, cache());
    if (info.art) { const art = el('span', `switch-art is-${info.art}`); art.append(icon(info.art === 'light' ? 'sun' : info.art === 'dark' ? 'moon' : 'night')); detail.append(art); }
    const copy = el('div', 'switch-detail-copy'); copy.append(el('span', 'switch-detail-title', info.title));
    for (const line of info.lines) copy.append(el('span', `switch-detail-line${line === 'Muted' ? ' is-muted' : ''}`, line));
    detail.append(copy, moreButton(view, control, available)); node.append(detail);
    if (control === 'sound') node.append(volumeRow(view, audio, volume, available));
    return node;
  }
  function rowButton(view, control, row, available) {
    const node = el('button', `switch-row${row.selected ? ' is-selected' : ''}${row.pending ? ' is-pending' : ''}`); node.type = 'button'; node.dataset.key = row.key;
    const glyph = el('span', 'switch-row-glyph'); glyph.append(icon(row.symbol));
    const copy = el('span', 'switch-row-copy'); copy.append(el('span', 'switch-row-title', row.title)); if (row.subtitle) copy.append(el('span', 'switch-row-subtitle', row.subtitle));
    node.append(glyph, copy);
    if (row.check) { const mark = el('span', 'switch-row-check'); mark.append(icon('check')); node.append(mark); }
    else if (row.trailing !== undefined) node.append(el('span', `switch-row-action${row.armed ? ' is-armed' : ''}`, row.trailing));
    node.setAttribute('aria-label', rowLabel(control, row));
    if (row.selected) node.setAttribute('aria-current', 'true');
    if (row.action === 'none') node.disabled = true; // the current device: shown, nothing to do
    else {
      if (row.pending) node.disabled = true; else if (!available) node.setAttribute('aria-disabled', 'true');
      node.addEventListener('click', () => rowAction(view, control, row));
    }
    return node;
  }
  function appendList(view, root, top, control, data, variant, available) {
    if (!data.rows.length) { if (data.note) root.append(el('p', 'switch-note', data.note)); return; }
    const list = el('ul', 'switch-list'); list.setAttribute('aria-label', control === 'wifi' ? 'Networks' : control === 'bluetooth' ? 'Paired devices' : control === 'sound' ? 'Output devices' : 'Microphones');
    root.append(list);
    const fit = fitRows(view.body.clientHeight - top.offsetHeight - TOP_GAP, data.rows.length, variant === 'tall' ? 6 : 5);
    for (const row of data.rows.slice(0, fit.shown)) { const item = el('li', 'switch-item'); item.append(rowButton(view, control, row, available)); list.append(item); }
    if (fit.more) list.append(el('li', 'switch-list-more', `+${fit.more} more in settings`));
  }
  function draw(view) {
    const { body, ctx } = view;
    if (view.dragging) { view.redraw = true; return; } // never rebuild under a finger on the slider
    const control = controlOf(ctx), variant = variantFor(ctx), state = ctx.state() || {};
    const { controls, audio } = withPending(state.controls, state.media?.audio, view.pending);
    const available = typeof ctx.bridge?.[control === 'sound' || control === 'mic' ? 'media' : 'systemControl'] === 'function';
    const info = statusFor(control, controls, audio, cache());
    const root = el('div', `switch-widget${available ? '' : ' is-unavailable'}`);
    root.dataset.control = control; root.dataset.variant = variant;
    root.dataset.state = !info.known ? 'unknown' : info.muted ? 'muted' : info.on ? 'on' : 'off';
    const top = el('div', 'switch-top'); top.append(mainButton(view, control, info, available));
    if (variant === 'medium' || variant === 'large') top.append(side(view, control, controls, audio, state.media?.volume, available));
    root.append(top);
    const data = variant === 'large' || variant === 'tall' ? rowsFor(control, controls, audio, cache(), view.armed, view.pending) : null;
    if (data && variant === 'large') data.note = ''; // the detail column already says why there are no rows
    // With rows (or rows on their way) the switch sits at the top; otherwise the block centres like Dark mode's.
    root.dataset.list = String(!!data && (data.rows.length > 0 || !!data.loading));
    // Focus survives a redraw: the host empties the body before a render, and a
    // control disabled while its action runs cannot take focus back, so the key
    // tracked by focusin stands in for the element that is gone or busy.
    const focused = (body.contains(document.activeElement) ? document.activeElement?.dataset?.key : '') || view.focusKey;
    root.addEventListener('focusin', event => { view.focusKey = event.target?.dataset?.key || ''; });
    root.addEventListener('focusout', event => { // Chrome fires this before removing the node, so the check waits
      const target = event.target;
      setTimeout(() => { if (target.isConnected && view.focusKey === target.dataset?.key && !root.contains(document.activeElement)) view.focusKey = ''; }, 0);
    });
    body.replaceChildren(root);
    if (data) appendList(view, root, top, control, data, variant, available);
    if (focused) body.querySelector(`[data-key="${focused.replace(/["\\]/g, '\\$&')}"]`)?.focus();
  }
  function render(body, ctx) {
    const id = String(ctx.item?.id || ctx.card?.id || 'switch');
    for (const other of [...views.values()]) if (other.id !== id && !mounted(other)) drop(other);
    let view = views.get(id);
    if (!view) { view = { id, pending: {}, armed: null, armTimer: 0, timer: 0, planKey: '', dragging: false, redraw: false, held: null, focusKey: '', volumeSending: false, volumeTarget: null, volumeShown: null }; views.set(id, view); }
    view.body = body; view.ctx = ctx; view.redraw = false; // the host has emptied the body
    // A slider taken away mid-drag never fires change: send the value it held.
    if (view.dragging) { view.dragging = false; if (Number.isFinite(view.held)) sendVolume(view, view.held); view.held = null; }
    draw(view); schedule(view); watch(view);
  }
  function signature(ctx) { const state = ctx.state() || {}; return [ctx.item?.control, state.controls, state.media?.audio, state.media?.volume]; }

  window.EdgeWidgets = window.EdgeWidgets || {};
  window.EdgeWidgets.switch = Object.freeze({ render, signature, helpers: Object.freeze({ describe, shortName, statusFor, withPending, detailFor, rowsFor, rowLabel, listPlan, orderNetworks, orderDevices, fitRows, LABELS, PAGES }) });
})();
