'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createWindowsIntegration, decodeStartupApproval } = require('../lib/windows-integration.cjs');

function fixture(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-deck-windows-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const root = path.join(directory, 'App with spaces');
  const desktop = path.join(directory, 'Redirected Desktop');
  const startup = path.join(directory, 'Redirected Startup');
  const appData = path.join(directory, 'AppData');
  const wscriptPath = path.join(directory, 'System32', 'wscript.exe');
  for (const relative of ['Start Edge Deck.vbs', 'src/assets/app/edge-deck.ico', 'node_modules/electron/dist/electron.exe', 'scripts/start-independent.ps1', 'scripts/shell-launcher.ps1']) {
    const file = path.join(root, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, 'fixture');
  }
  fs.mkdirSync(desktop, { recursive: true }); fs.mkdirSync(startup, { recursive: true });
  let approval = 'absent'; let failRead = false; let failWrite = false; let inspections = 0; const writes = [];
  const shell = {
    readShortcutLink: file => JSON.parse(fs.readFileSync(file, 'utf8')),
    writeShortcutLink(file, operation, details) {
      writes.push({ file, operation, details });
      if (failWrite) return false;
      fs.writeFileSync(file, JSON.stringify(details)); return true;
    },
  };
  const integration = createWindowsIntegration({
    app: { getPath: name => ({ desktop, appData })[name] }, shell, root, platform: 'win32', wscriptPath,
    readWindowsInfo: async () => { inspections++; if (failRead) throw Error('No registry access'); return { startupDirectory: startup, approval }; },
    ...options,
  });
  return { integration, root, desktop, startup, wscriptPath, writes, inspections: () => inspections,
    approval: value => { approval = value; }, failRead: () => { failRead = true; }, failWrite: () => { failWrite = true; },
  };
}

test('default startup is off and reading state never installs anything or repeatedly queries Windows', async t => {
  const f = fixture(t);
  assert.equal(f.integration.getState().startupEnabled, false);
  await f.integration.refresh();
  assert.equal(f.integration.getState().startupStatus, 'disabled');
  for (let count = 0; count < 10; count++) f.integration.getState();
  assert.equal(f.inspections(), 1);
  assert.deepEqual(f.writes, []);
  assert.deepEqual(fs.readdirSync(f.startup), []);
});

test('Desktop shortcut uses the independent VBS, branded icon and actual known Desktop folder', async t => {
  const f = fixture(t);
  const state = await f.integration.createDesktopShortcut();
  assert.equal(state.desktopShortcutPresent, true);
  const write = f.writes[0];
  assert.equal(write.file, path.join(f.desktop, 'Edge Deck.lnk'));
  assert.equal(write.details.target, f.wscriptPath);
  assert.equal(write.details.args, `//NoLogo "${path.join(f.root, 'Start Edge Deck.vbs')}"`);
  assert.equal(write.details.cwd, f.root);
  assert.equal(write.details.icon, path.join(f.root, 'src', 'assets', 'app', 'edge-deck.ico'));
  assert.equal(state.startupEnabled, false);
  await f.integration.createDesktopShortcut();
  assert.equal(f.writes[1].operation, 'replace');
});

test('startup opt-in and removal affect only the owned shortcut and reflect external deletion', async t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.startup, 'Another app.lnk'), 'keep');
  assert.equal((await f.integration.setStartup(true)).startupEnabled, true);
  assert.equal(f.writes[0].file, path.join(f.startup, 'Edge Deck.lnk'));
  assert.equal((await f.integration.setStartup(false)).startupShortcutPresent, false);
  assert.equal(fs.readFileSync(path.join(f.startup, 'Another app.lnk'), 'utf8'), 'keep');
  await f.integration.setStartup(true);
  fs.unlinkSync(path.join(f.startup, 'Edge Deck.lnk'));
  assert.equal(f.integration.getState().startupEnabled, false);
  await assert.rejects(f.integration.setStartup('true'), /on or off/);
});

test('Windows-disabled and unknown approval never claim enabled and remain removable', async t => {
  const f = fixture(t);
  f.approval('disabled');
  let state = await f.integration.setStartup(true);
  assert.equal(state.startupEnabled, false);
  assert.equal(state.startupShortcutPresent, true);
  assert.equal(state.startupStatus, 'blocked_by_windows');
  assert.match(state.message, /Windows Settings/);
  f.approval('unknown'); state = await f.integration.refresh();
  assert.equal(state.startupEnabled, false); assert.equal(state.startupStatus, 'unknown');
  assert.equal((await f.integration.setStartup(false)).startupStatus, 'disabled');
});

