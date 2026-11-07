'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { install, uninstall, status } = require('../lib/claude-hook-settings.cjs');

const NODE = 'C:\\Program Files\\nodejs\\node.exe';
const SCRIPT = 'C:\\Edge Deck\\scripts\\claude-permission-hook.cjs';
function settingsFile(t, content) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-deck-claude-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'settings.json');
  if (content !== undefined) fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
  return file;
}

test('installing adds only Edge Deck\'s exec-form hook and keeps everything else', t => {
  const existing = { enabledPlugins: { a: true }, hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo hi' }] }], PermissionRequest: [{ matcher: 'Write', hooks: [{ type: 'command', command: 'other.exe' }] }] } };
  const file = settingsFile(t, existing);
  assert.deepEqual(install(file, { node: NODE, script: SCRIPT }), { installed: true, error: null });
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(saved.enabledPlugins, existing.enabledPlugins);
  assert.deepEqual(saved.hooks.PreToolUse, existing.hooks.PreToolUse);
  assert.equal(saved.hooks.PermissionRequest.length, 2);
  assert.deepEqual(saved.hooks.PermissionRequest[1], { hooks: [{ type: 'command', command: NODE, args: [SCRIPT], timeout: 60, onFailure: 'continue' }] });
  assert.ok(fs.existsSync(`${file}.edge-deck-backup`), 'The original is backed up');
  install(file, { node: NODE, script: SCRIPT });
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).hooks.PermissionRequest.length, 2, 'Installing twice does not duplicate');
});

test('uninstalling removes only Edge Deck\'s hook and empty containers', t => {
  const file = settingsFile(t, { theme: 'dark' });
  install(file, { node: NODE, script: SCRIPT });
  assert.deepEqual(uninstall(file), { installed: false, error: null });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { theme: 'dark' });
  const other = settingsFile(t, { hooks: { PermissionRequest: [{ hooks: [{ type: 'command', command: 'other.exe' }] }] } });
  install(other, { node: NODE, script: SCRIPT }); uninstall(other);
  assert.deepEqual(JSON.parse(fs.readFileSync(other, 'utf8')).hooks.PermissionRequest, [{ hooks: [{ type: 'command', command: 'other.exe' }] }]);
});

test('invalid settings are never rewritten; a missing file is created', t => {
  const broken = settingsFile(t, '{ "theme": "dark", }');
  assert.throws(() => install(broken, { node: NODE, script: SCRIPT }), /not valid JSON/);
  assert.equal(fs.readFileSync(broken, 'utf8'), '{ "theme": "dark", }');
  assert.match(status(broken).error, /could not be read/);
  const missing = settingsFile(t);
  assert.equal(install(missing, { node: NODE, script: SCRIPT }).installed, true);
  assert.throws(() => install(missing, { node: 'C:\\evil.bat', script: SCRIPT }), /locate Node/);
});
