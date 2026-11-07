'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createPrinterBridge, normalizeTelemetry, isLanHost } = require('../lib/printers.cjs');

const config = { id: 'p1s', name: 'Workshop', model: 'P1S', host: '192.168.1.50', serial: 'P1S12345678', accessCode: 'TESTCODE' };
const epoch = Date.UTC(2026, 10, 5, 12);

function harness({ controls = false, delayedPublish = false } = {}) {
  const clients = [];
  const connections = [];
  let time = epoch;
  let nextTimer = 0;
  const scheduled = new Map();
  const bridge = createPrinterBridge({
    now: () => time,
    staleAfterMs: 5000,
    setTimeout: (callback, delay) => { const id = ++nextTimer; scheduled.set(id, { callback, at: time + delay }); return id; },
    clearTimeout: id => scheduled.delete(id),
    connect(settings) {
      connections.push(settings);
      const client = new EventEmitter();
      client.subscriptions = [];
      client.subscribe = (topic, options, callback) => {
        client.subscriptions.push({ topic, options });
        callback(null, [{ topic, qos: 0 }]);
      };
      client.end = force => { client.ended = force; };
      client.published = [];
      client.statusRequests = [];
      client.removed = [];
      client.removeOutgoingMessage = id => { client.removed.push(id); };
      client.publish = (topic, payload, options, callback) => {
        const parsed = JSON.parse(payload);
        const statusOnly = parsed.pushing?.command === 'pushall' && !parsed.print;
        if (!controls && !statusOnly) assert.fail('Read-only monitoring must never publish physical commands.');
        const destination = statusOnly ? client.statusRequests : client.published;
        const messageId = destination.length + 1 + (statusOnly ? 1000 : 0);
        destination.push({ topic, payload: parsed, options, callback });
        client.emit('packetsend', { cmd: 'publish', topic, payload, messageId });
        if (!delayedPublish || statusOnly) {
          client.emit('packetreceive', { cmd: 'puback', messageId });
          callback(null);
        }
      };
      clients.push(client);
      return client;
    },
  });
  return { bridge, clients, connections, advance: ms => {
    time += ms;
    for (const [id, timer] of [...scheduled]) if (timer.at <= time) { scheduled.delete(id); timer.callback(); }
  } };
}

function report(client, data, topic = 'device/P1S12345678/report') {
  client.emit('message', topic, Buffer.from(JSON.stringify(data)));
}

test('unconfigured printers never connect or pretend to be idle', () => {
  const { bridge, clients } = harness();
  bridge.configure([{ id: 'h2d', name: 'H2D', model: 'H2D' }]);
  assert.equal(clients.length, 0);
  assert.equal(bridge.getState()[0].status, 'not_configured');
  assert.equal(bridge.getState()[0].progress, null);
  bridge.close();
});

test('subscribes to one read-only topic with verified TLS by default', () => {
  const { bridge, clients, connections } = harness();
  bridge.configure([config]);
  clients[0].emit('connect');
  assert.deepEqual(clients[0].subscriptions, [{ topic: 'device/P1S12345678/report', options: { qos: 0 } }]);
  assert.equal(connections[0].protocol, 'mqtts');
  assert.equal(connections[0].port, 8883);
  assert.equal(connections[0].username, 'bblp');
  assert.equal(connections[0].rejectUnauthorized, true);
  assert.equal(bridge.getState()[0].status, 'connecting');
  assert.equal(bridge.getState()[0].lastSeen, null);
  assert.ok(!JSON.stringify(bridge.getState()).includes('TESTCODE'));
  bridge.configure([{ ...config, allowSelfSigned: true }]);
  assert.equal(connections[1].rejectUnauthorized, false);
  bridge.configure([{ ...config, allowSelfSigned: 'true' }]);
  assert.equal(connections[2].rejectUnauthorized, true);
  bridge.close();
});

test('normalizes P1S telemetry and preserves unchanged fields in delta packets', () => {
  const full = normalizeTelemetry({ print: {
    gcode_state: 'RUNNING', mc_percent: 31, mc_remaining_time: 52,
    nozzle_temper: 220.5, bed_temper: 60, subtask_name: 'Bracket.3mf',
  } }, { id: 'p1s' }, epoch);
  assert.equal(full.status, 'printing');
  assert.equal(full.progress, 31);
  assert.equal(full.remainingMinutes, 52);
  assert.equal(full.nozzle, 220.5);
  assert.equal(full.bed, 60);
  const delta = normalizeTelemetry({ print: { mc_percent: 32 } }, full, epoch + 1000);
  assert.equal(delta.status, 'printing');
  assert.equal(delta.progress, 32);
  assert.equal(delta.jobName, 'Bracket.3mf');
  assert.equal(delta.nozzle, 220.5);
  assert.equal(delta.lastSeen, new Date(epoch + 1000).toISOString());
});

test('H2D unknown nested temperature data stays unknown', () => {
  const state = normalizeTelemetry({ print: {
    gcode_state: 'RUNNING', mc_percent: 2, device: { extruder: { info: [12345678] } },
  } }, { model: 'H2D' }, epoch);
  assert.equal(state.status, 'printing');
  assert.equal(state.nozzle, null);
  assert.equal(state.bed, null);
});

test('new prints cannot inherit completion, ETA or filename from finished prints', () => {
  const finished = normalizeTelemetry({ print: {
    gcode_state: 'FINISH', mc_percent: 100, mc_remaining_time: 0, subtask_name: 'Old.3mf', subtask_id: '1',
  } }, {}, epoch);
  const next = normalizeTelemetry({ print: { gcode_state: 'PREPARE' } }, finished, epoch + 1000);
  assert.equal(next.status, 'printing');
  assert.equal(next.progress, null);
  assert.equal(next.remainingMinutes, null);
  assert.equal(next.jobName, null);
});

