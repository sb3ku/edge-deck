'use strict';

// Official provider interfaces: https://open-meteo.com/en/docs and
// https://open-meteo.com/en/docs/geocoding-api . Personal, non-commercial API.
const ATTRIBUTION = Object.freeze({ name: 'Open-Meteo', url: 'https://open-meteo.com/', locationName: 'GeoNames', locationUrl: 'https://www.geonames.org/' });
const CACHE_MS = 10 * 60 * 1000;
const plain = value => value && typeof value === 'object' && !Array.isArray(value);
const number = (value, min, max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : null;
const text = (value, max = 100) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max) : '';
function timezone(value) { try { return typeof value === 'string' && value.length <= 80 ? new Intl.DateTimeFormat('en', { timeZone: value }).resolvedOptions().timeZone : null; } catch { return null; } }
function normalizeWeatherLocation(value) {
  if (!plain(value) || number(value.latitude, -90, 90) === null || number(value.longitude, -180, 180) === null || !text(value.name) || !timezone(value.timezone)) throw Error('Choose a city from the location search.');
  const id = String(value.id ?? '');
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) throw Error('Choose a city from the location search.');
  return { id, name: text(value.name), country: text(value.country), countryCode: /^[A-Z]{2}$/.test(value.countryCode || '') ? value.countryCode : '', region: text(value.region), latitude: value.latitude, longitude: value.longitude, timezone: timezone(value.timezone) };
}
function normalizeWeatherConfig(input, previous = { location: null, units: 'metric' }) {
  if (!plain(input) || Object.keys(input).some(key => !['location', 'units'].includes(key))) throw Error('Invalid weather settings.');
  const units = input.units === undefined ? previous.units : input.units;
  if (!['metric', 'imperial'].includes(units)) throw Error('Choose Celsius or Fahrenheit weather units.');
  const location = input.location === undefined ? previous.location : input.location;
  return { location: location === null ? null : normalizeWeatherLocation(location), units };
}
function units(system) { return { system, temperature: system === 'imperial' ? '°F' : '°C', windSpeed: system === 'imperial' ? 'mph' : 'km/h', precipitation: system === 'imperial' ? 'in' : 'mm' }; }
function iso(seconds) { return number(seconds, 0, 4102444800) === null ? null : new Date(seconds * 1000).toISOString(); }
function code(value) { return Number.isInteger(value) ? number(value, 0, 99) : null; }
function day(value) { return value === 1 ? true : value === 0 ? false : null; }
function empty(config, error = null) { return { configured: Boolean(config.location), location: config.location, status: config.location ? 'error' : 'unconfigured', current: null, hourly: [], daily: [], units: units(config.units), updatedAt: null, stale: false, error, attribution: { ...ATTRIBUTION } }; }

function normalizeForecast(payload, config, timestamp) {
  if (!plain(payload) || payload.error) throw Error('Weather response was unavailable.');
  const state = empty(config);
  const zone = timezone(payload.timezone) || config.location.timezone;
  state.location = { ...config.location, timezone: zone };
  const current = payload.current;
  if (plain(current) && iso(current.time)) state.current = {
    time: iso(current.time), temp: number(current.temperature_2m, -150, 160), feelsLike: number(current.apparent_temperature, -180, 180),
    conditionCode: code(current.weather_code), isDay: day(current.is_day), humidity: number(current.relative_humidity_2m, 0, 100),
    windSpeed: number(current.wind_speed_10m, 0, 500), windDirection: number(current.wind_direction_10m, 0, 360),
    precipitation: number(current.precipitation, 0, 2000), cloudCover: number(current.cloud_cover, 0, 100),
  };
  const hourly = payload.hourly || {};
  for (const [index, time] of (Array.isArray(hourly.time) ? hourly.time.slice(0, 400) : []).entries()) {
    if (!iso(time) || time * 1000 < Math.floor(timestamp / 3600000) * 3600000) continue;
    state.hourly.push({ time: iso(time), temp: number(hourly.temperature_2m?.[index], -150, 160), conditionCode: code(hourly.weather_code?.[index]), isDay: day(hourly.is_day?.[index]), precipProbability: number(hourly.precipitation_probability?.[index], 0, 100) });
    if (state.hourly.length === 24) break;
  }
  const daily = payload.daily || {};
  const offset = number(payload.utc_offset_seconds, -50400, 50400);
  for (const [index, time] of (Array.isArray(daily.time) ? daily.time.slice(0, 7) : []).entries()) {
    if (!iso(time) || offset === null) continue;
    state.daily.push({
      // Daily boundaries use the API's fixed request-time offset. Hourly times
      // remain UTC instants so the UI can apply DST-aware IANA formatting.
      date: new Date((time + offset) * 1000).toISOString().slice(0, 10),
      min: number(daily.temperature_2m_min?.[index], -150, 160), max: number(daily.temperature_2m_max?.[index], -150, 160),
      conditionCode: code(daily.weather_code?.[index]), precipProbability: number(daily.precipitation_probability_max?.[index], 0, 100),
      precipitation: number(daily.precipitation_sum?.[index], 0, 5000), sunrise: iso(daily.sunrise?.[index]), sunset: iso(daily.sunset?.[index]),
      windSpeed: number(daily.wind_speed_10m_max?.[index], 0, 500), uvIndex: number(daily.uv_index_max?.[index], 0, 50),
    });
  }
  if (!state.current && !state.hourly.length && !state.daily.length) throw Error('Weather response contained no forecast.');
  state.status = 'ready'; state.updatedAt = new Date(timestamp).toISOString();
  return state;
}

