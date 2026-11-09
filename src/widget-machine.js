(() => {
  'use strict';
  // Printer widget: one printer at a glance. Small and Tall show a progress ring
  // with the name and when the print ends; Medium (and the other layout modes)
  // show the Printers card's row for this printer; Large adds the model picture
  // and the job's facts, or the loaded filament, under the row.
  const FINISHED_MS = 5 * 60000;
  const TONES = { printing: 'print', paused: 'paused', error: 'error', finished: 'done' };
  const LABELS = { not_configured: 'Set up', connecting: 'Connecting', offline: 'Offline', printing: 'Printing', idle: 'Ready to print', paused: 'Paused', finished: 'Finished', error: 'Error' };
  const NOTES = { offline: 'The printer cannot be reached on your network.', connecting: 'Connecting to the printer…', error: 'The printer reported an error.', not_configured: 'Connect over your local network.' };
  const active = data => ['printing', 'paused'].includes(data?.status);
  const clamp = value => Math.max(0, Math.min(100, value));
  // The host redraws only the Printers card when a camera is toggled, and this
  // widget cannot see which cameras are on. Every tap on any row's camera button
  // (this card's or another's) is counted per printer, and the count is part of
  // the signature, so the host's redraw right after the tap reaches this card.
  const cameraTaps = new Map();
  function cameraTap(target) {
    const id = target?.closest?.('.printer-camera-toggle')?.closest('.printer')?.dataset.printerId;
    if (!id) return null;
    cameraTaps.set(id, (cameraTaps.get(id) || 0) + 1);
    return id;
  }
  document.addEventListener('click', event => cameraTap(event.target), true);

  // The printer this view shows: its config (the chosen one, else the first) and
  // its state. A configured printer without state is connecting; a finish older
  // than finishedMs counts as idle again, like the Printers card.
  function resolve(configPrinters, statePrinters, printerId, now = Date.now(), finishedMs = FINISHED_MS) {
    const configs = Array.isArray(configPrinters) ? configPrinters.filter(Boolean) : [];
    const config = configs.find(p => p.id === printerId) || configs[0] || null;
    if (!config) return { config: null, data: null, name: '' };
    const raw = (Array.isArray(statePrinters) ? statePrinters : []).find(p => p && p.id === config.id) || { id: config.id, status: config.configured ? 'connecting' : 'not_configured' };
    const finishedAt = raw.status === 'finished' ? Date.parse(raw.finishedAt || raw.finishedSeenAt || '') : NaN;
    const data = Number.isFinite(finishedAt) && now - finishedAt > finishedMs ? { ...raw, status: 'idle', thumbnail: null } : raw;
    return { config, data, name: String(data.accountName || data.name || config.name || 'Printer') };
  }
  function timeText(date, clock24) { return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: !clock24 }); }
  // When a running print ends ("20:06", or "Tue 08:15" when that is another day).
  function finishText(data, clock24, now = Date.now()) {
    if (data?.status !== 'printing' || !Number.isFinite(data.remainingMinutes) || data.remainingMinutes <= 0) return '';
    const done = new Date(now + data.remainingMinutes * 60000);
    const day = done.toDateString() === new Date(now).toDateString() ? '' : `${done.toLocaleDateString([], { weekday: 'short' })} `;
    return day + timeText(done, clock24);
  }
  function durationText(ms) {
    if (!Number.isFinite(ms) || ms < 0) return '';
    const minutes = Math.round(ms / 60000), hours = Math.floor(minutes / 60);
    return hours ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
  }
  function leftText(minutes) {
    if (!Number.isFinite(minutes) || minutes < 0) return '';
    const whole = Math.round(minutes);
    return whole < 60 ? `${whole} min` : `${Math.floor(whole / 60)}h ${whole % 60}m`;
  }
  function agoText(iso, now = Date.now()) {
    const at = Date.parse(iso); if (!Number.isFinite(at)) return '';
    const minutes = Math.max(0, Math.round((now - at) / 60000));
    return minutes < 1 ? 'just now' : minutes < 60 ? `${minutes} min ago` : minutes < 1440 ? `${Math.floor(minutes / 60)}h ago` : `${Math.floor(minutes / 1440)}d ago`;
  }
  function statusLine(data, clock24 = true, now = Date.now()) {
    const status = data?.status;
    if (status === 'printing') { const at = finishText(data, clock24, now); return at ? `Done ${at}` : 'Printing'; }
    if (status === 'error') return String(data.message || LABELS.error);
    return LABELS[status] || 'Unknown';
  }
  // The job's facts while printing or paused, as [label, value] pairs.
  function facts(data, clock24 = true, now = Date.now()) {
    const list = [];
    if (!active(data)) return list;
    if (data.jobName) list.push(['Job', String(data.jobName)]);
    if (Number.isFinite(data.totalLayers) && data.totalLayers > 0) list.push(['Layer', `${Math.min(Number.isFinite(data.layer) ? Math.max(0, data.layer) : 0, data.totalLayers)} of ${data.totalLayers}`]);
    const left = leftText(data.remainingMinutes); if (left) list.push(['Time left', left]);
    const ends = finishText(data, clock24, now); if (ends) list.push(['Ends at', ends]);
    const started = agoText(data.jobStartedAt, now); if (started) list.push(['Started', started]);
    // The stage only when it says more than the status ("Printing" is the status itself).
    if (data.stage?.label && !/^(printing|paused)$/i.test(String(data.stage.label).trim())) list.push(['Stage', String(data.stage.label)]);
    return list;
  }
  function tone(status) { return TONES[status] || ''; }
  // What the ring shows in its centre and how much of it is filled.
  function centreText(data) {
    const status = data?.status;
    if (active(data)) return Number.isFinite(data.progress) ? `${Math.round(clamp(data.progress))}%` : '—';
    return status === 'finished' ? '✓' : status === 'idle' ? 'Ready' : status === 'error' ? '!' : status === 'not_configured' ? '+' : '—';
  }
  function ringValue(data) {
    if (active(data)) return Number.isFinite(data.progress) ? clamp(data.progress) : 0;
    return ['finished', 'error'].includes(data?.status) ? 100 : 0;
  }
  // The ring button's spoken label: "Big fella: 89 percent, done at 20:06".
  function summary(name, data, clock24 = true, now = Date.now()) {
    if (active(data) && Number.isFinite(data.progress)) {
      const at = finishText(data, clock24, now);
      return `${name}: ${Math.round(clamp(data.progress))} percent${at ? `, done at ${at}` : data.status === 'paused' ? ', paused' : ''}`;
    }
    return `${name}: ${statusLine(data, clock24, now)}`;
  }
  function moodFor(data) {
    const status = data?.status;
    return status === 'error' ? { mood: 'error', attention: true } : status === 'paused' ? { mood: 'paused', attention: true }
      : status === 'printing' ? { mood: 'print', attention: false } : status === 'finished' ? { mood: 'done', attention: false } : { mood: '', attention: false };
  }
  function layoutFor(mode, size) { return mode === 'widgets' && ['small', 'tall', 'large'].includes(size) ? size : 'medium'; }
  function finishedFor(data, now = Date.now()) {
    const at = data?.status === 'finished' ? Date.parse(data.finishedAt || data.finishedSeenAt || '') : NaN;
    return Number.isFinite(at) ? Math.max(0, now - at) : null;
  }
  function printer(ctx, now) { return resolve(ctx.config().printers, ctx.state().printers, ctx.item.printerId, now, ctx.PRINTER_FINISHED_MS); }

  // ---- Drawing ------------------------------------------------------------------
  // The ring with the name and status under it, as one button that opens the
  // printer's control panel (or Customize while the printer is not set up).
  function hero(ctx, config, data, name, now) {
    const open = ctx.el('button', 'machine-hero'); open.type = 'button';
    open.setAttribute('aria-label', summary(name, data, ctx.clock24(), now));
    open.addEventListener('click', () => { if (data.status === 'not_configured') ctx.showSettings('printers'); else ctx.showPrinterConsole(config.id, open); });
    const value = ringValue(data);
    const ring = ctx.el('div', `machine-ring${value ? '' : ' is-empty'}`); ring.setAttribute('aria-hidden', 'true');
    const svg = ctx.printerRing(value, tone(data.status) || 'print');
    const fill = svg.querySelector('.mini-ring-fill');
    if (fill) ctx.glide(`machine:${ctx.card.id}:${ctx.item.id || ''}`, fill, 'strokeDasharray', `${value * 2.639} 263.9`);
    ring.append(svg, ctx.el('strong', `machine-ring-value is-${data.status || 'unknown'}`, centreText(data)));
    const copy = ctx.el('div', 'machine-copy'); copy.setAttribute('aria-hidden', 'true');
    // Ready and finished: the ring already says so, so the line under the name gives the model.
    copy.append(ctx.el('span', 'machine-name', name), ctx.el('span', 'machine-status', ['idle', 'finished'].includes(data.status) ? `Bambu Lab ${config.model || ''}`.trim() : statusLine(data, ctx.clock24(), now)));
    open.append(ring, copy);
    return open;
  }
  function factList(ctx, pairs) {
    const list = ctx.el('dl', 'machine-facts');
    for (const [label, value] of pairs) {
      const row = ctx.el('div', 'machine-fact'); const text = ctx.el('dd', '', value); text.title = value;
      row.append(ctx.el('dt', '', label), text); list.append(row);
    }
    return list;
  }
  function headline(ctx, text, kind, symbol) {
    const line = ctx.el('p', `machine-headline is-${kind}`);
    if (symbol) line.append(ctx.icon(symbol)); else line.append(ctx.el('i', 'machine-dot'));
    line.append(document.createTextNode(text));
    return line;
  }
  // Under the ring (Tall) or the row (Large): the job's facts, the loaded
  // filament, the finished summary, or what is wrong.
  function detail(ctx, config, data, name, now, withFigure) {
    const box = ctx.el('div', 'machine-detail');
    const status = data.status;
    if (active(data)) {
      box.classList.add('is-job');
      if (withFigure) box.append(ctx.printerFigure(config.model, { ...data, id: config.id }));
      box.append(factList(ctx, facts(data, ctx.clock24(), now)));
    } else if (status === 'idle') {
      // The status is already shown above (row badge or ring); only the filament here.
      box.append(ctx.filamentSpools(data) || ctx.el('p', 'machine-note', 'No filament reported.'));
    } else if (status === 'finished') {
      box.classList.add('is-done');
      const took = data.jobStartedAt && data.finishedAt ? durationText(Date.parse(data.finishedAt) - Date.parse(data.jobStartedAt)) : '';
      const ago = data.finishedAt || data.finishedSeenAt ? agoText(data.finishedAt || data.finishedSeenAt, now) : '';
      // The status (Finished) is shown above; here only when it finished.
      box.append(headline(ctx, ago ? `${ago[0].toUpperCase()}${ago.slice(1)}` : 'Just now', 'done', 'check'));
      if (took) box.append(ctx.el('p', 'machine-sub', `took ${took}`));
      if (data.jobName) { const job = ctx.el('p', 'machine-job', data.jobName); job.title = data.jobName; box.append(job); }
      box.append(ctx.el('p', 'machine-note', 'Clear the plate.'));
    } else if (status === 'not_configured') {
      box.append(headline(ctx, 'Not set up yet', 'quiet', 'printer'), ctx.el('p', 'machine-note', NOTES.not_configured));
      box.append(ctx.button('Set up', () => ctx.showSettings('printers'), { className: 'button subtle', icon: 'settings' }));
    } else {
      const kind = status === 'error' ? 'error' : 'quiet';
      // Large shows the status in the row above; Tall's ring does not spell it out.
      if (!withFigure) box.append(headline(ctx, status === 'error' ? 'Needs attention' : LABELS[status] || 'Unknown', kind, status === 'error' ? 'warning' : 'printer'));
      box.append(ctx.el('p', 'machine-note', String(data.message || NOTES[status] || '')));
    }
    return box;
  }
  // The plate picture is fetched after the first draw, and the host writes it
  // into the row's figure only; the big figure under the row copies it when it
  // lands (the watcher ends once the picture is copied or the row is gone).
  function mirrorPicture(source, target) {
    const copy = () => {
      if (!source.classList.contains('has-model')) return false;
      target.classList.add('has-model'); target.classList.remove('no-photo');
      target.replaceChildren(...[...source.children].map(node => node.cloneNode(true)));
      if (source.title) target.title = source.title;
      return true;
    };
    if (copy() || typeof MutationObserver !== 'function') return;
    const watcher = new MutationObserver(() => { if (!source.isConnected || copy()) watcher.disconnect(); });
    watcher.observe(source, { attributes: true, attributeFilter: ['class'] });
  }
  function render(body, ctx) {
    const now = Date.now();
    const { config, data, name } = printer(ctx, now);
    const layout = layoutFor(ctx.mode, ctx.size);
    const root = ctx.el('div', `machine-widget is-${layout}`);
    body.append(root);
    if (!config) {
      ctx.emptyContent(root, 'printer', 'Your printer', 'Add a printer in Customize.');
      root.append(ctx.button('Set up', () => ctx.showSettings('printers'), { icon: 'plus' }));
      return;
    }
    root.dataset.status = data.status || 'unknown'; root.dataset.printer = config.id;
    if (layout === 'small') root.append(hero(ctx, config, data, name, now));
    else if (layout === 'tall') root.append(hero(ctx, config, data, name, now), detail(ctx, config, data, name, now, false));
    else if (layout === 'large') {
      const row = printerRow(ctx, config); root.append(row);
      if (data.status === 'not_configured') return;
      const box = detail(ctx, config, data, name, now, true); root.append(box);
      const source = row.querySelector('.printer-figure'), target = box.querySelector('.printer-figure');
      if (source && target) mirrorPicture(source, target);
    } else root.append(printerRow(ctx, config));
  }
  // The Printers card's row for this printer. A tap on a camera button that a
  // redraw has already replaced (scripts can do that) never reaches the
  // document, so it is counted on the button itself, ahead of the host's handler.
  function printerRow(ctx, config) {
    const row = ctx.printerRow(config);
    const toggle = row.querySelector('.printer-camera-toggle');
    toggle?.addEventListener('click', () => { if (!toggle.isConnected) cameraTap(toggle); }, true);
    return row;
  }
  // Everything the drawing reads: the printer and its state, the time format,
  // the minute bucket of a fresh finish (so it turns idle on time) and the
  // camera taps for this printer (the host redraws straight after each one).
  function signature(ctx) {
    const { config, data } = printer(ctx);
    const finished = finishedFor(data);
    return [ctx.item.printerId, ctx.state().printers, ctx.config().printers, ctx.size, finished === null ? null : Math.floor(finished / 60000), ctx.clock24(), config ? cameraTaps.get(config.id) || 0 : 0];
  }
  function mood(ctx) { return moodFor(printer(ctx).data); }
  window.EdgeWidgets = window.EdgeWidgets || {};
  window.EdgeWidgets.machine = Object.freeze({ render, signature, mood,
    helpers: Object.freeze({ resolve, statusLine, facts, tone, centreText, ringValue, summary, moodFor, layoutFor, finishText, leftText, agoText, durationText, finishedFor, cameraTap, FINISHED_MS, LABELS }) });
})();
