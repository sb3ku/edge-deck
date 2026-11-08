'use strict';

const dns = require('node:dns');
const net = require('node:net');
const { randomUUID } = require('node:crypto');
const { readPrintStage } = require('./print-stage.cjs');
const { projectFileCommand, validPlan } = require('./reprint.cjs');

/*
 * Bambu LAN telemetry and explicitly enabled controls for P1S / H2D.
 *
 * MQTT port, credentials, topic and print.* field names below follow the widely
 * used, unofficial LAN telemetry format, not a promised public Bambu API.
 * Firmware / LAN settings can change availability. H2D dual-nozzle fields are
 * deliberately not guessed: absent legacy nozzle_temper remains null.
 *
 * Controls follow BambuStudio commit 8f588cdb6893bb88415a62f5520b1a8e27a4c8ec:
 * DeviceManager.cpp command_task_* / command_ams_change_filament;
 * DeviceCore/DevExtruderSystem.cpp and DevFilaSystem.cpp telemetry parsing;
 * DeviceCore/DevAxisCtrl.cpp fixed XYZ motion templates preserve reference mode
 * and enable software endstops. No user-supplied G-code is accepted.
 * No arbitrary G-code or changes to Developer Mode. A bounded read-only
 * pushing/pushall request obtains the initial status after subscribing.
 * Physical controls remain disabled without controlAccess===true.
 * TLS verification is on unless the user explicitly enables allowSelfSigned.
 */

const STATUS_MAP = Object.freeze({
  RUNNING: 'printing', PREPARE: 'printing', SLICING: 'printing', PAUSE: 'paused',
  FINISH: 'finished', FAILED: 'error', IDLE: 'idle', READY: 'idle',
});
const TELEMETRY_KEYS = [
  'gcode_state', 'mc_percent', 'mc_remaining_time', 'nozzle_temper',
  'bed_temper', 'subtask_name', 'subtask_id', 'task_id', 'project_id',
  'job_attr', 'ams', 'ams_status', 'hw_switch_state', 'device', 'ipcam',
  'nozzle_target_temper', 'bed_target_temper', 'bed_temperature_limit', 'home_flag', 'fun', 'stg_cur',
  'gcode_file', 'gcode_start_time', 'layer_num', 'total_layer_num', 'mapping', 'vt_tray',
];
const CONTROL_ACTIONS = ['pause', 'resume', 'stop', 'reprint', 'loadFilament', 'unloadFilament', 'setNozzleTemperature', 'setBedTemperature', 'moveAxis', 'homeAxes'];
const IN_FLIGHT = new Set(['sending', 'sent', 'accepted']);

function plainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function label(value, fallback = '', maxLength = 160) {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, maxLength)
    : fallback;
}

function numeric(value, min, max, clamp = true) {
  if (typeof value !== 'number' &&
      !(typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value.trim()))) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  if (!clamp && (number < min || number > max)) return null;
  return Math.min(max, Math.max(min, number));
}

function integer(value, min = 0, max = 0xffffffff) {
  const number = numeric(value, min, max, false);
  return number !== null && Number.isInteger(number) ? number : null;
}

function hex(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{1,128}$/i.test(value)) return null;
  return BigInt(`0x${value}`);
}

function temperature(minimum, maximum) {
  const min = numeric(minimum, 0, 400, false);
  const max = numeric(maximum, 0, 400, false);
  return min !== null && max !== null && min > 0 && max >= min ? Math.trunc((min + max) / 2) : null;
}

function updateFilament(previous, print) {
  const data = structuredClone(previous || { ams: [], extruders: [] });
  if (Object.hasOwn(print, 'ams_status')) data.amsStatus = integer(print.ams_status);
  if (Object.hasOwn(print, 'hw_switch_state')) data.hasFilament = integer(print.hw_switch_state, 0, 1);
  if (plainObject(print.ams)) {
    if (Object.hasOwn(print.ams, 'tray_exist_bits')) data.presence = hex(print.ams.tray_exist_bits)?.toString(16) ?? null;
    if (Object.hasOwn(print.ams, 'tray_now')) data.trayNow = integer(print.ams.tray_now, 0, 255);
    if (Array.isArray(print.ams.ams)) {
      if (!print.ams.ams.length) data.ams = [];
      for (const input of print.ams.ams.slice(0, 32)) {
        const id = integer(input?.id, 0, 255);
        if (id === null) continue;
        let ams = data.ams.find(item => item.id === id);
        if (!ams) { ams = { id, trays: [] }; data.ams.push(ams); }
        if (Object.hasOwn(input, 'info')) ams.info = hex(input.info)?.toString(16) ?? null;
        if (!Array.isArray(input.tray)) continue;
        for (const trayInput of input.tray.slice(0, 4)) {
          const slotId = integer(trayInput?.id, 0, 3);
          if (slotId === null) continue;
          let tray = ams.trays.find(item => item.id === slotId);
          if (!tray) { tray = { id: slotId }; ams.trays.push(tray); }
          for (const [source, target] of [['nozzle_temp_min', 'min'], ['nozzle_temp_max', 'max']]) {
            if (Object.hasOwn(trayInput, source)) tray[target] = numeric(trayInput[source], 0, 400, false);
          }
          if (Object.hasOwn(trayInput, 'tray_type')) tray.material = label(trayInput.tray_type, '', 40);
          if (Object.hasOwn(trayInput, 'tray_color')) {
            tray.color = typeof trayInput.tray_color === 'string' && /^(?:[a-f0-9]{6}|[a-f0-9]{8})$/i.test(trayInput.tray_color)
              ? trayInput.tray_color.toUpperCase() : null;
          }
        }
      }
    }
  }
  const extruder = print.device?.extruder;
  if (plainObject(extruder)) {
    if (Object.hasOwn(extruder, 'state')) data.extruderState = integer(extruder.state);
    if (Array.isArray(extruder.info)) {
      if (!extruder.info.length) data.extruders = [];
      for (const input of extruder.info.slice(0, 2)) {
        const id = integer(input?.id, 0, 1);
        if (id === null) continue;
        let item = data.extruders.find(value => value.id === id);
        if (!item) { item = { id }; data.extruders.push(item); }
        for (const field of ['info', 'snow', 'temp']) if (Object.hasOwn(input, field)) item[field] = integer(input[field]);
      }
    }
  }
  return data;
}

