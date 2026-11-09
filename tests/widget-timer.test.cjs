'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Loads the timer module in a minimal browser-like context; only the pure helpers are exercised here.
function load() {
  const context = { document: { addEventListener() {} } };
  context.window = context; vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'widget-timer.js'), 'utf8'), context);
  return context.EdgeWidgets.timer;
}
const MINUTE = 60000;
// Objects made inside the vm have another realm's prototype; compare them as plain data.
const plain = value => JSON.parse(JSON.stringify(value));
const same = (actual, expected, message) => assert.deepEqual(plain(actual), plain(expected), message);

test('the module registers a live widget with helpers and a cheap signature', () => {
  const timer = load();
  assert.equal(timer.live, true);
  assert.equal(typeof timer.render, 'function');
  same(timer.signature({ item: { minutes: 25 }, size: 'small', clock24: () => true }), [25, 'small', true]);
  same(timer.signature({ item: {}, size: 'medium', clock24: () => false }), [null, 'medium', false]);
  same(timer.mood({ item: { id: 'nothing' } }), { mood: '', attention: false });
});

test('remaining time reads mm:ss, and h:mm:ss from an hour, rounded up to whole seconds', () => {
  const { format } = load().helpers;
  assert.equal(format(0), '00:00');
  assert.equal(format(59000), '00:59');
  assert.equal(format(59001), '01:00');
  assert.equal(format(10 * MINUTE), '10:00');
  assert.equal(format(10 * MINUTE - 1), '10:00');
  assert.equal(format(10 * MINUTE - 1000), '09:59');
  assert.equal(format(65 * MINUTE), '1:05:00');
  assert.equal(format(60 * MINUTE), '1:00:00');
  assert.equal(format(720 * MINUTE), '12:00:00');
  assert.equal(format(-5000), '00:00');
  assert.equal(format(NaN), '00:00');
  assert.equal(format(undefined), '00:00');
});

test('length labels and the minute clamp', () => {
  const { lengthLabel, clamp, minutesOf, MIN_MINUTES, MAX_MINUTES, DEFAULT_MINUTES } = load().helpers;
  assert.equal(lengthLabel(1), '1 min');
  assert.equal(lengthLabel(45), '45 min');
  assert.equal(lengthLabel(60), '1 h');
  assert.equal(lengthLabel(90), '1 h 30 min');
  assert.equal(lengthLabel(720), '12 h');
  assert.equal(clamp(0), MIN_MINUTES);
  assert.equal(clamp(9999), MAX_MINUTES);
  assert.equal(clamp(7.4), 7);
  assert.equal(clamp('x'), MIN_MINUTES);
  assert.equal(minutesOf({ minutes: 25 }), 25);
  assert.equal(minutesOf({ minutes: 721 }), DEFAULT_MINUTES);
  assert.equal(minutesOf({ minutes: 2.5 }), DEFAULT_MINUTES);
  assert.equal(minutesOf({}), DEFAULT_MINUTES);
  assert.equal(minutesOf(undefined), DEFAULT_MINUTES);
});

test('the step table: 1 min below 5, 5 to 30, 10 to 2 h, then 30, snapping unaligned lengths', () => {
  const { step } = load().helpers;
  const up = { 1: 2, 4: 5, 5: 10, 7: 10, 25: 30, 30: 40, 33: 40, 110: 120, 120: 150, 130: 150, 690: 720, 720: 720 };
  const down = { 1: 1, 2: 1, 5: 4, 6: 5, 7: 5, 10: 5, 30: 25, 31: 30, 40: 30, 120: 110, 121: 120, 150: 120, 720: 690 };
  for (const [from, to] of Object.entries(up)) assert.equal(step(Number(from), 1), to, `${from} up`);
  for (const [from, to] of Object.entries(down)) assert.equal(step(Number(from), -1), to, `${from} down`);
  assert.equal(step(undefined, 1), 2, 'an unknown length counts as the minimum');
});

