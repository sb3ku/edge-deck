'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createSystemControls, cleanBatteries } = require('../lib/system-controls.cjs');

function fakeSpawn() {
  const calls = [];
  const spawnImpl = (file, args) => {
    calls.push({ file, args });
    const child = new EventEmitter();
    child.stdin = { on() {}, write: line => { const id = Number(line.split(' ')[0]); setImmediate(() => child.stdout.emit('data', JSON.stringify({ id, ok: true, state: { wifi: true, bluetooth: false, dark: true, radiosAllowed: true } }) + '\n')); } };
    child.stdout = new EventEmitter(); child.stdout.setEncoding = () => {};
    child.kill = () => {};
    if (!/powershell/i.test(file)) setImmediate(() => child.emit('exit', 0));
    return child;
  };
  return { calls, spawnImpl };
}

test('restart and shut down need confirmation; unknown actions are refused', async t => {
  if (process.platform !== 'win32') return t.skip('Windows only');
  const fake = fakeSpawn(); const controls = createSystemControls({ spawnImpl: fake.spawnImpl }); t.after(() => controls.stop());
  await assert.rejects(controls.command('restart'), /Confirm/);
  await assert.rejects(controls.command('shutdown', true), /Confirm/);
  await assert.rejects(controls.command('format-disk'), /Unsupported/);
  assert.ok(!fake.calls.some(call => /shutdown\.exe/i.test(call.file)), 'Nothing was started');
  await controls.command('restart', 'confirmed');
  assert.deepEqual(fake.calls.find(call => /shutdown\.exe/i.test(call.file)).args, ['/r', '/t', '0']);
});

test('radio and dark mode changes go to the helper as fixed commands and update the state', async t => {
  if (process.platform !== 'win32') return t.skip('Windows only');
  const fake = fakeSpawn(); const controls = createSystemControls({ spawnImpl: fake.spawnImpl }); t.after(() => controls.stop());
  const state = await controls.command('bluetooth', true);
  assert.equal(state.ready, true); assert.equal(state.wifi, true);
  await assert.rejects(controls.command('wifi', 'yes'), /on or off/);
});

test('battery lists are cleaned: names, levels, kinds and at most 12 devices with a level', () => {
  const cleaned = cleanBatteries([
    { name: 'x'.repeat(100), level: 140, connected: true, kind: 'Headphones', charging: true },
    { name: 'Pad', level: -5, connected: 'yes', kind: 'spaceship' },
    { name: 'No level', level: null }, { name: 'Text level', level: 'abc' }, { name: 'Bool', level: true }, null, 'junk',
    { level: 42.6 }, { name: 'Tab\tName', level: 7 },
  ]);
  assert.equal(cleaned.length, 4);
  assert.deepEqual(cleaned[0], { name: 'x'.repeat(64), level: 100, connected: true, kind: 'headphones', charging: true });
  assert.deepEqual(cleaned[1], { name: 'Pad', level: 0, connected: false, kind: 'other', charging: false });
  assert.deepEqual(cleaned[2], { name: 'Device', level: 43, connected: false, kind: 'other', charging: false });
  assert.equal(cleaned[3].name, 'Tab Name');
  assert.equal(cleanBatteries(Array.from({ length: 30 }, (_, i) => ({ name: `d${i}`, level: 50 }))).length, 12);
  assert.deepEqual(cleanBatteries({ name: 'Single', level: 9, kind: 'mouse' }), [{ name: 'Single', level: 9, connected: false, kind: 'mouse', charging: false }]);
  assert.deepEqual(cleanBatteries(undefined), []);
  assert.deepEqual(cleanBatteries('nope'), []);
});

test('list("batteries") asks the helper for batteries and returns the cleaned devices', async t => {
  if (process.platform !== 'win32') return t.skip('Windows only');
  const asked = [];
  const spawnImpl = () => {
    const child = new EventEmitter();
    child.stdin = { on() {}, write: line => { asked.push(line.trim()); const id = Number(line.split(' ')[0]); setImmediate(() => child.stdout.emit('data', JSON.stringify({ id, ok: true, data: { name: 'Headset', level: 80, connected: true, kind: 'headset' } }) + '\n')); } };
    child.stdout = new EventEmitter(); child.stdout.setEncoding = () => {}; child.kill = () => {};
    return child;
  };
  const controls = createSystemControls({ spawnImpl }); t.after(() => controls.stop());
  assert.deepEqual(await controls.list('batteries'), [{ name: 'Headset', level: 80, connected: true, kind: 'headset', charging: false }]);
  assert.match(asked[0], /^\d+ batteries$/);
  await assert.rejects(controls.list('nope'), /Unknown/);
});