test('registry query errors stay unknown and prevent startup mutations', async t => {
  const f = fixture(t); await f.integration.setStartup(true); f.failRead();
  const state = await f.integration.refresh();
  assert.equal(state.startupEnabled, false); assert.equal(state.startupStatus, 'unavailable');
  await assert.rejects(f.integration.setStartup(false), /could not be read/);
  assert.equal(fs.existsSync(path.join(f.startup, 'Edge Deck.lnk')), true);
});

test('unknown or unreadable same-name shortcuts are never overwritten or deleted', async t => {
  const f = fixture(t);
  const desktopLink = path.join(f.desktop, 'Edge Deck.lnk');
  const startupLink = path.join(f.startup, 'Edge Deck.lnk');
  const other = JSON.stringify({ target: f.wscriptPath, args: '"other.vbs"', appUserModelId: 'local.EdgeDeck.Dashboard' });
  fs.writeFileSync(desktopLink, other); fs.writeFileSync(startupLink, 'not a shortcut');
  await assert.rejects(f.integration.createDesktopShortcut(), /different Edge Deck/);
  await assert.rejects(f.integration.setStartup(true), /left unchanged/);
  await assert.rejects(f.integration.setStartup(false), /left unchanged/);
  assert.equal(fs.readFileSync(desktopLink, 'utf8'), other);
  assert.equal(fs.readFileSync(startupLink, 'utf8'), 'not a shortcut');
  assert.equal(f.writes.length, 0);
});

test('an exact owned legacy shortcut can be upgraded while a different installation is preserved', async t => {
  const f = fixture(t); const link = path.join(f.desktop, 'Edge Deck.lnk');
  fs.writeFileSync(link, JSON.stringify({ target: path.join(f.root, 'node_modules', 'electron', 'dist', 'electron.exe'), args: `"${f.root}" --edge` }));
  await f.integration.createDesktopShortcut();
  assert.equal(f.writes[0].operation, 'replace');
  fs.writeFileSync(link, JSON.stringify({ target: f.wscriptPath, args: '//NoLogo "C:\\Other App\\Start Edge Deck.vbs"' }));
  await assert.rejects(f.integration.createDesktopShortcut(), /left unchanged/);
});

test('write failures and missing icon do not report a created shortcut', async t => {
  const f = fixture(t); f.failWrite();
  await assert.rejects(f.integration.createDesktopShortcut(), /could not save/);
  assert.equal(f.integration.getState().desktopShortcutPresent, false);
  fs.unlinkSync(path.join(f.root, 'src', 'assets', 'app', 'edge-deck.ico'));
  await assert.rejects(f.integration.setStartup(true), /icon is missing/);
  assert.equal(f.integration.getState().startupEnabled, false);
});

test('verification and unsupported platforms never access real Windows folders or mutate shortcuts', async t => {
  for (const options of [{ verify: true }, { platform: 'linux' }]) {
    const f = fixture(t, { ...options, app: { getPath() { assert.fail('Windows folders must not be accessed'); } } });
    assert.equal((await f.integration.refresh()).supported, false);
    await assert.rejects(f.integration.createDesktopShortcut());
    await assert.rejects(f.integration.setStartup(true));
    assert.equal(f.writes.length, 0); assert.equal(f.inspections(), 0);
  }
});

test('approval parsing treats absent records as default and unfamiliar encodings as unknown', () => {
  assert.equal(decodeStartupApproval(null), 'absent');
  assert.equal(decodeStartupApproval(Buffer.alloc(12)), 'enabled');
  const enabled = Buffer.alloc(12); enabled[0] = 2;
  assert.equal(decodeStartupApproval(enabled), 'enabled');
  const disabled = Buffer.alloc(12); disabled[0] = 3; disabled[6] = 12;
  assert.equal(decodeStartupApproval(disabled), 'disabled');
  for (const value of [undefined, Buffer.from([2]), Buffer.alloc(12, 6), '020000']) assert.equal(decodeStartupApproval(value), 'unknown');
});
