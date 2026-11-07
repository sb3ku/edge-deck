'use strict';
// Finds an icon for each saved app in the dock. First choice is a clean,
// single-colour vector icon from open icon sets via the Iconify API (Simple
// Icons, Remix Icon, Material Design Icons…), matched from the app's name,
// website or program and cached on disk. Without a match it falls back to the
// app's own Windows icon or the website's declared icon, which the dashboard
// redraws in white. Results are image data URLs.
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

const IMAGE_TYPES = new Set(['image/png', 'image/svg+xml', 'image/x-icon', 'image/vnd.microsoft.icon', 'image/jpeg', 'image/webp', 'image/gif']);
const PAGE_LIMIT = 1500000;
const ICON_LIMIT = 400000;
const SVG_LIMIT = 64000;
const ICONIFY = 'https://api.iconify.design';
// Preferred sets, best first: brand-accurate Simple Icons, then broad sets.
const ICON_SETS = ['simple-icons', 'ri', 'mdi', 'cib', 'fa6-brands'];
const ICON_ID = /^(?:simple-icons|ri|mdi|cib|fa6-brands):[a-z0-9]+(?:-[a-z0-9]+)*$/;
// Program and product names whose icon is published under another name.
const ALIASES = { chatgpt: 'openai', code: 'visual studio code', vscode: 'visual studio code', msedge: 'microsoft edge', edge: 'microsoft edge',
  chrome: 'google chrome', winword: 'microsoft word', excel: 'microsoft excel', powerpnt: 'microsoft powerpoint', outlook: 'microsoft outlook',
  teams: 'microsoft teams', 'ms teams': 'microsoft teams', devenv: 'visual studio', obs64: 'obs studio', epicgameslauncher: 'epic games',
  leagueclient: 'league of legends', riotclientservices: 'riot games', 'battle net': 'battle.net', explorer: 'files' };
// Launchers and runtimes whose name says nothing about the app they start.
const HOST_PROGRAMS = new Set(['update', 'squirrel', 'powershell', 'pwsh', 'cmd', 'wscript', 'cscript', 'conhost', 'rundll32', 'msiexec', 'java', 'javaw', 'python', 'pythonw', 'node', 'electron']);
const POSITIVE_TTL = 90 * 86400000;
const NEGATIVE_TTL = 7 * 86400000;

