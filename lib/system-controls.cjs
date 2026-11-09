'use strict';
// Quick controls: Wi-Fi, Bluetooth and dark mode (scripts/system-controls.ps1)
// and power: lock, sleep, restart and shut down. Restart and shut down need an
// explicit confirmation from the dashboard ("confirmed").
const path = require('node:path');
const { spawn } = require('node:child_process');

const ACTIONS = new Set(['wifi', 'bluetooth', 'dark', 'nightlight', 'lock', 'sleep', 'restart', 'shutdown', 'wifi-connect', 'wifi-disconnect', 'settings']);
// Windows settings pages the card can open ("More settings").
const SETTINGS_PAGES = { wifi: 'ms-settings:network-wifi', bluetooth: 'ms-settings:bluetooth', sound: 'ms-settings:sound', nightlight: 'ms-settings:nightlight', personalize: 'ms-settings:colors' };

// Devices that report a charge: name up to 64 characters, level 0-100, at most 12.
// Entries without a usable level are left out.
const BATTERY_KINDS = new Set(['headphones', 'headset', 'mouse', 'keyboard', 'controller', 'phone', 'laptop', 'other']);
function cleanBatteries(items) {
  const list = Array.isArray(items) ? items : items && typeof items === 'object' ? [items] : [];
  const result = [];
  for (const item of list) {
    if (!item || typeof item !== 'object' || item.level === null || item.level === undefined || item.level === '' || typeof item.level === 'boolean') continue;
    const level = Number(item.level);
    if (!Number.isFinite(level)) continue;
    const kind = String(item.kind || '').toLowerCase();
    result.push({ name: String(item.name || 'Device').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 64) || 'Device', level: Math.max(0, Math.min(100, Math.round(level))), connected: item.connected === true, kind: BATTERY_KINDS.has(kind) ? kind : 'other', charging: item.charging === true });
    if (result.length >= 12) break;
  }
  return result;
}

