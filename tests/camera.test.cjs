'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough, Writable } = require('node:stream');
const { createCameraBridge, createP1FrameParser, createMjpegParser, p1Authentication, ffmpegInput, MAX_FRAME_BYTES } = require('../lib/camera.cjs');

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
const config = { id: 'p1s', model: 'P1S', host: '192.168.1.20', accessCode: '12345678', allowSelfSigned: false };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate) { for (let i = 0; i < 40; i++) { if (predicate()) return; await delay(5); } assert.fail('Expected fake transport activity.'); }
function wire(frame = JPEG) { const header = Buffer.alloc(16); header.writeUInt32LE(frame.length, 0); header.writeUInt32LE(1, 8); return Buffer.concat([header, frame]); }
class FakeSocket extends EventEmitter {
  constructor() { super(); this.writes = []; this.destroyed = false; }
  write(bytes) { this.writes.push(Buffer.from(bytes)); }
  destroy() { if (!this.destroyed) { this.destroyed = true; this.emit('close'); } }
}
function p1Fixture(overrides = {}, dependencies = {}) {
  const sockets = [], connections = [];
  const bridge = createCameraBridge({ getPrinterConfig: () => ({ ...config, ...overrides }), getPrinterState: () => ({ camera: { protocol: 'local' } }) }, {
    tlsConnect: options => { connections.push(options); const socket = new FakeSocket(); sockets.push(socket); return socket; },
    frameTimeoutMs: 1000, ...dependencies
  });
  return { bridge, sockets, connections };
}

test('P1 authentication has exact little-endian header and padded credentials', () => {
  const packet = p1Authentication('sample-code');
  assert.equal(packet.length, 80); assert.equal(packet.readUInt32LE(0), 0x40); assert.equal(packet.readUInt32LE(4), 0x3000);
  assert.equal(packet.readUInt32LE(8), 0); assert.equal(packet.readUInt32LE(12), 0);
  assert.equal(packet.subarray(16, 20).toString('ascii'), 'bblp'); assert.equal(packet.subarray(48, 59).toString('ascii'), 'sample-code');
  assert.ok(packet.subarray(20, 48).every(value => value === 0)); assert.throws(() => p1Authentication('x'.repeat(33)));
});

test('P1 parser reconstructs fragmented headers and multiple frames', () => {
  const frames = [], parse = createP1FrameParser(frame => frames.push(Buffer.from(frame)));
  const bytes = Buffer.concat([wire(), wire()]);
  for (let i = 0; i < bytes.length; i += 3) parse(bytes.subarray(i, i + 3));
  assert.equal(frames.length, 2); assert.deepEqual(frames[0], JPEG); assert.deepEqual(frames[1], JPEG);
});

test('P1 parser rejects oversized, unexpected-track, and invalid JPEG frames', () => {
  const oversized = Buffer.alloc(16); oversized.writeUInt32LE(MAX_FRAME_BYTES + 1, 0); oversized.writeUInt32LE(1, 8);
  assert.throws(() => createP1FrameParser(() => {})(oversized));
  const differentTrack = wire(); differentTrack.writeUInt32LE(2, 4); assert.throws(() => createP1FrameParser(() => {})(differentTrack));
  assert.throws(() => createP1FrameParser(() => {})(wire(Buffer.from([0, 1, 2, 3]))));
});

test('MJPEG parser handles split image markers and caps unfinished frames', () => {
  const frames = [], parse = createMjpegParser(frame => frames.push(Buffer.from(frame)));
  parse(JPEG.subarray(0, 1)); parse(JPEG.subarray(1, 6)); parse(Buffer.concat([JPEG.subarray(6), JPEG]));
  assert.equal(frames.length, 2); assert.deepEqual(frames[0], JPEG);
  assert.throws(() => createMjpegParser(() => {})(Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(MAX_FRAME_BYTES)])));
});

test('camera connection is lazy, honors TLS verification, and clears a failed cached frame', async t => {
  const { bridge, sockets, connections } = p1Fixture(); t.after(() => bridge.close());
  assert.equal(connections.length, 0);
  const pending = bridge.getFrame('p1s'); await until(() => sockets.length);
  assert.equal(connections[0].port, 6000); assert.equal(connections[0].rejectUnauthorized, true);
  sockets[0].emit('secureConnect'); assert.equal(sockets[0].writes[0].length, 80);
  sockets[0].emit('data', wire()); const frame = await pending;
  assert.equal(frame.connected, true); assert.equal(frame.image, `data:image/jpeg;base64,${JPEG.toString('base64')}`);
  assert.equal((await bridge.getFrame('p1s')).connected, true); assert.equal(sockets.length, 1);
  sockets[0].emit('error', Object.assign(new Error('secret transport detail'), { code: 'ECONNRESET' }));
  const failed = await bridge.getFrame('p1s'); assert.equal(failed.connected, false); assert.equal(failed.image, null); assert.equal(failed.updatedAt, null); assert.ok(!failed.error.includes('secret'));
});

test('explicit LAN certificate opt-in reaches the P1 TLS socket', async t => {
  const { bridge, sockets, connections } = p1Fixture({ allowSelfSigned: true }); t.after(() => bridge.close());
  const pending = bridge.getFrame('p1s'); await until(() => sockets.length); assert.equal(connections[0].rejectUnauthorized, false);
  bridge.close(); assert.equal((await pending).connected, false);
});