test('the state machine with fake clocks: start, pause, resume, finish, dismiss', () => {
  const { idleState, nextState, withMinutes } = load().helpers;
  const idle = idleState(10);
  same(idle, { status: 'idle', durationMs: 10 * MINUTE, endsAt: null, remainingMs: null, startedAt: null });
  const running = nextState(idle, 'start', 1000);
  same(running, { status: 'running', durationMs: 10 * MINUTE, endsAt: 1000 + 10 * MINUTE, remainingMs: null, startedAt: 1000 });
  assert.equal(nextState(running, 'tick', 300000), running, 'a tick before the end changes nothing');
  assert.equal(nextState(running, 'start', 300000), running, 'start does not apply while running');
  const paused = nextState(running, 'pause', 301000);
  same(paused, { ...running, status: 'paused', endsAt: null, remainingMs: 300000 });
  assert.equal(nextState(paused, 'pause', 302000), paused);
  const resumed = nextState(paused, 'resume', 400000);
  same(resumed, { ...running, endsAt: 700000, remainingMs: null });
  assert.equal(nextState(resumed, 'tick', 699999), resumed);
  const done = nextState(resumed, 'tick', 700000);
  same(done, { ...resumed, status: 'done', remainingMs: 0 });
  assert.equal(done.endsAt, 700000, 'done keeps the time it ended');
  assert.equal(nextState(done, 'tick', 800000), done);
  same(nextState(done, 'dismiss', 800000), idle, 'dismissing returns to idle with the same length');
  same(nextState(running, 'reset', 2000), idle, 'reset returns to idle with the same length');
  assert.equal(nextState(idle, 'reset', 2000), idle);
  assert.equal(nextState(idle, 'nonsense', 2000), idle);
  // toggle is what the ring does: start, pause, resume or dismiss depending on the status.
  assert.equal(nextState(idle, 'toggle', 1000).status, 'running');
  assert.equal(nextState(running, 'toggle', 2000).status, 'paused');
  assert.equal(nextState(paused, 'toggle', 2000).status, 'running');
  assert.equal(nextState(done, 'toggle', 2000).status, 'idle');
  // The length can only change while idle, and is clamped.
  assert.equal(withMinutes(idle, 25).durationMs, 25 * MINUTE);
  assert.equal(withMinutes(idle, 0).durationMs, MINUTE);
  assert.equal(withMinutes(idle, 100000).durationMs, 720 * MINUTE);
  assert.equal(withMinutes(running, 25), running);
  // A pause right at the end leaves nothing, and an unknown state starts over.
  assert.equal(nextState(running, 'pause', 10 * MINUTE + 5000).remainingMs, 0);
  assert.equal(nextState({ status: 'weird' }, 'start', 1000).durationMs, 10 * MINUTE);
});

test('restoring from storage: an expired running timer is done; junk is ignored', () => {
  const { restore } = load().helpers;
  const now = 5 * MINUTE;
  const running = JSON.stringify({ status: 'running', durationMs: 10 * MINUTE, endsAt: now + 2 * MINUTE, remainingMs: null, startedAt: now - 8 * MINUTE });
  same(restore(running, now), { status: 'running', durationMs: 10 * MINUTE, endsAt: now + 2 * MINUTE, remainingMs: null, startedAt: now - 8 * MINUTE });
  const expired = JSON.stringify({ status: 'running', durationMs: 10 * MINUTE, endsAt: now - 1, startedAt: 0 });
  same(restore(expired, now), { status: 'done', durationMs: 10 * MINUTE, endsAt: now - 1, remainingMs: 0, startedAt: 0 });
  assert.equal(restore(JSON.stringify({ status: 'running', durationMs: 10 * MINUTE, endsAt: now }), now).status, 'done', 'ending exactly now counts as done');
  const paused = restore(JSON.stringify({ status: 'paused', durationMs: 3 * MINUTE, remainingMs: 90000 }), now);
  same(paused, { status: 'paused', durationMs: 3 * MINUTE, endsAt: null, remainingMs: 90000, startedAt: null });
  assert.equal(restore(JSON.stringify({ status: 'paused', durationMs: 3 * MINUTE, remainingMs: 0 }), now).status, 'done');
  same(restore({ status: 'idle', durationMs: 25 * MINUTE }, now), { status: 'idle', durationMs: 25 * MINUTE, endsAt: null, remainingMs: null, startedAt: null });
  assert.equal(restore(JSON.stringify({ status: 'idle', durationMs: 25 * MINUTE + 20 }), now).durationMs, 25 * MINUTE, 'lengths are whole minutes');
  assert.equal(restore(JSON.stringify({ status: 'done', durationMs: MINUTE, endsAt: 100 }), now).status, 'done');
  for (const junk of [null, undefined, '', 'not json', '42', JSON.stringify({ status: 'flying', durationMs: MINUTE }), JSON.stringify({ status: 'idle', durationMs: 0 }),
    JSON.stringify({ status: 'idle', durationMs: 721 * MINUTE }), JSON.stringify({ status: 'running', durationMs: MINUTE }), JSON.stringify({ status: 'paused', durationMs: MINUTE, remainingMs: 'soon' }), JSON.stringify({ status: 'idle' })]) {
    assert.equal(restore(junk, now), null, String(junk));
  }
});

