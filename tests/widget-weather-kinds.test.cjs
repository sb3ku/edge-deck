'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// A tiny DOM: enough for the module to build its tree and for the tests to walk it.
function node(tag) {
  const element = {
    tag, children: [], attributes: {}, dataset: {}, style: { setProperty(name, value) { element.style[name] = value; } }, className: '', textContent: '', title: '',
    append(...nodes) { element.children.push(...nodes); },
    setAttribute(name, value) { element.attributes[name] = String(value); },
    getAttribute(name) { return element.attributes[name] ?? null; },
    addEventListener() {},
    classList: { add(name) { element.attributes.class = [element.attributes.class, name].filter(Boolean).join(' '); } },
  };
  return element;
}
const fakeDocument = { createElement: tag => node(tag), createElementNS: (namespace, tag) => node(tag) };
function load() {
  const context = { document: fakeDocument };
  context.window = context; vm.createContext(context);
  for (const file of ['weather-ui.js', 'widget-weather-kinds.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', file), 'utf8'), context);
  return context.EdgeWidgets;
}
const plain = value => JSON.parse(JSON.stringify(value));
const classes = element => `${element.className || ''} ${element.attributes.class || ''}`.split(' ').filter(Boolean);
function all(element, predicate, found = []) {
  if (predicate(element)) found.push(element);
  for (const child of element.children) all(child, predicate, found);
  return found;
}
const byClass = (element, name) => all(element, item => classes(item).includes(name));
const one = (element, name) => { const found = byClass(element, name); assert.equal(found.length, 1, `one .${name}`); return found[0]; };
const text = (element, name) => one(element, name).textContent;

function context(weather, { size = 'small', clock24 = true } = {}) {
  const calls = [];
  const el = (tag, className, content) => { const element = node(tag); if (className) element.className = className; if (content !== undefined && content !== null) element.textContent = String(content); return element; };
  const button = (label, fn, options = {}) => { const element = el('button', options.className || 'button'); element.onClick = fn; if (options.label) element.setAttribute('aria-label', options.label); return element; };
  const emptyContent = (panel, symbol, title, message) => { const empty = el('div', 'empty-content'); empty.append(el('h3', '', title), el('p', '', message)); panel.append(empty); calls.push(['empty', symbol, title, message]); };
  const ctx = { card: { id: 'c1' }, item: { id: 'i1' }, size, state: () => ({ weather }), config: () => ({}), el, button, emptyContent, clock24: () => clock24, showSettings: tab => calls.push(['settings', tab]), lowPower: () => false };
  return { ctx, calls };
}

// Warsaw in November is UTC+1. All times below are for 2026-11-09 unless a date is given.
const TZ = 'Europe/Warsaw';
const at = (date, hh, mm) => { const [y, m, d] = date.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d, hh - 1, mm)).toISOString(); };
const NOON = Date.parse(at('2026-11-09', 12, 0));
function day(date, over = {}) {
  return { date, max: 5, min: -2, conditionCode: 3, precipProbability: 5, precipitation: 0, sunrise: at(date, 7, 22), sunset: at(date, 15, 41), windSpeed: 12, uvIndex: 2, ...over };
}
function weather(over = {}) {
  return {
    status: 'ready', configured: true, location: { name: 'Kraków', latitude: 52, longitude: 20, timezone: TZ }, units: { temperature: '°C', windSpeed: 'km/h', system: 'metric' },
    current: { temp: -4, apparentTemp: -9, conditionCode: 1, isDay: true, windSpeed: 7.4, windDirection: 200, humidity: 84, precipitation: 0, cloudCover: 20, visibility: 24000, time: at('2026-11-09', 12, 0) },
    hourly: [], daily: [day('2026-11-08', { sunrise: at('2026-11-08', 7, 20), sunset: at('2026-11-08', 15, 43) }), day('2026-11-09', { precipProbability: 85, max: 3, min: -3 }), day('2026-11-10', { precipProbability: 40, max: 3, min: 0, sunrise: at('2026-11-10', 7, 24), sunset: at('2026-11-10', 15, 39) }),
      day('2026-11-11', { max: 5, min: 2 }), day('2026-11-12'), day('2026-11-13'), day('2026-11-14'), day('2026-11-15')], updatedAt: at('2026-11-09', 11, 50), ...over,
  };
}

