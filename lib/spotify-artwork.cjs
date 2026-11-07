'use strict';

// Spotify's image CDNs: i.scdn.co and mosaic.scdn.co for covers, image-cdn-*.spotifycdn.com,
// and pickasso.spotifycdn.com or *-images.scdn.co for Spotify-made mixes.
const DOMAINS = ['.scdn.co', '.spotifycdn.com'];
const LIMIT = 200000;
function artworkUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && DOMAINS.some(domain => url.hostname.endsWith(domain)) && !url.username && !url.password && !url.port && value.length <= 2048 ? url.href : null;
  } catch { return null; }
}
function createArtworkCache({ fetchImpl = globalThis.fetch, now = Date.now, max = 64 } = {}) {
  const cache = new Map();
  let epoch = 0;
  async function load(value) {
    const url = artworkUrl(value);
    if (!url) return null;
    const previous = cache.get(url);
    if (previous && now() - previous.time < 1800000) return previous.value;
    const generation = epoch;
    let image = null;
    try {
      // CDN fetches never include account tokens and may not redirect elsewhere.
      const response = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(5000) });
      const type = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
      const length = Number(response.headers.get('content-length'));
      if (!response.ok || !['image/jpeg', 'image/png', 'image/webp'].includes(type) || length > LIMIT) throw Error('Invalid cover');
      const reader = response.body?.getReader();
      if (!reader) throw Error('Missing cover');
      const chunks = []; let size = 0;
      try {
        while (true) {
          const part = await reader.read(); if (part.done) break;
          size += part.value.byteLength;
          if (size > LIMIT) { await reader.cancel(); throw Error('Cover too large'); }
          chunks.push(Buffer.from(part.value));
        }
      } finally { reader.releaseLock(); }
      const bytes = Buffer.concat(chunks);
      const valid = type === 'image/jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
        : type === 'image/png' ? bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
          : bytes.toString('ascii',0,4) === 'RIFF' && bytes.toString('ascii',8,12) === 'WEBP';
      if (valid) image = `data:${type};base64,${bytes.toString('base64')}`;
    } catch { /* A missing cover never prevents browsing or playing a playlist. */ }
    if (epoch !== generation) return null;
    cache.delete(url); cache.set(url, { time: now(), value: image });
    while (cache.size > max) cache.delete(cache.keys().next().value);
    return image;
  }
  return { load, clear() { epoch++; cache.clear(); } };
}
module.exports = { createArtworkCache, artworkUrl };
