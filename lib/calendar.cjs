'use strict';
// Calendar: reads events from a private iCal (ICS) link. The link is a secret
// (it carries a private token), so it is never logged, returned or put in an error.
const REFRESH_MS = 15 * 60000, TIMEOUT_MS = 15000, MAX_BYTES = 5 * 1024 * 1024, MAX_REDIRECTS = 5;
const MAX_EVENTS = 200, PAST_DAYS = 1, FUTURE_DAYS = 35, DAY_MS = 86400000;
const DEFAULT_COLOR = '#0a84ff';
const STALE_MESSAGE = 'Calendar unavailable · showing saved events';

// ---- The link ---------------------------------------------------------------
function normalizeCalendarUrl(input) {
  if (typeof input !== 'string') throw Error('Paste your calendar\'s iCal link.');
  let text = input.trim();
  if (!text || text.length > 2048 || /[\u0000-\u001f\u007f\s]/.test(text)) throw Error('Paste your calendar\'s iCal link.');
  text = text.replace(/^webcals?:\/\//i, 'https://');
  let url;
  try { url = new URL(text); } catch { throw Error('That is not a valid calendar link.'); }
  if (url.protocol !== 'https:') throw Error('The calendar link must start with https:// or webcal://.');
  if (url.username || url.password) throw Error('Remove the user name and password from the link.');
  if (!url.hostname) throw Error('That is not a valid calendar link.');
  return url.href;
}
const hostOf = value => { try { return new URL(value).hostname; } catch { return ''; } };

// ---- Time zones -------------------------------------------------------------
const WINDOWS_ZONES = {
  'UTC': 'UTC', 'GMT Standard Time': 'Europe/London', 'Greenwich Standard Time': 'Atlantic/Reykjavik',
  'W. Europe Standard Time': 'Europe/Berlin', 'Central Europe Standard Time': 'Europe/Budapest', 'Central European Standard Time': 'Europe/Warsaw',
  'Romance Standard Time': 'Europe/Paris', 'E. Europe Standard Time': 'Europe/Chisinau', 'FLE Standard Time': 'Europe/Kiev', 'GTB Standard Time': 'Europe/Bucharest',
  'Russian Standard Time': 'Europe/Moscow', 'Turkey Standard Time': 'Europe/Istanbul', 'Israel Standard Time': 'Asia/Jerusalem', 'Arab Standard Time': 'Asia/Riyadh',
  'Eastern Standard Time': 'America/New_York', 'Central Standard Time': 'America/Chicago', 'Mountain Standard Time': 'America/Denver', 'US Mountain Standard Time': 'America/Phoenix',
  'Pacific Standard Time': 'America/Los_Angeles', 'Alaskan Standard Time': 'America/Anchorage', 'Hawaiian Standard Time': 'Pacific/Honolulu',
  'Atlantic Standard Time': 'America/Halifax', 'Canada Central Standard Time': 'America/Regina', 'Central Standard Time (Mexico)': 'America/Mexico_City',
  'SA Pacific Standard Time': 'America/Bogota', 'E. South America Standard Time': 'America/Sao_Paulo', 'Argentina Standard Time': 'America/Argentina/Buenos_Aires',
  'South Africa Standard Time': 'Africa/Johannesburg', 'Egypt Standard Time': 'Africa/Cairo', 'W. Central Africa Standard Time': 'Africa/Lagos', 'E. Africa Standard Time': 'Africa/Nairobi',
  'India Standard Time': 'Asia/Kolkata', 'China Standard Time': 'Asia/Shanghai', 'Singapore Standard Time': 'Asia/Singapore', 'Tokyo Standard Time': 'Asia/Tokyo', 'Korea Standard Time': 'Asia/Seoul',
  'Taipei Standard Time': 'Asia/Taipei', 'Arabian Standard Time': 'Asia/Dubai', 'Pakistan Standard Time': 'Asia/Karachi', 'SE Asia Standard Time': 'Asia/Bangkok',
  'AUS Eastern Standard Time': 'Australia/Sydney', 'E. Australia Standard Time': 'Australia/Brisbane', 'Cen. Australia Standard Time': 'Australia/Adelaide', 'W. Australia Standard Time': 'Australia/Perth',
  'New Zealand Standard Time': 'Pacific/Auckland',
};
const zoneCache = new Map(), formatters = new Map();
function resolveZone(name) {
  if (typeof name !== 'string') return null;
  const raw = name.trim().replace(/^\/[^/]*\//, '');
  if (!raw) return null;
  if (zoneCache.has(raw)) return zoneCache.get(raw);
  let result = null;
  for (const candidate of [raw, WINDOWS_ZONES[raw]]) {
    if (!candidate) continue;
    try { new Intl.DateTimeFormat('en-US', { timeZone: candidate }); result = candidate; break; } catch {}
  }
  zoneCache.set(raw, result); return result;
}
function zoneOffset(zone, utcMs) {
  let format = formatters.get(zone);
  if (!format) { format = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }); formatters.set(zone, format); }
  const part = {}; for (const { type, value } of format.formatToParts(new Date(utcMs))) part[type] = Number(value);
  return Date.UTC(part.year, part.month - 1, part.day, part.hour % 24, part.minute, part.second) - Math.floor(utcMs / 1000) * 1000;
}
// A wall-clock time in a zone (null = this computer's zone) as an instant.
function wallToMs(dn, h, mi, s, zone) {
  const [y, m, d] = ymd(dn);
  if (zone === 'UTC') return Date.UTC(y, m - 1, d, h, mi, s);
  if (!zone) return new Date(y, m - 1, d, h, mi, s).getTime();
  const wall = Date.UTC(y, m - 1, d, h, mi, s);
  const first = wall - zoneOffset(zone, wall);
  const offset = zoneOffset(zone, first);
  const second = wall - offset;
  return zoneOffset(zone, second) === offset ? second : first;
}

