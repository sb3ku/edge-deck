'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('widgets fill an 8×2 grid like iOS, filling gaps, and report what does not fit', () => {
  const { packWidgets, WIDGET_DEFAULTS } = require('../src/layout-engine.js');
  const widgets = ['today', 'tasks', 'printers', 'media', 'stats', 'actions'].map(type => ({ id: type, type, size: WIDGET_DEFAULTS[type] }));
  const plan = packWidgets(widgets, { columns: 8, rows: 2 });
  assert.deepEqual(plan.overflow, []); assert.equal(plan.free, 1, 'The default sizes fit the deck with one cell to spare');
  const media = plan.cards.find(card => card.id === 'media'); assert.deepEqual([media.columnSpan, media.rowSpan], [2, 2], 'Music starts Large: the full player');
  const gap = packWidgets([{ id: 'a', size: 'large' }, { id: 'b', size: 'medium' }, { id: 'c', size: 'small' }], { columns: 4, rows: 2 });
  // Large, medium, then small: column by column, the small one takes the free cell below the medium one.
  assert.deepEqual(gap.cards.find(card => card.id === 'c'), { id: 'c', column: 3, row: 2, columnSpan: 1, rowSpan: 1 }, 'A small widget fills the gap under a medium one');
  const full = packWidgets(Array.from({ length: 5 }, (_, i) => ({ id: `l${i}`, size: 'large' })), { columns: 8, rows: 2 });
  assert.deepEqual(full.overflow, ['l4']);
});

test('single-purpose widgets start small', () => {
  const { WIDGET_DEFAULTS } = require('../src/layout-engine.js');
  for (const type of ['gauge', 'switch', 'timer', 'machine']) assert.equal(WIDGET_DEFAULTS[type], 'small', type);
});
test('the browser gets the same layout engine without Node globals', () => {
  const context = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/layout-engine.js'), 'utf8'), context);
  const cards = [{ id: 'a', size: 'large' }, { id: 'b', size: 'tall' }, { id: 'c', size: 'medium' }];
  assert.equal(JSON.stringify(context.EdgeLayout.packWidgets(cards)), JSON.stringify(require('../lib/layout.cjs').packWidgets(cards)));
});

test('each widget offers only its own sizes, and a size snaps to the nearest one it has', () => {
  const { WIDGET_KINDS, allowedSizes, fitSize } = require('../src/layout-engine.js');
  assert.deepEqual(allowedSizes('tasks'), ['medium', 'large', 'tall']);
  assert.equal(fitSize('tasks', 'small'), 'medium');
  assert.equal(fitSize('city', 'large'), 'small');
  assert.equal(fitSize('clock', 'tall'), 'large');
  assert.equal(fitSize(['clock', 'weather'], 'tall'), 'large', 'A card with several views offers the sizes they share');
  for (const kind of WIDGET_KINDS) assert.ok(kind.sizes.length > 0 && kind.sizes.every(size => ['small', 'medium', 'large', 'tall'].includes(size)), kind.type);
});
