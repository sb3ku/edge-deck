'use strict';

const tls = require('node:tls');
const dns = require('node:dns').promises;
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { createHash } = require('node:crypto');
const { isLanHost, isPrivateAddress } = require('./printers.cjs');

/*
 * Camera reads are on demand; this module never publishes printer commands.
 * Official Bambu Studio transport selection:
 * https://github.com/bambulab/BambuStudio/blob/8f588cdb6893bb88415a62f5520b1a8e27a4c8ec/src/slic3r/GUI/MediaPlayCtrl.cpp#L586
 * Exact P1 wire framing and observed H2 RTSPS endpoint (independent, unofficial):
 * https://github.com/Doridian/OpenBambuAPI/blob/main/video.md
 * H2D LAN Only Liveview is also shown in Bambu's H2D manual, pages 98–99:
 * https://csm.bblcdn.com/hub/4668d0ca43994ff3bff4b37f1a65c2e7.pdf
 */
const MAX_FRAME_BYTES = 2 * 1024 * 1024;
const ERROR = Object.freeze({
  setup: 'Add the printer’s local address and LAN access code before opening its camera.',
  address: 'The printer address must resolve to your local network.',
  disabled: 'Enable LAN Only Liveview on the printer’s screen, then open the preview again.',
  unsupported: 'This camera transport is not supported. Open the live view in Bambu Studio.',
  timeout: 'No camera frame arrived. Check the LAN access code and live-view setting, and close other camera viewers.',
  closed: 'The camera connection closed. Open the preview again to reconnect.',
  protocol: 'The camera returned an unsupported or damaged frame. Open the live view in Bambu Studio.',
  certificate: 'Camera certificate verification failed. Review this printer’s LAN certificate setting before retrying.',
  authentication: 'Camera access was rejected. Check the LAN access code and the printer’s LAN live-view settings.',
  ffmpeg: 'FFmpeg was not found. Install FFmpeg or open this camera in Bambu Studio.',
  connection: 'The camera could not connect. Check the printer’s network and LAN live-view settings.',
});

function validJpeg(frame) {
  return frame.length >= 4 && frame.length <= MAX_FRAME_BYTES && frame[0] === 0xff && frame[1] === 0xd8 &&
    frame[frame.length - 2] === 0xff && frame[frame.length - 1] === 0xd9;
}

function createP1FrameParser(onFrame) {
  let buffer = Buffer.alloc(0), expected = null;
  return chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    while (true) {
      if (expected === null) {
        if (buffer.length < 16) break;
        expected = buffer.readUInt32LE(0);
        if (expected < 4 || expected > MAX_FRAME_BYTES || buffer.readUInt32LE(4) !== 0 || buffer.readUInt32LE(8) !== 1 || buffer.readUInt32LE(12) !== 0) throw Error('Unsupported camera header.');
        buffer = buffer.subarray(16);
      }
      if (buffer.length < expected) break;
      const frame = buffer.subarray(0, expected);
      if (!validJpeg(frame)) throw Error('Invalid JPEG camera frame.');
      onFrame(frame);
      buffer = buffer.subarray(expected); expected = null;
    }
    if (buffer.length > MAX_FRAME_BYTES) throw Error('Camera buffer limit exceeded.');
  };
}

function createMjpegParser(onFrame) {
  let buffer = Buffer.alloc(0);
  return chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length) {
      const start = buffer.indexOf(Buffer.from([0xff, 0xd8]));
      if (start < 0) {
        if (buffer.length > MAX_FRAME_BYTES) throw Error('Camera buffer limit exceeded.');
        buffer = buffer.subarray(Math.max(0, buffer.length - 1)); break;
      }
      if (start) buffer = buffer.subarray(start);
      const end = buffer.indexOf(Buffer.from([0xff, 0xd9]), 2);
      if (end < 0) break;
      const frame = buffer.subarray(0, end + 2);
      if (!validJpeg(frame)) throw Error('Invalid JPEG camera frame.');
      onFrame(frame); buffer = buffer.subarray(end + 2);
    }
    if (buffer.length > MAX_FRAME_BYTES) throw Error('Camera buffer limit exceeded.');
  };
}