// ---- Calendar days (whole days since 1970-01-01, no zone) ---------------------
const dayNumber = (y, m, d) => Math.floor(Date.UTC(y, m - 1, d) / DAY_MS);
function ymd(dn) { const date = new Date(dn * DAY_MS); return [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()]; }
const weekdayOf = dn => (((dn + 4) % 7) + 7) % 7; // 0 = Sunday
const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const localMidnight = dn => { const [y, m, d] = ymd(dn); return new Date(y, m - 1, d).getTime(); };

// ---- ICS text ---------------------------------------------------------------
function unfold(text) { return String(text).replace(/\r\n|\r/g, '\n').replace(/\n[ \t]/g, '').split('\n'); }
function parseLine(line) {
  let i = 0, quoted = false, name = '';
  const params = {};
  while (i < line.length && line[i] !== ';' && line[i] !== ':') i++;
  name = line.slice(0, i).toUpperCase();
  while (line[i] === ';') {
    let j = i + 1; quoted = false;
    while (j < line.length && (quoted || (line[j] !== ';' && line[j] !== ':'))) { if (line[j] === '"') quoted = !quoted; j++; }
    const part = line.slice(i + 1, j), eq = part.indexOf('=');
    if (eq > 0) params[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1).replace(/^"|"$/g, '');
    i = j;
  }
  if (line[i] !== ':') return null;
  return { name, params, value: line.slice(i + 1) };
}
const unescapeText = value => String(value).replace(/\\([nN,;\\])/g, (all, c) => c === 'n' || c === 'N' ? '\n' : c);
function cleanColor(value) {
  const match = /^#?([0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec(String(value || '').trim());
  return match ? `#${match[1].toLowerCase()}` : null;
}

// DTSTART-like value -> { allDay, dn, h, mi, s, zone, ms }
function parseDate(property, fallbackZone = null) {
  if (!property) return null;
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/i.exec(property.value.trim());
  if (!match) return null;
  const dn = dayNumber(Number(match[1]), Number(match[2]), Number(match[3]));
  const allDay = property.params.VALUE === 'DATE' || match[4] === undefined;
  if (allDay) return { allDay: true, dn, h: 0, mi: 0, s: 0, zone: null, ms: localMidnight(dn) };
  const h = Number(match[4]), mi = Number(match[5]), s = Number(match[6] || 0);
  const zone = match[7] ? 'UTC' : property.params.TZID ? resolveZone(property.params.TZID) : fallbackZone;
  return { allDay: false, dn, h, mi, s, zone, ms: wallToMs(dn, h, mi, s, zone) };
}
function parseDuration(value) {
  const match = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i.exec(String(value).trim());
  if (!match) return null;
  const [, sign, w, d, h, m, s] = match;
  const ms = ((Number(w || 0) * 7 + Number(d || 0)) * 86400 + Number(h || 0) * 3600 + Number(m || 0) * 60 + Number(s || 0)) * 1000;
  return sign === '-' ? -ms : ms;
}
const DAYS = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
function parseRule(text) {
  const rule = {};
  for (const part of String(text).split(';')) { const eq = part.indexOf('='); if (eq > 0) rule[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1); }
  const list = key => rule[key] ? rule[key].split(',').map(Number).filter(Number.isInteger) : null;
  const byday = rule.BYDAY ? rule.BYDAY.split(',').map(item => { const m = /^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/i.exec(item.trim()); return m ? { n: m[1] ? Number(m[1]) : 0, weekday: DAYS[m[2].toUpperCase()] } : null; }).filter(Boolean) : null;
  return { freq: String(rule.FREQ || '').toUpperCase(), interval: Math.max(1, Number(rule.INTERVAL) || 1), count: Number(rule.COUNT) > 0 ? Number(rule.COUNT) : null, until: rule.UNTIL || null,
    byday, bymonthday: list('BYMONTHDAY'), bymonth: list('BYMONTH'), wkst: DAYS[String(rule.WKST || 'MO').toUpperCase()] ?? 1 };
}

