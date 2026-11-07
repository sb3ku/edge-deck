'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { derivePrintStage, readPrintStage } = require('../lib/print-stage.cjs');

test('reported heating, leveling and actual printing use distinct official phase IDs', () => {
  assert.deepEqual(derivePrintStage({ gcode_state: 'RUNNING', stg_cur: 7 }),
    { code: 7, label: 'Heating nozzle', category: 'heating', known: true });
  assert.equal(derivePrintStage({ gcode_state: 'PREPARE', stg_cur: 1 }).label, 'Leveling bed');
  assert.equal(derivePrintStage({ gcode_state: 'RUNNING', stg_cur: 2 }).label, 'Preheating bed');
  assert.deepEqual(derivePrintStage({ gcode_state: 'RUNNING', stg_cur: 0 }),
    { code: 0, label: 'Printing', category: 'printing', known: true });
});

test('newer H2D phases are mapped without calling every preparation action heating', () => {
  for (const [code, label] of [
    [39, 'Calibrating nozzle offset'], [42, 'Checking door and top cover'],
    [47, 'Leveling bed: phase 1'], [48, 'Leveling bed: phase 2'],
    [49, 'Heating chamber'], [58, 'Preconditioning for first layer'],
    [69, 'Cooling nozzle'], [77, 'Preparing AMS'],
  ]) assert.equal(derivePrintStage({ gcode_state: 'RUNNING', stg_cur: code }).label, label);
});

test('terminal states and pause override stale heating in a merged report', () => {
  for (const [gcode_state, label] of [
    ['IDLE', 'Idle'], ['READY', 'Idle'], ['FINISH', 'Print finished'],
    ['FAILED', 'Print failed'], ['PAUSE', 'Paused'], ['OFFLINE', 'Offline'],
  ]) assert.deepEqual(derivePrintStage({ gcode_state, stg_cur: 7 }).label, label);
  assert.equal(derivePrintStage({ gcode_state: 'PAUSE', stg_cur: 6 }).label, 'Paused: filament ran out');
});

test('a sparse temperature update preserves the current phase and does not mutate previous state', () => {
  const first = readPrintStage({ print: { gcode_state: 'RUNNING', stg_cur: 7, task_id: 'job-a' } });
  Object.freeze(first.state);
  const update = readPrintStage({ print: { nozzle_temper: 180 } }, first.state);
  assert.deepEqual(update.stage, first.stage);
  assert.notEqual(update.state, first.state);
  assert.equal(Object.hasOwn(update.state, 'nozzle_temper'), false);
});

test('a changed task, subtask, start time, filename or name clears the prior phase and state', () => {
  for (const key of ['task_id', 'subtask_id', 'gcode_start_time', 'gcode_file', 'subtask_name']) {
    const first = readPrintStage({ gcode_state: 'RUNNING', stg_cur: 7, [key]: 'one' });
    const update = readPrintStage({ [key]: 'two' }, first.state);
    assert.equal(update.stage.label, 'Phase unavailable');
    assert.equal(update.stage.known, false);
    assert.equal(update.stage.code, null);
  }
});

test('name-only new jobs cannot inherit heating while the printer remains RUNNING', () => {
  const first = readPrintStage({ gcode_state: 'RUNNING', subtask_name: 'Old plate', stg_cur: 7 });
  const next = readPrintStage({ gcode_state: 'RUNNING', subtask_name: 'New plate' }, first.state);
  assert.deepEqual(next.stage, { code: null, label: 'Printing', category: 'printing', known: false });
});

test('a new phase preceding its new job state survives the previous job finishing', () => {
  const finished = readPrintStage({ gcode_state: 'FINISH', task_id: 'old', stg_cur: -1 });
  const phaseFirst = readPrintStage({ task_id: 'new', stg_cur: 7 }, finished.state);
  assert.equal(Object.hasOwn(phaseFirst.state, 'gcode_state'), false);
  const running = readPrintStage({ gcode_state: 'RUNNING' }, phaseFirst.state);
  assert.equal(running.stage.label, 'Heating nozzle');
});

