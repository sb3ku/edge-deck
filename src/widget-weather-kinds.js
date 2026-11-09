(() => {
  'use strict';
  // Weather widgets, copying iOS: Forecast ('weather'), Details ('rain-wind'), Daily
  // forecast ('daily-forecast') and Sunrise and sunset ('sun-path'). Plain dark
  // cards (no animated sky). The data and formatting come from
  // window.EdgeWeatherUI.helpers; everything pure is exposed under `helpers` for tests.
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const DAY_MS = 24 * 3600000;
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const ui = () => window.EdgeWeatherUI.helpers;

  // ---- Pure helpers ----------------------------------------------------------
  const weatherOf = ctx => ctx.state().weather || { configured: false };
  const isReady = data => Boolean(data && data.configured && data.location);
  function dateKey(data, now) {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: ui().zone(data), year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(now));
    const part = type => parts.find(item => item.type === type)?.value;
    return `${part('year')}-${part('month')}-${part('day')}`;
  }
  const allDays = data => (Array.isArray(data?.daily) ? data.daily : []).filter(item => /^\d{4}-\d{2}-\d{2}$/.test(item?.date || '')).sort((a, b) => a.date < b.date ? -1 : 1);
  // The forecast days from today on (today first).
  const upcoming = (data, now = Date.now()) => { const key = dateKey(data, now); return allDays(data).filter(item => item.date >= key); };
  const todayItem = (data, now = Date.now()) => { const key = dateKey(data, now); return allDays(data).find(item => item.date === key) || null; };
  const percentOf = value => finite(value) ? `${Math.round(value)}%` : '—';

  // "85% in 1d": the first day with at least a 30% chance (1d is today, 2d tomorrow ...);
  // "No rain expected" when every day is under 10%; otherwise today's (first known) chance.
  function rainSummary(data, now = Date.now()) {
    const list = upcoming(data, now);
    const known = list.map((day, index) => ({ percent: day.precipProbability, index })).filter(item => finite(item.percent));
    if (!known.length) return { text: '—', percent: null, days: null, none: false };
    const likely = known.find(item => item.percent >= 30);
    if (likely) return { text: `${Math.round(likely.percent)}% in ${likely.index + 1}d`, percent: likely.percent, days: likely.index + 1, none: false };
    if (Math.max(...known.map(item => item.percent)) < 10) return { text: 'No rain expected', percent: null, days: null, none: true };
    return { text: `${Math.round(known[0].percent)}% in ${known[0].index + 1}d`, percent: known[0].percent, days: known[0].index + 1, none: false };
  }
  const windText = data => finite(data.current?.windSpeed) ? `${Math.round(data.current.windSpeed)} ${data.units?.windSpeed || ''}`.trim() : '—';
  function visibilityText(data) {
    const metres = data.current?.visibility;
    if (!finite(metres)) return '—';
    const imperial = data.units?.system === 'imperial';
    const value = metres / (imperial ? 1609.34 : 1000);
    return `${value >= 10 ? Math.round(value) : String(Math.round(value * 10) / 10)} ${imperial ? 'mi' : 'km'}`;
  }
  function uvText(value) {
    if (!finite(value)) return '—';
    const level = value < 3 ? 'Low' : value < 6 ? 'Moderate' : value < 8 ? 'High' : value < 11 ? 'Very high' : 'Extreme';
    return `${Math.round(value)} ${level}`;
  }
  const feelsLike = data => finite(data.current?.apparentTemp) ? data.current.apparentTemp : finite(data.current?.feelsLike) ? data.current.feelsLike : null;
  // The rows on the right of the Details Medium card; Feels like is left out when unknown.
  function detailRows(data, now = Date.now()) {
    const rows = [];
    const feels = feelsLike(data);
    if (feels !== null) rows.push(['Feels like', ui().temp(feels)]);
    rows.push(['Humidity', percentOf(data.current?.humidity)], ['UV index', uvText(todayItem(data, now)?.uvIndex)], ['Visibility', visibilityText(data)]);
    return rows;
  }
  // The week's lowest and highest temperature, and one day's lit segment within it.
  function weekRange(days) {
    const values = days.flatMap(day => [day?.min, day?.max]).filter(finite);
    return values.length ? { min: Math.min(...values), max: Math.max(...values) } : null;
  }
  // Fractions 0..1 of the track: start at the low, size up to the high (never thinner than 6%).
  function rangeBar(day, range) {
    if (!range || !finite(day?.min) || !finite(day?.max) || day.max < day.min) return null;
    const span = Math.max(1, range.max - range.min);
    const start = Math.min(0.94, Math.max(0, (day.min - range.min) / span));
    const size = Math.min(1 - start, Math.max(0.06, (day.max - day.min) / span));
    return { start, size };
  }
  const weekday = date => new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
  // The days after today for the Daily forecast card.
  const nextDays = (data, count, now = Date.now()) => { const key = dateKey(data, now); return upcoming(data, now).filter(day => day.date > key).slice(0, count); };

  const stamp = value => { const ms = Date.parse(value); return Number.isFinite(ms) ? ms : null; };
  // The next sunrise or sunset after `now`, with the other event for the bottom line.
  // After sunset the next event is tomorrow's sunrise (missing when tomorrow is unknown).
  function nextSunEvent(data, now = Date.now()) {
    const list = upcoming(data, now); const today = todayItem(data, now); const tomorrow = today ? list[1] : null;
    const rise = stamp(today?.sunrise), set = stamp(today?.sunset);
    if (rise === null || set === null) return null;
    if (now < rise) return { kind: 'sunrise', at: today.sunrise, other: { kind: 'sunset', at: today.sunset } };
    if (now < set) return { kind: 'sunset', at: today.sunset, other: { kind: 'sunrise', at: stamp(tomorrow?.sunrise) !== null ? tomorrow.sunrise : today.sunrise } };
    return { kind: 'sunrise', at: stamp(tomorrow?.sunrise) !== null ? tomorrow.sunrise : null, other: { kind: 'sunset', at: today.sunset } };
  }
  // The sun's path across a 24 hour window centred on solar noon. `height` is the
  // sun's elevation: 1 at noon, 0 at sunrise and sunset, negative at night. It is
  // drawn `up` px above the horizon line and eased to at most `down` px below it.
  function sunCurve(riseMs, setMs, nowMs, { width = 260, height = 100, horizon = 62, up = 52, down = 30, steps = 72 } = {}) {
    if (!finite(riseMs) || !finite(setMs) || setMs <= riseMs) return null;
    const length = Math.min(DAY_MS - 60000, Math.max(60000, setMs - riseMs));
    const noon = (riseMs + setMs) / 2, start = noon - DAY_MS / 2, cut = Math.cos(Math.PI * length / DAY_MS);
    const elevation = t => (Math.cos(2 * Math.PI * (t - noon) / DAY_MS) - cut) / (1 - cut);
    const at = t => {
      const e = elevation(t); const lift = e >= 0 ? e * up : -down * (1 - Math.exp(e * up / down));
      return { t, x: (t - start) / DAY_MS * width, y: horizon - lift, above: t >= riseMs && t <= setMs };
    };
    const times = new Set([riseMs, setMs]); for (let i = 0; i <= steps; i++) times.add(start + DAY_MS * i / steps);
    const points = [...times].sort((a, b) => a - b).map(at);
    const line = list => list.map((point, index) => `${index ? 'L' : 'M'}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ');
    const above = points.filter(point => point.above);
    const dot = at(finite(nowMs) ? Math.min(start + DAY_MS, Math.max(start, nowMs)) : noon);
    return { points, width, height, horizon, path: line(points), abovePath: line(above), aboveArea: `${line(above)} L${above[above.length - 1].x.toFixed(1)},${horizon} L${above[0].x.toFixed(1)},${horizon} Z`, dot: { x: dot.x, y: dot.y, above: dot.above }, riseX: at(riseMs).x, setX: at(setMs).x };
  }
  const durationText = ms => { const minutes = Math.round(ms / 60000); return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`; };
  function dayLength(day) { const rise = stamp(day?.sunrise), set = stamp(day?.sunset); return rise !== null && set !== null && set > rise ? set - rise : null; }
  // Daylight today and how much it changed against yesterday (or, without yesterday, tomorrow).
  function daylight(data, now = Date.now()) {
    const key = dateKey(data, now); const days = allDays(data); const index = days.findIndex(day => day.date === key);
    if (index < 0) return null;
    const length = dayLength(days[index]);
    if (length === null) return null;
    const result = { length, text: `Daylight ${durationText(length)}`, change: null };
    const yesterday = index > 0 ? days[index - 1] : null, tomorrow = days[index + 1] || null;
    const other = dayLength(yesterday) !== null ? { ms: dayLength(yesterday), versus: 'yesterday', sign: 1 } : dayLength(tomorrow) !== null ? { ms: dayLength(tomorrow), versus: 'tomorrow', sign: -1 } : null;
    if (other) {
      const minutes = Math.round((length - other.ms) * other.sign / 60000);
      const size = `${Math.abs(minutes)} min`;
      result.change = { minutes, versus: other.versus, text: minutes === 0 ? `Same as ${other.versus}` : other.versus === 'yesterday' ? `${size} ${minutes > 0 ? 'longer' : 'shorter'} than yesterday` : `${size} ${minutes > 0 ? 'longer' : 'shorter'} tomorrow` };
    }
    return result;
  }
  const phaseOf = data => data.current?.isDay === false ? 'night' : data.current?.isDay === true ? 'day' : 'neutral';

  // ---- DOM helpers -----------------------------------------------------------
  function svgNode(tag, attributes = {}) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
    return node;
  }
  const locationArrow = () => { const svg = svgNode('svg', { class: 'wxk-arrow', viewBox: '0 0 12 12', 'aria-hidden': 'true' }); svg.append(svgNode('path', { d: 'M11 1 1 5.2l4.3 1.5L6.8 11z' })); return svg; };
  function sunGlyph(kind) {
    const svg = svgNode('svg', { class: 'sun-path-glyph', viewBox: '0 0 24 18', 'aria-hidden': 'true' });
    svg.append(svgNode('path', { d: 'M2 15h20M6.5 15a5.5 5.5 0 0 1 11 0' }), svgNode('path', { d: kind === 'sunrise' ? 'M12 1v6M9.5 3.5 12 1l2.5 2.5' : 'M12 1v6M9.5 4.5 12 7l2.5-2.5' }));
    return svg;
  }
  const weatherIcon = (data, code, isDay) => { const icon = ui().icon(ui().condition(code)[1], isDay); icon.classList.add('wxk-icon'); return icon; };
  const clockText = (iso, data, ctx) => ui().time(iso, data, ctx.clock24() ? {} : { hour: 'numeric', minute: '2-digit', hourCycle: 'h12' });
  // The card is one button to the city chooser until a city is set.
  function renderEmpty(body, ctx, type) {
    // The city chooser (the forecast dialog), as the deck's weather card always opened.
    const open = ctx.button('', () => (typeof ctx.showWeather === 'function' ? ctx.showWeather() : ctx.showSettings('weather')), { className: `wxk-empty ${type}-empty`, label: type === 'weather-forecast' ? 'Choose weather city' : 'Choose a city for the weather' });
    ctx.emptyContent(open, 'weather', 'Choose a city', 'Tap to choose your city.');
    body.append(open);
  }
  function root(ctx, type, data) {
    const node = ctx.el('div', `wxk-root ${type}-widget is-${phaseOf(data)}`);
    node.dataset.size = ctx.size === 'medium' ? 'medium' : 'small';
    return node;
  }
  // City + temperature on the left, the condition icon with high and low on the right.
  function identity(ctx, data, now, mode) {
    const day = todayItem(data, now); const current = data.current;
    const head = ctx.el('div', 'wxk-head');
    const id = ctx.el('div', 'wxk-id'); const city = ctx.el('p', 'wxk-city');
    city.append(ctx.el('span', 'wxk-city-name', data.location.name), locationArrow()); city.title = data.location.name;
    id.append(city, ctx.el('p', 'wxk-temp', ui().temp(current?.temp)));
    const side = ctx.el('div', 'wxk-side');
    side.append(current ? weatherIcon(data, current.conditionCode, current.isDay) : ctx.el('span', 'wxk-icon'));
    if (mode === 'text') {
      side.append(ctx.el('p', 'wxk-condition', current ? ui().condition(current.conditionCode)[0] : 'Forecast unavailable'));
      side.append(ctx.el('p', 'wxk-range', `H:${finite(day?.max) ? ui().temp(day.max) : '—'} L:${finite(day?.min) ? ui().temp(day.min) : '—'}`));
    } else {
      side.append(ctx.el('p', 'wxk-hi', `↑ ${finite(day?.max) ? ui().temp(day.max) : '—'}`), ctx.el('p', 'wxk-lo', `↓ ${finite(day?.min) ? ui().temp(day.min) : '—'}`));
    }
    head.append(id, side);
    head.setAttribute('aria-label', `${data.location.name}, ${ui().temp(current?.temp)}${current ? `, ${ui().condition(current.conditionCode)[0]}` : ''}`);
    return head;
  }

  // ---- Details ---------------------------------------------------------------
  function renderRainWind(body, ctx) {
    const data = weatherOf(ctx);
    if (!isReady(data)) return renderEmpty(body, ctx, 'rain-wind');
    const now = Date.now(); const node = root(ctx, 'rain-wind', data); const medium = node.dataset.size === 'medium';
    const main = ctx.el('div', 'rain-wind-main'); const rain = rainSummary(data, now);
    const facts = ctx.el('div', 'rain-wind-facts');
    const precipitation = ctx.el('div', 'rain-wind-fact'); const value = ctx.el('p', 'rain-wind-value');
    const rainIcon = ui().icon('rain', true); rainIcon.classList.add('wxk-icon');
    value.append(rainIcon, ctx.el('span', '', rain.text));
    precipitation.append(ctx.el('p', 'rain-wind-label', 'Precipitation'), value);
    const wind = ctx.el('div', 'rain-wind-fact'); wind.append(ctx.el('p', 'rain-wind-label', 'Wind'), ctx.el('p', 'rain-wind-value', windText(data)));
    facts.append(precipitation, wind);
    main.append(identity(ctx, data, now, 'arrows'), facts); node.append(main);
    if (medium) {
      const more = ctx.el('dl', 'rain-wind-more');
      for (const [label, text] of detailRows(data, now)) { const row = ctx.el('div', 'rain-wind-row'); row.append(ctx.el('dt', 'rain-wind-row-label', label), ctx.el('dd', 'rain-wind-row-value', text)); more.append(row); }
      node.append(more);
    }
    body.append(node);
  }

  // ---- Daily forecast --------------------------------------------------------
  function renderDaily(body, ctx) {
    const data = weatherOf(ctx);
    if (!isReady(data)) return renderEmpty(body, ctx, 'daily-forecast');
    const now = Date.now(); const node = root(ctx, 'daily-forecast', data); const medium = node.dataset.size === 'medium';
    node.append(identity(ctx, data, now, medium ? 'text' : 'arrows'));
    const days = nextDays(data, medium ? 6 : 4, now); const range = weekRange(days);
    const list = ctx.el('div', 'daily-forecast-days'); list.setAttribute('role', 'list'); list.setAttribute('aria-label', 'Daily forecast');
    if (!days.length) list.append(ctx.el('p', 'daily-forecast-missing', 'Daily forecast unavailable'));
    for (const day of days) {
      const detail = ui().condition(day.conditionCode); const low = finite(day.min) ? ui().temp(day.min) : '—', high = finite(day.max) ? ui().temp(day.max) : '—';
      const row = ctx.el('div', 'daily-forecast-day'); row.setAttribute('role', 'listitem'); row.title = detail[0];
      row.setAttribute('aria-label', `${weekday(day.date)}: ${detail[0]}, low ${low}, high ${high}`);
      const track = ctx.el('span', 'daily-forecast-track'); track.setAttribute('aria-hidden', 'true');
      const bar = rangeBar(day, range);
      if (bar) { const lit = ctx.el('i', 'daily-forecast-lit'); lit.style.setProperty('--start', `${(bar.start * 100).toFixed(1)}%`); lit.style.setProperty('--size', `${(bar.size * 100).toFixed(1)}%`); track.append(lit); }
      const icon = weatherIcon(data, day.conditionCode, true);
      row.append(ctx.el('span', 'daily-forecast-name', weekday(day.date)), icon, ctx.el('span', 'daily-forecast-low', low), track, ctx.el('strong', 'daily-forecast-high', high));
      list.append(row);
    }
    node.append(list); body.append(node);
  }

  // ---- Sunrise and sunset ----------------------------------------------------
  const SUN_SIZES = { small: { width: 260, height: 104, horizon: 64, up: 50, down: 32 }, medium: { width: 570, height: 96, horizon: 60, up: 48, down: 30 } };
  function curveSvg(ctx, data, now, size) {
    const geometry = SUN_SIZES[size]; const day = todayItem(data, now);
    const curve = sunCurve(stamp(day?.sunrise), stamp(day?.sunset), now, geometry);
    const svg = svgNode('svg', { class: 'sun-path-curve', viewBox: `0 0 ${geometry.width} ${geometry.height}`, preserveAspectRatio: 'xMidYMid meet', 'aria-hidden': 'true' });
    svg.append(svgNode('line', { class: 'sun-path-horizon', x1: 0, y1: geometry.horizon, x2: geometry.width, y2: geometry.horizon }));
    if (!curve) return svg;
    svg.append(svgNode('path', { class: 'sun-path-below', d: curve.path }), svgNode('path', { class: 'sun-path-area', d: curve.aboveArea }), svgNode('path', { class: 'sun-path-above', d: curve.abovePath }));
    const marker = svgNode('g', { class: `sun-path-sun${curve.dot.above ? '' : ' is-below'}` });
    marker.append(svgNode('circle', { class: 'sun-path-glow', cx: curve.dot.x.toFixed(1), cy: curve.dot.y.toFixed(1), r: 11 }), svgNode('circle', { class: 'sun-path-dot', cx: curve.dot.x.toFixed(1), cy: curve.dot.y.toFixed(1), r: 5.5 }));
    svg.append(marker);
    return svg;
  }
  function renderSun(body, ctx) {
    const data = weatherOf(ctx);
    if (!isReady(data)) return renderEmpty(body, ctx, 'sun-path');
    const now = Date.now(); const node = root(ctx, 'sun-path', data); const medium = node.dataset.size === 'medium';
    const event = nextSunEvent(data, now); const day = todayItem(data, now);
    const kind = event?.kind || (data.current?.isDay === false ? 'sunrise' : 'sunset');
    const label = (name, className) => { const title = ctx.el('p', className); title.append(sunGlyph(name), ctx.el('span', '', name === 'sunrise' ? 'SUNRISE' : 'SUNSET')); return title; };
    const next = ctx.el('div', 'sun-path-next');
    next.append(label(kind, 'sun-path-label'), ctx.el('p', 'sun-path-time', event?.at ? clockText(event.at, data, ctx) : '—'));
    node.setAttribute('aria-label', `${kind === 'sunrise' ? 'Sunrise' : 'Sunset'} ${event?.at ? clockText(event.at, data, ctx) : 'unknown'}`); node.setAttribute('role', 'group');
    const svg = curveSvg(ctx, data, now, node.dataset.size);
    if (!medium) {
      const other = event?.other || { kind: kind === 'sunrise' ? 'sunset' : 'sunrise', at: kind === 'sunrise' ? day?.sunset : day?.sunrise };
      node.append(next, svg, ctx.el('p', 'sun-path-other', `${other.kind === 'sunrise' ? 'Sunrise' : 'Sunset'}: ${other.at ? clockText(other.at, data, ctx) : '—'}`));
    } else {
      const light = daylight(data, now); const top = ctx.el('div', 'sun-path-top'); const facts = ctx.el('div', 'sun-path-daylight');
      facts.append(ctx.el('p', 'sun-path-length', light ? light.text : 'Daylight —'));
      if (light?.change) facts.append(ctx.el('p', 'sun-path-change', light.change.text));
      top.append(next, facts);
      const ends = ctx.el('div', 'sun-path-ends');
      for (const [name, iso] of [['sunrise', day?.sunrise], ['sunset', day?.sunset]]) {
        const end = ctx.el('p', `sun-path-end is-${name}`); end.append(ctx.el('span', 'sun-path-end-label', name === 'sunrise' ? 'Sunrise' : 'Sunset'), ctx.el('strong', 'sun-path-end-time', iso ? clockText(iso, data, ctx) : '—')); ends.append(end);
      }
      node.append(top, svg, ends);
    }
    body.append(node);
  }

  // ---- Forecast (the iOS Forecast widget: Small, Medium, Large) ---------------
  // Background by condition and time of day.
  function skyOf(data) {
    const kind = data.current ? ui().condition(data.current.conditionCode)[1] : 'unknown';
    const night = data.current?.isDay === false;
    if (kind === 'clear') return night ? 'clear-night' : 'clear-day';
    const group = kind === 'rain' || kind === 'storm' ? 'rain' : kind === 'snow' ? 'snow' : kind === 'fog' ? 'fog' : 'cloudy';
    return group === 'cloudy' ? (night ? 'cloudy-night' : 'cloudy-day') : group;
  }
  // The six columns of the hourly strip, from the current hour on. A sunrise or sunset
  // inside the window takes its own column (labelled with its time) and pushes the last hour out.
  function hourlyColumns(data, now = Date.now(), count = 6) {
    const start = Math.floor(now / 3600000) * 3600000;
    const hours = (Array.isArray(data?.hourly) ? data.hourly : []).map(item => ({ item, ms: stamp(item?.time) })).filter(entry => entry.ms !== null && entry.ms >= start).sort((a, b) => a.ms - b.ms).slice(0, count);
    const columns = hours.map(({ item, ms }) => ({ kind: 'hour', ms, at: item.time, temp: finite(item.temp) ? item.temp : null, conditionCode: item.conditionCode, isDay: item.isDay }));
    if (!columns.length) return [];
    const first = columns[0].ms, last = columns[columns.length - 1].ms;
    for (const day of upcoming(data, now).slice(0, 2)) for (const kind of ['sunrise', 'sunset']) {
      const ms = stamp(day[kind]);
      if (ms === null || ms < first || ms >= last + 3600000 || ms < now) continue;
      const near = columns.filter(column => column.kind === 'hour' && column.ms <= ms).pop() || columns[0];
      columns.push({ kind, ms, at: day[kind], temp: near.temp, conditionCode: near.conditionCode, isDay: kind === 'sunrise' });
    }
    return columns.sort((a, b) => a.ms - b.ms || (a.kind === 'hour' ? -1 : 1)).slice(0, count);
  }
  // Rain chance shown under a day's icon from 30% up, iOS style (rounded to 10).
  const rainChance = day => finite(day?.precipProbability) && day.precipProbability >= 30 ? `${Math.round(day.precipProbability / 10) * 10}%` : '';
  // Where the current temperature sits on the week's track (0..1), or null.
  const dotFraction = (temp, range) => finite(temp) && range ? Math.min(1, Math.max(0, (temp - range.min) / Math.max(1, range.max - range.min))) : null;
  const highLow = day => `H:${finite(day?.max) ? ui().temp(day.max) : '—'} L:${finite(day?.min) ? ui().temp(day.min) : '—'}`;
  const conditionName = data => data.current ? ui().condition(data.current.conditionCode)[0].replace(/(^|\s)(\S)/g, (match, space, letter) => space + letter.toUpperCase()) : 'Forecast unavailable';

  function forecastHead(ctx, data, now) {
    const current = data.current;
    const head = ctx.el('div', 'wxf-head'); const id = ctx.el('div', 'wxf-id'); const city = ctx.el('p', 'wxf-city');
    city.append(ctx.el('span', 'wxf-city-name', data.location.name), locationArrow());
    id.append(city, ctx.el('p', 'wxf-temp', ui().temp(current?.temp)));
    const side = ctx.el('div', 'wxf-side');
    side.append(current ? weatherIcon(data, current.conditionCode, current.isDay) : ctx.el('span', 'wxk-icon'), ctx.el('p', 'wxf-condition', conditionName(data)), ctx.el('p', 'wxf-range', highLow(todayItem(data, now))));
    head.append(id, side);
    return head;
  }
  function forecastHours(ctx, data, now) {
    const strip = ctx.el('div', 'wxf-hours'); strip.setAttribute('role', 'list'); strip.setAttribute('aria-label', 'Hourly forecast');
    const columns = hourlyColumns(data, now, 6);
    if (!columns.length) strip.append(ctx.el('p', 'wxf-missing', 'Hourly forecast unavailable'));
    for (const column of columns) {
      const cell = ctx.el('div', column.kind === 'hour' ? 'wxf-hour' : 'wxf-hour is-sun'); cell.setAttribute('role', 'listitem');
      const label = column.kind === 'hour' ? ui().time(column.at, data, ctx.clock24() ? { minute: undefined } : { hour: 'numeric', minute: undefined, hourCycle: 'h12' }) : clockText(column.at, data, ctx);
      let glyph;
      if (column.kind === 'hour') glyph = weatherIcon(data, column.conditionCode, column.isDay); else { glyph = sunGlyph(column.kind); glyph.classList.add('wxf-sun'); }
      cell.append(ctx.el('span', 'wxf-hour-label', label), glyph, ctx.el('span', 'wxf-hour-temp', finite(column.temp) ? ui().temp(column.temp) : '—'));
      strip.append(cell);
    }
    return strip;
  }
  function forecastDays(ctx, data, now) {
    const days = nextDays(data, 5, now); const range = weekRange(days); const key = dateKey(data, now);
    const list = ctx.el('div', 'wxf-days'); list.setAttribute('role', 'list'); list.setAttribute('aria-label', 'Daily forecast');
    if (!days.length) list.append(ctx.el('p', 'wxf-missing', 'Daily forecast unavailable'));
    for (const day of days) {
      const detail = ui().condition(day.conditionCode); const low = finite(day.min) ? ui().temp(day.min) : '—', high = finite(day.max) ? ui().temp(day.max) : '—';
      const row = ctx.el('div', 'wxf-day'); row.setAttribute('role', 'listitem'); row.title = detail[0];
      row.setAttribute('aria-label', `${weekday(day.date)}: ${detail[0]}, low ${low}, high ${high}`);
      const symbol = ctx.el('span', 'wxf-day-icon'); symbol.append(weatherIcon(data, day.conditionCode, true));
      const chance = rainChance(day); if (chance) symbol.append(ctx.el('span', 'wxf-chance', chance));
      const track = ctx.el('span', 'wxf-track'); track.setAttribute('aria-hidden', 'true'); const bar = rangeBar(day, range);
      if (bar) {
        const lit = ctx.el('i', 'wxf-lit'); lit.style.setProperty('--start', bar.start.toFixed(4)); lit.style.setProperty('--size', bar.size.toFixed(4));
        lit.style.setProperty('--pos', `${bar.size >= 0.999 ? 0 : (bar.start / (1 - bar.size) * 100).toFixed(2)}%`); track.append(lit);
      }
      const dot = day.date === key ? dotFraction(data.current?.temp, range) : null;
      if (dot !== null) { const marker = ctx.el('i', 'wxf-dot'); marker.style.setProperty('--at', dot.toFixed(4)); track.append(marker); }
      row.append(ctx.el('span', 'wxf-day-name', weekday(day.date)), symbol, ctx.el('span', 'wxf-low', low), track, ctx.el('span', 'wxf-high', high));
      list.append(row);
    }
    return list;
  }
  function renderForecast(body, ctx) {
    const data = weatherOf(ctx);
    if (!isReady(data)) return renderEmpty(body, ctx, 'weather-forecast');
    const now = Date.now(); const size = ctx.size === 'small' || ctx.size === 'medium' ? ctx.size : 'large';
    const open = () => (typeof ctx.showWeather === 'function' ? ctx.showWeather() : ctx.showSettings('weather'));
    const node = ctx.button('', open, { className: `wxf-root weather-forecast-widget is-${phaseOf(data)}`, label: `Open weather for ${data.location.name}` });
    node.dataset.size = size; node.dataset.sky = skyOf(data);
    if (size === 'small') {
      const city = ctx.el('p', 'wxf-city'); city.append(ctx.el('span', 'wxf-city-name', data.location.name), locationArrow());
      const foot = ctx.el('div', 'wxf-foot');
      foot.append(data.current ? weatherIcon(data, data.current.conditionCode, data.current.isDay) : ctx.el('span', 'wxk-icon'), ctx.el('p', 'wxf-condition', conditionName(data)), ctx.el('p', 'wxf-range', highLow(todayItem(data, now))));
      node.append(city, ctx.el('p', 'wxf-temp', ui().temp(data.current?.temp)), foot);
    } else {
      node.append(forecastHead(ctx, data, now), forecastHours(ctx, data, now));
      if (size === 'large') node.append(forecastDays(ctx, data, now));
    }
    body.append(node);
  }
  const forecastHelpers = Object.freeze({ skyOf, hourlyColumns, rainChance, dotFraction, highLow, weekRange, rangeBar, nextDays, weekday });

  const helpers = Object.freeze({ rainSummary, windText, visibilityText, uvText, detailRows, weekRange, rangeBar, nextDays, nextSunEvent, sunCurve, daylight, durationText, upcoming, weekday, phaseOf });
  const signature = ctx => [ctx.state().weather, ctx.clock24(), ctx.size];
  // Edge Deck's own living sky (weather-sky.js) behind the iOS layouts, as on the deck's weather card.
  function withSky(render) {
    return (body, ctx) => {
      render(body, ctx);
      const data = ctx.state().weather || {};
      const scene = window.EdgeWeatherUI?.helpers?.scene;
      if (!data.configured || !data.location || typeof scene !== 'function' || typeof body.prepend !== 'function') return;
      const backdrop = scene(data, 'wx-backdrop'); backdrop.setAttribute('aria-hidden', 'true');
      body.prepend(backdrop); body.classList.add('has-sky');
    };
  }
  window.EdgeWidgets = window.EdgeWidgets || {};
  window.EdgeWidgets['rain-wind'] = Object.freeze({ render: withSky(renderRainWind), signature, helpers });
  window.EdgeWidgets['daily-forecast'] = Object.freeze({ render: withSky(renderDaily), signature, helpers });
  window.EdgeWidgets['sun-path'] = Object.freeze({ render: withSky(renderSun), signature: ctx => [...signature(ctx), Math.floor(Date.now() / 300000)], helpers });
  window.EdgeWidgets.weather = Object.freeze({ render: withSky(renderForecast), signature: ctx => [ctx.state().weather, ctx.clock24(), ctx.size, Math.floor(Date.now() / 600000)], helpers: forecastHelpers });
})();
