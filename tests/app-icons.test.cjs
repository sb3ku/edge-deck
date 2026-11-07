'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createAppIcons, iconLinks, executableFrom, iconTerms, matchScore } = require('../lib/app-icons.cjs');

const reply = (body, type, url, status = 200) => ({ ok: status < 400, status, url, headers: new Headers({ 'content-type': type }), arrayBuffer: async () => new TextEncoder().encode(body).buffer });
const WHITE = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#ffffff" d="M0 0h24v24H0z"/></svg>';
// Iconify fixture: search results by query and SVGs by icon id.
function iconify(index, extra = () => null) {
  const requested = [];
  const fetchImpl = async url => {
    requested.push(url);
    const parsed = new URL(url);
    if (parsed.hostname === 'api.iconify.design' && parsed.pathname === '/search') return reply(JSON.stringify({ icons: index[parsed.searchParams.get('query')] || [] }), 'application/json', url);
    if (parsed.hostname === 'api.iconify.design') return reply(index.svg?.[parsed.pathname] ?? WHITE, 'image/svg+xml; charset=utf-8', url);
    return extra(url) || reply('', 'text/plain', url, 404);
  };
  return { fetchImpl, requested };
}

test('website icons prefer a pinned-tab glyph, then SVG, then the largest raster', () => {
  const html = '<link rel="icon" href="/favicon-32.png" sizes="32x32"><link rel="apple-touch-icon" href="/touch.png" sizes="180x180"><link rel="icon" type="image/svg+xml" href="/icon.svg"><link rel="mask-icon" href="/pinned.svg"><link rel="icon" href="http://insecure.example/x.png"><link rel="stylesheet" href="/a.css">';
  assert.deepEqual(iconLinks(html, 'https://site.example/').map(item => item.href), ['https://site.example/pinned.svg', 'https://site.example/icon.svg', 'https://site.example/touch.png', 'https://site.example/favicon-32.png']);
});

test('icon names come from the app name, website and program, with known aliases', () => {
  assert.deepEqual(iconTerms({ name: 'ChatGPT', target: 'https://chatgpt.com/' }), ['openai', 'chatgpt']);
  assert.deepEqual(iconTerms({ name: 'Spotify', target: 'spotify:', program: 'C:\\S\\Spotify.exe' }), ['spotify']);
  assert.deepEqual(iconTerms({ name: 'Editor', target: 'C:\\Apps\\Code.exe' }), ['editor', 'visual studio code', 'code']);
});

test('exact brand icons win, filled variants next, Simple Icons breaks ties', () => {
  assert.ok(matchScore('simple-icons:spotify', 'spotify') > matchScore('mdi:spotify', 'spotify'));
  assert.ok(matchScore('ri:openai-fill', 'openai') > matchScore('ri:openai-line', 'openai'));
  assert.equal(matchScore('simple-icons:openaigym', 'openai'), 0);
  assert.ok(matchScore('mdi:microsoft-edge', 'microsoft edge') > 0);
});

test('dock icons are clean white vectors from Iconify and are cached on disk', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-deck-icons-')); t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const cacheFile = path.join(directory, 'app-icons.json');
  const { fetchImpl, requested } = iconify({ openai: ['simple-icons:openaigym', 'ri:openai-line', 'ri:openai-fill'], spotify: ['mdi:spotify', 'simple-icons:spotify'] });
  const icons = createAppIcons({ getFileIcon: async () => { throw new Error('No system icon expected'); }, readShortcutLink: () => null, queryProtocol: async () => null, fetchImpl, cacheFile });
  const chat = await icons.icon('https://chatgpt.com/', { name: 'ChatGPT' });
  assert.equal(chat.id, 'ri:openai-fill'); assert.equal(chat.monochrome, true); assert.match(chat.image, /^data:image\/svg\+xml;base64,/);
  assert.equal((await icons.icon('spotify:', { name: 'Spotify' })).id, 'simple-icons:spotify');
  assert.ok(requested.some(url => url.includes('/ri/openai-fill.svg') && url.includes('color=%23ffffff')));
  const offline = createAppIcons({ getFileIcon: async () => null, readShortcutLink: () => null, queryProtocol: async () => null, cacheFile, fetchImpl: async () => { throw new Error('offline'); } });
  assert.equal((await offline.icon('https://chatgpt.com/', { name: 'ChatGPT' })).id, 'ri:openai-fill', 'A restart reuses the saved icon without the network');
});