function p1Authentication(accessCode) {
  if (typeof accessCode !== 'string' || !/^[\x20-\x7e]{1,32}$/.test(accessCode)) throw Error('Invalid camera access code.');
  const packet = Buffer.alloc(80);
  packet.writeUInt32LE(0x40, 0); packet.writeUInt32LE(0x3000, 4);
  packet.write('bblp', 16, 32, 'ascii'); packet.write(accessCode, 48, 32, 'ascii');
  return packet;
}

function findFfmpeg(explicitPath) {
  const candidates = [];
  if (explicitPath) candidates.push(explicitPath);
  const executable = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  for (const directory of (process.env.PATH || '').split(path.delimiter)) if (directory) candidates.push(path.join(directory.replace(/^"|"$/g, ''), executable));
  if (process.platform === 'win32') {
    const root = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Microsoft', 'WinGet', 'Packages');
    try {
      for (const pkg of fs.readdirSync(root).filter(name => /^Gyan\.FFmpeg_/.test(name))) {
        const base = path.join(root, pkg);
        for (const version of fs.readdirSync(base).filter(name => /^ffmpeg-[a-zA-Z0-9._-]+$/.test(name))) candidates.push(path.join(base, version, 'bin', 'ffmpeg.exe'));
      }
    } catch {}
  }
  return candidates.find(file => { try { return fs.statSync(file).isFile(); } catch { return false; } }) || null;
}

function ffmpegInput(config, address) {
  const host = net.isIP(address) === 6 ? `[${address}]` : address;
  const password = encodeURIComponent(config.accessCode).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  const url = `rtsps://bblp:${password}@${host}:322/streaming/live/1`;
  // Feed the private URL through stdin, never argv, a temporary file, or logs.
  // The hostname is validated before arriving here; it cannot add concat directives.
  return `ffconcat version 1.0\nfile '${url}'\noption rtsp_transport tcp\noption allowed_media_types video\noption timeout 10000000\noption tls_verify ${config.allowSelfSigned === true ? 0 : 1}\noption verifyhost ${config.host}\n`;
}

function cameraError(error) {
  if (/CERT|SELF_SIGNED|UNABLE_TO_VERIFY|ERR_TLS_CERT/.test(error?.code || '')) return ERROR.certificate;
  return ERROR.connection;
}

