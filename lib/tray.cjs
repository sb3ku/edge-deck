'use strict';
// Edge Deck's notification-area icon (scripts/tray.ps1). It reports menu
// choices as words on stdout; only the known words are acted on.
const { spawn } = require('node:child_process');
const path = require('node:path');

const ACTIONS = new Set(['show', 'windowed', 'quit']);

function createTray({ onAction, iconPath = path.join(__dirname, '..', 'src', 'assets', 'app', 'edge-deck.ico'), spawnImpl = spawn } = {}) {
  if (process.platform !== 'win32') return { close() {} };
  let child = null, closed = false, buffer = '', restarts = 0;
  function start() {
    if (closed) return;
    const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    child = spawnImpl(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, '..', 'scripts', 'tray.ps1'),
      '-IconPath', iconPath, '-ParentId', String(process.pid)], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      buffer += chunk;
      let end;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const word = buffer.slice(0, end).trim(); buffer = buffer.slice(end + 1);
        if (ACTIONS.has(word)) { try { onAction?.(word); } catch { /* A failed action must not stop the icon. */ } }
      }
      if (buffer.length > 1024) buffer = '';
    });
    // If the icon's helper stops unexpectedly, bring it back (a few times).
    child.on('exit', () => { child = null; if (!closed && restarts++ < 3) setTimeout(start, 2000).unref?.(); });
    child.on('error', () => {});
  }
  start();
  return { close() { closed = true; try { child?.kill(); } catch {} child = null; } };
}

module.exports = { createTray, ACTIONS };
