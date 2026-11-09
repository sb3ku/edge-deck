'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// A tiny DOM: enough for the module to build its tree and for the tests to walk it.
function node(tag) {
  const element = {
    tag, children: [], attributes: {}, dataset: {}, style: { setProperty(name, value) { element.style[name] = value; } }, className: '', textContent: '', isConnected: true,
    append(...nodes) { element.children.push(...nodes); },
    replaceChildren(...nodes) { element.children = nodes; },
    setAttribute(name, value) { element.attributes[name] = String(value); },
  };
  return element;
}
const fakeDocument = { createElement: tag => node(tag), createElementNS: (namespace, tag) => node(tag), createTextNode: text => ({ tag: '#text', textContent: String(text), children: [] }) };
function load() {
  const context = { document: fakeDocument, setTimeout: () => 0, clearTimeout() {}, Promise, JSON, Date };
  context.window = context; vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'widget-batteries.js'), 'utf8'), context);
  return context.EdgeWidgets.batteries;
}
const makeCtx = (size, bridge) => ({ size, bridge, el: (tag, cls, text) => { const element = node(tag); element.className = cls || ''; if (text) element.textContent = text; return element; }, icon: name => node(`icon-${name}`) });
const walk = (root, visit) => { visit(root); for (const child of root.children || []) walk(child, visit); };
const texts = root => { const out = []; walk(root, item => { if (item.textContent) out.push(item.textContent); }); return out; };
const count = (root, cls) => { let n = 0; walk(root, item => { if (String(item.className).split(' ').includes(cls)) n += 1; }); return n; };
const same = (actual, expected) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected);
const settle = () => new Promise(resolve => setImmediate(resolve));
const DEVICES = [
  { name: 'Headset', level: 80, connected: true, kind: 'headset' }, { name: 'Pad', level: 15, connected: true, kind: 'controller' },
  { name: 'Mouse', level: 55, connected: true, kind: 'mouse', charging: true }, { name: 'Phone', level: 9, connected: false, kind: 'phone' },
  { name: 'Keys', level: 70, connected: true, kind: 'keyboard' }, { name: 'Other', level: 40, connected: true, kind: 'weird' }, { name: 'Seventh', level: 30, connected: true, kind: 'mouse' },
];

test('the colour follows the level: green, yellow at 20 or less, red at 10 or less, green while charging', () => {
  const { tone } = load().helpers;
  assert.equal(tone(80, false), '#30d158'); assert.equal(tone(21, false), '#30d158');
  assert.equal(tone(20, false), '#ffd60a'); assert.equal(tone(11, false), '#ffd60a');
  assert.equal(tone(10, false), '#ff453a'); assert.equal(tone(0, false), '#ff453a');
  assert.equal(tone(5, true), '#30d158');
});

test('pick keeps devices with a level, connected first, and as many as the size fits', () => {
  const { pick } = load().helpers;
  assert.equal(pick(DEVICES, 'small').length, 4); assert.equal(pick(DEVICES, 'medium').length, 4); assert.equal(pick(DEVICES, 'large').length, 6);
  assert.ok(!pick(DEVICES, 'large').some(device => device.name === 'Phone'), 'the one that is away comes last, and is cut');
  same(pick([{ name: 'No level' }, { name: 'Text', level: 'x' }, null, { name: 'Ok', level: 130, kind: 'nope' }], 'large'), [{ name: 'Ok', level: 100, connected: true, kind: 'other', charging: false }]);
  same(pick(undefined, 'small'), []);
});

test('without a bridge the empty state shows; its signature is the size and the cache version', async () => {
  const widget = load();
  const body = node('div'); const ctx = makeCtx('medium', null);
  widget.render(body, ctx);
  assert.deepEqual(texts(body), ['No batteries found', 'Connect a Bluetooth headset or controller that reports its charge.']);
  same(widget.signature(ctx), ['medium', 0]);
});

test('render fetches once, redraws in place, and each size shows its own layout', async () => {
  const widget = load(); let calls = 0;
  const bridge = { systemList: async kind => { calls += 1; assert.equal(kind, 'batteries'); return DEVICES; } };
  const small = node('div'), medium = node('div'), large = node('div');
  const ctxs = [makeCtx('small', bridge), makeCtx('medium', bridge), makeCtx('large', bridge)];
  widget.render(small, ctxs[0]); widget.render(medium, ctxs[1]); widget.render(large, ctxs[2]);
  assert.equal(count(small, 'batt-ring'), 0, 'nothing is drawn while the first read is on its way');
  await settle();
  assert.equal(calls, 1, 'one shared fetch');
  same(widget.signature(ctxs[0]), ['small', 1]);
  assert.equal(count(small, 'batt-ring'), 4); assert.equal(count(small, 'batt-percent'), 0);
  assert.equal(count(medium, 'batt-ring'), 4); assert.equal(count(medium, 'batt-percent'), 4);
  assert.equal(count(large, 'batt-row'), 6);
  assert.ok(texts(medium).includes('55%')); assert.ok(texts(large).includes('Charging'));
  widget.render(small, ctxs[0]); await settle();
  assert.equal(calls, 1, 'a fresh cache is not read again');
});

test('one device gets one big ring with its percent; bodies that left are dropped; a failed read keeps the last list', async () => {
  const widget = load(); let answer = [DEVICES[0]];
  const bridge = { systemList: async () => { if (answer === null) throw Error('boom'); return answer; } };
  const gone = node('div'), body = node('div'); const ctx = makeCtx('small', bridge);
  widget.render(gone, makeCtx('small', bridge)); widget.render(body, ctx); await settle();
  assert.equal(count(body, 'batt-ring'), 1); assert.deepEqual(texts(body).filter(text => /%/.test(text)), ['80%']);
  gone.isConnected = false; answer = null; widget.helpers.cache.at = 0;
  widget.render(body, ctx); await settle();
  assert.equal(widget.helpers.mounted.has(gone), false);
  assert.equal(count(body, 'batt-ring'), 1, 'the last known level stays');
  answer = []; widget.helpers.cache.at = 0; widget.render(body, ctx); await settle();
  assert.equal(count(body, 'batt-ring'), 0); assert.ok(texts(body).includes('No batteries found'));
});
