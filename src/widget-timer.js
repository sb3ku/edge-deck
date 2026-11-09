(() => {
  'use strict';
  // Timer widget: an iOS-like countdown. Each view keeps one state machine
  // (keyed by the view's id) in a module-level map, mirrored to localStorage so
  // a running timer survives a reload. One shared 1 s interval ticks every
  // mounted card while anything runs; completion is judged by the clock, never
  // by counting ticks.
  const STORAGE_PREFIX = 'edge-deck:timer:';
  const MIN_MINUTES = 1, MAX_MINUTES = 720, DEFAULT_MINUTES = 10;
  const PRESETS = Object.freeze([1, 3, 5, 10, 15, 25, 45, 60]);
  const CIRCUMFERENCE = 263.9; // 2π·42: the ring's radius in its 100-unit box
  const STATUSES = new Set(['idle', 'running', 'paused', 'done']);
  const SVG = 'http://www.w3.org/2000/svg';

  // ---- Pure helpers (also exposed for tests) --------------------------------
  const clamp = minutes => Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, Math.round(Number(minutes) || 0)));
  const pad = value => String(value).padStart(2, '0');
  function minutesOf(item) { const minutes = Number(item?.minutes); return Number.isInteger(minutes) && minutes >= MIN_MINUTES && minutes <= MAX_MINUTES ? minutes : DEFAULT_MINUTES; }
  // Whole seconds, rounded up, as mm:ss or h:mm:ss from an hour.
  function format(ms) {
    const total = Math.max(0, Math.ceil((Number(ms) || 0) / 1000));
    const hours = Math.floor(total / 3600), minutes = Math.floor(total % 3600 / 60), seconds = total % 60;
    return hours ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
  }
  // The length people read: "10 min", "1 h", "1 h 30 min".
  function lengthLabel(minutes) {
    const total = clamp(minutes), hours = Math.floor(total / 60), rest = total % 60;
    return hours ? (rest ? `${hours} h ${rest} min` : `${hours} h`) : `${total} min`;
  }
  // Steps grow with the length: 1 min below 5, 5 up to 30, 10 up to 2 h, then 30.
  function stepSize(minutes) { return minutes < 5 ? 1 : minutes < 30 ? 5 : minutes < 120 ? 10 : 30; }
  function step(minutes, direction) {
    const from = clamp(minutes);
    if (direction > 0) { const size = stepSize(from); return clamp(Math.floor(from / size) * size + size); }
    const size = stepSize(from - 1); return clamp(Math.ceil(from / size) * size - size);
  }
  function ringDash(remaining, total) {
    const fraction = total > 0 && Number.isFinite(remaining) ? Math.max(0, Math.min(1, remaining / total)) : 0;
    return `${(fraction * CIRCUMFERENCE).toFixed(1)} ${CIRCUMFERENCE}`;
  }
  function endsText(at, clock24) {
    try { return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: !clock24 }).format(new Date(at)); } catch { return ''; }
  }
  function idleState(minutes) { return { status: 'idle', durationMs: clamp(minutes) * 60000, endsAt: null, remainingMs: null, startedAt: null }; }
  function withMinutes(state, minutes) { return state.status === 'idle' ? { ...state, durationMs: clamp(minutes) * 60000 } : state; }
  // The state machine. An action that does not apply returns the same state.
  function nextState(state, action, now = Date.now()) {
    const s = state && STATUSES.has(state.status) ? state : idleState(DEFAULT_MINUTES);
    switch (action) {
      case 'start': return s.status === 'idle' ? { ...s, status: 'running', endsAt: now + s.durationMs, remainingMs: null, startedAt: now } : s;
      case 'pause': return s.status === 'running' ? { ...s, status: 'paused', endsAt: null, remainingMs: Math.max(0, s.endsAt - now) } : s;
      case 'resume': return s.status === 'paused' ? { ...s, status: 'running', endsAt: now + s.remainingMs, remainingMs: null } : s;
      case 'toggle': return nextState(s, { idle: 'start', running: 'pause', paused: 'resume', done: 'dismiss' }[s.status], now);
      case 'tick': return s.status === 'running' && now >= s.endsAt ? nextState(s, 'finish', now) : s;
      case 'finish': return s.status === 'running' || s.status === 'paused' ? { ...s, status: 'done', endsAt: s.status === 'running' ? s.endsAt : now, remainingMs: 0 } : s;
      case 'reset': case 'dismiss': return s.status === 'idle' ? s : idleState(s.durationMs / 60000);
      default: return s;
    }
  }
  // A saved state back from JSON; a running timer past its end is done. Null when unusable.
  function restore(json, now = Date.now()) {
    let saved = json;
    if (typeof json === 'string') { try { saved = JSON.parse(json); } catch { return null; } }
    if (!saved || typeof saved !== 'object' || !STATUSES.has(saved.status)) return null;
    const durationMs = Math.round(Number(saved.durationMs) / 60000) * 60000;
    if (!(durationMs >= MIN_MINUTES * 60000 && durationMs <= MAX_MINUTES * 60000)) return null;
    const base = { status: saved.status, durationMs, endsAt: null, remainingMs: null, startedAt: Number.isFinite(saved.startedAt) ? saved.startedAt : null };
    if (saved.status === 'running') {
      const endsAt = Number(saved.endsAt); if (!Number.isFinite(endsAt)) return null;
      return endsAt <= now ? { ...base, status: 'done', endsAt, remainingMs: 0 } : { ...base, endsAt };
    }
    if (saved.status === 'paused') {
      const remainingMs = Number(saved.remainingMs); if (!Number.isFinite(remainingMs)) return null;
      return remainingMs <= 0 ? { ...base, status: 'done', endsAt: now, remainingMs: 0 } : { ...base, remainingMs };
    }
    if (saved.status === 'done') return { ...base, endsAt: Number.isFinite(saved.endsAt) ? saved.endsAt : null, remainingMs: 0 };
    return base;
  }
  // Small, Large and Tall have their own arrangement in the Widgets grid; everything else uses Medium's.
  function layoutOf(ctx) { return ctx.mode === 'widgets' && ['small', 'large', 'tall'].includes(ctx.size) ? ctx.size : 'medium'; }
  // Whether the config still has a timer view with this id (a card without its own views shows "<cardId>-content").
  function hasView(config, id) {
    return (config?.widgets || []).some(card => Array.isArray(card.items) ? card.items.some(item => item?.id === id && item.type === 'timer') : card.type === 'timer' && `${card.id}-content` === id);
  }

  // ---- State, storage and the shared tick -----------------------------------
  const timers = new Map(); // view id -> state
  const mounted = new Map(); // card body -> { id, root, live, ctx }
  let host = null; // the app's config() and toast from the latest ctx (app-level functions, no card references)
  let ticker = null, audio = null;
  function load(id, fallbackMinutes) {
    if (timers.has(id)) return timers.get(id);
    let state = null;
    try { state = restore(window.localStorage.getItem(STORAGE_PREFIX + id), Date.now()); } catch {}
    timers.set(id, state || idleState(fallbackMinutes));
    return timers.get(id);
  }
  function setState(id, state) {
    timers.set(id, state);
    try { window.localStorage.setItem(STORAGE_PREFIX + id, JSON.stringify(state)); } catch {}
    syncTicker();
  }
  function forget(id) {
    timers.delete(id);
    try { window.localStorage.removeItem(STORAGE_PREFIX + id); } catch {}
    syncTicker();
  }
  function syncTicker() {
    const running = [...timers.values()].some(state => state.status === 'running');
    if (running && !ticker) ticker = setInterval(tick, 1000);
    else if (!running && ticker) { clearInterval(ticker); ticker = null; }
  }
  // Bodies the host removed are dropped, and a timer whose view is gone from the
  // config (card removed, type changed) is forgotten. A detached body alone is not
  // proof: cards on another page leave the DOM and come back with their timer.
  function prune() {
    for (const body of [...mounted.keys()]) if (!body.isConnected) mounted.delete(body);
    let config = null; try { config = host?.config() || null; } catch {}
    if (!config) return;
    const shown = new Set([...mounted.values()].map(entry => entry.id));
    for (const id of [...timers.keys()]) if (!shown.has(id) && !hasView(config, id)) forget(id);
  }
  function tick() {
    const now = Date.now();
    prune();
    for (const [id, state] of timers) {
      if (state.status !== 'running') continue;
      const next = nextState(state, 'tick', now);
      if (next !== state) { setState(id, next); finished(id); }
      else for (const entry of mounted.values()) if (entry.id === id) update(entry);
    }
  }
  function paintAll(id, mood) {
    for (const entry of mounted.values()) if (entry.id === id) { paint(entry); if (mood) try { entry.ctx.refreshMood(); } catch {} }
  }
  function finished(id) {
    paintAll(id, true);
    try { host?.toast?.('Timer done'); } catch {}
    beep();
  }
  function dispatch(entry, action) {
    const before = timers.get(entry.id), after = nextState(before, action, Date.now());
    if (after === before) return;
    if (action === 'start' || action === 'resume' || (action === 'toggle' && after.status === 'running')) unlockAudio();
    setState(entry.id, after);
    if (after.status === 'done') finished(entry.id); else paintAll(entry.id, true);
    if (after.status === 'running' && before.status === 'idle') {
      const minutes = after.durationMs / 60000;
      if (entry.ctx.item.minutes !== minutes) Promise.resolve().then(() => entry.ctx.saveItem({ minutes })).catch(() => {});
    }
  }
  function setLength(entry, minutes) {
    const before = timers.get(entry.id), after = withMinutes(before, minutes);
    if (after.durationMs === before.durationMs) return;
    setState(entry.id, after); paintAll(entry.id, false);
  }

  // ---- Beeps: three short sine tones through Web Audio --------------------------
  function unlockAudio() {
    try {
      const Context = window.AudioContext || window.webkitAudioContext; if (!Context) return;
      audio = audio || new Context();
      if (audio.state === 'suspended') audio.resume().catch(() => {});
    } catch { audio = null; }
  }
  function beep() {
    if (!audio) return;
    const play = () => { try { const at = audio.currentTime + 0.05; for (let i = 0; i < 3; i++) tone(at + i * 0.28); } catch {} };
    try { if (audio.state === 'suspended') audio.resume().then(play, () => {}); else play(); } catch {}
  }
  function tone(at) {
    const oscillator = audio.createOscillator(), gain = audio.createGain();
    oscillator.type = 'sine'; oscillator.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, at); gain.gain.exponentialRampToValueAtTime(0.3, at + 0.015);
    gain.gain.setValueAtTime(0.3, at + 0.1); gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.12);
    oscillator.connect(gain); gain.connect(audio.destination); oscillator.start(at); oscillator.stop(at + 0.125);
  }

  // ---- DOM ---------------------------------------------------------------------
  function svgElement(name, attributes) { const node = document.createElementNS(SVG, name); for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value); return node; }
  function minusIcon() { const svg = svgElement('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' }); svg.append(svgElement('path', { d: 'M5 12h14' })); return svg; }
  // Press and hold repeats after 400 ms every 120 ms; a keyboard click steps once.
  function holdable(node, fn) {
    let delay = null, repeat = null;
    const stop = () => { clearTimeout(delay); clearInterval(repeat); delay = repeat = null; };
    node.addEventListener('pointerdown', event => { if (event.button > 0) return; stop(); fn(); delay = setTimeout(() => { repeat = setInterval(fn, 120); }, 400); });
    for (const type of ['pointerup', 'pointercancel', 'pointerleave']) node.addEventListener(type, stop);
    node.addEventListener('click', event => { if (event.detail === 0) fn(); });
    node.addEventListener('contextmenu', event => event.preventDefault());
  }
  function stepButton(entry, direction) {
    const label = direction > 0 ? 'More time' : 'Less time';
    const node = entry.ctx.el('button', `timer-step ${direction > 0 ? 'timer-plus' : 'timer-minus'}`); node.type = 'button';
    node.setAttribute('aria-label', label); node.title = label;
    node.append(direction > 0 ? entry.ctx.icon('plus') : minusIcon());
    holdable(node, () => { const state = timers.get(entry.id); if (state.status === 'idle') setLength(entry, step(state.durationMs / 60000, direction)); });
    return node;
  }
  function startButton(entry) { return entry.ctx.button('Start', () => dispatch(entry, 'start'), { className: 'button primary timer-main timer-start' }); }
  function resetButton(entry) { return entry.ctx.button('', () => dispatch(entry, 'reset'), { className: 'quiet-button timer-reset', icon: 'close', label: 'Reset timer' }); }
  function ringButton(entry) {
    const { ctx } = entry;
    const ring = ctx.button('', () => dispatch(entry, 'toggle'), { className: 'timer-ring' });
    const svg = svgElement('svg', { viewBox: '0 0 100 100', 'aria-hidden': 'true' });
    svg.append(svgElement('circle', { class: 'timer-track', cx: '50', cy: '50', r: '42' }), svgElement('circle', { class: 'timer-fill', cx: '50', cy: '50', r: '42' }));
    const center = ctx.el('span', 'timer-ring-center'); center.append(ctx.el('strong', 'timer-time'), ctx.el('span', 'timer-sub'));
    ring.append(svg, center); return ring;
  }
  function presets(entry) {
    const { ctx } = entry, box = ctx.el('div', 'timer-presets'); box.setAttribute('role', 'group'); box.setAttribute('aria-label', 'Timer presets');
    for (const minutes of PRESETS) { const chip = ctx.button(lengthLabel(minutes), () => setLength(entry, minutes), { className: 'timer-chip' }); chip.dataset.minutes = String(minutes); box.append(chip); }
    return box;
  }
  function controls(entry) {
    const { ctx } = entry, status = timers.get(entry.id).status, row = ctx.el('div', 'timer-controls');
    if (status === 'idle') row.append(stepButton(entry, -1), stepButton(entry, 1), startButton(entry));
    else if (status === 'done') row.append(ctx.button('Dismiss', () => dispatch(entry, 'dismiss'), { className: 'button timer-main timer-dismiss' }));
    else row.append(ctx.button(status === 'running' ? 'Pause' : 'Resume', () => dispatch(entry, 'toggle'), { className: 'button timer-main timer-toggle' }), resetButton(entry));
    return row;
  }
  // The structure for this layout and status; rebuilt only when the status changes.
  function build(entry) {
    const { root, ctx } = entry, status = timers.get(entry.id).status;
    root.replaceChildren(entry.live); root.dataset.status = status;
    if (root.dataset.layout === 'small') {
      if (status !== 'idle') { root.append(ringButton(entry), resetButton(entry)); return; }
      const setup = ctx.el('div', 'timer-setup'), row = ctx.el('div', 'timer-length-row');
      row.append(stepButton(entry, -1), ctx.el('strong', 'timer-length'), stepButton(entry, 1));
      setup.append(row, startButton(entry)); root.append(setup); return;
    }
    const side = ctx.el('div', 'timer-side'); side.append(presets(entry), controls(entry), ctx.el('p', 'timer-status'));
    root.append(ringButton(entry), side);
  }
  // The parts that change every second or with the length.
  function update(entry) {
    const { root, ctx } = entry, state = timers.get(entry.id), now = Date.now();
    const remaining = state.status === 'running' ? Math.max(0, state.endsAt - now) : state.status === 'paused' ? state.remainingMs : state.status === 'done' ? 0 : state.durationMs;
    const text = state.status === 'done' ? 'Done' : format(remaining), minutes = Math.round(state.durationMs / 60000), length = lengthLabel(minutes);
    const ends = state.status === 'running' || state.status === 'done' ? endsText(state.endsAt, ctx.clock24()) : '';
    root.toggleAttribute('data-long', text.length > 5);
    const ring = root.querySelector('.timer-ring');
    if (ring) {
      ring.querySelector('.timer-time').textContent = text;
      ring.querySelector('.timer-sub').textContent = state.status === 'running' ? `Ends at ${ends}` : state.status === 'paused' ? 'Paused' : state.status === 'done' ? length : 'Tap to start';
      const dash = state.status === 'done' ? ringDash(1, 1) : state.status === 'idle' ? ringDash(0, 1) : ringDash(remaining, state.durationMs), fill = ring.querySelector('.timer-fill');
      if (typeof ctx.glide === 'function') ctx.glide(`timer:${entry.id}`, fill, 'strokeDasharray', dash); else fill.style.strokeDasharray = dash;
      ring.setAttribute('aria-label', state.status === 'running' ? `Pause timer, ${text} left` : state.status === 'paused' ? `Resume timer, ${text} left` : state.status === 'done' ? `Timer done, ${length}. Dismiss` : `Start a ${length} timer`);
    }
    const big = root.querySelector('.timer-length'); if (big) big.textContent = text;
    for (const chip of root.querySelectorAll('.timer-chip')) { chip.setAttribute('aria-pressed', String(Number(chip.dataset.minutes) === minutes)); chip.disabled = state.status !== 'idle'; }
    const status = root.querySelector('.timer-status');
    if (status) status.textContent = state.status === 'running' ? `Ends at ${ends}` : state.status === 'paused' ? `Paused with ${text} left` : state.status === 'done' ? `Finished at ${ends}` : Number.isInteger(ctx.item.minutes) ? `Last used ${lengthLabel(ctx.item.minutes)}` : '';
    const announce = state.status === 'done' ? 'Timer done' : '';
    if (entry.live.textContent !== announce) entry.live.textContent = announce;
  }
  function paint(entry) {
    const status = timers.get(entry.id).status;
    if (entry.root.dataset.status !== status) {
      const focused = entry.root.contains(document.activeElement);
      build(entry);
      if (focused) (entry.root.querySelector('.timer-ring') || entry.root.querySelector('.timer-start') || entry.root.querySelector('button'))?.focus();
    }
    update(entry);
  }
  function render(body, ctx) {
    const id = String(ctx.item?.id || ctx.card?.id || 'timer'), layout = layoutOf(ctx);
    if (typeof ctx.config === 'function') host = { config: ctx.config, toast: ctx.toast };
    prune();
    load(id, minutesOf(ctx.item));
    let root = [...body.children].find(node => node.classList?.contains('timer-widget') && node.dataset.item === id);
    if (root && (root.dataset.size !== ctx.size || root.dataset.layout !== layout)) { root.remove(); root = null; }
    let entry = mounted.get(body);
    if (!root || !entry || entry.id !== id || entry.root !== root) {
      if (!root) {
        root = ctx.el('div', 'timer-widget'); root.dataset.item = id; root.dataset.size = ctx.size; root.dataset.layout = layout;
        const live = ctx.el('span', 'timer-sr'); live.setAttribute('aria-live', 'polite'); root.append(live);
        // Tapping anywhere on a done timer dismisses it.
        root.addEventListener('click', () => { const current = mounted.get(body); if (current && timers.get(id)?.status === 'done') dispatch(current, 'dismiss'); });
        body.replaceChildren(root);
      }
      entry = { id, root, live: root.querySelector(':scope > .timer-sr'), ctx };
    }
    entry.ctx = ctx; entry.root = root;
    mounted.set(body, entry);
    paint(entry);
    syncTicker();
    // The host sets the card's mood before this first render loads a saved timer.
    if (ctx.panel && (ctx.panel.dataset.mood || '') !== mood(ctx).mood) try { ctx.refreshMood(); } catch {}
  }
  function signature(ctx) { return [ctx.item?.minutes ?? null, ctx.size, ctx.clock24()]; }
  function mood(ctx) {
    const state = timers.get(String(ctx.item?.id || ctx.card?.id || 'timer'));
    const tone = state?.status === 'done' ? 'done' : state?.status === 'running' ? 'print' : state?.status === 'paused' ? 'paused' : '';
    return { mood: tone, attention: state?.status === 'done' };
  }
  // Previews and tests: end a running timer now.
  function debugFinish(id) {
    const key = String(id), state = timers.get(key);
    if (!state || state.status !== 'running') return false;
    setState(key, { ...state, endsAt: Date.now() - 1 }); tick(); return true;
  }
  function debugMounted() { return mounted.size; }

  window.EdgeWidgets = window.EdgeWidgets || {};
  window.EdgeWidgets.timer = Object.freeze({ render, signature, mood, live: true,
    helpers: Object.freeze({ format, lengthLabel, step, stepSize, ringDash, endsText, idleState, withMinutes, nextState, restore, layoutOf, minutesOf, hasView, clamp, debugFinish, debugMounted, PRESETS, MIN_MINUTES, MAX_MINUTES, DEFAULT_MINUTES }) });
})();
