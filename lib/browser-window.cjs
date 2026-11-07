'use strict';

const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const path = require('node:path');
const fs = require('node:fs');
const { StringDecoder } = require('node:string_decoder');
const run = promisify(execFile);
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function displayBounds(display) {
  // Electron bounds use DIPs; the host supplies nativeBounds through
  // screen.dipToScreenRect for displays with different scale factors.
  const value = display?.nativeBounds || display?.bounds;
  if (!value || !['x', 'y', 'width', 'height'].every(key => Number.isFinite(value[key])) || value.width <= 0 || value.height <= 0) {
    throw new Error('The selected display has invalid dimensions.');
  }
  return Object.fromEntries(['x', 'y', 'width', 'height'].map(key => [key, Math.round(value[key])]));
}

function boundsFromSnapshot(snapshot) {
  if (!snapshot.ready) throw new Error('The dashboard window is not ready.');
  return { x: snapshot.left, y: snapshot.top, width: snapshot.width, height: snapshot.height };
}

function relocateBounds(bounds, previousDisplay, nextDisplay) {
  const width = Math.min(bounds.width, nextDisplay.width);
  const height = Math.min(bounds.height, nextDisplay.height);
  return {
    x: nextDisplay.x + Math.max(0, Math.min(bounds.x - previousDisplay.x, nextDisplay.width - width)),
    y: nextDisplay.y + Math.max(0, Math.min(bounds.y - previousDisplay.y, nextDisplay.height - height)),
    width, height,
  };
}

// The dashboard's own profile never signs in or syncs, so Edge shows no
// sign-in or "sync your browsing data" prompts over it. signin.allowed is the
// per-profile preference behind Edge's BrowserSignin policy; it is written
// while Edge is closed and only in this private profile, never the user's
// normal Edge. Any failure leaves the profile as it was.
function quietProfile(profile) {
  const file = path.join(profile, 'Default', 'Preferences');
  try {
    const prefs = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
    if (!prefs || typeof prefs !== 'object' || Array.isArray(prefs)) return;
    if (prefs.signin?.allowed === false && prefs.signin?.allowed_on_next_startup === false) return;
    prefs.signin = { ...(prefs.signin && typeof prefs.signin === 'object' ? prefs.signin : {}), allowed: false, allowed_on_next_startup: false };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.edge-deck.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(prefs));
    fs.renameSync(temporary, file);
  } catch { /* --disable-sync below still applies */ }
}

