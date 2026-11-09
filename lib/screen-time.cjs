'use strict';
// Screen Time: how long the PC was used today and by which apps, kept locally.
// scripts/screen-time.ps1 reports a sample every five seconds ({ active, process,
// name, self }); this aggregates them per local day (total, apps, hours,
// pickups), saves screen-time.json once a minute and keeps seven days.
// Only program names are stored, never window titles. Samples of Edge Deck's own
// dashboard window (self) are ignored: touching the dashboard is not PC use.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const MAX_CREDIT_SECONDS = 15;   // one sample never counts for more than this (sleep, helper stalls)
const FIRST_CREDIT_SECONDS = 5;
const PICKUP_GAP_MS = 5 * 60000; // active again after this long idle is a pickup
const KEEP_DAYS = 7, TOP_APPS = 8, SAVE_MS = 60000, RESTART_MS = 15000;

const pad = value => String(value).padStart(2, '0');
function dayKey(time) { const d = new Date(time); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function emptyDay() { return { totalSeconds: 0, pickups: 0, hours: Array(24).fill(0), apps: {} }; }
const clean = (value, length) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, length);
const seconds = value => Number.isFinite(value) && value > 0 ? Math.round(value * 1000) / 1000 : 0;

function normalizeDay(raw) {
  const day = emptyDay();
  if (!raw || typeof raw !== 'object') return day;
  day.totalSeconds = seconds(raw.totalSeconds);
  day.pickups = Number.isFinite(raw.pickups) && raw.pickups > 0 ? Math.floor(raw.pickups) : 0;
  if (Array.isArray(raw.hours)) for (let i = 0; i < 24; i++) day.hours[i] = seconds(raw.hours[i]);
  if (raw.apps && typeof raw.apps === 'object') {
    for (const [key, app] of Object.entries(raw.apps).slice(0, 200)) {
      const name = clean(key, 80); const value = seconds(app?.seconds);
      if (name && value) day.apps[name] = { label: clean(app.label, 80) || name, seconds: value };
    }
  }
  return day;
}

function createScreenTime({ directory, now = Date.now, spawnImpl = spawn, onChange = () => {} } = {}) {
  const file = directory ? path.join(directory, 'screen-time.json') : null;
  let days = {}, lastActiveAt = null, lastSampleAt = null, updatedAt = null;
  let running = false, child = null, saveTimer = null, restartTimer = null, dirty = false;

  function trim() {
    const noon = new Date(now()); noon.setHours(12, 0, 0, 0);
    const oldest = dayKey(noon.getTime() - (KEEP_DAYS - 1) * 86400000);
    const newest = dayKey(noon.getTime() + 86400000);
    for (const key of Object.keys(days)) if (key < oldest || key > newest) delete days[key];
  }
  function load() {
    days = {}; lastActiveAt = null;
    if (!file) return;
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (data && typeof data === 'object' && data.days && typeof data.days === 'object') {
        for (const [key, value] of Object.entries(data.days)) if (/^\d{4}-\d{2}-\d{2}$/.test(key)) days[key] = normalizeDay(value);
        lastActiveAt = Number.isFinite(data.lastActiveAt) ? data.lastActiveAt : null;
      }
    } catch { days = {}; lastActiveAt = null; } // missing or corrupt: start empty
    trim();
  }
  function save() {
    if (!file) return;
    trim();
    try {
      fs.mkdirSync(directory, { recursive: true });
      const temporary = `${file}.tmp`;
      fs.writeFileSync(temporary, JSON.stringify({ version: 1, lastActiveAt, days }));
      fs.renameSync(temporary, file);
      dirty = false;
    } catch { /* retried at the next save */ }
  }

  function sample(message) {
    if (!message || typeof message !== 'object') return;
    const time = now();
    if (message.self === true) { lastSampleAt = time; return; } // own dashboard: not counted, and its time is not credited to the next sample
    const credit = lastSampleAt === null ? FIRST_CREDIT_SECONDS : Math.min(MAX_CREDIT_SECONDS, Math.max(0, (time - lastSampleAt) / 1000));
    lastSampleAt = time; updatedAt = time;
    if (message.active === true) {
      const key = dayKey(time);
      const day = days[key] || (days[key] = emptyDay());
      if (lastActiveAt !== null && time - lastActiveAt >= PICKUP_GAP_MS) day.pickups += 1;
      lastActiveAt = time;
      day.totalSeconds += credit;
      day.hours[new Date(time).getHours()] += credit;
      const processName = clean(message.process, 80).toLowerCase();
      if (processName) {
        const app = day.apps[processName] || (day.apps[processName] = { label: processName, seconds: 0 });
        app.label = clean(message.name, 80) || app.label; app.seconds += credit;
      }
      trim();
    }
    dirty = true;
    onChange();
  }

  function lines(stream, onLine) {
    let buffer = '';
    stream.setEncoding?.('utf8');
    stream.on('data', chunk => {
      buffer += chunk; let end;
      while ((end = buffer.indexOf('\n')) >= 0) { const line = buffer.slice(0, end).trim(); buffer = buffer.slice(end + 1); if (line) onLine(line); }
      if (buffer.length > 100000) buffer = '';
    });
  }
  function launch() {
    const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const script = path.join(__dirname, '..', 'scripts', 'screen-time.ps1');
    const helper = spawnImpl(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-ParentId', String(process.pid)], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    child = helper;
    lines(helper.stdout, line => { let message; try { message = JSON.parse(line); } catch { return; } sample(message); });
    helper.on?.('error', () => {});
    helper.on?.('exit', () => {
      if (child !== helper) return;
      child = null;
      if (running) { restartTimer = setTimeout(() => { restartTimer = null; if (running && !child) launch(); }, RESTART_MS); restartTimer.unref?.(); }
    });
  }

  return {
    start() {
      if (running) return;
      running = true; load(); lastSampleAt = null;
      launch();
      saveTimer = setInterval(() => { if (dirty) save(); }, SAVE_MS); saveTimer.unref?.();
    },
    stop() {
      if (!running) return;
      running = false; clearInterval(saveTimer); saveTimer = null; clearTimeout(restartTimer); restartTimer = null;
      const helper = child; child = null;
      if (helper) { try { helper.kill(); } catch {} }
      save();
    },
    state() {
      const time = now(); const key = dayKey(time);
      const day = days[key] || emptyDay();
      const apps = Object.entries(day.apps).map(([name, app]) => ({ name, label: app.label, seconds: Math.round(app.seconds) }))
        .sort((a, b) => b.seconds - a.seconds || a.name.localeCompare(b.name)).slice(0, TOP_APPS);
      const noon = new Date(time); noon.setHours(12, 0, 0, 0);
      const week = [];
      for (let back = KEEP_DAYS - 1; back >= 0; back--) { const date = dayKey(noon.getTime() - back * 86400000); week.push({ date, totalSeconds: Math.round(days[date]?.totalSeconds || 0) }); }
      return { running, today: { date: key, totalSeconds: Math.round(day.totalSeconds), pickups: day.pickups, hours: day.hours.map(hour => Math.round(hour)), apps }, week, updatedAt: updatedAt === null ? null : new Date(updatedAt).toISOString() };
    },
  };
}

module.exports = { createScreenTime, dayKey };
