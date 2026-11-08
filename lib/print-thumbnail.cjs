'use strict';
// The picture of the model being printed. Bambu printers keep the sliced 3MF on
// their storage, reachable over implicit FTPS (port 990, user bblp, the LAN
// access code). A 3MF is a ZIP archive whose Metadata/plate_N.png is the plate
// preview Bambu Studio renders. Only the archive's directory and that one entry
// are read (FTP REST offsets), never the whole file, which can be tens of MB.
const tls = require('node:tls');
const net = require('node:net');
const zlib = require('node:zlib');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

const TIMEOUT = 30000;
const MAX_ENTRY = 4 * 1024 * 1024;
const MAX_DIRECTORY = 2 * 1024 * 1024;
const FOLDERS = ['/', '/cache', '/model'];

class Ftp {
  constructor(socket) {
    this.socket = socket; this.buffer = ''; this.waiting = []; this.replies = []; this.error = null;
    socket.setEncoding('utf8');
    socket.on('data', chunk => { this.buffer += chunk; this.parse(); });
    const fail = error => { this.error = error || Error('Connection closed.'); for (const wait of this.waiting.splice(0)) wait.reject(this.error); };
    socket.on('error', fail); socket.on('close', () => fail());
    socket.setTimeout(TIMEOUT, () => socket.destroy(Error('The printer stopped responding.')));
  }
  parse() {
    // A reply ends on a line "NNN text"; "NNN-text" opens a multi-line reply.
    for (;;) {
      const match = /^(\d{3}) [^\n]*\n/m.exec(this.buffer);
      if (!match) return;
      const end = match.index + match[0].length;
      const text = this.buffer.slice(0, end); this.buffer = this.buffer.slice(end);
      const reply = { code: Number(match[1]), text: text.trim() };
      const wait = this.waiting.shift();
      if (wait) wait.resolve(reply); else this.replies.push(reply);
    }
  }
  reply() {
    if (this.replies.length) return Promise.resolve(this.replies.shift());
    if (this.error) return Promise.reject(this.error);
    return new Promise((resolve, reject) => this.waiting.push({ resolve, reject }));
  }
  async send(command, expect) {
    this.socket.write(`${command}\r\n`);
    const reply = await this.reply();
    if (expect && !expect.includes(Math.floor(reply.code / 100))) throw Object.assign(Error(`The printer refused ${command.split(' ')[0]} (${reply.code}).`), { code: 'FTP_REPLY', reply: reply.code });
    return reply;
  }
}

function connectTls(options, connect) {
  return new Promise((resolve, reject) => {
    const socket = connect(options, () => { socket.off('error', reject); socket.setTimeout(0); resolve(socket); });
    socket.once('error', reject);
    socket.setTimeout(TIMEOUT, () => socket.destroy(Error('The printer did not answer.')));
  });
}

function passiveAddress(text) {
  const match = /(\d+),(\d+),(\d+),(\d+),(\d+),(\d+)/.exec(text);
  if (!match) throw Error('The printer sent an unreadable passive address.');
  return Number(match[5]) * 256 + Number(match[6]);
}