test('observed H2D finished telemetry cannot interpret the legacy stage as bed leveling', () => {
  const finished = readPrintStage({ print: { gcode_state: 'FINISH', stg_cur: -1,
    mc_print_stage: '1', mc_print_sub_stage: 0 } });
  assert.deepEqual(finished.stage, { code: null, label: 'Print finished', category: 'finished', known: true });
  assert.equal(Object.hasOwn(finished.state, 'stg_cur'), false);
});

test('a new job can report its actual phase in the same packet as its new identity', () => {
  const first = readPrintStage({ gcode_state: 'RUNNING', stg_cur: 7, task_id: 'one' });
  const update = readPrintStage({ task_id: 'two', stg_cur: 1 }, first.state);
  assert.equal(update.stage.label, 'Leveling bed');
});

test('finished then running does not carry a preparation phase into a new job', () => {
  let value = readPrintStage({ gcode_state: 'RUNNING', stg_cur: 7 });
  value = readPrintStage({ gcode_state: 'FINISH', stg_cur: 7 }, value.state);
  assert.equal(Object.hasOwn(value.state, 'stg_cur'), false);
  value = readPrintStage({ gcode_state: 'RUNNING' }, value.state);
  assert.equal(value.stage.label, 'Printing');
  assert.equal(value.stage.known, false);
});

test('pause/resume and a return to preparation clear stale phases when no new phase is reported', () => {
  const initial = readPrintStage({ gcode_state: 'RUNNING', stg_cur: 7 });
  const paused = readPrintStage({ gcode_state: 'PAUSE' }, initial.state);
  assert.equal(paused.stage.label, 'Paused');
  assert.equal(readPrintStage({ gcode_state: 'RUNNING' }, paused.state).stage.code, null);
  assert.equal(readPrintStage({ gcode_state: 'PREPARE' }, initial.state).stage.label, 'Preparing print');
  const withReason = readPrintStage({ gcode_state: 'PAUSE', stg_cur: 6 }, initial.state);
  assert.equal(readPrintStage({ gcode_state: 'RUNNING' }, withReason.state).stage.label, 'Printing');
});

test('missing, sentinel and unknown phases do not guess a physical action', () => {
  for (const stg_cur of [undefined, null, -1, 255]) {
    assert.equal(derivePrintStage({ gcode_state: 'PREPARE', stg_cur }).label, 'Preparing print');
    assert.equal(derivePrintStage({ gcode_state: 'RUNNING', stg_cur }).known, false);
  }
  assert.deepEqual(derivePrintStage({ gcode_state: 'RUNNING', stg_cur: 812 }),
    { code: 812, label: 'Reported phase 812', category: 'unknown', known: false });
  assert.equal(derivePrintStage({ gcode_state: 'PREPARE', stg_cur: 0 }).label, 'Preparing print');
});

test('legacy counters, action IDs and the planned stage list cannot masquerade as current phase', () => {
  const output = readPrintStage({ gcode_state: 'RUNNING', mc_print_stage: 1,
    mc_print_sub_stage: 7, print_gcode_action: 2, stg: [7, 1, 2] });
  assert.equal(output.stage.label, 'Printing');
  assert.equal(output.stage.known, false);
  assert.deepEqual(Object.keys(output.state), ['gcode_state']);
});

test('malformed input is bounded and cannot turn null, booleans or fractions into phase zero', () => {
  for (const stg_cur of [null, '', true, false, [], {}, 7.5, Infinity, '7.2', '0x07', 0x80000000]) {
    const value = readPrintStage({ stg_cur, gcode_state: 'RUNNING' });
    assert.equal(value.stage.code, null);
    assert.equal(value.stage.known, false);
  }
  for (const input of [null, false, [], 'text', { print: null }]) {
    assert.deepEqual(readPrintStage(input).state, {});
  }
  assert.equal(derivePrintStage({ gcode_state: 'running', stg_cur: '7' }).label, 'Heating nozzle');
  const value = readPrintStage({ task_id: 'a'.repeat(10000), secret: 'not retained' });
  assert.equal(value.state.task_id.length, 256);
  assert.equal(Object.hasOwn(value.state, 'secret'), false);
});

test('an explicitly invalid current phase clears a formerly valid phase', () => {
  const first = readPrintStage({ gcode_state: 'RUNNING', stg_cur: 7 });
  const next = readPrintStage({ stg_cur: null }, first.state);
  assert.equal(next.stage.label, 'Printing');
  assert.equal(next.stage.known, false);
});
