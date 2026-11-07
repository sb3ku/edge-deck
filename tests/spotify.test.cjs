'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { createSpotifyBridge, REDIRECT_URI, SCOPES, OPTIONAL_SCOPES } = require('../lib/spotify.cjs');

const CLIENT = '0123456789abcdef0123456789abcdef';
const PLAYLIST = 'spotify:playlist:1234567890123456789012';
const response = (body, status = 200, headers = {}) => new Response(status === 204 ? null : JSON.stringify(body), { status, headers });
function harness(t, fetchImpl, { configured = true, connected = true, expired = false } = {}) {
  let clock = 100000;
  const config = { clientId: configured ? CLIENT : '', tokens: connected ? {
    clientId: CLIENT, accessToken: 'access-secret', refreshToken: 'refresh-secret',
    expiresAt: expired ? clock - 1 : clock + 3600000, scope: SCOPES.join(' '),
  } : null };
  const opened = [];
  const saved = [];
  const bridge = createSpotifyBridge({ getConfig: () => config,
    saveTokens: tokens => { saved.push(tokens); config.tokens = tokens; },
    openExternal: url => { opened.push(url); }, fetchImpl, now: () => clock });
  t.after(() => bridge.close());
  return { bridge, config, opened, saved, advance: ms => { clock += ms; } };
}

test('Spotify stays disconnected without configuration and makes no network request', async t => {
  const { bridge } = harness(t, () => { throw new Error('Must not call network'); }, { configured: false, connected: false });
  const state = await bridge.getState();
  assert.equal(state.connected, false);
  assert.equal(state.clientIdConfigured, false);
  assert.equal(state.redirectUri, REDIRECT_URI);
  await assert.rejects(bridge.authenticate(), /Client ID/);
});

test('Spotify library is capped at 500 and cached; server next URLs are never followed', async t => {
  const calls = [];
  const { bridge } = harness(t, async (url, options) => {
    calls.push(url);
    assert.equal(options.headers.Authorization, 'Bearer access-secret');
    const offset = Number(new URL(url).searchParams.get('offset'));
    return response({ items: Array.from({ length: 50 }, (_, index) => ({
      uri: `spotify:playlist:${String(offset + index).padStart(22, '0')}`,
      name: `Playlist ${offset + index}`, items: { total: index },
    })), next: 'https://untrusted.example/steal-token' });
  });
  const first = await bridge.getState();
  const second = await bridge.getState();
  assert.equal(first.playlists.length, 500);
  assert.equal(first.hasMore, true);
  assert.deepEqual(first.playlists, second.playlists);
  assert.equal(calls.length, 10);
  assert.ok(calls.every(url => url.startsWith('https://api.spotify.com/v1/me/playlists?')));
  assert.doesNotMatch(JSON.stringify(first), /access-secret|refresh-secret/);
});

test('Spotify refreshes expired tokens once and preserves a non-rotated refresh token', async t => {
  let tokenRequests = 0;
  const { bridge, saved } = harness(t, async (url, options) => {
    if (url.endsWith('/api/token')) {
      tokenRequests++;
      const form = new URLSearchParams(options.body);
      assert.equal(form.get('grant_type'), 'refresh_token');
      assert.equal(form.get('client_id'), CLIENT);
      return response({ access_token: 'new-access-secret', expires_in: 3600, token_type: 'Bearer' });
    }
    assert.equal(options.headers.Authorization, 'Bearer new-access-secret');
    return response({ items: [], next: null });
  }, { expired: true });
  await Promise.all([bridge.getState(), bridge.getState(), bridge.getState()]);
  assert.equal(tokenRequests, 1);
  assert.equal(saved[0].refreshToken, 'refresh-secret');
  assert.equal(saved[0].clientId, CLIENT);
});

test('Spotify clears rejected refresh credentials and asks for reconnection', async t => {
  const { bridge, config } = harness(t, async () => response({ error: 'invalid_grant' }, 400), { expired: true });
  const state = await bridge.getState();
  assert.equal(config.tokens, null);
  assert.equal(state.connected, false);
  assert.match(state.error, /Connect again/);
});

