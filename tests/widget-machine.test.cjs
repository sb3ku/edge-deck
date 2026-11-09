'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Loads the printer widget module in a minimal browser-like context and returns its pure helpers.
function load() {
  const context = { document: { addEventListener() {} } };
  context.window = context; vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'widget-machine.js'), 'utf8'), context);
  return context.EdgeWidgets.machine;
}
// Values made inside the vm context have their own prototypes, so they are compared as plain data.
const plain = value => JSON.parse(JSON.stringify(value));
const deep = (actual, expected, message) => assert.deepEqual(plain(actual), plain(expected), message);
const clock = (date, clock24) => date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: !clock24 });
const NOW = Date.parse('2026-11-08T12:00:00');
const iso = minutesAgo => new Date(NOW - minutesAgo * 60000).toISOString();
const configs = [{ id: 'h2d', name: 'Bambu Lab H2D', model: 'H2D', configured: true }, { id: 'p1s', name: 'Bambu Lab P1S', model: 'P1S', configured: true }, { id: 'new', name: 'Spare', model: 'P1S', configured: false }];
const printing = { id: 'h2d', name: 'Bambu Lab H2D', accountName: 'Big fella', status: 'printing', progress: 89.4, layer: 624, totalLayers: 746, remainingMinutes: 29, jobName: 'RACK PRINT Top', stage: { label: 'Printing' }, jobStartedAt: iso(131) };

test('the module registers render, signature, mood and helpers', () => {
  const widget = load();
  for (const key of ['render', 'signature', 'mood']) assert.equal(typeof widget[key], 'function', key);
  for (const key of ['resolve', 'statusLine', 'facts', 'tone', 'centreText']) assert.equal(typeof widget.helpers[key], 'function', key);
  assert.ok(Object.isFrozen(widget) && Object.isFrozen(widget.helpers));
});

test('resolve picks the chosen printer, falls back to the first, and gives nothing without printers', () => {
  const { resolve } = load().helpers;
  const idle = { id: 'p1s', status: 'idle', accountName: 'Little fella' };
  assert.equal(resolve(configs, [printing, idle], 'p1s', NOW).data, idle);
  assert.equal(resolve(configs, [printing, idle], 'missing', NOW).config.id, 'h2d');
  assert.equal(resolve(configs, [printing, idle], undefined, NOW).data, printing);
  deep(resolve([], [printing], 'h2d', NOW), { config: null, data: null, name: '' });
  deep(resolve(undefined, undefined, 'h2d', NOW), { config: null, data: null, name: '' });
  assert.equal(resolve([null, configs[1]], [idle], 'p1s', NOW).data, idle, 'holes in the config list are skipped');
});

test('a configured printer without state is connecting; an unconfigured one is not set up', () => {
  const { resolve } = load().helpers;
  deep(resolve(configs, [], 'h2d', NOW).data, { id: 'h2d', status: 'connecting' });
  deep(resolve(configs, null, 'new', NOW).data, { id: 'new', status: 'not_configured' });
  assert.equal(resolve(configs, [], 'new', NOW).name, 'Spare', 'the config name when there is no state');
});

test('a finish older than five minutes counts as idle; a fresh or undated one stays finished', () => {
  const { resolve, FINISHED_MS } = load().helpers;
  assert.equal(FINISHED_MS, 5 * 60000);
  const finished = { id: 'h2d', status: 'finished', thumbnail: 'h2d:1', finishedAt: iso(9), jobName: 'Leaf' };
  const expired = resolve(configs, [finished], 'h2d', NOW).data;
  assert.equal(expired.status, 'idle'); assert.equal(expired.thumbnail, null); assert.equal(expired.jobName, 'Leaf');
  assert.equal(resolve(configs, [{ ...finished, finishedAt: iso(3) }], 'h2d', NOW).data.status, 'finished');
  assert.equal(resolve(configs, [{ ...finished, finishedAt: undefined, finishedSeenAt: iso(6) }], 'h2d', NOW).data.status, 'idle', 'finishedSeenAt counts too');
  assert.equal(resolve(configs, [{ ...finished, finishedAt: undefined }], 'h2d', NOW).data.status, 'finished', 'no timestamp: never expires');
  assert.equal(resolve(configs, [finished], 'h2d', NOW, 15 * 60000).data.status, 'finished', 'the window can be widened');
});

