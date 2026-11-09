'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSpotifyBridge, SCOPES, OPTIONAL_SCOPES } = require('../lib/spotify.cjs');

const CLIENT = '0123456789abcdef0123456789abcdef';
const TRACK = 'spotify:track:1234567890ABCDEFGHIJKL';
const response = (body, status = 200) => new Response(status === 204 ? null : JSON.stringify(body), { status });
const playerBody = (extra = {}) => ({
  is_playing: true, progress_ms: 61000, shuffle_state: false, repeat_state: 'context',
  device: { id: 'device-1', name: 'Living room TV', type: 'TV', is_active: true, is_restricted: false, volume_percent: 35, supports_volume: true },
  item: { uri: TRACK, type: 'track', name: 'Song', duration_ms: 200000, artists: [{ name: 'A' }, { name: 'B' }], album: { name: 'Album', images: [] } },
  context: { uri: 'spotify:playlist:1234567890ABCDEFGHIJKM', type: 'playlist' }, actions: { disallows: { skipping_prev: true } }, ...extra,
});
function harness(t, fetchImpl, scope = SCOPES.join(' ')) {
  const config = { clientId: CLIENT, tokens: { clientId: CLIENT, accessToken: 'access-secret', refreshToken: 'refresh-secret', expiresAt: Date.now() + 3600000, scope } };
  const bridge = createSpotifyBridge({ getConfig: () => config, saveTokens: tokens => { config.tokens = tokens; }, openExternal: () => {}, fetchImpl });
  t.after(() => bridge.close());
  return bridge;
}

test('player state is normalized without tokens, and an idle account is inactive', async t => {
  let idle = false;
  const bridge = harness(t, async url => {
    assert.match(url, /^https:\/\/api\.spotify\.com\/v1\/me\/player/);
    return idle ? response(null, 204) : response(playerBody());
  });
  const player = await bridge.getPlayer();
  assert.equal(player.active, true); assert.equal(player.isPlaying, true); assert.equal(player.progressMs, 61000);
  assert.equal(player.repeat, 'context'); assert.equal(player.track.artists, 'A, B'); assert.equal(player.device.volume, 35);
  assert.equal(player.can.previous, false); assert.equal(player.can.next, true);
  assert.equal(player.liked, null, 'Liked state needs library permission');
  assert.equal(player.libraryAccess, false);
  assert.doesNotMatch(JSON.stringify(player), /access-secret|refresh-secret/);
  idle = true;
  assert.equal((await bridge.getPlayer()).active, false);
});

test('player commands target the active device and validate input before sending', async t => {
  const sent = [];
  const bridge = harness(t, async (url, options = {}) => {
    if ((options.method || 'GET') !== 'GET') { sent.push([options.method, url.replace('https://api.spotify.com/v1', ''), options.body]); return response(null, 204); }
    return response(playerBody());
  });
  await bridge.playerCommand('play-pause');
  await bridge.playerCommand('seek', 120000);
  await bridge.playerCommand('shuffle', true);
  await bridge.playerCommand('repeat', 'track');
  await bridge.playerCommand('volume', 50);
  await bridge.playerCommand('play-item', { contextUri: 'spotify:playlist:1234567890ABCDEFGHIJKM', trackUri: TRACK });
  assert.deepEqual(sent.map(([method, route]) => `${method} ${route}`), [
    'PUT /me/player/pause?device_id=device-1',
    'PUT /me/player/seek?position_ms=120000&device_id=device-1',
    'PUT /me/player/shuffle?state=true&device_id=device-1',
    'PUT /me/player/repeat?state=track&device_id=device-1',
    'PUT /me/player/volume?volume_percent=50&device_id=device-1',
    'PUT /me/player/play?device_id=device-1',
  ]);
  assert.deepEqual(JSON.parse(sent.at(-1)[2]), { context_uri: 'spotify:playlist:1234567890ABCDEFGHIJKM', offset: { uri: TRACK } });
  const count = sent.length;
  await assert.rejects(bridge.playerCommand('seek', 999999), /position/);
  await assert.rejects(bridge.playerCommand('repeat', 'forever'), /repeat/);
  await assert.rejects(bridge.playerCommand('volume', 101), /Volume/);
  await assert.rejects(bridge.playerCommand('previous'), /not available/);
  await assert.rejects(bridge.playerCommand('play-item', { trackUri: 'https://evil.example' }), /song/);
  await assert.rejects(bridge.playerCommand('transfer', '../../me'), /device/);
  assert.equal(sent.length, count, 'Rejected commands send nothing');
});

