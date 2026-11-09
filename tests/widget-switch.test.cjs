'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Loads the Switch widget module in a minimal browser-like context; the helpers under test need no DOM.
// Results are cloned into this realm, so strict deep equality is not tripped by the context's own prototypes.
function load() {
  const context = { document: { addEventListener() {} } };
  context.window = context; vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'widget-switch.js'), 'utf8'), context);
  const widget = context.window.EdgeWidgets.switch, helpers = {};
  for (const [name, value] of Object.entries(widget.helpers)) helpers[name] = typeof value === 'function' ? (...args) => structuredClone(value(...args)) : structuredClone(value);
  return { ...widget, helpers, signature: ctx => structuredClone(widget.signature(ctx)) };
}
// The preview harness's sample data shapes.
const controls = { wifi: true, bluetooth: true, dark: true, ready: true };
const audio = { outputMuted: false, inputMuted: false, outputs: [{ id: 'a', name: 'Headphones (3mk Fuego)', isDefault: true }, { id: 'b', name: 'Speakers (Realtek High Definition Audio)', isDefault: false }], inputs: [{ id: 'm', name: 'Microphone (3mk Fuego)', isDefault: true }] };
const wifiList = [{ ssid: 'Frondea', connected: true, saved: true, secure: true, signal: 92 }, { ssid: 'Neighbours 5G', connected: false, saved: false, secure: true, signal: 61 }, { ssid: 'Cafe', connected: false, saved: true, secure: false, signal: 40 }];
const btList = [{ name: '3mk Fuego', kind: 'AudioVideo', connected: true }, { name: 'Xbox Wireless Controller', kind: 'Peripheral', connected: false }];
const cache = { wifi: { items: wifiList }, bluetooth: { items: btList } };

test('the module registers render, signature and helpers, with no mood', () => {
  const widget = load();
  assert.equal(typeof widget.render, 'function');
  assert.equal(typeof widget.signature, 'function');
  assert.equal(widget.mood, undefined);
  assert.equal(widget.live, undefined);
  const ctx = { item: { control: 'sound' }, state: () => ({ controls, media: { audio, volume: 32 } }) };
  assert.deepEqual(widget.signature(ctx), ['sound', controls, audio, 32]);
  assert.deepEqual(widget.signature({ item: {}, state: () => ({}) }), [undefined, undefined, undefined, undefined]);
});

test('describe and shortName turn Windows device names into a short name, a kind and a symbol', () => {
  const { describe, shortName } = load().helpers;
  assert.deepEqual(describe({ name: 'Headphones (3mk Fuego)' }), { name: '3mk Fuego', kind: 'Headphones', symbol: 'headphones' });
  assert.deepEqual(describe({ name: 'Speakers (Realtek High Definition Audio)' }), { name: 'Realtek', kind: 'Speakers', symbol: 'speakers' });
  assert.deepEqual(describe({ name: 'LG ULTRAGEAR (NVIDIA High Definition Audio)' }), { name: 'NVIDIA', kind: 'LG ULTRAGEAR · HDMI / DisplayPort', symbol: 'display' });
  assert.deepEqual(describe({ name: 'Digital Audio (S/PDIF)' }).symbol, 'digital');
  assert.deepEqual(describe({}), { name: 'Audio device', kind: '', symbol: 'speakers' });
  assert.deepEqual(describe(null).name, 'Audio device');
  assert.equal(shortName('Microphone (3mk Fuego)'), '3mk Fuego');
  assert.equal(shortName('Realtek Audio'), 'Realtek Audio');
});

test('statusFor: Wi-Fi shows the connected network, Off, Checking… or Not available', () => {
  const { statusFor } = load().helpers;
  assert.deepEqual(statusFor('wifi', controls, audio, cache), { on: true, known: true, muted: false, symbol: 'wifi', status: 'Frondea' });
  assert.equal(statusFor('wifi', controls, audio, {}).status, 'On', 'no list yet');
  assert.equal(statusFor('wifi', controls, audio, { wifi: [wifiList[1]] }).status, 'On', 'a bare array with nothing connected');
  assert.deepEqual(statusFor('wifi', { wifi: false, ready: true }, audio, cache), { on: false, known: true, muted: false, symbol: 'wifiOff', status: 'Off' });
  assert.deepEqual(statusFor('wifi', { wifi: null, ready: false }, audio, cache), { on: false, known: false, muted: false, symbol: 'wifi', status: 'Checking…' });
  assert.equal(statusFor('wifi', { wifi: null, ready: true }, audio, cache).status, 'Not available');
  assert.equal(statusFor('wifi', undefined, undefined, undefined).status, 'Checking…', 'nothing read yet');
});