test('the display name prefers the account name, then the printer name, then the config name', () => {
  const { resolve } = load().helpers;
  assert.equal(resolve(configs, [printing], 'h2d', NOW).name, 'Big fella');
  assert.equal(resolve(configs, [{ id: 'h2d', name: 'Shop H2D', status: 'idle' }], 'h2d', NOW).name, 'Shop H2D');
  assert.equal(resolve(configs, [{ id: 'h2d', status: 'idle' }], 'h2d', NOW).name, 'Bambu Lab H2D');
  assert.equal(resolve([{ id: 'x', configured: true }], [], 'x', NOW).name, 'Printer');
});

test('status lines: the finish time while printing, otherwise a word (or the error message)', () => {
  const { statusLine } = load().helpers;
  const done = new Date(NOW + 29 * 60000);
  assert.equal(statusLine(printing, true, NOW), `Done ${clock(done, true)}`);
  assert.equal(statusLine(printing, false, NOW), `Done ${clock(done, false)}`);
  assert.equal(statusLine({ ...printing, remainingMinutes: 0 }, true, NOW), 'Printing');
  assert.equal(statusLine({ ...printing, remainingMinutes: undefined }, true, NOW), 'Printing');
  const words = { paused: 'Paused', finished: 'Finished', idle: 'Ready to print', offline: 'Offline', connecting: 'Connecting', not_configured: 'Set up', error: 'Error' };
  for (const [status, line] of Object.entries(words)) assert.equal(statusLine({ status }, true, NOW), line, status);
  assert.equal(statusLine({ status: 'error', message: 'Filament ran out.' }, true, NOW), 'Filament ran out.');
  assert.equal(statusLine({ status: 'weird' }, true, NOW), 'Unknown');
  assert.equal(statusLine(null, true, NOW), 'Unknown');
});

test('the finish time names the day when the print ends on another day', () => {
  const { finishText, statusLine } = load().helpers;
  const late = new Date(NOW); late.setHours(23, 50, 0, 0);
  const done = new Date(late.getTime() + 30 * 60000);
  const expected = `${done.toLocaleDateString([], { weekday: 'short' })} ${clock(done, true)}`;
  assert.equal(finishText({ status: 'printing', remainingMinutes: 30 }, true, late.getTime()), expected);
  assert.equal(statusLine({ status: 'printing', remainingMinutes: 30 }, true, late.getTime()), `Done ${expected}`);
  assert.equal(finishText({ status: 'paused', remainingMinutes: 30 }, true, NOW), '', 'a paused print has no finish time');
});

test('facts while printing come in order; paused prints have no end time; idle has none', () => {
  const { facts } = load().helpers;
  const done = clock(new Date(NOW + 29 * 60000), true);
  deep(facts(printing, true, NOW), [['Job', 'RACK PRINT Top'], ['Layer', '624 of 746'], ['Time left', '29 min'], ['Ends at', done], ['Started', '2h ago'], ['Stage', 'Printing']]);
  const paused = { ...printing, status: 'paused', remainingMinutes: 83, layer: 900, stage: { label: 'Paused by user' }, jobStartedAt: iso(50) };
  deep(facts(paused, true, NOW), [['Job', 'RACK PRINT Top'], ['Layer', '746 of 746'], ['Time left', '1h 23m'], ['Started', '50 min ago'], ['Stage', 'Paused by user']]);
  deep(facts({ status: 'printing', progress: 10 }, true, NOW), [], 'nothing known: no facts');
  deep(facts({ status: 'printing', totalLayers: 0, layer: 3, remainingMinutes: -2, jobStartedAt: 'garbage' }, true, NOW), []);
  deep(facts({ ...printing, status: 'idle' }, true, NOW), []);
  deep(facts(undefined, true, NOW), []);
  deep(facts({ status: 'printing', layer: 5, totalLayers: 20 }, true, NOW), [['Layer', '5 of 20']]);
});

