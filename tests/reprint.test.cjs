'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseSliceInfo, buildPlan, projectFileCommand, validPlan } = require('../lib/reprint.cjs');

const slice = `<?xml version="1.0" encoding="UTF-8"?><config><plate><metadata key="index" value="4"/>
<filament id="2" tray_info_idx="GFG99" type="PETG" color="#C1C1C1" used_m="1.2" used_g="3.5" /></plate>
<plate><metadata key="index" value="1"/><filament id="1" type="PLA" color="#161616"/></plate></config>`;
const entries = { names: ['3D/3dmodel.model', 'Metadata/plate_4.gcode', 'Metadata/slice_info.config'], bodies: { 'Metadata/slice_info.config': Buffer.from(slice) } };
const h2d = slots => ({ model: 'H2D', filament: { slots } });
const job = { name: 'Bottom Connector', file: '/data/Metadata/plate_4.gcode', mapping: [65535, 1] };

test('the slice info lists each plate and its filaments', () => {
  assert.deepEqual(parseSliceInfo(slice), [{ index: 4, filaments: [{ id: 2, type: 'PETG', color: '#C1C1C1' }] }, { index: 1, filaments: [{ id: 1, type: 'PLA', color: '#161616' }] }]);
});

test('an H2D job prints again with the AMS slots the printer reported, when they hold the same material', () => {
  const plan = buildPlan({ job, printer: h2d([{ amsId: 0, slotId: 1, material: 'PETG', color: 'C1C1C1FF' }]), file: '/cache/Bottom Connector.gcode.3mf', entries });
  assert.equal(plan.ok, true);
  assert.equal(plan.url, 'ftp:///cache/Bottom Connector.gcode.3mf'); assert.equal(plan.param, 'Metadata/plate_4.gcode');
  assert.deepEqual(plan.amsMapping, [-1, 1]); assert.deepEqual(plan.amsMapping2, [{ ams_id: 255, slot_id: 255 }, { ams_id: 0, slot_id: 1 }]);
  assert.deepEqual(plan.filaments, [{ id: 2, type: 'PETG', color: '#C1C1C1', slot: 'AMS 1 · slot 2', slotColor: '#C1C1C1' }]);
  assert.ok(validPlan(plan));
  const command = projectFileCommand(plan, '7').print;
  assert.equal(command.command, 'project_file'); assert.equal(command.use_ams, true); assert.deepEqual(command.ams_mapping, [-1, 1]); assert.equal(command.sequence_id, '7');
});

test('a changed or empty slot, a missing file or an unknown plate is refused with the reason', () => {
  assert.match(buildPlan({ job, printer: h2d([{ amsId: 0, slotId: 1, material: 'PLA' }]), file: '/x.3mf', entries }).reason, /AMS 1 · slot 2 now holds PLA; this print needs PETG/);
  assert.match(buildPlan({ job, printer: h2d([]), file: '/x.3mf', entries }).reason, /AMS 1 · slot 2 is empty/);
  assert.match(buildPlan({ job, printer: h2d([]), file: null, entries: null }).reason, /no copy of this job/);
  assert.match(buildPlan({ job: { ...job, mapping: null }, printer: h2d([]), file: '/x.3mf', entries }).reason, /did not report which AMS slots/);
  assert.match(buildPlan({ job: { ...job, file: 'x.3mf' }, printer: h2d([]), file: '/x.3mf', entries: { ...entries, names: [...entries.names, 'Metadata/plate_1.gcode'] } }).reason, /which plate/);
});

test('a P1S without an AMS prints again from its external spool', () => {
  const p1s = { name: 'Leg', file: 'Leg.3mf' };
  const one = { names: ['Metadata/plate_1.gcode', 'Metadata/slice_info.config'], bodies: { 'Metadata/slice_info.config': Buffer.from('<plate><metadata key="index" value="1"/><filament id="1" type="PLA" color="#FFFFFF"/></plate>') } };
  const plan = buildPlan({ job: p1s, printer: { model: 'P1S', filament: { slots: [], external: { material: 'PLA', color: 'FFFFFFFF' } } }, file: '/Leg.3mf', entries: one });
  assert.equal(plan.ok, true); assert.equal(plan.useAms, false); assert.equal(plan.param, 'Metadata/plate_1.gcode');
  assert.equal(projectFileCommand(plan, '1').print.ams_mapping2, undefined);
  assert.match(buildPlan({ job: p1s, printer: { model: 'P1S', filament: { slots: [], external: { material: 'PETG' } } }, file: '/Leg.3mf', entries: one }).reason, /external spool holds PETG/);
});

test('a tampered plan is not valid', () => {
  assert.equal(validPlan({ ok: true, url: 'ftp:///x.3mf', param: 'Metadata/plate_1.gcode; G28', name: 'x', useAms: false, amsMapping: [0], amsMapping2: null }), false);
  assert.equal(validPlan({ ok: true, url: 'http://evil/x.3mf', param: 'Metadata/plate_1.gcode', name: 'x', useAms: false, amsMapping: [0], amsMapping2: null }), false);
});