function createCameraBridge({ getPrinterConfig, getPrinterState, ffmpegPath } = {}, dependencies = {}) {
  if (typeof getPrinterConfig !== 'function') throw new TypeError('getPrinterConfig is required.');
  const connect = dependencies.tlsConnect || tls.connect;
  const lookup = dependencies.lookup || (host => dns.lookup(host, { all: true }));
  const launch = dependencies.spawn || spawn;
  const locateFfmpeg = dependencies.findFfmpeg || findFfmpeg;
  const now = dependencies.now || Date.now;
  const frameTimeout = dependencies.frameTimeoutMs ?? 12000;
  const idleTimeout = dependencies.idleTimeoutMs ?? 20000;
  const freshness = dependencies.frameFreshnessMs ?? 6000;
  const retryDelay = dependencies.retryDelayMs ?? 5000;
  const sessions = new Map();
  let closed = false;

  const failure = error => ({ connected: false, image: null, updatedAt: null, error });
  function snapshot(session) {
    return session.image ? { connected: true, image: session.image, updatedAt: new Date(session.frameAt).toISOString(), error: null } : failure(session.error || ERROR.timeout);
  }
  function settle(session) {
    const result = snapshot(session);
    for (const resolve of session.waiters.splice(0)) resolve(result);
  }
  function stop(session, message) {
    if (!session.active) return;
    session.active = false; session.error = message; session.failedAt = now(); session.image = null; session.frameAt = null;
    clearTimeout(session.deadline);
    try { session.socket?.destroy(); } catch {}
    try { session.process?.stdin?.destroy(); session.process?.kill(); } catch {}
    settle(session);
  }
  function armDeadline(session) {
    clearTimeout(session.deadline);
    session.deadline = setTimeout(() => stop(session, ERROR.timeout), frameTimeout);
    session.deadline.unref?.();
  }
  function receiveFrame(session, frame) {
    if (!session.active || closed) return;
    session.image = `data:image/jpeg;base64,${frame.toString('base64')}`; session.frameAt = now(); session.error = null;
    armDeadline(session); settle(session);
  }
  async function resolveAddress(host) {
    if (!isLanHost(host)) throw Error(ERROR.address);
    if (net.isIP(host)) return host;
    const records = await lookup(host);
    const address = records.find(item => isPrivateAddress(item.address))?.address;
    if (!address) throw Error(ERROR.address);
    return address;
  }
  async function start(session, config) {
    let address;
    try { address = await resolveAddress(config.host); } catch { stop(session, ERROR.address); return; }
    if (!session.active || closed) return;
    if (config.model === 'P1S') {
      let authentication;
      try { authentication = p1Authentication(config.accessCode); } catch { stop(session, ERROR.setup); return; }
      const parser = createP1FrameParser(frame => receiveFrame(session, frame));
      try {
        const socket = connect({ host: address, port: 6000, servername: net.isIP(config.host) ? undefined : config.host, rejectUnauthorized: config.allowSelfSigned !== true });
        session.socket = socket;
        socket.once('secureConnect', () => { if (session.active) socket.write(authentication); authentication.fill(0); });
        socket.on('data', chunk => { if (session.active) { try { parser(chunk); } catch { stop(session, ERROR.protocol); } } });
        socket.on('error', error => stop(session, cameraError(error)));
        socket.on('close', () => stop(session, ERROR.closed));
      } catch (error) { stop(session, cameraError(error)); }
    } else {
      let executable;
      try { executable = await locateFfmpeg(ffmpegPath); } catch {}
      if (!session.active || closed) return;
      if (!executable) { stop(session, ERROR.ffmpeg); return; }
      const parser = createMjpegParser(frame => receiveFrame(session, frame));
      // The camera's full frame rate at 1280 px for the live view (FFmpeg runs only while someone watches).
      const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-protocol_whitelist', 'pipe,crypto,tcp,tls,rtsp,rtsps', '-f', 'concat', '-safe', '0', '-i', 'pipe:0', '-an', '-sn', '-dn', '-vf', 'scale=1280:-2', '-q:v', '6', '-flush_packets', '1', '-f', 'image2pipe', '-c:v', 'mjpeg', 'pipe:1'];
      try {
        const child = launch(executable, args, { windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
        session.process = child;
        child.stdout.on('data', chunk => { if (session.active) { try { parser(chunk); } catch { stop(session, ERROR.protocol); } } });
        // FFmpeg can put private URLs in diagnostics. Never retain or forward them.
        child.stderr.on('data', chunk => {
          const text = chunk.toString('utf8', 0, Math.min(chunk.length, 8192));
          if (/certificate verify failed|self.signed|certificate verification/i.test(text)) session.transportError = ERROR.certificate;
          else if (/401|403|unauthori[sz]ed|authentication failed/i.test(text)) session.transportError = ERROR.authentication;
        });
        child.on('error', () => stop(session, ERROR.connection));
        child.on('close', () => stop(session, session.transportError || ERROR.connection));
        child.stdin.on('error', () => stop(session, session.transportError || ERROR.connection));
        child.stdin.end(ffmpegInput(config, address), 'utf8');
      } catch { stop(session, ERROR.connection); }
    }
  }

  const sweeper = setInterval(() => {
    for (const [id, session] of sessions) {
      if (now() - session.requestedAt > idleTimeout) { stop(session, ERROR.closed); sessions.delete(id); }
    }
  }, Math.min(2000, Math.max(10, idleTimeout / 2)));
  sweeper.unref?.();

  const videos = new Set();
  return {
    // A live video of an RTSPS camera (the H2D) for a <video> element: the
    // printer's own H.264, repackaged as fragmented MP4 one frame at a time, so
    // the browser's player buffers and plays it evenly. Returns { stream, stop }.
    async openVideo(id) {
      if (closed) throw Error(ERROR.closed);
      const config = await getPrinterConfig(id), state = await getPrinterState?.(id);
      if (!config || config.model !== 'H2D' || !config.host || typeof config.accessCode !== 'string' || !config.accessCode || config.accessCode.length > 128 || /[\x00-\x1f\x7f]/.test(config.accessCode)) throw Error(ERROR.setup);
      const protocol = state?.camera?.protocol;
      if (['disabled', 'none'].includes(protocol)) throw Error(ERROR.disabled);
      if (protocol && protocol !== 'rtsps') throw Error(ERROR.unsupported);
      if ([...videos].filter(video => video.id === id).length >= 2) throw Error('This camera is already open twice.');
      let address;
      try { address = await resolveAddress(config.host); } catch { throw Error(ERROR.address); }
      const executable = await locateFfmpeg(ffmpegPath);
      if (!executable) throw Error(ERROR.ffmpeg);
      const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-fflags', 'nobuffer', '-protocol_whitelist', 'pipe,crypto,tcp,tls,rtsp,rtsps', '-f', 'concat', '-safe', '0', '-i', 'pipe:0',
        '-an', '-sn', '-dn', '-c:v', 'copy', '-f', 'mp4', '-movflags', 'empty_moov+default_base_moof+frag_every_frame', '-flush_packets', '1', 'pipe:1'];
      const child = launch(executable, args, { windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'ignore'] });
      const video = { id, child };
      videos.add(video);
      const stop = () => { videos.delete(video); try { child.stdin?.destroy(); child.kill(); } catch {} };
      child.on('close', () => videos.delete(video));
      child.on('error', stop);
      child.stdin.on('error', () => {});
      child.stdin.end(ffmpegInput(config, address), 'utf8');
      return { stream: child.stdout, stop };
    },
    // after: the updatedAt of the frame the viewer already shows; the answer then
    // waits (briefly) for a newer frame, so a live view gets every frame once.
    async getFrame(id, after = null) {
      if (closed) return failure(ERROR.closed);
      let config, state;
      try { config = await getPrinterConfig(id); state = await getPrinterState?.(id); } catch { return failure(ERROR.setup); }
      if (closed) return failure(ERROR.closed);
      if (!config || !['H2D', 'P1S'].includes(config.model) || !config.host || typeof config.accessCode !== 'string' || !config.accessCode || config.accessCode.length > 128 || /[\x00-\x1f\x7f]/.test(config.accessCode)) return failure(ERROR.setup);
      const protocol = state?.camera?.protocol;
      if (['disabled', 'none'].includes(protocol)) { const existing = sessions.get(id); if (existing) stop(existing, ERROR.disabled); return failure(ERROR.disabled); }
      if (protocol && protocol !== (config.model === 'P1S' ? 'local' : 'rtsps')) { const existing = sessions.get(id); if (existing) stop(existing, ERROR.unsupported); return failure(ERROR.unsupported); }
      const key = createHash('sha256').update(JSON.stringify([config.model, config.host, config.accessCode, config.allowSelfSigned === true])).digest('hex');
      let session = sessions.get(id);
      if (session && session.key !== key) { stop(session, ERROR.closed); sessions.delete(id); session = null; }
      if (session && !session.active) {
        if (now() - session.failedAt < retryDelay) { session.requestedAt = now(); return snapshot(session); }
        sessions.delete(id); session = null;
      }
      if (!session) {
        session = { key, active: true, requestedAt: now(), image: null, frameAt: null, waiters: [], error: null };
        sessions.set(id, session); armDeadline(session); void start(session, config);
      }
      session.requestedAt = now();
      const shown = typeof after === 'string' ? Date.parse(after) : NaN;
      if (session.image && now() - session.frameAt <= freshness && !(session.active && session.frameAt === shown)) return snapshot(session);
      if (session.image && session.active && session.frameAt === shown) {
        return new Promise(resolve => {
          const timer = setTimeout(() => { const index = session.waiters.indexOf(done); if (index >= 0) session.waiters.splice(index, 1); resolve(snapshot(session)); }, 2000);
          function done(result) { clearTimeout(timer); resolve(result); }
          session.waiters.push(done);
        });
      }
      return new Promise(resolve => session.waiters.push(resolve));
    },
    close() {
      closed = true; clearInterval(sweeper);
      for (const video of videos) { try { video.child.kill(); } catch {} }
      videos.clear();
      for (const session of sessions.values()) stop(session, ERROR.closed);
      sessions.clear();
    }
  };
}

module.exports = { createCameraBridge, createP1FrameParser, createMjpegParser, p1Authentication, ffmpegInput, findFfmpeg, MAX_FRAME_BYTES };