test('the three widgets register with render, signature and helpers', () => {
  const widgets = load();
  for (const type of ['rain-wind', 'daily-forecast', 'sun-path']) {
    assert.equal(typeof widgets[type].render, 'function', type); assert.equal(typeof widgets[type].signature, 'function', type);
    assert.ok(Object.isFrozen(widgets[type]), type);
  }
});

test('rain summary: first day with a 30% chance, none under 10%, a calm dash without data', () => {
  const { rainSummary } = load()['rain-wind'].helpers;
  const base = weather();
  assert.deepEqual(plain(rainSummary(base, NOON)), { text: '85% in 1d', percent: 85, days: 1, none: false });
  const later = weather({ daily: [day('2026-11-09', { precipProbability: 12 }), day('2026-11-10', { precipProbability: 20 }), day('2026-11-11', { precipProbability: 64 })] });
  assert.equal(rainSummary(later, NOON).text, '64% in 3d');
  const maybe = weather({ daily: [day('2026-11-09', { precipProbability: 18 }), day('2026-11-10', { precipProbability: 9 })] });
  assert.equal(rainSummary(maybe, NOON).text, '18% in 1d');
  const dry = weather({ daily: [day('2026-11-09', { precipProbability: 0 }), day('2026-11-10', { precipProbability: 9 })] });
  assert.deepEqual(plain(rainSummary(dry, NOON)), { text: 'No rain expected', percent: null, days: null, none: true });
  assert.equal(rainSummary(weather({ daily: [] }), NOON).text, '—');
  assert.equal(rainSummary(weather({ daily: [day('2026-11-09', { precipProbability: null })] }), NOON).text, '—');
  const past = weather({ daily: [day('2026-11-05', { precipProbability: 90 }), day('2026-11-09', { precipProbability: 0 })] });
  assert.equal(rainSummary(past, NOON).text, 'No rain expected', 'days before today are ignored');
});

test('text helpers: wind with units, visibility in km, UV level, detail rows without Feels like when unknown', () => {
  const { windText, visibilityText, uvText, detailRows } = load()['rain-wind'].helpers;
  assert.equal(windText(weather()), '7 km/h');
  assert.equal(windText(weather({ current: { windSpeed: null } })), '—');
  assert.equal(visibilityText(weather()), '24 km');
  assert.equal(visibilityText(weather({ current: { visibility: 4300 } })), '4.3 km');
  assert.equal(visibilityText(weather({ current: { visibility: 800 } })), '0.8 km');
  assert.equal(visibilityText(weather({ units: { system: 'imperial' }, current: { visibility: 16093 } })), '10 mi');
  assert.equal(visibilityText(weather({ current: {} })), '—');
  assert.deepEqual([uvText(1), uvText(4.4), uvText(7), uvText(9), uvText(12), uvText(undefined)], ['1 Low', '4 Moderate', '7 High', '9 Very high', '12 Extreme', '—']);
  assert.deepEqual(plain(detailRows(weather(), NOON)), [['Feels like', '-9°'], ['Humidity', '84%'], ['UV index', '2 Low'], ['Visibility', '24 km']]);
  const sparse = weather({ current: { temp: 1 }, daily: [] });
  assert.deepEqual(plain(detailRows(sparse, NOON)), [['Humidity', '—'], ['UV index', '—'], ['Visibility', '—']]);
  const real = weather(); delete real.current.apparentTemp; real.current.feelsLike = 3;
  assert.equal(detailRows(real, NOON)[0][1], '3°', 'the weather bridge calls it feelsLike');
});

test('range bar math: the lit segment sits between the day low and high inside the week range', () => {
  const { weekRange, rangeBar } = load()['daily-forecast'].helpers;
  const days = [{ min: -4, max: 6 }, { min: 0, max: 4 }, { min: null, max: 10 }, null];
  assert.deepEqual(plain(weekRange(days)), { min: -4, max: 10 });
  assert.equal(weekRange([]), null); assert.equal(weekRange([{ min: null, max: undefined }]), null);
  const range = { min: -4, max: 6 };
  assert.deepEqual(plain(rangeBar({ min: -4, max: 6 }, range)), { start: 0, size: 1 });
  assert.deepEqual(plain(rangeBar({ min: 1, max: 6 }, range)), { start: 0.5, size: 0.5 });
  const thin = rangeBar({ min: 2, max: 2 }, range);
  assert.ok(Math.abs(thin.start - 0.6) < 1e-9 && thin.size === 0.06, 'a one-degree-or-less day still shows 6%');
  const edge = rangeBar({ min: 6, max: 6 }, range);
  assert.ok(edge.start + edge.size <= 1 + 1e-9, 'never overflows the track');
  assert.equal(rangeBar({ min: null, max: 3 }, range), null); assert.equal(rangeBar({ min: 5, max: 1 }, range), null); assert.equal(rangeBar({ min: 0, max: 1 }, null), null);
  assert.deepEqual(plain(rangeBar({ min: 3, max: 3 }, { min: 3, max: 3 })), { start: 0, size: 0.06 }, 'a flat week does not divide by zero');
});

