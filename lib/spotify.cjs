'use strict';

const http = require('node:http');
const { randomBytes, createHash, timingSafeEqual } = require('node:crypto');
const { createArtworkCache, artworkUrl } = require('./spotify-artwork.cjs');

// An explicit loopback port also works with dashboard validators that reject
// the documented port-free registration. Register this exact local URI.
const REDIRECT_URI = 'http://127.0.0.1:43821/callback';
const SCOPES = ['playlist-read-private', 'playlist-read-collaborative',
  'user-read-playback-state', 'user-modify-playback-state'];
// Liked Songs, saved albums, recently played and top artists. Requested on new
// sign-ins but not required, so older connections keep working until reconnected.
const LIBRARY_SCOPES = ['user-library-read', 'user-library-modify'];
const OPTIONAL_SCOPES = [...LIBRARY_SCOPES, 'user-read-recently-played', 'user-top-read', 'user-follow-read'];
const PLAYLIST_URI = /^spotify:playlist:[A-Za-z0-9]{22}$/;
const ALBUM_URI = /^spotify:album:[A-Za-z0-9]{22}$/;
const ARTIST_URI = /^spotify:artist:[A-Za-z0-9]{22}$/;
const TRACK_URI = /^spotify:(?:track|episode):[A-Za-z0-9]{22}$/;
const CONTEXT_URI = /^(?:spotify:(?:playlist|album|artist|show):[A-Za-z0-9]{22}|spotify:user:[A-Za-z0-9._-]{1,64}:collection)$/;
const COLLECTION_URI = /^spotify:user:[A-Za-z0-9._-]{1,64}:collection$/;
// Recently played groups playlists, albums and artists (Liked Songs has its own shortcut).
const ITEM_CONTEXT_URI = /^spotify:(?:playlist|album|artist|show):[A-Za-z0-9]{22}$/;
const DEVICE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const REPEAT = new Set(['off', 'context', 'track']);
const CLIENT_ID = /^[a-f0-9]{32}$/i;
const API_ROOT = 'https://api.spotify.com/v1';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';

function equalSecret(a, b) {
  const left = Buffer.from(a || '');
  const right = Buffer.from(b || '');
  return left.length === right.length && timingSafeEqual(left, right);
}