test('job identity changes clear old completion even without a state transition', () => {
  const old = normalizeTelemetry({ print: {
    gcode_state: 'RUNNING', mc_percent: 99, mc_remaining_time: 1, subtask_name: 'Old', subtask_id: '1',
  } }, {}, epoch);
  const next = normalizeTelemetry({ print: { subtask_id: '2', subtask_name: 'New' } }, old, epoch + 1000);
  assert.equal(next.status, 'connecting');
  assert.equal(next.progress, null);
  assert.equal(next.remainingMinutes, null);
  assert.equal(next.jobName, 'New');
  const finished = normalizeTelemetry({ print: { gcode_state: 'FINISH' } }, old, epoch);
  const unidentifiedState = normalizeTelemetry({ print: { subtask_name: 'New' } }, finished, epoch + 1000);
  assert.equal(unidentifiedState.status, 'connecting');
  assert.equal(unidentifiedState.progress, null);
});

test('validates and clamps numbers; malformed packets do not create status', () => {
  assert.equal(normalizeTelemetry({}, {}, epoch), null);
  assert.equal(normalizeTelemetry({ print: [] }, {}, epoch), null);
  assert.equal(normalizeTelemetry({ print: { sequence_id: '123' } }, {}, epoch), null);
  const state = normalizeTelemetry({ print: {
    gcode_state: 'SOMETHING_NEW', mc_percent: 500, mc_remaining_time: -20,
    nozzle_temper: true, bed_temper: 999999,
  } }, {}, epoch);
  assert.equal(state.progress, 100);
  assert.equal(state.remainingMinutes, 0);
  assert.equal(state.nozzle, null);
  assert.equal(state.bed, null);
  assert.equal(state.status, 'connecting');
  const nonfinite = normalizeTelemetry({ print: { mc_percent: Infinity, mc_remaining_time: null } }, state, epoch);
  assert.equal(nonfinite.progress, null);
  assert.equal(nonfinite.remainingMinutes, null);
});

test('validates private network hosts and MQTT topic serials', () => {
  for (const host of ['192.168.1.2', '10.0.0.2', '172.16.0.2', 'printer.local', 'h2d', 'fd01::2']) assert.equal(isLanHost(host), true, host);
  for (const host of ['8.8.8.8', '172.32.0.2', '127.0.0.1', 'localhost', 'example.com', 'https://192.168.1.2', '192.168.1.2:8883', 'foo/#', '::1', '2001:4860::8888']) assert.equal(isLanHost(host), false, host);
  const { bridge, clients } = harness();
  bridge.configure([{ ...config, host: 'example.com' }, { ...config, id: 'badserial', serial: 'x/+/report' }]);
  assert.equal(clients.length, 0);
  assert.deepEqual(bridge.getState().map(item => item.status), ['error', 'error']);
  bridge.close();
});

test('reports a connected printer waiting for telemetry without calling it offline', () => {
  const { bridge, clients, advance } = harness();
  bridge.configure([config]);
  clients[0].emit('connect');
  advance(5001);
  assert.equal(bridge.getState()[0].status, 'connecting');
  assert.equal(bridge.getState()[0].connection.connected, true);
  assert.equal(bridge.getState()[0].connection.awaitingTelemetry, true);
  assert.match(bridge.getState()[0].message, /Connected to the printer/);
  report(clients[0], { print: { gcode_state: 'PAUSE', mc_percent: 40 } });
  assert.equal(bridge.getState()[0].status, 'paused');
  const lastSeen = bridge.getState()[0].lastSeen;
  advance(5001);
  assert.equal(bridge.getState()[0].status, 'connecting');
  assert.equal(bridge.getState()[0].lastSeen, lastSeen);
  assert.match(bridge.getState()[0].message, /stale/);
  report(clients[0], { print: { mc_percent: 41 } });
  assert.equal(bridge.getState()[0].status, 'paused');
  bridge.close();
});

test('read-only initial pushall is sent after SUBACK with bounded retries and no physical commands', () => {
  const { bridge, clients, advance } = harness();
  bridge.configure([config]);
  assert.equal(clients[0].statusRequests.length, 0);
  clients[0].emit('connect');
  assert.equal(clients[0].statusRequests.length, 1);
  const request = clients[0].statusRequests[0];
  assert.equal(request.topic, 'device/P1S12345678/request');
  assert.deepEqual(request.payload, { pushing: { sequence_id: request.payload.pushing.sequence_id, command: 'pushall', version: 1, push_target: 1 } });
  assert.equal(typeof request.payload.pushing.sequence_id, 'string');
  assert.deepEqual(request.options, { qos: 1, retain: false });
  advance(10000); assert.equal(clients[0].statusRequests.length, 2);
  advance(10000); assert.equal(clients[0].statusRequests.length, 3);
  advance(10000); assert.equal(clients[0].statusRequests.length, 3);
  assert.equal(clients[0].published.length, 0);
  assert.equal(bridge.getState()[0].connection.statusRequests, 3);
  assert.equal(bridge.getState()[0].lastCommand, null);
  bridge.close();
});