test('next days skip today and keep the weekday names', () => {
  const { nextDays, weekday } = load()['daily-forecast'].helpers;
  const days = nextDays(weather(), 4, NOON);
  assert.deepEqual(days.map(item => item.date), ['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13']);
  assert.deepEqual(days.map(item => weekday(item.date)), ['Tue', 'Wed', 'Thu', 'Fri']);
  assert.equal(nextDays(weather(), 6, NOON).length, 6);
  assert.deepEqual(plain(nextDays(weather({ daily: [] }), 4, NOON)), []);
});

test('the next sun event is sunrise before dawn, sunset by day, tomorrow\'s sunrise after dark', () => {
  const { nextSunEvent } = load()['sun-path'].helpers;
  const data = weather();
  const dawn = nextSunEvent(data, Date.parse(at('2026-11-09', 5, 0)));
  assert.deepEqual(plain([dawn.kind, dawn.at, dawn.other.kind, dawn.other.at]), ['sunrise', at('2026-11-09', 7, 22), 'sunset', at('2026-11-09', 15, 41)]);
  const noon = nextSunEvent(data, NOON);
  assert.deepEqual(plain([noon.kind, noon.at, noon.other.kind, noon.other.at]), ['sunset', at('2026-11-09', 15, 41), 'sunrise', at('2026-11-10', 7, 24)]);
  const night = nextSunEvent(data, Date.parse(at('2026-11-09', 20, 0)));
  assert.deepEqual(plain([night.kind, night.at, night.other.kind, night.other.at]), ['sunrise', at('2026-11-10', 7, 24), 'sunset', at('2026-11-09', 15, 41)]);
  const last = weather({ daily: [day('2026-11-09')] });
  assert.equal(nextSunEvent(last, Date.parse(at('2026-11-09', 20, 0))).at, null, 'no tomorrow: unknown, not a stale time');
  assert.equal(nextSunEvent(last, NOON).other.at, at('2026-11-09', 7, 22), 'sunrise falls back to today\'s');
  assert.equal(nextSunEvent(weather({ daily: [day('2026-11-09', { sunrise: null })] }), NOON), null);
  assert.equal(nextSunEvent(weather({ daily: [] }), NOON), null);
});

test('the sun curve is highest at solar noon, level at the horizon at sunrise and sunset, and below it at night', () => {
  const { sunCurve } = load()['sun-path'].helpers;
  const rise = Date.parse(at('2026-11-09', 7, 22)), set = Date.parse(at('2026-11-09', 15, 41)), noon = (rise + set) / 2;
  const options = { width: 240, height: 100, horizon: 60, up: 50, down: 30 };
  const curve = sunCurve(rise, set, noon, options);
  assert.ok(Math.abs(curve.dot.y - 10) < 0.01 && curve.dot.above, 'at noon the dot is `up` px above the horizon');
  assert.ok(Math.abs(curve.dot.x - 120) < 0.01, 'solar noon is the middle of the window');
  assert.ok(Math.abs(curve.riseX - (120 - (set - rise) / 2 / 86400000 * 240)) < 0.01);
  const edge = sunCurve(rise, set, rise, options);
  assert.ok(Math.abs(edge.dot.y - 60) < 0.01, 'on the horizon at sunrise');
  const dark = sunCurve(rise, set, rise - 3 * 3600000, options);
  assert.ok(dark.dot.y > 60 && dark.dot.y <= 90 && !dark.dot.above, 'below the horizon at night, within the box');
  const late = sunCurve(rise, set, noon + 36 * 3600000, options);
  assert.ok(late.dot.x <= 240, 'a time beyond the window stays at its edge');
  assert.ok(curve.points.every(point => point.y >= 10 - 1e-6 && point.y <= 90 + 1e-6 && point.x >= -1e-6 && point.x <= 240 + 1e-6));
  assert.ok(curve.points.some(point => point.t === rise) && curve.points.some(point => point.t === set), 'sunrise and sunset are exact samples');
  assert.ok(curve.points.filter(point => point.above).every(point => point.y <= 60 + 1e-6), 'the bright part is above the horizon');
  assert.match(curve.path, /^M[\d.-]+,[\d.-]+ L/); assert.match(curve.aboveArea, /Z$/);
  assert.equal(sunCurve(null, set, noon), null); assert.equal(sunCurve(set, rise, noon), null); assert.equal(sunCurve(NaN, NaN, NaN), null);
  assert.ok(sunCurve(rise, set, NaN, options).dot.above, 'no clock reading puts the sun at noon');
});

