'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseNvidia, loadBetween } = require('../lib/pc-stats.cjs');

test('nvidia-smi lines are read into load, temperature, memory and power', () => {
  assert.deepEqual(parseNvidia('27, 49.81, 9147, 12288, 143.98, NVIDIA GeForce RTX 3080 Ti'), { name: 'NVIDIA GeForce RTX 3080 Ti', load: 27, temperature: 49.81, memoryUsed: 9147, memoryTotal: 12288, power: 143.98 });
  assert.equal(parseNvidia('[N/A], 40'), null);
  assert.equal(parseNvidia('5, 40, 100, 200, [N/A], GPU').power, null);
});

test('CPU load comes from the change in per-core idle time', () => {
  assert.equal(loadBetween([{ idle: 100, total: 200 }, { idle: 100, total: 200 }], [{ idle: 150, total: 300 }, { idle: 190, total: 300 }]), 30);
  assert.equal(loadBetween([], []), null);
});

test('turning the CPU sensor on asks Windows for permission once and reports why it failed', async () => {
  const { setCpuSensor } = require('../lib/pc-stats.cjs');
  const { EventEmitter } = require('node:events');
  const fake = code => { const calls = []; return { calls, spawnImpl: (exe, args) => { calls.push(args); const child = new EventEmitter(); setImmediate(() => child.emit('exit', code)); return child; } }; };
  const ok = fake(0); const state = await setCpuSensor(true, ok);
  assert.equal(typeof state.driver, 'boolean');
  const command = ok.calls[0][ok.calls[0].indexOf('-Command') + 1];
  assert.match(command, /-Verb RunAs/); assert.match(command, /enable-cpu-temp\.ps1/); assert.doesNotMatch(command, /-Disable/);
  const off = fake(0); await setCpuSensor(false, off); assert.match(off.calls[0].at(-1), /'-Disable'/);
  await assert.rejects(setCpuSensor(true, fake(3)), /administrator permission/);
  await assert.rejects(setCpuSensor(true, fake(2)), /PawnIO driver could not be installed/);
  await assert.rejects(setCpuSensor(true, fake(4)), /did not match its expected signature/);
});
