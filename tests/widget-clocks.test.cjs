'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Loads the clocks module in a minimal browser-like context; only the pure helpers are exercised here.
function load() {
  const context = { document: { addEventListener() {} }, EdgeLayout: { CITIES: [
    { id: 'cupertino', name: 'Cupertino', short: 'CUP', zone: 'America/Los_Angeles' },
    { id: 'tokyo', name: 'Tokyo', short: 'TYO', zone: 'Asia/Tokyo' },
  ], WORLD_CLOCK_DEFAULT: ['cupertino', 'tokyo'] } };
  context.window = context; vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'widget-clocks.js'), 'utf8'), context);
  return context.EdgeWidgets;
}
const plain = value => JSON.parse(JSON.stringify(value));

test('registers three live widgets with the signature from the brief', () => {
  const widgets = load();
  for (const type of ['dial', 'city', 'world-clock']) { assert.equal(widgets[type].live, true); assert.equal(typeof widgets[type].render, 'function'); }
  const sig = widgets.dial.signature({ item: { face: 'bars', city: 'x', cities: ['a'] }, size: 'large', clock24: () => true });
  assert.deepEqual(plain(sig), ['bars', 'x', ['a'], 'large', true]);
});

test('zone wall clock and offsets, including half hours and negative', () => {
  const { helpers } = load().dial;
  const at = new Date('2026-01-15T12:00:00Z');
  const tokyo = helpers.zoneClock('Asia/Tokyo', at);
  assert.deepEqual(plain(tokyo), { year: 2026, month: 1, day: 15, hour: 21, minute: 0, second: 0 });
  const utcMidnight = helpers.zoneClock('UTC', new Date('2026-01-15T00:00:00Z'));
  assert.equal(utcMidnight.hour, 0);
  // Offsets are relative to local, so compare two zones through the local one.
  const local = helpers.offsetMinutes('Asia/Kolkata', at) - helpers.offsetMinutes('UTC', at);
  assert.equal(local, 330);
  assert.equal(helpers.offsetMinutes('America/Los_Angeles', at) - helpers.offsetMinutes('Asia/Tokyo', at), -17 * 60);
});

test('offset text and hour labels', () => {
  const { helpers } = load().dial;
  assert.equal(helpers.offsetText(0), '0');
  assert.equal(helpers.offsetText(60), '+1');
  assert.equal(helpers.offsetText(-540), '-9');
  assert.equal(helpers.offsetText(330), '+5:30');
  assert.equal(helpers.offsetText(-210), '-3:30');
  assert.equal(helpers.offsetHours(480), '+8HRS');
  assert.equal(helpers.offsetHours(-540), '-9HRS');
  assert.equal(helpers.offsetHours(0), '+0HRS');
  assert.equal(helpers.offsetHours(330), '+5:30HRS');
});

test('day label compares the zone date with the local date', () => {
  const { helpers } = load().dial;
  const at = new Date('2026-01-15T12:00:00Z');
  assert.equal(helpers.dayLabel(null, at), 'Today');
  // Kiritimati is UTC+14 and Baker Island UTC-12: one of them is on another local date than the other.
  const labels = new Set([helpers.dayLabel('Pacific/Kiritimati', at), helpers.dayLabel('Etc/GMT+12', at)]);
  assert.ok(labels.has('Tomorrow') || labels.has('Yesterday'));
});

test('hand angles, with and without seconds', () => {
  const { helpers } = load().dial;
  assert.deepEqual(plain(helpers.handAngles(3, 0, 0)), { hour: 90, minute: 0, second: 0 });
  assert.deepEqual(plain(helpers.handAngles(15, 30, 30)), { hour: 105 + 0.25, minute: 183, second: 180 });
  assert.deepEqual(plain(helpers.handAngles(12, 15, 59, false)), { hour: 7.5, minute: 90, second: 0 });
});

test('ticks light up to the current second and none without seconds', () => {
  const { helpers } = load().dial;
  assert.equal(helpers.tickLit(0, 0), true);
  assert.equal(helpers.tickLit(10, 10), true);
  assert.equal(helpers.tickLit(11, 10), false);
  assert.equal(helpers.tickLit(0, null), false);
});

test('digital time text: 24 hour padded, 12 hour without suffix', () => {
  const { helpers } = load().dial;
  assert.equal(helpers.timeText({ hour: 1, minute: 29 }, true), '01:29');
  assert.equal(helpers.timeText({ hour: 16, minute: 5 }, true), '16:05');
  assert.equal(helpers.timeText({ hour: 16, minute: 5 }, false), '4:05');
  assert.equal(helpers.timeText({ hour: 0, minute: 0 }, false), '12:00');
  assert.equal(helpers.aheadText(480), '8 hours ahead');
  assert.equal(helpers.aheadText(-60), '1 hour behind');
});

test('cities resolve with fallbacks', () => {
  const widgets = load(), { helpers } = widgets.dial;
  assert.equal(helpers.cityOf('tokyo').short, 'TYO');
  assert.equal(helpers.cityOf('nowhere').id, 'cupertino');
  assert.deepEqual(plain(helpers.worldCities({}).map(city => city.id)), ['cupertino', 'tokyo']);
  assert.equal(helpers.worldCities({ cities: ['a', 'tokyo', 'b', 'c', 'd'] }).length, 4);
});

test('the tick ring follows a rounded square and ticks point inward', () => {
  const { helpers } = load().dial;
  const length = helpers.outlineLength(44.5, 16);
  const top = helpers.outlinePoint(0, 44.5, 16);
  assert.deepEqual(plain(top), { x: 0, y: -44.5, nx: 0, ny: 1 });
  const half = helpers.outlinePoint(length / 2, 44.5, 16);
  assert.ok(Math.abs(half.x) < 1e-6 && Math.abs(half.y - 44.5) < 1e-6 && half.ny === -1);
  for (let i = 0; i < 60; i++) {
    const p = helpers.outlinePoint(i * length / 60, 44.5, 16);
    assert.ok(Math.abs(p.x) <= 44.5 + 1e-6 && Math.abs(p.y) <= 44.5 + 1e-6);
    assert.ok(Math.abs(Math.hypot(p.nx, p.ny) - 1) < 1e-6);
  }
});

test('zone formatters are cached', () => {
  const { helpers } = load().dial;
  assert.equal(helpers.formatter('Asia/Tokyo'), helpers.formatter('Asia/Tokyo'));
  assert.equal(helpers.formatter(null), helpers.formatter(undefined));
});