// The days of one month an event repeats on.
function monthDays(y, m, rule, startDay) {
  const length = daysInMonth(y, m), days = new Set();
  const first = dayNumber(y, m, 1);
  if (rule.bymonthday) {
    for (const value of rule.bymonthday) { const day = value > 0 ? value : length + value + 1; if (day >= 1 && day <= length) days.add(day); }
    if (rule.byday) for (const day of [...days]) if (!rule.byday.some(item => item.weekday === weekdayOf(first + day - 1))) days.delete(day);
  } else if (rule.byday) {
    for (const { n, weekday } of rule.byday) {
      const matches = []; for (let day = 1; day <= length; day++) if (weekdayOf(first + day - 1) === weekday) matches.push(day);
      if (!n) matches.forEach(day => days.add(day));
      else { const day = n > 0 ? matches[n - 1] : matches[matches.length + n]; if (day) days.add(day); }
    }
  } else if (startDay <= length) days.add(startDay);
  return [...days].sort((a, b) => a - b).map(day => first + day - 1);
}
function periodDays(rule, start, n) {
  const [y, m, d] = ymd(start.dn);
  if (rule.freq === 'DAILY') return [start.dn + n * rule.interval];
  if (rule.freq === 'WEEKLY') {
    const weekStart = start.dn - ((weekdayOf(start.dn) - rule.wkst + 7) % 7) + 7 * rule.interval * n;
    const weekdays = rule.byday ? [...new Set(rule.byday.map(item => item.weekday))] : [weekdayOf(start.dn)];
    return weekdays.map(weekday => weekStart + ((weekday - rule.wkst + 7) % 7)).sort((a, b) => a - b);
  }
  if (rule.freq === 'MONTHLY') { const index = m - 1 + n * rule.interval; return monthDays(y + Math.floor(index / 12), ((index % 12) + 12) % 12 + 1, rule, d); }
  if (rule.freq === 'YEARLY') {
    const year = y + n * rule.interval, months = rule.bymonth || [m];
    return [...months].sort((a, b) => a - b).flatMap(month => monthDays(year, month, rule, d));
  }
  return [];
}
const periodStart = (rule, start, n) => {
  const [y, m] = ymd(start.dn);
  if (rule.freq === 'DAILY') return start.dn + n * rule.interval;
  if (rule.freq === 'WEEKLY') return start.dn - 7 + 7 * rule.interval * n;
  if (rule.freq === 'MONTHLY') { const index = m - 1 + n * rule.interval; return dayNumber(y + Math.floor(index / 12), ((index % 12) + 12) % 12 + 1, 1); }
  return dayNumber(y + n * rule.interval, 1, 1);
};

// Every start of a repeating event that can fall in the window.
function occurrences(start, rule, windowEndDn, untilFor) {
  const result = [];
  if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(rule.freq)) return [start.dn];
  const until = rule.until ? untilFor(rule.until) : null;
  let count = 0;
  for (let n = 0; n < 200000; n++) {
    if (periodStart(rule, start, n) > windowEndDn) break;
    for (const dn of periodDays(rule, start, n)) {
      if (dn < start.dn) continue;
      if (rule.freq !== 'YEARLY' && rule.bymonth && !rule.bymonth.includes(ymd(dn)[1])) continue;
      if (rule.freq === 'DAILY') {
        if (rule.byday && !rule.byday.some(item => item.weekday === weekdayOf(dn))) continue;
        if (rule.bymonthday && !rule.bymonthday.includes(ymd(dn)[2])) continue;
      }
      count++;
      if (rule.count && count > rule.count) return result;
      if (until && (until.dateOnly ? dn > until.dn : wallToMs(dn, start.h, start.mi, start.s, start.zone) > until.ms)) return result;
      if (dn > windowEndDn) return result;
      result.push(dn);
      if (result.length > 20000) return result;
    }
  }
  return result;
}