function registryCommand(protocol) {
  return new Promise(resolve => {
    if (process.platform !== 'win32' || !/^[a-z][a-z0-9+.-]{0,30}$/.test(protocol)) { resolve(null); return; }
    execFile('reg.exe', ['query', `HKCR\\${protocol}\\shell\\open\\command`, '/ve'], { windowsHide: true, timeout: 4000 }, (error, stdout) => {
      resolve(error ? null : (/REG_(?:EXPAND_)?SZ\s+(.+)$/m.exec(String(stdout))?.[1].trim() || null));
    });
  });
}
function executableFrom(command) {
  if (typeof command !== 'string') return null;
  const quoted = /^"([^"]+\.exe)"/i.exec(command)?.[1] || /^(\S+\.exe)\b/i.exec(command)?.[1];
  return quoted ? quoted.replace(/%([^%]+)%/g, (match, name) => process.env[name] ?? match) : null;
}
// Pick icon <link> candidates from a page: a single-colour Safari pinned-tab
// icon is ideal for a white glyph, then SVG, then the largest raster.
function iconLinks(html, base) {
  const found = [];
  for (const [tag] of String(html).slice(0, PAGE_LIMIT).matchAll(/<link\b[^>]*>/gi)) {
    const rel = /\brel\s*=\s*["']?([^"'>]+)/i.exec(tag)?.[1]?.toLowerCase() || '';
    if (!/\bicon\b|mask-icon/.test(rel)) continue;
    const href = /\bhref\s*=\s*["']?([^"'\s>]+)/i.exec(tag)?.[1];
    if (!href) continue;
    let url; try { url = new URL(href.replace(/&amp;/g, '&'), base); } catch { continue; }
    if (url.protocol !== 'https:') continue;
    const sizes = /\bsizes\s*=\s*["']?([^"'>]+)/i.exec(tag)?.[1] || '';
    const size = Math.max(0, ...sizes.split(/\s+/).map(value => parseInt(value, 10) || 0));
    const svg = /\.svg(?:[?#]|$)/i.test(url.pathname) || /image\/svg/i.test(tag);
    found.push({ href: url.href, score: (rel.includes('mask-icon') ? 3000 : 0) + (svg ? 1000 : 0) + Math.min(size, 512) });
  }
  return found.sort((a, b) => b.score - a.score);
}
// Words that may name an app's icon: its saved name, website and program.
function iconTerms({ name = '', target = '', program = '' } = {}) {
  const terms = [];
  const add = value => {
    const term = String(value || '').toLowerCase().replace(/\.(?:exe|lnk)$/, '').replace(/[^a-z0-9.]+/g, ' ').trim();
    if (!term || term.length > 40) return;
    for (const candidate of [ALIASES[term], term]) if (candidate && !terms.includes(candidate)) terms.push(candidate);
  };
  add(name);
  if (/^https:/i.test(target)) { try { const labels = new URL(target).hostname.replace(/^www\./, '').split('.'); add(labels.length > 1 ? labels.at(-2) : labels[0]); } catch { /* not a URL */ } }
  else if (/^[a-z][a-z0-9+.-]*:$/i.test(target)) add(target.slice(0, -1));
  else add(path.win32.basename(String(target)));
  const programName = path.win32.basename(String(program)).toLowerCase().replace(/\.(?:exe|lnk)$/, '');
  if (!HOST_PROGRAMS.has(programName)) add(path.win32.basename(String(program)));
  return terms.slice(0, 5);
}
// How well an icon id names a term: exact names win, a "-fill" variant next,
// and Simple Icons breaks ties because it follows the brands' own marks.
function matchScore(id, term) {
  const [prefix, name] = id.split(':');
  const compact = term.replace(/[^a-z0-9]/g, ''), dashed = term.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const base = name.replace(/-(?:fill|line|outline|circle|square|alt)$/, '');
  let value;
  if (name === compact || name === dashed) value = 100;
  else if (base === compact || base === dashed) value = name.endsWith('-fill') ? 96 : /-(?:line|outline)$/.test(name) ? 80 : 90;
  else return 0;
  return value + (ICON_SETS.length - ICON_SETS.indexOf(prefix));
}

function createAppIcons({ getFileIcon, readShortcutLink, fetchImpl = globalThis.fetch, queryProtocol = registryCommand, cacheFile = null, now = Date.now }) {
  const memory = new Map();
  let disk = null;
  function readDisk() {
    if (disk) return disk;
    disk = {};
    if (cacheFile) { try { const saved = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); if (saved && typeof saved.entries === 'object') disk = saved.entries; } catch { /* start empty */ } }
    return disk;
  }
  function remember(key, entry) {
    const entries = readDisk(); entries[key] = { ...entry, savedAt: now() };
    if (!cacheFile) return;
    try {
      fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
      const temporary = cacheFile + '.tmp'; fs.writeFileSync(temporary, JSON.stringify({ version: 1, entries })); fs.renameSync(temporary, cacheFile);
    } catch { /* the cache is optional */ }
  }
  function cached(key, stale = false) {
    const entry = readDisk()[key];
    if (!entry || !Number.isFinite(entry.savedAt)) return undefined;
    return stale || now() - entry.savedAt < (entry.svg ? POSITIVE_TTL : NEGATIVE_TTL) ? entry : undefined;
  }
  async function download(url, limit, accept = 'text/html,image/*;q=0.9,*/*;q=0.5') {
    const response = await fetchImpl(url, { redirect: 'follow', credentials: 'omit', signal: AbortSignal.timeout(6000), headers: { Accept: accept } });
    if (!response.ok || !String(response.url || url).startsWith('https:')) throw new Error('Unavailable');
    const declared = Number(response.headers.get('content-length'));
    if (declared > limit) throw new Error('Too large');
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > limit) throw new Error('Too large');
    return { bytes, type: (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase(), url: response.url || url };
  }
  async function searchIds(query, limit = 32) {
    const url = `${ICONIFY}/search?query=${encodeURIComponent(query)}&prefixes=${ICON_SETS.join(',')}&limit=${limit}`;
    const result = JSON.parse((await download(url, 200000, 'application/json')).bytes.toString('utf8'));
    return (Array.isArray(result?.icons) ? result.icons : []).filter(id => typeof id === 'string' && ICON_ID.test(id));
  }
  async function svg(id) {
    if (!ICON_ID.test(id)) return null;
    const [prefix, name] = id.split(':');
    const file = await download(`${ICONIFY}/${prefix}/${name}.svg?color=%23ffffff&height=64`, SVG_LIMIT, 'image/svg+xml');
    const text = file.bytes.toString('utf8');
    // Rendered only as an image, but keep it to a plain, self-contained SVG.
    if (file.type !== 'image/svg+xml' || !/^\s*<svg[\s>]/i.test(text) || /<script|<foreignObject|\bon[a-z]+\s*=|(?:href|src)\s*=\s*["']\s*(?:https?:|\/\/|javascript:)/i.test(text)) return null;
    return `data:image/svg+xml;base64,${Buffer.from(text).toString('base64')}`;
  }
  async function bestIcon(details) {
    for (const term of iconTerms(details)) {
      let best = null, top = 0;
      for (const id of await searchIds(term)) { const value = matchScore(id, term); if (value > top) { top = value; best = id; } }
      if (best) { const image = await svg(best); if (image) return { id: best, image }; }
    }
    return null;
  }
  async function siteIcon(target) {
    const origin = new URL(target).origin;
    let candidates = [];
    try { const page = await download(`${origin}/`, PAGE_LIMIT); candidates = iconLinks(page.bytes.toString('utf8'), page.url); } catch { /* fall back to favicon.ico */ }
    candidates.push({ href: `${origin}/favicon.ico` });
    for (const candidate of candidates.slice(0, 6)) {
      try {
        const icon = await download(candidate.href, ICON_LIMIT);
        if (IMAGE_TYPES.has(icon.type) && icon.bytes.length) return `data:${icon.type};base64,${icon.bytes.toString('base64')}`;
      } catch { /* try the next candidate */ }
    }
    return null;
  }
  async function programFor(target) {
    if (/^[a-z][a-z0-9+.-]*:$/i.test(target)) return executableFrom(await queryProtocol(target.slice(0, -1).toLowerCase()));
    if (/\.lnk$/i.test(target)) { try { const link = readShortcutLink(target); return link?.target || link?.icon || target; } catch { return target; } }
    return /^https:/i.test(target) ? '' : target;
  }
  async function windowsIcon(target, program) {
    let file = program || target;
    if (/\.lnk$/i.test(target)) { try { const link = readShortcutLink(target); file = link?.icon || link?.target || target; } catch { /* the shortcut itself */ } }
    return file && !/^[a-z][a-z0-9+.-]*:$/i.test(file) ? getFileIcon(file) : null;
  }
  async function lookup(target, name, override) {
    let offline = false;
    if (override) {
      const key = `id:${override}`;
      const saved = cached(key);
      if (saved?.svg) return { image: saved.svg, monochrome: true, id: override };
      try { const image = await svg(override); if (image) { remember(key, { id: override, svg: image }); return { image, monochrome: true, id: override }; } }
      catch { offline = true; const old = cached(key, true); if (old?.svg) return { image: old.svg, monochrome: true, id: override }; }
    }
    const program = await programFor(target).catch(() => '');
    const key = `auto:${target}|${String(name || '').toLowerCase()}`;
    const saved = cached(key);
    if (saved?.svg) return { image: saved.svg, monochrome: true, id: saved.id };
    if (saved === undefined) {
      try {
        const found = await bestIcon({ name, target, program });
        remember(key, found ? { id: found.id, svg: found.image } : { id: null, svg: null });
        if (found) return { image: found.image, monochrome: true, id: found.id };
      } catch {
        // Offline: an expired icon, else the app's own icon; try again later.
        offline = true; const old = cached(key, true); if (old?.svg) return { image: old.svg, monochrome: true, id: old.id };
      }
    }
    const own = /^https:/i.test(target) ? await siteIcon(target) : await windowsIcon(target, program);
    if (own) return { image: own, monochrome: false, ...(offline ? { retry: true } : {}) };
    return offline ? { image: null, monochrome: false, retry: true } : null;
  }
  return {
    icon(target, { name = '', override = '' } = {}) {
      if (typeof target !== 'string') return Promise.resolve(null);
      const choice = typeof override === 'string' && ICON_ID.test(override) ? override : '';
      const key = JSON.stringify([target, name, choice]);
      if (!memory.has(key)) {
        const pending = lookup(target, name, choice).catch(() => null);
        memory.set(key, pending);
        pending.then(result => { if (result?.retry) setTimeout(() => { if (memory.get(key) === pending) memory.delete(key); }, 60000).unref?.(); });
      }
      return memory.get(key);
    },
    // Icon picker: matching icons, drawn white, for a typed name.
    async search(query) {
      const term = String(query || '').trim().slice(0, 60);
      if (term.length < 2) return [];
      const ids = (await searchIds(term, 48)).sort((a, b) => ICON_SETS.indexOf(a.split(':')[0]) - ICON_SETS.indexOf(b.split(':')[0])).slice(0, 18);
      const images = await Promise.all(ids.map(id => svg(id).catch(() => null)));
      return ids.map((id, index) => ({ id, image: images[index] })).filter(item => item.image);
    },
  };
}

module.exports = { createAppIcons, iconLinks, executableFrom, iconTerms, matchScore, ICON_ID };