test('public DNS addresses are rejected before credentials leave the process', async t => {
  const { bridge, connections } = p1Fixture({ host: 'printer.local' }, { lookup: async () => [{ address: '8.8.8.8', family: 4 }] }); t.after(() => bridge.close());
  const result = await bridge.getFrame('p1s'); assert.equal(result.connected, false); assert.equal(connections.length, 0); assert.match(result.error, /local network/);
});

test('disabled liveview and unknown model never open a connection', async t => {
  let connections = 0;
  const bridge = createCameraBridge({ getPrinterConfig: () => config, getPrinterState: () => ({ camera: { protocol: 'disabled' } }) }, { tlsConnect: () => { connections++; } }); t.after(() => bridge.close());
  const result = await bridge.getFrame('p1s'); assert.match(result.error, /Enable LAN Only Liveview/); assert.equal(connections, 0);
  const unknown = createCameraBridge({ getPrinterConfig: () => ({ ...config, model: 'other' }) }, { tlsConnect: () => { connections++; } }); t.after(() => unknown.close());
  assert.equal((await unknown.getFrame('other')).connected, false); assert.equal(connections, 0);
});

test('a first-frame timeout closes the transport and settles pending previews', async t => {
  const { bridge, sockets } = p1Fixture({}, { frameTimeoutMs: 25 }); t.after(() => bridge.close());
  const pending = bridge.getFrame('p1s'); await until(() => sockets.length);
  const keepAlive = setTimeout(() => {}, 100); const result = await pending; clearTimeout(keepAlive);
  assert.equal(result.connected, false); assert.equal(result.image, null); assert.equal(sockets[0].destroyed, true);
});

test('closing the preview stops unused streams after the idle deadline', async t => {
  const { bridge, sockets } = p1Fixture({}, { idleTimeoutMs: 25 }); t.after(() => bridge.close());
  const pending = bridge.getFrame('p1s'); await until(() => sockets.length); sockets[0].emit('data', wire()); await pending;
  await delay(65); assert.equal(sockets[0].destroyed, true);
});

test('H2D URL stays in stdin, is escaped, and TLS verification stays enabled', () => {
  const input = ffmpegInput({ ...config, accessCode: "a'b&c/" }, '192.168.1.20');
  assert.match(input, /a%27b%26c%2F/); assert.match(input, /option tls_verify 1/); assert.match(input, /option rtsp_transport tcp/);
  assert.ok(!input.includes("a'b&c/")); assert.match(ffmpegInput({ ...config, allowSelfSigned: true }, '192.168.1.20'), /option tls_verify 0/);
});

test('H2D frames arrive through FFmpeg without credentials in arguments or errors', async t => {
  let invocation, child, privateInput = '';
  const secret = 'secret-code';
  const bridge = createCameraBridge({ getPrinterConfig: () => ({ ...config, model: 'H2D', accessCode: secret }), getPrinterState: () => ({ camera: { protocol: 'rtsps' } }) }, {
    findFfmpeg: () => 'ffmpeg.exe',
    spawn: (executable, args, options) => {
      invocation = { executable, args, options }; child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
      child.stdin = new Writable({ write(chunk, encoding, done) { privateInput += chunk.toString(); done(); } }); child.kill = () => {};
      return child;
    }, frameTimeoutMs: 1000
  }); t.after(() => bridge.close());
  const pending = bridge.getFrame('h2d'); await until(() => child);
  assert.equal(invocation.options.windowsHide, true); assert.equal(invocation.options.shell, false);
  assert.ok(!JSON.stringify(invocation).includes(secret)); assert.ok(privateInput.includes(secret));
  child.stdout.write(JPEG); assert.equal((await pending).connected, true);
  child.stderr.write(`401 Unauthorized rtsps://bblp:${secret}@192.168.1.20`); child.emit('close', 1);
  const result = await bridge.getFrame('h2d'); assert.equal(result.image, null); assert.match(result.error, /access was rejected/); assert.ok(!JSON.stringify(result).includes(secret));
});

test('missing FFmpeg produces a clear setup state without starting a process', async t => {
  let spawned = false;
  const bridge = createCameraBridge({ getPrinterConfig: () => ({ ...config, model: 'H2D' }) }, { findFfmpeg: () => null, spawn: () => { spawned = true; } }); t.after(() => bridge.close());
  const result = await bridge.getFrame('h2d'); assert.equal(result.connected, false); assert.match(result.error, /FFmpeg was not found/); assert.equal(spawned, false);
});

test('closing while configuration loads cannot create a new connection', async () => {
  let resolveConfig, connects = 0;
  const bridge = createCameraBridge({ getPrinterConfig: () => new Promise(resolve => { resolveConfig = resolve; }) }, { tlsConnect: () => { connects++; } });
  const pending = bridge.getFrame('p1s'); bridge.close(); resolveConfig(config);
  assert.equal((await pending).connected, false); assert.equal(connects, 0);
});

test('a live view asking with the frame it shows waits for the next frame', async t => {
  let clock = 1000;
  const { bridge, sockets } = p1Fixture({}, { now: () => clock }); t.after(() => bridge.close());
  const first = bridge.getFrame('p1s'); await until(() => sockets.length);
  sockets[0].emit('secureConnect'); sockets[0].emit('data', wire()); const shown = await first;
  let settled = false;
  const next = bridge.getFrame('p1s', shown.updatedAt).then(frame => { settled = true; return frame; });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(settled, false, 'The same frame is not sent again');
  clock = 1100; sockets[0].emit('data', wire());
  const frame = await next; assert.notEqual(frame.updatedAt, shown.updatedAt);
});