test('full-status retries stop when a state arrives, on disconnect, and when settings change', () => {
  const { bridge, clients, advance } = harness();
  bridge.configure([config]); clients[0].emit('connect');
  report(clients[0], { print: { command: 'push_status', msg: 0, gcode_state: 'IDLE' } });
  advance(10000);
  assert.equal(clients[0].statusRequests.length, 1);
  assert.equal(bridge.getState()[0].connection.awaitingTelemetry, false);
  clients[0].emit('close'); clients[0].emit('connect');
  assert.equal(clients[0].statusRequests.length, 2);
  clients[0].emit('close'); advance(10000);
  assert.equal(clients[0].statusRequests.length, 2);
  assert.equal(bridge.getState()[0].connection.connected, false);
  assert.equal(bridge.getState()[0].status, 'offline');
  clients[0].emit('connect');
  bridge.configure([{ id: 'unconfigured' }]); advance(10000);
  assert.equal(clients[0].statusRequests.length, 3);
  bridge.close();
});

test('reconnect does not retain old job data and closed clients cannot update replacements', () => {
  const { bridge, clients } = harness();
  bridge.configure([config]);
  clients[0].emit('connect');
  report(clients[0], { print: { gcode_state: 'FINISH', mc_percent: 100, subtask_name: 'Old' } });
  clients[0].emit('close');
  assert.equal(bridge.getState()[0].status, 'offline');
  clients[0].emit('connect');
  report(clients[0], { print: { nozzle_temper: 40 } });
  assert.equal(bridge.getState()[0].status, 'connecting');
  assert.equal(bridge.getState()[0].progress, null);
  bridge.configure([{ ...config, name: 'Replacement' }]);
  assert.equal(clients[0].ended, true);
  report(clients[0], { print: { gcode_state: 'RUNNING', mc_percent: 60 } });
  assert.equal(bridge.getState()[0].name, 'Replacement');
  assert.equal(bridge.getState()[0].progress, null);
  bridge.close();
});