test('Spotify retries one 401 with refreshed credentials', async t => {
  let apiCalls = 0;
  const { bridge } = harness(t, async url => {
    if (url.endsWith('/api/token')) return response({ access_token: 'new-token', expires_in: 3600 });
    apiCalls++;
    return apiCalls === 1 ? response({}, 401) : response({ items: [], next: null });
  });
  const state = await bridge.getState();
  assert.equal(apiCalls, 2);
  assert.equal(state.error, null);
});

test('Spotify honors Retry-After instead of polling a limited API', async t => {
  let calls = 0;
  const { bridge, advance } = harness(t, async () => {
    calls++;
    return calls === 1 ? response({}, 429, { 'Retry-After': '120' }) : response({ items: [], next: null });
  });
  const limited = await bridge.getState();
  assert.match(limited.error, /limiting requests/);
  await bridge.getState({ refresh: true });
  advance(60000);
  await bridge.getState({ refresh: true });
  assert.equal(calls, 1);
  advance(61000);
  const recovered = await bridge.getState({ refresh: true });
  assert.equal(calls, 2);
  assert.equal(recovered.error, null);
});

test('a very long Retry-After is capped at ten minutes, since Spotify lifts limits sooner', async t => {
  let calls = 0;
  const { bridge, advance } = harness(t, async () => { calls++; return calls === 1 ? response({}, 429, { 'Retry-After': '86400' }) : response({ items: [], next: null }); });
  await bridge.getState();
  advance(590000); await bridge.getState({ refresh: true }); assert.equal(calls, 1);
  advance(11000); const state = await bridge.getState({ refresh: true }); assert.equal(calls, 2); assert.equal(state.error, null);
});

test('Playlist playback targets the current active device and sends only the context URI', async t => {
  const calls = [];
  const { bridge } = harness(t, async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/me/player')) return response({ device: { id: 'device-id', name: 'Desk speaker', is_active: true, is_restricted: false } });
    return response(null, 204);
  });
  const result = await bridge.playPlaylist(PLAYLIST);
  assert.equal(result.requested, true);
  assert.equal(result.deviceName, 'Desk speaker');
  assert.equal(calls.length, 2);
  assert.equal(calls[1].url, 'https://api.spotify.com/v1/me/player/play?device_id=device-id');
  assert.equal(calls[1].options.method, 'PUT');
  assert.deepEqual(JSON.parse(calls[1].options.body), { context_uri: PLAYLIST });
});

test('Missing or restricted playback devices never trigger playback requests', async t => {
  for (const device of [null, { id: 'd', is_active: false }, { id: 'd', is_active: true, is_restricted: true }]) {
    let calls = 0;
    const { bridge } = harness(t, async () => { calls++; return response(device ? { device } : null, device ? 200 : 204); });
    await assert.rejects(bridge.playPlaylist(PLAYLIST), /Open Spotify|does not allow/);
    assert.equal(calls, 1);
  }
});

