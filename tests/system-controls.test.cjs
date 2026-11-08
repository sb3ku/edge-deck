'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createSystemControls } = require('../lib/system-controls.cjs');

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
