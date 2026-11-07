'use strict';

/*
 * Phase IDs follow BambuStudio commit 8f588cdb6893bb88415a62f5520b1a8e27a4c8ec:
 * https://github.com/bambulab/BambuStudio/blob/8f588cdb6893bb88415a62f5520b1a8e27a4c8ec/src/slic3r/GUI/DeviceManager.cpp
 * get_stage_string (lines 130-295), stg_cur parsing (3536-3538).
 * Labels below are shortened for the touch display; categories are UI metadata.
 * stg is the planned sequence, not the current phase. mc_print_stage and
 * mc_print_sub_stage are separate fields, and print_gcode_action is not used by
 * that parser. None is interpreted as a substitute for stg_cur.
 * This module is observational only and never issues printer commands.
 */

const PHASES = Object.freeze(Object.fromEntries([
  [0, 'Printing', 'printing'],
  [1, 'Leveling bed', 'leveling'],
  [2, 'Preheating bed', 'heating'],
  [3, 'Calibrating vibration compensation', 'calibrating'],
  [4, 'Changing filament', 'filament'],
  [5, 'Paused by print command', 'paused'],
  [6, 'Paused: filament ran out', 'paused'],
  [7, 'Heating nozzle', 'heating'],
  [8, 'Calibrating dynamic flow', 'calibrating'],
  [9, 'Scanning bed surface', 'checking'],
  [10, 'Inspecting first layer', 'checking'],
  [11, 'Identifying build plate', 'checking'],
  [12, 'Calibrating lidar', 'calibrating'],
  [13, 'Homing toolhead', 'moving'],
  [14, 'Cleaning nozzle tip', 'preparing'],
  [15, 'Checking extruder temperature', 'checking'],
  [16, 'Paused by user', 'paused'],
  [17, 'Paused: front cover detached', 'paused'],
  [18, 'Calibrating lidar', 'calibrating'],
  [19, 'Calibrating flow ratio', 'calibrating'],
  [20, 'Paused: nozzle temperature error', 'paused'],
  [21, 'Paused: bed temperature error', 'paused'],
  [22, 'Unloading filament', 'filament'],
  [23, 'Paused: motion step loss', 'paused'],
  [24, 'Loading filament', 'filament'],
  [25, 'Calibrating motor noise cancellation', 'calibrating'],
  [26, 'Paused: AMS offline', 'paused'],
  [27, 'Paused: heatbreak fan too slow', 'paused'],
  [28, 'Paused: chamber temperature error', 'paused'],
  [29, 'Cooling chamber', 'cooling'],
  [30, 'Paused by user G-code', 'paused'],
  [31, 'Demonstrating motor noise cancellation', 'calibrating'],
  [32, 'Paused: nozzle clumping', 'paused'],
  [33, 'Paused: cutter error', 'paused'],
  [34, 'Paused: first layer error', 'paused'],
  [35, 'Paused: nozzle clog', 'paused'],
  [36, 'Measuring motion precision', 'calibrating'],
  [37, 'Enhancing motion precision', 'calibrating'],
  [38, 'Measuring motion accuracy', 'calibrating'],
  [39, 'Calibrating nozzle offset', 'calibrating'],
  [40, 'Leveling bed at high temperature', 'leveling'],
  [41, 'Checking quick-release lever', 'checking'],
  [42, 'Checking door and top cover', 'checking'],
  [43, 'Calibrating laser', 'calibrating'],
  [44, 'Checking platform', 'checking'],
  [45, 'Confirming BirdsEye camera position', 'checking'],
  [46, 'Calibrating BirdsEye camera', 'calibrating'],
  [47, 'Leveling bed: phase 1', 'leveling'],
  [48, 'Leveling bed: phase 2', 'leveling'],
  [49, 'Heating chamber', 'heating'],
  [50, 'Adjusting bed temperature', 'heating'],
  [51, 'Printing calibration lines', 'calibrating'],
  [52, 'Checking material', 'checking'],
  [53, 'Calibrating live-view camera', 'calibrating'],
  [54, 'Waiting for bed temperature', 'heating'],
  [55, 'Checking material position', 'checking'],
  [56, 'Calibrating cutting module offset', 'calibrating'],
  [57, 'Measuring surface', 'checking'],
  [58, 'Preconditioning for first layer', 'heating'],
  [59, 'Homing blade holder', 'moving'],
  [60, 'Calibrating camera offset', 'calibrating'],
  [61, 'Calibrating blade holder position', 'calibrating'],
  [62, 'Testing hotend pick and place', 'checking'],
  [63, 'Waiting for chamber temperature to equalize', 'heating'],
  [64, 'Preparing hotend', 'preparing'],
  [65, 'Calibrating nozzle-clumping detection', 'calibrating'],
  [66, 'Purifying chamber air', 'preparing'],
  [67, 'Measuring rotary attachment', 'checking'],
  [68, 'Moving toolhead above purge chute', 'moving'],
  [69, 'Cooling nozzle', 'cooling'],
  [70, 'Moving toolhead to bed center', 'moving'],
  [71, 'Active arc fitting', 'calibrating'],
  [72, 'Detecting hotend type', 'checking'],
  [73, 'Checking build plate alignment', 'checking'],
  [74, 'Checking for objects on bed', 'checking'],
  [75, 'Checking for objects under bed', 'checking'],
  [76, 'Extruding before printing', 'preparing'],
  [77, 'Preparing AMS', 'preparing'],
].map(([code, label, category]) => [code, Object.freeze({ code, label, category, known: true })])));