test('Liked Songs needs only the library scopes and uses the /me/library endpoints', async t => {
  const sent = [], read = [];
  const fetcher = async (url, options = {}) => {
    if (url.includes('/me/library/contains')) { read.push(url.replace('https://api.spotify.com/v1', '')); return response([true]); }
    if ((options.method || 'GET') !== 'GET') { sent.push(`${options.method} ${url.replace('https://api.spotify.com/v1', '')}`); return response(null, 204); }
    return response(playerBody());
  };
  await assert.rejects(harness(t, fetcher).playerCommand('like', true), /Reconnect Spotify/);
  // A connection made before recently played and top artists were requested.
  const bridge = harness(t, fetcher, [...SCOPES, 'user-library-read', 'user-library-modify'].join(' '));
  assert.equal((await bridge.getPlayer()).liked, true);
  await bridge.playerCommand('like', false);
  assert.deepEqual(read, ['/me/library/contains?uris=spotify%3Atrack%3A1234567890ABCDEFGHIJKL']);
  assert.deepEqual(sent, ['DELETE /me/library?uris=spotify%3Atrack%3A1234567890ABCDEFGHIJKL']);
});

test('queue and playlist songs are bounded and only accept Spotify URIs', async t => {
  const bridge = harness(t, async url => {
    if (url.includes('/queue')) return response({ currently_playing: playerBody().item, queue: [...Array(30)].map((_, i) => ({ uri: `spotify:track:${String(i).padStart(22, '0')}`, type: 'track', name: `Q${i}`, artists: [] })).concat([{ uri: 'javascript:alert(1)', name: 'bad' }]) });
    if (url.includes('/playlists/')) return response({ total: 2, items: [{ item: playerBody().item }, { track: { uri: 'bad' } }] });
    throw new Error('Unexpected ' + url);
  });
  const queue = await bridge.queue();
  assert.equal(queue.current.name, 'Song'); assert.equal(queue.items.length, 20);
  const playlist = await bridge.playlistTracks('spotify:playlist:1234567890ABCDEFGHIJKM');
  assert.equal(playlist.items.length, 1); assert.equal(playlist.total, 2);
  await assert.rejects(bridge.playlistTracks('spotify:album:x'), /playlist/);
});

const ID = n => String(n).padStart(22, '0');
test('playlists you do not own play but do not list songs; albums list their songs', async t => {
  const bridge = harness(t, async url => {
    if (url.includes('/playlists/')) return response({ error: { status: 403 } }, 403);
    if (url.includes('/albums/')) return response({ total: 12, items: [{ uri: `spotify:track:${ID(5)}`, type: 'track', name: 'Opening', artists: [{ name: 'Band' }], duration_ms: 1000 }, { uri: 'bad' }] });
    throw new Error('Unexpected ' + url);
  });
  assert.deepEqual(await bridge.playlistTracks(`spotify:playlist:${ID(1)}`), { uri: `spotify:playlist:${ID(1)}`, items: [], total: null, restricted: true });
  const album = await bridge.albumTracks(`spotify:album:${ID(2)}`);
  assert.equal(album.total, 12); assert.deepEqual(album.items.map(item => item.name), ['Opening']);
  await assert.rejects(bridge.albumTracks(`spotify:playlist:${ID(2)}`), /album/);
});

test('any album, artist, playlist or song can be played on the active device', async t => {
  const sent = [];
  const bridge = harness(t, async (url, options = {}) => {
    if ((options.method || 'GET') !== 'GET') { sent.push(JSON.parse(options.body)); return response(null, 204); }
    return response(playerBody());
  });
  await bridge.playPlaylist(`spotify:album:${ID(3)}`);
  await bridge.playPlaylist(`spotify:artist:${ID(4)}`);
  await bridge.playPlaylist(TRACK);
  assert.deepEqual(sent, [{ context_uri: `spotify:album:${ID(3)}` }, { context_uri: `spotify:artist:${ID(4)}` }, { uris: [TRACK] }]);
  // Liked Songs plays as the account's collection.
  await bridge.playPlaylist('spotify:user:x:collection');
  assert.deepEqual(sent.at(-1), { context_uri: 'spotify:user:x:collection' });
  await assert.rejects(bridge.playPlaylist('spotify:user:x:playlist'), /valid Spotify/);
  await assert.rejects(bridge.playPlaylist('spotify:user:../x:collection'), /valid Spotify/);
  assert.equal(sent.length, 4);
});

