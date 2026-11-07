'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { powerState } = require('../lib/power.cjs');
const { cleanConfig, defaults } = require('../lib/config.cjs');

test('automatic low power follows full-screen apps and a locked PC', () => {
  assert.deepEqual(powerState('auto', 'normal'), { mode: 'auto', active: false, reason: null });
  assert.deepEqual(powerState('auto', 'fullscreen'), { mode: 'auto', active: true, reason: 'fullscreen' });
  assert.deepEqual(powerState('auto', 'away'), { mode: 'auto', active: true, reason: 'away' });
  assert.deepEqual(powerState('on', 'normal'), { mode: 'on', active: true, reason: 'manual' });
  assert.deepEqual(powerState('off', 'fullscreen'), { mode: 'off', active: false, reason: null });
  assert.equal(powerState('turbo', 'fullscreen').mode, 'auto', 'Unknown modes fall back to Automatic');
});

test('power mode is saved, defaults to Automatic and rejects invalid changes', () => {
  const base = defaults();
  assert.deepEqual(cleanConfig({}, base).power, { mode: 'auto' });
  assert.deepEqual(cleanConfig({ power: { mode: 'on' } }, base).power, { mode: 'on' });
  const saved = cleanConfig({ power: { mode: 'off' } }, base);
  assert.deepEqual(cleanConfig({ clock24: false }, saved).power, { mode: 'off' }, 'Unrelated saves keep the mode');
  assert.throws(() => cleanConfig({ power: { mode: 'max' } }, base), /low-power/);
  assert.throws(() => cleanConfig({ power: 'on' }, base), /low-power/);
  assert.deepEqual(cleanConfig({ power: { mode: 'max' } }, base, { loading: true }).power, { mode: 'auto' }, 'A damaged saved value loads as Automatic');
});