test('statusFor: Bluetooth and Dark mode are On, Off or unknown; Night light is a plain Settings button', () => {
  const { statusFor } = load().helpers;
  assert.deepEqual(statusFor('bluetooth', controls, audio, cache), { on: true, known: true, muted: false, symbol: 'bluetooth', status: 'On' });
  assert.equal(statusFor('bluetooth', { bluetooth: false, ready: true }).status, 'Off');
  assert.equal(statusFor('bluetooth', { bluetooth: null, ready: true }).status, 'Not available');
  assert.deepEqual(statusFor('dark', controls), { on: true, known: true, muted: false, symbol: 'moon', status: 'On' });
  assert.deepEqual(statusFor('dark', { dark: false, ready: true }), { on: false, known: true, muted: false, symbol: 'sun', status: 'Off' });
  assert.equal(statusFor('dark', { dark: null, ready: false }).status, 'Checking…');
  assert.deepEqual(statusFor('night', controls), { on: false, known: true, muted: false, symbol: 'night', status: 'Settings' });
});

test('statusFor: Sound and Microphone show Muted or the default device, and go unknown without audio state', () => {
  const { statusFor } = load().helpers;
  assert.deepEqual(statusFor('sound', controls, audio), { on: true, known: true, muted: false, symbol: 'speaker', status: '3mk Fuego' });
  assert.deepEqual(statusFor('sound', controls, { ...audio, outputMuted: true }), { on: false, known: true, muted: true, symbol: 'muted', status: 'Muted' });
  assert.deepEqual(statusFor('mic', controls, audio), { on: true, known: true, muted: false, symbol: 'mic', status: '3mk Fuego' });
  assert.deepEqual(statusFor('mic', controls, { ...audio, inputMuted: true }), { on: false, known: true, muted: true, symbol: 'micOff', status: 'Muted' });
  assert.equal(statusFor('sound', controls, { ...audio, outputs: [] }).status, 'On', 'no default device');
  assert.deepEqual(statusFor('sound', controls, { outputMuted: null, outputs: [] }), { on: false, known: false, muted: false, symbol: 'speaker', status: 'Unavailable' });
  assert.equal(statusFor('mic', controls, null).status, 'Checking…', 'media state not read yet');
});

test('withPending shows a tapped value before the service confirms it', () => {
  const { withPending, statusFor } = load().helpers;
  const pending = { wifi: { value: false }, output: { muted: true }, 'wifi:Cafe': { value: null }, 'settings:wifi': { value: null } };
  const next = withPending(controls, audio, pending);
  assert.equal(next.controls.wifi, false); assert.equal(next.controls.bluetooth, true);
  assert.equal(next.audio.outputMuted, true); assert.equal(next.audio.inputMuted, false);
  assert.equal(controls.wifi, true, 'the originals are untouched'); assert.equal(audio.outputMuted, false);
  assert.equal(statusFor('wifi', next.controls, next.audio, cache).status, 'Off');
  assert.equal(statusFor('sound', next.controls, next.audio).status, 'Muted');
  assert.deepEqual(withPending(undefined, null, {}), { controls: {}, audio: null });
  assert.deepEqual(withPending(controls, audio), { controls, audio });
});

test('orderNetworks puts the connected network first, then saved ones, then by signal, and drops junk', () => {
  const { orderNetworks, orderDevices } = load().helpers;
  assert.deepEqual(orderNetworks(wifiList).map(n => n.ssid), ['Frondea', 'Cafe', 'Neighbours 5G']);
  const messy = [{ ssid: 'B', signal: 50 }, { ssid: 'A', signal: 50 }, { ssid: '' }, null, { signal: 99 }, { ssid: 'S', saved: true, signal: 10 }, { ssid: 'C', connected: true, signal: 1 }];
  assert.deepEqual(orderNetworks(messy).map(n => n.ssid), ['C', 'S', 'A', 'B']);
  assert.deepEqual(orderNetworks(null), []);
  assert.deepEqual(orderNetworks({ items: wifiList }), [], 'only arrays are lists');
  assert.deepEqual(orderDevices(btList).map(d => d.name), ['3mk Fuego', 'Xbox Wireless Controller']);
  assert.deepEqual(orderDevices([{ name: 'Z' }, { name: 'M', connected: true }, { name: 'A' }, {}]).map(d => d.name), ['M', 'A', 'Z']);
});