const MIX_COVER = 'https://pickasso.spotifycdn.com/image/ab67c0de0000deef/dt/v1/img/dw/cover/en';
function homeFetcher(calls) {
  const image = width => [{ url: `https://i.scdn.co/image/${width}`, width, height: width }];
  return async url => {
    calls.push(url.replace('https://api.spotify.com/v1', ''));
    if (url.startsWith('https://i.scdn.co/') || url.startsWith('https://pickasso.spotifycdn.com/')) return new Response(new Uint8Array([255, 216, 255, 0]), { headers: { 'content-type': 'image/jpeg' } });
    if (url.startsWith('https://open.spotify.com/oembed')) return new Response(JSON.stringify({ title: 'Daily Mix 1', thumbnail_url: MIX_COVER }), { headers: { 'content-type': 'application/json' } });
    if (url.includes('/recently-played')) {
      const play = (context, n) => ({ context: context && { uri: context }, track: { uri: `spotify:track:${ID(n)}`, type: 'track', name: `Song ${n}`, artists: [{ name: 'Singer' }], album: { name: `Album ${n}`, artists: [{ name: 'Singer' }], images: image(300) } } });
      return response({ items: [play(`spotify:playlist:${ID(10)}`, 1), play(`spotify:playlist:${ID(10)}`, 2), play(`spotify:playlist:${ID(11)}`, 3),
        play(`spotify:album:${ID(12)}`, 4), play(`spotify:artist:${ID(13)}`, 5), play(null, 6), play('spotify:user:me:collection', 7), play('javascript:alert(1)', 8)] });
    }
    if (url.includes(`/playlists/${ID(10)}`)) return response({ name: 'Road trip', images: image(160), owner: { display_name: 'Sam' } });
    if (url.includes(`/playlists/${ID(11)}`)) return response({ error: { status: 404 } }, 404);
    if (url.includes(`/artists/${ID(13)}`)) return response({ name: 'The Band', images: image(160) });
    if (url.includes('/me/top/artists')) return response({ items: [{ uri: `spotify:artist:${ID(20)}`, name: 'Top artist', images: image(160) }, { uri: 'bad', name: 'x' }] });
    if (url.includes('/me/albums')) return response({ items: [{ album: { uri: `spotify:album:${ID(21)}`, name: 'Saved album', artists: [{ name: 'Duo' }], images: image(160) } }] });
    if (url.includes('/me/tracks')) return response({ items: [], total: 88 });
    if (url.includes('/me/following')) return response({ artists: { items: [{ uri: `spotify:artist:${ID(22)}`, name: 'Followed artist', images: image(160) }] } });
    if (url.endsWith('/v1/me')) return response({ id: 'seb' });
    if (url.includes('/search')) return response({ playlists: { items: [null, { uri: `spotify:playlist:${ID(30)}`, name: 'Found list', owner: { display_name: 'Spotify' }, images: [] }] },
      albums: { items: [{ uri: `spotify:album:${ID(31)}`, name: 'Found album', artists: [{ name: 'Duo' }], images: [] }] }, artists: { items: [{ uri: 'javascript:x', name: 'bad' }] } });
    throw new Error('Unexpected ' + url);
  };
}

test('the home feed groups recently played music and names Spotify-made playlists', async t => {
  const calls = [];
  const bridge = harness(t, homeFetcher(calls), [...SCOPES, ...OPTIONAL_SCOPES].join(' '));
  const home = await bridge.home();
  assert.deepEqual(home.missing, []);
  assert.deepEqual(home.recent.map(item => [item.type, item.name, item.subtitle]), [
    ['playlist', 'Road trip', 'Playlist · Sam'], ['playlist', 'Daily Mix 1', 'Playlist'], ['album', 'Album 4', 'Singer'],
    ['artist', 'The Band', 'Artist'], ['track', 'Song 6', 'Singer'], ['track', 'Song 7', 'Singer'], ['track', 'Song 8', 'Singer']]);
  assert.equal(home.recent[1].imageUrl, MIX_COVER, 'Hidden playlists use the public embed cover');
  assert.match(home.recent[1].artwork, /^data:image\/jpeg;base64,/, 'Mix covers from pickasso.spotifycdn.com load');
  assert.match(home.recent[0].artwork, /^data:image\/jpeg;base64,/);
  assert.deepEqual(home.recent.slice(0, 3).map(item => item.by), ['Sam', '', 'Singer'], 'Items say who made them');
  assert.deepEqual(home.artists.map(item => item.name), ['Top artist']);
  assert.deepEqual(home.albums.map(item => [item.uri, item.subtitle]), [[`spotify:album:${ID(21)}`, 'Duo']]);
  assert.deepEqual([home.liked.uri, home.liked.name, home.liked.subtitle], ['spotify:user:seb:collection', 'Liked Songs', 'Playlist · 88 songs']);
  assert.deepEqual(home.following.map(item => item.name), ['Followed artist']);
  assert.doesNotMatch(JSON.stringify(home), /access-secret|javascript/);
  const count = calls.length;
  await bridge.home();
  assert.equal(calls.length, count, 'The feed is cached for a few minutes');
  await bridge.home(true);
  assert.ok(calls.length > count, 'Refresh reads it again');
});