test('ignores wrong topic and malformed JSON; errors never reveal credentials', () => {
  const { bridge, clients } = harness();
  bridge.configure([config]);
  clients[0].emit('connect');
  clients[0].emit('message', 'device/P1S12345678/report', Buffer.from('{bad json'));
  report(clients[0], { print: { gcode_state: 'RUNNING' } }, 'device/other/report');
  assert.equal(bridge.getState()[0].lastSeen, null);
  clients[0].emit('error', Object.assign(new Error('secret TESTCODE in unsafe upstream error'), { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' }));
  assert.equal(bridge.getState()[0].status, 'error');
  assert.match(bridge.getState()[0].message, /Certificate/);
  assert.ok(!JSON.stringify(bridge.getState()).includes('TESTCODE'));
  clients[0].emit('close');
  assert.equal(bridge.getState()[0].status, 'error');
  bridge.close();
});

test('controls require explicit opt-in, fresh status and a supported action', async () => {
  const { bridge, clients, advance } = harness({ controls: true });
  bridge.configure([config]); clients[0].emit('connect');
  report(clients[0], { print: { gcode_state: 'RUNNING' } });
  await assert.rejects(bridge.command('p1s', 'pause'), /Enable LAN controls/);
  bridge.configure([{ ...config, controlAccess: true }]); clients[1].emit('connect');
  await assert.rejects(bridge.command('p1s', 'pause'), /Fresh connected/);
  report(clients[1], { print: { gcode_state: 'RUNNING' } });
  await assert.rejects(bridge.command('p1s', 'gcode_line', { param: 'G28' }), /Unsupported/);
  await assert.rejects(bridge.command('p1s', 'pause', { param: 'G28' }), /Unsupported/);
  advance(5001);
  await assert.rejects(bridge.command('p1s', 'pause'), /Fresh connected/);
  assert.equal(clients[1].published.length, 0);
  bridge.close();
});

test('pause uses the verified payload; broker and printer ACKs do not mean completed', async () => {
  const { bridge, clients } = harness({ controls: true });
  bridge.configure([{ ...config, controlAccess: true }]); clients[0].emit('connect');
  report(clients[0], { print: { gcode_state: 'RUNNING' } });
  const result = await bridge.command('p1s', 'pause');
  assert.equal(result.status, 'sent');
  const published = clients[0].published[0];
  assert.equal(published.topic, 'device/P1S12345678/request');
  assert.deepEqual(published.options, { qos: 1, retain: false });
  assert.deepEqual(published.payload, { print: { sequence_id: result.sequenceId, command: 'pause', param: '' } });
  assert.equal(bridge.getState()[0].status, 'printing');
  assert.equal(bridge.getState()[0].lastCommand.status, 'sent');
  report(clients[0], { print: { sequence_id: result.sequenceId, command: 'pause', result: 'success' } });
  assert.equal(bridge.getState()[0].lastCommand.status, 'accepted');
  report(clients[0], { print: { gcode_state: 'PAUSE' } });
  assert.equal(bridge.getState()[0].lastCommand.status, 'confirmed');
  assert.equal(bridge.getState()[0].capabilities.resume, true);
  bridge.close();
});

test('H2D remote resume waits for job type and rejects laser processing', async () => {
  const { bridge, clients } = harness({ controls: true });
  bridge.configure([{ ...config, model: 'H2D', controlAccess: true }]); clients[0].emit('connect');
  report(clients[0], { print: { gcode_state: 'PAUSE' } });
  await assert.rejects(bridge.command('p1s', 'resume'), /job type/);
  report(clients[0], { print: { job_attr: 2 << 4 } });
  await assert.rejects(bridge.command('p1s', 'resume'), /printer itself/);
  report(clients[0], { print: { job_attr: 1 << 4 } });
  const result = await bridge.command('p1s', 'resume');
  assert.equal(clients[0].published[0].payload.print.command, 'resume');
  report(clients[0], { print: { gcode_state: 'RUNNING' } });
  assert.equal(bridge.getState()[0].lastCommand.status, 'confirmed');
  assert.equal(result.status, 'sent');
  bridge.close();
});

test('stop remains available during an unconfirmed pause and uses stop, not cancel', async () => {
  const { bridge, clients } = harness({ controls: true });
  bridge.configure([{ ...config, controlAccess: true }]); clients[0].emit('connect');
  report(clients[0], { print: { gcode_state: 'RUNNING' } });
  await bridge.command('p1s', 'pause');
  assert.equal(bridge.getState()[0].capabilities.stop, true);
  await bridge.command('p1s', 'stop');
  assert.equal(clients[0].published[1].payload.print.command, 'stop');
  report(clients[0], { print: { gcode_state: 'FAILED' } });
  assert.equal(bridge.getState()[0].lastCommand.status, 'confirmed');
  bridge.close();
});

test('matched negative responses report rejection and authorization failures block further controls', async () => {
  const { bridge, clients } = harness({ controls: true });
  bridge.configure([{ ...config, controlAccess: true }]); clients[0].emit('connect');
  report(clients[0], { print: { gcode_state: 'RUNNING' } });
  const result = await bridge.command('p1s', 'pause');
  report(clients[0], { print: { sequence_id: 'unrelated', result: 'fail', reason: 'authorization' } });
  assert.equal(bridge.getState()[0].lastCommand.status, 'sent');
  report(clients[0], { print: { sequence_id: Number(result.sequenceId), result: 'fail', reason: 'authorization verification failed' } });
  assert.equal(bridge.getState()[0].lastCommand.status, 'rejected');
  assert.equal(bridge.getState()[0].capabilities.pause, false);
  await assert.rejects(bridge.command('p1s', 'pause'), /authorization rejected/);
  bridge.close();
});

function p1Filament() {
  return { print: {
    gcode_state: 'IDLE', ams_status: 0, hw_switch_state: 0,
    ams: { tray_now: '255', tray_exist_bits: '3', ams: [{ id: '0', tray: [
      { id: '0', tray_type: 'PLA', nozzle_temp_min: '190', nozzle_temp_max: '230' },
      { id: '1', tray_type: 'PETG', nozzle_temp_min: '230', nozzle_temp_max: '250' },
    ] }] },
  } };
}

test('AMS colors accept only reported RGB/RGBA hex and retain valid colors across delta updates', () => {
  const { bridge, clients } = harness();
  bridge.configure([config]); clients[0].emit('connect');
  const payload = p1Filament();
  payload.print.ams.ams[0].tray[0].tray_color = 'aa22ccff';
  payload.print.ams.ams[0].tray[1].tray_color = '33bb55';
  report(clients[0], payload);
  assert.deepEqual(bridge.getState()[0].filament.slots.map(slot => slot.color), ['AA22CCFF', '33BB55']);
  report(clients[0], { print: { ams: { ams: [{ id: '0', tray: [{ id: '0', tray_type: 'PLA-CF' }] }] } } });
  assert.equal(bridge.getState()[0].filament.slots[0].color, 'AA22CCFF');
  for (const invalid of ['#aa22cc', 'red', 'aa22ccff00', ' url(example)', null, 123456]) {
    report(clients[0], { print: { ams: { ams: [{ id: '0', tray: [{ id: '0', tray_color: invalid }] }] } } });
    assert.equal(bridge.getState()[0].filament.slots[0].color, null);
  }
  assert.equal(clients[0].published.length, 0);
  bridge.close();
});

test('P1S loads a present AMS slot using material temperatures and confirms from filament telemetry', async () => {
  const { bridge, clients } = harness({ controls: true });
  bridge.configure([{ ...config, controlAccess: true }]); clients[0].emit('connect');
  report(clients[0], p1Filament());
  assert.equal(bridge.getState()[0].capabilities.loadFilament, true);
  assert.equal(bridge.getState()[0].filament.slots.length, 2);
  await assert.rejects(bridge.command('p1s', 'loadFilament', { amsId: 0, slotId: 3 }), /absent/);
  const result = await bridge.command('p1s', 'loadFilament', { amsId: 0, slotId: 1 });
  assert.deepEqual(clients[0].published[0].payload, { print: {
    sequence_id: result.sequenceId, command: 'ams_change_filament', curr_temp: -1, tar_temp: 240, ams_id: 0, target: 1, slot_id: 1,
  } });
  report(clients[0], { print: { ams_status: 256, hw_switch_state: 1, ams: { tray_now: '1' } } });
  assert.equal(bridge.getState()[0].lastCommand.status, 'sent');
  report(clients[0], { print: { ams_status: 0 } });
  assert.equal(bridge.getState()[0].lastCommand.status, 'confirmed');
  assert.equal(bridge.getState()[0].capabilities.unloadFilament, true);
  bridge.close();
});

test('P1S unload uses target/slot 255 and does not claim completion until filament is absent', async () => {
  const { bridge, clients } = harness({ controls: true });
  bridge.configure([{ ...config, controlAccess: true }]); clients[0].emit('connect');
  const payload = p1Filament(); payload.print.hw_switch_state = 1; payload.print.ams.tray_now = '0';
  report(clients[0], payload);
  const result = await bridge.command('p1s', 'unloadFilament');
  assert.deepEqual(clients[0].published[0].payload.print, { sequence_id: result.sequenceId, command: 'ams_change_filament', curr_temp: 210, tar_temp: 210, ams_id: 0, target: 255, slot_id: 255 });
  report(clients[0], { print: { nozzle_temper: 210 } });
  assert.equal(bridge.getState()[0].lastCommand.status, 'sent');
  report(clients[0], { print: { hw_switch_state: 0, ams: { tray_now: '255' } } });
  assert.equal(bridge.getState()[0].lastCommand.status, 'confirmed');
  bridge.close();
});

test('filament controls reject busy, printing, unknown loading state, and invalid temperature', async () => {
  const { bridge, clients } = harness({ controls: true });
  bridge.configure([{ ...config, controlAccess: true }]); clients[0].emit('connect');
  const payload = p1Filament(); delete payload.print.ams_status;
  report(clients[0], payload);
  await assert.rejects(bridge.command('p1s', 'loadFilament', { amsId: 0, slotId: 0 }), /loading state/);
  report(clients[0], { print: { ams_status: 256 } });
  await assert.rejects(bridge.command('p1s', 'loadFilament', { amsId: 0, slotId: 0 }), /already loading/);
  report(clients[0], { print: { ams_status: 0, gcode_state: 'RUNNING' } });
  await assert.rejects(bridge.command('p1s', 'loadFilament', { amsId: 0, slotId: 0 }), /idle printer/);
  report(clients[0], { print: { gcode_state: 'IDLE' } });
  await assert.rejects(bridge.command('p1s', 'loadFilament', { amsId: 0, slotId: 0, targetTemperature: 350 }), /valid nozzle/);
  assert.equal(clients[0].published.length, 0);
  bridge.close();
});

test('H2D requires FDM mode, a reported single-bound nozzle, and explicit matching selection', async () => {
  const { bridge, clients } = harness({ controls: true });
  bridge.configure([{ ...config, model: 'H2D', controlAccess: true }]); clients[0].emit('connect');
  const payload = p1Filament();
  payload.print.ams.ams[0].info = '100'; // Explicit AMS binding to left extruder 1.
  payload.print.device = { extruder: { state: 0, info: [{ id: 1, info: 0, snow: 65535 }] } };
  report(clients[0], payload);
  await assert.rejects(bridge.command('p1s', 'loadFilament', { amsId: 0, slotId: 0, extruderId: 1 }), /3D-printing mode/);
  report(clients[0], { print: { device: { type: 1 } } });
  await assert.rejects(bridge.command('p1s', 'loadFilament', { amsId: 0, slotId: 0 }), /Choose the nozzle/);
  await assert.rejects(bridge.command('p1s', 'loadFilament', { amsId: 0, slotId: 0, extruderId: 0 }), /Choose the nozzle/);
  const result = await bridge.command('p1s', 'loadFilament', { amsId: 0, slotId: 0, extruderId: 1 });
  assert.equal(clients[0].published[0].payload.print.extruder_id, 1);
  assert.equal(clients[0].published[0].payload.print.target, 0);
  report(clients[0], { print: { device: { extruder: { state: 0, info: [{ id: 1, info: 2, snow: 0 }] } } } });
  assert.equal(bridge.getState()[0].lastCommand.status, 'confirmed');
  assert.equal(result.status, 'sent');
  bridge.close();
});

test('H2D unknown switch routing never gets a guessed filament command', async () => {
  const { bridge, clients } = harness({ controls: true });
  bridge.configure([{ ...config, model: 'H2D', controlAccess: true }]); clients[0].emit('connect');
  const payload = p1Filament(); payload.print.ams.ams[0].info = 'e00';
  payload.print.device = { type: 1, extruder: { state: 0, info: [{ id: 0, info: 0, snow: 65535 }] } };
  report(clients[0], payload);
  assert.equal(bridge.getState()[0].capabilities.loadFilament, false);
  await assert.rejects(bridge.command('p1s', 'loadFilament', { amsId: 0, slotId: 0, extruderId: 0 }), /Unknown H2D routing/);
  assert.equal(clients[0].published.length, 0);
  bridge.close();
});

test('filament temperature rejection and stale commands stay distinct from success', async () => {
  const { bridge, clients, advance } = harness({ controls: true });
  bridge.configure([{ ...config, controlAccess: true }]); clients[0].emit('connect');
  report(clients[0], p1Filament());
  let result = await bridge.command('p1s', 'loadFilament', { amsId: 0, slotId: 0 });
  report(clients[0], { print: { sequence_id: result.sequenceId, command: 'ams_change_filament', errno: -2 } });
  assert.equal(bridge.getState()[0].lastCommand.status, 'rejected');
  assert.match(bridge.getState()[0].lastCommand.message, /chamber is too hot/);
  result = await bridge.command('p1s', 'loadFilament', { amsId: 0, slotId: 0 });
  advance(21000);
  assert.equal(bridge.getState()[0].lastCommand.status, 'unconfirmed');
  assert.equal(bridge.getState()[0].lastCommand.sequenceId, result.sequenceId);
  bridge.close();
});

test('unacknowledged physical actions are removed before automatic reconnect', async () => {
  const { bridge, clients } = harness({ controls: true, delayedPublish: true });
  bridge.configure([{ ...config, controlAccess: true }]); clients[0].emit('connect');
  report(clients[0], { print: { gcode_state: 'RUNNING' } });
  const action = bridge.command('p1s', 'pause');
  clients[0].emit('close');
  assert.deepEqual(clients[0].removed, [1]);
  clients[0].published[0].callback(new Error('upstream may include secrets TESTCODE'));
  await assert.rejects(action, /could not confirm/);
  assert.equal(bridge.getState()[0].lastCommand.status, 'unconfirmed');
  assert.ok(!JSON.stringify(bridge.getState()).includes('TESTCODE'));
  bridge.close();
});

test('camera protocol is normalized without exposing credential-bearing URLs', () => {
  const unknown = normalizeTelemetry({ print: { gcode_state: 'IDLE' } }, {}, epoch);
  assert.equal(unknown.camera.protocol, null);
  const state = normalizeTelemetry({ print: { ipcam: { liveview: { local: 'rtsps' }, rtsp_url: 'rtsps://bblp:TESTCODE@192.168.1.50/streaming/live/1' } } }, {}, epoch);
  assert.deepEqual(state.camera, { protocol: 'rtsps' });
  assert.ok(!JSON.stringify(state).includes('TESTCODE'));
  const disabled = normalizeTelemetry({ print: { ipcam: { rtsp_url: 'disable' } } }, state, epoch);
  assert.equal(disabled.camera.protocol, 'disabled');
  const none = normalizeTelemetry({ print: { ipcam: { liveview: { local: 'none' } } } }, unknown, epoch);
  assert.equal(none.camera.protocol, 'none');
});

function manualPrinter(model = 'P1S', extra = {}) {
  const fixture = harness({ controls: true });
  fixture.bridge.configure([{ ...config, model, controlAccess: true }]);
  fixture.client = fixture.clients[0]; fixture.client.emit('connect');
  const print = {
    gcode_state: 'IDLE', ams_status: 0, home_flag: 7,
    nozzle_temper: 25, nozzle_target_temper: 0, bed_temper: 26, bed_target_temper: 0,
    ...(model === 'H2D' ? { device: { type: 1, extruder: { state: 16, info: [{ id: 0, temp: 25 }, { id: 1, temp: 27 }] } } } : {}),
    ...extra,
  };
  report(fixture.client, { print });
  return fixture;
}

test('normalizes reported H2D nozzle identities, packed targets, active nozzle and signed homing bits', () => {
  const { bridge, client } = manualPrinter('H2D', {
    home_flag: -1066969960, device: { type: 1, bed_temp: (60 << 16) | 26, extruder: { state: 16, info: [
      { id: 0, temp: (210 << 16) | 205 }, { id: 1, temp: (250 << 16) | 247 },
    ] } },
  });
  let state = bridge.getState()[0];
  assert.deepEqual(state.temperatures, {
    nozzles: [
      { id: 0, label: 'Right nozzle', current: 205, target: 210, active: false },
      { id: 1, label: 'Left nozzle', current: 247, target: 250, active: true },
    ], bed: { current: 26, target: 60 },
  });
  assert.deepEqual(state.motion, { homed: { X: false, Y: false, Z: false }, position: null });
  assert.equal(state.capabilities.moveAxis, false);
  report(client, { print: { home_flag: -1066969953, bed_temperature_limit: 110, mc_percent: 1 } });
  state = bridge.getState()[0];
  assert.deepEqual(state.motion.homed, { X: true, Y: true, Z: true });
  assert.equal(state.temperatures.nozzles[1].target, 250);
  assert.equal(state.controlLimits.bed.max, 110);
  assert.ok(Object.keys(state).every(key => !key.startsWith('_')));
  bridge.close();
});

test('P1S nozzle temperature uses a bounded fixed command, confirms target rather than actual heat', async () => {
  const { bridge, client } = manualPrinter();
  for (const params of [{ target: 200 }, { extruderId: 1, target: 200 }, { extruderId: 0, target: 301 }, { extruderId: 0, target: -1 }, { extruderId: 0, target: '200' }, { extruderId: 0, target: 200, gcode: 'G28' }]) {
    await assert.rejects(bridge.command('p1s', 'setNozzleTemperature', params));
  }
  const sent = await bridge.command('p1s', 'setNozzleTemperature', { extruderId: 0, target: 300 });
  assert.deepEqual(client.published[0].payload, { print: { sequence_id: sent.sequenceId, command: 'gcode_line', param: 'M104 S300\n' } });
  report(client, { print: { sequence_id: sent.sequenceId, result: 'success' } });
  assert.equal(bridge.getState()[0].lastCommand.status, 'accepted');
  report(client, { print: { nozzle_temper: 300 } });
  assert.equal(bridge.getState()[0].lastCommand.status, 'accepted');
  report(client, { print: { nozzle_target_temper: 300 } });
  assert.equal(bridge.getState()[0].lastCommand.status, 'confirmed');
  assert.match(bridge.getState()[0].lastCommand.message, /temperature target/);
  await bridge.command('p1s', 'setNozzleTemperature', { extruderId: 0, target: 0 });
  assert.equal(client.published[1].payload.print.param, 'M104 S0\n');
  bridge.close();
});

test('H2D requires an explicit reported nozzle and uses set_nozzle_temp with correct index', async () => {
  const { bridge, client } = manualPrinter('H2D');
  for (const params of [{ target: 200 }, { extruderId: 2, target: 200 }, { extruderId: 1, target: 351 }]) await assert.rejects(bridge.command('p1s', 'setNozzleTemperature', params));
  const sent = await bridge.command('p1s', 'setNozzleTemperature', { extruderId: 1, target: 350 });
  assert.deepEqual(client.published[0].payload.print, { sequence_id: sent.sequenceId, command: 'set_nozzle_temp', extruder_index: 1, target_temp: 350 });
  report(client, { print: { device: { extruder: { info: [{ id: 0, temp: (350 << 16) | 25 }] } } } });
  assert.equal(bridge.getState()[0].lastCommand.status, 'sent');
  report(client, { print: { device: { extruder: { info: [{ id: 1, temp: (350 << 16) | 27 }] } } } });
  assert.equal(bridge.getState()[0].lastCommand.status, 'confirmed');
  await bridge.command('p1s', 'setNozzleTemperature', { extruderId: 0, target: 0 });
  assert.equal(client.published[1].payload.print.extruder_index, 0);
  assert.equal(client.published[1].payload.print.target_temp, 0);
  bridge.close();
});

test('bed targets honor model and reported limits, native capability, zero off, and telemetry confirmation', async () => {
  for (const [model, maximum] of [['P1S', 100], ['H2D', 120]]) {
    const { bridge, client } = manualPrinter(model);
    await assert.rejects(bridge.command('p1s', 'setBedTemperature', { target: maximum + 1 }), /temperature/);
    await bridge.command('p1s', 'setBedTemperature', { target: maximum });
    assert.equal(client.published[0].payload.print.param, `M140 S${maximum}\n`);
    report(client, { print: { bed_target_temper: maximum } });
    assert.equal(bridge.getState()[0].lastCommand.status, 'confirmed');
    report(client, { print: { fun: (1n << 39n).toString(16), bed_temperature_limit: 80 } });
    await assert.rejects(bridge.command('p1s', 'setBedTemperature', { target: 81 }), /0 to 80/);
    const result = await bridge.command('p1s', 'setBedTemperature', { target: 0 });
    assert.deepEqual(client.published[1].payload.print, { sequence_id: result.sequenceId, command: 'set_bed_temp', temp: 0 });
    report(client, { print: { device: { bed_temp: 26 } } });
    assert.equal(bridge.getState()[0].lastCommand.status, 'confirmed');
    bridge.close();
  }
});

test('manual home uses verified capability or fixed G28 and requires observed homing before confirmation', async () => {
  for (const native of [false, true]) {
    const { bridge, client } = manualPrinter('P1S', { home_flag: 0, fun: native ? (1n << 32n).toString(16) : '0' });
    assert.deepEqual(bridge.getState()[0].motion.homed, { X: null, Y: null, Z: null });
    await assert.rejects(bridge.command('p1s', 'moveAxis', { axis: 'X', distance: 1 }), /Home the printer/);
    const result = await bridge.command('p1s', 'homeAxes');
    assert.deepEqual(client.published[0].payload.print, native ? { sequence_id: result.sequenceId, command: 'back_to_center' } : { sequence_id: result.sequenceId, command: 'gcode_line', param: 'G28 \n' });
    report(client, { print: { sequence_id: result.sequenceId, result: 'success' } });
    assert.equal(bridge.getState()[0].lastCommand.status, 'accepted');
    report(client, { print: { home_flag: 7, stg_cur: 13 } });
    assert.equal(bridge.getState()[0].lastCommand.status, 'accepted');
    assert.equal(bridge.getState()[0].capabilities.moveAxis, false);
    report(client, { print: { home_flag: 7, stg_cur: -1 } });
    assert.equal(bridge.getState()[0].lastCommand.status, 'confirmed');
    assert.equal(bridge.getState()[0].capabilities.moveAxis, true);
    bridge.close();
  }
});

test('jog uses only small XYZ steps, bounded feed, and preserves coordinate/endstop settings', async () => {
  const { bridge, client, advance } = manualPrinter();
  for (const params of [{ axis: 'E', distance: 1 }, { axis: 'X\nG28', distance: 1 }, { axis: 'X', distance: 100 }, { axis: 'X', distance: 0 }, { axis: 'X', distance: '1' }, { axis: 'X', distance: 1, speed: 90000 }]) await assert.rejects(bridge.command('p1s', 'moveAxis', params));
  assert.equal(client.published.length, 0);
  const result = await bridge.command('p1s', 'moveAxis', { axis: 'X', distance: -0.1 });
  assert.equal(client.published[0].payload.print.param, 'M211 S \nM211 X1 Y1 Z1\nM1002 push_ref_mode\nG91 \nG1 X-0.1 F3000\nM1002 pop_ref_mode\nM211 R\n');
  await assert.rejects(bridge.command('p1s', 'moveAxis', { axis: 'X', distance: 1 }), /previous printer action/);
  assert.match(result.message, /Movement requested; position is not reported/);
  advance(1000);
  assert.equal(bridge.getState()[0].capabilities.setBedTemperature, true);
  await bridge.command('p1s', 'moveAxis', { axis: 'Z', distance: 10 });
  assert.match(client.published[1].payload.print.param, /G1 Z10\.0 F900/);
  advance(1000);
  await bridge.command('p1s', 'moveAxis', { axis: 'Y', distance: 1 });
  assert.match(client.published[2].payload.print.param, /G1 Y1\.0 F3000/);
  advance(21000);
  report(client, { print: { bed_temper: 26 } });
  assert.equal(bridge.getState()[0].lastCommand.status, 'sent');
  assert.match(bridge.getState()[0].lastCommand.message, /position is not reported/);
  assert.equal(bridge.getState()[0].capabilities.homeAxes, true);
  assert.equal(bridge.getState()[0].motion.position, null);
  bridge.close();
});

test('movement blocks active jobs, unknown or busy filament state, non-FDM H2D, stale and disconnected status', async () => {
  const { bridge, client, advance } = manualPrinter('H2D');
  for (const gcode_state of ['RUNNING', 'PREPARE', 'SLICING', 'PAUSE']) {
    report(client, { print: { gcode_state } });
    for (const action of ['homeAxes', 'moveAxis']) await assert.rejects(bridge.command('p1s', action, action === 'moveAxis' ? { axis: 'X', distance: 1 } : {}), /idle printer/);
  }
  report(client, { print: { gcode_state: 'IDLE', device: { extruder: { state: 1 << 19 } } } });
  await assert.rejects(bridge.command('p1s', 'homeAxes'), /filament loading/);
  report(client, { print: { device: { extruder: { state: null } } } });
  await assert.rejects(bridge.command('p1s', 'homeAxes'), /loading state/);
  report(client, { print: { device: { type: 0x10, extruder: { state: 0 } } } });
  for (const action of ['homeAxes', 'setBedTemperature', 'setNozzleTemperature']) await assert.rejects(bridge.command('p1s', action), /3D-printing mode/);
  report(client, { print: { device: { type: 1 } } });
  advance(5001);
  await assert.rejects(bridge.command('p1s', 'homeAxes'), /Fresh connected/);
  report(client, { print: { bed_temper: 25 } }); client.emit('close');
  await assert.rejects(bridge.command('p1s', 'homeAxes'), /Fresh connected/);
  assert.equal(client.published.length, 0);
  bridge.close();
});

test('stage uses raw stg_cur, survives sparse telemetry and keeps merge state private', () => {
  const { bridge, clients } = harness();
  bridge.configure([config]); clients[0].emit('connect');
  report(clients[0], { print: { gcode_state: 'RUNNING', stg_cur: 7, mc_print_stage: '1' } });
  assert.equal(bridge.getState()[0].stage.label, 'Heating nozzle');
  report(clients[0], { print: { mc_percent: 5 } });
  assert.equal(bridge.getState()[0].stage.code, 7);
  assert.equal(Object.hasOwn(bridge.getState()[0], '_printStage'), false);
  report(clients[0], { print: { gcode_state: 'FINISH' } });
  assert.equal(bridge.getState()[0].stage.code, null);
  bridge.close();
});

test('manual homing blocks movement despite terminal display labels and stale already-homed reports do not confirm Home', async () => {
  const { bridge, client } = manualPrinter('P1S', { gcode_state: 'FINISH', stg_cur: 13 });
  assert.equal(bridge.getState()[0].stage.code, null);
  assert.equal(bridge.getState()[0].capabilities.homeAxes, false);
  assert.equal(bridge.getState()[0].capabilities.moveAxis, false);
  report(client, { print: { bed_temper: 25 } });
  assert.equal(bridge.getState()[0].capabilities.moveAxis, false);
  report(client, { print: { stg_cur: -1 } });
  await bridge.command('p1s', 'homeAxes');
  report(client, { print: { home_flag: 7 } });
  assert.equal(bridge.getState()[0].lastCommand.status, 'sent');
  report(client, { print: { stg_cur: 13 } });
  report(client, { print: { home_flag: 7, stg_cur: 0 } });
  assert.equal(bridge.getState()[0].lastCommand.status, 'confirmed');
  report(client, { print: { stg_cur: 13 } });
  report(client, { print: { gcode_state: 'PREPARE', subtask_id: 'new-job' } });
  report(client, { print: { gcode_state: 'FINISH' } });
  assert.equal(bridge.getState()[0].capabilities.homeAxes, true);
  bridge.close();
});

test('a jog still awaiting broker acknowledgement cannot release controls after one second', async () => {
  const { bridge, clients, advance } = harness({ controls: true, delayedPublish: true });
  bridge.configure([{ ...config, controlAccess: true }]); clients[0].emit('connect');
  report(clients[0], { print: { gcode_state: 'IDLE', ams_status: 0, home_flag: 7 } });
  const pending = bridge.command('p1s', 'moveAxis', { axis: 'X', distance: 1 });
  advance(1500);
  await assert.rejects(bridge.command('p1s', 'moveAxis', { axis: 'X', distance: 1 }), /previous printer action/);
  clients[0].published[0].callback(null);
  await pending;
  assert.equal(bridge.getState()[0].capabilities.moveAxis, true);
  bridge.close();
});

test('sparse filename or start-time identities reach stage merging and clear a previous job phase', () => {
  for (const key of ['gcode_file', 'gcode_start_time']) {
    const { bridge, clients } = harness();
    bridge.configure([config]); clients[0].emit('connect');
    report(clients[0], { print: { gcode_state: 'RUNNING', [key]: '100', stg_cur: 7 } });
    assert.equal(bridge.getState()[0].stage.code, 7);
    report(clients[0], { print: { [key]: '200' } });
    assert.equal(bridge.getState()[0].stage.code, null);
    bridge.close();
  }
});

test('a finished print records when it finished and when it started', () => {
  const start = Math.floor(Date.parse('2026-11-07T18:00:00Z') / 1000);
  const printing = normalizeTelemetry({ print: { gcode_state: 'RUNNING', mc_percent: 99, subtask_name: 'Leg', gcode_start_time: String(start) } }, { model: 'P1S' }, Date.parse('2026-11-07T21:00:00Z'));
  assert.equal(printing.jobStartedAt, '2026-11-07T18:00:00.000Z');
  assert.equal(printing.finishedAt, null);
  const finished = normalizeTelemetry({ print: { gcode_state: 'FINISH', mc_percent: 100 } }, printing, Date.parse('2026-11-07T21:12:00Z'));
  assert.equal(finished.finishedAt, '2026-11-07T21:12:00.000Z');
  const later = normalizeTelemetry({ print: { gcode_state: 'FINISH' } }, finished, Date.parse('2026-11-07T22:00:00Z'));
  assert.equal(later.finishedAt, '2026-11-07T21:12:00.000Z', 'the finish time stays while it remains finished');
  assert.equal(normalizeTelemetry({ print: { gcode_state: 'IDLE' } }, later, Date.parse('2026-11-07T23:00:00Z')).finishedAt, null);
});

test('a print already finished when the dashboard connects gets no made-up finish time', () => {
  const connected = normalizeTelemetry({ print: { gcode_state: 'FINISH', mc_percent: 100, subtask_name: 'Leg' } }, { model: 'P1S', status: 'connecting' }, Date.now());
  assert.equal(connected.status, 'finished'); assert.equal(connected.finishedAt, null);
});