test('daylight length and change against yesterday, or tomorrow when yesterday is unknown', () => {
  const { daylight, durationText } = load()['sun-path'].helpers;
  assert.equal(durationText((9 * 60 + 14) * 60000), '9 h 14 min'); assert.equal(durationText(8 * 3600000 + 5 * 60000), '8 h 05 min');
  const light = daylight(weather(), NOON);
  assert.equal(light.text, 'Daylight 8 h 19 min');
  assert.deepEqual(plain(light.change), { minutes: -4, versus: 'yesterday', text: '4 min shorter than yesterday' });
  const longer = weather({ daily: [day('2026-11-08', { sunset: at('2026-11-08', 15, 39) }), day('2026-11-09')] });
  assert.equal(daylight(longer, NOON).change.text, '2 min longer than yesterday');
  const same = weather({ daily: [day('2026-11-08'), day('2026-11-09')] });
  assert.equal(daylight(same, NOON).change.text, 'Same as yesterday');
  const noYesterday = weather({ daily: [day('2026-11-09'), day('2026-11-10', { sunset: at('2026-11-10', 15, 39) })] });
  assert.deepEqual(plain(daylight(noYesterday, NOON).change), { minutes: -2, versus: 'tomorrow', text: '2 min shorter tomorrow' });
  const alone = daylight(weather({ daily: [day('2026-11-09')] }), NOON);
  assert.equal(alone.change, null); assert.equal(alone.text, 'Daylight 8 h 19 min');
  assert.equal(daylight(weather({ daily: [day('2026-11-09', { sunrise: null })] }), NOON), null);
  assert.equal(daylight(weather({ daily: [] }), NOON), null);
});

test('Details small shows city, temperature, high and low, precipitation and wind; medium adds the rows', () => {
  const widgets = load(); const body = node('div');
  widgets['rain-wind'].render(body, context(weather(), { size: 'small' }).ctx);
  const root = one(body, 'rain-wind-widget');
  assert.equal(root.dataset.size, 'small'); assert.ok(classes(root).includes('is-day'));
  assert.equal(text(root, 'wxk-city-name'), 'Kraków'); assert.equal(text(root, 'wxk-temp'), '-4°');
  assert.equal(text(root, 'wxk-hi'), '↑ 3°'); assert.equal(text(root, 'wxk-lo'), '↓ -3°');
  assert.deepEqual(byClass(root, 'rain-wind-label').map(item => item.textContent), ['Precipitation', 'Wind']);
  assert.deepEqual(byClass(root, 'rain-wind-value').map(item => item.children.at(-1)?.textContent ?? item.textContent), ['85% in 1d', '7 km/h']);
  assert.equal(byClass(root, 'rain-wind-more').length, 0);
  const wide = node('div'); widgets['rain-wind'].render(wide, context(weather(), { size: 'medium' }).ctx);
  assert.deepEqual(byClass(wide, 'rain-wind-row-label').map(item => item.textContent), ['Feels like', 'Humidity', 'UV index', 'Visibility']);
  assert.deepEqual(byClass(wide, 'rain-wind-row-value').map(item => item.textContent), ['-9°', '84%', '2 Low', '24 km']);
  const night = node('div'); widgets['rain-wind'].render(night, context(weather({ current: { ...weather().current, isDay: false } })).ctx);
  assert.ok(classes(one(night, 'rain-wind-widget')).includes('is-night'));
});