test('detailFor: the Medium detail for each control', () => {
  const { detailFor } = load().helpers;
  assert.deepEqual(detailFor('wifi', controls, audio, cache), { title: 'Frondea', lines: ['Signal 92%', '2 saved networks'] });
  assert.deepEqual(detailFor('wifi', controls, audio, { wifi: { items: [wifiList[1]] } }), { title: 'Not connected', lines: ['1 network in range', '0 saved networks'] });
  assert.deepEqual(detailFor('wifi', { wifi: false, ready: true }, audio, cache), { title: 'Wi-Fi is off', lines: ['Turn it on to see networks'] });
  assert.deepEqual(detailFor('wifi', controls, audio, {}), { title: 'Looking for networks…', lines: [] });
  assert.deepEqual(detailFor('wifi', controls, audio, { wifi: { items: null, error: 'The adapter is busy.' } }), { title: 'Networks could not be read', lines: ['The adapter is busy.'] });
  assert.deepEqual(detailFor('wifi', { wifi: null, ready: true }), { title: 'Not available', lines: ['Not supported on this PC'] });
  assert.deepEqual(detailFor('wifi', { wifi: null, ready: false }), { title: 'Checking…', lines: ['Reading Windows settings…'] });
  assert.deepEqual(detailFor('bluetooth', controls, audio, cache), { title: '3mk Fuego', lines: ['Connected'] });
  const many = { bluetooth: { items: [{ name: 'A', connected: true }, { name: 'B', connected: true }, { name: 'C', connected: true }, { name: 'D', connected: true }, { name: 'E' }] } };
  assert.deepEqual(detailFor('bluetooth', controls, audio, many), { title: 'A', lines: ['B, C +1', '4 devices connected'] });
  assert.deepEqual(detailFor('bluetooth', controls, audio, { bluetooth: { items: [btList[1]] } }), { title: 'No devices connected', lines: ['1 paired device'] });
  assert.deepEqual(detailFor('bluetooth', controls, audio, { bluetooth: { items: [] } }), { title: 'No devices connected', lines: ['Pair one in Bluetooth settings'] });
  assert.deepEqual(detailFor('bluetooth', { bluetooth: false, ready: true }), { title: 'Bluetooth is off', lines: ['Turn it on to connect devices'] });
  assert.deepEqual(detailFor('sound', controls, audio), { title: '3mk Fuego', lines: ['Headphones'] });
  assert.deepEqual(detailFor('mic', controls, audio), { title: '3mk Fuego', lines: ['Microphone', 'Not muted'] });
  assert.deepEqual(detailFor('mic', controls, { ...audio, inputMuted: true }), { title: '3mk Fuego', lines: ['Microphone', 'Muted'] });
  assert.deepEqual(detailFor('sound', controls, { outputs: [], error: 'x' }), { title: 'No output device', lines: ['Windows audio devices could not be read'] });
  assert.deepEqual(detailFor('mic', controls, { inputs: [] }), { title: 'No microphone', lines: ['No recording devices are active'] });
  assert.deepEqual(detailFor('sound', controls, null), { title: 'Checking…', lines: ['Reading Windows audio…'] });
  assert.deepEqual(detailFor('dark', controls), { title: 'Dark theme', lines: ['Windows apps use the dark theme'], art: 'dark' });
  assert.deepEqual(detailFor('dark', { dark: false, ready: true }), { title: 'Light theme', lines: ['Windows apps use the light theme'], art: 'light' });
  assert.deepEqual(detailFor('dark', { dark: null, ready: false }), { title: 'Checking…', lines: ['Reading Windows settings…'], art: 'dark' });
  assert.deepEqual(detailFor('night', controls), { title: 'Warmer colours', lines: ['Schedule and strength are in Windows settings'], art: 'night' });
});