// One FTPS session to a printer: list folders and read byte ranges of a file.
// Some printers (the P1S) drop the whole connection when a download is stopped
// early; the session then logs in again for the next command.
async function openSession(config, { connect = tls.connect, address } = {}) {
  const tlsOptions = { host: address || config.host, servername: net.isIP(config.host) ? undefined : config.host, rejectUnauthorized: config.allowSelfSigned !== true };
  let control = null, ftp = null, logins = 0;
  async function login() {
    if (control && !ftp.error && !control.destroyed) return;
    if (++logins > 6) throw Error('The printer keeps closing the connection.');
    control = await connectTls({ ...tlsOptions, port: 990 }, connect);
    ftp = new Ftp(control);
    try {
      const greeting = await ftp.reply(); if (greeting.code !== 220) throw Error('The printer did not greet.');
      await ftp.send('USER bblp', [3]);
      await ftp.send(`PASS ${config.accessCode}`, [2]);
      await ftp.send('PBSZ 0', [2]); await ftp.send('PROT P', [2]); await ftp.send('TYPE I', [2]);
    } catch (error) { control.destroy(); throw error; }
  }
  async function send(command, expect) { await login(); return ftp.send(command, expect); }
  await login();

  // The data channel reuses the control channel's TLS session, as the printer
  // requires. vsftpd starts the data channel's TLS handshake only once the
  // command is sent, so the command goes out without waiting for the handshake.
  async function transfer(command, { offset = 0, limit = Infinity, onData } = {}) {
    await login();
    const port = passiveAddress((await ftp.send('PASV', [2])).text);
    if (offset) await ftp.send(`REST ${offset}`, [3]);
    const data = connect({ ...tlsOptions, port, session: control.getSession() });
    try {
      const chunks = []; let length = 0, done, failure = null, stopped = false;
      const finished = new Promise(resolve => { done = resolve; data.on('end', resolve); data.on('close', resolve); data.on('error', error => { failure = error; resolve(); }); });
      data.setTimeout(TIMEOUT, () => { failure = Error('The printer stopped sending.'); data.destroy(); });
      data.on('data', chunk => {
        if (stopped) return;
        if (onData) { length += chunk.length; if (onData(chunk) || length >= limit) { stopped = true; data.destroy(); done(); } return; }
        chunks.push(chunk); length += chunk.length; if (length >= limit) { stopped = true; data.destroy(); done(); }
      });
      await ftp.send(command, [1]);
      await finished;
      if (failure && !stopped) throw failure;
      // 226 when the file was sent whole; 426/451 (or a closed connection) when the read stopped early.
      try { await ftp.reply(); } catch (error) { if (!stopped) throw error; control.destroy(); }
      return Buffer.concat(chunks).subarray(0, Number.isFinite(limit) ? limit : undefined);
    } finally { data.destroy(); }
  }
  return {
    async list(folder) {
      try { return (await transfer(`NLST ${folder}`)).toString('utf8').split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(name => name.replace(/^.*\//, '')); }
      catch (error) { if (error.code === 'FTP_REPLY') return []; throw error; }
    },
    async size(file) { const reply = await send(`SIZE ${file}`, [2]); return Number(reply.text.split(' ')[1]); },
    read: (file, offset, length) => transfer(`RETR ${file}`, { offset, limit: length }),
    // The file from its start, handed over chunk by chunk until onData returns true.
    stream: (file, onData, limit) => transfer(`RETR ${file}`, { limit, onData }),
    close() { if (!control || control.destroyed) return; try { control.write('QUIT\r\n'); } catch {} control.end(); setTimeout(() => control.destroy(), 1000).unref(); },
  };
}

// The ZIP central directory: entry names, where each starts, and its sizes.
function zipEntries(tail, tailStart) {
  const end = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0) throw Error('The print file is not a 3MF archive.');
  let count = tail.readUInt16LE(end + 10), size = tail.readUInt32LE(end + 12), offset = tail.readUInt32LE(end + 16);
  // ZIP64: the real values sit in the ZIP64 end record.
  if (offset === 0xffffffff || size === 0xffffffff || count === 0xffff) {
    const locator = end - 20;
    if (locator < 0 || tail.readUInt32LE(locator) !== 0x07064b50) throw Error('The print file is an unsupported archive.');
    const record = Number(tail.readBigUInt64LE(locator + 8)) - tailStart;
    if (record < 0 || tail.readUInt32LE(record) !== 0x06064b50) throw Error('The print file is an unsupported archive.');
    count = Number(tail.readBigUInt64LE(record + 32)); size = Number(tail.readBigUInt64LE(record + 40)); offset = Number(tail.readBigUInt64LE(record + 48));
  }
  return { count, size, offset };
}
function parseDirectory(directory) {
  const entries = []; let at = 0;
  while (at + 46 <= directory.length && directory.readUInt32LE(at) === 0x02014b50) {
    const method = directory.readUInt16LE(at + 10);
    let compressed = directory.readUInt32LE(at + 20), size = directory.readUInt32LE(at + 24), local = directory.readUInt32LE(at + 42);
    const nameLength = directory.readUInt16LE(at + 28), extraLength = directory.readUInt16LE(at + 30), commentLength = directory.readUInt16LE(at + 32);
    const name = directory.toString('utf8', at + 46, at + 46 + nameLength);
    // ZIP64 extra field (id 1) holds whichever sizes did not fit.
    let extra = at + 46 + nameLength; const extraEnd = extra + extraLength;
    while (extra + 4 <= extraEnd) {
      const id = directory.readUInt16LE(extra), length = directory.readUInt16LE(extra + 2); let field = extra + 4;
      if (id === 1) {
        if (size === 0xffffffff) { size = Number(directory.readBigUInt64LE(field)); field += 8; }
        if (compressed === 0xffffffff) { compressed = Number(directory.readBigUInt64LE(field)); field += 8; }
        if (local === 0xffffffff) local = Number(directory.readBigUInt64LE(field));
      }
      extra += 4 + length;
    }
    entries.push({ name, method, compressed, size, local });
    at = extraEnd + commentLength;
  }
  return entries;
}
// The plate being printed (from its G-code path), else the first plate.
function pickPreview(entries, plate) {
  const pictures = entries.filter(entry => /^Metadata\/plate_\d+\.png$/i.test(entry.name));
  return pictures.find(entry => entry.name.toLowerCase() === `metadata/plate_${plate}.png`) || pictures.sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }))[0] || null;
}
function plateNumber(file) { const match = /plate_(\d+)\.gcode/i.exec(file || ''); return match ? Number(match[1]) : 1; }