function createDashboardWindow({ url, profile, display, inspect: debug = false, onClose }) {
  const candidates = [
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ];
  const executable = candidates.find(candidate => fs.existsSync(candidate));
  if (!executable) throw new Error('Microsoft Edge is required to open this dashboard on this Windows build.');
  let targetBounds = displayBounds(display);
  quietProfile(profile);
  const args = [
    `--app=${url}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-background-mode', '--remote-debugging-pipe',
    // No account sync in the dashboard's private profile (and no prompts about it).
    '--disable-sync',
    // Keep the dashboard's renderer at normal priority when another window has focus.
    '--disable-renderer-backgrounding',
    // Edge's Windows compatibility relaunch drops inherited handles/CDP pipes.
    // This is the same targeted workaround used by Microsoft Playwright:
    // https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/server/chromium/chromiumSwitches.ts
    '--edge-skip-compat-layer-relaunch',
    `--window-position=${targetBounds.x},${targetBounds.y}`, `--window-size=${targetBounds.width},${targetBounds.height}`,
  ];
  // A private inherited pipe controls Chromium's actual full-screen mode in
  // both directions. No debugging TCP listener is enabled in normal use.
  if (debug) args.push('--remote-debugging-port=0');
  const child = spawn(executable, args, { windowsHide: false, stdio: ['ignore', 'ignore', debug ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
  // Inspection only: retain bounded startup diagnostics without exposing the
  // per-launch dashboard URL/token. Normal launches do not collect browser logs.
  let diagnosticBytes = 0;
  child.stderr?.on('data', chunk => {
    if (diagnosticBytes >= 8192) return;
    const text = chunk.toString('utf8').slice(0, 8192 - diagnosticBytes);
    diagnosticBytes += Buffer.byteLength(text);
    const safeText = text.replaceAll(url, '[dashboard-url]').replace(/(?:https?|wss?):\/\/127\.0\.0\.1[^\s"']*/g, '[local-url]');
    console.error('Dashboard browser:', safeText.trim());
  });
  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const helper = path.join(__dirname, '..', 'scripts', 'move-window.ps1');
  let closed = false;
  let closeReported = false;
  let initialization = null;
  let queue = Promise.resolve();
  let fullScreen = false;
  let normalStyle = null;
  let normalExtendedStyle = null;
  let normalBounds = null;
  let browserWindowId = null;
  let nextCommandId = 0;
  let transportFailure = null;
  const pendingCommands = new Map();
  const decoder = new StringDecoder('utf8');
  let incoming = '';

  function failTransport() {
    transportFailure = new Error('The dashboard window control connection closed. Reopen Edge Deck to reconnect.');
    for (const pending of pendingCommands.values()) {
      clearTimeout(pending.timeout);
      pending.reject(transportFailure);
    }
    pendingCommands.clear();
  }

  child.stdio[4].on('data', chunk => {
    incoming += decoder.write(chunk);
    if (incoming.length > 8 * 1024 * 1024) { failTransport(); return; }
    let end;
    while ((end = incoming.indexOf('\0')) >= 0) {
      const encoded = incoming.slice(0, end);
      incoming = incoming.slice(end + 1);
      if (!encoded) continue;
      let message;
      try { message = JSON.parse(encoded); } catch { failTransport(); return; }
      const pending = pendingCommands.get(message.id);
      if (!pending) continue;
      pendingCommands.delete(message.id);
      clearTimeout(pending.timeout);
      if (message.error) pending.reject(new Error('The browser could not change the dashboard window.'));
      else pending.resolve(message.result || {});
    }
  });
  child.stdio[3].on('error', failTransport);
  child.stdio[4].on('error', failTransport);
  child.stdio[4].on('end', () => {
    // Let a terminating child report its exit code before the verification host
    // exits; the normal path still rejects a lost control channel immediately.
    if (debug) setTimeout(failTransport, 200);
    else failTransport();
  });

  function browserCommand(method, params = {}) {
    if (closed) return Promise.reject(new Error('The dashboard window is closed.'));
    if (transportFailure) return Promise.reject(transportFailure);
    return new Promise((resolve, reject) => {
      const id = ++nextCommandId;
      const timeout = setTimeout(() => {
        pendingCommands.delete(id);
        reject(new Error('The dashboard window took too long to respond.'));
      }, 12000);
      pendingCommands.set(id, { resolve, reject, timeout });
      child.stdio[3].write(`${JSON.stringify({ id, method, params })}\0`, error => {
        if (!error) return;
        const pending = pendingCommands.get(id);
        if (!pending) return;
        pendingCommands.delete(id);
        clearTimeout(timeout);
        reject(new Error('The dashboard window control connection is unavailable.'));
      });
    });
  }

  async function browserFullScreen(enabled) {
    const expected = enabled ? 'fullscreen' : 'normal';
    await browserCommand('Browser.setWindowBounds', { windowId: browserWindowId, bounds: { windowState: expected } });
    const deadline = Date.now() + 5000;
    do {
      const result = await browserCommand('Browser.getWindowBounds', { windowId: browserWindowId });
      if (result.bounds?.windowState === expected) return;
      await sleep(75);
    } while (Date.now() < deadline);
    throw new Error('The dashboard could not finish changing full-screen mode.');
  }

  function reportClose() {
    if (closeReported) return;
    closeReported = true;
    closed = true;
    failTransport();
    onClose?.();
  }
  child.on('error', error => {
    if (debug) console.error('Dashboard window could not open:', error.message);
    reportClose();
  });
  child.on('exit', (code, signal) => {
    if (debug) console.error(`Dashboard browser exited (code ${code}, signal ${signal || 'none'}).`);
    reportClose();
  });

  async function nativeOperation(extra = []) {
    if (closed || !child.pid) throw new Error('The dashboard window is closed.');
    try {
      const { stdout } = await run(powershell, [
        '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helper,
        '-TargetPid', String(child.pid), '-ProfilePath', profile, ...extra,
      ], { windowsHide: true, timeout: 12000, maxBuffer: 65536 });
      const snapshot = JSON.parse(stdout.trim());
      if (closed) throw new Error('The dashboard window is closed.');
      return snapshot;
    } catch (error) {
      if (debug) console.error('Dashboard window:', error.stderr || error.message);
      throw new Error('The dashboard window could not be updated. Reopen Edge Deck and try again.');
    }
  }

  function serialize(operation) {
    const result = queue.then(operation);
    queue = result.catch(() => {});
    return result;
  }

  async function applyBounds(bounds) {
    const snapshot = await nativeOperation([
      '-Action', 'Set', '-Left', String(bounds.x), '-Top', String(bounds.y),
      '-Width', String(bounds.width), '-Height', String(bounds.height),
      '-WindowStyle', String(normalStyle), '-ExtendedStyle', String(normalExtendedStyle),
    ]);
    if (!snapshot.ready) throw new Error('The dashboard window is not ready.');
    return snapshot;
  }

  function ready() {
    if (!initialization) {
      initialization = (async () => {
        const deadline = Date.now() + 30000;
        let snapshot;
        do {
          const { targetInfos = [] } = await browserCommand('Target.getTargets');
          const expectedUrl = new URL(url);
          const target = targetInfos.find(info => {
            if (info.type !== 'page') return false;
            try { const candidate = new URL(info.url); return candidate.origin === expectedUrl.origin && candidate.pathname === expectedUrl.pathname; }
            catch { return false; }
          });
          if (!target) { await sleep(200); continue; }
          const browserWindow = await browserCommand('Browser.getWindowForTarget', { targetId: target.targetId });
          browserWindowId = browserWindow.windowId;
          // Recover a previously persisted Chromium window mode before saving
          // the normal frame. This does not depend on DOM user activation.
          if (browserWindow.bounds?.windowState !== 'normal') await browserFullScreen(false);
          snapshot = await nativeOperation(['-Action', 'Inspect']);
          if (snapshot.ready) break;
          await sleep(300);
        } while (!closed && Date.now() < deadline);
        if (!snapshot?.ready) throw new Error('The dashboard window did not finish opening. Reopen Edge Deck and try again.');
        normalStyle = snapshot.style;
        normalExtendedStyle = snapshot.extendedStyle;
        normalBounds = boundsFromSnapshot(snapshot);
        await applyBounds(targetBounds);
        await browserFullScreen(true);
        fullScreen = true;
        return true;
      })();
    }
    return initialization;
  }

  async function changeFullScreen(enabled) {
    if (fullScreen === enabled) return fullScreen;
    if (enabled) {
      normalBounds = boundsFromSnapshot(await nativeOperation(['-Action', 'Inspect']));
      await applyBounds(targetBounds);
      await browserFullScreen(true);
    } else {
      await browserFullScreen(false);
      await applyBounds(normalBounds);
    }
    fullScreen = enabled;
    return fullScreen;
  }

  return {
    pid: child.pid,
    ready,
    isFullScreen: () => fullScreen,
    async fullscreen() {
      await ready();
      return serialize(() => changeFullScreen(!fullScreen));
    },
    async setFullscreen(enabled) {
      if (typeof enabled !== 'boolean') throw new TypeError('Full screen must be true or false.');
      await ready();
      return serialize(() => changeFullScreen(enabled));
    },
    async move(nextDisplay) {
      const nextBounds = displayBounds(nextDisplay);
      await ready();
      return serialize(async () => {
        const currentNormal = fullScreen ? normalBounds : boundsFromSnapshot(await nativeOperation(['-Action', 'Inspect']));
        const movedNormal = relocateBounds(currentNormal, targetBounds, nextBounds);
        if (fullScreen) await browserFullScreen(false);
        try {
          await applyBounds(fullScreen ? nextBounds : movedNormal);
          if (fullScreen) await browserFullScreen(true);
        } catch (error) {
          const actual = await browserCommand('Browser.getWindowBounds', { windowId: browserWindowId }).catch(() => null);
          fullScreen = actual?.bounds?.windowState === 'fullscreen';
          throw error;
        }
        targetBounds = nextBounds;
        normalBounds = movedNormal;
        return true;
      });
    },
    async inspect() {
      await ready();
      return serialize(async () => ({ ...(await nativeOperation(['-Action', 'Inspect'])), fullScreen, browserBounds: (await browserCommand('Browser.getWindowBounds', { windowId: browserWindowId })).bounds }));
    },
    close() {
      closed = true;
      failTransport();
      // Edge's browser process is a child of the one started here: end the
      // whole tree, or the window outlives the service and holds the profile.
      // Edge can hand its browser process off, so the processes using this
      // private profile folder are ended by profile, not only by process tree.
      if (process.platform === 'win32') {
        const { execFileSync } = require('node:child_process');
        if (child.pid && child.exitCode === null) { try { execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true, timeout: 5000 }); } catch {} }
        try {
          // Encoded, so Windows argument quoting cannot alter the script.
          // Edge may relaunch itself while starting: sweep until none are left (up to ~3 s).
          const script = "$p=$env:EDGE_DECK_PROFILE; for ($i = 0; $i -lt 6; $i++) { $left = @(Get-CimInstance Win32_Process -Filter \"Name='msedge.exe'\" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($p) }); if (!$left.Count) { break }; $left | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }; Start-Sleep -Milliseconds 500 }";
          execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
          { stdio: 'ignore', windowsHide: true, timeout: 15000, env: { ...process.env, EDGE_DECK_PROFILE: profile } });
        } catch {}
      }
      child.kill();
    },
  };
}

module.exports = { createDashboardWindow, quietProfile };