test('Daily forecast small lists four next days; medium shows six columns under a text header', () => {
  const widgets = load(); const small = node('div');
  widgets['daily-forecast'].render(small, context(weather(), { size: 'small' }).ctx);
  assert.deepEqual(byClass(small, 'daily-forecast-name').map(item => item.textContent), ['Tue', 'Wed', 'Thu', 'Fri']);
  assert.deepEqual(byClass(small, 'daily-forecast-low').map(item => item.textContent), ['0°', '2°', '-2°', '-2°']);
  assert.deepEqual(byClass(small, 'daily-forecast-high').map(item => item.textContent), ['3°', '5°', '5°', '5°']);
  assert.equal(byClass(small, 'daily-forecast-lit').length, 4); assert.equal(byClass(small, 'wxk-condition').length, 0);
  const medium = node('div'); widgets['daily-forecast'].render(medium, context(weather(), { size: 'medium' }).ctx);
  assert.equal(byClass(medium, 'daily-forecast-day').length, 6);
  assert.equal(text(medium, 'wxk-condition'), 'Mostly clear'); assert.equal(text(medium, 'wxk-range'), 'H:3° L:-3°');
  assert.equal(byClass(medium, 'daily-forecast-day')[0].getAttribute('aria-label'), 'Tue: Overcast, low 0°, high 3°');
  const lit = byClass(medium, 'daily-forecast-lit')[0];
  assert.match(lit.style['--start'], /^\d+(\.\d)?%$/); assert.match(lit.style['--size'], /^\d+(\.\d)?%$/);
});

test('Sunrise and sunset small and medium show the next event, the other one and the daylight', () => {
  const widgets = load();
  const small = node('div'); const { ctx } = context(weather(), { size: 'small' });
  widgets['sun-path'].render(small, ctx);
  const label = one(small, 'sun-path-label').children[1].textContent; assert.match(label, /^SUN(RISE|SET)$/);
  assert.match(text(small, 'sun-path-time'), /^\d\d:\d\d$/);
  assert.match(text(small, 'sun-path-other'), /^Sun(rise|set): \d\d:\d\d$/);
  assert.equal(byClass(small, 'sun-path-above').length, 1); assert.equal(byClass(small, 'sun-path-horizon').length, 1); assert.equal(byClass(small, 'sun-path-dot').length, 1);
  const medium = node('div'); widgets['sun-path'].render(medium, context(weather(), { size: 'medium' }).ctx);
  assert.deepEqual(byClass(medium, 'sun-path-end-time').map(item => item.textContent), ['07:22', '15:41']);
  assert.equal(text(medium, 'sun-path-length'), 'Daylight 8 h 19 min'); assert.equal(text(medium, 'sun-path-change'), '4 min shorter than yesterday');
  const twelve = node('div'); widgets['sun-path'].render(twelve, context(weather(), { size: 'medium', clock24: false }).ctx);
  assert.deepEqual(byClass(twelve, 'sun-path-end-time').map(item => item.textContent), ['7:22 am', '3:41 pm']);
  const alone = node('div'); widgets['sun-path'].render(alone, context(weather({ daily: [day('2026-11-09')] }), { size: 'medium' }).ctx);
  assert.equal(byClass(alone, 'sun-path-change').length, 0, 'no neighbour day: no change line');
});

test('missing data shows dashes, never NaN or undefined', () => {
  const widgets = load();
  const bare = weather({ current: { temp: null, conditionCode: null, isDay: null }, daily: [day('2026-11-09', { max: null, min: null, sunrise: null, sunset: null, precipProbability: null, uvIndex: null }), day('2026-11-10', { max: null, min: null, conditionCode: null })] });
  for (const type of ['rain-wind', 'daily-forecast', 'sun-path']) for (const size of ['small', 'medium']) {
    const body = node('div'); widgets[type].render(body, context(bare, { size }).ctx);
    const dump = JSON.stringify(body, (key, value) => key === 'onClick' ? undefined : value);
    assert.doesNotMatch(dump, /NaN|undefined|Invalid|null°/, `${type} ${size}`);
    assert.ok(classes(one(body, `${type}-widget`)).includes('is-neutral'), `${type} ${size} neutral without a day or night`);
  }
  const body = node('div'); widgets['sun-path'].render(body, context(bare, { size: 'small' }).ctx);
  assert.equal(text(body, 'sun-path-time'), '—'); assert.equal(text(body, 'sun-path-other'), 'Sunrise: —'); assert.equal(byClass(body, 'sun-path-above').length, 0);
});