function filamentState(state) {
  const data = state._filament || {};
  const h2d = state.model.toUpperCase() === 'H2D';
  const presence = hex(data.presence);
  const busy = h2d
    ? (data.extruderState == null ? null : Boolean((data.extruderState >>> 19) & 1))
    : (data.amsStatus == null ? null : ((data.amsStatus >>> 8) & 255) !== 0);
  const extruders = h2d ? (data.extruders || []).map(item => ({
    id: item.id, label: item.id === 0 ? 'Right nozzle' : 'Left nozzle',
    hasFilament: item.info == null ? null : Boolean((item.info >>> 1) & 1),
    amsId: item.snow == null ? null : (item.snow >>> 8) & 255,
    slotId: item.snow == null ? null : item.snow & 255,
  })) : [{
    id: 0, label: 'Nozzle', hasFilament: data.hasFilament == null ? null : data.hasFilament === 1,
    amsId: data.trayNow == null || data.trayNow === 255 ? null : data.trayNow === 254 ? 254 : data.trayNow < 128 ? data.trayNow >>> 2 : data.trayNow,
    slotId: data.trayNow == null || data.trayNow === 255 ? null : data.trayNow === 254 ? 0 : data.trayNow & 3,
  }];
  const slots = [];
  for (const ams of data.ams || []) {
    // The verified subset excludes AMS HT and filament track switch routing.
    // Those require extra protocol-specific selection, not a guessed tool ID.
    if (ams.id > 15) continue;
    const binding = hex(ams.info);
    const extruderId = h2d ? (binding === null ? null : Number((binding >> 8n) & 15n)) : 0;
    if (extruderId === null || extruderId > 1 || !extruders.some(item => item.id === extruderId)) continue;
    for (const tray of ams.trays) {
      const present = presence !== null && Boolean(presence & (1n << BigInt(ams.id * 4 + tray.id)));
      if (!present) continue;
      slots.push({
        id: `${ams.id}:${tray.id}`, label: `AMS ${ams.id + 1} · slot ${tray.id + 1}`,
        amsId: ams.id, slotId: tray.id, extruderId,
        material: tray.material || '', color: tray.color || null, temperature: temperature(tray.min, tray.max),
      });
    }
  }
  const external = state._vtTray?.material ? { material: state._vtTray.material, color: state._vtTray.color } : null;
  return { busy, slots, extruders, external };
}

function cameraState(previous, input) {
  const next = { protocol: previous?.protocol ?? null };
  if (!plainObject(input)) return next;
  const local = input.liveview?.local;
  if (['none', 'disabled', 'local', 'rtsps', 'rtsp'].includes(local)) next.protocol = local;
  if (typeof input.rtsp_url === 'string') {
    if (input.rtsp_url === '') next.protocol = 'none';
    else if (input.rtsp_url === 'disable') next.protocol = 'disabled';
    else if (input.rtsp_url.startsWith('rtsps://')) next.protocol = 'rtsps';
    else if (input.rtsp_url.startsWith('rtsp://')) next.protocol = 'rtsp';
  }
  return next;
}

function updateTemperatures(state, print) {
  const h2d = state.model.toUpperCase() === 'H2D';
  const previous = state.temperatures || { nozzles: [], bed: { current: null, target: null } };
  let nozzles = previous.nozzles.map(item => ({ ...item }));
  if (h2d) {
    const activeId = state._filament?.extruderState == null ? null : (state._filament.extruderState >>> 4) & 15;
    nozzles = (state._filament?.extruders || []).map(item => ({
      id: item.id, label: item.id === 0 ? 'Right nozzle' : 'Left nozzle',
      current: item.temp == null ? null : numeric(item.temp & 65535, -50, 500, false),
      target: item.temp == null ? null : numeric((item.temp >>> 16) & 65535, 0, 500, false),
      active: activeId === null || activeId > 1 ? null : activeId === item.id,
    }));
  } else if (state.model.toUpperCase() === 'P1S' && (Object.hasOwn(print, 'nozzle_temper') || Object.hasOwn(print, 'nozzle_target_temper'))) {
    const nozzle = nozzles.find(item => item.id === 0) || { id: 0, label: 'Nozzle', current: null, target: null, active: true };
    if (Object.hasOwn(print, 'nozzle_temper')) nozzle.current = numeric(print.nozzle_temper, -50, 500, false);
    if (Object.hasOwn(print, 'nozzle_target_temper')) nozzle.target = numeric(print.nozzle_target_temper, 0, 500, false);
    nozzles = [nozzle];
  }
  const bed = { ...previous.bed };
  if (Object.hasOwn(print, 'bed_temper')) bed.current = numeric(print.bed_temper, -50, 200, false);
  if (Object.hasOwn(print, 'bed_target_temper')) bed.target = numeric(print.bed_target_temper, 0, 200, false);
  if (Object.hasOwn(print.device || {}, 'bed_temp')) {
    const packed = integer(print.device.bed_temp);
    bed.current = packed === null ? null : numeric(packed & 65535, -50, 200, false);
    bed.target = packed === null ? null : numeric((packed >>> 16) & 65535, 0, 200, false);
  }
  return { nozzles, bed };
}

function controlLimits(state) {
  const h2d = state.model.toUpperCase() === 'H2D';
  const bedMaximum = h2d ? 120 : 100;
  return {
    nozzle: { min: 0, max: h2d ? 350 : 300 },
    bed: { min: 0, max: state._bedLimit > 0 ? Math.min(bedMaximum, state._bedLimit) : bedMaximum },
    axis: { steps: [0.1, 1, 10] },
  };
}

function motionState(state) {
  // Studio special-cases home_flag===0 for legacy devices. Zero or absent
  // telemetry is not proof of homing, so the dashboard keeps it unknown.
  const flag = state._homeFlag;
  const known = flag != null && flag !== 0;
  return { homed: {
    X: known ? Boolean(flag & 1) : null,
    Y: known ? Boolean(flag & 2) : null,
    Z: known ? Boolean(flag & 4) : null,
  }, position: null };
}

function firmwareFeature(state, bit) {
  const flags = hex(state._features);
  return flags !== null && Boolean(flags & (1n << BigInt(bit)));
}

