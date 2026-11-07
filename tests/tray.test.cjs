'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createTray } = require('../lib/tray.cjs');

test('the tray icon passes on only its own menu choices', { skip: process.platform !== 'win32' }, () => {
  const actions = []; let spawned = null;
  const tray = createTray({ onAction: word => actions.push(word), spawnImpl: (exe, args) => {
    const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stdout.setEncoding = () => {}; child.kill = () => {}; spawned = { exe, args }; return child;
  } });
  assert.match(spawned.exe, /powershell\.exe$/i); assert.ok(spawned.args.includes('-STA'));
  assert.equal(spawned.args[spawned.args.indexOf('-ParentId') + 1], String(process.pid));
  tray.close();
});