// Which file on the printer is this job's 3MF.
function candidates(job) {
  const names = new Set();
  for (const value of [job.file, job.name].filter(Boolean)) {
    const base = String(value).replace(/^.*[\\/]/, '');
    if (!base || base.length > 200 || /[\u0000-\u001f]/.test(base)) continue;
    if (/\.(3mf|gcode)$/i.test(base)) names.add(base);
    else for (const ending of ['.gcode.3mf', '.3mf', '.gcode']) names.add(base + ending);
  }
  return [...names].flatMap(name => FOLDERS.map(folder => `${folder.replace(/\/$/, '')}/${name}`));
}
// Bambu Studio G-code carries base64 PNG thumbnails in its header comments:
// "; thumbnail begin 512x512 <length>", base64 lines, "; thumbnail end".
async function gcodePicture(session, file) {
  let head = await session.read(file, 0, 65536);
  const found = [...head.toString('latin1').matchAll(/; thumbnail begin (\d+)x(\d+) (\d+)\r?\n/g)];
  if (!found.length) return null;
  const largest = found.reduce((best, block) => Number(block[1]) * Number(block[2]) > Number(best[1]) * Number(best[2]) ? block : best);
  const start = largest.index + largest[0].length, length = Number(largest[3]);
  if (!length || length > MAX_ENTRY * 2) return null;
  const end = start + length + Math.ceil(length / 70) * 6 + 64;
  if (end > head.length) head = await session.read(file, 0, end);
  const block = head.toString('latin1', start, Math.min(head.length, end)).split(/; thumbnail end/)[0];
  const base64 = block.split(/\r?\n/).map(line => line.replace(/^;\s?/, '')).join('').replace(/[^A-Za-z0-9+/=]/g, '');
  const image = Buffer.from(base64.slice(0, length), 'base64');
  return image.length > 8 && image.readUInt32BE(0) === 0x89504e47 ? { type: 'image/png', data: image } : null;
}
function matchFile(names, job) {
  const files = names.filter(name => /\.(3mf|gcode)$/i.test(name));
  const wanted = [job.file, job.name].filter(Boolean).map(value => String(value).replace(/^.*[\\/]/, '').toLowerCase());
  for (const want of wanted) {
    const exact = files.find(name => name.toLowerCase() === want);
    if (exact) return exact;
    const base = want.replace(/(\.gcode)?(\.3mf)?$/i, '');
    const named = files.find(name => name.toLowerCase().replace(/(\.gcode)?(\.3mf)?$/i, '') === base);
    if (named) return named;
  }
  return null;
}

