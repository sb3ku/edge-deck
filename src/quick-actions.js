(() => {
  'use strict';
  // Quick controls like Windows Quick Settings. Each tile toggles on a tap;
  // tiles with an arrow (›) open a detail view inside the card: Wi-Fi networks,
  // Bluetooth devices, sound output and microphone input devices. Below: system
  // volume, and Lock, Sleep, Restart and Shut down (the last two ask for a
  // second tap).
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
    gamepad: ['M6 9h12a4 4 0 0 1 3.8 5.2l-1 3a2 2 0 0 1-3.4.7L15 15H9l-2.4 2.9a2 2 0 0 1-3.4-.7l-1-3A4 4 0 0 1 6 9Z', 'M8 11v3M6.5 12.5h3', 'M16 12h0M18 13.5h0'],
    check: ['m5 12 5 5L20 7'],
    chevron: ['m9 6 6 6-6 6'],
    back: ['m15 6-6 6 6 6'],
    lockSmall: ['M7 11h10v9H7Z', 'M9 11V8a3 3 0 0 1 6 0v3'],
    wifi: ['M2 8.5a15 15 0 0 1 20 0', 'M5 12a10 10 0 0 1 14 0', 'M8.5 15.5a5 5 0 0 1 7 0', 'M12 19h0'],
    wifiOff: ['M2 8.5a15 15 0 0 1 20 0', 'M5 12a10 10 0 0 1 14 0', 'M8.5 15.5a5 5 0 0 1 7 0', 'M12 19h0', 'm3 3 18 18'],
    bluetooth: ['m7 7 10 10-5 4V3l5 4L7 17'],
    moon: ['M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z'],
    sun: ['M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z', 'M12 2v2', 'M12 20v2', 'M4.9 4.9l1.4 1.4', 'M17.7 17.7l1.4 1.4', 'M2 12h2', 'M20 12h2', 'M4.9 19.1l1.4-1.4', 'M17.7 6.3l1.4-1.4'],
    night: ['M12 3v2', 'M5.6 5.6l1.4 1.4', 'M3 12h2', 'M19 12h2', 'M17 7l1.4-1.4', 'M6 16a6 6 0 1 1 12 0', 'M3 20h18'],
    lock: ['M6 11h12v10H6Z', 'M8 11V7a4 4 0 0 1 8 0v4'],
    sleep: ['M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z', 'M15 4h4l-4 4h4'],
    restart: ['M4 12a8 8 0 1 0 2.3-5.7L4 8.6', 'M4 3v5.6h5.6'],
    power: ['M12 3v9', 'M6.3 6.3a8 8 0 1 0 11.4 0'],
  };
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
  function setIcon(node, name) { if (node.dataset.icon !== name) { node.replaceChildren(icon(name)); node.dataset.icon = name; } }

  // ---- Actions -------------------------------------------------------------
  async function media(view, key, action, value, optimistic) {
    if (view.pending[key]) return;
    if (typeof view.context.bridge?.media !== 'function') { view.context.toast?.('Quick controls are available in the desktop app.'); return; }
    view.pending[key] = optimistic ?? true; update(view);
    try {
      const next = await view.context.bridge.media(action, value);
      if (next && typeof next === 'object') { if (next.config) view.context.updateState(next); else view.context.updateState({ ...snapshot(view), media: next }); }
    } catch (error) { view.context.toast?.(safe(error)); }
    finally { delete view.pending[key]; if (mounted(view)) update(view); }
  }
  async function control(view, key, action, value) {
    if (view.pending[key]) return;
    if (typeof view.context.bridge?.systemControl !== 'function') { view.context.toast?.('Quick controls are available in the desktop app.'); return; }
    view.pending[key] = { value }; update(view);
    try { const next = await view.context.bridge.systemControl(action, value); if (next?.config) view.context.updateState(next); }
    catch (error) { view.context.toast?.(safe(error)); }
    finally { delete view.pending[key]; if (mounted(view)) update(view); }
  }
  function settings(view, page) { control(view, `settings:${page}`, 'settings', page); }
  async function loadList(view, kind) {
    if (typeof view.context.bridge?.systemList !== 'function') return;
    view.lists[kind] = view.lists[kind] || { items: null, error: '' };
    try { view.lists[kind] = { items: await view.context.bridge.systemList(kind), error: '' }; }
    catch (error) { view.lists[kind] = { items: view.lists[kind].items, error: safe(error) }; }
    if (mounted(view)) update(view);
  }
  function openDetail(view, name) {
    view.detail = name; view.armedNetwork = null; update(view);
    clearInterval(view.listTimer);
    if (name === 'wifi' || name === 'bluetooth') { loadList(view, name); view.listTimer = setInterval(() => { if (!mounted(view) || view.detail !== name) clearInterval(view.listTimer); else loadList(view, name); }, 10000); }
  }
  function closeDetail(view) { view.detail = null; clearInterval(view.listTimer); update(view); }

  // ---- Main view -------------------------------------------------------------
  // A Windows-style tile: the main part toggles; the arrow part opens details.
  function tile(view, key, label, { onToggle, onMore } = {}) {
    const node = el('div', `qa-tile${onMore ? ' has-more' : ''}`); node.dataset.key = key;
    const main = el('button', 'qa-tile-main'); main.type = 'button'; if (onToggle) main.setAttribute('role', 'switch');
    const glyph = el('span', 'qa-tile-glyph'); const copy = el('span', 'qa-tile-copy');
    const status = el('span', 'qa-tile-status'); copy.append(el('span', 'qa-tile-title', label), status); main.append(glyph, copy);
    main.addEventListener('click', () => onToggle?.());
    node.append(main);
    let more = null;
    if (onMore) { more = el('button', 'qa-tile-more'); more.type = 'button'; more.setAttribute('aria-label', `${label} options`); more.append(icon('chevron')); more.addEventListener('click', onMore); node.append(more); }
    return { node, main, more, glyph, status };
  }
  function powerButton(view, key, label, symbol) {
    const node = el('button', `qa-power qa-power-${key}`); node.type = 'button';
    const glyph = el('span', 'qa-power-glyph'); glyph.append(icon(symbol)); const text = el('span', 'qa-power-label', label);
    node.append(glyph, text); node.setAttribute('aria-label', label);
    node.addEventListener('click', () => {
      const confirmable = key === 'restart' || key === 'shutdown';
      if (confirmable && view.armed !== key) {
        view.armed = key; clearTimeout(view.armTimer);
        view.armTimer = setTimeout(() => { view.armed = null; if (mounted(view)) update(view); }, 4000);
        update(view); return;
      }
      view.armed = null; clearTimeout(view.armTimer);
      control(view, key, key, confirmable ? 'confirmed' : undefined);
    });
    return { node, text, label };
  }
  function build(view) {
    const root = el('section', 'quick-actions'); root.setAttribute('aria-label', 'Quick controls'); view.root = root;
    // Main
    const main = el('div', 'qa-main');
    const tiles = el('div', 'qa-tiles');
    const audio = () => snapshot(view).media?.audio || {};
    const controls = () => snapshot(view).controls || {};
    const t = {
      wifi: tile(view, 'wifi', 'Wi-Fi', { onToggle: () => { const on = controls().wifi; if (typeof on === 'boolean') control(view, 'wifi', 'wifi', !on); }, onMore: () => openDetail(view, 'wifi') }),
      bluetooth: tile(view, 'bluetooth', 'Bluetooth', { onToggle: () => { const on = controls().bluetooth; if (typeof on === 'boolean') control(view, 'bluetooth', 'bluetooth', !on); }, onMore: () => openDetail(view, 'bluetooth') }),
      sound: tile(view, 'output', 'Sound', { onToggle: () => { const muted = audio().outputMuted; if (typeof muted === 'boolean') media(view, 'output', 'mute-output', !muted, { muted: !muted }); }, onMore: () => openDetail(view, 'sound') }),
      mic: tile(view, 'input', 'Microphone', { onToggle: () => { const muted = audio().inputMuted; if (typeof muted === 'boolean') media(view, 'input', 'mute-input', !muted, { muted: !muted }); }, onMore: () => openDetail(view, 'mic') }),
      dark: tile(view, 'dark', 'Dark mode', { onToggle: () => { const on = controls().dark; if (typeof on === 'boolean') control(view, 'dark', 'dark', !on); } }),
      night: tile(view, 'nightlight', 'Night light', { onToggle: () => control(view, 'nightlight', 'nightlight') }),
    };
    tiles.append(...Object.values(t).map(item => item.node));
    const volume = el('label', 'qa-volume'); const volumeIcon = el('span', 'qa-volume-icon');
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
          const next = await view.context.bridge.media('volume', target);
          if (next && !next.config) view.context.updateState({ ...snapshot(view), media: next });
        }
      } catch (error) { view.context.toast?.(safe(error)); }
      finally { view.volumeSending = false; view.volumeTarget = null; if (mounted(view)) update(view); }
    });
    range.addEventListener('pointercancel', () => { view.dragging = false; update(view); });
    const volumeMore = el('button', 'qa-volume-more'); volumeMore.type = 'button'; volumeMore.setAttribute('aria-label', 'Choose the sound output'); volumeMore.append(icon('chevron'));
    volumeMore.addEventListener('click', event => { event.preventDefault(); openDetail(view, 'sound'); });
    volume.append(volumeIcon, range, volumeValue, volumeMore);
    const power = el('div', 'qa-power-row'); power.setAttribute('aria-label', 'Power');
    const powers = { lock: powerButton(view, 'lock', 'Lock', 'lock'), sleep: powerButton(view, 'sleep', 'Sleep', 'sleep'), restart: powerButton(view, 'restart', 'Restart', 'restart'), shutdown: powerButton(view, 'shutdown', 'Shut down', 'power') };
    power.append(...Object.values(powers).map(item => item.node));
    main.append(tiles, volume, power);
    // Detail
    const detail = el('div', 'qa-detail'); detail.hidden = true;
    const head = el('div', 'qa-detail-head');
    const back = el('button', 'qa-back'); back.type = 'button'; back.setAttribute('aria-label', 'Back'); back.append(icon('back')); back.addEventListener('click', () => closeDetail(view));
    const title = el('h3', 'qa-detail-title');
    const toggle = el('button', 'toggle qa-detail-toggle'); toggle.type = 'button'; toggle.setAttribute('role', 'switch');
    toggle.addEventListener('click', () => {
      const name = view.detail, c = controls(), a = audio();
      if (name === 'wifi' && typeof c.wifi === 'boolean') control(view, 'wifi', 'wifi', !c.wifi);
      if (name === 'bluetooth' && typeof c.bluetooth === 'boolean') control(view, 'bluetooth', 'bluetooth', !c.bluetooth);
      if (name === 'sound' && typeof a.outputMuted === 'boolean') media(view, 'output', 'mute-output', !a.outputMuted, { muted: !a.outputMuted });
      if (name === 'mic' && typeof a.inputMuted === 'boolean') media(view, 'input', 'mute-input', !a.inputMuted, { muted: !a.inputMuted });
    });
    head.append(back, title, toggle);
    const list = el('div', 'qa-list'); list.setAttribute('role', 'list');
    const note = el('p', 'qa-note');
    const moreSettings = el('button', 'qa-more-settings'); moreSettings.type = 'button';
    moreSettings.addEventListener('click', () => settings(view, { wifi: 'wifi', bluetooth: 'bluetooth', sound: 'sound', mic: 'sound' }[view.detail] || 'sound'));
    detail.append(head, list, note, moreSettings);
    root.append(main, detail);
    view.nodes = { main, tiles: t, range, volumeValue, volumeIcon, powers, detail, title, toggle, list, note, moreSettings };
    view.container.replaceChildren(root);
  }

  // ---- Detail rows ----------------------------------------------------------
  function row(symbol, title, subtitle, { selected = false, pending = false, action = null, trailing = null } = {}) {
    const node = el('button', `qa-row${selected ? ' is-selected' : ''}${pending ? ' is-pending' : ''}`); node.type = 'button'; node.setAttribute('role', 'listitem');
    const glyph = el('span', 'qa-row-glyph'); glyph.append(icon(symbol));
    const copy = el('span', 'qa-row-copy'); copy.append(el('span', 'qa-row-title', title)); if (subtitle) copy.append(el('span', 'qa-row-subtitle', subtitle));
    node.append(glyph, copy);
    if (trailing) node.append(trailing);
    if (action) node.addEventListener('click', action); else node.disabled = true;
    return node;
  }
  function drawDetail(view) {
    const n = view.nodes, name = view.detail, state = snapshot(view), c = state.controls || {}, a = state.media?.audio || {};
    const titles = { wifi: 'Wi-Fi', bluetooth: 'Bluetooth', sound: 'Sound output', mic: 'Microphone' };
    n.title.textContent = titles[name] || '';
    const on = name === 'wifi' ? c.wifi : name === 'bluetooth' ? c.bluetooth : name === 'sound' ? (typeof a.outputMuted === 'boolean' ? !a.outputMuted : null) : (typeof a.inputMuted === 'boolean' ? !a.inputMuted : null);
    n.toggle.hidden = typeof on !== 'boolean'; n.toggle.setAttribute('aria-checked', String(on === true));
    n.toggle.setAttribute('aria-label', name === 'sound' ? 'Sound on' : name === 'mic' ? 'Microphone on' : `${titles[name]} on`);
    n.moreSettings.textContent = name === 'wifi' ? 'More Wi-Fi settings' : name === 'bluetooth' ? 'More Bluetooth settings' : 'More sound settings';
    const rows = [];
    let message = '';
    if (name === 'wifi') {
      const list = view.lists.wifi;
      if (c.wifi === false) message = 'Wi-Fi is off.';
      else if (!list?.items) message = list?.error || 'Looking for networks…';
      else if (!list.items.length) message = 'No networks found.';
      else for (const network of list.items) {
        const status = network.connected ? 'Connected' : network.saved ? 'Saved' : network.secure ? 'Secured' : 'Open';
        const armed = view.armedNetwork === network.ssid;
        const trailing = network.connected ? el('span', `qa-row-action${armed ? ' is-armed' : ''}`, armed ? 'Disconnect' : '') : null;
        rows.push(row('wifi', network.ssid, `${status} · ${network.signal}%`, {
          selected: network.connected, pending: !!view.pending[`wifi:${network.ssid}`], trailing,
          action: () => {
            if (network.connected) {
              if (view.armedNetwork !== network.ssid) { view.armedNetwork = network.ssid; update(view); return; }
              view.armedNetwork = null; control(view, `wifi:${network.ssid}`, 'wifi-disconnect').then(() => loadList(view, 'wifi'));
            } else if (network.saved) control(view, `wifi:${network.ssid}`, 'wifi-connect', network.ssid).then(() => loadList(view, 'wifi'));
            else settings(view, 'wifi');
          },
        }));
      }
    } else if (name === 'bluetooth') {
      const list = view.lists.bluetooth;
      if (c.bluetooth === false) message = 'Bluetooth is off.';
      else if (!list?.items) message = list?.error || 'Looking for devices…';
      else if (!list.items.length) message = 'No paired devices. Pair one in Bluetooth settings.';
      else for (const device of list.items) {
        const symbol = device.kind === 'AudioVideo' ? 'headphones' : device.kind === 'Peripheral' ? 'gamepad' : 'bluetooth';
        rows.push(row(symbol, device.name, device.connected ? 'Connected' : 'Paired', { selected: device.connected, action: () => settings(view, 'bluetooth') }));
      }
      if (rows.length) message = 'Connect or disconnect devices in Bluetooth settings.';
    } else {
      const flow = name === 'sound' ? 'outputs' : 'inputs';
      const devices = Array.isArray(a[flow]) ? a[flow] : [];
      const pending = view.pending[flow];
      if (!devices.length) message = a.error ? 'Windows audio devices could not be read.' : `No ${name === 'sound' ? 'playback' : 'recording'} devices are active.`;
      for (const device of devices) {
        const info = describe(device);
        const selected = pending?.selected ? pending.selected === device.id : device.isDefault;
        const mark = selected ? (() => { const m = el('span', 'qa-row-check'); m.append(icon('check')); return m; })() : null;
        rows.push(row(name === 'mic' ? 'mic' : info.symbol, info.name, info.kind || (name === 'sound' ? 'Output' : 'Input'), {
          selected, pending: pending?.selected === device.id, trailing: mark,
          action: device.isDefault ? null : () => media(view, flow, flow === 'outputs' ? 'audio-output' : 'audio-input', device.id, { selected: device.id }),
        }));
      }
    }
    const signature = JSON.stringify([name, rows.map(node => node.textContent + node.className)]);
    if (n.list.dataset.signature !== signature) { n.list.dataset.signature = signature; n.list.replaceChildren(...rows); }
    n.note.textContent = message; n.note.hidden = !message;
  }

  // ---- Update -----------------------------------------------------------------
  function update(view) {
    if (!view.nodes) return;
    const n = view.nodes; const state = snapshot(view); const m = state.media || {}; const a = m.audio || {}; const c = state.controls || {};
    n.main.hidden = !!view.detail; n.detail.hidden = !view.detail;
    if (view.detail) drawDetail(view);
    const pendingValue = key => view.pending[key]?.value;
    const flag = (key, value) => typeof pendingValue(key) === 'boolean' ? pendingValue(key) : value;
    const set = (item, { on, known, symbol, status, disabled }) => {
      setIcon(item.glyph, symbol);
      item.node.classList.toggle('is-on', known && on);
      item.main.setAttribute('aria-checked', String(known && on));
      item.main.disabled = !!disabled;
      item.status.textContent = status;
    };
    const wifi = flag('wifi', c.wifi), bluetooth = flag('bluetooth', c.bluetooth), dark = flag('dark', c.dark);
    const currentWifi = view.lists.wifi?.items?.find(item => item.connected)?.ssid;
    set(n.tiles.wifi, { on: wifi, known: typeof wifi === 'boolean', symbol: wifi === false ? 'wifiOff' : 'wifi', status: typeof wifi !== 'boolean' ? (c.ready ? 'Not available' : 'Checking…') : wifi ? (currentWifi || 'On') : 'Off', disabled: typeof wifi !== 'boolean' || !!view.pending.wifi });
    set(n.tiles.bluetooth, { on: bluetooth, known: typeof bluetooth === 'boolean', symbol: 'bluetooth', status: typeof bluetooth !== 'boolean' ? (c.ready ? 'Not available' : 'Checking…') : bluetooth ? 'On' : 'Off', disabled: typeof bluetooth !== 'boolean' || !!view.pending.bluetooth });
    n.tiles.wifi.node.hidden = c.ready && typeof c.wifi !== 'boolean';
    n.tiles.bluetooth.node.hidden = c.ready && typeof c.bluetooth !== 'boolean';
    for (const [item, key, field, onSymbol, offSymbol, flow] of [[n.tiles.sound, 'output', 'outputMuted', 'speaker', 'muted', 'outputs'], [n.tiles.mic, 'input', 'inputMuted', 'mic', 'micOff', 'inputs']]) {
      const pending = view.pending[key];
      const muted = typeof pending?.muted === 'boolean' ? pending.muted : a[field];
      const known = typeof muted === 'boolean';
      const current = (a[flow] || []).find(device => device.isDefault);
      set(item, { on: known && !muted, known, symbol: known && muted ? offSymbol : onSymbol, status: !known ? 'Unavailable' : muted ? 'Muted' : current ? describe(current).name : 'On', disabled: !known || !!pending });
      item.node.classList.toggle('is-muted', known && muted);
    }
    set(n.tiles.dark, { on: dark, known: typeof dark === 'boolean', symbol: dark === false ? 'sun' : 'moon', status: typeof dark !== 'boolean' ? 'Checking…' : dark ? 'On' : 'Off', disabled: typeof dark !== 'boolean' || !!view.pending.dark });
    set(n.tiles.night, { on: false, known: true, symbol: 'night', status: 'Settings', disabled: !!view.pending.nightlight });
    const volumeKnown = Number.isFinite(m.volume);
    n.range.disabled = !volumeKnown || typeof view.context.bridge?.media !== 'function';
    if (!view.dragging && !view.volumeSending && document.activeElement !== n.range) n.range.value = String(volumeKnown ? Math.round(m.volume) : 0);
    n.range.style.setProperty('--fill', `${n.range.value}%`); n.volumeValue.textContent = volumeKnown ? `${n.range.value}%` : '—';
    setIcon(n.volumeIcon, a.outputMuted || Number(n.range.value) === 0 ? 'muted' : 'speaker');
    for (const [key, item] of Object.entries(n.powers)) {
      const armed = view.armed === key;
      item.node.classList.toggle('is-armed', armed); item.text.textContent = armed ? 'Tap again' : item.label;
      item.node.setAttribute('aria-label', armed ? `Tap again to ${item.label.toLowerCase()}` : item.label);
      item.node.disabled = !!view.pending[key] || typeof view.context.bridge?.systemControl !== 'function';
    }
  }
  function render(container, context) {
    let view = views.get(container);
    if (!view) { view = { container, context, pending: {}, lists: {}, detail: null, dragging: false, volumeSending: false, volumeTarget: null }; views.set(container, view); }
    view.context = context;
    if (!view.root || view.root.parentElement !== container) build(view);
    // The current Wi-Fi network name for the tile, once in a while.
    if (!view.wifiAt || Date.now() - view.wifiAt > 60000) { view.wifiAt = Date.now(); loadList(view, 'wifi'); }
    update(view); return true;
  }
  window.EdgeQuickActions = Object.freeze({ render });
})();