test('the ring dash follows the remaining fraction and clamps', () => {
  const { ringDash } = load().helpers;
  const full = parseFloat(ringDash(10 * MINUTE, 10 * MINUTE)), half = parseFloat(ringDash(5 * MINUTE, 10 * MINUTE));
  assert.ok(Math.abs(full - 263.9) < 0.05, 'a full ring');
  assert.ok(Math.abs(half - 131.95) < 0.1, 'half a ring');
  assert.equal(ringDash(0, 10 * MINUTE), '0.0 263.9');
  assert.equal(ringDash(20 * MINUTE, 10 * MINUTE), ringDash(10 * MINUTE, 10 * MINUTE), 'more than the length is a full ring');
  assert.equal(ringDash(-1, 10 * MINUTE), '0.0 263.9');
  assert.equal(ringDash(5, 0), '0.0 263.9', 'no length is an empty ring');
  assert.equal(ringDash(NaN, 10 * MINUTE), '0.0 263.9');
  assert.ok(ringDash(1, 10 * MINUTE).endsWith(' 263.9'), 'the gap is the whole circumference');
});

test('"Ends at" follows the clock setting', () => {
  const { endsText } = load().helpers;
  const at = new Date(2026, 0, 1, 14, 32).getTime();
  assert.equal(endsText(at, true), '14:32');
  assert.match(endsText(at, false), /^0?2:32\s?pm$/i);
  assert.equal(endsText(NaN, true).includes('NaN'), false);
});

test('the arrangement: Small, Large and Tall in the Widgets grid, Medium everywhere else', () => {
  const { layoutOf } = load().helpers;
  assert.equal(layoutOf({ mode: 'widgets', size: 'small' }), 'small');
  assert.equal(layoutOf({ mode: 'widgets', size: 'medium' }), 'medium');
  assert.equal(layoutOf({ mode: 'widgets', size: 'large' }), 'large');
  assert.equal(layoutOf({ mode: 'widgets', size: 'tall' }), 'tall');
  assert.equal(layoutOf({ mode: 'widgets', size: 'wide' }), 'medium');
  assert.equal(layoutOf({ mode: 'overview', size: 'small' }), 'medium');
  assert.equal(layoutOf({ mode: 'bento', size: 'large' }), 'medium');
});

test('finishing a timer that is not running does nothing', () => {
  const { debugFinish } = load().helpers;
  assert.equal(debugFinish('never-rendered'), false);
});

test('a view exists while the config has a timer item with its id, in either card shape', () => {
  const { hasView } = load().helpers;
  const config = { widgets: [
    { id: 'a', type: 'timer', items: [{ id: 'a-1', type: 'timer', minutes: 5 }, { id: 'a-2', type: 'gauge', metric: 'cpu' }] },
    { id: 'b', type: 'timer' }, { id: 'c', type: 'clock' }] };
  assert.equal(hasView(config, 'a-1'), true);
  assert.equal(hasView(config, 'a-2'), false, 'the view changed type');
  assert.equal(hasView(config, 'a'), false, 'a card id is not a view id when the card has views');
  assert.equal(hasView(config, 'b-content'), true, 'a card without its own views shows one content view');
  assert.equal(hasView(config, 'c-content'), false);
  assert.equal(hasView(config, 'gone'), false);
  assert.equal(hasView({}, 'a-1'), false);
  assert.equal(hasView(null, 'a-1'), false);
});