async function fetchThumbnail(config, job, options = {}) {
  const session = await openSession(config, options);
  try {
    let file = null;
    // A path in the job (ftp:// or a folder path) is tried first.
    const direct = /\.3mf$/i.test(job.file || '') && /[\\/]/.test(job.file) ? job.file.replace(/^[a-z]+:\/\/[^/]*/i, '').replace(/\\/g, '/') : null;
    if (direct) { try { await session.size(direct); file = direct; } catch {} }
    // Likely names first (SIZE is cheap); folder listings can take a while.
    for (const candidate of candidates(job)) {
      if (file) break;
      try { if (await session.size(candidate) > 0) file = candidate; } catch (error) { if (error.code !== 'FTP_REPLY') throw error; }
    }
    for (const folder of FOLDERS) {
      if (file) break;
      const name = matchFile(await session.list(folder), job);
      if (name) file = `${folder.replace(/\/$/, '')}/${name}`;
    }
    if (!file) return null;
    if (/\.gcode$/i.test(file)) return await gcodePicture(session, file);
    try { return await zipPicture(session, file, plateNumber(job.file)); }
    catch (error) {
      // Printers without REST (the P1S) send files only from the start.
      if (error.code !== 'FTP_REPLY' || !/REST/.test(error.message)) throw error;
      return await streamedPicture(session, file, plateNumber(job.file));
    }
  } finally { session.close(); }
}
// The archive's directory and one entry, read by byte ranges.
async function zipDirectory(session, file) {
  const total = await session.size(file);
  if (!Number.isFinite(total) || total < 22) return null;
  const tailStart = Math.max(0, total - 65536 - 22);
  const tail = await session.read(file, tailStart, total - tailStart);
  const { size, offset } = zipEntries(tail, tailStart);
  if (size > MAX_DIRECTORY) return null;
  return parseDirectory(offset >= tailStart ? tail.subarray(offset - tailStart, offset - tailStart + size) : await session.read(file, offset, size));
}
async function zipEntry(session, file, entry) {
  if (!entry || entry.compressed > MAX_ENTRY || entry.size > MAX_ENTRY || ![0, 8].includes(entry.method)) return null;
  // The local header repeats the name and may carry a different extra field.
  const header = await session.read(file, entry.local, 30);
  if (header.readUInt32LE(0) !== 0x04034b50) return null;
  const start = entry.local + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
  const body = await session.read(file, start, entry.compressed);
  return entry.method === 8 ? zlib.inflateRawSync(body, { maxOutputLength: MAX_ENTRY }) : body;
}
const isPng = image => image && image.length > 8 && image.readUInt32BE(0) === 0x89504e47;
async function zipPicture(session, file, plate) {
  const entries = await zipDirectory(session, file);
  const image = entries && await zipEntry(session, file, pickPreview(entries, plate));
  return isPng(image) ? { type: 'image/png', data: image } : null;
}