function isPrivateAddress(value) {
  const version = net.isIP(value);
  if (version === 4) {
    const [a, b] = value.split('.').map(Number);
    return a === 10 || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  if (version === 6) {
    const address = value.toLowerCase();
    // No public IPv6, loopback, multicast, or IPv4-mapped public addresses.
    return /^(fc|fd)[0-9a-f]{2}:/.test(address) || /^fe[89ab][0-9a-f]:/.test(address);
  }
  return false;
}

function isLanHost(value) {
  if (typeof value !== 'string' || value.length > 253 || value !== value.trim()) return false;
  if (net.isIP(value)) return isPrivateAddress(value);
  if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(value)) return false;
  if (value.split('.').some(part => !part || part.length > 63 || part.startsWith('-') || part.endsWith('-'))) return false;
  if (/^\d+(?:\.\d+)+$/.test(value)) return false;
  const host = value.toLowerCase();
  return (!host.includes('.') && host !== 'localhost') ||
    ['.local', '.lan', '.home', '.home.arpa', '.internal'].some(suffix => host.endsWith(suffix));
}

// Resolve configured LAN names here so they cannot redirect a credential-bearing
// MQTT connection to a public address. Node supplies numeric IPs without lookup.
function lanLookup(hostname, options, callback) {
  const lookupOptions = typeof options === 'number' ? { family: options } : (options || {});
  dns.lookup(hostname, { ...lookupOptions, all: true }, (error, addresses) => {
    if (error) return callback(error);
    const local = addresses.filter(item => isPrivateAddress(item.address));
    if (!local.length) {
      const failure = new Error('Printer hostname did not resolve to a local network address.');
      failure.code = 'ERR_PRINTER_NOT_LAN';
      return callback(failure);
    }
    if (lookupOptions.all) return callback(null, local);
    callback(null, local[0].address, local[0].family);
  });
}

function baseState(config = {}, index = 0) {
  return {
    id: label(config.id, `printer-${index + 1}`, 80) || `printer-${index + 1}`,
    name: label(config.name, 'Bambu printer', 80) || 'Bambu printer',
    model: label(config.model, '', 40),
    status: 'not_configured',
    progress: null,
    remainingMinutes: null,
    nozzle: null,
    bed: null,
    jobName: null,
    lastSeen: null,
    message: 'Add the printer IP address, serial number and LAN access code.',
  };
}

function normalizeTelemetry(payload, previous = {}, timestamp = Date.now()) {
  if (!plainObject(payload) || !plainObject(payload.print)) return null;
  const data = payload.print;
  if (!TELEMETRY_KEYS.some(key => Object.hasOwn(data, key))) return null;

  const next = { ...baseState(), ...previous };
  const incomingState = typeof data.gcode_state === 'string' ? data.gcode_state.toUpperCase() : null;
  const status = incomingState ? STATUS_MAP[incomingState] : null;
  const incomingName = Object.hasOwn(data, 'subtask_name') ? label(data.subtask_name, '', 240) || null : undefined;
  const jobIdValue = [data.subtask_id, data.task_id, data.project_id]
    .find(value => (typeof value === 'string' || typeof value === 'number') && String(value) !== '0' && String(value).trim());
  const incomingJobId = jobIdValue === undefined ? undefined : String(jobIdValue).slice(0, 160);

  const startsAfterTerminal = (status === 'printing' || status === 'paused') &&
    ['finished', 'idle', 'error'].includes(previous.status);
  const changedIdentity = (incomingJobId !== undefined && previous._jobId && incomingJobId !== previous._jobId) ||
    (incomingName && previous.jobName && incomingName !== previous.jobName);
  if (startsAfterTerminal || changedIdentity || status === 'idle') {
    // Delta packets do not always repeat every field. Never carry a previous
    // print's completion or ETA into the next print.
    next.progress = null;
    next.remainingMinutes = null;
    next.layer = null;
    next.totalLayers = null;
    next.jobName = null;
    next._jobId = null;
    next._gcodeFile = null;
    next.jobType = null;
  }

  if (incomingState) {
    next._gcodeState = incomingState;
    next.status = status || 'connecting';
    next.message = status === 'error' ? 'Printer reports a failed print.' :
      incomingState === 'PREPARE' ? 'Preparing print.' :
      status ? '' : 'Telemetry received; this printer state is not supported yet.';
  } else if (changedIdentity) {
    next._gcodeState = null;
    next.status = 'connecting';
    next.message = 'New job detected; waiting for its printer state.';
  } else if (['not_configured', 'offline', 'connecting'].includes(next.status)) {
    next.status = 'connecting';
    next.message = 'Telemetry received; waiting for the printer state.';
  }

  if (Object.hasOwn(data, 'gcode_start_time')) { const seconds = integer(data.gcode_start_time); next.jobStartedAt = seconds ? new Date(seconds * 1000).toISOString() : null; }
  // Only a finish the dashboard saw happen has a time; one already finished at connect has none.
  if (status === 'finished' && ['printing', 'paused'].includes(previous.status)) next.finishedAt = new Date(timestamp).toISOString();
  else if (status === 'finished' && previous.status !== 'finished') next.finishedAt = null;
  else if (status && status !== 'finished') next.finishedAt = null;
  if (status === 'finished') next.finishedSeenAt = previous.status === 'finished' && previous.finishedSeenAt ? previous.finishedSeenAt : new Date(timestamp).toISOString();
  else if (status) next.finishedSeenAt = null;
  if (Object.hasOwn(data, 'mc_percent')) next.progress = numeric(data.mc_percent, 0, 100);
  if (Object.hasOwn(data, 'mc_remaining_time')) next.remainingMinutes = numeric(data.mc_remaining_time, 0, 525600);
  if (Object.hasOwn(data, 'layer_num')) next.layer = integer(data.layer_num, 0, 100000);
  if (Object.hasOwn(data, 'total_layer_num')) next.totalLayers = integer(data.total_layer_num, 0, 100000);
  if (Object.hasOwn(data, 'nozzle_temper')) next.nozzle = numeric(data.nozzle_temper, -50, 500, false);
  if (Object.hasOwn(data, 'bed_temper')) next.bed = numeric(data.bed_temper, -50, 200, false);
  if (incomingName !== undefined) next.jobName = incomingName;
  if (incomingJobId !== undefined) next._jobId = incomingJobId;
  if (typeof data.gcode_file === 'string') next._gcodeFile = label(data.gcode_file, '', 400) || null;
  // The AMS slot each of the job's filaments came from (H2D): (ams_id << 8) | slot, 65535 for unused.
  if (Array.isArray(data.mapping) && data.mapping.length <= 64 && data.mapping.every(value => Number.isInteger(value) && value >= 0 && value <= 65535)) next._jobMapping = data.mapping.slice();
  // The external spool (what a printer without an AMS prints from).
  if (plainObject(data.vt_tray)) next._vtTray = { material: label(data.vt_tray.tray_type, '', 40), color: typeof data.vt_tray.tray_color === 'string' && /^[0-9A-Fa-f]{6,8}$/.test(data.vt_tray.tray_color) ? data.vt_tray.tray_color : null };
  if (Object.hasOwn(data, 'job_attr')) {
    const attribute = integer(data.job_attr);
    next.jobType = attribute === null ? null : (attribute >>> 4) & 15;
  }
  if (Object.hasOwn(data.device || {}, 'type')) next._deviceMode = integer(data.device.type);
  next._filament = updateFilament(next._filament, data);
  next.temperatures = updateTemperatures(next, data);
  if (Object.hasOwn(data, 'bed_temperature_limit')) next._bedLimit = integer(data.bed_temperature_limit, 1, 200);
  if (Object.hasOwn(data, 'home_flag')) {
    // Firmware also sends this bitfield as a signed 32-bit JSON integer.
    const flag = integer(data.home_flag, -2147483648, 0xffffffff);
    next._homeFlag = flag === null ? null : flag >>> 0;
  }
  if (Object.hasOwn(data, 'fun')) next._features = hex(data.fun)?.toString(16) ?? null;
  const printStage = readPrintStage(data, previous._printStage);
  next._printStage = printStage.state;
  next.stage = printStage.stage;
  // A manual home can report stg_cur while gcode_state still says FINISH/IDLE.
  // Keep the raw phase for the movement guard, independent of display labels.
  if (Object.hasOwn(data, 'stg_cur')) next._homing = integer(data.stg_cur, -1, 255) === 13;
  else if (startsAfterTerminal || changedIdentity) next._homing = false;
  next.motion = motionState(next);
  next.camera = cameraState(next.camera, data.ipcam);
  next.lastSeen = new Date(timestamp).toISOString();
  return next;
}

