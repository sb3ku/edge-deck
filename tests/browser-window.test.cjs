'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { quietProfile } = require('../lib/browser-window.cjs');

test('the dashboard profile has sign-in (and so sync prompts) turned off, keeping its other settings', t => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-deck-profile-'));
  t.after(() => fs.rmSync(profile, { recursive: true, force: true }));
  const file = path.join(profile, 'Default', 'Preferences');
  quietProfile(profile);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { signin: { allowed: false, allowed_on_next_startup: false } }, 'A new profile starts with sign-in off');
  fs.writeFileSync(file, JSON.stringify({ browser: { zoom: 2 }, signin: { allowed: true, accounts_metadata_dict: { a: 1 } } }));
  quietProfile(profile);
  const prefs = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(prefs.browser, { zoom: 2 }); assert.equal(prefs.signin.allowed, false); assert.deepEqual(prefs.signin.accounts_metadata_dict, { a: 1 });
  fs.writeFileSync(file, '{ damaged');
  quietProfile(profile);
  assert.equal(fs.readFileSync(file, 'utf8'), '{ damaged', 'A damaged file is left alone');
});