// ---- Projects on this PC --------------------------------------------------
// A job is named "<project>_<plate name>" by Bambu Studio. When the printer's
// storage has no copy (the H2D without a USB drive), the project in the
// slicer's recent list still holds every plate's picture.
const normal = value => String(value || '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '');
function slicerConfigs() {
  const roaming = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  return [path.join(roaming, 'BambuStudio', 'BambuStudio.conf'), path.join(roaming, 'OrcaSlicer', 'OrcaSlicer.conf')];
}
async function recentProjects(configs = slicerConfigs()) {
  const files = [];
  for (const config of configs) {
    let text = '';
    try { text = await fsp.readFile(config, 'utf8'); } catch { continue; }
    const block = /"recent_projects"\s*:\s*\{([^}]*)\}/.exec(text)?.[1] || '';
    for (const match of block.matchAll(/"[^"]*"\s*:\s*"((?:[^"\\]|\\.)*\.3mf)"/gi)) {
      try { files.push(JSON.parse(`"${match[1]}"`)); } catch {}
    }
  }
  return [...new Set(files)].filter(file => path.isAbsolute(file));
}
function localSession(handle) {
  return {
    async size() { return (await handle.stat()).size; },
    async read(file, offset, length) { const buffer = Buffer.alloc(length); const { bytesRead } = await handle.read(buffer, 0, length, offset); return buffer.subarray(0, bytesRead); },
  };
}
// Plate numbers and names from Metadata/model_settings.config.
function plateNames(xml) {
  const plates = [];
  for (const block of xml.split(/<plate>/).slice(1)) {
    const id = Number(/key="plater_id" value="(\d+)"/.exec(block)?.[1]);
    const name = /key="plater_name" value="([^"]*)"/.exec(block)?.[1] || '';
    if (Number.isInteger(id)) plates.push({ id, name: name.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&apos;/g, "'") });
  }
  return plates;
}
async function localPicture(job, { configs } = {}) {
  const want = normal(job.name);
  if (!want) return null;
  for (const file of await recentProjects(configs)) {
    const base = normal(path.basename(file).replace(/(\.gcode)?\.3mf$/i, ''));
    if (!base || !want.startsWith(base)) continue;
    let handle;
    try { handle = await fsp.open(file, 'r'); } catch { continue; }
    try {
      const session = localSession(handle);
      const entries = await zipDirectory(session, file);
      if (!entries) continue;
      const rest = want.slice(base.length);
      let plate = plateNumber(job.file);
      if (rest) {
        const settings = await zipEntry(session, file, entries.find(entry => entry.name === 'Metadata/model_settings.config'));
        const plates = settings ? plateNames(settings.toString('utf8')) : [];
        const found = plates.find(item => normal(item.name) === rest) || plates.find(item => normal(item.name) && (normal(item.name).includes(rest) || rest.includes(normal(item.name))));
        if (!found) continue;
        plate = found.id;
      }
      const image = await zipEntry(session, file, entries.find(entry => entry.name.toLowerCase() === `metadata/plate_${plate}.png`));
      if (isPng(image)) return { type: 'image/png', data: image, source: 'project' };
    } catch {} finally { await handle.close(); }
  }
  return null;
}
// The printer's own copy of the job first: it is exactly what was sliced (every
// copy placed on the plate). The saved project is only a fallback, since the
// plate may have been changed after saving and before sending.
async function findPicture(config, job, options = {}) {
  const exact = await fetchThumbnail(config, job, options).catch(() => null);
  if (exact) return exact;
  // The Bambu cloud's print history has the same exact picture, when signed in.
  const cloud = options.cloud ? await options.cloud.picture(config.serial, job).catch(() => null) : null;
  if (cloud) return cloud;
  const saved = await localPicture(job, options).catch(() => null);
  return saved && { ...saved, approximate: true };
}

