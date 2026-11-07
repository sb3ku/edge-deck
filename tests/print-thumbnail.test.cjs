'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { zipEntries, parseDirectory, pickPreview, plateNumber, matchFile, candidates, gcodePicture, createThumbnailStore } = require('../lib/print-thumbnail.cjs');

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('fake png body')]);

// A small ZIP with stored and deflated entries, like a 3MF.
function zip(files) {
  const locals = [], centrals = []; let offset = 0;
  for (const [name, data, deflate] of files) {
    const body = deflate ? zlib.deflateRawSync(data) : data, nameBuffer = Buffer.from(name);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(deflate ? 8 : 0, 8);
    local.writeUInt32LE(body.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBuffer.length, 26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(deflate ? 8 : 0, 10);
    central.writeUInt32LE(body.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBuffer.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuffer, body); centrals.push(central, nameBuffer); offset += 30 + nameBuffer.length + body.length;
  }
  const directory = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

test('3MF: the directory is read from the tail and the printed plate picture chosen', () => {
  const archive = zip([['3D/3dmodel.model', Buffer.alloc(5000, 1), true], ['Metadata/plate_1.png', Buffer.from('one'), false], ['Metadata/plate_2.png', PNG, true]]);
  const { size, offset } = zipEntries(archive, 0);
  const entries = parseDirectory(archive.subarray(offset, offset + size));
  assert.deepEqual(entries.map(entry => entry.name), ['3D/3dmodel.model', 'Metadata/plate_1.png', 'Metadata/plate_2.png']);
  assert.equal(plateNumber('/data/Metadata/plate_2.gcode'), 2);
  assert.equal(plateNumber(null), 1);
  const entry = pickPreview(entries, 2);
  assert.equal(entry.name, 'Metadata/plate_2.png');
  const start = entry.local + 30 + archive.readUInt16LE(entry.local + 26) + archive.readUInt16LE(entry.local + 28);
  assert.deepEqual(zlib.inflateRawSync(archive.subarray(start, start + entry.compressed)), PNG);
  assert.equal(pickPreview(entries, 9).name, 'Metadata/plate_1.png', 'falls back to the first plate');
});

test('the job file is matched by name, with or without its endings', () => {
  const names = ['Case for the MMSS_plate_3.gcode', '86mm.3mf', 'Boat.gcode.3mf', 'notes.txt'];
  assert.equal(matchFile(names, { name: '86mm' }), '86mm.3mf');
  assert.equal(matchFile(names, { name: 'Boat' }), 'Boat.gcode.3mf');
  assert.equal(matchFile(names, { file: '/data/Case for the MMSS_plate_3.gcode' }), 'Case for the MMSS_plate_3.gcode');
  assert.equal(matchFile(names, { name: 'missing' }), null);
  assert.ok(candidates({ name: 'Fern' }).includes('/cache/Fern.gcode.3mf'));
  assert.deepEqual(candidates({ name: 'bad\u0001name' }), []);
});

test('G-code: the largest embedded thumbnail is decoded', async () => {
  const small = Buffer.concat([PNG, Buffer.from('s')]).toString('base64'), large = Buffer.concat([PNG, Buffer.from('large')]).toString('base64');
  const block = (size, data) => `; thumbnail begin ${size} ${data.length}\n${data.match(/.{1,40}/g).map(line => `; ${line}`).join('\n')}\n; thumbnail end\n`;
  const text = Buffer.from(`; HEADER_BLOCK_START\n; THUMBNAIL_BLOCK_START\n${block('50x50', small)}${block('300x300', large)}; THUMBNAIL_BLOCK_END\nG28\n`, 'latin1');
  const session = { read: async (file, offset, length) => text.subarray(offset, offset + length) };
  const picture = await gcodePicture(session, '/cache/x.gcode');
  assert.deepEqual(picture.data, Buffer.concat([PNG, Buffer.from('large')]));
  assert.equal(await gcodePicture({ read: async () => Buffer.from('; no thumbnails\nG28\n') }, 'x'), null);
});

test('the store fetches once per job, retries failures later and forgets finished jobs', async () => {
  let calls = 0, clock = 1000, result = null, changes = 0;
  const store = createThumbnailStore({ fetch: async () => { calls++; return result; }, onChange: () => changes++, now: () => clock });
  const config = { host: '192.168.1.5', accessCode: 'x' }, job = { key: 'a', name: 'Fern' };
  store.update('p', config, job); await new Promise(setImmediate);
  assert.equal(calls, 1); assert.equal(store.version('p'), null);
  store.update('p', config, job); await new Promise(setImmediate);
  assert.equal(calls, 1, 'waits before retrying');
  clock += 31000; result = { type: 'image/png', data: PNG };
  store.update('p', config, job); await new Promise(setImmediate);
  assert.equal(calls, 2); assert.equal(changes, 1);
  assert.match(store.get('p'), /^data:image\/png;base64,/);
  store.update('p', config, job); await new Promise(setImmediate);
  assert.equal(calls, 2, 'a fetched picture is kept for the job');
  store.update('p', config, null);
  assert.equal(store.get('p'), null); assert.equal(changes, 2);
});

test('a job is found in the slicer\'s recent projects by project and plate name', async t => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const { localPicture, plateNames } = require('../lib/print-thumbnail.cjs');
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-deck-project-')); t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const settings = '<config><plate><metadata key="plater_id" value="1"/><metadata key="plater_name" value="[Print x4] - 6U Leg"/></plate><plate><metadata key="plater_id" value="2"/><metadata key="plater_name" value="[Print x2] - Top Connector"/></plate><plate><metadata key="plater_id" value="3"/><metadata key="plater_name" value="[Print x2] - Bottom Connector"/></plate></config>';
  assert.deepEqual(plateNames(settings).map(plate => plate.id), [1, 2, 3]);
  const second = Buffer.concat([PNG, Buffer.from('plate three')]);
  const project = path.join(folder, 'RACK PRINT.3mf');
  fs.writeFileSync(project, zip([['Metadata/model_settings.config', Buffer.from(settings), true], ['Metadata/plate_1.png', PNG, false], ['Metadata/plate_3.png', second, true]]));
  const config = path.join(folder, 'BambuStudio.conf');
  fs.writeFileSync(config, JSON.stringify({ recent_projects: { '001': project } }, null, 4) + '\n# MD5 checksum 00\n');
  assert.deepEqual((await localPicture({ name: 'RACK PRINT_Print x2 - Bottom Connector' }, { configs: [config] })).data, second);
  assert.deepEqual((await localPicture({ name: 'RACK PRINT_Print x4 - 6U Leg' }, { configs: [config] })).data, PNG);
  assert.equal(await localPicture({ name: 'RACK PRINT_Missing plate' }, { configs: [config] }), null);
  assert.equal(await localPicture({ name: 'Other project_Plate' }, { configs: [config] }), null);
});