test('OAuth uses PKCE, verifies state, and persists credentials only through its callback', async t => {
  let authorizationURL;
  let tokenCalls = 0;
  const { bridge, opened, config, saved } = harness(t, async (url, options) => {
    if (url.endsWith('/api/token')) {
      tokenCalls++;
      const form = new URLSearchParams(options.body);
      assert.equal(form.get('grant_type'), 'authorization_code');
      assert.equal(form.get('client_id'), CLIENT);
      assert.equal(form.get('redirect_uri'), authorizationURL.searchParams.get('redirect_uri'));
      assert.equal(createHash('sha256').update(form.get('code_verifier')).digest('base64url'), authorizationURL.searchParams.get('code_challenge'));
      return response({ access_token: 'oauth-access-secret', refresh_token: 'oauth-refresh-secret',
        expires_in: 3600, token_type: 'Bearer', scope: SCOPES.join(' ') });
    }
    return response({ items: [], next: null });
  }, { connected: false });
  const pending = await bridge.authenticate();
  assert.equal(pending.connecting, true);
  authorizationURL = new URL(opened[0]);
  assert.equal(authorizationURL.searchParams.get('redirect_uri'), REDIRECT_URI, 'Sign-in uses the exact redirect address shown in Music settings');
  assert.equal(authorizationURL.origin, 'https://accounts.spotify.com');
  assert.equal(authorizationURL.searchParams.get('code_challenge_method'), 'S256');
  const callback = new URL(authorizationURL.searchParams.get('redirect_uri'));
  assert.equal(callback.hostname, '127.0.0.1');
  assert.notEqual(callback.port, '');
  callback.search = new URLSearchParams({ code: 'test-code', state: 'wrong-state' }).toString();
  assert.equal((await fetch(callback)).status, 403);
  assert.equal(tokenCalls, 0);
  callback.search = new URLSearchParams({ code: 'test-code', state: authorizationURL.searchParams.get('state') }).toString();
  const accepted = await fetch(callback);
  assert.equal(accepted.status, 200);
  assert.doesNotMatch(await accepted.text(), /oauth-access-secret|oauth-refresh-secret|test-code/);
  assert.equal(saved.length, 1);
  assert.equal(config.tokens.accessToken, 'oauth-access-secret');
  const state = await bridge.getState();
  assert.equal(state.connected, true);
  assert.equal(state.connecting, false);
  assert.doesNotMatch(JSON.stringify(state), /oauth-access-secret|oauth-refresh-secret/);
});

test('Changing the Client ID cannot reuse credentials from a different app', async t => {
  let calls = 0;
  const { bridge, config } = harness(t, async () => { calls++; return response({ items: [], next: null }); });
  config.clientId = 'abcdef0123456789abcdef0123456789';
  const state = await bridge.getState();
  assert.equal(state.connected, false);
  assert.equal(calls, 0);
});

test('Concurrent sign-in requests share one listener and retain a valid callback', async t => {
  let tokenCalls = 0;
  const { bridge, opened, saved } = harness(t, async url => {
    if (url.endsWith('/api/token')) {
      tokenCalls++;
      return response({ access_token: 'concurrent-access', refresh_token: 'concurrent-refresh',
        expires_in: 3600, token_type: 'Bearer', scope: SCOPES.join(' ') });
    }
    return response({ items: [], next: null });
  }, { connected: false });
  const states = await Promise.all([bridge.authenticate(), bridge.authenticate(), bridge.authenticate()]);
  assert.equal(opened.length, 1);
  assert.ok(states.every(state => state.connecting));
  assert.equal((await bridge.authenticate()).connecting, true, 'An active sign-in is reused');
  assert.equal(opened.length, 1);
  const authorization = new URL(opened[0]);
  const callback = new URL(authorization.searchParams.get('redirect_uri'));
  assert.equal(callback.href, REDIRECT_URI);
  callback.search = new URLSearchParams({ code: 'test-code', state: authorization.searchParams.get('state') });
  assert.equal((await fetch(callback)).status, 200);
  assert.equal(tokenCalls, 1);
  assert.equal(saved.length, 1);
  assert.equal((await bridge.getState()).connected, true);
});

test('Closing or changing settings while the callback listener starts cannot open sign-in', async () => {
  for (const action of ['close', 'change-client', 'disconnect']) {
    let reads = 0;
    let config = { clientId: CLIENT, tokens: null };
    let releaseConfiguration;
    let listenerReady;
    const reachedListener = new Promise(resolve => { listenerReady = resolve; });
    const heldConfiguration = new Promise(resolve => { releaseConfiguration = resolve; });
    const opened = [];
    const bridge = createSpotifyBridge({
      getConfig: () => {
        if (++reads === 3) { listenerReady(); return heldConfiguration; }
        return config;
      },
      saveTokens: tokens => { config.tokens = tokens; },
      openExternal: url => { opened.push(url); },
      fetchImpl: () => { throw new Error('No Spotify network request expected'); },
    });
    try {
      const starting = bridge.authenticate();
      const rejected = assert.rejects(starting, /could not open/);
      await reachedListener;
      if (action === 'close') bridge.close();
      else if (action === 'disconnect') await bridge.disconnect();
      else config = { clientId: 'a'.repeat(32), tokens: null };
      releaseConfiguration(config);
      await rejected;
      assert.equal(opened.length, 0, action);
      assert.equal((await bridge.getState()).connecting, false, action);
    } finally { bridge.close(); }
  }
});