function safeConnectionError(error) {
  const code = String(error?.code || '');
  if (/CERT|TLS|SELF_SIGNED|UNABLE_TO_VERIFY|DEPTH_ZERO/.test(code)) {
    return 'Certificate validation failed. Check the printer certificate or explicitly allow its self-signed certificate in settings.';
  }
  if (code === 'ERR_PRINTER_NOT_LAN') return 'Printer hostname must resolve to a local network address.';
  if (code === '5' || code === '4' || /AUTH/.test(code)) return 'Printer sign-in failed. Check the serial number and LAN access code.';
  return 'Could not connect to the printer. Check its address, LAN access settings and network.';
}

function createPrinterBridge(options = {}) {
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const staleAfterMs = Number.isFinite(options.staleAfterMs) ? Math.max(1000, options.staleAfterMs) : 45000;
  const connect = options.connect || (settings => require('mqtt').connect(settings));
  const commandTimeoutMs = Number.isFinite(options.commandTimeoutMs) ? Math.max(1000, options.commandTimeoutMs) : 20000;
  const snapshotRetryMs = Number.isFinite(options.snapshotRetryMs) ? Math.max(1000, options.snapshotRetryMs) : 10000;
  const schedule = options.setTimeout || setTimeout;
  const unschedule = options.clearTimeout || clearTimeout;
  let sequence = Number.parseInt(randomUUID().slice(0, 8), 16) % 1000000000;
  let entries = [];

  function cancelSnapshotRetry(entry) {
    if (entry.snapshotTimer != null) unschedule(entry.snapshotTimer);
    entry.snapshotTimer = null;
  }

  function hasPrinterState(entry) { return Boolean(STATUS_MAP[entry.state._gcodeState]); }

  function requestSnapshot(entry) {
    cancelSnapshotRetry(entry);
    if (!entry.active || !entry.connected || !entry.subscribed || hasPrinterState(entry) || entry.snapshotAttempts >= 3) return;
    entry.snapshotAttempts++;
    entry.snapshotError = null;
    const payload = { pushing: {
      sequence_id: String(++sequence % 2147483647), command: 'pushall', version: 1, push_target: 1,
    } };
    // BambuStudio DeviceManager.cpp command_request_push_all. This asks for
    // telemetry; it cannot start/pause/stop printing, move axes or heat anything.
    try {
      entry.client.publish(entry.requestTopic, JSON.stringify(payload), { qos: 1, retain: false }, error => {
        if (!entry.active) return;
        if (error) entry.snapshotError = 'Could not send the initial status request. Check the printer network connection.';
      });
    } catch {
      entry.snapshotError = 'Could not send the initial status request. Check the printer network connection.';
    }
    if (!hasPrinterState(entry) && entry.snapshotAttempts < 3) {
      entry.snapshotTimer = schedule(() => requestSnapshot(entry), snapshotRetryMs);
      entry.snapshotTimer?.unref?.();
    }
  }

  function abortOutgoing(entry) {
    for (const messageId of entry.outgoing || []) {
      try { entry.client?.removeOutgoingMessage?.(messageId); } catch { /* Already acknowledged. */ }
    }
    entry.outgoing?.clear();
  }

  function close() {
    for (const entry of entries) {
      entry.active = false;
      cancelSnapshotRetry(entry);
      abortOutgoing(entry);
      try { entry.client?.end(true); } catch { /* Already closed. */ }
    }
    entries = [];
  }

  function snapshotFor(entry) {
      const { _jobId, _gcodeFile, _gcodeState, _filament, _deviceMode, _homeFlag, _features, _bedLimit, _homing, _printStage, _jobMapping, _vtTray, ...snapshot } = entry.state;
      if (entry.connected && !entry.failure) {
        const observedAt = snapshot.lastSeen ? Date.parse(snapshot.lastSeen) : entry.connectedAt;
        if (now() - observedAt > staleAfterMs) {
          snapshot.status = 'connecting';
          snapshot.message = snapshot.lastSeen
            ? 'Connected, but status is stale. Waiting for fresh printer telemetry.'
            : 'Connected to the printer, but no status has arrived. Check that the serial number belongs to this printer and that LAN status is available in its settings.';
        }
        if (!snapshot.lastSeen && entry.subscribed && now() - entry.connectedAt <= staleAfterMs) snapshot.message = entry.snapshotError || 'Connected. Requested printer status; waiting for its reply.';
      }
      snapshot.connection = {
        connected: entry.connected, subscribed: entry.subscribed,
        awaitingTelemetry: entry.connected && !hasPrinterState(entry),
        statusRequests: entry.snapshotAttempts, lastMessageAt: entry.lastMessageAt,
        statusRequestError: entry.snapshotError,
      };
      snapshot.controlAccess = entry.controlAccess;
      snapshot.filament = filamentState(entry.state);
      snapshot.temperatures ||= { nozzles: [], bed: { current: null, target: null } };
      snapshot.motion = motionState(entry.state);
      snapshot.controlLimits = controlLimits(entry.state);
      const lastCommand = entry.lastCommand && { ...entry.lastCommand };
      if (lastCommand && lastCommand.action !== 'moveAxis' && IN_FLIGHT.has(lastCommand.status) && now() - Date.parse(lastCommand.sentAt) > commandTimeoutMs) {
        lastCommand.status = 'unconfirmed';
        lastCommand.message = 'Command sent, but the requested printer change has not been confirmed. Check the printer before retrying.';
      }
      snapshot.lastCommand = lastCommand;
      const capabilities = Object.fromEntries([...CONTROL_ACTIONS, 'camera'].map(action => [action, false]));
      const reasons = {};
      const model = snapshot.model.toUpperCase();
      const pending = lastCommand && IN_FLIGHT.has(lastCommand.status) && (lastCommand.action !== 'moveAxis' || lastCommand.status === 'sending' || now() - Date.parse(lastCommand.sentAt) < 1000);
      let common = null;
      if (!entry.controlAccess) common = 'Enable LAN controls in this printer’s settings first.';
      else if (!['P1S', 'H2D'].includes(model)) common = 'Controls are not verified for this printer model.';
      else if (!entry.connected || entry.failure || !snapshot.lastSeen || now() - Date.parse(snapshot.lastSeen) > staleAfterMs || ['not_configured', 'connecting', 'offline'].includes(snapshot.status)) common = 'Fresh connected printer status is required before sending controls.';
      else if (entry.controlBlocked) common = entry.controlBlocked;
      for (const action of CONTROL_ACTIONS) reasons[action] = common || '';
      if (!common) {
        const pendingReason = pending ? 'Wait for the previous printer action to finish or be confirmed.' : '';
        reasons.pause = pendingReason || (_gcodeState === 'RUNNING' ? '' : 'Pause is available while the printer is running.');
        reasons.resume = pendingReason || (_gcodeState !== 'PAUSE' ? 'Resume is available for a paused print.' : model === 'H2D' && snapshot.jobType == null ? 'Waiting for the H2D job type before enabling remote resume.' : snapshot.jobType > 1 ? 'Resume laser or other processing jobs on the printer itself.' : '');
        // Print again: an idle printer whose last job is known (the plan checks the rest).
        reasons.reprint = pendingReason || (!['IDLE', 'READY', 'FINISH', 'FAILED'].includes(_gcodeState) ? 'Print again is available once the printer is idle.' : '') ||
          (model === 'H2D' && (_deviceMode == null || !(_deviceMode & 1) || (_deviceMode & 0x110)) ? 'Print again requires reported H2D 3D-printing mode.' : '') ||
          (!(entry.state.jobName || entry.state._gcodeFile) ? 'The printer has not reported a previous job.' : '');
        // Stop remains available while a pause/resume request is unconfirmed.
        reasons.stop = pending && lastCommand.action === 'stop' ? pendingReason : ['RUNNING', 'PAUSE', 'SLICING', 'PREPARE'].includes(_gcodeState) ? '' : 'There is no active print to stop.';
        const filament = snapshot.filament;
        let filamentReason = pendingReason;
        if (!filamentReason && !['IDLE', 'READY', 'FINISH', 'PAUSE'].includes(_gcodeState)) filamentReason = 'Filament actions require an idle printer or an eligible paused print.';
        if (!filamentReason && model === 'H2D' && (_deviceMode == null || !(_deviceMode & 1) || (_deviceMode & 0x110))) filamentReason = 'H2D filament actions require reported 3D-printing mode.';
        if (!filamentReason && filament.busy == null) filamentReason = 'Waiting for the printer’s filament loading state.';
        if (!filamentReason && filament.busy) filamentReason = 'The printer is already loading or unloading filament.';
        const loadable = filament.slots.filter(slot => {
          const extruder = filament.extruders.find(item => item.id === slot.extruderId);
          return extruder && extruder.hasFilament !== null && !(extruder.hasFilament && extruder.amsId === slot.amsId && extruder.slotId === slot.slotId);
        });
        reasons.loadFilament = filamentReason || (_gcodeState === 'PAUSE' ? 'AMS slot changes are unavailable during a paused print; use the printer for external-spool changes.' : !loadable.length ? 'No supported, present AMS slot is available to load. Unknown H2D routing and external-spool loading are not enabled.' : '');
        const unloadable = filament.extruders.filter(extruder => canUnload(extruder, filament, model, _gcodeState));
        reasons.unloadFilament = filamentReason || (!unloadable.length ? 'No loaded filament with a verified nozzle and AMS mapping is available to unload.' : '');
        snapshot.filament.loadableSlots = loadable;
        snapshot.filament.unloadableExtruders = unloadable;
        const modeReason = model === 'H2D' && (_deviceMode == null || !(_deviceMode & 1) || (_deviceMode & 0x110)) ? 'Manual controls require reported H2D 3D-printing mode.' : '';
        reasons.setNozzleTemperature = pendingReason || modeReason || (!snapshot.temperatures.nozzles.some(item => item.current !== null || item.target !== null) ? 'Waiting for reported nozzle IDs and temperature telemetry.' : '');
        reasons.setBedTemperature = pendingReason || modeReason || (snapshot.temperatures.bed.current === null && snapshot.temperatures.bed.target === null ? 'Waiting for bed temperature telemetry.' : '');
        const movementReason = pendingReason || modeReason || (!['IDLE', 'READY', 'FINISH'].includes(_gcodeState) ? 'Manual movement requires an idle printer; printing, preparing and paused jobs are blocked.' : '') ||
          (filament.busy == null ? 'Waiting for the filament loading state before manual movement.' : filament.busy ? 'Wait for filament loading or unloading to finish.' : '') ||
          (_homing ? 'Wait for the printer to finish homing.' : '');
        reasons.homeAxes = movementReason;
        reasons.moveAxis = movementReason || (!Object.values(snapshot.motion.homed).every(value => value === true) ? 'Home the printer and wait for all axes to report homed before jogging.' : '');
      }
      for (const action of CONTROL_ACTIONS) capabilities[action] = !reasons[action];
      reasons.camera = 'Camera transport must be connected separately.';
      snapshot.capabilities = capabilities;
      snapshot.capabilityReasons = reasons;
      return snapshot;
  }

  function getState() { return entries.map(snapshotFor); }

  function canUnload(extruder, filament, model, state) {
    if (!extruder.hasFilament || extruder.amsId === null || extruder.slotId === null) return false;
    if (model === 'P1S' && extruder.amsId === 254) return true;
    if (state === 'PAUSE') return false;
    return filament.slots.some(slot => slot.amsId === extruder.amsId && slot.slotId === extruder.slotId && slot.extruderId === extruder.id);
  }

  function requestedTemperature(input, fallback, model) {
    if (input === undefined) return integer(fallback, 1, model === 'H2D' ? 350 : 300) ?? -1;
    if (input === -1) return -1;
    const value = integer(input, 1, model === 'H2D' ? 350 : 300);
    if (value === null) throw new Error('Use a valid nozzle temperature, or leave it on automatic.');
    return value;
  }

  function makeControl(entry, action, params, snapshot, sequenceId) {
    if (!plainObject(params)) throw new TypeError('Printer action settings must be an object.');
    const allowed = {
      reprint: ['plan'],
      loadFilament: ['amsId', 'slotId', 'extruderId', 'currentTemperature', 'targetTemperature'],
      unloadFilament: ['extruderId', 'currentTemperature', 'targetTemperature'],
      setNozzleTemperature: ['extruderId', 'target'], setBedTemperature: ['target'],
      moveAxis: ['axis', 'distance'], homeAxes: [],
    }[action] || [];
    if (Object.keys(params).some(key => !allowed.includes(key))) throw new Error('Unsupported printer action setting.');
    const model = entry.state.model.toUpperCase();
    const wrapGcode = param => ({ print: { sequence_id: sequenceId, command: 'gcode_line', param } });
    if (action === 'reprint') {
      if (!validPlan(params.plan)) throw new Error('Check the job again before printing it.');
      return projectFileCommand(params.plan, sequenceId);
    }
    if (action === 'setNozzleTemperature' || action === 'setBedTemperature') {
      const nozzleAction = action === 'setNozzleTemperature';
      const limit = snapshot.controlLimits[nozzleAction ? 'nozzle' : 'bed'];
      if (!Number.isInteger(params.target) || params.target < limit.min || params.target > limit.max) throw new Error(`Choose a whole-number temperature from ${limit.min} to ${limit.max} °C. Zero turns the heater off.`);
      if (nozzleAction) {
        const nozzle = snapshot.temperatures.nozzles.find(item => item.id === params.extruderId);
        if (!Number.isInteger(params.extruderId) || !nozzle || (nozzle.current === null && nozzle.target === null)) throw new Error('Choose a nozzle with reported temperature telemetry.');
        return model === 'H2D'
          ? { print: { sequence_id: sequenceId, command: 'set_nozzle_temp', extruder_index: nozzle.id, target_temp: params.target } }
          : wrapGcode(`M104 S${params.target}\n`);
      }
      return firmwareFeature(entry.state, 39)
        ? { print: { sequence_id: sequenceId, command: 'set_bed_temp', temp: params.target } }
        : wrapGcode(`M140 S${params.target}\n`);
    }
    if (action === 'homeAxes') return firmwareFeature(entry.state, 32)
      ? { print: { sequence_id: sequenceId, command: 'back_to_center' } }
      : wrapGcode('G28 \n');
    if (action === 'moveAxis') {
      if (!['X', 'Y', 'Z'].includes(params.axis) || typeof params.distance !== 'number' || ![0.1, 1, 10].includes(Math.abs(params.distance))) throw new Error('Choose X, Y or Z and a 0.1, 1 or 10 mm step.');
      const speed = params.axis === 'Z' ? 900 : 3000;
      // Exact Studio fallback supports fractional steps too. Preserve both
      // coordinate reference mode and the prior endstop settings; enable XYZ
      // endstops during this bounded relative move. Never expose arbitrary E/G-code.
      return wrapGcode(`M211 S \nM211 X1 Y1 Z1\nM1002 push_ref_mode\nG91 \nG1 ${params.axis}${params.distance.toFixed(1)} F${speed}\nM1002 pop_ref_mode\nM211 R\n`);
    }
    if (!action.endsWith('Filament')) return { print: { sequence_id: sequenceId, command: action, param: '' } };
    const filament = snapshot.filament;
    let slot = null;
    let extruder;
    if (action === 'loadFilament') {
      if (!Number.isInteger(params.amsId) || !Number.isInteger(params.slotId)) throw new Error('Choose an available AMS slot.');
      slot = (filament.loadableSlots || []).find(item => item.amsId === params.amsId && item.slotId === params.slotId);
      if (!slot) throw new Error('That AMS slot is absent, already loaded, or has an unsupported nozzle mapping.');
      if (model === 'H2D' && (!Number.isInteger(params.extruderId) || params.extruderId !== slot.extruderId)) throw new Error('Choose the nozzle reported for this H2D AMS slot.');
      if (params.extruderId !== undefined && params.extruderId !== slot.extruderId) throw new Error('The selected nozzle does not match this AMS slot.');
      extruder = filament.extruders.find(item => item.id === slot.extruderId);
    } else {
      const extruderId = model === 'P1S' && params.extruderId === undefined ? 0 : params.extruderId;
      if (!Number.isInteger(extruderId)) throw new Error('Choose the nozzle to unload.');
      extruder = (filament.unloadableExtruders || []).find(item => item.id === extruderId);
      if (!extruder) throw new Error('That nozzle has no loaded filament with a verified mapping.');
    }
    const currentSlot = filament.slots.find(item => item.amsId === extruder.amsId && item.slotId === extruder.slotId);
    const amsId = action === 'loadFilament' ? slot.amsId : extruder.amsId;
    const trayId = action === 'loadFilament' ? amsId * 4 + slot.slotId : 255;
    const payload = {
      sequence_id: sequenceId, command: 'ams_change_filament',
      curr_temp: requestedTemperature(params.currentTemperature, currentSlot?.temperature, model),
      tar_temp: requestedTemperature(params.targetTemperature, slot?.temperature ?? currentSlot?.temperature, model),
      ams_id: amsId, target: trayId === 0 ? amsId : trayId,
      slot_id: action === 'loadFilament' ? slot.slotId : 255,
    };
    if (model === 'H2D') payload.extruder_id = extruder.id;
    return { print: payload };
  }

  async function command(id, action, params = {}) {
    if (!CONTROL_ACTIONS.includes(action)) throw new Error('Unsupported printer action.');
    const entry = entries.find(item => item.state.id === id);
    if (!entry?.active) throw new Error('Printer was not found.');
    const snapshot = snapshotFor(entry);
    if (!snapshot.capabilities[action]) throw new Error(snapshot.capabilityReasons[action]);
    const sequenceId = String(++sequence % 2147483647);
    const payload = makeControl(entry, action, params, snapshot, sequenceId);
    const record = { action, sequenceId, status: 'sending', sentAt: new Date(now()).toISOString(), message: 'Sending printer command.' };
    entry.lastCommand = record;
    entry.expectedFilament = action === 'loadFilament' ? { amsId: params.amsId, slotId: params.slotId, extruderId: params.extruderId ?? 0 } : action === 'unloadFilament' ? { extruderId: params.extruderId ?? 0 } : null;
    entry.expectedControl = {
      target: params.target, extruderId: params.extruderId,
      homingTransition: action === 'homeAxes' && !Object.values(snapshot.motion.homed).every(value => value === true),
    };
    const sentMessage = action === 'moveAxis' ? 'Movement requested; position is not reported by this printer.' : 'Command sent. Waiting for printer telemetry to confirm the change.';
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (entry.lastCommand === record && IN_FLIGHT.has(record.status)) {
          record.status = 'unconfirmed';
          record.message = 'The connection did not confirm sending this command. Check the printer before retrying.';
        }
        abortOutgoing(entry);
        reject(new Error('The printer connection did not confirm sending the command.'));
      }, 8000);
      try {
        entry.client.publish(entry.requestTopic, JSON.stringify(payload), { qos: 1, retain: false }, error => {
          clearTimeout(timeout);
          if (error || !entry.active || !entry.connected) {
            if (entry.lastCommand === record && IN_FLIGHT.has(record.status)) {
              record.status = 'unconfirmed';
              record.message = 'The connection was interrupted. Check the printer before retrying.';
            }
            reject(new Error('The printer connection could not confirm sending the command.'));
            return;
          }
          if (record.status === 'sending') {
            record.status = 'sent';
            record.message = sentMessage;
          }
          resolve();
        });
      } catch {
        clearTimeout(timeout);
        record.status = 'unconfirmed';
        record.message = 'Could not confirm sending this command. Check the printer before retrying.';
        reject(new Error('The printer connection could not send the command.'));
      }
    });
    return { status: 'sent', action, sequenceId, message: sentMessage };
  }

  function observeCommand(entry, payload, receivedTelemetry) {
    const record = entry.lastCommand;
    if (!record || !IN_FLIGHT.has(record.status) || !plainObject(payload.print)) return;
    const report = payload.print;
    const matched = String(report.sequence_id ?? '') === record.sequenceId;
    const errorCode = integer(report.errno, -2147483648, 2147483647) ?? integer(report.err_code, -2147483648, 2147483647);
    if (matched && (String(report.result || '').toLowerCase() === 'fail' || (errorCode !== null && errorCode !== 0))) {
      record.status = 'rejected';
      record.message = errorCode === -2 ? 'Printer refused the filament change because the chamber is too hot.' : errorCode === -4 ? 'Printer refused the filament change because the AMS is too hot.' : 'Printer rejected the command. Check its alerts and whether this firmware permits LAN controls or requires Developer Mode.';
      const reason = typeof report.reason === 'string' ? report.reason : '';
      if (/authori[sz]|permission|verification|signature|access denied|not allowed/i.test(reason)) {
        entry.controlBlocked = 'Printer authorization rejected LAN controls. Check compatible firmware or Developer Mode on the printer, then reconnect.';
      }
      return;
    }
    if (matched && String(report.result || '').toLowerCase() === 'success' && record.status !== 'confirmed') {
      record.status = 'accepted';
      record.message = record.action === 'moveAxis' ? 'Movement accepted; position is not reported by this printer.' : 'Printer accepted the command. Waiting for the requested state change.';
    }
    if (!receivedTelemetry) return;
    const state = entry.state._gcodeState;
    let confirmed = record.action === 'reprint' ? ['PREPARE', 'SLICING', 'RUNNING'].includes(state) : record.action === 'pause' ? state === 'PAUSE' : record.action === 'resume' ? state === 'RUNNING' : record.action === 'stop' ? ['IDLE', 'READY', 'FINISH', 'FAILED'].includes(state) : false;
    if (record.action.endsWith('Filament') && entry.expectedFilament) {
      const filament = filamentState(entry.state);
      const expected = entry.expectedFilament;
      const extruder = filament.extruders.find(item => item.id === expected.extruderId);
      confirmed = filament.busy === false && !!extruder && (record.action === 'loadFilament'
        ? extruder.hasFilament === true && extruder.amsId === expected.amsId && extruder.slotId === expected.slotId
        : extruder.hasFilament === false);
    }
    const expected = entry.expectedControl;
    if (record.action === 'setNozzleTemperature' && expected) {
      const updated = entry.state.model.toUpperCase() === 'H2D'
        ? Array.isArray(report.device?.extruder?.info) && report.device.extruder.info.some(item => integer(item?.id, 0, 1) === expected.extruderId && Object.hasOwn(item, 'temp'))
        : Object.hasOwn(report, 'nozzle_target_temper');
      confirmed = Boolean(updated) && entry.state.temperatures.nozzles.find(item => item.id === expected.extruderId)?.target === expected.target;
    }
    if (record.action === 'setBedTemperature' && expected) confirmed = (Object.hasOwn(report, 'bed_target_temper') || Object.hasOwn(report.device || {}, 'bed_temp')) && entry.state.temperatures.bed.target === expected.target;
    if (record.action === 'homeAxes' && expected) {
      const allHomed = Object.values(entry.state.motion.homed).every(value => value === true);
      if (!allHomed || entry.state._homing) expected.homingTransition = true;
      confirmed = expected.homingTransition && allHomed && !entry.state._homing && Object.hasOwn(report, 'home_flag');
    }
    if (confirmed) {
      record.status = 'confirmed';
      record.message = record.action.endsWith('Temperature') ? 'Printer reports the requested temperature target.' : 'Printer telemetry confirmed the requested change.';
    }
  }

  function configure(configurations = []) {
    if (!Array.isArray(configurations)) throw new TypeError('Printer settings must be a list.');
    if (configurations.length > 32) throw new RangeError('At most 32 printers can be configured.');
    close();
    entries = configurations.map((value, index) => {
      const config = plainObject(value) ? value : {};
      const entry = {
        active: true, client: null, connected: false, connectedAt: null,
        failure: false, state: baseState(config, index), controlAccess: config.controlAccess === true,
        controlBlocked: null, lastCommand: null, expectedFilament: null, outgoing: new Set(),
        subscribed: false, snapshotAttempts: 0, snapshotTimer: null, snapshotError: null, lastMessageAt: null,
      };
      return { ...entry, config };
    });

    const ids = new Set();
    for (const entry of entries) {
      const config = entry.config;
      delete entry.config;
      if (ids.has(entry.state.id)) {
        entry.state.status = 'error';
        entry.state.message = 'Printer identifiers must be unique.';
        continue;
      }
      ids.add(entry.state.id);
      if (!config.host || !config.serial || !config.accessCode) continue;
      if (!isLanHost(config.host) || typeof config.serial !== 'string' ||
          !/^[a-z0-9_-]{4,64}$/i.test(config.serial) || typeof config.accessCode !== 'string' ||
          !config.accessCode.length || config.accessCode.length > 128 || /[\u0000-\u001f]/.test(config.accessCode)) {
        entry.state.status = 'error';
        entry.state.message = 'Use a private LAN IP address or local hostname, a valid serial number and LAN access code.';
        continue;
      }
      entry.state.status = 'connecting';
      entry.state.message = 'Connecting to printer.';
      const topic = `device/${config.serial}/report`;
      entry.requestTopic = `device/${config.serial}/request`;
      try {
        entry.client = connect({
          protocol: 'mqtts', host: config.host, port: 8883,
          username: 'bblp', password: config.accessCode,
          clientId: `edge_deck_${randomUUID().replaceAll('-', '').slice(0, 12)}`,
          clean: true, protocolVersion: 4, reconnectPeriod: 5000,
          connectTimeout: 8000, keepalive: 30,
          rejectUnauthorized: config.allowSelfSigned !== true,
          lookup: lanLookup,
        });

        entry.client.on('connect', () => {
          if (!entry.active) return;
          entry.connected = true;
          entry.connectedAt = now();
          entry.subscribed = false;
          entry.snapshotAttempts = 0;
          entry.snapshotError = null;
          entry.lastMessageAt = null;
          cancelSnapshotRetry(entry);
          entry.failure = false;
          entry.controlBlocked = null;
          entry.state = {
            ...baseState(entry.state), status: 'connecting',
            message: 'Connected. Waiting for printer telemetry.',
          };
          entry.client.subscribe(topic, { qos: 0 }, (error, grants) => {
            if (!entry.active) return;
            if (error || (Array.isArray(grants) && grants.some(grant => grant.qos === 128))) {
              entry.failure = true;
              entry.state.status = 'error';
              entry.state.message = 'Printer refused the status subscription. Check LAN access settings.';
              return;
            }
            if (!entry.connected) return;
            entry.subscribed = true;
            requestSnapshot(entry);
          });
        });

        entry.client.on('message', (receivedTopic, buffer) => {
          if (!entry.active || !entry.connected || receivedTopic !== topic || !buffer || buffer.length > 1024 * 1024) return;
          let payload;
          try { payload = JSON.parse(buffer.toString('utf8')); } catch { return; }
          entry.lastMessageAt = new Date(now()).toISOString();
          const normalized = normalizeTelemetry(payload, entry.state, now());
          if (normalized) {
            entry.failure = false;
            entry.state = normalized;
            if (hasPrinterState(entry)) cancelSnapshotRetry(entry);
          }
          observeCommand(entry, payload, Boolean(normalized));
        });

        entry.client.on('packetsend', packet => {
          if (!entry.active || packet.cmd !== 'publish' || packet.topic !== entry.requestTopic || !packet.messageId) return;
          entry.outgoing.add(packet.messageId);
        });
        entry.client.on('packetreceive', packet => { if (packet.cmd === 'puback') entry.outgoing.delete(packet.messageId); });

        entry.client.on('error', error => {
          if (!entry.active) return;
          entry.failure = true;
          entry.state.status = 'error';
          entry.state.message = safeConnectionError(error);
        });
        const disconnected = () => {
          if (!entry.active) return;
          entry.connected = false;
          entry.subscribed = false;
          cancelSnapshotRetry(entry);
          if (entry.lastCommand && IN_FLIGHT.has(entry.lastCommand.status)) {
            entry.lastCommand.status = 'unconfirmed';
            entry.lastCommand.message = 'The printer disconnected before the change was confirmed. Check it before retrying.';
          }
          // Do not replay an old physical action automatically after reconnect.
          abortOutgoing(entry);
          if (!entry.failure) {
            entry.state.status = 'offline';
            entry.state.message = 'Printer disconnected. Reconnecting automatically.';
          }
        };
        entry.client.on('offline', disconnected);
        entry.client.on('close', disconnected);
        entry.client.on('reconnect', () => {
          if (!entry.active || entry.failure) return;
          entry.state.status = 'connecting';
          entry.state.message = 'Reconnecting to printer.';
        });
      } catch (error) {
        entry.failure = true;
        entry.state.status = 'error';
        entry.state.message = error?.code === 'MODULE_NOT_FOUND'
          ? 'The printer connection component is not installed.' : safeConnectionError(error);
      }
    }
    return getState();
  }

  // The running job, for fetching its preview picture (null when nothing prints).
  function jobFor(id) {
    const entry = entries.find(item => item.state.id === id);
    const state = entry?.state;
    if (!state || !entry.connected || !['printing', 'paused', 'finished'].includes(state.status) || !(state.jobName || state._gcodeFile)) return null;
    return { key: [state._jobId, state.jobName, state._gcodeFile].map(value => value || '').join('|'), name: state.jobName, file: state._gcodeFile };
  }

  // The last job, for printing it again: its name, file and (H2D) AMS mapping.
  function lastJobFor(id) {
    const entry = entries.find(item => item.state.id === id);
    const state = entry?.state;
    if (!state || !entry.connected || !(state.jobName || state._gcodeFile)) return null;
    return { key: [state._jobId, state.jobName, state._gcodeFile].map(value => value || '').join('|'), name: state.jobName, file: state._gcodeFile, mapping: state._jobMapping || null, model: state.model };
  }

  return { configure, getState, command, close, jobFor, lastJobFor };
}

module.exports = { createPrinterBridge, normalizeTelemetry, isLanHost, isPrivateAddress, lanLookup };
