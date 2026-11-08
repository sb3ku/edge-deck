'use strict';
// Edge Deck's notification-area icon (scripts/tray.ps1). It reports menu
// choices as words on stdout; only the known words are acted on. The service
// sends it lines on stdin to show an available update or a notification.
const { spawn } = require('node:child_process');
const path = require('node:path');

const ACTIONS = new Set(['show', 'windowed', 'quit', 'update', 'check']);

function createTray({ onAction, iconPath = path.join(__dirname, '..', 'src', 'assets', 'app', 'edge-deck.ico'), spawnImpl = spawn } = {}) {
  if (process.platform !== 'win32') return { send() {}, close() {} };
  let child = null, closed = false, buffer = '', restarts = 0, lastState = '';
  function start() {
    if (closed) return;
    const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    child = spawnImpl(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, '..', 'scripts', 'tray.ps1'),
      '-IconPath', iconPath, '-ParentId', String(process.pid)], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    child.stdin?.on?.('error', () => {});
    // If the icon restarted, tell it again what it should show.
    if (lastState) { try { child.stdin?.write(`${lastState}\n`); } catch {} }
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
  // Lines for the icon: 'update <version>', 'current', 'notice <text>', 'failed <text>',
  // 'toast <base64 JSON>' (see lib/toast.cjs).
  function send(line) {
    const clean = String(line).replace(/[\r\n]+/g, ' ').slice(0, /^toast /.test(line) ? 6006 : 260);
    if (/^(update |current$)/.test(clean)) lastState = clean;
    try { child?.stdin?.write(`${clean}\n`); } catch {}
  }
  return { send, close() { closed = true; try { child?.kill(); } catch {} child = null; } };
}

module.exports = { createTray, ACTIONS };