test('the home feed lists sections a connection may not show, and search covers all of Spotify', async t => {
  const calls = [];
  const bridge = harness(t, homeFetcher(calls));
  const home = await bridge.home();
  assert.deepEqual(home.missing, ['following', 'recent', 'artists', 'albums']);
  assert.equal(calls.length, 0, 'Nothing is requested without permission');
  assert.deepEqual((await bridge.getState()).access, { library: false, recent: false, top: false });
  const found = await bridge.search('  found\u0007 ');
  assert.equal(found.query, 'found');
  assert.deepEqual(found.items.map(item => [item.type, item.name, item.subtitle, item.by]), [['playlist', 'Found list', 'Playlist · Spotify', 'Spotify'], ['album', 'Found album', 'Album · Duo', 'Duo']]);
  assert.match(calls.find(url => url.includes('/search')), /q=found&type=playlist%2Calbum%2Cartist&limit=6|q=found&type=playlist,album,artist&limit=6/);
  const searches = calls.filter(url => url.includes('/search')).length;
  await bridge.search('FOUND');
  assert.equal(calls.filter(url => url.includes('/search')).length, searches, 'Repeated searches are cached');
  assert.deepEqual(await bridge.search('f'), { query: 'f', items: [] });
  await assert.rejects(bridge.search({}), /search/);
});

// A bridge with its own clock, for cache timing.
function clocked(t, fetchImpl, scope = [...SCOPES, ...OPTIONAL_SCOPES].join(' ')) {
  let clock = 1000000;
  const config = { clientId: CLIENT, tokens: { clientId: CLIENT, accessToken: 'access-a', refreshToken: 'refresh-a', expiresAt: clock + 36000000, scope } };
  const bridge = createSpotifyBridge({ getConfig: () => config, saveTokens: tokens => { config.tokens = tokens; }, openExternal: () => {}, fetchImpl, now: () => clock });
  t.after(() => bridge.close());
  return { bridge, config, advance: ms => { clock += ms; } };
}
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const played = context => ({ items: [{ context: { uri: context }, track: { uri: `spotify:track:${ID(1)}`, type: 'track', name: 'Song', artists: [{ name: 'Singer' }], album: { name: 'Album', images: [] } } }] });
const emptyLists = url => url.includes('/me/top/artists') || url.includes('/me/albums') ? json({ items: [] })
  : url.includes('/me/tracks') ? json({ items: [], total: 0 }) : url.includes('/me/following') ? json({ artists: { items: [] } }) : url.endsWith('/v1/me') ? json({ id: 'seb' }) : null;

test('a temporary embed failure is retried once the short hold on the partial feed ends', async t => {
  let embeds = 0, recent = 0;
  const { bridge, advance } = clocked(t, async url => {
    if (url.startsWith('https://open.spotify.com/oembed')) { embeds++; return embeds === 1 ? new Response('busy', { status: 503 }) : json({ title: 'Discover Weekly' }); }
    if (url.includes('/recently-played')) { recent++; return json(played(`spotify:playlist:${ID(50)}`)); }
    if (url.includes('/playlists/')) return json({ error: { status: 404 } }, 404);
    return emptyLists(url) || json({}, 500);
  });
  assert.equal((await bridge.home()).recent[0].name, 'Playlist');
  advance(61000);
  assert.equal((await bridge.home()).recent[0].name, 'Playlist', 'The partial feed is held for a few minutes, not read again at once');
  assert.equal(recent, 1);
  advance(120000);
  assert.equal((await bridge.home()).recent[0].name, 'Discover Weekly', 'A failed lookup is not kept for hours');
  assert.equal(recent, 2);
  await bridge.home();
  assert.equal(recent, 2, 'The complete feed is cached');
  assert.equal(embeds, 2);
});

