'use strict';
// Spotify Canvas: the short looping video some songs show in Spotify's apps.
// Canvas is not part of Spotify's public Web API. It is read the way Spotify's
// web player reads it, with the user's own web-player sign-in (the sp_dc
// cookie they paste in settings):
//   1. open.spotify.com/api/token gives a web-player token. It needs a
//      one-time code from a secret Spotify rotates; current secrets are taken
//      from a community-maintained list (data only, no code is loaded).
//   2. spclient.wg.spotify.com/canvaz-cache/v0/canvases (protobuf) gives the
//      track's Canvas, a public MP4 on canvaz.scdn.co.
// This is unofficial and can stop working whenever Spotify changes it; every
// failure simply means "no Canvas" and the cover art stays.
const crypto = require('node:crypto');

const SECRETS_URL = 'https://raw.githubusercontent.com/xyloflake/spot-secrets-go/refs/heads/main/secrets/secretDict.json';
const BROWSER = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36';
const TRACK = /^spotify:track:[A-Za-z0-9]{22}$/;

// ---- One-time codes ---------------------------------------------------------
function secretKey(values) {
  // Each secret is a list of numbers, unmasked and joined as decimal text.
  return Buffer.from(values.map((value, index) => value ^ ((index % 33) + 9)).join(''), 'utf8');
}
function totp(key, timestampMs) {
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(timestampMs / 1000 / 30)));
  const hmac = crypto.createHmac('sha1', key).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 15;
  return String((hmac.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, '0');
}

// ---- Protobuf (only the few fields used) -------------------------------------
function varint(value) { const bytes = []; do { let byte = value & 127; value >>>= 7; if (value) byte |= 128; bytes.push(byte); } while (value); return Buffer.from(bytes); }
function field(number, payload) { return Buffer.concat([varint((number << 3) | 2), varint(payload.length), payload]); }
function canvasRequest(trackUri) { return field(1, field(1, Buffer.from(trackUri, 'utf8'))); }
function readFields(buffer) {
  const fields = []; let at = 0;
  const readVarint = () => { let result = 0, shift = 0, byte; do { if (at >= buffer.length) throw Error('Truncated'); byte = buffer[at++]; result += (byte & 127) * 2 ** shift; shift += 7; } while (byte & 128); return result; };
  while (at < buffer.length) {
    const key = readVarint(), number = Math.floor(key / 8), type = key & 7;
    if (type === 0) fields.push({ number, value: readVarint() });
    else if (type === 2) { const length = readVarint(); if (at + length > buffer.length) throw Error('Truncated'); fields.push({ number, bytes: buffer.subarray(at, at + length) }); at += length; }
    else if (type === 1) at += 8; else if (type === 5) at += 4; else throw Error('Unsupported field');
  }
  return fields;
}
function parseCanvases(buffer) {
  return readFields(buffer).filter(item => item.number === 1 && item.bytes).map(item => {
    const canvas = {};
    for (const part of readFields(item.bytes)) if (part.bytes) {
      if (part.number === 2) canvas.url = part.bytes.toString('utf8');
      if (part.number === 5) canvas.trackUri = part.bytes.toString('utf8');
    }
    return canvas;
  });
}
function safeVideo(url) {
  try { const parsed = new URL(url); return parsed.protocol === 'https:' && /(^|\.)canvaz\.scdn\.co$/i.test(parsed.hostname) && /\.mp4$/i.test(parsed.pathname) ? parsed.href : null; } catch { return null; }
}