test('A new sign-in, possibly as another account, drops the cached home feed and Liked Songs state', async t => {
  const ALL = [...SCOPES, ...OPTIONAL_SCOPES].join(' ');
  const TRACK_ID = '3'.repeat(22);
  const { bridge, opened, config } = harness(t, async (url, options = {}) => {
    if (url.endsWith('/api/token')) return response({ access_token: 'access-b', refresh_token: 'refresh-b', expires_in: 3600, token_type: 'Bearer', scope: ALL });
    const who = String(options.headers?.Authorization || '').includes('access-b') ? 'B' : 'A';
    if (url.includes('/me/player/recently-played')) return response({ items: [{ context: { uri: `spotify:album:${(who === 'A' ? '1' : '2').repeat(22)}` },
      track: { uri: `spotify:track:${TRACK_ID}`, name: 'Song', artists: [{ name: who }], album: { name: `${who} album`, artists: [{ name: who }], images: [] } } }] });
    if (url.includes('/me/top/artists') || url.includes('/me/albums')) return response({ items: [] });
    if (url.includes('/me/library/contains')) return response([who === 'A']);
    if (url.includes('/me/player')) return response({ is_playing: true, progress_ms: 0, device: { id: 'pc', name: 'PC', type: 'Computer', is_active: true, volume_percent: 50 },
      item: { uri: `spotify:track:${TRACK_ID}`, type: 'track', name: 'Song', duration_ms: 1000, artists: [], album: { images: [] } } });
    return response({ items: [], next: null });
  });
  config.tokens.scope = ALL;
  assert.equal((await bridge.home()).recent[0].name, 'A album');
  assert.equal((await bridge.getPlayer()).liked, true);
  const session = (await bridge.getState()).session;
  await bridge.authenticate();
  const authorization = new URL(opened.at(-1));
  const callback = new URL(authorization.searchParams.get('redirect_uri'));
  callback.search = new URLSearchParams({ code: 'code-b', state: authorization.searchParams.get('state') }).toString();
  assert.equal((await fetch(callback)).status, 200);
  assert.equal(config.tokens.accessToken, 'access-b');
  assert.notEqual((await bridge.getState()).session, session, 'The page learns that the session changed');
  assert.equal((await bridge.home()).recent[0].name, 'B album', 'The feed is read again for the new sign-in');
  assert.equal((await bridge.getPlayer()).liked, false, 'Liked Songs state is read again');
});

