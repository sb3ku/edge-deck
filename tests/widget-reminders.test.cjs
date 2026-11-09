'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Loads the Reminders module in a minimal browser-like context; the helpers under test need no DOM.
function load() {
  const context = { document: {} };
  context.window = context; vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'widget-reminders.js'), 'utf8'), context);
  const widget = context.window.EdgeWidgets.reminders, helpers = {};
  for (const [name, value] of Object.entries(widget.helpers)) helpers[name] = typeof value === 'function' ? (...args) => structuredClone(value(...args)) : structuredClone(value);
  return { ...widget, helpers, signature: ctx => structuredClone(widget.signature(ctx)) };
}
const item = (id, done = false, text = `Item ${id}`) => ({ id, text, done, doneAt: done ? '2026-11-09T09:00:00.000Z' : null, createdAt: '2026-11-09T08:00:00.000Z' });
const many = (open, done = 0) => [...Array.from({ length: open }, (_, i) => item('o' + i)), ...Array.from({ length: done }, (_, i) => item('d' + i, true))];

test('the module registers render, signature and helpers', () => {
  const widget = load();
  assert.equal(typeof widget.render, 'function');
  assert.equal(typeof widget.signature, 'function');
  assert.ok(Object.isFrozen(widget) || typeof widget.helpers === 'object');
});

test('signature is the reminders and the size', () => {
  const { signature } = load(), reminders = { items: [item('a')] };
  assert.deepEqual(signature({ state: () => ({ config: { reminders } }), size: 'large' }), [reminders, 'large']);
});

test('cleanText trims and rejects empty, long and control-character text', () => {
  const { helpers } = load();
  assert.equal(helpers.cleanText('  Buy filament  '), 'Buy filament');
  for (const bad of ['', '   ', 'x'.repeat(121), 'a\nb', 'a\u0000b', 'ta\tb', null, 5]) assert.equal(helpers.cleanText(bad), '', String(bad));
  assert.equal(helpers.cleanText('x'.repeat(120)).length, 120);
});

test('addItem appends a trimmed open reminder and respects the 100 limit', () => {
  const { helpers } = load();
  const added = helpers.addItem([item('a')], '  Call the plumber ', Date.UTC(2026, 10, 9), 'new1');
  assert.deepEqual(added[1], { id: 'new1', text: 'Call the plumber', done: false, doneAt: null, createdAt: '2026-11-09T00:00:00.000Z' });
  assert.equal(helpers.addItem([item('a')], '   ').length, 1);
  assert.equal(helpers.addItem(many(100), 'one more').length, 100);
  assert.match(helpers.makeId(), /^[A-Za-z0-9_-]{1,40}$/);
});

test('setDone, removeItem and clearDone change only what they should', () => {
  const { helpers } = load(), list = [item('a'), item('b', true)];
  const ticked = helpers.setDone(list, 'a', true, Date.UTC(2026, 10, 9, 12));
  assert.deepEqual([ticked[0].done, ticked[0].doneAt], [true, '2026-11-09T12:00:00.000Z']);
  const unticked = helpers.setDone(list, 'b', false);
  assert.deepEqual([unticked[1].done, unticked[1].doneAt], [false, null]);
  assert.deepEqual(helpers.removeItem(list, 'a').map(i => i.id), ['b']);
  assert.deepEqual(helpers.clearDone(list).map(i => i.id), ['a']);
});

test('view limits rows per size: open first, completed only on Large, "+N more" for the rest', () => {
  const { helpers } = load();
  let shown = helpers.view(many(8, 2), 'small');
  assert.deepEqual([shown.shownOpen.length, shown.shownDone.length, shown.hidden], [3, 0, 5]);
  shown = helpers.view(many(8, 2), 'medium');
  assert.deepEqual([shown.shownOpen.length, shown.shownDone.length, shown.hidden], [6, 0, 2]);
  shown = helpers.view(many(8, 2), 'large');
  assert.deepEqual([shown.shownOpen.length, shown.shownDone.length, shown.hidden], [8, 2, 0]);
  shown = helpers.view(many(12, 3), 'large');
  assert.deepEqual([shown.shownOpen.length, shown.shownDone.length, shown.hidden], [9, 0, 6], 'one row of room is kept for "+N more"');
  shown = helpers.view(many(2, 20), 'large');
  assert.deepEqual([shown.shownOpen.length, shown.shownDone.length, shown.hidden], [2, 7, 13]);
  assert.equal(helpers.view([], 'huge').size, 'medium');
  assert.equal(helpers.moreText(4), '+4 more');
});

test('itemsOf ignores malformed entries', () => {
  const { helpers } = load();
  assert.deepEqual(helpers.itemsOf(undefined), []);
  assert.deepEqual(helpers.itemsOf({ items: [null, { id: 1, text: 'x' }, item('a')] }).map(i => i.id), ['a']);
});

test('the module has no innerHTML and its CSS stays under .rem-*', () => {
  const root = path.join(__dirname, '..', 'src');
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML/.test(fs.readFileSync(path.join(root, 'widget-reminders.js'), 'utf8')));
  const css = fs.readFileSync(path.join(root, 'widget-reminders.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const rule of css.match(/[^{}]+(?=\{)/g) || []) {
    const text = rule.trim();
    if (text.startsWith('@')) continue;
    for (const selector of text.split(',')) assert.match(selector.trim(), /\.rem-|\.reminders|^\d+%$|^(from|to)$|^\.container-card\.reminders|^html\.low-power/, selector);
  }
});