test('rowsFor: Wi-Fi rows connect, arm a disconnect or open settings', () => {
  const { rowsFor } = load().helpers;
  const { rows, note } = rowsFor('wifi', controls, audio, cache);
  assert.equal(note, '');
  assert.deepEqual(rows.map(r => [r.title, r.subtitle, r.action, r.selected, r.trailing]), [
    ['Frondea', 'Connected · 92%', 'disconnect', true, ''], ['Cafe', 'Saved · 40%', 'connect', false, undefined], ['Neighbours 5G', 'Secured · 61%', 'settings', false, undefined]]);
  assert.equal(rows[0].key, 'wifi:Frondea'); assert.equal(rows[0].symbol, 'wifi'); assert.equal(rows[0].armed, false);
  const armed = rowsFor('wifi', controls, audio, cache, 'Frondea', { 'wifi:Cafe': { value: null } });
  assert.equal(armed.rows[0].armed, true); assert.equal(armed.rows[0].trailing, 'Disconnect');
  assert.equal(armed.rows[1].pending, true); assert.equal(armed.rows[0].pending, false);
  assert.equal(rowsFor('wifi', controls, audio, { wifi: { items: [{ ssid: 'Open', signal: 30 }] } }).rows[0].subtitle, 'Open · 30%');
  assert.deepEqual(rowsFor('wifi', { wifi: false, ready: true }, audio, cache), { rows: [], note: 'Wi-Fi is off.' });
  assert.deepEqual(rowsFor('wifi', controls, audio, {}), { rows: [], note: 'Looking for networks…', loading: true }, 'a list on its way keeps its place');
  assert.deepEqual(rowsFor('wifi', controls, audio, { wifi: { items: null, error: 'Busy.' } }), { rows: [], note: 'Busy.' });
  assert.deepEqual(rowsFor('wifi', controls, audio, { wifi: { items: [] } }), { rows: [], note: 'No networks found.' });
  assert.deepEqual(rowsFor('wifi', { wifi: null, ready: true }, audio, cache), { rows: [], note: '' });
});

test('rowsFor: Bluetooth rows pick a glyph by kind and open settings', () => {
  const { rowsFor } = load().helpers;
  const { rows } = rowsFor('bluetooth', controls, audio, cache);
  assert.deepEqual(rows.map(r => [r.title, r.subtitle, r.symbol, r.action, r.selected]), [['3mk Fuego', 'Connected', 'headphones', 'settings', true], ['Xbox Wireless Controller', 'Paired', 'gamepad', 'settings', false]]);
  assert.equal(rowsFor('bluetooth', controls, audio, { bluetooth: { items: [{ name: 'Tag', kind: 'Other' }] } }).rows[0].symbol, 'bluetooth');
  assert.deepEqual(rowsFor('bluetooth', { bluetooth: false, ready: true }, audio, cache), { rows: [], note: 'Bluetooth is off.' });
  assert.deepEqual(rowsFor('bluetooth', controls, audio, { bluetooth: { items: [] } }), { rows: [], note: 'No paired devices. Pair one in Bluetooth settings.' });
  assert.deepEqual(rowsFor('bluetooth', controls, audio, {}), { rows: [], note: 'Looking for devices…', loading: true });
  assert.deepEqual(rowsFor('bluetooth', controls, audio, { bluetooth: { items: null, error: 'Busy.' } }), { rows: [], note: 'Busy.' }, 'a failed list is not loading');
});

test('rowLabel says what a row is and what a tap does, for audio devices too', () => {
  const { rowLabel, rowsFor } = load().helpers;
  const [current, other] = rowsFor('sound', controls, audio).rows;
  assert.equal(rowLabel('sound', current), '3mk Fuego, Headphones, current output');
  assert.equal(rowLabel('sound', other), 'Use Realtek as the output');
  assert.equal(rowLabel('mic', rowsFor('mic', controls, audio).rows[0]), '3mk Fuego, Microphone, current microphone');
  assert.equal(rowLabel('mic', { ...other, flow: 'inputs', title: 'Webcam' }), 'Use Webcam as the microphone');
  const [connected, saved, open] = rowsFor('wifi', controls, audio, cache).rows;
  assert.equal(rowLabel('wifi', connected), 'Frondea, connected · 92%. Tap twice to disconnect');
  assert.equal(rowLabel('wifi', { ...connected, armed: true }), 'Disconnect from Frondea');
  assert.equal(rowLabel('wifi', saved), 'Connect to Cafe, saved · 40%');
  assert.equal(rowLabel('wifi', open), 'Neighbours 5G, secured · 61%. Opens Wi-Fi settings');
  assert.equal(rowLabel('bluetooth', rowsFor('bluetooth', controls, audio, cache).rows[0]), '3mk Fuego, connected. Opens Bluetooth settings');
});