test('Refresh retries a failed embed lookup straight away', async t => {
  let embeds = 0;
  const { bridge } = clocked(t, async url => {
    if (url.startsWith('https://open.spotify.com/oembed')) { embeds++; return embeds === 1 ? Promise.reject(new TypeError('offline')) : json({ title: 'Daily Mix 2' }); }
    if (url.includes('/recently-played')) return json(played(`spotify:playlist:${ID(51)}`));
    if (url.includes('/playlists/')) return json({ error: { status: 404 } }, 404);
    return emptyLists(url) || json({}, 500);
  });
  assert.equal((await bridge.home()).recent[0].name, 'Playlist');
  assert.equal((await bridge.home(true)).recent[0].name, 'Daily Mix 2');
});

test('a rate-limited detail request keeps a generic name for a few minutes only, then the feed is read again', async t => {
  let details = 0, recent = 0;
  const { bridge, advance } = clocked(t, async url => {
    if (url.startsWith('https://open.spotify.com/oembed')) return new Response('not found', { status: 404 });  // private playlist
    if (url.includes('/recently-played')) { recent++; return json(played(`spotify:playlist:${ID(52)}`)); }
    if (url.includes('/playlists/')) { details++; return details === 1 ? json({}, 429, { 'retry-after': '1' }) : json({ name: 'My road trip', images: [], owner: { display_name: 'Me' } }); }
    return emptyLists(url) || json({}, 500);
  });
  assert.equal((await bridge.home()).recent[0].name, 'Playlist');
  advance(2000);
  assert.equal((await bridge.home()).recent[0].name, 'Playlist', 'The degraded feed is held rather than read again at once');
  assert.equal(recent, 1);
  advance(180000);
  const later = await bridge.home();
  assert.equal(later.recent[0].name, 'My road trip');
  assert.equal(recent, 2, 'The degraded feed was read again after the hold');
});

test('a feed load that outlives Disconnect is not cached for the next account', async t => {
  let release; const gate = new Promise(resolve => { release = resolve; });
  let reached; const atDetails = new Promise(resolve => { reached = resolve; });
  const { bridge, config } = clocked(t, async (url, options = {}) => {
    const who = String(options.headers?.Authorization || '').includes('access-b') ? 'B' : 'A';
    if (url.includes('/recently-played')) return json(played(`spotify:playlist:${ID(who === 'A' ? 53 : 54)}`));
    if (url.includes('/playlists/')) { if (who === 'A') { reached(); await gate; } return json({ name: `${who} playlist`, images: [], owner: { display_name: who } }); }
    if (url.includes('/me/top/artists')) return json({ items: [{ uri: `spotify:artist:${ID(who === 'A' ? 55 : 56)}`, name: `${who} artist`, images: [] }] });
    return emptyLists(url) || json({}, 500);
  });
  const pending = bridge.home();
  await atDetails;
  await bridge.disconnect();
  release();
  await pending.catch(() => null);
  config.tokens = { clientId: CLIENT, accessToken: 'access-b', refreshToken: 'refresh-b', expiresAt: 1000000 + 36000000, scope: [...SCOPES, ...OPTIONAL_SCOPES].join(' ') };
  const next = await bridge.home();
  assert.deepEqual(next.recent.map(item => item.name), ['B playlist']);
  assert.deepEqual(next.artists.map(item => item.name), ['B artist']);
  assert.deepEqual(next.missing, [], 'Sections are judged by the permissions of one session');
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

for (const holdOn of ['oembed', 'cover']) {
  test(`a feed load held at ${holdOn === 'oembed' ? 'the embed lookup' : 'a cover'} during Disconnect is never served to the next account`, { timeout: 15000 }, async t => {
    const race = raceSetup(t, holdOn);
    const pending = race.bridge.home();
    await race.atHold;
    await race.bridge.disconnect();
    race.release();
    await pending;
    race.config.tokens = raceTokens('b');
    const before = race.requests();
    const next = await race.bridge.home();
    assert.deepEqual(feedNames(next), ['B playlist']);
    assert.deepEqual(next.missing, []);
    assert.ok(race.requests() > before, 'The next account\'s feed is read, not taken from the old load');
  });
}

test('a feed load that outlives Disconnect keeps the permissions it started with', { timeout: 15000 }, async t => {
  const race = raceSetup(t, 'oembed');
  const pending = race.bridge.home();
  await race.atHold;
  await race.bridge.disconnect();
  race.release();
  assert.deepEqual((await pending).missing, [], 'No false Reconnect notice from a load that started connected');
});