// Account A's feed load held at a request that bypasses the API layer (the
// public embed lookup or a cover), while the account session changes.
const RACE_ALL = [...SCOPES, ...OPTIONAL_SCOPES].join(' ');
const raceId = n => String(n).padStart(22, '0');
const raceJson = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const raceTokens = who => ({ clientId: CLIENT, accessToken: `access-${who}`, refreshToken: `refresh-${who}`, expiresAt: Date.now() + 3600000, scope: RACE_ALL });
const within = (promise, ms, why) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(why)), ms))]);
const feedNames = feed => (feed?.recent || []).map(item => item.name);
function raceSetup(t, holdOn) {
  let release; const held = new Promise(resolve => { release = resolve; });
  let reached; const atHold = new Promise(resolve => { reached = resolve; });
  const config = { clientId: CLIENT, tokens: raceTokens('a') }, opened = [];
  let requests = 0;
  const fetchImpl = async (url, options = {}) => {
    requests++;
    if (url.endsWith('/api/token')) return raceJson({ access_token: 'access-b', refresh_token: 'refresh-b', expires_in: 3600, token_type: 'Bearer', scope: RACE_ALL });
    const who = String(options.headers?.Authorization || '').includes('access-b') ? 'B' : 'A';
    if (url.startsWith('https://open.spotify.com/oembed')) { if (holdOn === 'oembed') { reached(); await held; } return raceJson({ title: 'A Daily Mix' }); }
    if (url.startsWith('https://i.scdn.co/image/A') && holdOn === 'cover') { reached(); await held; }
    if (url.startsWith('https://i.scdn.co/')) return new Response(new Uint8Array([255, 216, 255, 0]), { headers: { 'content-type': 'image/jpeg' } });
    if (url.includes('/recently-played')) return raceJson({ items: [{ context: { uri: `spotify:playlist:${raceId(who === 'A' ? 81 : 82)}` },
      track: { uri: `spotify:track:${raceId(1)}`, type: 'track', name: 'Song', artists: [{ name: who }], album: { name: `${who} album`, images: [{ url: `https://i.scdn.co/image/${who}`, width: 300 }] } } }] });
    // A's playlist is hidden from the API (no error recorded), so its name comes from the embed lookup.
    if (url.includes('/playlists/')) return who === 'A' && holdOn === 'oembed' ? raceJson({ error: { status: 404 } }, 404) : raceJson({ name: `${who} playlist`, images: [], owner: { display_name: who } });
    if (url.includes('/me/top/artists')) return raceJson({ items: [{ uri: `spotify:artist:${raceId(who === 'A' ? 83 : 84)}`, name: `${who} artist`, images: [] }] });
    if (url.includes('/me/albums')) return raceJson({ items: [] });
    return raceJson({ items: [], next: null });
  };
  const bridge = createSpotifyBridge({ getConfig: () => config, saveTokens: tokens => { config.tokens = tokens; }, openExternal: url => { opened.push(url); }, fetchImpl });
  t.after(() => { release(); bridge.close(); });
  async function signInAsB() {
    await bridge.authenticate();
    const authorization = new URL(opened.at(-1));
    const callback = new URL(authorization.searchParams.get('redirect_uri'));
    callback.search = new URLSearchParams({ code: 'code-b', state: authorization.searchParams.get('state') }).toString();
    assert.equal((await fetch(callback)).status, 200);
    assert.equal(config.tokens.accessToken, 'access-b');
  }
  return { bridge, config, release, atHold, signInAsB, requests: () => requests };
}

test('Signing in as another account while a feed load waits on a cover: the new account gets its own feed, and the old load cannot overwrite it', { timeout: 15000 }, async t => {
  const race = raceSetup(t, 'cover');
  const pendingA = race.bridge.home();
  await race.atHold;
  await race.signInAsB();
  assert.deepEqual(feedNames(await within(race.bridge.home(), 2000, 'The new account joined the old account\'s load')), ['B playlist']);
  race.release();
  await pendingA;
  const before = race.requests();
  assert.deepEqual(feedNames(await race.bridge.home()), ['B playlist']);
  assert.equal(race.requests(), before, 'The new account\'s feed stays cached');
});

test('Disconnect, then signing in as another account before an embed lookup finishes: the old load is not cached', { timeout: 15000 }, async t => {
  const race = raceSetup(t, 'oembed');
  const pendingA = race.bridge.home();
  await race.atHold;
  await race.bridge.disconnect();
  await race.signInAsB();
  race.release();
  await pendingA;
  const next = await race.bridge.home();
  assert.deepEqual(feedNames(next), ['B playlist']);
  assert.deepEqual(next.missing, []);
});