test('listPlan polls only while the radio is on: Wi-Fi once a minute on Small, lists every 10 s', () => {
  const { listPlan } = load().helpers;
  assert.deepEqual(listPlan('wifi', 'small', controls), { kind: 'wifi', period: 60000 });
  for (const variant of ['medium', 'large', 'tall']) assert.deepEqual(listPlan('wifi', variant, controls), { kind: 'wifi', period: 10000 });
  assert.deepEqual(listPlan('bluetooth', 'large', controls), { kind: 'bluetooth', period: 10000 });
  assert.equal(listPlan('bluetooth', 'small', controls), null, 'a Small Bluetooth card only shows On/Off');
  for (const value of [false, null, undefined]) {
    assert.equal(listPlan('wifi', 'large', { ...controls, wifi: value }), null, `wifi ${value}: nothing to list`);
    assert.equal(listPlan('bluetooth', 'large', { ...controls, bluetooth: value }), null, `bluetooth ${value}: nothing to list`);
  }
  assert.equal(listPlan('wifi', 'large', undefined), null, 'controls not read yet');
  for (const control of ['sound', 'mic', 'dark', 'night']) assert.equal(listPlan(control, 'large', { ...controls, [control]: true }), null);
});

test('rowsFor: audio devices mark the default with a check and move it while a choice is pending', () => {
  const { rowsFor } = load().helpers;
  const outputs = rowsFor('sound', controls, audio).rows;
  assert.deepEqual(outputs.map(r => [r.title, r.subtitle, r.symbol, r.action, r.check, r.key]), [['3mk Fuego', 'Headphones', 'headphones', 'none', true, 'outputs:a'], ['Realtek', 'Speakers', 'speakers', 'select', false, 'outputs:b']]);
  assert.equal(outputs[1].flow, 'outputs'); assert.equal(outputs[1].id, 'b');
  const pending = rowsFor('sound', controls, audio, {}, null, { outputs: { selected: 'b' } }).rows;
  assert.deepEqual(pending.map(r => [r.check, r.pending]), [[false, false], [true, true]]);
  const inputs = rowsFor('mic', controls, audio).rows;
  assert.deepEqual(inputs.map(r => [r.title, r.subtitle, r.symbol, r.action]), [['3mk Fuego', 'Microphone', 'mic', 'none']]);
  assert.equal(rowsFor('sound', controls, { outputs: [{ name: 'No id' }] }).rows.length, 0, 'a device without an id cannot be chosen');
  assert.deepEqual(rowsFor('sound', controls, { outputs: [], error: 'x' }), { rows: [], note: 'Windows audio devices could not be read.' });
  assert.deepEqual(rowsFor('mic', controls, { inputs: [] }), { rows: [], note: 'No recording devices are active.' });
  assert.deepEqual(rowsFor('sound', controls, null), { rows: [], note: 'No playback devices are active.' });
  assert.deepEqual(rowsFor('dark', controls, audio, cache), { rows: [], note: '' });
  assert.deepEqual(rowsFor('night', controls, audio, cache), { rows: [], note: '' });
});

test('fitRows keeps whole rows and turns the last slot into a "+n more" line', () => {
  const { fitRows } = load().helpers;
  assert.deepEqual(fitRows(400, 3), { shown: 3, more: 0 });
  assert.deepEqual(fitRows(400, 6), { shown: 6, more: 0 }, 'six rows of 56px with 6px gaps are 366px');
  assert.deepEqual(fitRows(400, 7), { shown: 6, more: 1 }, 'the seventh gives way to the more line');
  assert.deepEqual(fitRows(380, 7), { shown: 5, more: 2 }, 'six rows plus a more line need 398px');
  assert.deepEqual(fitRows(0, 7, 5), { shown: 4, more: 3 }, 'unmeasured: the fallback count, one slot given to the more line');
  assert.deepEqual(fitRows(0, 4, 5), { shown: 4, more: 0 });
  assert.deepEqual(fitRows(40, 2), { shown: 0, more: 2 }, 'too little room shows only the more line');
  assert.deepEqual(fitRows(900, 0), { shown: 0, more: 0 });
});

test('labels and settings pages cover every control the config layer allows', () => {
  const { LABELS, PAGES } = load().helpers;
  assert.deepEqual(Object.keys(LABELS), ['wifi', 'bluetooth', 'sound', 'mic', 'dark', 'night']);
  assert.deepEqual({ ...PAGES }, { wifi: 'wifi', bluetooth: 'bluetooth', sound: 'sound', mic: 'sound', dark: 'personalize', night: 'nightlight' });
});