test('tone, centre text and ring value per status', () => {
  const { tone, centreText, ringValue } = load().helpers;
  deep(['printing', 'paused', 'error', 'finished', 'idle', 'offline', 'connecting', 'not_configured', undefined].map(tone), ['print', 'paused', 'error', 'done', '', '', '', '', '']);
  assert.equal(centreText(printing), '89%'); assert.equal(ringValue(printing), 89.4);
  assert.equal(centreText({ status: 'paused', progress: 46 }), '46%'); assert.equal(ringValue({ status: 'paused', progress: 46 }), 46);
  assert.equal(centreText({ status: 'printing', progress: 120 }), '100%'); assert.equal(ringValue({ status: 'printing', progress: 120 }), 100);
  assert.equal(centreText({ status: 'printing' }), '—'); assert.equal(ringValue({ status: 'printing', progress: NaN }), 0);
  assert.equal(centreText({ status: 'finished' }), '✓'); assert.equal(ringValue({ status: 'finished' }), 100);
  assert.equal(centreText({ status: 'error' }), '!'); assert.equal(ringValue({ status: 'error', progress: 61 }), 100);
  assert.equal(centreText({ status: 'idle' }), 'Ready'); assert.equal(ringValue({ status: 'idle' }), 0);
  assert.equal(centreText({ status: 'offline' }), '—'); assert.equal(centreText({ status: 'connecting' }), '—');
  assert.equal(centreText({ status: 'not_configured' }), '+'); assert.equal(ringValue({ status: 'not_configured' }), 0);
  assert.equal(centreText(null), '—'); assert.equal(ringValue(null), 0);
});

test('the ring button is described in words', () => {
  const { summary } = load().helpers;
  assert.equal(summary('Big fella', printing, true, NOW), `Big fella: 89 percent, done at ${clock(new Date(NOW + 29 * 60000), true)}`);
  assert.equal(summary('Big fella', { ...printing, remainingMinutes: null }, true, NOW), 'Big fella: 89 percent');
  assert.equal(summary('P1S', { status: 'paused', progress: 46 }, true, NOW), 'P1S: 46 percent, paused');
  assert.equal(summary('P1S', { status: 'idle' }, true, NOW), 'P1S: Ready to print');
  assert.equal(summary('P1S', { status: 'error', message: 'Filament ran out.' }, true, NOW), 'P1S: Filament ran out.');
});

test('mood follows the printer: attention while paused or in error', () => {
  const { moodFor } = load().helpers;
  deep(moodFor({ status: 'error' }), { mood: 'error', attention: true });
  deep(moodFor({ status: 'paused' }), { mood: 'paused', attention: true });
  deep(moodFor({ status: 'printing' }), { mood: 'print', attention: false });
  deep(moodFor({ status: 'finished' }), { mood: 'done', attention: false });
  for (const status of ['idle', 'offline', 'connecting', 'not_configured', undefined]) deep(moodFor({ status }), { mood: '', attention: false }, String(status));
  deep(moodFor(null), { mood: '', attention: false });
});

test('mood and signature read the dashboard state through the context', () => {
  const widget = load();
  const ctx = { item: { printerId: 'h2d' }, size: 'small', mode: 'widgets', state: () => ({ printers: [{ ...printing, status: 'paused' }] }), config: () => ({ printers: configs }), clock24: () => true, PRINTER_FINISHED_MS: 5 * 60000 };
  deep(widget.mood(ctx), { mood: 'paused', attention: true });
  const signature = widget.signature(ctx);
  deep(signature.slice(0, 4), ['h2d', ctx.state().printers, configs, 'small']);
  assert.equal(signature[4], null, 'no finish: no minute bucket');
  const finished = { ...ctx, state: () => ({ printers: [{ id: 'h2d', status: 'finished', finishedAt: new Date(Date.now() - 2.5 * 60000).toISOString() }] }) };
  assert.equal(widget.signature(finished)[4], 2, 'a fresh finish is re-checked every minute so it turns idle on time');
  deep(widget.mood({ ...ctx, state: () => ({ printers: [] }), config: () => ({ printers: [] }) }), { mood: '', attention: false }, 'no printer at all');
  deep(widget.signature({ ...ctx, state: () => ({ printers: [] }), config: () => ({ printers: [] }) }).slice(4), [null, true, 0], 'no printer: no finish and no camera taps');
});