// ---- Parsing ----------------------------------------------------------------
function parseIcs(text, now = Date.now(), maxEvents = MAX_EVENTS) {
  const lines = unfold(text);
  let name = '', color = null;
  const blocks = [];
  let current = null, depth = 0;
  for (const line of lines) {
    if (!line) continue;
    if (/^BEGIN:VEVENT$/i.test(line)) { current = []; depth = 0; continue; }
    if (/^END:VEVENT$/i.test(line)) { if (current) blocks.push(current); current = null; continue; }
    if (current) {
      if (/^BEGIN:/i.test(line)) { depth++; continue; }
      if (/^END:/i.test(line)) { depth--; continue; }
      if (depth > 0) continue; // alarms and other nested parts
      const property = parseLine(line); if (property) current.push(property);
    } else {
      const property = parseLine(line); if (!property) continue;
      if (property.name === 'X-WR-CALNAME' && !name) name = unescapeText(property.value).trim().slice(0, 80);
      else if ((property.name === 'X-APPLE-CALENDAR-COLOR' || property.name === 'COLOR') && !color) color = cleanColor(property.value);
    }
  }
  const todayDate = new Date(now);
  const todayDn = dayNumber(todayDate.getFullYear(), todayDate.getMonth() + 1, todayDate.getDate());
  const windowStart = localMidnight(todayDn - PAST_DAYS), windowEnd = localMidnight(todayDn + FUTURE_DAYS + 1);
  const windowEndDn = todayDn + FUTURE_DAYS + 2;
  const calendarColor = color || DEFAULT_COLOR;
  const overrides = new Set(), masters = [];
  const get = (props, key) => props.find(property => property.name === key);
  const all = (props, key) => props.filter(property => property.name === key);
  for (const props of blocks) {
    const uid = get(props, 'UID')?.value || '';
    const recurrence = get(props, 'RECURRENCE-ID');
    if (recurrence) { const parsed = parseDate(recurrence); if (parsed) overrides.add(`${uid}|${parsed.allDay ? 'd' + parsed.dn : parsed.ms}`); }
    masters.push({ props, uid, override: Boolean(recurrence) });
  }
  const events = [], used = new Set();
  const overlaps = (start, end) => start < windowEnd && (end > windowStart || (end <= start && start >= windowStart));
  const add = (props, uid, startMs, endMs, allDay, suffix) => {
    if (!overlaps(startMs, endMs)) return;
    let id = (uid || 'event') + (suffix ? `|${suffix}` : ''), n = 2; const base = id;
    while (used.has(id)) id = `${base}#${n++}`;
    used.add(id);
    const title = unescapeText(get(props, 'SUMMARY')?.value || '').replace(/\s+/g, ' ').trim().slice(0, 200) || 'Untitled';
    const location = unescapeText(get(props, 'LOCATION')?.value || '').replace(/\s*\n\s*/g, ', ').trim().slice(0, 200);
    events.push({ id: id.slice(0, 200), title, start: new Date(startMs).toISOString(), end: new Date(endMs).toISOString(), allDay, location, calendar: name, color: cleanColor(get(props, 'COLOR')?.value) || calendarColor });
  };
  for (const { props, uid, override } of masters) {
    try {
      if (/^CANCELLED$/i.test(get(props, 'STATUS')?.value?.trim() || '')) continue;
      const start = parseDate(get(props, 'DTSTART')); if (!start) continue;
      const endProperty = get(props, 'DTEND'), durationProperty = get(props, 'DURATION');
      let durationMs = 0, durationDays = 1, end = null;
      if (endProperty) end = parseDate(endProperty, start.zone);
      if (start.allDay) durationDays = end?.allDay ? Math.max(1, end.dn - start.dn) : durationProperty ? Math.max(1, Math.ceil((parseDuration(durationProperty.value) || DAY_MS) / DAY_MS)) : 1;
      else durationMs = end ? Math.max(0, end.ms - start.ms) : durationProperty ? Math.max(0, parseDuration(durationProperty.value) || 0) : 0;
      const spanFor = dn => start.allDay ? [localMidnight(dn), localMidnight(dn + durationDays)] : (() => { const ms = wallToMs(dn, start.h, start.mi, start.s, start.zone); return [ms, ms + durationMs]; })();
      const ruleProperty = get(props, 'RRULE');
      if (!ruleProperty || override) {
        const [s, e] = spanFor(start.dn);
        add(props, uid, s, e, start.allDay, override ? String(s) : '');
        continue;
      }
      const excluded = new Set();
      for (const property of all(props, 'EXDATE')) for (const value of property.value.split(',')) {
        const parsed = parseDate({ params: property.params, value }, start.zone);
        if (parsed) excluded.add(parsed.allDay ? 'd' + parsed.dn : String(parsed.ms));
      }
      const untilFor = value => { const parsed = parseDate({ params: {}, value }, start.zone); return parsed ? { dateOnly: parsed.allDay, dn: parsed.dn, ms: parsed.ms } : null; };
      for (const dn of occurrences(start, parseRule(ruleProperty.value), windowEndDn, untilFor)) {
        const [s, e] = spanFor(dn);
        const key = start.allDay ? 'd' + dn : String(s);
        if (excluded.has(key) || overrides.has(`${uid}|${key}`)) continue;
        add(props, uid, s, e, start.allDay, String(s));
      }
    } catch { /* one broken event must not hide the others */ }
  }
  events.sort((a, b) => a.start < b.start ? -1 : a.start > b.start ? 1 : a.title.localeCompare(b.title));
  return { name, color: calendarColor, events: events.slice(0, maxEvents) };
}

