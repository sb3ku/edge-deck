'use strict';
// "Print again": start the last job again from the printer's own copy of its
// file. Nothing is guessed. The filaments the plate uses come from the file
// (Metadata/slice_info.config); each one goes to the AMS slot the printer
// reported for that job (the H2D's "mapping"), or to the external spool on a
// printer without an AMS. Every slot must still hold the same material, or the
// plan says why it cannot print. The plan is shown for confirmation first.
//
// Command format (unofficial, community-documented):
// https://github.com/Doridian/OpenBambuAPI/blob/main/mqtt.md (project_file)
// https://github.com/DMontgomery40/bambu-printer-mcp (H2 project-length ams_mapping + ams_mapping2)

const UNMAPPED = 65535;

function attributes(tag) {
  const out = {};
  for (const match of tag.matchAll(/([A-Za-z_][\w-]*)="([^"]*)"/g)) out[match[1]] = match[2];
  return out;
}
// Plates and the filaments each uses: [{ index, filaments: [{ id, type, color }] }].
function parseSliceInfo(xml) {
  const plates = [];
  for (const block of String(xml || '').matchAll(/<plate>([\s\S]*?)<\/plate>/g)) {
    const index = Number(/<metadata\s+key="index"\s+value="(\d+)"/.exec(block[1])?.[1]);
    const filaments = [...block[1].matchAll(/<filament\b[^>]*>/g)].map(match => attributes(match[0]))
      .map(item => ({ id: Number(item.id), type: String(item.type || '').trim(), color: String(item.color || '').trim() }))
      .filter(item => Number.isInteger(item.id) && item.id >= 1 && item.id <= 64);
    if (Number.isInteger(index) && index >= 1) plates.push({ index, filaments });
  }
  return plates;
}
const sameMaterial = (a, b) => String(a || '').trim().toUpperCase() === String(b || '').trim().toUpperCase();
const slotName = (amsId, slotId) => amsId === 254 || amsId === 255 ? 'External spool' : `AMS ${amsId + 1} · slot ${slotId + 1}`;
const colorName = value => { const hex = String(value || '').replace(/^#/, '').slice(0, 6).toUpperCase(); return /^[0-9A-F]{6}$/.test(hex) ? `#${hex}` : ''; };

// job: { name, file, mapping, model }; printer: the printer's snapshot (filament
// slots); entries: { names, bodies } from the job's 3MF.
function buildPlan({ job, printer, file, entries }) {
  const model = String(printer.model || job.model || '').toUpperCase();
  const fail = reason => ({ ok: false, reason });
  if (!file) return fail('The printer has no copy of this job’s file, so it cannot start it again. Start it from Bambu Studio or the printer’s screen.');
  if (!/\.3mf$/i.test(file)) return fail('Only jobs sent as a 3MF project can be printed again from here.');
  const gcodePlates = (entries?.names || []).map(name => /^Metadata\/plate_(\d+)\.gcode$/i.exec(name)?.[1]).filter(Boolean).map(Number);
  if (!gcodePlates.length) return fail('This file has no sliced plate to print.');
  const reported = /plate_(\d+)\.gcode/i.exec(job.file || '')?.[1];
  const plateIndex = reported ? Number(reported) : gcodePlates.length === 1 ? gcodePlates[0] : null;
  if (!plateIndex || !gcodePlates.includes(plateIndex)) return fail('The printer did not say which plate it printed.');
  const sliceXml = Object.entries(entries.bodies || {}).find(([name]) => /^Metadata\/slice_info\.config$/i.test(name))?.[1];
  const plate = parseSliceInfo(sliceXml?.toString('utf8')).find(item => item.index === plateIndex);
  if (!plate || !plate.filaments.length) return fail('The file does not list the filaments this plate uses.');
  const slots = Array.isArray(printer.filament?.slots) ? printer.filament.slots : [];
  const base = { ok: true, file, url: `ftp://${file.startsWith('/') ? file : `/${file}`}`, param: `Metadata/plate_${plateIndex}.gcode`, plate: plateIndex, name: String(job.name || file.replace(/^.*\//, '')).slice(0, 120) };

  if (model === 'H2D') {
    const mapping = Array.isArray(job.mapping) ? job.mapping : null;
    if (!mapping || !mapping.length) return fail('The printer did not report which AMS slots this job used. Start it from Bambu Studio or the printer’s screen.');
    const filaments = [];
    for (const filament of plate.filaments) {
      const value = mapping[filament.id - 1];
      if (!Number.isInteger(value) || value === UNMAPPED) return fail(`The printer did not report a slot for filament ${filament.id} (${filament.type}).`);
      const amsId = (value >> 8) & 255, slotId = value & 255;
      if (amsId > 15) return fail('This job used an external spool or an AMS HT; start it from the printer’s screen.');
      const slot = slots.find(item => item.amsId === amsId && item.slotId === slotId);
      if (!slot) return fail(`${slotName(amsId, slotId)} is empty now. Load the ${filament.type} used last time.`);
      if (!sameMaterial(slot.material, filament.type)) return fail(`${slotName(amsId, slotId)} now holds ${slot.material || 'an unknown material'}; this print needs ${filament.type}.`);
      filaments.push({ id: filament.id, type: filament.type, color: colorName(filament.color), slot: slotName(amsId, slotId), slotColor: colorName(slot.color) });
    }
    const amsMapping = mapping.map(value => value === UNMAPPED ? -1 : ((value >> 8) & 255) * 4 + (value & 255));
    const amsMapping2 = mapping.map(value => value === UNMAPPED ? { ams_id: 255, slot_id: 255 } : { ams_id: (value >> 8) & 255, slot_id: value & 255 });
    return { ...base, useAms: true, amsMapping, amsMapping2, filaments };
  }
  if (model === 'P1S') {
    // Without an AMS the P1S prints from its external spool.
    if (slots.length) return fail('This printer has an AMS, and it does not report which slots a job used. Start it from Bambu Studio or the printer’s screen.');
    if (plate.filaments.length !== 1) return fail('This plate uses several filaments, but the printer has only its external spool.');
    const filament = plate.filaments[0], spool = printer.filament?.external;
    if (spool?.material && !sameMaterial(spool.material, filament.type)) return fail(`The external spool holds ${spool.material}; this print needs ${filament.type}.`);
    return { ...base, useAms: false, amsMapping: [0], amsMapping2: null,
      filaments: [{ id: filament.id, type: filament.type, color: colorName(filament.color), slot: 'External spool', slotColor: colorName(spool?.color) }] };
  }
  return fail('Print again is available for the H2D and P1S.');
}

// The MQTT command for a plan built above.
function projectFileCommand(plan, sequenceId) {
  const print = {
    sequence_id: sequenceId, command: 'project_file', param: plan.param, url: plan.url, md5: '', file: '',
    subtask_name: plan.name, project_id: '0', profile_id: '0', task_id: '0', subtask_id: '0',
    timelapse: false, bed_type: 'auto', bed_leveling: true, bed_levelling: true, flow_cali: true, vibration_cali: false, layer_inspect: true,
    use_ams: plan.useAms, ams_mapping: plan.amsMapping,
  };
  if (plan.amsMapping2) print.ams_mapping2 = plan.amsMapping2;
  return { print };
}
// Only plans built by buildPlan reach the printer.
function validPlan(plan) {
  return Boolean(plan && plan.ok === true && typeof plan.url === 'string' && /^ftp:\/\/\/[^\u0000-\u001f]{1,300}\.3mf$/i.test(plan.url)
    && /^Metadata\/plate_\d{1,3}\.gcode$/.test(plan.param) && typeof plan.name === 'string' && typeof plan.useAms === 'boolean'
    && Array.isArray(plan.amsMapping) && plan.amsMapping.length <= 64 && plan.amsMapping.every(value => Number.isInteger(value) && value >= -1 && value <= 255)
    && (plan.amsMapping2 === null || (Array.isArray(plan.amsMapping2) && plan.amsMapping2.length === plan.amsMapping.length)));
}

module.exports = { parseSliceInfo, buildPlan, projectFileCommand, validPlan };