test('not configured: a calm empty state that is one button to the city settings', () => {
  const widgets = load();
  for (const type of ['rain-wind', 'daily-forecast', 'sun-path']) for (const data of [{ configured: false }, weather({ location: null }), undefined]) {
    const body = node('div'); const { ctx, calls } = context(data, { size: 'small' });
    widgets[type].render(body, ctx);
    assert.deepEqual(calls[0], ['empty', 'weather', 'Choose a city', 'Tap to choose your city.'], type);
    const button = body.children[0]; assert.equal(button.tag, 'button'); assert.equal(button.getAttribute('aria-label'), 'Choose a city for the weather');
    button.onClick(); assert.deepEqual(calls.at(-1), ['settings', 'weather']);
    assert.equal(byClass(body, `${type}-widget`).length, 0);
  }
});

test('signature follows the weather, the clock setting and the size; sun path adds a five minute bucket', () => {
  const widgets = load(); const data = weather();
  const { ctx } = context(data, { size: 'medium', clock24: false });
  const signature = widgets['rain-wind'].signature(ctx);
  assert.equal(signature.length, 3); assert.equal(signature[0], data); assert.equal(signature[1], false); assert.equal(signature[2], 'medium');
  assert.equal(widgets['daily-forecast'].signature(ctx).length, 3);
  const sun = widgets['sun-path'].signature(ctx);
  assert.equal(sun.length, 4); assert.equal(sun[3], Math.floor(Date.now() / 300000));
});

// ---- Forecast ('weather') ----------------------------------------------------
function withHours(over = {}, base = Date.parse(at('2026-11-09', 12, 0))) {
  const hourly = Array.from({ length: 12 }, (_, i) => ({ time: new Date(base + i * 3600000).toISOString(), temp: i - 4, conditionCode: i % 2 ? 61 : 1, isDay: true, precipProbability: 10 }));
  return weather({ hourly, ...over });
}
const realNow = Date.now;
const withClock = (ms, fn) => { Date.now = () => ms; try { return fn(); } finally { Date.now = realNow; } };

test('forecast registers as the weather module with render, signature and helpers', () => {
  const widgets = load();
  assert.equal(typeof widgets.weather.render, 'function'); assert.ok(Object.isFrozen(widgets.weather));
  const data = weather(); const { ctx } = context(data, { size: 'large', clock24: false });
  const signature = widgets.weather.signature(ctx);
  assert.equal(signature.length, 4); assert.equal(signature[0], data); assert.equal(signature[1], false); assert.equal(signature[2], 'large'); assert.equal(signature[3], Math.floor(Date.now() / 600000));
});

test('forecast skies by condition and time of day', () => {
  const { skyOf } = load().weather.helpers;
  const sky = (conditionCode, isDay) => skyOf({ current: { conditionCode, isDay } });
  assert.equal(sky(0, true), 'clear-day'); assert.equal(sky(1, false), 'clear-night');
  assert.equal(sky(3, true), 'cloudy-day'); assert.equal(sky(2, false), 'cloudy-night');
  assert.equal(sky(63, true), 'rain'); assert.equal(sky(95, false), 'rain'); assert.equal(sky(73, true), 'snow'); assert.equal(sky(45, false), 'fog');
  assert.equal(skyOf({ current: null }), 'cloudy-day');
});

test('hourly columns: six from this hour; a sunset in the window takes a column with its time', () => {
  const { hourlyColumns } = load().weather.helpers;
  const dry = weather({ hourly: withHours().hourly, daily: [day('2026-11-09', { sunset: at('2026-11-09', 23, 50) }), day('2026-11-10', { sunrise: at('2026-11-10', 7, 24) })] });
  const plainColumns = hourlyColumns(dry, NOON + 5 * 60000);
  assert.equal(plainColumns.length, 6); assert.ok(plainColumns.every(column => column.kind === 'hour')); assert.equal(plainColumns[0].at, at('2026-11-09', 12, 0));
  const sunny = weather({ hourly: withHours().hourly, daily: [day('2026-11-09', { sunset: at('2026-11-09', 15, 41) }), day('2026-11-10')] });
  const withSun = hourlyColumns(sunny, NOON);
  assert.deepEqual(plain(withSun.map(column => column.kind)), ['hour', 'hour', 'hour', 'hour', 'sunset', 'hour']);
  assert.equal(withSun[4].at, at('2026-11-09', 15, 41));
  assert.deepEqual(plain(hourlyColumns(weather({ hourly: [] }), NOON)), []);
});