function createWeatherBridge({ getConfig, fetchImpl = globalThis.fetch, now = Date.now, timeoutMs = 8000 } = {}) {
  if (typeof getConfig !== 'function' || typeof fetchImpl !== 'function') throw new TypeError('Weather requires settings and a fetch implementation.');
  let closed = false, activeKey = '', cached = null, flight = null, lastAttempt = -Infinity;
  let forecastController = null;
  const controllers = new Set();
  const searchCache = new Map();
  let searchFlight = null, lastSearch = -Infinity;
  const readConfig = () => { const value = getConfig() || {}; return normalizeWeatherConfig(value.weather || value); };
  const keyFor = value => JSON.stringify(value);
  const snapshot = value => structuredClone(value);
  async function requestJSON(url, kind = 'forecast') {
    if (closed) throw Error('Weather is closed.');
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || !['api.open-meteo.com/v1/forecast', 'geocoding-api.open-meteo.com/v1/search'].includes(parsed.host + parsed.pathname)) throw Error('Unsupported weather address.');
    const controller = new AbortController(); controllers.add(controller);
    if (kind === 'forecast') forecastController = controller;
    let timer;
    const expired = new Promise((_, reject) => {
      controller.signal.addEventListener('abort', () => reject(Error('Weather request stopped.')), { once: true });
      timer = setTimeout(() => controller.abort(), Math.max(10, Math.min(timeoutMs, 15000)));
    });
    const request = (async () => {
      const response = await fetchImpl(parsed.href, { signal: controller.signal, redirect: 'error', headers: { Accept: 'application/json' } });
      if (!response.ok) throw Error(response.status === 429 ? 'Weather service is busy. Try again shortly.' : 'Weather is unavailable. Check your connection and try again.');
      const declared = Number(response.headers?.get?.('content-length'));
      if (declared > 512 * 1024) throw Error('Weather response was too large.');
      let body;
      if (response.body?.getReader) {
        const reader = response.body.getReader(); const chunks = []; let bytes = 0;
        try { while (true) { const { done, value } = await reader.read(); if (done) break; bytes += value.length; if (bytes > 512 * 1024) throw Error('Weather response was too large.'); chunks.push(Buffer.from(value)); } }
        finally { await reader.cancel().catch(() => {}); }
        body = Buffer.concat(chunks).toString('utf8');
      } else body = await response.text();
      if (Buffer.byteLength(body) > 512 * 1024) throw Error('Weather response was too large.');
      return JSON.parse(body);
    })();
    try { return await Promise.race([request, expired]); }
    finally { clearTimeout(timer); controllers.delete(controller); if (forecastController === controller) forecastController = null; }
  }

  async function refresh(force = true) {
    let config;
    try { config = readConfig(); } catch { return empty({ location: null, units: 'metric' }, 'Choose a valid city in Weather settings.'); }
    const key = keyFor(config);
    if (key !== activeKey) { forecastController?.abort(); activeKey = key; cached = null; flight = null; lastAttempt = -Infinity; }
    if (!config.location || closed) return empty(config, closed ? 'Weather is closed.' : null);
    if (flight?.key === key) return flight.promise.then(snapshot);
    const age = cached?.updatedAt ? now() - Date.parse(cached.updatedAt) : Infinity;
    if (cached && ((!force && age < CACHE_MS) || now() - lastAttempt < (force ? 30000 : 60000))) return snapshot({ ...cached, stale: Boolean(cached.updatedAt) && (cached.stale || age >= CACHE_MS), status: cached.updatedAt ? (cached.stale || age >= CACHE_MS ? 'stale' : 'ready') : 'error' });
    lastAttempt = now();
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    Object.entries({ latitude: config.location.latitude, longitude: config.location.longitude, timezone: 'auto', timeformat: 'unixtime', forecast_days: 7, forecast_hours: 24,
      temperature_unit: config.units === 'imperial' ? 'fahrenheit' : 'celsius', wind_speed_unit: config.units === 'imperial' ? 'mph' : 'kmh', precipitation_unit: config.units === 'imperial' ? 'inch' : 'mm',
      current: 'temperature_2m,apparent_temperature,weather_code,is_day,relative_humidity_2m,wind_speed_10m,wind_direction_10m,precipitation,cloud_cover',
      hourly: 'temperature_2m,weather_code,is_day,precipitation_probability',
      daily: 'temperature_2m_min,temperature_2m_max,weather_code,precipitation_probability_max,precipitation_sum,sunrise,sunset,wind_speed_10m_max,uv_index_max',
    }).forEach(([name, value]) => url.searchParams.set(name, value));
    const pending = { key, promise: null };
    pending.promise = (async () => {
      let result;
      try { result = normalizeForecast(await requestJSON(url.href), config, now()); }
      catch { result = { ...(cached || empty(config)), status: cached?.updatedAt ? 'stale' : 'error', stale: Boolean(cached?.updatedAt), error: 'Weather is unavailable. Check your connection or try again shortly.' }; }
      let currentKey; try { currentKey = keyFor(readConfig()); } catch { currentKey = ''; }
      if (closed) return empty(config, 'Weather is closed.');
      if (currentKey !== key || activeKey !== key) return refresh(false);
      cached = result;
      return snapshot(result);
    })().finally(() => { if (flight === pending) flight = null; });
    flight = pending;
    return pending.promise;
  }

  async function searchLocations(query) {
    if (closed) throw Error('Weather is closed.');
    if (typeof query !== 'string' || query.length > 100 || /[\u0000-\u001f\u007f]/.test(query)) throw Error('Enter a city name of up to 100 characters.');
    query = query.trim(); if (query.length < 2) return [];
    const key = query.toLocaleLowerCase('en'); const saved = searchCache.get(key);
    if (saved && now() - saved.at < CACHE_MS) return snapshot(saved.locations);
    if (searchFlight) {
      if (searchFlight.key === key) return searchFlight.promise.then(snapshot);
      throw Error('Wait for the current location search to finish.');
    }
    if (now() - lastSearch < 750) throw Error('Wait a moment before searching again.');
    lastSearch = now();
    const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
    Object.entries({ name: query, count: 8, language: 'en', format: 'json' }).forEach(([name, value]) => url.searchParams.set(name, value));
    const pending = { key, promise: null };
    pending.promise = (async () => {
      try {
        const payload = await requestJSON(url.href, 'search');
        if (!plain(payload) || payload.error) throw Error('Location search failed.');
        const locations = [];
        for (const item of (Array.isArray(payload.results) ? payload.results.slice(0, 8) : [])) {
          try { const value = normalizeWeatherLocation({ ...item, countryCode: item.country_code, region: item.admin1 }); if (!locations.some(existing => existing.id === value.id)) locations.push(value); } catch { /* Unsupported provider item. */ }
        }
        if (closed) throw Error('Weather is closed.');
        searchCache.set(key, { at: now(), locations });
        if (searchCache.size > 30) searchCache.delete(searchCache.keys().next().value);
        return snapshot(locations);
      } catch { throw Error('Location search is unavailable. Try again shortly.'); }
    })().finally(() => { if (searchFlight === pending) searchFlight = null; });
    searchFlight = pending;
    return pending.promise;
  }
  return { getState: () => refresh(false), refresh, searchLocations, close() { closed = true; controllers.forEach(controller => controller.abort()); searchCache.clear(); } };
}

module.exports = { createWeatherBridge, normalizeWeatherConfig, normalizeWeatherLocation, normalizeForecast };