const ACTIVE = new Set(['RUNNING', 'PREPARE', 'SLICING', 'PAUSE']);
const TERMINAL = Object.freeze({
  IDLE: ['Idle', 'idle'], READY: ['Idle', 'idle'],
  FINISH: ['Print finished', 'finished'], FAILED: ['Print failed', 'error'],
  OFFLINE: ['Offline', 'offline'],
});
const JOB_KEYS = ['task_id', 'subtask_id', 'project_id', 'gcode_start_time', 'gcode_file', 'subtask_name'];
const STATE_KEYS = ['gcode_state', 'stg_cur', ...JOB_KEYS];

function plain(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function report(payload) {
  if (!plain(payload)) return {};
  return Object.hasOwn(payload, 'print') ? (plain(payload.print) ? payload.print : {}) : payload;
}

function phaseCode(value) {
  if (typeof value === 'string' && /^-?\d{1,10}$/.test(value.trim())) value = Number(value);
  return Number.isInteger(value) && value >= -1 && value <= 0x7fffffff ? value : null;
}

function stateName(value) {
  return typeof value === 'string' && /^[A-Z_]{1,24}$/i.test(value.trim()) ? value.trim().toUpperCase() : '';
}

function identity(value) {
  if (typeof value === 'number' && Number.isSafeInteger(value)) value = String(value);
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 256);
}

function usefulIdentity(value) {
  return value !== '' && value !== '0';
}

function compact(payload) {
  const input = report(payload);
  const output = {};
  for (const key of STATE_KEYS) {
    if (!Object.hasOwn(input, key)) continue;
    output[key] = key === 'stg_cur' ? phaseCode(input[key])
      : key === 'gcode_state' ? stateName(input[key]) : identity(input[key]);
  }
  return output;
}

function stage(code, label, category, known) {
  return { code, label, category, known };
}

/** Derive a display phase from a current, merged report. No I/O or mutation. */
function derivePrintStage(printTelemetry) {
  const input = report(printTelemetry);
  const status = stateName(input.gcode_state);
  const code = phaseCode(input.stg_cur);
  const phase = code === null ? null : PHASES[code];

  // Job state takes precedence over a stale phase from an earlier report/job.
  if (Object.hasOwn(TERMINAL, status)) return stage(null, ...TERMINAL[status], true);
  if (status === 'PAUSE') return phase?.category === 'paused'
    ? { ...phase } : stage(null, 'Paused', 'paused', true);
  if (status === 'SLICING') return stage(null, 'Slicing', 'preparing', true);
  if (status === 'INIT') return stage(null, 'Preparing print', 'preparing', false);
  if (phase && !(status === 'PREPARE' && code === 0)) return { ...phase };

  // 255/-1 are unmapped in Studio. Do not label them as a physical action.
  if (code !== null && code !== -1 && code !== 255 && !(status === 'PREPARE' && code === 0)) {
    return stage(code, `Reported phase ${code}`, 'unknown', false);
  }
  if (status === 'PREPARE') return stage(code, 'Preparing print', 'preparing', false);
  if (status === 'RUNNING') return stage(code, 'Printing', 'printing', false);
  return stage(code, 'Phase unavailable', 'unknown', false);
}

/**
 * Merge one sparse MQTT print report with this function's previous state.
 * Returns { state, stage }. Keep state private per printer connection; publish
 * only stage. Reset previous state when reconnecting or changing the printer.
 * The bounded state retains no credentials, filenames beyond one capped job
 * identity, stage lists, arbitrary device objects, or legacy action counters.
 */
function readPrintStage(payload, previousState) {
  const previous = compact(previousState);
  const patch = compact(payload);
  const next = { ...previous, ...patch };
  const before = previous.gcode_state || '';
  const newIdentity = JOB_KEYS.some(key => Object.hasOwn(patch, key)
    && usefulIdentity(previous[key] || '') && usefulIdentity(patch[key])
    && previous[key] !== patch[key]);
  // A new job's identity/phase can arrive before its state in a delta stream.
  // Do not let the previous job's FINISH discard the new job's reported phase.
  if (newIdentity && !Object.hasOwn(patch, 'gcode_state')) delete next.gcode_state;
  const after = next.gcode_state || '';
  const enteringJob = Boolean(before) && !ACTIVE.has(before) && ACTIVE.has(after);
  const preparingAgain = (before === 'RUNNING' || before === 'PAUSE')
    && (after === 'PREPARE' || after === 'SLICING');
  const resuming = before === 'PAUSE' && after === 'RUNNING';
  const reset = newIdentity || enteringJob || preparingAgain || resuming;

  if (reset && !Object.hasOwn(patch, 'stg_cur')) delete next.stg_cur;
  if (Object.hasOwn(TERMINAL, after) || after === 'INIT') delete next.stg_cur;
  // Clear an earlier heating/leveling phase when a pause arrives by itself.
  if (after === 'PAUSE' && !Object.hasOwn(patch, 'stg_cur') && before !== 'PAUSE') delete next.stg_cur;

  return { state: next, stage: derivePrintStage(next) };
}

module.exports = { derivePrintStage, readPrintStage };