test('rain chance from 30% (rounded to ten) and the current dot on the week track', () => {
  const { rainChance, dotFraction } = load().weather.helpers;
  assert.equal(rainChance({ precipProbability: 29 }), ''); assert.equal(rainChance({ precipProbability: 60 }), '60%'); assert.equal(rainChance({ precipProbability: 64 }), '60%'); assert.equal(rainChance({}), '');
  assert.equal(dotFraction(0, { min: -4, max: 4 }), 0.5); assert.equal(dotFraction(-20, { min: -4, max: 4 }), 0); assert.equal(dotFraction(null, { min: 0, max: 1 }), null);
});

function renderForecast(data, size, extra = {}) {
  const body = node('div'); const { ctx, calls } = context(data, { size });
  Object.assign(ctx, extra); ctx.button = (label, fn, options = {}) => { const element = node('button'); element.className = options.className || 'button'; element.onClick = fn; if (options.label) element.setAttribute('aria-label', options.label); return element; };
  load().weather.render(body, ctx); return { body, calls, ctx };
}

test('forecast Small: city, big temperature, condition, high and low', () => {
  withClock(NOON, () => {
    const { body } = renderForecast(withHours(), 'small');
    const root = one(body, 'weather-forecast-widget');
    assert.equal(root.tag, 'button'); assert.equal(root.dataset.size, 'small'); assert.equal(root.dataset.sky, 'clear-day');
    assert.equal(text(body, 'wxf-city-name'), 'Kraków'); assert.equal(text(body, 'wxf-temp'), '-4°'); assert.equal(text(body, 'wxf-condition'), 'Mostly Clear'); assert.equal(text(body, 'wxf-range'), 'H:3° L:-3°');
    assert.equal(byClass(body, 'wxf-hours').length, 0); assert.equal(byClass(body, 'wxf-days').length, 0);
  });
});

test('forecast Medium has six hour columns; Large adds five day rows with chance and range bars', () => {
  withClock(NOON, () => {
    const medium = renderForecast(withHours(), 'medium').body;
    assert.equal(byClass(medium, 'wxf-hour').length, 6); assert.equal(byClass(medium, 'wxf-days').length, 0); assert.equal(text(medium, 'wxf-condition'), 'Mostly Clear');
    for (const size of ['large', 'tall']) {
      const body = renderForecast(withHours(), size).body;
      assert.equal(one(body, 'weather-forecast-widget').dataset.size, 'large');
      assert.equal(byClass(body, 'wxf-hour').length, 6); assert.equal(byClass(body, 'wxf-day').length, 5);
      assert.deepEqual(byClass(body, 'wxf-day-name').map(item => item.textContent), ['Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
      assert.deepEqual(byClass(body, 'wxf-chance').map(item => item.textContent), ['40%']);
      assert.equal(byClass(body, 'wxf-lit').length, 5); assert.equal(byClass(body, 'wxf-dot').length, 0);
    }
  });
});

test('forecast tap opens the forecast dialog, or the weather settings without it', () => {
  withClock(NOON, () => {
    let opened = 0; const shown = renderForecast(withHours(), 'small', { showWeather: () => { opened += 1; } });
    one(shown.body, 'weather-forecast-widget').onClick(); assert.equal(opened, 1); assert.equal(shown.calls.length, 0);
    const fallback = renderForecast(withHours(), 'small'); one(fallback.body, 'weather-forecast-widget').onClick(); assert.deepEqual(fallback.calls.at(-1), ['settings', 'weather']);
  });
});

test('forecast with missing values shows dashes, never NaN; unconfigured shows the empty state', () => {
  withClock(NOON, () => {
    const bare = weather({ current: { temp: null, conditionCode: null, isDay: null }, hourly: [], daily: [day('2026-11-09', { max: null, min: null }), day('2026-11-10', { max: null, min: null, precipProbability: null })] });
    for (const size of ['small', 'medium', 'large']) {
      const { body } = renderForecast(bare, size);
      assert.doesNotMatch(JSON.stringify(body, (key, value) => key === 'onClick' ? undefined : value), /NaN|undefined|Invalid|null°/, size);
      assert.equal(text(body, 'wxf-temp'), '—');
    }
    const { body, calls } = renderForecast({ configured: false }, 'medium');
    assert.deepEqual(calls[0], ['empty', 'weather', 'Choose a city', 'Tap to choose your city.']); assert.equal(byClass(body, 'weather-forecast-widget').length, 0);
  });
});
