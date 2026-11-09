(() => {
  'use strict';
  // Calendar widget, in the style of the iOS Calendar widgets (dark appearance):
  // Up Next (the next events) and Month (a month grid with dots on busy days).
  // The events come from the local service, which reads the private iCal link.
  // This file also draws the Customize > Connections > Calendar settings page.
  const DAY_MS = 86400000;
  const DEFAULT_COLOR = '#0a84ff';
  const HORIZON_DAYS = 7;
  const pad = n => String(n).padStart(2, '0');
  const startOfDay = date => new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const addDays = (date, n) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + n);
  const dayKey = date => date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
  const colorOf = value => /^#[0-9a-f]{6}$/i.test(value || '') ? value : DEFAULT_COLOR;
  const weekdayName = (date, style = 'long') => date.toLocaleDateString(undefined, { weekday: style });
  const monthName = date => date.toLocaleDateString(undefined, { month: 'long' });

  // ---- Events ---------------------------------------------------------------
  function prepare(events) {
    const result = [];
    for (const raw of Array.isArray(events) ? events : []) {
      const start = new Date(raw?.start), end = new Date(raw?.end);
      if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) continue;
      result.push({ id: String(raw.id || ''), title: String(raw.title || 'Untitled'), start, end: end < start ? start : end, allDay: raw.allDay === true, location: String(raw.location || ''), calendar: String(raw.calendar || ''), color: colorOf(raw.color) });
    }
    return result.sort((a, b) => a.start - b.start);
  }
  // One entry per event per day, from today for `days` days; events that already ended are left out.
  function entriesFor(events, now, days = HORIZON_DAYS) {
    const today = startOfDay(now), last = addDays(today, days - 1);
    const entries = [];
    for (const event of events) {
      if (!event.allDay && event.end > event.start && event.end <= now) continue;
      if (!event.allDay && event.end <= event.start && event.start < now - 60000) continue;
      const firstDay = startOfDay(event.start);
      const lastDay = event.allDay ? addDays(startOfDay(event.end), -1) : startOfDay(event.end > event.start ? new Date(event.end - 1) : event.start);
      const from = firstDay > today ? firstDay : today;
      for (let day = from, count = 0; day <= lastDay && day <= last && count < 14; day = addDays(day, 1), count++) {
        if (event.allDay && lastDay < firstDay) break;
        entries.push({ event, day, first: dayKey(day) === dayKey(firstDay) });
      }
    }
    return entries.sort((a, b) => a.day - b.day || b.event.allDay - a.event.allDay || a.event.start - b.event.start || a.event.title.localeCompare(b.event.title));
  }
  const isNow = (entry, now) => !entry.event.allDay && entry.event.start <= now && now < entry.event.end && dayKey(entry.day) === dayKey(now);
  function dayLabel(day, now) {
    const diff = Math.round((startOfDay(day) - startOfDay(now)) / DAY_MS);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Tomorrow';
    return `${weekdayName(day)} ${day.getDate()}`;
  }
  function clockText(date, clock24, withSuffix = true) {
    const h = date.getHours(), m = pad(date.getMinutes());
    if (clock24) return `${pad(h)}:${m}`;
    return `${h % 12 || 12}:${m}${withSuffix ? (h < 12 ? ' AM' : ' PM') : ''}`;
  }
  function rangeText(event, clock24) {
    if (event.allDay) return 'All day';
    if (event.end <= event.start) return clockText(event.start, clock24);
    if (clock24) return `${clockText(event.start, true)}–${clockText(event.end, true)}`;
    const sameHalf = (event.start.getHours() < 12) === (event.end.getHours() < 12);
    return `${clockText(event.start, false, !sameHalf)}–${clockText(event.end, false)}`;
  }
  function timeText(entry, clock24) {
    const { event } = entry;
    if (event.allDay) return 'All day';
    if (!entry.first) return `Until ${clockText(event.end, clock24)}`;
    return rangeText(event, clock24);
  }
  // Time line of a row; rows on later days name the day first.
  function whenText(entry, now, clock24, withDay) {
    const time = timeText(entry, clock24);
    return withDay && dayKey(entry.day) !== dayKey(now) ? `${dayLabel(entry.day, now)} · ${time}` : time;
  }
  const countText = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  // ---- Event detail sheet -----------------------------------------------------
  let sheet = null;
  function ensureSheet(ctx) {
    if (sheet?.isConnected) return sheet;
    const dialog = ctx.el('dialog', 'calendar-event-sheet');
    dialog.setAttribute('aria-labelledby', 'calendar-event-title');
    dialog.append(ctx.el('p', 'cal-sheet-calendar'), Object.assign(ctx.el('h2', 'cal-sheet-title'), { id: 'calendar-event-title' }), ctx.el('p', 'cal-sheet-when'), ctx.el('p', 'cal-sheet-where'));
    const close = ctx.button('Close', () => dialog.close(), { className: 'button cal-sheet-close' });
    dialog.append(close);
    dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
    document.body.append(dialog);
    sheet = dialog; return dialog;
  }
  function dateText(date) { return date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }); }
  function whenFull(event, clock24) {
    if (event.allDay) {
      const lastDay = addDays(startOfDay(event.end), -1);
      return dayKey(lastDay) > dayKey(event.start) ? `${dateText(event.start)} – ${dateText(lastDay)}` : `${dateText(event.start)} · All day`;
    }
    if (dayKey(event.end) !== dayKey(event.start) && event.end > event.start) return `${dateText(event.start)}, ${clockText(event.start, clock24)} – ${dateText(event.end)}, ${clockText(event.end, clock24)}`;
    return `${dateText(event.start)} · ${rangeText(event, clock24)}`;
  }
  function openSheet(ctx, event) {
    const dialog = ensureSheet(ctx);
    const calendar = dialog.querySelector('.cal-sheet-calendar');
    calendar.replaceChildren(); calendar.style.setProperty('--cal-color', event.color);
    if (event.calendar) { calendar.append(ctx.el('i', 'cal-dot'), document.createTextNode(event.calendar)); calendar.hidden = false; } else calendar.hidden = true;
    dialog.querySelector('.cal-sheet-title').textContent = event.title;
    dialog.querySelector('.cal-sheet-when').textContent = whenFull(event, ctx.clock24());
    const where = dialog.querySelector('.cal-sheet-where'); where.textContent = event.location; where.hidden = !event.location;
    dialog.style.setProperty('--cal-color', event.color);
    if (!dialog.open) dialog.showModal();
    dialog.querySelector('.cal-sheet-close')?.focus({ preventScroll: true });
  }

  // ---- Pieces ---------------------------------------------------------------
  function dateHead(ctx, now, className = '') {
    const head = ctx.el('div', `cal-date ${className}`.trim());
    head.append(ctx.el('span', 'cal-weekday', weekdayName(now)), ctx.el('span', 'cal-daynum', String(now.getDate())));
    return head;
  }
  function eventRow(ctx, entry, now, options = {}) {
    const { event } = entry;
    const now_ = isNow(entry, now);
    const row = ctx.el('button', `cal-event${now_ ? ' is-now' : ''}`);
    row.type = 'button'; row.style.setProperty('--cal-color', event.color);
    row.setAttribute('aria-label', `${event.title}, ${whenText(entry, now, ctx.clock24(), true)}${event.location ? `, ${event.location}` : ''}`);
    const copy = ctx.el('span', 'cal-copy');
    copy.append(ctx.el('span', 'cal-title', event.title));
    const meta = ctx.el('span', 'cal-time', whenText(entry, now, ctx.clock24(), options.withDay));
    if (now_) meta.append(ctx.el('span', 'cal-now', 'Now'));
    copy.append(meta);
    row.append(ctx.el('i', 'cal-bar'), copy);
    row.addEventListener('click', () => openSheet(ctx, event));
    return row;
  }
  function emptyText(calendar, ready) {
    if (calendar.error && !ready) return calendar.error;
    if (!calendar.updatedAt && !calendar.error) return 'Loading calendar…';
    return null;
  }
  function note(ctx, text, className = 'cal-none') { return ctx.el('p', className, text); }

  function renderNotConfigured(body, ctx) {
    const empty = ctx.el('div', 'cal-empty');
    const symbol = ctx.el('span', 'cal-empty-symbol'); symbol.append(ctx.icon('calendar'));
    empty.append(symbol, ctx.el('h3', '', 'Add your calendar'), ctx.el('p', '', 'Paste your calendar\'s iCal link in Customize → Connections → Calendar.'));
    empty.append(ctx.button('Set up', () => ctx.showSettings('calendar'), { className: 'button primary cal-setup' }));
    body.append(empty);
  }

  // ---- Up Next ----------------------------------------------------------------
  function renderUpNext(body, ctx, calendar, now) {
    const size = ctx.size, entries = entriesFor(prepare(calendar.events), now);
    const root = ctx.el('div', 'cal-root cal-upnext'); root.dataset.view = size;
    const status = emptyText(calendar, entries.length > 0);
    if (size === 'small') {
      root.append(dateHead(ctx, now));
      const next = entries[0];
      if (next) {
        const block = ctx.el('div', 'cal-next');
        if (dayKey(next.day) !== dayKey(now)) block.append(ctx.el('span', 'cal-daylabel', dayLabel(next.day, now)));
        block.append(eventRow(ctx, next, now));
        root.append(block);
      } else root.append(note(ctx, status || 'No more events today'));
    } else if (size === 'medium') {
      root.append(dateHead(ctx, now, 'is-side'));
      const list = ctx.el('div', 'cal-list');
      const shown = entries.slice(0, 3);
      for (const entry of shown) list.append(eventRow(ctx, entry, now, { withDay: true }));
      if (!shown.length) list.append(note(ctx, status || 'No more events today'));
      const rest = entries.slice(3).filter(entry => dayKey(entry.day) === dayKey(now)).length;
      if (rest) list.append(ctx.el('p', 'cal-more', `+${rest} more`));
      root.append(list);
    } else {
      const top = ctx.el('div', 'cal-head');
      top.append(dateHead(ctx, now, 'is-inline'));
      if (entries.length) top.append(ctx.el('span', 'cal-count', countText(entries.filter(entry => dayKey(entry.day) === dayKey(now)).length, 'event today', 'events today')));
      root.append(top);
      const list = ctx.el('div', 'cal-groups');
      let budget = 9.2, lastDay = null, shown = 0;
      for (const entry of entries) {
        const newDay = lastDay !== dayKey(entry.day), cost = newDay ? 1.55 : 1;
        if (budget < cost) break;
        budget -= cost; shown++;
        if (newDay) { list.append(ctx.el('h3', 'cal-day', dayLabel(entry.day, now))); lastDay = dayKey(entry.day); }
        list.append(eventRow(ctx, entry, now));
      }
      if (!shown) list.append(note(ctx, status || 'No events in the next week'));
      const more = entries.length - shown;
      if (more > 0) list.append(ctx.el('p', 'cal-more', `+${more} more`));
      root.append(list);
    }
    body.append(root);
  }

  // ---- Month ------------------------------------------------------------------
  // Weeks start on Monday (as in Poland and most of Europe), whatever the browser language.
  function firstWeekday() { return 1; }
  function monthGrid(ctx, now, events) {
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    const lead = (first.getDay() - firstWeekday() + 7) % 7;
    const length = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const weeks = Math.ceil((lead + length) / 7);
    const colors = new Map();
    for (const event of events) {
      const last = event.allDay ? addDays(startOfDay(event.end), -1) : startOfDay(event.end > event.start ? new Date(event.end - 1) : event.start);
      for (let day = startOfDay(event.start), count = 0; day <= last && count < 40; day = addDays(day, 1), count++) {
        if (day.getMonth() !== now.getMonth() || day.getFullYear() !== now.getFullYear()) continue;
        const list = colors.get(day.getDate()) || []; if (list.length < 3 && !list.includes(event.color)) list.push(event.color); colors.set(day.getDate(), list);
      }
    }
    const grid = ctx.el('div', 'cal-grid'); grid.dataset.weeks = String(weeks);
    grid.setAttribute('role', 'grid'); grid.setAttribute('aria-label', `${monthName(now)} ${now.getFullYear()}`);
    const heads = ctx.el('div', 'cal-weekdays'); heads.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < 7; i++) heads.append(ctx.el('span', '', weekdayName(new Date(2024, 0, 7 + firstWeekday() + i), 'narrow')));
    grid.append(heads);
    const days = ctx.el('div', 'cal-days');
    for (let i = 0; i < weeks * 7; i++) {
      const number = i - lead + 1, cell = ctx.el('span', 'cal-cell');
      if (number >= 1 && number <= length) {
        const today = number === now.getDate();
        const label = ctx.el('span', `cal-num${today ? ' is-today' : ''}`, String(number));
        if (today) label.setAttribute('aria-label', `Today, ${number}`);
        cell.append(label);
        const dots = ctx.el('span', 'cal-dots');
        for (const color of colors.get(number) || []) { const dot = ctx.el('i'); dot.style.background = color; dots.append(dot); }
        cell.append(dots);
      } else cell.setAttribute('aria-hidden', 'true');
      days.append(cell);
    }
    grid.append(days);
    return grid;
  }
  function renderMonth(body, ctx, calendar, now) {
    const size = ctx.size, events = prepare(calendar.events), entries = entriesFor(events, now, 14);
    const root = ctx.el('div', 'cal-root cal-month'); root.dataset.view = size;
    const calendarPart = ctx.el('div', 'cal-monthbox');
    const title = ctx.el('h3', 'cal-monthname'); title.append(ctx.el('span', '', monthName(now)));
    if (size !== 'small') title.append(ctx.el('span', 'cal-year', String(now.getFullYear())));
    calendarPart.append(title, monthGrid(ctx, now, events));
    root.append(calendarPart);
    if (size !== 'small') {
      const list = ctx.el('div', 'cal-list');
      const limit = size === 'medium' ? 2 : 3;
      const shown = entries.slice(0, limit);
      let lastDay = null;
      for (const entry of shown) {
        if (size === 'large' && lastDay !== dayKey(entry.day)) { list.append(ctx.el('h3', 'cal-day', dayLabel(entry.day, now))); lastDay = dayKey(entry.day); }
        list.append(eventRow(ctx, entry, now, { withDay: size === 'medium' }));
      }
      if (!shown.length) list.append(note(ctx, emptyText(calendar, false) || 'No upcoming events'));
      root.append(list);
    }
    body.append(root);
  }

  function render(body, ctx) {
    const calendar = ctx.state().calendar || { configured: false, events: [] };
    if (!calendar.configured) { renderNotConfigured(body, ctx); return; }
    const now = new Date();
    if (ctx.item.view === 'month') renderMonth(body, ctx, calendar, now); else renderUpNext(body, ctx, calendar, now);
  }
  function signature(ctx) { return [ctx.state().calendar, ctx.item.view, ctx.size, ctx.clock24(), Math.floor(Date.now() / 60000)]; }

  // ---- Settings -----------------------------------------------------------------
  const HELP = [
    ['Google Calendar', 'Settings → your calendar → Integrate calendar → Secret address in iCal format.'],
    ['Outlook.com', 'Settings → Calendar → Shared calendars → Publish a calendar → ICS link.'],
    ['iCloud', 'Calendar → share the calendar → Public Calendar, then copy the link.'],
  ];
  function statusLine(clock24, calendar, host) {
    if (!calendar.configured) return 'No calendar connected.';
    const now = new Date();
    const upcoming = prepare(calendar.events).filter(event => event.end > now || event.start >= startOfDay(now)).length;
    const parts = [`Connected to ${host || 'your calendar'}`, countText(upcoming, 'upcoming event', 'upcoming events')];
    const updated = new Date(calendar.updatedAt);
    if (calendar.updatedAt && Number.isFinite(updated.getTime())) parts.push(`updated ${clockText(updated, clock24)}`);
    return parts.join(' · ');
  }
  function renderSettings(content, ctx) {
    const { el } = ctx;
    const state = ctx.getState?.() || {};
    const calendar = state.calendar || { configured: false, events: [] };
    const host = state.config?.calendar?.host || '';
    const configured = calendar.configured === true || state.config?.calendar?.configured === true;
    const available = typeof ctx.bridge?.saveCalendar === 'function' && typeof ctx.bridge?.refreshCalendar === 'function';
    const view = { busy: false, error: '' };
    content.append(el('p', 'intro', 'Show your events with a private iCal link. It stays encrypted on this PC.'));
    const panel = el('div', 'cal-settings'); content.append(panel);
    const status = el('p', 'cal-status', statusLine(state.config?.clock24 !== false, { ...calendar, configured }, host));
    status.setAttribute('role', 'status'); panel.append(status);
    const problem = el('p', 'form-error', ''); problem.hidden = true; panel.append(problem);
    if (calendar.error && configured) { problem.textContent = calendar.error; problem.hidden = false; }
    const form = el('form', 'cal-form');
    const label = el('label', 'cal-label', 'iCal address'); const input = el('input', 'cal-input'); input.id = 'calendar-url-input'; label.htmlFor = input.id;
    input.type = 'password'; input.autocomplete = 'off'; input.spellcheck = false; input.maxLength = 2048; input.autocapitalize = 'off';
    input.placeholder = configured ? 'Saved' : 'https://… or webcal://…'; input.value = ''; input.disabled = !available;
    const save = ctx.button('Save', () => {}, { className: 'button primary', disabled: !available }); save.type = 'submit';
    const refresh = ctx.button('Refresh', () => run(() => ctx.bridge.refreshCalendar(), 'Calendar refreshed'), { className: 'button', disabled: !available || !configured });
    const remove = ctx.button('Remove', () => run(() => ctx.bridge.saveCalendar(''), 'Calendar removed'), { className: 'button danger', disabled: !available || !configured });
    const row = el('div', 'cal-actions'); row.append(save, refresh, remove);
    form.append(label, input, row); panel.append(form);
    if (!available) panel.append(el('p', 'cal-note', 'Open the desktop app to connect a calendar.'));
    function redraw() { if (content.isConnected) { content.replaceChildren(); renderSettings(content, ctx); } }
    async function run(action, message) {
      if (view.busy) return;
      view.busy = true; problem.hidden = true;
      for (const control of [input, save, refresh, remove]) control.disabled = true;
      status.textContent = 'Working…';
      try {
        const next = await action();
        if (next?.config) ctx.updateState?.(next);
        input.value = ''; ctx.toast?.(message);
      } catch (error) {
        view.error = String(error?.message || 'Could not reach Edge Deck.').replace(/^Error invoking remote method '[^']*': (?:Error: )?/, '').slice(0, 240);
      }
      view.busy = false;
      const error = view.error; redraw();
      if (error) { const next = content.querySelector('.cal-settings .form-error'); if (next) { next.textContent = error; next.hidden = false; } }
    }
    form.addEventListener('submit', event => {
      event.preventDefault();
      const value = input.value.trim();
      if (!value) { problem.textContent = 'Paste your calendar\'s iCal link first.'; problem.hidden = false; input.focus(); return; }
      view.error = ''; run(() => ctx.bridge.saveCalendar(value), 'Calendar saved');
    });
    const help = el('div', 'notice cal-help');
    help.append(el('p', 'cal-help-title', 'Where to find the private iCal address (keep it secret)'));
    for (const [name, text] of HELP) { const item = el('p', 'cal-help-item'); item.append(el('strong', '', `${name}: `), document.createTextNode(text)); help.append(item); }
    content.append(help);
  }

  window.EdgeWidgets = window.EdgeWidgets || {};
  window.EdgeWidgets.calendar = Object.freeze({ render, signature, helpers: Object.freeze({ prepare, entriesFor, dayLabel, rangeText, timeText, clockText, isNow }) });
  window.EdgeCalendar = Object.freeze({ renderSettings });
})();
