'use strict';
// PC stats for the dashboard: CPU load (from Node's per-core times), memory,
// uptime, the NVIDIA GPU (nvidia-smi, which ships with the driver), the busiest
// apps and the CPU temperature (scripts/pc-stats.ps1), and an internet speed test
// against Cloudflare's public speed endpoints, run only when asked.
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

function cpuTimes() { return os.cpus().map(cpu => ({ idle: cpu.times.idle, total: Object.values(cpu.times).reduce((sum, value) => sum + value, 0) })); }
function loadBetween(before, after) {
  let idle = 0, total = 0;
  after.forEach((cpu, index) => { const previous = before[index]; if (!previous) return; idle += cpu.idle - previous.idle; total += cpu.total - previous.total; });
  return total > 0 ? Math.max(0, Math.min(100, Math.round((1 - idle / total) * 100))) : null;
}
// "27, 49.81, 9147, 12288, 143.98, NVIDIA GeForce RTX 3080 Ti" (csv, noheader, nounits).
function parseNvidia(line) {
  const parts = String(line).split(',').map(part => part.trim());
  if (parts.length < 6) return null;
  const number = value => { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; };
  const [load, temperature, memoryUsed, memoryTotal, power, ...name] = parts;
  return { name: name.join(',').slice(0, 80), load: number(load), temperature: number(temperature), memoryUsed: number(memoryUsed), memoryTotal: number(memoryTotal), power: number(power) };
}
function findNvidiaSmi() {
  const candidates = [path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'nvidia-smi.exe'), path.join(process.env.ProgramFiles || 'C:\\Program Files', 'NVIDIA Corporation', 'NVSMI', 'nvidia-smi.exe')];
  return candidates.find(file => { try { return fs.statSync(file).isFile(); } catch { return false; } }) || null;
}

