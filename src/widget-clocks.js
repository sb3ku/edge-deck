(() => {
  'use strict';
  // Clock widgets copied from iOS: Dial (digital, numbers, bars or quarters face),
  // City (one city's time and its offset) and World clock (four cities). The
  // host re-renders only when the signature changes, so these modules are live:
  // one module-level timer, aligned to the next second (the next minute in low
  // power or reduced motion), updates every mounted root in place.
  const SVG = 'http://www.w3.org/2000/svg';
  const FACES = Object.freeze(['digital', 'numbers', 'bars', 'quarters']);
  const CITY_FACES = Object.freeze(['digital', 'numbers', 'bars']);
  const pad2 = value => String(value).padStart(2, '0');

  // ---- Pure helpers (also exposed for tests) --------------------------------
  const formatters = new Map(); // zone ('' = local) -> Intl.DateTimeFormat, made once
  function formatter(zone) {
    const key = zone || '';
    let found = formatters.get(key);
    if (!found) {
      const options = { year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23' };
      if (key) options.timeZone = key;
      try { found = new Intl.DateTimeFormat('en-GB', options); } catch { delete options.timeZone; found = new Intl.DateTimeFormat('en-GB', options); }
      formatters.set(key, found);
    }
    return found;
  }
  // The wall clock in a zone (the local zone when none is given).
  function zoneClock(zone, date = new Date()) {
    const out = { year: 0, month: 0, day: 0, hour: 0, minute: 0, second: 0 };
    for (const part of formatter(zone).formatToParts(date)) if (part.type in out) out[part.type] = Number(part.value);
    out.hour %= 24;
    return out;
  }
  const wallMs = clock => Date.UTC(clock.year, clock.month - 1, clock.day, clock.hour, clock.minute, clock.second);
  // Minutes the zone is ahead of local time (negative when behind), whole minutes.
  function offsetMinutes(zone, date = new Date()) { return Math.round((wallMs(zoneClock(zone, date)) - wallMs(zoneClock(null, date))) / 60000); }
  // "-9", "+1", "+5:30", "0".
  function offsetText(minutes) {
    const total = Math.round(Number(minutes) || 0); if (!total) return '0';
    const abs = Math.abs(total), hours = Math.floor(abs / 60), rest = abs % 60;
    return `${total < 0 ? '-' : '+'}${hours}${rest ? `:${pad2(rest)}` : ''}`;
  }
  // "+8HRS", "-9HRS", "+0HRS", "+5:30HRS".
  function offsetHours(minutes) { const text = offsetText(minutes); return `${text === '0' ? '+0' : text}HRS`; }
  const dayStamp = clock => Date.UTC(clock.year, clock.month - 1, clock.day);
  // Today, Yesterday or Tomorrow relative to the local date.
  function dayLabel(zone, date = new Date()) {
    const diff = Math.round((dayStamp(zoneClock(zone, date)) - dayStamp(zoneClock(null, date))) / 86400000);
    return diff > 0 ? 'Tomorrow' : diff < 0 ? 'Yesterday' : 'Today';
  }
  // Hand angles in degrees clockwise from 12. Without seconds the minute hand stands on the minute.
  function handAngles(hour, minute, second, withSeconds = true) {
    const s = withSeconds ? Number(second) || 0 : 0;
    return { hour: ((Number(hour) % 12) + Number(minute) / 60 + s / 3600) * 30, minute: (Number(minute) + s / 60) * 6, second: s * 6 };
  }
  // Tick 0 is at 12; ticks up to the current second are lit. No seconds (minute precision) lights none.
  function tickLit(index, second) { return second !== null && second !== undefined && index <= second; }
  // 12 hour: no am/pm and no leading zero (iOS); 24 hour: two digits.
  function timeText(clock, clock24) { return clock24 ? `${pad2(clock.hour)}:${pad2(clock.minute)}` : `${clock.hour % 12 || 12}:${pad2(clock.minute)}`; }
  function ariaTime(clock, clock24) { return clock24 ? `${clock.hour}:${pad2(clock.minute)}` : `${clock.hour % 12 || 12}:${pad2(clock.minute)}`; }
  function aheadText(minutes) {
    if (!minutes) return 'same time as here';
    const abs = Math.abs(minutes), hours = Math.floor(abs / 60), rest = abs % 60;
    const amount = rest ? `${hours}:${pad2(rest)} hours` : `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
    return `${amount} ${minutes > 0 ? 'ahead' : 'behind'}`;
  }
  function cityOf(id) {
    const list = window.EdgeLayout?.CITIES || [];
    return list.find(city => city.id === id) || list.find(city => city.id === 'cupertino') || list[0] || { id: 'cupertino', name: 'Cupertino', short: 'CUP', zone: 'America/Los_Angeles' };
  }
  function worldCities(item) {
    const wanted = Array.isArray(item?.cities) && item.cities.length ? item.cities : (window.EdgeLayout?.WORLD_CLOCK_DEFAULT || ['new-york', 'london', 'tokyo', 'sydney']);
    return wanted.slice(0, 4).map(cityOf);
  }
  // A point on a rounded square's outline (half-size h, corner radius r), from the top centre going
  // clockwise, with the unit vector pointing inward. s is the distance along the outline.
  function outlinePoint(s, h, r) {
    const straight = 2 * (h - r), arc = Math.PI * r / 2, half = h - r;
    const segments = [[half, 'top'], [arc, 'tr'], [straight, 'right'], [arc, 'br'], [straight, 'bottom'], [arc, 'bl'], [straight, 'left'], [arc, 'tl'], [half, 'top2']];
    const perimeter = segments.reduce((sum, [len]) => sum + len, 0);
    let rest = ((s % perimeter) + perimeter) % perimeter;
    for (const [len, name] of segments) {
      if (rest > len) { rest -= len; continue; }
      const t = rest;
      switch (name) {
        case 'top': return { x: t, y: -h, nx: 0, ny: 1 };
        case 'right': return { x: h, y: -half + t, nx: -1, ny: 0 };
        case 'bottom': return { x: half - t, y: h, nx: 0, ny: -1 };
        case 'left': return { x: -h, y: half - t, nx: 1, ny: 0 };
        case 'top2': return { x: -half + t, y: -h, nx: 0, ny: 1 };
        default: {
          const [cx, cy, from] = { tr: [half, -half, -90], br: [half, half, 0], bl: [-half, half, 90], tl: [-half, -half, 180] }[name];
          const angle = (from + (t / len) * 90) * Math.PI / 180;
          return { x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r, nx: -Math.cos(angle), ny: -Math.sin(angle) };
        }
      }
    }
    return { x: 0, y: -h, nx: 0, ny: 1 };
  }
  const outlineLength = (h, r) => 8 * (h - r) + 2 * Math.PI * r;

  // ---- DOM helpers --------------------------------------------------------------
  function svgNode(name, attributes, text) {
    const node = document.createElementNS(SVG, name);
    for (const [key, value] of Object.entries(attributes || {})) node.setAttribute(key, String(value));
    if (text !== undefined) node.textContent = text;
    return node;
  }
  const num = value => Math.round(value * 100) / 100;
  function lineNode(x1, y1, x2, y2, cls) { return svgNode('line', { x1: num(x1), y1: num(y1), x2: num(x2), y2: num(y2), class: cls }); }
  function polar(angle, radius) { const a = angle * Math.PI / 180; return [50 + Math.sin(a) * radius, 50 - Math.cos(a) * radius]; }

  // ---- Faces: each builds into an <svg> (100 x 100 units) and returns the parts that move ----
  function addTicks(svg, kind) {
    const group = svgNode('g', { class: 'dc-ticks' });
    for (let i = 0; i < 60; i++) {
      const major = i % 5 === 0;
      let inner = major ? 43.6 : 45, cls = major ? 'dc-tick dc-tick-major' : 'dc-tick';
      if (kind === 'quarters') { inner = major ? 39 : 44.6; cls = major ? 'dc-tick dc-tick-hour' : 'dc-tick'; }
      const [x1, y1] = polar(i * 6, 47.4), [x2, y2] = polar(i * 6, inner);
      group.append(lineNode(x1, y1, x2, y2, cls));
    }
    svg.append(group);
  }
  function addNumerals(svg, kind, mini) {
    const group = svgNode('g', { class: kind === 'quarters' ? 'dc-numerals dc-quarters' : 'dc-numerals' });
    const hours = kind === 'quarters' ? [3, 6, 9, 12] : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    for (const hour of hours) {
      const [x, y] = polar(hour * 30, kind === 'quarters' ? 31 : mini ? 34.5 : 35.5);
      group.append(svgNode('text', { x: num(x), y: num(y), dy: '.35em', 'text-anchor': 'middle', class: 'dc-numeral' }, String(hour)));
    }
    svg.append(group);
  }
  function addBars(svg) {
    const group = svgNode('g', { class: 'dc-bars' });
    for (let i = 0; i < 12; i++) { const [x1, y1] = polar(i * 30, 45.5), [x2, y2] = polar(i * 30, 35.5); group.append(lineNode(x1, y1, x2, y2, 'dc-bar')); }
    svg.append(group);
  }
  // One hand: a dark outline stroke under a light one, in a group rotated about the centre.
  function hand(svg, cls, tail, length) {
    const group = svgNode('g', { class: `dc-hand ${cls}` });
    group.append(lineNode(50, 50 + tail, 50, 50 - length, 'dc-hand-edge'), lineNode(50, 50 + tail, 50, 50 - length, 'dc-hand-fill'));
    svg.append(group); return group;
  }
  // The analog dial. options: { face, mini, code, diff }. Returns the hand groups and the offset text.
  function buildAnalog(svg, options) {
    const face = options.face, mini = !!options.mini;
    if (face === 'bars') addBars(svg); else addTicks(svg, face);
    if (face === 'numbers' || face === 'quarters') addNumerals(svg, face, mini);
    if (options.code) svg.append(svgNode('text', { x: 50, y: mini ? 33 : 30, 'text-anchor': 'middle', class: 'dc-code' }, options.code));
    const diff = options.diff ? svgNode('text', { x: 50, y: 69, 'text-anchor': 'middle', class: 'dc-diff' }, '') : null;
    if (diff) svg.append(diff);
    const hour = hand(svg, 'dc-hour', 5, 26), minute = hand(svg, 'dc-minute', 6, 39), second = hand(svg, 'dc-second', 11, 43);
    svg.append(svgNode('circle', { cx: 50, cy: 50, r: 2.6, class: 'dc-cap' }), svgNode('circle', { cx: 50, cy: 50, r: 1.1, class: 'dc-cap-dot' }));
    return { hour, minute, second, diff };
  }
  // The digital face: 60 ticks along the rounded card edge and the time in the middle.
  function buildDigital(svg, options) {
    const h = 44.5, r = 16, perimeter = outlineLength(h, r), ticks = [];
    const group = svgNode('g', { class: 'dc-ring', transform: 'translate(50 50)' });
    for (let i = 0; i < 60; i++) {
      const major = i % 5 === 0, p = outlinePoint(i * perimeter / 60, h, r), len = major ? 4.6 : 3;
      const tick = lineNode(p.x, p.y, p.x + p.nx * len, p.y + p.ny * len, major ? 'dc-ring-tick dc-ring-major' : 'dc-ring-tick');
      ticks.push(tick); group.append(tick);
    }
    svg.append(group);
    const time = svgNode('text', { x: 50, y: options.code ? 62.5 : 64, 'text-anchor': 'middle', class: options.code ? 'dc-time dc-time-city' : 'dc-time' }, '');
    svg.append(time);
    let diff = null;
    if (options.code) {
      diff = svgNode('text', { x: 50, y: 81, 'text-anchor': 'middle', class: 'dc-diff' }, '');
      svg.append(svgNode('text', { x: 50, y: 31, 'text-anchor': 'middle', class: 'dc-code' }, options.code), diff);
    }
    return { ticks, time, diff };
  }
  function faceSvg() { return svgNode('svg', { viewBox: '0 0 100 100', class: 'dc-face', 'aria-hidden': 'true', focusable: 'false' }); }

  // ---- Live clocks: one shared timer ------------------------------------------------
  const mounted = new Map(); // card body -> entry { root, update(now, seconds) -> aria text, minute }
  let timer = null;
  function minuteOnly() {
    try { if (document.documentElement.classList.contains('low-power')) return true; } catch {}
    try { return !!(typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch { return false; }
  }
  // Paint one root. The aria label changes at most once a minute.
  function refresh(entry, force) {
    const seconds = !minuteOnly(), now = new Date();
    entry.root.dataset.seconds = seconds ? 'on' : 'off';
    const label = entry.update(now, seconds), minute = Math.floor(now.getTime() / 60000);
    if (force || entry.minute !== minute) { entry.root.setAttribute('aria-label', label); entry.minute = minute; }
  }
  function prune() { for (const body of [...mounted.keys()]) if (!body.isConnected) mounted.delete(body); }
  function tickAll() {
    timer = null; prune();
    for (const entry of mounted.values()) refresh(entry, false);
    schedule();
  }
  function schedule() {
    if (timer) { clearTimeout(timer); timer = null; }
    prune();
    if (!mounted.size) return;
    const period = minuteOnly() ? 60000 : 1000;
    timer = setTimeout(tickAll, period - (Date.now() % period) + 15);
  }
  // Keeps the existing root when nothing it was built from changed; otherwise rebuilds it.
  function mount(body, ctx, type, build) {
    const key = JSON.stringify([type, ctx.item?.face ?? null, ctx.item?.city ?? null, ctx.item?.cities ?? null, ctx.size, !!ctx.clock24()]);
    let root = [...body.children].find(node => node.classList?.contains(type));
    let entry = mounted.get(body);
    if (!root || !entry || entry.root !== root || root.dataset.key !== key) {
      root = ctx.el('div', `dc-root ${type}`);
      root.dataset.key = key; root.dataset.size = ctx.size; root.setAttribute('role', 'img');
      const update = build(root);
      body.replaceChildren(root);
      entry = { root, update, minute: -1 };
      mounted.set(body, entry);
      refresh(entry, true);
    } else refresh(entry, false);
    schedule();
  }
  const signature = ctx => [ctx.item?.face, ctx.item?.city, ctx.item?.cities, ctx.size, ctx.clock24()];
  const faceOf = (item, allowed) => allowed.includes(item?.face) ? item.face : 'digital';

  function moveHands(parts, clock, seconds) {
    const angles = handAngles(clock.hour, clock.minute, clock.second, seconds);
    parts.hour.setAttribute('transform', `rotate(${num(angles.hour)} 50 50)`);
    parts.minute.setAttribute('transform', `rotate(${num(angles.minute)} 50 50)`);
    parts.second.setAttribute('transform', `rotate(${num(angles.second)} 50 50)`);
    parts.second.style.display = seconds ? '' : 'none';
  }
  function setText(node, text) { if (node && node.textContent !== text) node.textContent = text; }
  function ariaLabel(name, clock, clock24, offset) { return [name, ariaTime(clock, clock24), offset === null ? '' : aheadText(offset)].filter(Boolean).join(', '); }

  // A face for a zone (null = local). Returns update(now, seconds) -> aria text.
  function mountFace(root, face, zone, options, clock24) {
    const svg = faceSvg(); root.append(svg);
    const parts = face === 'digital' ? buildDigital(svg, options) : buildAnalog(svg, { face, mini: false, code: options.code, diff: !!options.code });
    return (now, seconds) => {
      const clock = zoneClock(zone, now), offset = zone ? offsetMinutes(zone, now) : 0;
      if (face === 'digital') { setText(parts.time, timeText(clock, clock24)); parts.ticks.forEach((tick, i) => tick.classList.toggle('is-lit', tickLit(i, seconds ? clock.second : null))); }
      else moveHands(parts, clock, seconds);
      setText(parts.diff, offsetText(offset));
      return ariaLabel(options.name || '', clock, clock24, zone ? offset : null);
    };
  }

  // ---- The three widgets ----------------------------------------------------------------
  function renderDial(body, ctx) {
    const face = faceOf(ctx.item, FACES), clock24 = !!ctx.clock24();
    mount(body, ctx, 'dial-widget', root => { root.dataset.face = face; return mountFace(root, face, null, {}, clock24); });
  }
  function renderCity(body, ctx) {
    const face = faceOf(ctx.item, CITY_FACES), clock24 = !!ctx.clock24(), city = cityOf(ctx.item?.city);
    mount(body, ctx, 'city-widget', root => { root.dataset.face = face; return mountFace(root, face, city.zone, { code: city.short, name: city.name }, clock24); });
  }
  function renderWorld(body, ctx) {
    const cities = worldCities(ctx.item), medium = ctx.size !== 'small', clock24 = !!ctx.clock24();
    mount(body, ctx, 'world-clock-widget', root => {
      root.dataset.layout = medium ? 'row' : 'grid';
      const cells = cities.map(city => {
        const cell = ctx.el('div', 'wc-cell'), svg = faceSvg();
        cell.append(svg);
        const parts = buildAnalog(svg, { face: 'numbers', mini: true, code: medium ? '' : city.short, diff: false });
        let day = null, hours = null;
        if (medium) { day = ctx.el('span', 'wc-day'); hours = ctx.el('span', 'wc-hours'); cell.append(ctx.el('span', 'wc-name', city.name), day, hours); }
        root.append(cell);
        return { city, parts, day, hours };
      });
      return (now, seconds) => {
        const names = [];
        for (const cell of cells) {
          const clock = zoneClock(cell.city.zone, now), offset = offsetMinutes(cell.city.zone, now);
          moveHands(cell.parts, clock, seconds);
          if (cell.day) { setText(cell.day, dayLabel(cell.city.zone, now)); setText(cell.hours, offsetHours(offset)); }
          names.push(`${cell.city.name} ${ariaTime(clock, clock24)}, ${aheadText(offset)}`);
        }
        return `World clock: ${names.join('; ')}`;
      };
    });
  }

  window.EdgeWidgets = window.EdgeWidgets || {};
  const helpers = Object.freeze({ zoneClock, offsetMinutes, offsetText, offsetHours, dayLabel, handAngles, tickLit, timeText, ariaTime, aheadText, cityOf, worldCities, outlinePoint, outlineLength, formatter, debugMounted: () => mounted.size, debugTimer: () => timer !== null });
  window.EdgeWidgets.dial = Object.freeze({ render: renderDial, signature, live: true, helpers });
  window.EdgeWidgets.city = Object.freeze({ render: renderCity, signature, live: true, helpers });
  window.EdgeWidgets['world-clock'] = Object.freeze({ render: renderWorld, signature, live: true, helpers });
})();