// ---- Fetching ---------------------------------------------------------------
async function readLimited(response) {
  const length = Number(response.headers?.get?.('content-length'));
  if (length > MAX_BYTES) throw Error('too large');
  if (!response.body?.getReader) { const text = await response.text(); if (Buffer.byteLength(text) > MAX_BYTES) throw Error('too large'); return text; }
  const reader = response.body.getReader(), chunks = []; let total = 0;
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    total += value.byteLength; if (total > MAX_BYTES) { try { await reader.cancel(); } catch {} throw Error('too large'); }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString('utf8');
}
async function download(url, fetchImpl) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    let target = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const response = await fetchImpl(target, { redirect: 'manual', signal: controller.signal, headers: { accept: 'text/calendar, text/plain;q=0.8, */*;q=0.5' }, cache: 'no-store', credentials: 'omit' });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers?.get?.('location'); if (!location) throw Error('redirect');
        const next = new URL(location, target); if (next.protocol !== 'https:') throw Error('redirect');
        target = next.href; try { await response.body?.cancel?.(); } catch {} continue;
      }
      if (!response.ok) throw Error('status');
      return await readLimited(response);
    }
    throw Error('redirects');
  } finally { clearTimeout(timer); }
}

function createCalendar({ getUrl, fetchImpl = globalThis.fetch, now = Date.now, onChange = () => {} } = {}) {
  let events = [], updatedAt = null, error = null, timer = null, inflight = null, lastKey = null;
  const urlNow = () => { try { return getUrl?.() || ''; } catch { return ''; } };
  const state = () => ({ configured: Boolean(urlNow()), events: events.map(event => ({ ...event })), updatedAt, error });
  const notify = () => { try { onChange(state()); } catch {} };
  async function run() {
    const url = urlNow();
    if (!url) { events = []; updatedAt = null; error = null; lastKey = null; notify(); return state(); }
    if (url !== lastKey) { events = []; updatedAt = null; error = null; lastKey = url; }
    try {
      if (!/^https:\/\//i.test(url)) throw Error('url');
      const text = await download(url, fetchImpl);
      if (!/BEGIN:VCALENDAR/i.test(text)) throw Error('format');
      events = parseIcs(text, now()).events; updatedAt = new Date(now()).toISOString(); error = null;
    } catch { error = updatedAt ? STALE_MESSAGE : 'Calendar unavailable · check the link'; }
    if (urlNow() !== url) return run(); // the link changed while loading
    notify(); return state();
  }
  function refresh() {
    if (!inflight) inflight = run().finally(() => { inflight = null; });
    return inflight;
  }
  function start() {
    if (timer) return;
    timer = setInterval(() => { refresh().catch(() => {}); }, REFRESH_MS); timer.unref?.();
    refresh().catch(() => {});
  }
  function stop() { if (timer) clearInterval(timer); timer = null; }
  return { start, stop, refresh, state };
}

module.exports = { createCalendar, parseIcs, normalizeCalendarUrl, hostOf, resolveZone, STALE_MESSAGE, DEFAULT_COLOR };