// Reads local ZIP entries in order as the file arrives and stops at the plate
// picture. Entries whose sizes follow their data (flag bit 3) are skipped by
// finding the next local header.
const MAX_STREAM = 160 * 1024 * 1024;
async function streamedPicture(session, file, plate) {
  let buffer = Buffer.alloc(0), position = 0, result = null, fallback = null;
  const want = `metadata/plate_${plate}.png`;
  function scan() {
    for (;;) {
      if (buffer.length - position < 30) return false;
      if (buffer.readUInt32LE(position) !== 0x04034b50) return true;
      const flags = buffer.readUInt16LE(position + 6), method = buffer.readUInt16LE(position + 8);
      const compressed = buffer.readUInt32LE(position + 18), nameLength = buffer.readUInt16LE(position + 26), extraLength = buffer.readUInt16LE(position + 28);
      const start = position + 30 + nameLength + extraLength;
      if (buffer.length < start) return false;
      const name = buffer.toString('utf8', position + 30, position + 30 + nameLength);
      const picture = /^Metadata\/plate_\d+\.png$/i.test(name);
      if (flags & 8 && !compressed) {
        const next = buffer.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]), start);
        if (next < 0) return false;
        if (picture) keep(name, method, buffer.subarray(start, next));
        position = next;
      } else {
        if (picture && compressed > MAX_ENTRY) return true;
        if (buffer.length < start + compressed) return false;
        if (picture) keep(name, method, buffer.subarray(start, start + compressed));
        position = start + compressed;
      }
      if (result) return true;
    }
  }
  function keep(name, method, body) {
    let image;
    try { image = method === 8 ? zlib.inflateRawSync(body, { maxOutputLength: MAX_ENTRY, finishFlush: zlib.constants.Z_SYNC_FLUSH }) : body; } catch { return; }
    if (image.length < 8 || image.readUInt32BE(0) !== 0x89504e47) return;
    if (name.toLowerCase() === want) result = Buffer.from(image); else fallback ||= Buffer.from(image);
  }
  // Only the unread part is kept between chunks.
  await session.stream(file, chunk => { buffer = position < buffer.length ? Buffer.concat([buffer.subarray(position), chunk]) : chunk; position = 0; return scan(); }, MAX_STREAM);
  const image = result || fallback;
  return image ? { type: 'image/png', data: image } : null;
}

// Keeps one picture per printer for its current job, fetched once per job.
function createThumbnailStore({ fetch = findPicture, onChange = () => {}, lookup, now = Date.now } = {}) {
  const pictures = new Map();
  async function resolveAddress(host) {
    if (net.isIP(host) || !lookup) return undefined;
    return new Promise((resolve, reject) => lookup(host, {}, (error, address) => error ? reject(error) : resolve(address)));
  }
  return {
    // job: {key, name, file} while a print runs, else null.
    update(id, config, job) {
      const saved = pictures.get(id);
      if (!job || !config) { if (saved) { pictures.delete(id); onChange(); } return; }
      if (saved?.key === job.key && (saved.data || saved.busy || saved.tries >= 3 || now() < saved.retryAt)) return;
      const entry = saved?.key === job.key ? saved : { key: job.key, tries: 0 };
      entry.busy = true; entry.tries++; pictures.set(id, entry);
      (async () => fetch(config, job, { address: await resolveAddress(config.host) }))().then(picture => {
        if (pictures.get(id) !== entry) return;
        entry.busy = false;
        if (picture) { entry.data = picture.data; entry.type = picture.type; entry.version = `${job.key}:${picture.data.length}${picture.approximate ? ":project" : ""}`; onChange(); }
        else entry.retryAt = now() + 30000;
      }, () => { if (pictures.get(id) === entry) { entry.busy = false; entry.retryAt = now() + 30000; } });
    },
    version(id) { return pictures.get(id)?.version || null; },
    // Look again for every running job (after signing in to the cloud).
    reset() { pictures.clear(); onChange(); },
    picture(id) { const entry = pictures.get(id); return entry?.data ? { type: entry.type, data: entry.data } : null; },
    get(id) { const entry = pictures.get(id); return entry?.data ? `data:${entry.type};base64,${entry.data.toString('base64')}` : null; },
  };
}

module.exports = { localPicture, recentProjects, plateNames, findPicture, candidates, gcodePicture, fetchThumbnail, createThumbnailStore, zipEntries, parseDirectory, pickPreview, plateNumber, matchFile };