test('the signature changes with the time format, so finish times are redrawn when the setting changes', () => {
  const widget = load();
  const ctx = { item: { printerId: 'h2d' }, size: 'small', mode: 'widgets', state: () => ({ printers: [printing] }), config: () => ({ printers: configs }), clock24: () => true, PRINTER_FINISHED_MS: 5 * 60000 };
  const before = JSON.stringify(plain(widget.signature(ctx)));
  assert.equal(widget.signature(ctx)[5], true);
  const after = widget.signature({ ...ctx, clock24: () => false });
  assert.equal(after[5], false);
  assert.notEqual(JSON.stringify(plain(after)), before);
});

test('camera taps are counted per printer and change only that printer\'s signature', () => {
  const widget = load();
  const { cameraTap } = widget.helpers;
  // A click target inside a row's camera button: the icon within the button within the row.
  const target = id => ({ closest: selector => selector === '.printer-camera-toggle' ? { closest: inner => (inner === '.printer' ? { dataset: { printerId: id } } : null) } : null });
  const ctx = id => ({ item: { printerId: id }, size: 'medium', mode: 'widgets', state: () => ({ printers: [printing] }), config: () => ({ printers: configs }), clock24: () => true, PRINTER_FINISHED_MS: 5 * 60000 });
  assert.equal(widget.signature(ctx('h2d'))[6], 0, 'untouched: no taps');
  assert.equal(cameraTap(target('h2d')), 'h2d');
  assert.equal(widget.signature(ctx('h2d'))[6], 1, 'a tap on this printer\'s camera button is counted');
  assert.equal(widget.signature(ctx('p1s'))[6], 0, 'another printer is untouched');
  assert.equal(cameraTap(target('h2d')), 'h2d');
  assert.equal(widget.signature(ctx('h2d'))[6], 2, 'turning the camera off again counts too');
  assert.equal(cameraTap({ closest: () => null }), null, 'a click elsewhere is ignored');
  assert.equal(cameraTap({ closest: selector => (selector === '.printer-camera-toggle' ? { closest: () => null } : null) }), null, 'a camera button outside a row is ignored');
  assert.equal(cameraTap(null), null); assert.equal(cameraTap({}), null);
  assert.equal(widget.signature(ctx('h2d'))[6], 2, 'ignored clicks change nothing');
  assert.equal(widget.signature(ctx('missing'))[6], 2, 'a missing id falls back to the first printer, whose taps count');
});

test('the layout: the card size in Widgets mode, the Medium row everywhere else', () => {
  const { layoutFor } = load().helpers;
  deep(['small', 'medium', 'large', 'tall', 'wide', undefined].map(size => layoutFor('widgets', size)), ['small', 'medium', 'large', 'tall', 'medium', 'medium']);
  for (const mode of ['overview', 'bento', 'focus', 'auto', undefined]) assert.equal(layoutFor(mode, 'small'), 'medium', String(mode));
});

test('time words: how long ago, how long left, how long it took', () => {
  const { agoText, leftText, durationText, finishedFor } = load().helpers;
  assert.equal(agoText(iso(0), NOW), 'just now'); assert.equal(agoText(iso(7), NOW), '7 min ago');
  assert.equal(agoText(iso(131), NOW), '2h ago'); assert.equal(agoText(iso(3000), NOW), '2d ago'); assert.equal(agoText(undefined, NOW), '');
  assert.equal(leftText(29), '29 min'); assert.equal(leftText(83), '1h 23m'); assert.equal(leftText(0.4), '0 min'); assert.equal(leftText(-1), ''); assert.equal(leftText('x'), '');
  assert.equal(durationText(130 * 60000), '2h 10m'); assert.equal(durationText(5 * 60000), '5m'); assert.equal(durationText(-1), ''); assert.equal(durationText(NaN), '');
  assert.equal(finishedFor({ status: 'finished', finishedAt: iso(3) }, NOW), 3 * 60000);
  assert.equal(finishedFor({ status: 'finished' }, NOW), null); assert.equal(finishedFor({ status: 'idle', finishedAt: iso(3) }, NOW), null);
});
