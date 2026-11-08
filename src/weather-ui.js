(() => {
  'use strict';
  const views = new WeakMap();
  // WMO interpretation codes: https://open-meteo.com/en/docs#weathervariables
  const conditions = {
    0: ['Clear', 'clear'], 1: ['Mostly clear', 'clear'], 2: ['Partly cloudy', 'partly'],
    3: ['Overcast', 'cloudy'], 45: ['Fog', 'fog'], 48: ['Freezing fog', 'fog'],
    51: ['Light drizzle', 'rain'], 53: ['Drizzle', 'rain'], 55: ['Heavy drizzle', 'rain'],
    56: ['Freezing drizzle', 'rain'], 57: ['Heavy freezing drizzle', 'rain'],
    61: ['Light rain', 'rain'], 63: ['Rain', 'rain'], 65: ['Heavy rain', 'rain'],
    66: ['Freezing rain', 'rain'], 67: ['Heavy freezing rain', 'rain'],
    71: ['Light snow', 'snow'], 73: ['Snow', 'snow'], 75: ['Heavy snow', 'snow'],
    77: ['Snow grains', 'snow'], 80: ['Light showers', 'rain'], 81: ['Showers', 'rain'],
    82: ['Heavy showers', 'rain'], 85: ['Snow showers', 'snow'], 86: ['Heavy snow showers', 'snow'],
    95: ['Thunderstorms', 'storm'], 96: ['Thunderstorms with hail', 'storm'],
    97: ['Heavy thunderstorms', 'storm'], 99: ['Thunderstorms with heavy hail', 'storm'],
  };
  function el(tag, className = '', text) {
    const node = document.createElement(tag); if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text); return node;
  }
  function finite(value) { return typeof value === 'number' && Number.isFinite(value); }
  function temp(value) { return finite(value) ? `${Math.round(value)}°` : '—'; }
  function condition(code) { return Number.isInteger(code) && Object.hasOwn(conditions, code) ? conditions[code] : ['Conditions unavailable', 'unknown']; }
  function weather(context) { return context.getState?.()?.weather || { configured: false, current: null, hourly: [], daily: [] }; }
  function zone(data) {
    const value = data.location?.timezone;
    try { if (value) { new Intl.DateTimeFormat('en', { timeZone: value }).format(); return value; } } catch {}
    return 'UTC';
  }
  function time(value, data, options = {}) {
    if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return '—';
    return new Intl.DateTimeFormat('en-GB', { timeZone: zone(data), hour: '2-digit', minute: '2-digit', hourCycle: 'h23', ...options }).format(new Date(value));
  }
  function today(data) {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone(data), year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts();
    const value = key => parts.find(part => part.type === key)?.value;
    return `${value('year')}-${value('month')}-${value('day')}`;
  }
  function daily(data) { return (Array.isArray(data.daily) ? data.daily : []).filter(item => /^\d{4}-\d{2}-\d{2}$/.test(item?.date || '') && item.date >= today(data)).slice(0, 7); }
  function currentDay(data) { return daily(data).find(item => item.date === today(data)); }
  function hours(data, count = 24) {
    const cutoff = Date.now() - 60 * 60 * 1000;
    return (Array.isArray(data.hourly) ? data.hourly : []).filter(item => typeof item?.time === 'string' && Date.parse(item.time) >= cutoff).slice(0, count);
  }
  // Precipitation strength from the WMO code drives rain and snow density.
  const intensities = { 51: 0.25, 53: 0.4, 55: 0.55, 56: 0.35, 57: 0.55, 61: 0.45, 63: 0.7, 65: 1, 66: 0.5, 67: 0.9, 71: 0.35, 73: 0.6, 75: 1, 77: 0.3, 80: 0.45, 81: 0.7, 82: 1, 85: 0.5, 86: 0.9, 95: 0.85, 96: 0.95, 97: 1, 99: 1 };
  function skyPhase(data) {
    const day = currentDay(data); const now = Date.now();
    const rise = Date.parse(day?.sunrise), set = Date.parse(day?.sunset);
    if (Number.isFinite(rise) && Number.isFinite(set)) {
      if (Math.abs(now - rise) < 40 * 60000) return 'dawn';
      if (Math.abs(now - set) < 40 * 60000) return 'dusk';
      return now > rise && now < set ? 'day' : 'night';
    }
    return data.current?.isDay === false ? 'night' : 'day';
  }
  function skyModel(data) {
    if (!data.current) return { kind: 'unknown', phase: skyPhase(data) };
    const code = data.current.conditionCode;
    const wind = finite(data.current.windSpeed) ? data.current.windSpeed * (data.units?.system === 'imperial' ? 1.609 : 1) : null;
    return { kind: condition(code)[1], scene: skyScene(code, data.current.cloudCover, wind), phase: skyPhase(data), intensity: intensities[code] ?? 0.6, cloudCover: data.current.cloudCover ?? null, wind, mostlyClear: code === 1, visibility: finite(data.current.visibility) ? data.current.visibility : null };
  }
  // The sky for each WMO code; cloud cover and wind refine the dry ones.
  const scenes = { 0: 'clear', 1: 'mostly-clear', 2: 'partly', 3: 'cloudy', 45: 'fog', 48: 'freezing-fog', 51: 'drizzle', 53: 'drizzle', 55: 'drizzle',
    56: 'freezing-drizzle', 57: 'freezing-drizzle', 61: 'rain', 63: 'rain', 65: 'heavy-rain', 66: 'freezing-rain', 67: 'sleet', 71: 'flurries', 73: 'snow', 75: 'heavy-snow',
    77: 'snow-grains', 80: 'showers', 81: 'showers', 82: 'heavy-rain', 85: 'snow-showers', 86: 'heavy-snow', 95: 'storm', 96: 'hail', 97: 'severe-storm', 99: 'hail' };
  function skyScene(code, cloudCover, wind) {
    let scene = scenes[code] || 'unknown';
    if (scene === 'partly' && finite(cloudCover) && cloudCover >= 70) scene = 'mostly-cloudy';
    if ((scene === 'heavy-snow' || scene === 'snow') && finite(wind) && wind >= 40) scene = 'blizzard';
    if (['clear', 'mostly-clear', 'partly', 'mostly-cloudy'].includes(scene) && finite(wind) && wind >= 40) scene = 'windy';
    return scene;
  }
  function hourLabel(item, data) {
    const difference = Date.now() - Date.parse(item.time);
    return difference >= 0 && difference < 60 * 60 * 1000 ? 'Now' : time(item.time, data, { minute: undefined });
  }
  function updated(data) {
    if (!data.updatedAt) return data.stale ? 'Saved forecast' : 'Waiting for forecast';
    const date = new Date(data.updatedAt);
    const sameDay = Number.isFinite(date.getTime()) && new Intl.DateTimeFormat('en-CA', { timeZone: zone(data), year: 'numeric', month: '2-digit', day: '2-digit' }).format(date) === new Intl.DateTimeFormat('en-CA', { timeZone: zone(data), year: 'numeric', month: '2-digit', day: '2-digit' }).format();
    const stamp = time(data.updatedAt, data, sameDay ? {} : { day: 'numeric', month: 'short' });
    return `${data.stale || data.status === 'stale' ? 'Saved forecast' : 'Updated'} ${stamp}`;
  }
  function safeError(error) {
    const message = typeof error === 'string' ? error : error?.message;
    return typeof message === 'string' && message.length < 400 && !/(?:[a-z]:[\\/]|token\s*[:=]|password\s*[:=])/i.test(message)
      ? message.replace(/[\u0000-\u001f\u007f]/g, ' ') : 'Weather is unavailable. Try again shortly.';
  }
  function icon(kind, isDay = true) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 32 32'); svg.setAttribute('aria-hidden', 'true'); svg.classList.add('weather-icon');
    const path = (d, className) => { const node = document.createElementNS(svg.namespaceURI, 'path'); node.setAttribute('d', d); if (className) node.setAttribute('class', className); svg.append(node); };
    const sun = () => { path('M16 9a7 7 0 1 0 0 14 7 7 0 0 0 0-14Z', 'weather-sun'); path('M16 2v3M16 27v3M2 16h3M27 16h3M6 6l2 2M24 24l2 2M6 26l2-2M24 8l2-2', 'weather-sun-rays'); };
    const cloud = () => path('M8 22h16a5 5 0 0 0 .2-10 8 8 0 0 0-15-1A5.5 5.5 0 0 0 8 22Z', 'weather-cloud');
    if (kind === 'clear') {
      if (isDay === false) path('M23 22A12 12 0 0 1 11 6a11 11 0 1 0 12 16Z', 'weather-moon'); else sun();
    } else if (kind === 'partly') {
      if (isDay === false) path('M24 13a7 7 0 0 1-7-9 7 7 0 0 0-4 10', 'weather-moon');
      else path('M21 5a6 6 0 0 0-6 6M21 2v2M29 11h-2M27 5l-2 2', 'weather-sun-rays');
      cloud();
    }
    else if (['cloudy', 'rain', 'snow', 'storm', 'fog'].includes(kind)) {
      cloud();
      if (kind === 'rain') path('m10 26-1 3m8-3-1 3m8-3-1 3', 'weather-rain');
      if (kind === 'snow') path('M10 26v4m-2-2h4M22 26v4m-2-2h4', 'weather-snow');
      if (kind === 'storm') path('m17 23-4 5h4l-2 4', 'weather-lightning');
      if (kind === 'fog') path('M6 26h20M9 30h14', 'weather-fog');
    } else { path('M6 16h20', 'weather-unknown'); }
    return svg;
  }
  function scene(data, className, previousSky = null) {
    const result = el('div', className); const kind = condition(data.current?.conditionCode)[1];
    result.dataset.condition = kind; result.dataset.day = data.current?.isDay === true ? 'day' : data.current?.isDay === false ? 'night' : 'unknown';
    if (window.EdgeWeatherSky) {
      // Moving the existing sky keeps its clouds and rain running smoothly.
      const sky = previousSky || window.EdgeWeatherSky.create(skyModel(data));
      if (previousSky) window.EdgeWeatherSky.update(sky, skyModel(data));
      result.append(sky); return result;
    }
    const atmosphere = el('div', 'weather-atmosphere'); atmosphere.setAttribute('aria-hidden', 'true');
    if (['cloudy', 'partly', 'fog', 'rain', 'snow', 'storm'].includes(kind)) {
      atmosphere.append(el('i', 'weather-cloud-shape one'), el('i', 'weather-cloud-shape two'));
    }
    if (kind === 'rain' || kind === 'storm') for (let i = 0; i < 7; i++) { const drop = el('i', 'weather-rain-drop'); drop.style.setProperty('--drop', i); atmosphere.append(drop); }
    result.append(atmosphere); return result;
  }
  function range(data, className = 'weather-high-low') {
    const day = currentDay(data); const output = el('p', className);
    if (finite(day?.max)) output.append(el('span', '', `H:${temp(day.max)}`));
    if (finite(day?.min)) output.append(el('span', '', `L:${temp(day.min)}`));
    return output;
  }
  function hourStrip(data, count, compact) {
    const strip = el('div', compact ? 'weather-card-hours' : 'weather-hours');
    const items = hours(data, count);
    if (!items.length) { strip.append(el('p', 'weather-missing', 'Hourly forecast unavailable')); return strip; }
    strip.setAttribute('aria-label', 'Hourly forecast');
    for (const item of items) {
      const detail = condition(item.conditionCode);
      const cell = el('div', 'weather-hour'); cell.title = detail[0];
      cell.append(el('span', 'weather-hour-time', hourLabel(item, data)), icon(detail[1], item.isDay), el('strong', 'weather-hour-temp', temp(item.temp)));
      if (!compact) cell.append(el('span', 'weather-rain-chance', finite(item.precipProbability) ? `${Math.round(item.precipProbability)}%` : '—'));
      cell.setAttribute('aria-label', `${hourLabel(item, data)}, ${temp(item.temp)}, ${detail[0]}${finite(item.precipProbability) ? `, precipitation chance ${Math.round(item.precipProbability)} percent` : ''}`);
      strip.append(cell);
    }
    return strip;
  }
  function action(label, fn, className = '', disabled = false) {
    const button = el('button', `weather-button ${className}`, label); button.type = 'button'; button.disabled = disabled;
    button.addEventListener('click', fn); return button;
  }
  // The next days, for the larger widget sizes (shown or hidden by size).
  function weekList(data, count = 5) {
    const list = el('div', 'weather-week');
    const days = (Array.isArray(data.daily) ? data.daily : []).slice(0, count);
    for (const day of days) {
      const row = el('div', 'weather-week-day');
      const name = day.date === today(data) ? 'Today' : new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${day.date}T12:00:00Z`));
      row.append(el('span', 'weather-week-name', name), icon(condition(day.conditionCode)[1], true), el('span', 'weather-week-low', finite(day.min) ? temp(day.min) : '—'), el('span', 'weather-week-high', finite(day.max) ? temp(day.max) : '—'));
      list.append(row);
    }
    return list;
  }
  function renderWidget(container, context) {
    const data = weather(context); const configured = Boolean(data.configured && data.location);
    const card = scene(data, 'weather-widget', container.querySelector(':scope > .weather-widget > .sky'));
    const heading = el('div', 'weather-card-heading'); heading.append(el('span', 'weather-eyebrow', 'Weather'));
    if (data.stale || data.status === 'stale') heading.append(el('span', 'weather-stale-badge', 'Saved'));
    card.append(heading);
    if (!configured) {
      const empty = el('div', 'weather-card-empty'); empty.append(icon('partly'), el('h3', '', 'Your weather'), el('p', '', 'Choose a city for the forecast at a glance.'), el('span', 'weather-card-setup', 'Choose city'));
      card.append(empty);
    } else {
      const city = el('h3', 'weather-card-city', data.location.name); city.title = data.location.name; card.append(city);
      const main = el('div', 'weather-card-main');
      main.append(el('p', 'weather-card-temperature', temp(data.current?.temp)), el('p', 'weather-card-condition', data.current ? condition(data.current.conditionCode)[0] : 'Forecast unavailable'), range(data));
      card.append(main, hourStrip(data, 6, true), weekList(data));
      const note = el('p', `weather-card-note${data.error ? ' has-error' : ''}`, data.error ? (data.current ? 'Saved forecast · connection unavailable' : 'Weather unavailable · tap for details') : updated(data));
      card.append(note);
    }
    card.append(el('span', 'weather-card-source', 'Open-Meteo'));
    const open = action('', () => context.onOpen?.(), 'weather-card-open', typeof context.onOpen !== 'function');
    open.setAttribute('aria-label', configured ? `Open weather for ${data.location.name}` : 'Choose weather city'); card.append(open);
    container.replaceChildren(card); return true;
  }
  function renderDetails(container, context) {
    const data = weather(context); const configured = Boolean(data.configured && data.location);
    let view = views.get(container);
    if (!view) { view = { query: '', results: [], searchOpen: !configured, searched: false, searching: false, saving: false, error: '', root: null, request: 0 }; views.set(container, view); }
    if (context.liveRefresh && view.root?.isConnected && (view.searching || view.saving || container.contains(document.activeElement) && document.activeElement.matches('input'))) return false;
    const previousSky = container.querySelector('.weather-summary > .sky');
    const root = el('section', 'weather-details'); root.setAttribute('aria-label', 'Weather forecast'); root.setAttribute('aria-busy', String(view.saving || view.searching)); view.root = root; container.replaceChildren(root);
    const mounted = () => container.isConnected && view.root === root && root.isConnected;
    const redraw = () => { if (mounted()) renderDetails(container, { ...context, liveRefresh: false }); };
    const currentUnits = () => weather(context).units?.system === 'imperial' ? 'imperial' : 'metric';
    const canSearch = typeof context.bridge?.searchWeather === 'function'; const canSave = typeof context.bridge?.saveWeather === 'function';
    async function save(location, units = currentUnits()) {
      if (view.saving || !canSave) return;
      view.saving = true; view.error = ''; redraw();
      try {
        const next = await context.bridge.saveWeather({ location, units });
        if (next?.config) context.updateState?.(next);
        else if (typeof context.bridge.getState === 'function') context.updateState?.(await context.bridge.getState());
        view.searchOpen = false; view.results = []; view.searched = false;
        context.toast?.('Weather preferences saved');
      } catch (error) { view.error = safeError(error); }
      finally { view.saving = false; if (container.isConnected && views.get(container) === view && view.root?.isConnected) renderDetails(container, { ...context, liveRefresh: false }); }
    }
    const toolbar = el('div', 'weather-toolbar');
    if (configured) toolbar.append(action(view.searchOpen ? 'Close search' : 'Change city', () => {
      view.searchOpen = !view.searchOpen; view.error = ''; redraw(); container.querySelector('.weather-search-input')?.focus();
    }, 'weather-change-city', view.saving || view.searching || !canSearch));
    else toolbar.append(el('p', 'weather-toolbar-label', 'Weather location'));
    const units = el('div', 'weather-unit-control'); units.setAttribute('aria-label', 'Temperature units');
    for (const [system, label] of [['metric', '°C'], ['imperial', '°F']]) {
      const control = action(label, () => save(weather(context).location || null, system), '', view.saving || view.searching || !canSave);
      control.setAttribute('aria-label', system === 'metric' ? 'Use Celsius' : 'Use Fahrenheit'); control.setAttribute('aria-pressed', String(currentUnits() === system)); units.append(control);
    }
    toolbar.append(units); root.append(toolbar);
    if (view.searchOpen || !configured) {
      const search = el('section', 'weather-search');
      const title = el('h3', '', configured ? 'Find another city' : 'Choose your city'); search.append(title);
      const form = el('form', 'weather-search-form');
      const input = el('input', 'weather-search-input'); input.type = 'search'; input.autocomplete = 'off'; input.maxLength = 100; input.placeholder = 'Search city or town'; input.value = view.query; input.setAttribute('aria-label', 'Search weather city'); input.disabled = !canSearch || view.saving || view.searching;
      input.addEventListener('input', () => { view.query = input.value; });
      const submit = action(view.searching ? 'Searching…' : 'Search', () => {}, '', !canSearch || view.saving || view.searching); submit.type = 'submit'; form.append(input, submit);
      form.addEventListener('submit', async event => {
        event.preventDefault(); if (view.searching || view.saving || !canSearch) return;
        const query = view.query.trim(); if (query.length < 2) { view.error = 'Enter at least two letters to search.'; redraw(); return; }
        view.searching = true; view.error = ''; view.results = []; view.searched = false; const request = ++view.request; redraw();
        try { const results = await context.bridge.searchWeather(query); if (request === view.request) { view.results = Array.isArray(results) ? results.filter(item => item && typeof item.name === 'string').slice(0, 12) : []; view.searched = true; } }
        catch (error) { if (request === view.request) view.error = safeError(error); }
        finally { view.searching = false; if (container.isConnected && views.get(container) === view && view.root?.isConnected) renderDetails(container, { ...context, liveRefresh: false }); }
      });
      search.append(form);
      if (!canSearch || !canSave) search.append(el('p', 'weather-missing', 'Open the desktop app to choose a weather location.'));
      if (view.results.length) {
        const results = el('div', 'weather-search-results'); results.setAttribute('aria-label', 'Matching cities');
        for (const location of view.results) {
          const choose = action('', () => save(location), 'weather-city-result', view.saving || !canSave);
          choose.append(el('strong', '', location.name), el('span', '', [location.region, location.country].filter(Boolean).join(', ')));
          results.append(choose);
        }
        search.append(results);
      } else if (view.searched && !view.searching) search.append(el('p', 'weather-missing', 'No matching cities. Try a nearby town or a different spelling.'));
      root.append(search);
    }
    if (view.error) { const error = el('p', 'weather-error', view.error); error.setAttribute('role', 'alert'); root.append(error); }
    if (!configured) { root.append(el('p', 'weather-unconfigured', 'A forecast will appear after you choose a location.')); addSources(root); return true; }
    const layout = el('div', 'weather-forecast-layout');
    const currentColumn = el('div', 'weather-current-column');
    const forecastColumn = el('div', 'weather-forecast-column');
    layout.append(currentColumn, forecastColumn); root.append(layout);
    const summary = scene(data, 'weather-summary', previousSky);
    const identity = el('div', 'weather-summary-identity'); identity.append(el('h2', '', data.location.name), el('p', '', [data.location.region, data.location.country].filter(Boolean).join(', ')));
    const current = el('div', 'weather-summary-current'); current.append(el('strong', 'weather-summary-temperature', temp(data.current?.temp)));
    const detail = el('div', 'weather-summary-condition'); detail.append(icon(condition(data.current?.conditionCode)[1], data.current?.isDay), el('p', '', data.current ? condition(data.current.conditionCode)[0] : 'Forecast unavailable'), range(data)); current.append(detail); summary.append(identity, current); currentColumn.append(summary);
    const update = el('p', `weather-updated${data.stale ? ' is-stale' : ''}`, updated(data)); currentColumn.append(update);
    if (data.error) { const error = el('p', 'weather-error', `${data.current ? 'Showing the last saved forecast. ' : ''}${safeError(data.error)}`); error.setAttribute('role', 'status'); currentColumn.append(error); }
    const hourly = el('section', 'weather-section weather-hourly-section'); hourly.append(el('h3', 'weather-section-title', 'Hourly forecast'), hourStrip(data, 24, false)); forecastColumn.append(hourly);
    const forecast = el('section', 'weather-section weather-daily-section'); forecast.append(el('h3', 'weather-section-title', '7-day forecast'));
    const days = daily(data); const allTemps = days.flatMap(day => [day.min, day.max]).filter(finite); const minimum = Math.min(...allTemps); const maximum = Math.max(...allTemps); const totalRange = Math.max(1, maximum - minimum);
    if (!days.length) forecast.append(el('p', 'weather-missing', 'Daily forecast unavailable'));
    for (const day of days) {
      const row = el('div', 'weather-day'); const name = day.date === today(data) ? 'Today' : new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${day.date}T12:00:00Z`));
      row.append(el('span', 'weather-day-name', name)); const symbols = el('span', 'weather-day-condition'); const conditionInfo = condition(day.conditionCode); symbols.title = conditionInfo[0]; symbols.append(icon(conditionInfo[1]));
      if (finite(day.precipProbability)) symbols.append(el('small', '', `${Math.round(day.precipProbability)}%`)); row.append(symbols, el('span', 'weather-day-low', temp(day.min)));
      const track = el('span', 'weather-temperature-track'); track.setAttribute('aria-hidden', 'true');
      if (finite(day.min) && finite(day.max) && day.max >= day.min) { const bar = el('i'); bar.style.left = `${Math.max(0, (day.min - minimum) / totalRange * 100)}%`; bar.style.width = `${Math.max(3, (day.max - day.min) / totalRange * 100)}%`; track.append(bar); }
      row.append(track, el('strong', 'weather-day-high', temp(day.max))); row.setAttribute('aria-label', `${name}: ${conditionInfo[0]}, low ${temp(day.min)}, high ${temp(day.max)}${finite(day.precipProbability) ? `, precipitation chance ${Math.round(day.precipProbability)} percent` : ''}`); forecast.append(row);
    }
    const metrics = el('section', 'weather-metrics'); metrics.setAttribute('aria-label', 'Weather details');
    const day = currentDay(data); const unitsData = data.units || {};
    const values = [
      ['Feels like', finite(data.current?.feelsLike) ? temp(data.current.feelsLike) : null],
      ['Humidity', finite(data.current?.humidity) ? `${Math.round(data.current.humidity)}%` : null],
      ['Wind', finite(data.current?.windSpeed) ? `${Math.round(data.current.windSpeed)} ${unitsData.windSpeed || ''}`.trim() : null],
      ['UV today (max)', finite(day?.uvIndex) ? String(Math.round(day.uvIndex * 10) / 10) : null],
      ['Sunrise', day?.sunrise ? time(day.sunrise, data) : null], ['Sunset', day?.sunset ? time(day.sunset, data) : null],
    ];
    for (const [label, value] of values) if (value !== null && value !== '—') { const metric = el('div', 'weather-metric'); metric.append(el('h3', '', label), el('strong', '', value)); metrics.append(metric); }
    forecastColumn.append(forecast); if (metrics.childNodes.length) currentColumn.append(metrics); addSources(root); return true;
  }
  function addSources(root) {
    const sources = el('footer', 'weather-sources');
    for (const [prefix, name, url] of [['Weather by', 'Open-Meteo', 'https://open-meteo.com/'], ['Locations by', 'GeoNames', 'https://www.geonames.org/']]) {
      sources.append(el('span', '', prefix));
      const link = el('a', '', name); link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer'; sources.append(link);
    }
    root.append(sources);
  }
  // ---- Today: time, date and live weather in one card ----------------------
  const todayViews = new WeakMap();
  function forecastSummary(data) {
    const items = hours(data, 13); const current = condition(data.current?.conditionCode);
    if (!data.current || items.length < 3) return '';
    const change = items.slice(1).find(item => condition(item.conditionCode)[1] !== current[1] && condition(item.conditionCode)[1] !== 'unknown');
    if (!change) return `${current[0]} for the next ${items.length - 1} hours.`;
    return `${condition(change.conditionCode)[0]} expected around ${time(change.time, data)}.`;
  }
  function tickToday(root, clock24 = true) {
    const date = root.querySelector('.today-date'), clock = root.querySelector('.today-time');
    if (!date || !clock) return;
    const now = new Date();
    const day = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }).format(now);
    if (date.textContent !== day) date.textContent = day;
    const parts = new Intl.DateTimeFormat('en-GB', { hour: clock24 ? '2-digit' : 'numeric', minute: '2-digit', hour12: !clock24 }).formatToParts(now);
    const key = parts.map(part => part.value).join('');
    if (clock.dataset.key === key) return;
    clock.dataset.key = key;
    clock.replaceChildren(...parts.filter(part => part.type !== 'literal' || part.value.trim()).map(part => part.type === 'dayPeriod' ? el('span', 'today-period', part.value.toUpperCase()) : document.createTextNode(part.value)));
  }
  function renderToday(container, context) {
    const data = weather(context); const configured = Boolean(data.configured && data.location);
    let view = todayViews.get(container);
    if (!view || view.root.parentElement !== container) {
      const root = el('section', 'today-card'); root.setAttribute('aria-label', 'Time and weather');
      const sky = window.EdgeWeatherSky?.create(skyModel(data)) || null;
      const content = el('div', 'today-content');
      const clock = el('div', 'today-clock'); clock.append(el('p', 'today-date'), el('p', 'today-time')); clock.setAttribute('aria-live', 'off');
      const open = el('button', 'today-weather'); open.type = 'button';
      const now = el('div', 'today-now'); const temperature = el('span', 'today-temp'); const meta = el('span', 'today-meta');
      const city = el('span', 'today-city'); const label = el('span', 'today-condition'); const highLow = el('span', 'today-range');
      meta.append(city, label, highLow); now.append(temperature, meta);
      const panel = el('div', 'today-forecast'); const summary = el('p', 'today-summary'); const strip = el('div', 'today-hours'); panel.append(summary, strip);
      open.append(now, panel);
      const footnote = el('p', 'today-footnote');
      content.append(clock, open, footnote);
      if (sky) root.append(sky);
      root.append(content); container.replaceChildren(root);
      view = { root, sky, open, temperature, city, label, highLow, panel, summary, strip, footnote, context };
      open.addEventListener('click', () => view.context.onOpen?.());
      todayViews.set(container, view);
    }
    view.context = context;
    if (view.sky) window.EdgeWeatherSky.update(view.sky, skyModel(data));
    view.root.dataset.condition = condition(data.current?.conditionCode)[1];
    if (!configured) {
      view.temperature.textContent = ''; view.city.textContent = 'Your weather'; view.label.textContent = 'Tap to choose a city'; view.highLow.textContent = '';
      view.panel.hidden = true; view.footnote.textContent = '';
      view.open.setAttribute('aria-label', 'Choose weather city');
    } else {
      const now = data.current ? condition(data.current.conditionCode)[0] : 'Forecast unavailable'; const day = currentDay(data);
      view.temperature.textContent = temp(data.current?.temp); view.city.textContent = data.location.name; view.city.title = data.location.name;
      view.label.textContent = now;
      view.highLow.textContent = [finite(day?.max) ? `H:${temp(day.max)}` : '', finite(day?.min) ? `L:${temp(day.min)}` : ''].filter(Boolean).join('  ');
      view.panel.hidden = false;
      view.summary.textContent = forecastSummary(data); view.summary.hidden = !view.summary.textContent;
      const strip = hourStrip(data, 6, true); strip.classList.add('today-hours'); view.strip.replaceWith(strip); view.strip = strip;
      const week = weekList(data); if (view.week) view.week.replaceWith(week); else view.panel.append(week); view.week = week;
      view.footnote.textContent = data.error ? (data.current ? 'Saved forecast · connection unavailable' : 'Weather unavailable · tap for details') : `${updated(data)} · Open-Meteo`;
      view.footnote.classList.toggle('has-error', Boolean(data.error));
      view.open.setAttribute('aria-label', `${data.location.name}: ${temp(data.current?.temp)}, ${now}. Open forecast`);
    }
    view.open.disabled = typeof context.onOpen !== 'function';
    tickToday(view.root, context.clock24 !== false);
    return true;
  }
  window.EdgeWeatherUI = Object.freeze({ renderWidget, renderDetails, renderToday, tickToday, condition });
})();