// A small fake DOM: enough of Element for the widget's render path (class and
// tag selectors, ":scope >" children, dataset, attributes, text, click bubbling).
function fakeDocument() {
  const connected = new Set();
  class Node {
    constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.parent = null; this.attrs = {}; this.dataset = {}; this.style = {}; this.listeners = {}; this.text = ''; this.classes = new Set(); this.disabled = false; }
    get className() { return [...this.classes].join(' '); }
    set className(value) { this.classes = new Set(String(value).split(/\s+/).filter(Boolean)); }
    get classList() { const classes = this.classes; return { contains: name => classes.has(name), add: (...names) => names.forEach(name => classes.add(name)), remove: (...names) => names.forEach(name => classes.delete(name)) }; }
    get isConnected() { let node = this; while (node.parent) node = node.parent; return connected.has(node); }
    get textContent() { return this.text + this.children.map(child => child.textContent).join(''); }
    set textContent(value) { this.text = String(value); this.children = []; }
    append(...nodes) { for (const node of nodes) { node.remove(); node.parent = this; this.children.push(node); } }
    replaceChildren(...nodes) { for (const child of this.children) child.parent = null; this.children = []; this.append(...nodes); }
    remove() { if (this.parent) { this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; } }
    contains(node) { for (let n = node; n; n = n.parent) if (n === this) return true; return false; }
    setAttribute(name, value) { this.attrs[name] = String(value); if (name === 'class') this.className = value; }
    getAttribute(name) { return this.attrs[name] ?? null; }
    hasAttribute(name) { return name in this.attrs; }
    toggleAttribute(name, force) { if (force) this.attrs[name] = ''; else delete this.attrs[name]; }
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
    click() { for (let node = this; node; node = node.parent) for (const fn of node.listeners.click || []) fn({ detail: 1, target: this }); }
    focus() {}
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    querySelectorAll(selector) {
      const direct = selector.startsWith(':scope > '), wanted = direct ? selector.slice(9) : selector, out = [];
      const matches = node => wanted.startsWith('.') ? node.classes.has(wanted.slice(1)) : node.tagName === wanted.toUpperCase();
      const walk = node => { for (const child of node.children) { if (matches(child)) out.push(child); if (!direct) walk(child); } };
      walk(this); return out;
    }
  }
  return { activeElement: null, addEventListener() {}, createElement: tag => new Node(tag), createElementNS: (ns, tag) => new Node(tag), connect: node => connected.add(node), disconnect: node => connected.delete(node) };
}
// The module with the fake DOM, hand-run intervals and an in-memory localStorage.
function loadWithDom() {
  const document = fakeDocument(), intervals = new Map(), storage = new Map();
  let nextId = 0;
  const context = { document, setInterval: (fn, ms) => { intervals.set(++nextId, { fn, ms }); return nextId; }, clearInterval: id => { intervals.delete(id); }, setTimeout: () => 0, clearTimeout() {},
    localStorage: { getItem: key => storage.has(key) ? storage.get(key) : null, setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key) } };
  context.window = context; vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'widget-timer.js'), 'utf8'), context);
  const config = { widgets: [{ id: 'c1', type: 'timer', size: 'small', items: [{ id: 'v1', type: 'timer', minutes: 10 }], activeItemId: 'v1' }] };
  const log = { toasts: [], moods: 0, saved: [] };
  const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text) node.textContent = text; return node; };
  const ctx = { card: config.widgets[0], item: config.widgets[0].items[0], panel: el('section'), size: 'small', mode: 'widgets', el,
    icon: () => document.createElementNS('svg', 'svg'),
    button: (text, fn, options = {}) => { const node = el('button', options.className || 'button', text); node.type = 'button'; if (options.label) node.setAttribute('aria-label', options.label); node.addEventListener('click', fn); return node; },
    clock24: () => true, lowPower: () => false, refreshMood: () => { log.moods++; }, toast: message => log.toasts.push(message), saveItem: async patch => { log.saved.push(patch); }, config: () => config };
  const body = () => { const node = el('div', 'card-body'); document.connect(node); return node; };
  const saved = () => JSON.parse(storage.get('edge-deck:timer:v1') || 'null');
  return { timer: context.EdgeWidgets.timer, document, intervals, storage, config, log, ctx, body, saved, tick: () => { for (const { fn } of [...intervals.values()]) fn(); } };
}

