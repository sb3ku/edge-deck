'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createWeatherBridge, normalizeForecast } = require('../lib/weather.cjs');
const epoch = Date.UTC(2026, 10, 6, 10);
const location = { id: '760844', name: 'Kraków', country: 'Poland', countryCode: 'PL', region: 'Lesser Poland', latitude: 52.78152, longitude: 20.1177, timezone: 'Europe/Warsaw' };
const config = { location, units: 'metric' };
function forecast(time = epoch) {
  return { timezone: 'Europe/Warsaw', utc_offset_seconds: 3600,
    current: { time: time / 1000, temperature_2m: 6.2, apparent_temperature: 3.8, weather_code: 3, is_day: 1, relative_humidity_2m: 82, wind_speed_10m: 12, wind_direction_10m: 270, precipitation: 0, cloud_cover: 100 },
    hourly: { time: Array.from({ length: 28 }, (_, i) => time / 1000 + i * 3600), temperature_2m: Array(28).fill(7), weather_code: Array(28).fill(3), is_day: Array(28).fill(1), precipitation_probability: Array(28).fill(30) },
    daily: { time: Array.from({ length: 8 }, (_, i) => Date.UTC(2026, 10, 5 + i, 23) / 1000), temperature_2m_min: Array(8).fill(2), temperature_2m_max: Array(8).fill(9), weather_code: Array(8).fill(3), precipitation_probability_max: Array(8).fill(40), sunrise: Array(8).fill(time / 1000), sunset: Array(8).fill(time / 1000 + 8 * 3600) },
  };
}
const response = body => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

test('no configured city makes no network request or invented forecast', async () => {
  const bridge = createWeatherBridge({ getConfig: () => ({ location: null, units: 'metric' }), fetchImpl: () => assert.fail('No implicit location lookup') });
  const state = await bridge.getState(); assert.equal(state.status, 'unconfigured'); assert.equal(state.location, null); assert.equal(state.current, null);
  bridge.close();
});

test('forecast uses fixed HTTPS provider, explicit units and bounded current/hourly/daily data', async () => {
  const requests = [];
  const bridge = createWeatherBridge({ getConfig: () => config, now: () => epoch, fetchImpl: async (url, options) => { requests.push({ url: new URL(url), options }); return response(forecast()); } });
  const state = await bridge.getState();
  assert.equal(requests[0].url.origin, 'https://api.open-meteo.com'); assert.equal(requests[0].options.redirect, 'error');
  assert.equal(requests[0].url.searchParams.get('timeformat'), 'unixtime'); assert.equal(requests[0].url.searchParams.get('forecast_hours'), '24');
  assert.equal(state.hourly.length, 24); assert.equal(state.daily.length, 7); assert.equal(state.current.temp, 6.2);
  assert.equal(state.hourly[0].time, '2026-11-06T10:00:00.000Z'); assert.equal(state.daily[0].date, '2026-11-06');
  assert.equal(state.current.isDay, true); assert.equal(state.units.temperature, '°C'); assert.equal(state.attribution.name, 'Open-Meteo');
  assert.equal(state.daily[0].precipitation, null); bridge.close();
});

test('cache deduplicates concurrent calls and preserves stale data with sanitized failure', async () => {
  let time = epoch, calls = 0, fail = false;
  const bridge = createWeatherBridge({ getConfig: () => config, now: () => time, fetchImpl: async () => { calls++; if (fail) throw Error('secret upstream URL TOKEN'); return response(forecast(time)); } });
  await Promise.all([bridge.getState(), bridge.getState(), bridge.refresh(true)]); assert.equal(calls, 1);
  await bridge.getState(); assert.equal(calls, 1);
  time += 601000; fail = true;
  const stale = await bridge.getState(); assert.equal(stale.status, 'stale'); assert.equal(stale.current.temp, 6.2); assert.equal(stale.updatedAt, new Date(epoch).toISOString());
  assert.doesNotMatch(stale.error, /TOKEN|upstream/);
  await bridge.getState(); assert.equal(calls, 2); bridge.close();
});

test('changing location or units cannot reuse another city forecast', async () => {
  let settings = structuredClone(config), release;
  const seen = [];
  const bridge = createWeatherBridge({ getConfig: () => settings, now: () => epoch, fetchImpl: async url => {
    seen.push(new URL(url)); if (seen.length === 1) await new Promise(resolve => { release = resolve; }); return response(forecast());
  } });
  const old = bridge.getState();
  settings = { location: { ...location, id: '2', name: 'Another city', latitude: 50 }, units: 'imperial' };
  const current = await bridge.getState(); release();
  assert.equal(current.location.name, 'Another city'); assert.equal((await old).location.name, 'Another city');
  assert.equal(current.units.temperature, '°F'); assert.equal(seen[1].searchParams.get('temperature_unit'), 'fahrenheit');
  assert.equal(seen[1].searchParams.get('precipitation_unit'), 'inch'); bridge.close();
});

test('geocoding validates, deduplicates, caches and caps results without changing selected location', async () => {
  let time = epoch, calls = 0;
  const bridge = createWeatherBridge({ getConfig: () => config, now: () => time, fetchImpl: async url => {
    calls++; assert.equal(new URL(url).origin, 'https://geocoding-api.open-meteo.com');
    return response({ results: [{ ...location, country_code: 'PL', admin1: 'Lesser Poland' }, { ...location }, { id: 1, name: 'Invalid', latitude: 999, longitude: 0, timezone: 'UTC' }] });
  } });
  assert.deepEqual(await bridge.searchLocations('R'), []);
  const results = await bridge.searchLocations('Kraków'); assert.equal(results.length, 1); assert.equal(results[0].region, 'Lesser Poland');
  await bridge.searchLocations('kraków'); assert.equal(calls, 1);
  await assert.rejects(bridge.searchLocations('Warsaw'), /Wait a moment/);
  time += 1000; await bridge.searchLocations('Warsaw'); assert.equal(calls, 2);
  await assert.rejects(bridge.searchLocations('a'.repeat(101)), /up to 100/); bridge.close();
});

test('malformed values stay null rather than producing fabricated zeros or weather', () => {
  const payload = forecast(); payload.current.temperature_2m = null; payload.current.weather_code = '3'; payload.current.is_day = true; payload.current.relative_humidity_2m = 900;
  payload.hourly.temperature_2m = [];
  const state = normalizeForecast(payload, config, epoch);
  assert.equal(state.current.temp, null); assert.equal(state.current.conditionCode, null); assert.equal(state.current.isDay, null); assert.equal(state.current.humidity, null); assert.equal(state.hourly[0].temp, null);
  assert.throws(() => normalizeForecast({}, config, epoch), /no forecast/);
});

test('timeouts, provider failures, oversized replies and close are bounded and sanitized', async () => {
  for (const fetchImpl of [async () => new Promise(() => {}), async () => new Response('denied', { status: 429 }), async () => new Response('x'.repeat(524289))]) {
    const bridge = createWeatherBridge({ getConfig: () => config, now: () => epoch, timeoutMs: 15, fetchImpl });
    const state = await bridge.getState(); assert.equal(state.status, 'error'); assert.equal(state.current, null); assert.ok(state.error); bridge.close();
  }
  const bridge = createWeatherBridge({ getConfig: () => config, fetchImpl: async () => new Promise(() => {}) });
  const pending = bridge.getState(); bridge.close();
  assert.match((await pending).error, /closed/);
  await assert.rejects(bridge.searchLocations('Kraków'), /closed/);
});