test('with the web player sign-in, Spotify-made playlists join the library (Discover Weekly first) and their songs load', async t => {
  const DW = 'spotify:playlist:37i9dQZEVXcDWEEKLYxxxx', MIX = 'spotify:playlist:37i9dQZF1E39MIXxxxxxxx';
  const web = [];
  const config = { clientId: CLIENT, tokens: { clientId: CLIENT, accessToken: 'access-secret', refreshToken: 'refresh-secret', expiresAt: Date.now() + 3600000, scope: SCOPES.join(' ') } };
  const bridge = createSpotifyBridge({ getConfig: () => config, saveTokens: () => {}, openExternal: () => {},
    webApi: async pathname => {
      web.push(pathname);
      if (pathname.startsWith('/me/playlists')) return { items: [
        { uri: MIX, name: 'Daily Mix 1', owner: { id: 'spotify' }, images: [] },
        { uri: DW, name: 'Discover Weekly', owner: { id: 'spotify' }, images: [], tracks: { total: 30 } },
        { uri: PLAYLIST, name: 'Mine', owner: { id: 'seb' }, images: [] }], next: null };
      if (pathname === `/playlists/${DW.split(':')[2]}/tracks?limit=50`) return { total: 30, items: [{ track: { uri: 'spotify:track:1234567890ABCDEFGHIJKA', type: 'track', name: 'Fresh find', artists: [{ name: 'New artist' }], album: { name: 'A', images: [] }, duration_ms: 1000 } }] };
      throw new Error('unexpected ' + pathname);
    },
    fetchImpl: async url => {
      if (url.includes('/me/playlists')) return response({ items: [{ uri: PLAYLIST, name: 'Mine', images: [] }], next: null });
      if (url.includes(`/playlists/${DW.split(':')[2]}/items`)) return response({ error: { status: 404 } }, 404);
      throw new Error('unexpected ' + url);
    } });
  t.after(() => bridge.close());
  const state = await bridge.getState();
  assert.deepEqual(state.playlists.map(item => [item.name, item.by || '']), [['Discover Weekly', 'Spotify'], ['Mine', ''], ['Daily Mix 1', 'Spotify']]);
  assert.ok(!web.some(path => path.includes('Discover%20Weekly')), 'A followed Discover Weekly is not searched for');
  const songs = await bridge.playlistTracks(DW);
  assert.deepEqual([songs.total, songs.items.map(item => item.name), songs.restricted], [30, ['Fresh find'], undefined]);
  assert.ok(web.every(path => /^\/(me\/playlists|playlists\/|search\?q=Release%20Radar)/.test(path)), JSON.stringify(web));
});

test('a personal Discover Weekly you do not follow is found by search through the web player sign-in', async t => {
  const DW = 'spotify:playlist:37i9dQZEVXcMYOWNDWxxxx';
  const config = { clientId: CLIENT, tokens: { clientId: CLIENT, accessToken: 'access-secret', refreshToken: 'refresh-secret', expiresAt: Date.now() + 3600000, scope: SCOPES.join(' ') } };
  const bridge = createSpotifyBridge({ getConfig: () => config, saveTokens: () => {}, openExternal: () => {},
    webApi: async pathname => {
      if (pathname.startsWith('/me/playlists')) return { items: [], next: null };
      if (pathname === '/search?q=Discover%20Weekly&type=playlist&limit=10') return { playlists: { items: [null,
        { uri: 'spotify:playlist:1111111111111111111111', name: 'Discover Weekly Archive', owner: { id: 'fan' }, images: [] },
        { uri: DW, name: 'Discover Weekly', owner: { id: 'spotify' }, images: [], tracks: { total: 30 } }] } };
      if (pathname === '/search?q=Release%20Radar&type=playlist&limit=10') return { playlists: { items: [] } };
      throw new Error('unexpected ' + pathname);
    },
    fetchImpl: async url => { if (url.includes('/me/playlists')) return response({ items: [{ uri: PLAYLIST, name: 'Mine', images: [] }], next: null }); throw new Error('unexpected ' + url); } });
  t.after(() => bridge.close());
  const state = await bridge.getState();
  assert.deepEqual(state.playlists.map(item => [item.uri, item.name]), [[DW, 'Discover Weekly'], [PLAYLIST, 'Mine']]);
});
