(() => {
  'use strict';
  // Screen Time widget: how long the PC was used today and by which apps, in the
  // style of iOS Screen Time. The service (lib/screen-time.cjs) keeps the numbers;
  // this only draws state.screenTime.
  //   Small: today's total, a bar split by the top three apps, the change vs the week's average.
  //   Medium: the total on the left, the top three apps with a bar and time each on the right.
  //   Large: total and daily average, today's hours as 24 bars, the top five apps and the pickups.
  const COLORS = ['#0a84ff', '#5ac8fa', '#ff9f0a', '#bf5af2', '#30d158'];
  const TOP = { small: 3, medium: 3, large: 5 };
  const PNG_DATA_URL = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/;
  const HOUR_LABELS = [[0, '00'], [6, '06'], [12, '12'], [18, '18']];
  const MIN_HOUR_SCALE = 600; // seconds: a quiet day does not fill the chart with one short bar

  const finite = value => Number.isFinite(value);
  const whole = value => finite(value) && value > 0 ? Math.round(value) : 0;

  // 13320 -> "3h 42m", 2520 -> "42m", under a minute -> "0m".
  function durationText(seconds) {
    const minutes = Math.floor(whole(seconds) / 60), hours = Math.floor(minutes / 60);
    return hours ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
  }
  // The same for speech: "3 hours 42 minutes".
  function spokenDuration(seconds) {
    const minutes = Math.floor(whole(seconds) / 60), hours = Math.floor(minutes / 60);
    const unit = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
    return hours ? `${unit(hours, 'hour')} ${unit(minutes % 60, 'minute')}` : unit(minutes, 'minute');
  }

  // The usable part of state.screenTime: null while nothing has been tracked.
  function readState(raw) {
    const today = raw && raw.today;
    if (!today || typeof today !== 'object') return null;
    const apps = (Array.isArray(today.apps) ? today.apps : []).filter(app => app && typeof app.name === 'string' && finite(app.seconds) && app.seconds > 0)
      .map(app => ({ name: app.name, label: String(app.label || app.name), seconds: app.seconds })).sort((a, b) => b.seconds - a.seconds);
    const hours = Array.from({ length: 24 }, (_, index) => whole(Array.isArray(today.hours) ? today.hours[index] : 0));
    const week = (Array.isArray(raw.week) ? raw.week : []).filter(day => day && typeof day.date === 'string' && finite(day.totalSeconds));
    return { running: raw.running === true, date: today.date, total: whole(today.totalSeconds), pickups: whole(today.pickups), hours, apps, week };
  }

  // Average of the earlier days that have any usage; null when there is no history.
  function dailyAverage(info) {
    const earlier = info.week.filter(day => day.date !== info.date && day.totalSeconds > 0);
    return earlier.length ? earlier.reduce((sum, day) => sum + day.totalSeconds, 0) / earlier.length : null;
  }
  // "12% below average" / "8% above average" / "About average"; null without history or usage today.
  function compare(info) {
    const average = dailyAverage(info);
    if (average === null || info.total <= 0) return null;
    const percent = Math.round(Math.abs(info.total - average) / average * 100);
    if (percent < 1) return { direction: 'same', text: 'About average' };
    const below = info.total < average;
    return { direction: below ? 'below' : 'above', text: `${percent}% ${below ? 'below' : 'above'} average` };
  }

  // Icons come from the PC stats card (state.pc.apps) when the program is running there.
  function iconFor(pc, name) {
    const key = String(name).toLowerCase().replace(/\.exe$/, '');
    const match = (Array.isArray(pc?.apps) ? pc.apps : []).find(app => app && String(app.name).toLowerCase().replace(/\.exe$/, '') === key);
    return match && typeof match.icon === 'string' && PNG_DATA_URL.test(match.icon) ? match.icon : null;
  }
  // The top apps with their colour, share of the day's total and, for bars, share of the busiest app.
  function topApps(info, count, pc) {
    const rows = info.apps.slice(0, count);
    const most = Math.max(1, ...rows.map(app => app.seconds));
    return rows.map((app, index) => ({
      name: app.name, label: app.label, seconds: app.seconds, color: COLORS[index % COLORS.length], text: durationText(app.seconds),
      icon: iconFor(pc, app.name), share: info.total > 0 ? Math.min(100, app.seconds / info.total * 100) : 0, bar: Math.max(3, app.seconds / most * 100),
    }));
  }
  function summary(info) {
    const parts = [`Screen Time today ${spokenDuration(info.total)}`];
    const change = compare(info); if (change) parts.push(change.text);
    if (info.apps.length) parts.push(`most used ${info.apps[0].label}`);
    return parts.join(', ');
  }

  function setVar(node, name, value) { node.style.setProperty(name, value); return node; }
  function emptyView(body, ctx, starting) {
    const root = ctx.el('div', 'st-widget st-empty'); root.dataset.view = ctx.size || 'medium';
    root.append(ctx.el('span', 'st-label', 'Screen Time'), ctx.el('strong', 'st-empty-title', starting ? 'Screen Time is starting' : 'No screen time yet today'),
      ctx.el('span', 'st-empty-note', starting ? 'Today’s usage shows up here shortly.' : 'It counts while you use this PC.'));
    body.append(root);
  }
  function appIcon(app, ctx) {
    const figure = ctx.el('span', 'st-app-icon');
    if (app.icon) { const image = ctx.el('img'); image.src = app.icon; image.alt = ''; image.width = 28; image.height = 28; figure.append(image); }
    else { figure.classList.add('is-letter'); setVar(figure, '--st-color', app.color); figure.append(ctx.el('span', '', (app.label.trim()[0] || '?').toUpperCase())); }
    return figure;
  }
  function splitBar(apps, info, ctx) {
    const bar = ctx.el('div', 'st-split'); bar.setAttribute('aria-hidden', 'true');
    for (const app of apps) { const part = ctx.el('span', 'st-split-part'); setVar(part, '--st-color', app.color); part.style.flexGrow = String(Math.max(1, app.seconds)); bar.append(part); }
    const rest = info.total - apps.reduce((sum, app) => sum + app.seconds, 0);
    if (rest > 1) { const other = ctx.el('span', 'st-split-part is-other'); other.style.flexGrow = String(rest); bar.append(other); }
    return bar;
  }
  function changeLine(info, ctx) {
    const change = compare(info);
    return change ? ctx.el('span', `st-change is-${change.direction}`, change.text) : null;
  }
  function appRows(apps, ctx) {
    const list = ctx.el('div', 'st-apps'); list.setAttribute('role', 'list');
    for (const app of apps) {
      const row = ctx.el('div', 'st-app'); row.setAttribute('role', 'listitem');
      const copy = ctx.el('div', 'st-app-copy');
      const top = ctx.el('div', 'st-app-top'); top.append(ctx.el('span', 'st-app-name', app.label), ctx.el('span', 'st-app-time', app.text));
      const track = ctx.el('div', 'st-bar'); track.setAttribute('aria-hidden', 'true');
      const fill = ctx.el('span'); setVar(fill, '--st-color', app.color); ctx.glide(`screentime:${ctx.card.id}:${ctx.item.id || ''}:${app.name}`, fill, 'width', `${app.bar.toFixed(1)}%`); track.append(fill);
      copy.append(top, track); row.append(appIcon(app, ctx), copy); list.append(row);
    }
    return list;
  }
  function hourChart(info, ctx) {
    const scale = Math.max(MIN_HOUR_SCALE, ...info.hours);
    const chart = ctx.el('div', 'st-chart'); chart.setAttribute('role', 'img');
    chart.setAttribute('aria-label', `Screen time by hour, busiest hour ${spokenDuration(Math.max(...info.hours))}`);
    const plot = ctx.el('div', 'st-plot'); plot.setAttribute('aria-hidden', 'true');
    for (const [hour] of HOUR_LABELS) { const line = ctx.el('span', 'st-grid'); line.style.left = `${hour / 24 * 100}%`; plot.append(line); }
    const bars = ctx.el('div', 'st-bars');
    info.hours.forEach(seconds => { const bar = ctx.el('span', `st-hour${seconds > 0 ? '' : ' is-empty'}`); bar.style.height = seconds > 0 ? `${Math.max(4, Math.min(100, seconds / scale * 100)).toFixed(1)}%` : ''; bars.append(bar); });
    plot.append(bars);
    const axis = ctx.el('div', 'st-axis'); axis.setAttribute('aria-hidden', 'true');
    for (const [hour, label] of HOUR_LABELS) { const mark = ctx.el('span', 'st-axis-label', label); mark.style.left = `${hour / 24 * 100}%`; axis.append(mark); }
    chart.append(plot, axis);
    return chart;
  }

  function render(body, ctx) {
    const info = readState(ctx.state().screenTime);
    const size = ['small', 'medium', 'large'].includes(ctx.size) ? ctx.size : 'medium';
    if (!info || (info.total === 0 && info.apps.length === 0 && !info.running)) return emptyView(body, ctx, true);
    if (info.total === 0 && info.apps.length === 0) return emptyView(body, ctx, false);
    const apps = topApps(info, TOP[size], ctx.state().pc);
    const root = ctx.el('div', 'st-widget'); root.dataset.view = size; root.setAttribute('role', 'group'); root.setAttribute('aria-label', summary(info));
    const total = ctx.el('strong', 'st-total', durationText(info.total));
    const label = ctx.el('span', 'st-label', 'Screen Time');
    if (size === 'small') {
      root.append(label, total, splitBar(apps, info, ctx));
      const change = changeLine(info, ctx); if (change) root.append(change);
    } else if (size === 'medium') {
      const left = ctx.el('div', 'st-summary'); left.append(label, total);
      const change = changeLine(info, ctx); if (change) left.append(change);
      root.append(left, appRows(apps, ctx));
    } else {
      const head = ctx.el('div', 'st-head');
      const left = ctx.el('div', 'st-summary'); left.append(label, total);
      const average = dailyAverage(info);
      const right = ctx.el('div', 'st-facts');
      const fact = (name, value) => { const item = ctx.el('div', 'st-fact'); item.append(ctx.el('span', 'st-fact-name', name), ctx.el('strong', 'st-fact-value', value)); return item; };
      right.append(fact('Daily average', average === null ? '—' : durationText(average)), fact('Pickups', String(info.pickups)));
      head.append(left, right);
      root.append(head, hourChart(info, ctx), appRows(apps, ctx));
    }
    body.append(root);
  }
  function signature(ctx) { return [ctx.state().screenTime, ctx.size]; }

  window.EdgeWidgets = window.EdgeWidgets || {};
  window.EdgeWidgets.screentime = Object.freeze({ render, signature, helpers: Object.freeze({ durationText, spokenDuration, readState, dailyAverage, compare, topApps, iconFor, summary, COLORS }) });
})();