function createSystemControls({ onChange = () => {}, spawnImpl = spawn, pollMs = 10000 } = {}) {
  let helper = null, buffer = '', sequence = 0, timer = null, running = false;
  let state = { wifi: null, bluetooth: null, dark: null, radiosAllowed: null, ready: false, error: null };
  const waiting = new Map();
  const windows = process.env.SystemRoot || 'C:\\Windows';
  function startHelper() {
    if (helper || process.platform !== 'win32') return;
    const powershell = path.join(windows, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    helper = spawnImpl(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, '..', 'scripts', 'system-controls.ps1'), '-ParentId', String(process.pid)], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    helper.stdin.on('error', () => {});
    helper.stdout.setEncoding('utf8');
    helper.stdout.on('data', chunk => {
      buffer += chunk; let end;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end).trim(); buffer = buffer.slice(end + 1);
        let message; try { message = JSON.parse(line); } catch { continue; }
        if (message.ok && message.state) { state = { ...state, ...clean(message.state), ready: true, error: null }; onChange(); }
        const wait = waiting.get(message.id); if (wait) { waiting.delete(message.id); clearTimeout(wait.timer); message.ok ? wait.resolve(message.data) : wait.reject(Error(message.error || 'Windows did not make the change.')); }
      }
      if (buffer.length > 100000) buffer = '';
    });
    const failed = () => { helper = null; for (const wait of waiting.values()) { clearTimeout(wait.timer); wait.reject(Error('Quick controls stopped. Try again.')); } waiting.clear(); };
    helper.on('exit', failed); helper.on('error', failed);
  }
  function clean(value) {
    const flag = item => typeof item === 'boolean' ? item : null;
    return { wifi: flag(value.wifi), bluetooth: flag(value.bluetooth), dark: flag(value.dark), radiosAllowed: flag(value.radiosAllowed) };
  }
  function ask(command) {
    startHelper();
    if (!helper) return Promise.reject(Error('Quick controls are available on Windows.'));
    const id = ++sequence % 1000000000;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { waiting.delete(id); reject(Error('Windows did not answer in time.')); }, 15000);
      waiting.set(id, { resolve, reject, timer });
      try { helper.stdin.write(`${id} ${command}\n`); } catch { clearTimeout(timer); waiting.delete(id); reject(Error('Quick controls stopped. Try again.')); }
    });
  }
  function run(file, args) {
    return new Promise((resolve, reject) => {
      const child = spawnImpl(file, args, { windowsHide: true, stdio: 'ignore', detached: false });
      child.on('error', () => reject(Error('Windows could not start that action.')));
      child.on('exit', code => code === 0 ? resolve() : reject(Error('Windows did not accept that action.')));
    });
  }
  return {
    start() {
      if (running) return; running = true; startHelper();
      ask('state').catch(error => { state = { ...state, error: error.message }; onChange(); });
      timer = setInterval(() => ask('state').catch(() => {}), pollMs); timer.unref?.();
    },
    stop() { running = false; clearInterval(timer); timer = null; try { helper?.kill(); } catch {} helper = null; },
    state() { return { ...state }; },
    // Lists for the detail views: 'wifi' networks or 'bluetooth' devices.
    async list(kind) {
      if (kind === 'wifi') return clean(await ask('wifi-list'), 'wifi');
      if (kind === 'bluetooth') return clean(await ask('bt-list'), 'bluetooth');
      if (kind === 'batteries') return cleanBatteries(await ask('batteries').catch(() => []));
      throw Error('Unknown list.');
      function clean(items, type) {
        return (Array.isArray(items) ? items : items ? [items] : []).slice(0, 20).map(item => type === 'wifi'
          ? { ssid: String(item.ssid || '').slice(0, 64), signal: Math.max(0, Math.min(100, Number(item.signal) || 0)), secure: item.secure !== false, connected: item.connected === true, saved: item.saved === true }
          : { name: String(item.name || 'Bluetooth device').slice(0, 64), connected: item.connected === true, kind: String(item.kind || '').slice(0, 24) }).filter(item => type !== 'wifi' || item.ssid);
      }
    },
    async command(action, value) {
      if (!ACTIONS.has(action)) throw Error('Unsupported quick control.');
      if (action === 'wifi' || action === 'bluetooth') {
        if (typeof value !== 'boolean') throw Error('Choose on or off.');
        await ask(`radio ${action === 'wifi' ? 'WiFi' : 'Bluetooth'} ${value ? 'On' : 'Off'}`);
      } else if (action === 'dark') {
        if (typeof value !== 'boolean') throw Error('Choose on or off.');
        await ask(`dark ${value ? 'On' : 'Off'}`);
      } else if (action === 'wifi-connect') {
        if (typeof value !== 'string' || !value || value.length > 64 || /[\u0000-\u001f]/.test(value)) throw Error('Choose a Wi-Fi network.');
        await ask(`wifi-connect ${Buffer.from(value, 'utf8').toString('base64')}`);
      } else if (action === 'wifi-disconnect') {
        await ask('wifi-disconnect');
      } else if (action === 'settings') {
        if (!Object.hasOwn(SETTINGS_PAGES, value)) throw Error('Unknown settings page.');
        await run(path.join(windows, 'explorer.exe'), [SETTINGS_PAGES[value]]).catch(() => {});
      } else if (action === 'nightlight') {
        // Windows has no public switch for Night light; its settings page opens instead.
        await run(path.join(windows, 'explorer.exe'), ['ms-settings:nightlight']).catch(() => {});
      } else if (action === 'lock') {
        await run(path.join(windows, 'System32', 'rundll32.exe'), ['user32.dll,LockWorkStation']);
      } else if (action === 'sleep') {
        ask('sleep').catch(() => {}); // the answer arrives after waking up
      } else {
        if (value !== 'confirmed') throw Error('Confirm this on the dashboard first.');
        await run(path.join(windows, 'System32', 'shutdown.exe'), action === 'restart' ? ['/r', '/t', '0'] : ['/s', '/t', '0']);
      }
      return this.state();
    },
  };
}

module.exports = { createSystemControls, cleanBatteries, ACTIONS };