// cache: { read(), write(value) } keeps the library, Home and Spotify's wait
// time across restarts and updates, so starting Edge Deck asks Spotify for
// nothing that is less than ten minutes old (and nothing at all during a wait).
function createSpotifyBridge({ webApi = null, getConfig, saveTokens, openExternal, fetchImpl = globalThis.fetch, now = Date.now, cache = null }) {
  if (![getConfig, saveTokens, openExternal, fetchImpl, now].every(value => typeof value === 'function')) {
    throw new TypeError('Spotify requires configuration, encrypted token storage and browser callbacks.');
  }
  let closed = false;
  let generation = 0;
  let authorization = null;
  let authenticateFlight = null;
  let refreshFlight = null;
  let libraryFlight = null;
  let library = [];
  let libraryClient = '';
  let libraryLoaded = false;
  let libraryAttempt = 0;
  let hasMore = false;
  let retryAt = 0, webExtras = { at: 0, items: [] }, webBlockedUntil = 0;
  let lastError = null;
  let message = '';
  let grantedScopes = '';
  let likedCache = { id: '', value: null, time: 0 };
  const covers = createArtworkCache({ fetchImpl, now, max: 128 });
  let homeCache = { key: '', at: 0, value: null };
  let homeFlight = null;
  const searches = new Map();
  const embeds = new Map();
  // Covers, the home feed, searches and Liked Songs state belong to one account
  // session. The epoch lets loads that started before a change drop their result.
  let cacheEpoch = 0;
  function clearCaches() {
    cacheEpoch++; covers.clear(); homeCache = { key: '', at: 0, value: null }; homeFlight = null; searches.clear();
    likedCache = { id: '', value: null, time: 0 };
  }
  let stored = null;
  try { stored = cache?.read?.() || null; } catch { stored = null; }
  const HOME_LISTS = ['recent', 'artists', 'albums', 'following'];
  const withoutArtwork = item => { const { artwork, ...rest } = item || {}; return rest; };
  async function loadArtwork(items) {
    let next = 0;
    await Promise.all(Array.from({ length: 3 }, async () => { while (next < items.length) { const item = items[next++]; if (!item.artwork && item.imageUrl) item.artwork = await covers.load(item.imageUrl); if (!item.artwork && item.image) item.artwork = await covers.load(item.image); } }));
  }
  // Runs `job` over `items` at most `width` at a time (Spotify counts the app's
  // calls in a short window, so bursts are what get it limited); results keep
  // the items' order.
  async function inTurns(items, width, job) {
    const results = new Array(items.length); let next = 0;
    await Promise.all(Array.from({ length: Math.min(width, items.length) }, async () => { while (next < items.length) { const index = next++; results[index] = await job(items[index], index); } }));
    return results;
  }
  // The saved copy for this Spotify app, once, when its Client ID is known.
  function restore(clientId) {
    const saved = stored; stored = null;
    if (!saved || saved.version !== 1 || saved.clientId !== clientId) return;
    const time = value => Number.isFinite(value) && value <= now() + 86400000 ? value : 0;
    const playlists = Array.isArray(saved.library) ? saved.library.filter(item => item && typeof item.uri === 'string' && PLAYLIST_URI.test(item.uri) && typeof item.name === 'string').slice(0, 500) : [];
    library = playlists.map(item => ({ ...item, artwork: null })); hasMore = saved.hasMore === true; libraryLoaded = saved.loaded === true && playlists.length > 0;
    libraryAttempt = Math.min(time(saved.libraryAt), now());
    retryAt = Math.max(retryAt, time(saved.retryAt)); webBlockedUntil = Math.max(webBlockedUntil, time(saved.webBlockedUntil));
    if (saved.webExtras && Array.isArray(saved.webExtras.items)) webExtras = { at: Math.min(time(saved.webExtras.at), now()), items: saved.webExtras.items.filter(item => item && PLAYLIST_URI.test(item.uri || '')).slice(0, 200) };
    const home = saved.home;
    if (home && typeof home.key === 'string' && home.value && typeof home.value === 'object') {
      const value = { missing: Array.isArray(home.value.missing) ? home.value.missing.filter(item => typeof item === 'string') : [], liked: home.value.liked && typeof home.value.liked.uri === 'string' ? home.value.liked : null };
      for (const list of HOME_LISTS) value[list] = Array.isArray(home.value[list]) ? home.value[list].filter(item => item && typeof item.uri === 'string').slice(0, 60).map(item => ({ ...item, artwork: null })) : null;
      homeCache = { key: home.key, at: Math.min(time(home.at), now()), value };
      loadArtwork(HOME_LISTS.flatMap(list => value[list] || [])).catch(() => {});
    }
    loadArtwork(library.slice(0, 60)).catch(() => {});
  }
  let persistTimer = null;
  function persist() {
    if (!cache?.write || persistTimer) return;
    persistTimer = setTimeout(() => {
      persistTimer = null;
      try {
        cache.write({ version: 1, clientId: libraryClient, library: library.map(withoutArtwork), hasMore, loaded: libraryLoaded, libraryAt: libraryAttempt, retryAt, webBlockedUntil,
          webExtras: { at: webExtras.at, items: webExtras.items.map(withoutArtwork) },
          home: homeCache.value ? { key: homeCache.key, at: homeCache.at, value: { ...homeCache.value, ...Object.fromEntries(HOME_LISTS.map(list => [list, homeCache.value[list] ? homeCache.value[list].map(withoutArtwork) : null])) } } : null });
      } catch { /* The saved copy is only a head start. */ }
    }, 500);
    persistTimer.unref?.();
  }

  async function configuration() {
    let value;
    try { value = await getConfig(); }
    catch { throw new Error('Spotify settings could not be read. Check Windows credential storage and try again.'); }
    const clientId = typeof value?.clientId === 'string' ? value.clientId.trim() : '';
    let tokens = value?.tokens;
    if (!tokens || typeof tokens !== 'object' || tokens.clientId !== clientId ||
        typeof tokens.accessToken !== 'string' || !tokens.accessToken || tokens.accessToken.length > 8192 ||
        typeof tokens.refreshToken !== 'string' || !tokens.refreshToken || tokens.refreshToken.length > 8192 ||
        !Number.isFinite(tokens.expiresAt)) tokens = null;
    grantedScopes = typeof tokens?.scope === 'string' ? tokens.scope : '';
    if (libraryClient !== clientId) {
      libraryClient = clientId;
      library = []; libraryLoaded = false; libraryAttempt = 0; hasMore = false;
      clearCaches();
      lastError = null; retryAt = 0; message = '';
      restore(clientId);
    }
    return { clientId, tokens };
  }

  function checkOpen() { if (closed) throw new Error('Spotify connection is closed.'); }
  async function unchanged(clientId, expectedGeneration) {
    if (closed || generation !== expectedGeneration) {
      throw new Error('Spotify settings changed. Connect again.');
    }
    const current = await configuration();
    if (closed || generation !== expectedGeneration || current.clientId !== clientId) {
      throw new Error('Spotify settings changed. Connect again.');
    }
  }
  function rateError() {
    return new Error('Spotify is limiting requests. Please wait before trying again.');
  }
  async function fetchSpotify(url, options = {}) {
    checkOpen();
    if (now() < retryAt) throw rateError();
    let response;
    try { response = await fetchImpl(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(12000) }); }
    catch { throw new Error('Spotify could not be reached. Check your internet connection and try again.'); }
    if (response.status === 429) {
      const seconds = Number(response.headers?.get('retry-after'));
      // Respect the wait, but never longer than ten minutes: Spotify can ask
      // for hours while the limit itself lifts far sooner.
      retryAt = now() + (Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 600) : 30) * 1000;
      persist();
      throw rateError();
    }
    return response;
  }

  async function storeTokenResponse(response, clientId, previous, expectedGeneration, requireScopes = false) {
    if (!response.ok) {
      if (response.status === 400 || response.status === 401) {
        await unchanged(clientId, expectedGeneration);
        if (previous) {
          await saveTokens(null);
          library = []; libraryLoaded = false; hasMore = false;
          clearCaches();
        }
        throw new Error('Spotify authorization expired or was rejected. Connect again.');
      }
      throw new Error('Spotify sign-in could not be completed. Try connecting again.');
    }
    let data;
    try { data = await response.json(); } catch { throw new Error('Spotify returned an invalid sign-in response.'); }
    if (typeof data.access_token !== 'string' || data.access_token.length > 8192 ||
        !Number.isFinite(data.expires_in) || data.expires_in <= 0 ||
        (data.token_type && data.token_type.toLowerCase() !== 'bearer')) {
      throw new Error('Spotify returned an invalid sign-in response.');
    }
    const refreshToken = typeof data.refresh_token === 'string' ? data.refresh_token : previous?.refreshToken;
    if (!refreshToken || refreshToken.length > 8192) throw new Error('Spotify did not provide a refresh token. Connect again.');
    const granted = new Set(String(data.scope || previous?.scope || '').split(/\s+/));
    if (requireScopes && SCOPES.some(scope => !granted.has(scope))) {
      throw new Error('Spotify did not grant the required playlist and playback permissions. Connect again.');
    }
    const tokens = { clientId, accessToken: data.access_token, refreshToken,
      expiresAt: now() + data.expires_in * 1000, scope: [...granted].filter(Boolean).join(' ') };
    await unchanged(clientId, expectedGeneration);
    try { await saveTokens(tokens); }
    catch { throw new Error('Spotify credentials could not be securely saved. Check Windows credential storage and reconnect.'); }
    return tokens;
  }

  async function accessToken(force = false) {
    const { clientId, tokens } = await configuration();
    if (!CLIENT_ID.test(clientId) || !tokens) throw new Error('Connect Spotify in Music settings first.');
    if (!force && tokens.expiresAt > now() + 30000) return { clientId, token: tokens.accessToken };
    if (refreshFlight) return refreshFlight;
    const expectedGeneration = generation;
    refreshFlight = (async () => {
      const response = await fetchSpotify(TOKEN_URL, { method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokens.refreshToken, client_id: clientId }).toString() });
      const next = await storeTokenResponse(response, clientId, tokens, expectedGeneration);
      return { clientId, token: next.accessToken };
    })();
    try { return await refreshFlight; } finally { refreshFlight = null; }
  }

  async function api(route, options = {}, retried = false) {
    const expectedGeneration = generation;
    const auth = await accessToken();
    const response = await fetchSpotify(API_ROOT + route, { ...options,
      headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), Authorization: `Bearer ${auth.token}` } });
    await unchanged(auth.clientId, expectedGeneration);
    if (response.status === 401 && !retried) { await accessToken(true); return api(route, options, true); }
    if (response.status === 401) {
      await saveTokens(null); library = []; libraryLoaded = false; hasMore = false;
      clearCaches();
      throw new Error('Spotify authorization expired. Connect again.');
    }
    const failure = message => Object.assign(new Error(message), { status: response.status });
    if (response.status === 403) throw failure('Spotify denied this action. Check Premium, the app allowlist and the granted permissions.');
    if (response.status === 404) throw failure('No active Spotify player was found. Open Spotify and start a track, then try again.');
    if (!response.ok) throw failure('Spotify could not complete this request. Try again in a moment.');
    if (response.status === 204) return null;
    // Spotify sometimes answers 200 or 202 with an empty body (player commands,
    // or no current playback): that means "nothing to report", not an error.
    let body = '';
    try { body = await response.text(); } catch { throw new Error('Spotify returned an unreadable response.'); }
    if (!body.trim()) return null;
    try { return JSON.parse(body); } catch { if ((options.method || 'GET') !== 'GET') return null; throw new Error('Spotify returned an unreadable response.'); }
  }

  async function loadLibrary(force) {
    if (libraryFlight) return libraryFlight;
    if (!force && libraryAttempt && now() - libraryAttempt < 600000) return;
    if (now() < retryAt) return;
    libraryAttempt = now();
    const expectedGeneration = generation;
    const libraryOwner = libraryClient;
    libraryFlight = (async () => {
      const collected = [];
      let more = false;
      for (let offset = 0; offset < 500; offset += 50) {
        const page = await api(`/me/playlists?limit=50&offset=${offset}`);
        if (!page || !Array.isArray(page.items)) throw new Error('Spotify returned an unreadable playlist library.');
        for (const item of page.items.slice(0, 50)) {
          if (!item || typeof item.uri !== 'string' || !PLAYLIST_URI.test(item.uri)) continue;
          const id = item.uri.slice('spotify:playlist:'.length);
          if (collected.some(playlist => playlist.id === id)) continue;
          const image = Array.isArray(item.images) ? [...item.images].filter(value => artworkUrl(value?.url)).sort((a,b)=>(a.width || 10000)-(b.width || 10000))[0]?.url : null;
          const total = item.items?.total ?? item.tracks?.total;
          collected.push({ id, uri: item.uri, name: String(item.name || 'Untitled playlist').slice(0, 160),
            image: image || null, totalTracks: Number.isInteger(total) && total >= 0 ? total : null });
        }
        more = Boolean(page.next);
        if (!more) break;
      }
      // Spotify withholds the playlists it makes (Discover Weekly, Daily Mixes…)
      // from developer apps; the web player sign-in (Canvas) still lists them.
      // Spotify rate-limits the web player sign-in on its public API (often for a
      // whole day). Asking again during that time only extends the wait.
      if (webApi && (now() < webBlockedUntil || (!force && webExtras.at && now() - webExtras.at < 1800000))) {
        for (const item of webExtras.items) if (!collected.some(playlist => playlist.id === item.id)) collected.push({ ...item });
      } else if (webApi) {
        try {
          for (let offset = 0; offset < 200; offset += 50) {
            const page = await webApi(`/me/playlists?limit=50&offset=${offset}`);
            if (!page || !Array.isArray(page.items)) break;
            for (const item of page.items.slice(0, 50)) {
              if (!item || item.owner?.id !== 'spotify' || typeof item.uri !== 'string' || !PLAYLIST_URI.test(item.uri)) continue;
              const id = item.uri.slice('spotify:playlist:'.length);
              if (collected.some(playlist => playlist.id === id)) continue;
              const image = Array.isArray(item.images) ? [...item.images].filter(value => artworkUrl(value?.url)).sort((a,b)=>(a.width || 10000)-(b.width || 10000))[0]?.url : null;
              const total = item.items?.total ?? item.tracks?.total;
              collected.push({ id, uri: item.uri, name: String(item.name || 'Spotify playlist').slice(0, 160), by: 'Spotify', madeBySpotify: true,
                image: image || null, totalTracks: Number.isInteger(total) && total >= 0 ? total : null });
            }
            if (!page.next) break;
          }
          // Discover Weekly and Release Radar are personal (a different playlist
          // for every account) and usually not followed, so they are not in the
          // list above. The web player finds yours by searching Spotify's own.
          for (const name of ['Discover Weekly', 'Release Radar']) {
            if (collected.some(playlist => playlist.madeBySpotify && playlist.name.toLowerCase() === name.toLowerCase())) continue;
            const found = await webApi(`/search?q=${encodeURIComponent(name)}&type=playlist&limit=10`).catch(() => null);
            const item = listOf(found?.playlists?.items).find(entry => entry?.owner?.id === 'spotify' && String(entry.name || '').trim().toLowerCase() === name.toLowerCase() && PLAYLIST_URI.test(entry.uri || ''));
            if (!item) continue;
            const id = item.uri.slice('spotify:playlist:'.length);
            if (collected.some(playlist => playlist.id === id)) continue;
            const image = Array.isArray(item.images) ? [...item.images].filter(value => artworkUrl(value?.url)).sort((a,b)=>(a.width || 10000)-(b.width || 10000))[0]?.url : null;
            const total = item.items?.total ?? item.tracks?.total;
            collected.push({ id, uri: item.uri, name, by: 'Spotify', madeBySpotify: true, image: image || null, totalTracks: Number.isInteger(total) && total >= 0 ? total : null });
          }
        } catch (error) {
          // Without the web player sign-in, only your own playlists show.
          if (error?.status === 429) { webBlockedUntil = now() + Math.min(Math.max(Number(error.retryAfter) || 3600, 600), 86400) * 1000; persist(); }
        }
        webExtras = { at: now(), items: collected.filter(playlist => playlist.madeBySpotify).map(playlist => ({ ...playlist })) };
      }
      // Spotify-made playlists first, as Spotify's own library pins them.
      collected.sort((a, b) => Number(Boolean(b.madeBySpotify) && /discover weekly/i.test(b.name)) - Number(Boolean(a.madeBySpotify) && /discover weekly/i.test(a.name)));
      const visibleCovers = collected.slice(0, 60); let nextCover = 0;
      await Promise.all(Array.from({ length: 3 }, async () => {
        while (nextCover < visibleCovers.length) { const playlist = visibleCovers[nextCover++]; playlist.artwork = await covers.load(playlist.image); }
      }));
      await unchanged(libraryOwner, expectedGeneration);
      library = collected; hasMore = more; libraryLoaded = true; lastError = null; persist();
      message = more ? 'Showing the first 500 playlists returned by Spotify.' :
        collected.length ? 'Choose a playlist to play on your active Spotify device.' : 'Spotify returned no playlists for this account.';
    })();
    try { await libraryFlight; }
    catch (error) { lastError = error.message; }
    finally { libraryFlight = null; }
  }

  async function snapshot() {
    const { clientId, tokens } = await configuration();
    return { connected: Boolean(tokens && CLIENT_ID.test(clientId)), connecting: Boolean(authorization),
      clientIdConfigured: CLIENT_ID.test(clientId), redirectUri: REDIRECT_URI,
      playlists: library.map(item => ({ ...item })), hasMore, loaded: libraryLoaded,
      access: { library: libraryAccess(), recent: hasScope('user-read-recently-played'), top: hasScope('user-top-read') }, session: cacheEpoch,
      message: authorization ? 'Finish signing in through the Spotify browser window.' : message,
      error: lastError, retryAt: retryAt > now() ? new Date(retryAt).toISOString() : null };
  }

  const text = (value, limit = 160) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, limit);
  const hasScope = scope => grantedScopes.split(/\s+/).includes(scope);
  const libraryAccess = () => LIBRARY_SCOPES.every(hasScope);
  const listOf = value => Array.isArray(value) ? value : [];
  const names = list => text(listOf(list).map(item => item?.name).filter(Boolean).join(', '));
  function bestImage(images, target) {
    const list = Array.isArray(images) ? images.filter(image => artworkUrl(image?.url)) : [];
    if (!list.length) return null;
    // Smallest image that still covers the target size, otherwise the largest.
    const sorted = [...list].sort((a, b) => (a.width || 10000) - (b.width || 10000));
    return (sorted.find(image => (image.width || 10000) >= target) || sorted.at(-1)).url;
  }
  function trackSummary(item) {
    if (!item || typeof item !== 'object' || !TRACK_URI.test(item.uri || '')) return null;
    const episode = item.type === 'episode';
    const artists = episode ? [item.show?.name] : (Array.isArray(item.artists) ? item.artists.map(artist => artist?.name) : []);
    const images = episode ? (item.images || item.show?.images) : item.album?.images;
    return { id: item.uri.split(':')[2], uri: item.uri, type: episode ? 'episode' : 'track', name: text(item.name || 'Untitled'),
      artists: text(artists.filter(Boolean).join(', ')), album: text(episode ? item.show?.name : item.album?.name),
      durationMs: Number.isFinite(item.duration_ms) ? item.duration_ms : null, explicit: item.explicit === true,
      imageUrl: bestImage(images, 300), thumbUrl: bestImage(images, 64) };
  }
  function deviceSummary(device) {
    if (!device || typeof device !== 'object') return null;
    return { id: typeof device.id === 'string' && DEVICE_ID.test(device.id) ? device.id : null, name: text(device.name || 'Spotify device', 120),
      type: text(device.type || 'Unknown', 40), active: device.is_active === true, restricted: device.is_restricted === true,
      volume: Number.isFinite(device.volume_percent) ? device.volume_percent : null, supportsVolume: device.supports_volume !== false };
  }
  async function withArtwork(track, field = 'imageUrl') {
    if (!track) return track;
    return { ...track, artwork: await covers.load(track[field]) };
  }
  async function liked(trackId) {
    if (!trackId || !libraryAccess()) return null;
    if (likedCache.id === trackId && now() - likedCache.time < 30000) return likedCache.value;
    try {
      const result = await api(`/me/library/contains?uris=${encodeURIComponent(`spotify:track:${trackId}`)}`);
      likedCache = { id: trackId, value: Array.isArray(result) ? result[0] === true : null, time: now() };
    } catch { likedCache = { id: trackId, value: null, time: now() }; }
    return likedCache.value;
  }
  async function readPlayer() {
    const data = await api('/me/player?additional_types=episode');
    const fetchedAt = now();
    if (!data || !data.device) return { active: false, fetchedAt, libraryAccess: libraryAccess() };
    const track = await withArtwork(trackSummary(data.item));
    const disallows = data.actions?.disallows || {};
    return { active: true, fetchedAt, isPlaying: data.is_playing === true,
      progressMs: Number.isFinite(data.progress_ms) ? data.progress_ms : 0,
      shuffle: data.shuffle_state === true, repeat: REPEAT.has(data.repeat_state) ? data.repeat_state : 'off',
      device: deviceSummary(data.device), track,
      context: CONTEXT_URI.test(data.context?.uri || '') ? { uri: data.context.uri, type: text(data.context.type, 20) } : null,
      liked: track?.type === 'track' ? await liked(track.id) : null, libraryAccess: libraryAccess(),
      can: { seek: !disallows.seeking, shuffle: !disallows.toggling_shuffle, repeat: !disallows.toggling_repeat_context,
        next: !disallows.skipping_next, previous: !disallows.skipping_prev } };
  }
  // Spotify's public oEmbed endpoint names Spotify-made playlists (Daily Mix,
  // editorial lists) that the Web API hides from Development Mode apps.
  // Returns { value, lasting }: lasting is false when the lookup failed for a
  // reason worth retrying soon (offline, rate limited, server error).
  async function embedInfo(uri) {
    const saved = embeds.get(uri);
    if (saved && now() - saved.at < saved.ttl) return saved;
    const [, type, id] = uri.split(':');
    let value = null, ttl = 60000;
    try {
      const page = `https://open.spotify.com/${type}/${id}`;
      const response = await fetchImpl(`https://open.spotify.com/oembed?url=${encodeURIComponent(page)}`, { redirect: 'error', signal: AbortSignal.timeout(8000) });
      const length = Number(response.headers.get('content-length'));
      if (response.status === 400 || response.status === 404) ttl = 21600000;  // definitely not public
      else if (response.ok && /json/i.test(response.headers.get('content-type') || '') && !(length > 65536)) {
        const data = JSON.parse(await response.text());
        if (typeof data?.title === 'string' && data.title.trim()) { value = { name: text(data.title), imageUrl: artworkUrl(data.thumbnail_url) }; ttl = 21600000; }
      }
    } catch { /* The tile keeps a generic name until the next try. */ }
    const entry = { at: now(), ttl, value, lasting: ttl > 60000 };
    embeds.delete(uri); embeds.set(uri, entry);
    while (embeds.size > 200) embeds.delete(embeds.keys().next().value);
    return entry;
  }
  // Recently played songs grouped by what they were played from, newest first.
  // Failures other than "hidden from this app" (403/404) go to errors, so a
  // degraded feed is shown but not cached.
  async function recentContexts(data, errors) {
    const seen = new Set(), picks = [];
    for (const row of listOf(data?.items)) {
      const track = row?.track, context = row?.context?.uri || '';
      const uri = ITEM_CONTEXT_URI.test(context) && !context.startsWith('spotify:show:') ? context : TRACK_URI.test(track?.uri || '') ? track.uri : null;
      if (!uri || seen.has(uri)) continue;
      seen.add(uri); picks.push({ uri, type: uri.split(':')[1], track });
      if (picks.length >= 8) break;
    }
    return inTurns(picks, 2, async ({ uri, type, track }) => {
      const albumImage = bestImage(track?.album?.images, 160);
      if (type === 'album') { const by = names(track?.album?.artists || track?.artists); return { uri, type, name: text(track?.album?.name || 'Album'), subtitle: by, by, imageUrl: albumImage }; }
      if (type === 'track' || type === 'episode') { const by = names(track?.artists); return { uri, type: 'track', name: text(track?.name || 'Song'), subtitle: by, by, imageUrl: albumImage }; }
      const id = uri.split(':')[2];
      const details = await api(type === 'artist' ? `/artists/${id}` : `/playlists/${id}?fields=name,images,owner(display_name)`)
        .catch(error => { if (error.status !== 403 && error.status !== 404) errors.push(error); return null; });
      const embed = details?.name ? null : await embedInfo(uri);
      if (embed && !embed.lasting) errors.push(new Error('Spotify could not name every playlist right now.'));
      const owner = details?.owner?.display_name ? text(details.owner.display_name) : '';
      return { uri, type, name: text(details?.name || embed?.value?.name || (type === 'artist' ? track?.artists?.[0]?.name || 'Artist' : 'Playlist')),
        subtitle: type === 'artist' ? 'Artist' : owner ? text(`Playlist · ${owner}`) : 'Playlist', by: owner,
        imageUrl: bestImage(details?.images, 160) || embed?.value?.imageUrl || albumImage };
    });
  }
  // A Spotify home-style feed from what Development Mode apps may still read:
  // recently played, top artists and saved albums. Sections without permission
  // are listed in 'missing'. The feed is read a few calls at a time, and a feed
  // with a failed part keeps that part's last copy and is held for three minutes
  // (in memory only), so the widgets showing it do not ask again and again, which
  // is what got the app limited.
  async function loadHome(key) {
    const epoch = cacheEpoch; const scopes = new Set(grantedScopes.split(/\s+/)); const allowed = scope => scopes.has(scope);
    const result = { recent: null, artists: null, albums: null, liked: null, following: null, missing: [] };
    const errors = [];
    const read = (scope, route) => allowed(scope) ? api(route).catch(error => { errors.push(error); return null; }) : null;
    const [played, top, saved] = await Promise.all([
      read('user-read-recently-played', '/me/player/recently-played?limit=50'),
      read('user-top-read', '/me/top/artists?limit=10&time_range=short_term'),
      read('user-library-read', '/me/albums?limit=50'),
    ]);
    const [likedPage, profile, followed] = await Promise.all([
      read('user-library-read', '/me/tracks?limit=1'),
      allowed('user-library-read') ? api('/me').catch(() => null) : null,
      read('user-follow-read', '/me/following?type=artist&limit=50'),
    ]);
    // Liked Songs, as at the top of Spotify's library.
    if (likedPage && typeof profile?.id === 'string' && /^[A-Za-z0-9._-]{1,64}$/.test(profile.id)) {
      const total = Number.isInteger(likedPage.total) ? likedPage.total : null;
      result.liked = { uri: `spotify:user:${profile.id}:collection`, type: 'collection', name: 'Liked Songs', subtitle: total === null ? 'Playlist' : `Playlist · ${total} ${total === 1 ? 'song' : 'songs'}`, totalTracks: total };
    }
    // Artists you follow (needs the follow permission; older sign-ins lack it).
    if (!allowed('user-follow-read')) result.missing.push('following');
    else if (followed) result.following = listOf(followed.artists?.items).filter(artist => ARTIST_URI.test(artist?.uri || '')).slice(0, 50)
      .map(artist => ({ uri: artist.uri, type: 'artist', name: text(artist.name), subtitle: 'Artist', imageUrl: bestImage(artist.images, 160) }));
    if (!allowed('user-read-recently-played')) result.missing.push('recent'); else if (played) result.recent = await recentContexts(played, errors);
    if (!allowed('user-top-read')) result.missing.push('artists');
    else if (top) result.artists = listOf(top.items).filter(artist => ARTIST_URI.test(artist?.uri || '')).slice(0, 10)
      .map(artist => ({ uri: artist.uri, type: 'artist', name: text(artist.name), subtitle: 'Artist', imageUrl: bestImage(artist.images, 160) }));
    if (!allowed('user-library-read')) result.missing.push('albums');
    else if (saved) result.albums = listOf(saved.items).map(row => row?.album).filter(album => ALBUM_URI.test(album?.uri || '')).slice(0, 50)
      .map(album => ({ uri: album.uri, type: 'album', name: text(album.name), subtitle: names(album.artists), by: names(album.artists), imageUrl: bestImage(album.images, 160) }));
    if (errors.length && !result.recent && !result.artists && !result.albums) throw errors[0];
    // A part Spotify did not answer keeps its last copy.
    if (errors.length && homeCache.value && homeCache.key === key) {
      for (const list of [...HOME_LISTS, 'liked']) if (result[list] === null && !result.missing.includes(list) && homeCache.value[list]) result[list] = homeCache.value[list];
    }
    const all = [...(result.recent || []), ...(result.artists || []), ...(result.albums || []), ...(result.following || [])];
    await inTurns(all, 4, async item => { if (!item.artwork) item.artwork = await covers.load(item.imageUrl); });
    if (epoch === cacheEpoch) { homeCache = { key, at: now(), value: result, ttl: errors.length ? 180000 : 600000 }; if (!errors.length) persist(); }
    return result;
  }
  function activeDevice(player) {
    if (!player?.active || !player.device?.id) throw new Error('Open Spotify and start a track on the device you want to use.');
    if (player.device.restricted) throw new Error('The active Spotify device does not allow remote playback control.');
    return player.device.id;
  }
  const settle = () => new Promise(resolve => setTimeout(resolve, 350));

  function cancelAuthorization() {
    const pending = authorization;
    authorization = null;
    if (!pending) return;
    clearTimeout(pending.timeout);
    pending.server.close();
    pending.server.closeIdleConnections();
  }

  return {
    async getState({ refresh = false } = {}) {
      const current = await configuration();
      if (!closed && CLIENT_ID.test(current.clientId) && current.tokens && !authorization) await loadLibrary(refresh);
      return snapshot();
    },
    async authenticate() {
      checkOpen();
      if (authorization) return snapshot();
      if (authenticateFlight) return authenticateFlight;
      // Reserve the generation before the first await so repeated taps share
      // one listener and disconnect/close can cancel initialization as well.
      const expectedGeneration = ++generation;
      const flight = (async () => {
      const { clientId } = await configuration();
      if (!CLIENT_ID.test(clientId)) throw new Error('Save the 32-character Spotify Client ID in Music settings first.');
      await unchanged(clientId, expectedGeneration);
      const state = randomBytes(32).toString('base64url');
      const verifier = randomBytes(48).toString('base64url');
      const challenge = createHash('sha256').update(verifier).digest('base64url');
      const pending = { state, verifier, clientId, server: null, timeout: null, consumed: false, redirectUri: '' };
      const server = http.createServer({ maxHeaderSize: 8192 }, (request, response) => {
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.setHeader('Cache-Control', 'no-store');
        response.setHeader('Referrer-Policy', 'no-referrer');
        response.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
        const finish = (status, title, detail) => {
          response.writeHead(status);
          response.end(`<!doctype html><meta charset="utf-8"><title>Edge Deck · Spotify</title><h1>${title}</h1><p>${detail}</p>`);
        };
        (async () => {
          let url;
          try { url = new URL(request.url, pending.redirectUri); } catch { finish(400, 'Invalid request', 'Return to Edge Deck and connect again.'); return; }
          if (request.method !== 'GET' || url.pathname !== '/callback' || request.headers.host !== new URL(pending.redirectUri).host) {
            finish(404, 'Not found', 'Return to Edge Deck.'); return;
          }
          if (authorization !== pending || pending.consumed || !equalSecret(url.searchParams.get('state'), state)) {
            finish(403, 'Sign-in could not be verified', 'Return to Edge Deck and connect again.'); return;
          }
          pending.consumed = true;
          if (url.searchParams.has('error')) {
            lastError = 'Spotify sign-in was cancelled or denied.';
            finish(400, 'Spotify was not connected', 'You can close this window and try again from Edge Deck.');
            cancelAuthorization(); return;
          }
          const code = url.searchParams.get('code');
          if (!code || code.length > 4096) throw new Error('Spotify did not return a valid authorization code. Connect again.');
          await unchanged(clientId, expectedGeneration);
          const tokenResponse = await fetchSpotify(TOKEN_URL, { method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: clientId,
              redirect_uri: pending.redirectUri, code_verifier: verifier }).toString() });
          await storeTokenResponse(tokenResponse, clientId, null, expectedGeneration, true);
          // A new sign-in may be another account: nothing cached for the old one is kept.
          library = []; libraryLoaded = false; libraryAttempt = 0; hasMore = false; clearCaches();
          lastError = null; message = 'Spotify is connected. Your playlists will appear in Edge Deck.';
          finish(200, 'Spotify connected', 'You can close this window and return to Edge Deck.');
          cancelAuthorization();
        })().catch(error => {
          lastError = error.message;
          if (!response.writableEnded) finish(400, 'Spotify could not connect', 'Return to Edge Deck for details and try again.');
          cancelAuthorization();
        });
      });
      pending.server = server;
      server.requestTimeout = 10000; server.headersTimeout = 5000;
      try {
        await new Promise((resolve, reject) => {
          server.once('error', reject);
          server.listen(43821, '127.0.0.1', () => { server.off('error', reject); resolve(); });
        });
        await unchanged(clientId, expectedGeneration);
        pending.redirectUri = `http://127.0.0.1:${server.address().port}/callback`;
        authorization = pending;
        pending.timeout = setTimeout(() => {
          if (authorization === pending) { lastError = 'Spotify sign-in timed out. Connect again.'; cancelAuthorization(); }
        }, 300000);
        pending.timeout.unref(); server.unref();
        const url = new URL('https://accounts.spotify.com/authorize');
        url.search = new URLSearchParams({ client_id: clientId, response_type: 'code', redirect_uri: pending.redirectUri,
          scope: [...SCOPES, ...OPTIONAL_SCOPES].join(' '), state, code_challenge_method: 'S256', code_challenge: challenge }).toString();
        lastError = null;
        await openExternal(url.href);
        return snapshot();
      } catch {
        if (authorization === pending) cancelAuthorization(); else server.close();
        throw new Error('Spotify sign-in could not open. Check your default browser and try again.');
      }
      })();
      authenticateFlight = flight;
      try { return await flight; }
      finally { if (authenticateFlight === flight) authenticateFlight = null; }
    },
    async playPlaylist(uri) {
      checkOpen();
      if (typeof uri !== 'string' || !(CONTEXT_URI.test(uri) || TRACK_URI.test(uri))) throw new Error('Choose a valid Spotify playlist, album, artist or song.');
      const current = await api('/me/player');
      const device = current?.device;
      if (!device || !device.id || device.is_active !== true) {
        throw new Error('Open Spotify and start a track on the device you want to use, then try again.');
      }
      if (device.is_restricted) throw new Error('The active Spotify device does not allow remote playback control.');
      await api(`/me/player/play?device_id=${encodeURIComponent(device.id)}`, { method: 'PUT', body: JSON.stringify(TRACK_URI.test(uri) ? { uris: [uri] } : { context_uri: uri }) });
      lastError = null;
      const deviceName = String(device.name || 'your active Spotify device').slice(0, 120);
      message = `Playback request sent to ${deviceName}.`;
      return { requested: true, deviceName, playlistUri: uri };
    },
    async getPlayer() {
      checkOpen();
      const { clientId, tokens } = await configuration();
      if (!CLIENT_ID.test(clientId) || !tokens || authorization) return null;
      return readPlayer();
    },
    async playerCommand(action, value) {
      checkOpen();
      const player = await readPlayer();
      if (action === 'transfer') {
        if (typeof value !== 'string' || !DEVICE_ID.test(value)) throw new Error('Choose a Spotify device.');
        await api('/me/player', { method: 'PUT', body: JSON.stringify({ device_ids: [value], play: player.active ? player.isPlaying : true }) });
      } else if (action === 'like') {
        if (typeof value !== 'boolean') throw new Error('Choose whether to like this song.');
        if (!libraryAccess()) throw new Error('Reconnect Spotify in Music settings to use Liked Songs.');
        const id = player.track?.type === 'track' ? player.track.id : null;
        if (!id) throw new Error('Only songs can be added to Liked Songs.');
        await api(`/me/library?uris=${encodeURIComponent(`spotify:track:${id}`)}`, { method: value ? 'PUT' : 'DELETE' });
        likedCache = { id, value, time: now() };
      } else if (action === 'play-item') {
        const contextUri = value?.contextUri, trackUri = value?.trackUri;
        if (contextUri !== undefined && (typeof contextUri !== 'string' || !CONTEXT_URI.test(contextUri))) throw new Error('Choose a valid playlist or album.');
        if (typeof trackUri !== 'string' || !TRACK_URI.test(trackUri)) throw new Error('Choose a valid song.');
        const device = activeDevice(player);
        const body = contextUri ? { context_uri: contextUri, offset: { uri: trackUri } } : { uris: [trackUri] };
        await api(`/me/player/play?device_id=${encodeURIComponent(device)}`, { method: 'PUT', body: JSON.stringify(body) });
      } else {
        const device = encodeURIComponent(activeDevice(player));
        if (action === 'play-pause') await api(`/me/player/${player.isPlaying ? 'pause' : 'play'}?device_id=${device}`, { method: 'PUT' });
        else if (action === 'next' || action === 'previous') {
          if (!player.can[action]) throw new Error(action === 'next' ? 'Skipping is not available right now.' : 'Going back is not available right now.');
          await api(`/me/player/${action}?device_id=${device}`, { method: 'POST' });
        } else if (action === 'seek') {
          const limit = player.track?.durationMs ?? 0;
          if (!Number.isInteger(value) || value < 0 || value > limit) throw new Error('Choose a position within this song.');
          await api(`/me/player/seek?position_ms=${value}&device_id=${device}`, { method: 'PUT' });
        } else if (action === 'shuffle') {
          if (typeof value !== 'boolean') throw new Error('Choose whether to shuffle.');
          await api(`/me/player/shuffle?state=${value}&device_id=${device}`, { method: 'PUT' });
        } else if (action === 'repeat') {
          if (!REPEAT.has(value)) throw new Error('Choose a repeat mode.');
          await api(`/me/player/repeat?state=${value}&device_id=${device}`, { method: 'PUT' });
        } else if (action === 'volume') {
          if (!Number.isInteger(value) || value < 0 || value > 100) throw new Error('Volume must be between 0 and 100.');
          if (!player.device.supportsVolume) throw new Error(`${player.device.name} does not allow volume changes from Spotify.`);
          await api(`/me/player/volume?volume_percent=${value}&device_id=${device}`, { method: 'PUT' });
        } else throw new Error('Unknown Spotify player action.');
      }
      // Spotify applies commands asynchronously; read back the settled state.
      await settle();
      return readPlayer();
    },
    async devices() {
      checkOpen();
      const data = await api('/me/player/devices');
      return (Array.isArray(data?.devices) ? data.devices : []).slice(0, 20).map(deviceSummary).filter(device => device?.id);
    },
    async queue() {
      checkOpen();
      const data = await api('/me/player/queue');
      const items = (Array.isArray(data?.queue) ? data.queue : []).slice(0, 20).map(trackSummary).filter(Boolean);
      const unique = items.filter((item, index) => items.findIndex(other => other.uri === item.uri) === index);
      return { current: await withArtwork(trackSummary(data?.currently_playing), 'thumbUrl'),
        items: await Promise.all(unique.map(item => withArtwork(item, 'thumbUrl'))) };
    },
    async playlistTracks(uri) {
      checkOpen();
      if (typeof uri !== 'string' || !PLAYLIST_URI.test(uri)) throw new Error('Choose a valid Spotify playlist.');
      const id = uri.split(':')[2];
      let page;
      try { page = await api(`/playlists/${id}/items?limit=50`); }
      catch (error) {
        // Spotify lists songs only for playlists you own or collaborate on;
        // the web player sign-in (Canvas) can still read the others.
        if ((error.status === 403 || error.status === 404) && webApi) {
          try { page = await webApi(`/playlists/${id}/tracks?limit=50`); } catch { page = null; }
        }
        if (!page && (error.status === 403 || error.status === 404)) return { uri, items: [], total: null, restricted: true };
        if (!page) throw error;
      }
      const rows = (Array.isArray(page?.items) ? page.items : []).map(row => trackSummary(row?.item || row?.track)).filter(Boolean).slice(0, 50);
      const items = await Promise.all(rows.map((item, index) => index < 24 ? withArtwork(item, 'thumbUrl') : item));
      return { uri, items, total: Number.isInteger(page?.total) ? page.total : items.length };
    },
    async likedTracks() {
      checkOpen();
      if (!libraryAccess()) throw new Error('Reconnect Spotify in Music settings to use Liked Songs.');
      const [page, profile] = await Promise.all([api('/me/tracks?limit=50'), api('/me')]);
      const uri = `spotify:user:${profile?.id}:collection`;
      if (!COLLECTION_URI.test(uri)) throw new Error('Spotify did not return your account.');
      const rows = listOf(page?.items).map(row => trackSummary(row?.track)).filter(Boolean).slice(0, 50);
      const items = await Promise.all(rows.map((item, index) => index < 24 ? withArtwork(item, 'thumbUrl') : item));
      return { uri, items, total: Number.isInteger(page?.total) ? page.total : items.length };
    },
    async albumTracks(uri) {
      checkOpen();
      if (typeof uri !== 'string' || !ALBUM_URI.test(uri)) throw new Error('Choose a valid Spotify album.');
      let page;
      try { page = await api(`/albums/${uri.split(':')[2]}/tracks?limit=50`); }
      catch (error) {
        if (error.status === 403 || error.status === 404) return { uri, items: [], total: null, restricted: true };
        throw error;
      }
      const items = listOf(page?.items).map(trackSummary).filter(Boolean).slice(0, 50);
      return { uri, items, total: Number.isInteger(page?.total) ? page.total : items.length };
    },
    async home(force = false) {
      checkOpen();
      const { clientId, tokens } = await configuration();
      if (!CLIENT_ID.test(clientId) || !tokens) throw new Error('Connect Spotify in Library first.');
      const key = `${clientId}|${grantedScopes}`;
      // Home is kept for ten minutes (also across restarts), three when a part failed; during a Spotify wait the saved copy is used.
      if (homeCache.value && homeCache.key === key && (now() < retryAt || (!force && now() - homeCache.at < (homeCache.ttl || 600000)))) return homeCache.value;
      if (force) for (const [uri, entry] of embeds) if (!entry.value) embeds.delete(uri);
      if (homeFlight?.key === key) return homeFlight.promise;
      const promise = loadHome(key).finally(() => { if (homeFlight?.promise === promise) homeFlight = null; });
      homeFlight = { key, promise };
      return promise;
    },
    // Playlists, albums and artists across Spotify (at most 10 per type).
    async search(query) {
      checkOpen();
      if (typeof query !== 'string') throw new Error('Enter something to search for.');
      const term = text(query, 200).trim().slice(0, 80);
      if (term.length < 2) return { query: term, items: [] };
      const key = term.toLocaleLowerCase();
      const saved = searches.get(key);
      if (saved && now() - saved.at < 600000) return saved.value;
      const data = await api(`/search?q=${encodeURIComponent(term)}&type=playlist,album,artist&limit=6`);
      const items = [];
      for (const list of listOf(data?.playlists?.items)) if (PLAYLIST_URI.test(list?.uri || '')) {
        const owner = list.owner?.display_name ? text(list.owner.display_name) : '';
        items.push({ uri: list.uri, type: 'playlist', name: text(list.name), subtitle: owner ? text(`Playlist · ${owner}`) : 'Playlist', by: owner, imageUrl: bestImage(list.images, 160) });
      }
      for (const album of listOf(data?.albums?.items)) if (ALBUM_URI.test(album?.uri || '')) {
        const by = names(album.artists);
        items.push({ uri: album.uri, type: 'album', name: text(album.name), subtitle: by ? text(`Album · ${by}`) : 'Album', by, imageUrl: bestImage(album.images, 160) });
      }
      for (const artist of listOf(data?.artists?.items)) if (ARTIST_URI.test(artist?.uri || '')) items.push({ uri: artist.uri, type: 'artist', name: text(artist.name), subtitle: 'Artist', imageUrl: bestImage(artist.images, 160) });
      await Promise.all(items.map(async item => { item.artwork = await covers.load(item.imageUrl); }));
      const value = { query: term, items };
      searches.delete(key); searches.set(key, { at: now(), value });
      while (searches.size > 30) searches.delete(searches.keys().next().value);
      return value;
    },
    async disconnect() {
      generation++; cancelAuthorization();
      await saveTokens(null);
      library = []; libraryLoaded = false; libraryAttempt = 0; hasMore = false;
      clearCaches();
      lastError = null; message = ''; retryAt = 0;
      return snapshot();
    },
    close() { closed = true; generation++; clearCaches(); cancelAuthorization(); },
  };
}

module.exports = { createSpotifyBridge, REDIRECT_URI, SCOPES, OPTIONAL_SCOPES };
