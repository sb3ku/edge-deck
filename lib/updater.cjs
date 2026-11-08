'use strict';
// Updates from GitHub releases. The service checks the repository's latest
// release; a newer one is offered in the tray and in Customize. Installing
// downloads the release zip, checks it against the SHA-256 published with it,
// unpacks it and runs its installer over the current installation (settings
// are kept), which restarts Edge Deck. A copy run from a source folder is not
// replaced: it is told to update with git instead.
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn, execFile } = require('node:child_process');

const MAX_ZIP = 60 * 1024 * 1024;
const DOWNLOAD_HOSTS = /^(?:github\.com|objects\.githubusercontent\.com|release-assets\.githubusercontent\.com|codeload\.github\.com)$/i;

function parseVersion(value) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(value || '').trim());
  return match ? match.slice(1).map(Number) : null;
}
function newer(candidate, current) {
  const a = parseVersion(candidate), b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}
function repoFrom(pkg) {
  const url = typeof pkg?.repository === 'string' ? pkg.repository : pkg?.repository?.url;
  const match = /github\.com[/:]([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?$/.exec(String(url || ''));
  return match ? match[1] : null;
}

function createUpdater({ root, version, repo, fetch = globalThis.fetch, now = Date.now, onChange = () => {}, spawnImpl = spawn, run = execFile, tempDir = os.tmpdir() } = {}) {
  let status = { state: 'idle', current: version, latest: null, notes: null, page: null, error: null, checkedAt: null };
  let release = null, flight = null;
  const set = next => { status = { ...status, ...next }; onChange(status); };

  async function installed() { try { await fs.access(path.join(root, 'installed.json')); return true; } catch { return false; } }
  async function getJson(url) {
    const response = await fetch(url, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'edge-deck-updater' }, signal: AbortSignal.timeout(15000) });
    if (response.status === 404) return null;
    if (!response.ok) throw Error(`GitHub answered ${response.status}.`);
    return response.json();
  }
  // Follows redirects only to GitHub's own download hosts.
  async function download(url, limit) {
    for (let hop = 0; hop < 5; hop++) {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' || !DOWNLOAD_HOSTS.test(parsed.hostname)) throw Error('The update came from an unexpected address.');
      const response = await fetch(parsed, { redirect: 'manual', headers: { 'User-Agent': 'edge-deck-updater', Accept: 'application/octet-stream' }, signal: AbortSignal.timeout(120000) });
      if (response.status >= 300 && response.status < 400 && response.headers.get('location')) { url = new URL(response.headers.get('location'), parsed).href; continue; }
      if (!response.ok) throw Error(`The download failed (${response.status}).`);
      if (Number(response.headers.get('content-length')) > limit) throw Error('The update is unexpectedly large.');
      const data = Buffer.from(await response.arrayBuffer());
      if (data.length > limit) throw Error('The update is unexpectedly large.');
      return data;
    }
    throw Error('Too many redirects.');
  }

  async function check() {
    if (flight) return flight;
    flight = (async () => {
      if (!repo) { set({ state: 'error', error: 'No GitHub repository is set for updates.' }); return status; }
      set({ state: 'checking', error: null });
      try {
        const data = await getJson(`https://api.github.com/repos/${repo}/releases/latest`);
        const latest = data && parseVersion(data.tag_name) ? String(data.tag_name).replace(/^v/, '') : null;
        const assets = Array.isArray(data?.assets) ? data.assets : [];
        const zip = assets.find(asset => /^edge-deck-\d+\.\d+\.\d+\.zip$/.test(asset?.name || ''));
        const sum = zip && assets.find(asset => asset?.name === `${zip.name}.sha256`);
        release = latest && newer(latest, version) && zip && sum ? { version: latest, zip: zip.browser_download_url, sum: sum.browser_download_url, name: zip.name } : null;
        set({ state: release ? 'available' : 'current', latest, notes: typeof data?.body === 'string' ? data.body.slice(0, 4000) : null,
          page: typeof data?.html_url === 'string' && data.html_url.startsWith('https://github.com/') ? data.html_url : null, checkedAt: new Date(now()).toISOString(), installable: await installed() });
      } catch (error) {
        set({ state: 'error', error: typeof error?.message === 'string' ? error.message.slice(0, 200) : 'The update check failed.', checkedAt: new Date(now()).toISOString() });
      }
      return status;
    })().finally(() => { flight = null; });
    return flight;
  }

  async function install() {
    if (!release) throw Error('No update is available.');
    if (!await installed()) throw Error('This copy runs from a source folder. Update it with git pull, or install Edge Deck with its installer.');
    set({ state: 'downloading', error: null });
    try {
      const [zip, sum] = await Promise.all([download(release.zip, MAX_ZIP), download(release.sum, 4096)]);
      const expected = /^[a-f0-9]{64}/i.exec(sum.toString('utf8').trim())?.[0]?.toLowerCase();
      const actual = crypto.createHash('sha256').update(zip).digest('hex');
      if (!expected || expected !== actual) throw Error('The download did not match its published checksum, so it was not installed.');
      set({ state: 'installing' });
      const folder = await fs.mkdtemp(path.join(tempDir, `edge-deck-update-${release.version}-`));
      const archive = path.join(folder, release.name);
      await fs.writeFile(archive, zip);
      const unpacked = path.join(folder, 'files');
      const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
      await new Promise((resolve, reject) => run(powershell, ['-NoProfile', '-NonInteractive', '-Command', 'Expand-Archive -LiteralPath $env:EDGE_DECK_ZIP -DestinationPath $env:EDGE_DECK_TO -Force'],
        { windowsHide: true, timeout: 120000, env: { ...process.env, EDGE_DECK_ZIP: archive, EDGE_DECK_TO: unpacked } }, error => error ? reject(Error('The update could not be unpacked.')) : resolve()));
      // The zip holds one top folder (edge-deck/), or the files directly.
      let source = unpacked;
      const entries = await fs.readdir(unpacked, { withFileTypes: true });
      if (entries.length === 1 && entries[0].isDirectory()) source = path.join(unpacked, entries[0].name);
      const installer = path.join(source, 'scripts', 'install.ps1');
      await fs.access(installer);
      // Detached: the installer stops this service, replaces the files and starts the new version.
      const child = spawnImpl(powershell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', installer, '-Quiet', '-InstallDir', root],
        { detached: true, stdio: 'ignore', windowsHide: true });
      child.unref?.();
      return { started: true, version: release.version };
    } catch (error) {
      set({ state: 'error', error: typeof error?.message === 'string' ? error.message.slice(0, 200) : 'The update failed.' });
      throw error;
    }
  }

  return { state: () => status, check, install };
}

module.exports = { createUpdater, newer, parseVersion, repoFrom };
