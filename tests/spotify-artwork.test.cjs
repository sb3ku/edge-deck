'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createArtworkCache,artworkUrl}=require('../lib/spotify-artwork.cjs');
test('covers come only from Spotify image CDNs over HTTPS, without token headers, and valid images are cached',async()=>{
  let calls=0;
  const cache=createArtworkCache({fetchImpl:async(url,options)=>{calls++;assert.equal(options.redirect,'error');assert.equal(options.headers,undefined);return new Response(Buffer.from([255,216,255,1,2]),{headers:{'content-type':'image/jpeg'}});}});
  assert.equal(await cache.load('https://i.scdn.co/image/test'),'data:image/jpeg;base64,/9j/AQI=');
  await cache.load('https://i.scdn.co/image/test');assert.equal(calls,1);
  cache.clear();await cache.load('https://i.scdn.co/image/test');assert.equal(calls,2);
  // Spotify-made mixes (Discover Weekly, Daily Mix) use other subdomains of the same CDNs.
  for(const value of ['https://pickasso.spotifycdn.com/image/ab67c0de0000deef/dt/v1/img/dw/cover/en','https://dailymix-images.scdn.co/v2/img/x','https://mosaic.scdn.co/640/x'])assert.equal(artworkUrl(value),value);
});
test('untrusted, credential-bearing or non-HTTPS cover URLs never fetch',async()=>{
  const cache=createArtworkCache({fetchImpl:()=>{throw Error('Unexpected fetch');}});
  for(const value of ['http://i.scdn.co/a','https://i.scdn.co.evil/a','https://evilscdn.co/a','https://scdn.co/a','https://spotifycdn.com.evil.example/a','https://i.scdn.co:8443/a','https://user:secret@i.scdn.co/a','https://127.0.0.1/a','file:///a',null]){assert.equal(artworkUrl(value),null);assert.equal(await cache.load(value),null);}
});
test('bad MIME, invalid signatures and oversized chunked images fall back without a cover',async()=>{
  for(const response of [new Response('html',{headers:{'content-type':'text/html'}}),new Response('html',{headers:{'content-type':'image/png'}}),new Response(Buffer.alloc(200001),{headers:{'content-type':'image/jpeg'}})]){
    const cache=createArtworkCache({fetchImpl:async()=>response});assert.equal(await cache.load('https://i.scdn.co/image/test'),null);
  }
});