test('a running timer whose card was removed is forgotten on the next tick, with no toast and no storage left', () => {
  const { timer, document, intervals, storage, config, log, ctx, body, saved, tick } = loadWithDom();
  const first = body(); timer.render(first, ctx);
  first.querySelector('.timer-start').click();
  assert.equal(first.querySelector('.timer-widget').dataset.status, 'running');
  assert.deepEqual([...intervals.values()].map(entry => entry.ms), [1000], 'the ticker runs');
  assert.equal(saved().status, 'running');
  // The host removes the card: its panel leaves the DOM and the view leaves the config.
  document.disconnect(first); config.widgets = [];
  tick();
  assert.deepEqual([...intervals.values()], [], 'the ticker stopped');
  assert.equal(storage.has('edge-deck:timer:v1'), false, 'the saved record is gone');
  assert.equal(timer.helpers.debugFinish('v1'), false, 'nothing left to finish');
  assert.deepEqual(log.toasts, [], 'nothing was announced for a card that no longer exists');
  assert.equal(timer.helpers.debugMounted(), 0);
});

test('a timer on another page keeps running while its card is out of the DOM, and still announces the end', () => {
  const { timer, document, intervals, log, ctx, body, saved, tick } = loadWithDom();
  const first = body(); timer.render(first, ctx);
  first.querySelector('.timer-start').click();
  document.disconnect(first); // the page changed; the config still has the view
  tick();
  assert.deepEqual([...intervals.values()].map(entry => entry.ms), [1000], 'still ticking');
  assert.equal(saved().status, 'running');
  assert.equal(timer.helpers.debugFinish('v1'), true);
  assert.equal(saved().status, 'done');
  assert.deepEqual(log.toasts, ['Timer done']);
  assert.deepEqual([...intervals.values()], [], 'nothing runs once it is done');
  // Back on the page the host gives the view a new body, which shows the finished timer.
  const second = body(); timer.render(second, ctx);
  assert.equal(second.querySelector('.timer-widget').dataset.status, 'done');
  assert.equal(second.querySelector('.timer-time').textContent, 'Done');
  same(timer.mood(ctx), { mood: 'done', attention: true });
  assert.ok(log.moods > 0, 'the card was asked to refresh its mood');
  second.querySelector('.timer-ring').click();
  assert.equal(second.querySelector('.timer-widget').dataset.status, 'idle', 'a tap dismisses the done timer');
  assert.equal(second.querySelector('.timer-length').textContent, '10:00');
});

test('card bodies the host removed are released on the next render, even with nothing running', () => {
  const { timer, document, ctx, body } = loadWithDom();
  const first = body(); timer.render(first, ctx);
  assert.equal(timer.helpers.debugMounted(), 1);
  document.disconnect(first);
  const second = body(); timer.render(second, ctx);
  assert.equal(timer.helpers.debugMounted(), 1, 'only the connected body is kept');
  assert.equal(timer.helpers.debugFinish('v1'), false, 'an idle timer is kept but has nothing to finish');
});

test('a changed length is saved on the view when the timer starts', async () => {
  const { timer, ctx, body, log } = loadWithDom();
  const first = body(); timer.render(first, ctx);
  first.querySelector('.timer-plus').click(); // a keyboard click (detail 0) steps once
  assert.equal(first.querySelector('.timer-length').textContent, '10:00', 'a pointer click is handled by the hold logic, not the click');
  first.querySelector('.timer-plus').listeners.click[0]({ detail: 0 });
  assert.equal(first.querySelector('.timer-length').textContent, '15:00');
  first.querySelector('.timer-start').click();
  await Promise.resolve(); await Promise.resolve();
  same(log.saved, [{ minutes: 15 }]);
});