// Edge Deck's CPU temperature sensor (scripts/sensors): the PawnIO driver and
// whether the sensor task has been set up.
function cpuSensorState() {
  const windows = process.env.SystemRoot || 'C:\\Windows';
  let driver = false;
  try { driver = fs.readdirSync(path.join(windows, 'System32', 'DriverStore', 'FileRepository')).some(name => /^pawnio\.inf_/i.test(name)); } catch {}
  let enabled = false;
  try { enabled = fs.statSync(path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Edge Deck Sensors', 'cpu-sensor.ps1')).isFile(); } catch {}
  const model = os.cpus()[0]?.model || '';
  return { driver, enabled, vendor: /intel/i.test(model) ? 'intel' : /amd|ryzen|threadripper|epyc/i.test(model) ? 'amd' : 'other' };
}
// Turns the sensor on or off: one UAC prompt runs scripts/sensors/enable-cpu-temp.ps1.
function setCpuSensor(enable, { spawnImpl = spawn } = {}) {
  return new Promise((resolve, reject) => {
    const script = path.join(__dirname, '..', 'scripts', 'sensors', 'enable-cpu-temp.ps1');
    const quote = value => `'${String(value).replace(/'/g, "''")}'`;
    const inner = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', `"${script}"`, ...(enable ? [] : ['-Disable'])];
    // The elevated script reports through its exit code: 0 done, 2 no PawnIO driver, 1 failed; 3 means no permission.
    const command = `try { $p = Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\\WindowsPowerShell\\v1.0\\powershell.exe') -Verb RunAs -Wait -PassThru -WindowStyle Hidden -ArgumentList @(${inner.map(quote).join(',')}) -ErrorAction Stop; exit $p.ExitCode } catch { exit 3 }`;
    const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const child = spawnImpl(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command], { windowsHide: true, stdio: 'ignore' });
    child.on('error', () => reject(Error('The CPU temperature setup could not start.')));
    child.on('exit', code => {
      if (code === 0) return resolve(cpuSensorState());
      reject(Error(code === 3 ? 'Windows did not get administrator permission.' : code === 2 ? 'The PawnIO driver could not be installed. Check your internet connection and try again.' : code === 4 ? 'The downloaded PawnIO installer did not match its expected signature, so it was not run.' : 'The CPU temperature setup did not finish.'));
    });
  });
}

function createPcStats({ onChange = () => {}, spawnImpl = spawn, fetchImpl = globalThis.fetch, now = Date.now, intervalMs = 2000 } = {}) {
  let running = false, timer = null, times = cpuTimes();
  let cpu = { load: null, name: (os.cpus()[0]?.model || '').replace(/\s+/g, ' ').trim().slice(0, 80), cores: os.cpus().length, temperature: null, temperatureSource: null };
  let gpu = null, apps = [], icons = {};
  let speed = { state: 'idle', down: null, up: null, ping: null, at: null, error: null };
  let sensor = cpuSensorState();
  const children = [];
  function lines(child, onLine) {
    let buffer = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      buffer += chunk; let end;
      while ((end = buffer.indexOf('\n')) >= 0) { const line = buffer.slice(0, end).trim(); buffer = buffer.slice(end + 1); if (line) onLine(line); }
      if (buffer.length > 4000000) buffer = '';
    });
  }
  function startHelpers() {
    const smi = findNvidiaSmi();
    if (smi) {
      const child = spawnImpl(smi, ['--query-gpu=utilization.gpu,temperature.gpu,memory.used,memory.total,power.draw,name', '--format=csv,noheader,nounits', '-l', String(Math.max(1, Math.round(intervalMs / 1000)))], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
      children.push(child); lines(child, line => { const next = parseNvidia(line); if (next) { gpu = next; onChange(); } });
      child.on('error', () => {});
    }
    const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const helper = spawnImpl(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, '..', 'scripts', 'pc-stats.ps1'), '-ParentId', String(process.pid)], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    children.push(helper);
    lines(helper, line => {
      let message; try { message = JSON.parse(line); } catch { return; }
      if (message.icon && typeof message.icon.name === 'string' && /^[A-Za-z0-9+/=]{20,400000}$/.test(message.icon.data || '')) { icons[message.icon.name] = `data:image/png;base64,${message.icon.data}`; return; }
      if (Array.isArray(message.apps)) apps = message.apps.slice(0, 6).filter(app => app && typeof app.name === 'string').map(app => ({ name: app.name.slice(0, 80), title: String(app.title || app.name).slice(0, 80), memory: Number(app.memory) || 0, cpu: Number(app.cpu) || 0 }));
      const temperature = Number(message.cpuTemp?.value);
      cpu = { ...cpu, temperature: Number.isFinite(temperature) ? temperature : null, temperatureSource: Number.isFinite(temperature) ? String(message.cpuTemp.source || '').slice(0, 20) : null };
      onChange();
    });
    helper.on('error', () => {});
  }
  function tick() {
    const next = cpuTimes(); cpu = { ...cpu, load: loadBetween(times, next) }; times = next;
    onChange();
  }
  return {
    start() {
      if (running || process.platform !== 'win32') return;
      running = true; times = cpuTimes(); startHelpers();
      timer = setInterval(tick, intervalMs); timer.unref?.();
    },
    stop() {
      running = false; clearInterval(timer); timer = null;
      for (const child of children.splice(0)) { try { child.kill(); } catch {} }
    },
    state() {
      const total = os.totalmem(), free = os.freemem();
      return { running, cpu, cpuSensor: sensor, memory: { used: total - free, total }, gpu, uptime: Math.round(os.uptime()), apps: apps.map(app => ({ ...app, icon: icons[app.name] || null })), speed };
    },
    async setCpuSensor(enable) { sensor = await setCpuSensor(enable); onChange(); return sensor; },
    refreshSensor() { sensor = cpuSensorState(); onChange(); },
    // Download, upload and latency against speed.cloudflare.com (only when asked).
    async speedTest() {
      if (speed.state === 'running') return speed;
      speed = { ...speed, state: 'running', error: null }; onChange();
      try {
        const pings = [];
        for (let i = 0; i < 5; i++) { const start = now(); const response = await fetchImpl('https://speed.cloudflare.com/__down?bytes=0', { cache: 'no-store', signal: AbortSignal.timeout(5000) }); await response.arrayBuffer(); pings.push(now() - start); }
        pings.sort((a, b) => a - b);
        const ping = Math.round(pings[Math.floor(pings.length / 2)]);
        speed = { ...speed, ping }; onChange();
        const downStart = now(); let received = 0;
        const response = await fetchImpl('https://speed.cloudflare.com/__down?bytes=50000000', { cache: 'no-store', signal: AbortSignal.timeout(30000) });
        const reader = response.body.getReader();
        for (;;) { const { done, value } = await reader.read(); if (done) break; received += value.length; if (now() - downStart > 12000) { reader.cancel().catch(() => {}); break; } }
        const down = Math.round(received * 8 / Math.max(1, now() - downStart) / 1000 * 10) / 10;
        speed = { ...speed, down }; onChange();
        const body = Buffer.alloc(15000000);
        const upStart = now();
        await (await fetchImpl('https://speed.cloudflare.com/__up', { method: 'POST', body, signal: AbortSignal.timeout(30000) })).arrayBuffer();
        const up = Math.round(body.length * 8 / Math.max(1, now() - upStart) / 1000 * 10) / 10;
        speed = { state: 'done', down, up, ping, at: new Date(now()).toISOString(), error: null };
      } catch { speed = { ...speed, state: 'error', error: 'The speed test could not finish. Check your connection and try again.' }; }
      onChange();
      return speed;
    },
  };
}

module.exports = { createPcStats, parseNvidia, loadBetween, cpuSensorState, setCpuSensor };
