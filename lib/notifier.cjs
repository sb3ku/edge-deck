'use strict';
// Tray notifications for things worth looking up for: a print that finished or
// failed, and an agent that waits for your approval. Only changes the service
// sees while running are reported (nothing on start-up). While a game or other
// full-screen app is in front, notifications wait and are shown once it closes.
const MAX_WAITING = 3;
const clip = (value, max) => String(value || '').replace(/[\r\n\t|]+/g, ' ').trim().slice(0, max);

// "2 h 14 min" / "35 min" for how long a print ran.
function duration(startedAt, now) {
  const minutes = Math.round((now - Date.parse(startedAt || '')) / 60000);
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 14 * 24 * 60) return '';
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ''}`;
}

// send(note) receives { kind: 'info'|'warning', title, body, attribution?, printerId?, model? }.
function createNotifier({ send, settings = () => ({}), now = () => Date.now() } = {}) {
  let printers = null; // id -> status, from the last state seen
  let approvals = null; // ids already seen
  const waiting = [];

  function show(note) {
    const { key, ...visible } = note;
    send({ ...visible, title: clip(note.title, 60), body: clip(note.body, 180), ...(note.attribution ? { attribution: clip(note.attribution, 60) } : {}) });
  }
  function queue(note, quiet) {
    if (!quiet) { show(note); return; }
    // A newer note about the same thing replaces the older one.
    const index = waiting.findIndex(item => item.key === note.key);
    if (index >= 0) waiting.splice(index, 1);
    waiting.push(note);
  }
  function flush() {
    if (!waiting.length) return;
    if (waiting.length <= MAX_WAITING) { for (const note of waiting.splice(0)) show(note); return; }
    const notes = waiting.splice(0);
    show({ key: 'summary', kind: notes.some(note => note.kind === 'warning') ? 'warning' : 'info', title: `${notes.length} things happened while you were away`,
      body: notes.map(note => note.title).join(' · ') });
  }

  function printerNotes(list, wanted) {
    const next = new Map();
    const notes = [];
    for (const printer of Array.isArray(list) ? list : []) {
      next.set(printer.id, printer.status);
      const before = printers?.get(printer.id);
      if (!wanted || !before || before === printer.status) continue;
      const name = printer.accountName || printer.name || 'Printer';
      const job = clip(printer.jobName, 80);
      const about = { key: `printer:${printer.id}`, printerId: printer.id, model: printer.model, attribution: printer.accountName && printer.name !== name ? printer.name : printer.model ? `Bambu Lab ${printer.model}` : '' };
      if (printer.status === 'finished' && ['printing', 'paused'].includes(before)) {
        const took = duration(printer.jobStartedAt, now());
        notes.push({ ...about, kind: 'info', title: `${name} finished`, body: [job || 'The print', took ? `is ready after ${took}.` : 'is ready.'].join(' ') });
      } else if (printer.status === 'error' && ['printing', 'paused'].includes(before)) {
        notes.push({ ...about, kind: 'warning', title: `${name} failed`, body: `${job || 'The print'} stopped with an error. Check the printer.` });
      }
    }
    printers = next;
    return notes;
  }

  // Approvals: Claude Code requests held by the broker, and Codex chats whose
  // log shows a pending approval.
  function approvalNotes(list, tasks, wanted) {
    const current = new Map();
    for (const item of Array.isArray(list) ? list : []) {
      current.set(`claude:${item.id}`, { agent: item.agent || 'Claude Code', project: item.project, action: item.action });
    }
    for (const item of Array.isArray(tasks?.items) ? tasks.items : []) {
      if (item?.approval) current.set(`task:${item.id}:${String(item.approval.detail || '').slice(0, 200)}`, { agent: item.agent || 'An agent', project: item.project || item.title, action: item.approval.action });
    }
    const notes = [];
    if (approvals && wanted) {
      for (const [key, item] of current) {
        if (approvals.has(key)) continue;
        const where = clip(item.project, 60);
        notes.push({ key, kind: 'info', agent: item.agent, title: `${item.agent} needs your approval`, body: [clip(item.action, 80), where && `in ${where}`].filter(Boolean).join(' ') || 'Open Edge Deck to answer.' });
      }
    }
    approvals = new Set(current.keys());
    return notes;
  }

  return {
    update(state) {
      const options = { printers: true, agents: true, ...(settings() || {}) };
      const quiet = state?.system?.presence === 'fullscreen';
      const notes = [...printerNotes(state?.printers, options.printers), ...approvalNotes(state?.approvals, state?.tasks, options.agents)];
      // Approvals that were already answered while waiting are not worth showing later.
      for (let i = waiting.length - 1; i >= 0; i--) if (waiting[i].key.startsWith('claude:') || waiting[i].key.startsWith('task:')) { if (!approvals.has(waiting[i].key)) waiting.splice(i, 1); }
      for (const note of notes) queue(note, quiet);
      if (!quiet) flush();
    },
    waiting: () => waiting.length,
  };
}

module.exports = { createNotifier };
