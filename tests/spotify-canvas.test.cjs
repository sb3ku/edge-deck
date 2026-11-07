'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSpotifyCanvas, secretKey, totp, canvasRequest, parseCanvases, safeVideo } = require('../lib/spotify-canvas.cjs');

const TRACK = 'spotify:track:5osCClSjGplWagDsJmyivf';
const VIDEO = 'https://canvaz.scdn.co/upload/artist/6i1GVNJCyyssRwXmnaeEFH/video/ef3bc2ac86ba4a39b2cddff19dca884a.cnvs.mp4';
const COOKIE = 'AQ' + 'x'.repeat(120);
const varint = n => { const out = []; do { let b = n & 127; n >>>= 7; if (n) b |= 128; out.push(b); } while (n); return Buffer.from(out); };
const field = (number, payload) => Buffer.concat([varint((number << 3) | 2), varint(payload.length), payload]);
const canvasReply = (url, track) => field(1, Buffer.concat([field(1, Buffer.from('ef3b')), field(2, Buffer.from(url)), field(5, Buffer.from(track))]));

test('one-time codes follow RFC 6238 (SHA-1, 30 s, 6 digits) and secrets are unmasked as Spotify does', () => {
  const key = Buffer.from('12345678901234567890');
  assert.equal(totp(key, 59000), '287082');
  assert.equal(totp(key, 1111111109000), '081804');
  assert.deepEqual(secretKey([9, 10, 11]), Buffer.from('000'));
});

test('the canvas request and reply use the canvaz-cache protobuf layout', () => {
  assert.deepEqual(canvasRequest(TRACK), field(1, field(1, Buffer.from(TRACK))));
  assert.deepEqual(parseCanvases(canvasReply(VIDEO, TRACK)), [{ url: VIDEO, trackUri: TRACK }]);
  assert.equal(safeVideo(VIDEO), VIDEO);
  assert.equal(safeVideo('https://evil.example/x.mp4'), null);
  assert.equal(safeVideo('http://canvaz.scdn.co/a.mp4'), null);
});

test('a playing song\'s Canvas is fetched with the web player sign-in and cached', async () => {
  const stored = []; const calls = [];
  const fetch = async (url, options = {}) => {
    const href = String(url); calls.push({ href, headers: options.headers || {} });
    const json = value => ({ ok: true, status: 200, json: async () => value, arrayBuffer: async () => Buffer.alloc(0) });
    if (href.includes('secretDict')) return json({ '18': [1, 2, 3], '19': [99, 111, 47, 88] });
    if (href.includes('server-time')) return json({ serverTime: 1700000000 });
    if (href.includes('/api/token')) return json({ accessToken: 'web-token', accessTokenExpirationTimestampMs: Date.now() + 3600000, isAnonymous: false });
    if (href.includes('canvaz-cache')) return { ok: true, status: 200, arrayBuffer: async () => canvasReply(VIDEO, TRACK) };
    throw Error('unexpected ' + href);
  };
  const canvas = createSpotifyCanvas({ storage: { read: () => null, write: value => stored.push(value) }, fetch });
  assert.equal(await canvas.forTrack(TRACK), null, 'nothing without a cookie');
  assert.throws(() => canvas.save('not a cookie'), /sp_dc/);
  canvas.save(`sp_dc=${COOKIE}`); assert.deepEqual(stored, [COOKIE]);
  assert.equal(await canvas.forTrack(TRACK), VIDEO);
  const token = calls.find(call => call.href.includes('/api/token'));
  assert.match(token.href, /totpVer=19/); assert.equal(token.headers.Cookie, `sp_dc=${COOKIE}`);
  assert.equal(calls.find(call => call.href.includes('canvaz-cache')).headers.Authorization, 'Bearer web-token');
  const count = calls.length; assert.equal(await canvas.forTrack(TRACK), VIDEO); assert.equal(calls.length, count, 'cached');
  canvas.remove(); assert.equal(stored.at(-1), null); assert.equal(canvas.state().connected, false);
});

test('a cookie that is not signed in is reported, and the song keeps its cover', async () => {
  const fetch = async url => {
    const href = String(url), json = value => ({ ok: true, status: 200, json: async () => value });
    if (href.includes('secretDict')) return json({ '19': [99, 111] });
    if (href.includes('server-time')) return json({ serverTime: 1 });
    return json({ accessToken: 'anon', isAnonymous: true });
  };
  const canvas = createSpotifyCanvas({ storage: { read: () => COOKIE, write() {} }, fetch });
  assert.equal(await canvas.forTrack(TRACK), null);
  assert.match(canvas.state().error, /not signed in/);
});

test('the web player helper allows only its two read-only routes', async () => {
  const canvas = createSpotifyCanvas({ storage: { read: () => COOKIE, write() {} }, fetch: async () => { throw new Error('no network in this test'); } });
  for (const path of ['/me', '/me/player/play', '/playlists/x/tracks?limit=50', '/me/playlists?limit=50&offset=1;DELETE', 'https://evil.example/']) await assert.rejects(canvas.web(path), /Unsupported/);
  assert.equal(await createSpotifyCanvas({ storage: { read: () => null, write() {} } }).web('/me/playlists?limit=50'), null, 'nothing without a cookie');
});
