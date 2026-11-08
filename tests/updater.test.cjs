'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createUpdater, newer, parseVersion, repoFrom } = require('../lib/updater.cjs');

const ZIP = Buffer.from('PK fake zip bytes');
const SUM = `${crypto.createHash('sha256').update(ZIP).digest('hex')}  edge-deck-0.13.0.zip\n`;
const release = (assets, tag = 'v0.13.0') => ({ tag_name: tag, html_url: 'https://github.com/sb3ku/edge-deck/releases/tag/' + tag, body: 'Notes', assets });
const assets = [
  { name: 'edge-deck-0.13.0.zip', browser_download_url: 'https://github.com/sb3ku/edge-deck/releases/download/v0.13.0/edge-deck-0.13.0.zip' },
  { name: 'edge-deck-0.13.0.zip.sha256', browser_download_url: 'https://github.com/sb3ku/edge-deck/releases/download/v0.13.0/edge-deck-0.13.0.zip.sha256' },
];
function fakeGitHub({ data = release(assets), zip = ZIP, sum = SUM, redirect = 'https://objects.githubusercontent.com/file' } = {}) {
  const calls = [];
  const fetch = async (url, options = {}) => {
    const href = String(url); calls.push(href);
    const reply = (status, body, headers = {}) => ({ ok: status < 300, status, headers: { get: name => headers[name.toLowerCase()] ?? null }, json: async () => body, arrayBuffer: async () => body });
    if (href.includes('api.github.com')) return reply(200, data);
    if (href.endsWith('.zip')) return reply(302, null, { location: `${redirect}?zip` });
    if (href.endsWith('.sha256')) return reply(302, null, { location: `${redirect}?sum` });
    if (href.endsWith('?zip')) return reply(200, zip);
    if (href.endsWith('?sum')) return reply(200, Buffer.from(sum));
    throw Error('unexpected ' + href);
  };
  return { fetch, calls };
}
const installDir = t => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-deck-installed-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; };

test('versions compare numerically and the repository comes from package.json', () => {
  assert.equal(newer('0.12.0', '0.11.9'), true); assert.equal(newer('0.10.0', '0.9.9'), true);
  assert.equal(newer('0.12.0', '0.12.0'), false); assert.equal(newer('1.0', '0.9.0'), false);
  assert.deepEqual(parseVersion('v1.2.3'), [1, 2, 3]);
  assert.equal(repoFrom({ repository: { url: 'https://github.com/sb3ku/edge-deck.git' } }), 'sb3ku/edge-deck');
});

test('a newer release with a zip and its checksum is offered; older or incomplete ones are not', async t => {
  const root = installDir(t);
  const updater = createUpdater({ root, version: '0.12.0', repo: 'sb3ku/edge-deck', fetch: fakeGitHub().fetch });
  const status = await updater.check();
  assert.equal(status.state, 'available'); assert.equal(status.latest, '0.13.0'); assert.equal(status.installable, false, 'no installed.json: a source folder');
  assert.equal((await createUpdater({ root, version: '0.13.0', repo: 'sb3ku/edge-deck', fetch: fakeGitHub().fetch }).check()).state, 'current');
  assert.equal((await createUpdater({ root, version: '0.12.0', repo: 'sb3ku/edge-deck', fetch: fakeGitHub({ data: release([assets[0]]) }).fetch }).check()).state, 'current', 'no checksum: not offered');
});

test('a source folder is never replaced', async t => {
  const updater = createUpdater({ root: installDir(t), version: '0.12.0', repo: 'sb3ku/edge-deck', fetch: fakeGitHub().fetch });
  await updater.check();
  await assert.rejects(updater.install(), /source folder/);
});

test('a download that does not match its checksum, or comes from elsewhere, is refused', async t => {
  const root = installDir(t); fs.writeFileSync(path.join(root, 'installed.json'), '{}');
  let spawned = false;
  const bad = createUpdater({ root, version: '0.12.0', repo: 'sb3ku/edge-deck', fetch: fakeGitHub({ zip: Buffer.from('tampered') }).fetch, spawnImpl: () => { spawned = true; } });
  await bad.check(); await assert.rejects(bad.install(), /checksum/); assert.equal(bad.state().state, 'error');
  const elsewhere = createUpdater({ root, version: '0.12.0', repo: 'sb3ku/edge-deck', fetch: fakeGitHub({ redirect: 'https://evil.example/file' }).fetch, spawnImpl: () => { spawned = true; } });
  await elsewhere.check(); await assert.rejects(elsewhere.install(), /unexpected address/);
  assert.equal(spawned, false);
});

test('a verified update is unpacked and its installer started for this installation', async t => {
  const root = installDir(t); fs.writeFileSync(path.join(root, 'installed.json'), '{}');
  const temp = installDir(t); let started = null;
  const run = (exe, args, options, done) => { const to = options.env.EDGE_DECK_TO; fs.mkdirSync(path.join(to, 'edge-deck', 'scripts'), { recursive: true }); fs.writeFileSync(path.join(to, 'edge-deck', 'scripts', 'install.ps1'), '# installer'); done(null); };
  const updater = createUpdater({ root, version: '0.12.0', repo: 'sb3ku/edge-deck', fetch: fakeGitHub().fetch, run, tempDir: temp,
    spawnImpl: (exe, args, options) => { started = { args, options }; return { unref() {} }; } });
  await updater.check();
  assert.deepEqual(await updater.install(), { started: true, version: '0.13.0' });
  assert.match(started.args[started.args.indexOf('-File') + 1], /edge-deck[\\/]scripts[\\/]install\.ps1$/);
  assert.equal(started.args[started.args.indexOf('-InstallDir') + 1], root);
  assert.ok(started.args.includes('-Quiet')); assert.equal(started.options.detached, true);
});
