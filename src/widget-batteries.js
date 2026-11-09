(() => {
  'use strict';
  // Batteries widget, in the style of iOS: the charge of the Bluetooth devices
  // Windows knows (headset, controller, mouse ...) and of this PC's own battery.
  // Small: up to four rings in a 2x2 grid (one big ring with its percent when
  // there is only one device). Medium: up to four rings in a row with the
  // percent under each. Large: a list of up to six devices with a level bar.
  // The module fetches its own data through bridge.systemList('batteries'): at
  // most every two minutes, and only while a Batteries widget is on screen.
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const REFRESH_MS = 2 * 60000;
  const LIMITS = { small: 4, medium: 4, large: 6 };
  const RADIUS = 42, CIRCUMFERENCE = 2 * Math.PI * RADIUS;
  const GREEN = '#30d158', YELLOW = '#ffd60a', RED = '#ff453a';
  const KIND_LABELS = { headphones: 'Headphones', headset: 'Headset', mouse: 'Mouse', keyboard: 'Keyboard', controller: 'Controller', phone: 'Phone', laptop: 'This PC', other: 'Device' };

  // Device icons: 24x24 outlines, drawn with currentColor.
  const ICONS = {
    headphones: [['path', { d: 'M4 15v-3a8 8 0 0 1 16 0v3' }], ['rect', { x: 3, y: 14, width: 4, height: 7, rx: 1.6 }], ['rect', { x: 17, y: 14, width: 4, height: 7, rx: 1.6 }]],
    headset: [['path', { d: 'M4 15v-3a8 8 0 0 1 16 0v3' }], ['rect', { x: 3, y: 14, width: 4, height: 6, rx: 1.6 }], ['rect', { x: 17, y: 14, width: 4, height: 6, rx: 1.6 }], ['path', { d: 'M20 20v.5a2 2 0 0 1-2 2h-3.5' }]],
    controller: [['path', { d: 'M7.5 7h9a4.5 4.5 0 0 1 4.4 3.6l.9 4.4a2.8 2.8 0 0 1-4.9 2.2L15 15.5H9l-1.9 1.7A2.8 2.8 0 0 1 2.2 15l.9-4.4A4.5 4.5 0 0 1 7.5 7z' }], ['path', { d: 'M8 10v3M6.5 11.5h3' }], ['path', { d: 'M15.6 10.6h.01M17.6 12.6h.01', 'stroke-width': 2.4 }]],
    mouse: [['rect', { x: 6, y: 2.5, width: 12, height: 19, rx: 6 }], ['path', { d: 'M12 3v6.5' }]],
    keyboard: [['rect', { x: 2, y: 6, width: 20, height: 12, rx: 2.5 }], ['path', { d: 'M6 10h.01M10 10h.01M14 10h.01M18 10h.01', 'stroke-width': 2.2 }], ['path', { d: 'M7.5 14h9' }]],
    phone: [['rect', { x: 6.5, y: 2, width: 11, height: 20, rx: 2.8 }], ['path', { d: 'M10.5 18.5h3' }]],
    laptop: [['rect', { x: 4, y: 5, width: 16, height: 11, rx: 1.8 }], ['path', { d: 'M2 19.5h20' }]],
    other: [['path', { d: 'M7 7.5l10 9-5 4.5v-18l5 4.5-10 9' }]],
  };
  const BOLT = 'M13 2L5 13.5h6L10 22l8-11.5h-6z';

  const finite = value => Number.isFinite(value);
  const clampLevel = value => finite(value) ? Math.max(0, Math.min(100, Math.round(value))) : null;
  // Green normally, yellow at 20% or less, red at 10% or less; charging is always green.
  function tone(level, charging) {
    if (charging) return GREEN;
    return level <= 10 ? RED : level <= 20 ? YELLOW : GREEN;
  }
  // The devices a size shows: only those with a level, those in use first, as many as fit.
  function pick(devices, size) {
    const list = (Array.isArray(devices) ? devices : []).filter(device => device && finite(device.level)).map(device => ({
      name: String(device.name || 'Device').slice(0, 64), level: clampLevel(device.level), connected: device.connected !== false,
      kind: ICONS[device.kind] ? device.kind : 'other', charging: device.charging === true,
    }));
    const ordered = list.map((device, index) => ({ device, index })).sort((a, b) => (b.device.connected - a.device.connected) || (a.index - b.index)).map(entry => entry.device);
    return ordered.slice(0, LIMITS[size] || LIMITS.medium);
  }
  const dash = level => `${((level ?? 0) / 100 * CIRCUMFERENCE).toFixed(2)} ${CIRCUMFERENCE.toFixed(2)}`;
  const spoken = device => `${device.name}, ${device.level} percent${device.charging ? ', charging' : ''}${device.connected ? '' : ', not connected'}`;

  function svgNode(tag, attributes, parent) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [name, value] of Object.entries(attributes || {})) node.setAttribute(name, String(value));
    if (parent) parent.append(node);
    return node;
  }
  function deviceIcon(kind) {
    const svg = svgNode('svg', { class: 'batt-icon', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' });
    for (const [tag, attributes] of ICONS[kind] || ICONS.other) svgNode(tag, attributes, svg);
    return svg;
  }
  function bolt(className) {
    const svg = svgNode('svg', { class: className, viewBox: '0 0 24 24', 'aria-hidden': 'true' });
    svgNode('path', { d: BOLT, fill: 'currentColor' }, svg);
    return svg;
  }
  function ring(device, ctx) {
    const box = ctx.el('div', `batt-ring${device.charging ? ' is-charging' : ''}`);
    box.style.setProperty('--batt-tone', tone(device.level, device.charging));
    box.setAttribute('aria-hidden', 'true');
    const svg = svgNode('svg', { class: 'batt-ring-svg', viewBox: '0 0 100 100', 'aria-hidden': 'true' });
    svgNode('circle', { class: 'batt-track', cx: 50, cy: 50, r: RADIUS }, svg);
    svgNode('circle', { class: 'batt-fill', cx: 50, cy: 50, r: RADIUS, 'stroke-dasharray': dash(device.level) }, svg);
    const centre = ctx.el('div', 'batt-ring-centre');
    centre.append(deviceIcon(device.kind));
    if (device.charging) centre.append(bolt('batt-bolt'));
    box.append(svg, centre);
    return box;
  }
  function percentFor(device, ctx) {
    const text = ctx.el('span', 'batt-percent');
    if (device.charging) text.append(bolt('batt-bolt-inline'));
    text.append(document.createTextNode(`${device.level}%`));
    return text;
  }

  function cell(device, ctx, withPercent) {
    const item = ctx.el('div', `batt-cell${device.connected ? '' : ' is-away'}`); item.setAttribute('role', 'listitem'); item.setAttribute('aria-label', spoken(device));
    item.append(ring(device, ctx));
    if (withPercent) item.append(percentFor(device, ctx));
    return item;
  }
  function row(device, ctx) {
    const item = ctx.el('div', `batt-row${device.connected ? '' : ' is-away'}`); item.setAttribute('role', 'listitem'); item.setAttribute('aria-label', spoken(device));
    const badge = ctx.el('span', 'batt-badge'); badge.append(deviceIcon(device.kind));
    const copy = ctx.el('div', 'batt-copy');
    copy.append(ctx.el('span', 'batt-name', device.name));
    const note = device.charging ? 'Charging' : device.connected ? '' : 'Not connected';
    if (note) copy.append(ctx.el('span', 'batt-note', note));
    const bar = ctx.el('div', 'batt-bar'); bar.style.setProperty('--batt-tone', tone(device.level, device.charging)); bar.setAttribute('aria-hidden', 'true');
    const fill = ctx.el('span', 'batt-bar-fill'); fill.style.width = `${device.level}%`; bar.append(fill);
    item.append(badge, copy, bar, percentFor(device, ctx));
    return item;
  }
  function emptyState(ctx) {
    const empty = ctx.el('div', 'batt-empty');
    const symbol = ctx.el('span', 'batt-empty-symbol'); symbol.append(ctx.icon('battery'));
    empty.append(symbol, ctx.el('h3', 'batt-empty-title', 'No batteries found'), ctx.el('p', 'batt-empty-text', 'Connect a Bluetooth headset or controller that reports its charge.'));
    return empty;
  }

  function content(ctx) {
    const size = LIMITS[ctx.size] ? ctx.size : 'medium';
    const root = ctx.el('div', 'batt-widget'); root.dataset.size = size;
    const bridge = ctx.bridge;
    const loading = !cache.loaded && typeof bridge?.systemList === 'function';
    if (loading) { root.className = 'batt-widget is-loading'; return root; }
    const devices = pick(cache.devices, size);
    if (!devices.length) { root.append(emptyState(ctx)); return root; }
    const list = ctx.el('div', `batt-list batt-${size}${size === 'small' && devices.length === 1 ? ' is-single' : ''}`); list.setAttribute('role', 'list'); list.setAttribute('aria-label', 'Battery levels');
    list.style.setProperty('--batt-count', String(devices.length));
    if (size === 'large') for (const device of devices) list.append(row(device, ctx));
    else if (size === 'medium') for (const device of devices) list.append(cell(device, ctx, true));
    else {
      for (const device of devices) list.append(cell(device, ctx, devices.length === 1));
    }
    root.append(list);
    return root;
  }

  // The shared cache and the bodies currently showing it.
  const cache = { devices: [], at: 0, loaded: false, version: 0, busy: false, timer: null };
  const mounted = new Map(); // body -> ctx
  function draw(body, ctx) {
    body.replaceChildren(content(ctx));
  }
  function live() {
    for (const body of [...mounted.keys()]) if (body.isConnected === false) mounted.delete(body);
    return mounted.size > 0;
  }
  function redrawAll() {
    if (!live()) return;
    for (const [body, ctx] of mounted) draw(body, ctx);
  }
  function schedule() {
    clearTimeout(cache.timer); cache.timer = null;
    if (!live()) return;
    cache.timer = setTimeout(() => { cache.timer = null; refresh(); }, REFRESH_MS + 250);
  }
  function refresh(now = Date.now()) {
    if (cache.busy || !live()) return;
    const ctx = mounted.values().next().value;
    const bridge = ctx?.bridge;
    if (typeof bridge?.systemList !== 'function') { schedule(); return; }
    cache.busy = true;
    Promise.resolve().then(() => bridge.systemList('batteries')).then(
      devices => ({ devices: Array.isArray(devices) ? devices : [], failed: false }),
      () => ({ devices: null, failed: true }),
    ).then(result => {
      cache.busy = false; cache.at = Date.now();
      // A failed read keeps what was known before.
      const next = result.failed ? cache.devices : result.devices;
      const changed = !cache.loaded || JSON.stringify(next) !== JSON.stringify(cache.devices);
      cache.devices = next; cache.loaded = true;
      if (changed) { cache.version += 1; redrawAll(); }
      schedule();
    });
  }
  function render(body, ctx) {
    mounted.set(body, ctx);
    draw(body, ctx);
    if (!cache.loaded || Date.now() - cache.at > REFRESH_MS) refresh(); else if (!cache.timer) schedule();
  }
  function signature(ctx) { return [ctx.size, cache.version]; }

  window.EdgeWidgets = window.EdgeWidgets || {};
  window.EdgeWidgets.batteries = Object.freeze({ render, signature, helpers: Object.freeze({ pick, tone, dash, clampLevel, spoken, cache, mounted, refresh, LIMITS, KIND_LABELS, REFRESH_MS }) });
})();