function createSpotifyCanvas({ storage, fetch = globalThis.fetch, now = Date.now } = {}) {
  let cookie = null, token = null, secrets = null, lastError = null;
  try { cookie = storage?.read() || null; } catch { cookie = null; }
  const cache = new Map();

  async function currentSecret() {
    if (secrets && now() - secrets.at < 3600000) return secrets;
    const response = await fetch(SECRETS_URL, { headers: { 'User-Agent': BROWSER }, signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw Error('Canvas codes are unavailable.');
    const list = await response.json();
    const version = Object.keys(list || {}).filter(key => /^\d+$/.test(key) && Array.isArray(list[key])).sort((a, b) => Number(b) - Number(a))[0];
    if (!version || !list[version].every(Number.isInteger)) throw Error('Canvas codes are unavailable.');
    secrets = { at: now(), version, key: secretKey(list[version]) };
    return secrets;
  }
  async function accessToken() {
    if (token && now() < token.expiresAt - 60000) return token.value;
    const { version, key } = await currentSecret();
    const headers = { 'User-Agent': BROWSER, Origin: 'https://open.spotify.com/', Referer: 'https://open.spotify.com/', Cookie: `sp_dc=${cookie}` };
    let serverTime = now();
    try { const time = await (await fetch('https://open.spotify.com/api/server-time', { headers, signal: AbortSignal.timeout(8000) })).json(); if (Number.isFinite(Number(time?.serverTime))) serverTime = Number(time.serverTime) * 1000; } catch {}
    const url = new URL('https://open.spotify.com/api/token');
    // totpServer mirrors the web player's own request.
    for (const [name, value] of Object.entries({ reason: 'init', productType: 'mobile-web-player', totp: totp(key, now()), totpVer: version, totpServer: totp(key, Math.floor(serverTime / 30)) })) url.searchParams.set(name, value);
    const response = await fetch(url, { headers, redirect: 'error', signal: AbortSignal.timeout(10000) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || typeof data.accessToken !== 'string') throw Error('Spotify did not accept the web player sign-in.');
    if (data.isAnonymous) throw Error('The pasted cookie is not signed in. Copy sp_dc again while signed in to open.spotify.com.');
    token = { value: data.accessToken, expiresAt: Number(data.accessTokenExpirationTimestampMs) || now() + 1800000 };
    return token.value;
  }

  return {
    state() { return { connected: Boolean(cookie), error: lastError }; },
    save(value) {
      value = String(value || '').trim().replace(/^sp_dc=/i, '');
      if (!/^[A-Za-z0-9_-]{40,600}$/.test(value)) throw Error('Paste the value of the sp_dc cookie (a long string of letters and numbers).');
      cookie = value; token = null; lastError = null; cache.clear(); storage?.write(value);
    },
    remove() { cookie = null; token = null; lastError = null; cache.clear(); storage?.write(null); },
    // Read-only Web API calls as the web player, for what Spotify withholds
    // from developer apps: the playlists you follow that Spotify makes
    // (Discover Weekly, Release Radar, Daily Mixes) and their songs. Only these
    // routes are allowed: your playlists, a playlist's songs, and the search
    // that finds your personal Discover Weekly and Release Radar.
    async web(pathname) {
      if (!cookie) return null;
      if (typeof pathname !== 'string' || !/^\/(?:me\/playlists\?limit=50(?:&offset=\d{1,4})?|playlists\/[A-Za-z0-9]{22}\/(?:tracks|items)\?limit=50|search\?q=(?:Discover%20Weekly|Release%20Radar)&type=playlist&limit=10)$/.test(pathname)) throw Error('Unsupported Spotify request.');
      for (let attempt = 0; attempt < 2; attempt++) {
        const access = await accessToken();
        const response = await fetch(`https://api.spotify.com/v1${pathname}`, { headers: { Authorization: `Bearer ${access}`, Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(12000) });
        if (response.status === 401 && attempt === 0) { token = null; continue; }
        if (!response.ok) throw Object.assign(Error(`Spotify answered ${response.status}.`), { status: response.status });
        return response.json();
      }
      return null;
    },
    // The Canvas video for a track, or null. Answers are kept for six hours.
    async forTrack(trackUri) {
      if (!cookie || !TRACK.test(String(trackUri || ''))) return null;
      const saved = cache.get(trackUri);
      if (saved && now() - saved.at < (saved.url ? 21600000 : 3600000)) return saved.url;
      try {
        const access = await accessToken();
        const response = await fetch('https://spclient.wg.spotify.com/canvaz-cache/v0/canvases', {
          method: 'POST', body: canvasRequest(trackUri), redirect: 'error', signal: AbortSignal.timeout(10000),
          headers: { Accept: 'application/protobuf', 'Content-Type': 'application/x-www-form-urlencoded', 'Accept-Language': 'en', 'User-Agent': 'Spotify/9.0.34.593 iOS/18.4 (iPhone15,3)', Authorization: `Bearer ${access}` },
        });
        if (response.status === 401) { token = null; throw Error('Spotify sign-in for Canvas expired.'); }
        if (!response.ok) throw Error(`Spotify Canvas answered ${response.status}.`);
        const canvas = parseCanvases(Buffer.from(await response.arrayBuffer())).find(item => item.trackUri === trackUri || !item.trackUri);
        const url = canvas ? safeVideo(canvas.url) : null;
        cache.set(trackUri, { at: now(), url }); lastError = null;
        if (cache.size > 300) cache.delete(cache.keys().next().value);
        return url;
      } catch (error) {
        lastError = typeof error?.message === 'string' && error.message.length < 200 ? error.message : 'Spotify Canvas is unavailable.';
        cache.set(trackUri, { at: now() - 3000000, url: null });
        return null;
      }
    },
  };
}

module.exports = { createSpotifyCanvas, secretKey, totp, canvasRequest, parseCanvases, safeVideo };