test('a chosen icon overrides the automatic match; unsafe SVG is refused', async () => {
  const { fetchImpl } = iconify({ svg: { '/mdi/robot.svg': WHITE, '/cib/evil.svg': '<svg onload="alert(1)"></svg>' } });
  const icons = createAppIcons({ getFileIcon: async () => null, readShortcutLink: () => null, queryProtocol: async () => null, fetchImpl });
  assert.equal((await icons.icon('https://chatgpt.com/', { name: 'ChatGPT', override: 'mdi:robot' })).id, 'mdi:robot');
  assert.equal(await icons.icon('https://x.example/', { name: 'X', override: 'cib:evil' }), null, 'Unsafe override falls back; nothing else matches here');
  assert.equal((await icons.icon('https://x.example/', { name: 'X', override: '../../etc' }) ), null);
});

test('without a match the app falls back to its own icon', async () => {
  const files = [];
  const { fetchImpl } = iconify({}, url => url === 'https://site.example/' ? reply('<link rel="icon" href="/fav.png">', 'text/html', url) : url.endsWith('/fav.png') ? reply('PNG', 'image/png', url) : null);
  const icons = createAppIcons({ getFileIcon: async file => { files.push(file); return 'data:image/png;base64,AA=='; },
    readShortcutLink: () => ({ target: 'C:\\Apps\\Tool.exe', icon: 'C:\\Apps\\tool.ico' }), queryProtocol: async name => name === 'spotify' ? '"C:\\S\\Spotify.exe" --protocol-uri="%1"' : null, fetchImpl });
  assert.deepEqual(await icons.icon('https://site.example/', { name: 'Site' }), { image: `data:image/png;base64,${Buffer.from('PNG').toString('base64')}`, monochrome: false });
  await icons.icon('spotify:', { name: 'Music' }); await icons.icon('C:\\Users\\Me\\Desktop\\Tool.lnk', { name: 'Tool' }); await icons.icon('C:\\Apps\\Other.exe', { name: 'Other' });
  assert.deepEqual(files, ['C:\\S\\Spotify.exe', 'C:\\Apps\\tool.ico', 'C:\\Apps\\Other.exe']);
  assert.equal(executableFrom('"C:\\Users\\Me\\AppData\\Roaming\\Spotify\\Spotify.exe" --protocol-uri="%1"'), 'C:\\Users\\Me\\AppData\\Roaming\\Spotify\\Spotify.exe');
});

test('icon picker search returns white icons, Simple Icons first', async () => {
  const { fetchImpl } = iconify({ spotify: ['mdi:spotify', 'simple-icons:spotify', 'not valid'] });
  const icons = createAppIcons({ getFileIcon: async () => null, readShortcutLink: () => null, fetchImpl });
  assert.deepEqual((await icons.search('spotify')).map(item => item.id), ['simple-icons:spotify', 'mdi:spotify']);
  assert.deepEqual(await icons.search('s'), []);
});
test('helper programs are not used as icon names', () => {
  assert.deepEqual(iconTerms({ name: 'Discord PTB', target: 'C:\\X\\Discord PTB.lnk', program: 'C:\\X\\DiscordPTB\\Update.exe' }), ['discord ptb']);
});

test('offline, an expired icon is still used and the lookup is retried later', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-deck-icons-')); t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const cacheFile = path.join(directory, 'app-icons.json');
  let clock = Date.parse('2026-01-01T00:00:00Z');
  const { fetchImpl } = iconify({ spotify: ['simple-icons:spotify'] });
  const online = createAppIcons({ getFileIcon: async () => null, readShortcutLink: () => null, queryProtocol: async () => null, fetchImpl, cacheFile, now: () => clock });
  await online.icon('spotify:', { name: 'Spotify' });
  clock += 200 * 86400000; // long past the 90-day refresh
  const offline = createAppIcons({ getFileIcon: async () => null, readShortcutLink: () => null, queryProtocol: async () => null, cacheFile, now: () => clock, fetchImpl: async () => { throw new Error('offline'); } });
  assert.equal((await offline.icon('spotify:', { name: 'Spotify' })).id, 'simple-icons:spotify');
  const nothing = createAppIcons({ getFileIcon: async () => null, readShortcutLink: () => null, queryProtocol: async () => null, fetchImpl: async () => { throw new Error('offline'); } });
  assert.deepEqual(await nothing.icon('C:\\Apps\\Tool.exe', { name: 'Tool' }), { image: null, monochrome: false, retry: true });
});
