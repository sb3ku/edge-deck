'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createNotifier } = require('../lib/notifier.cjs');
const { createToastLines } = require('../lib/toast.cjs');

const NOW = Date.parse('2026-11-08T12:00:00Z');
const printer = (status, extra = {}) => ({ id: 'h2d', name: 'Bambu Lab H2D', model: 'H2D', accountName: 'Big fella', status, jobName: 'Benchy', jobStartedAt: '2026-11-08T09:46:00Z', ...extra });
const view = ({ printers = [], approvals = [], tasks = { items: [] }, presence = 'normal' } = {}) => ({ printers, approvals, tasks, system: { presence } });
const watch = settings => { const sent = []; return { sent, notifier: createNotifier({ send: note => sent.push(note), now: () => NOW, settings }) }; };

test('a print that finishes or fails while watched is reported; the state at start-up is not', () => {
  const { sent, notifier } = watch();
  notifier.update(view({ printers: [printer('finished')] }));
  assert.equal(sent.length, 0, 'nothing on start-up');
  notifier.update(view({ printers: [printer('printing')] }));
  notifier.update(view({ printers: [printer('finished')] }));
  assert.deepEqual(sent, [{ kind: 'info', title: 'Big fella finished', body: 'Benchy is ready after 2 h 14 min.', attribution: 'Bambu Lab H2D', printerId: 'h2d', model: 'H2D' }]);
  notifier.update(view({ printers: [printer('printing')] }));
  notifier.update(view({ printers: [printer('error')] }));
  assert.equal(sent[1].kind, 'warning'); assert.equal(sent[1].title, 'Big fella failed'); assert.equal(sent[1].body, 'Benchy stopped with an error. Check the printer.');
  notifier.update(view({ printers: [printer('idle')] }));
  assert.equal(sent.length, 2, 'finished -> idle says nothing');
});

test('a new approval request is reported once, without its command', () => {
  const { sent, notifier } = watch();
  notifier.update(view());
  const request = { id: 'a1', agent: 'Claude Code', action: 'run a command', detail: 'secret-command --token x', project: 'edge-deck' };
  notifier.update(view({ approvals: [request] }));
  notifier.update(view({ approvals: [request] }));
  assert.equal(sent.length, 1); assert.equal(sent[0].title, 'Claude Code needs your approval'); assert.equal(sent[0].body, 'run a command in edge-deck');
  notifier.update(view({ tasks: { items: [{ id: 'c1', agent: 'Codex', title: 'Fix tests', approval: { action: 'make a change', detail: 'rm x' } }] } }));
  assert.equal(sent[1].title, 'Codex needs your approval'); assert.equal(sent[1].body, 'make a change in Fix tests');
  assert.ok(!JSON.stringify(sent).includes('secret'));
});

test('while a game is full screen, notifications wait; answered approvals are dropped', () => {
  const { sent, notifier } = watch();
  notifier.update(view({ printers: [printer('printing')], presence: 'fullscreen' }));
  notifier.update(view({ printers: [printer('finished')], presence: 'fullscreen' }));
  notifier.update(view({ printers: [printer('finished')], approvals: [{ id: 'a1', action: 'run a command' }], presence: 'fullscreen' }));
  notifier.update(view({ printers: [printer('finished')], presence: 'fullscreen' }));
  assert.equal(sent.length, 0); assert.equal(notifier.waiting(), 1);
  notifier.update(view({ printers: [printer('finished')] }));
  assert.equal(sent.length, 1); assert.equal(sent[0].title, 'Big fella finished');
});

test('many waiting notifications become one summary, and settings can turn kinds off', () => {
  let settings = { printers: true, agents: false };
  const { sent, notifier } = watch(() => settings);
  const many = ids => ids.map(id => printer('printing', { id, accountName: id }));
  notifier.update(view({ printers: many(['a', 'b', 'c', 'd']), presence: 'fullscreen' }));
  notifier.update(view({ printers: many(['a', 'b', 'c', 'd']).map(p => ({ ...p, status: 'finished' })), approvals: [{ id: 'x' }], presence: 'fullscreen' }));
  notifier.update(view({ printers: many(['a', 'b', 'c', 'd']).map(p => ({ ...p, status: 'finished' })), approvals: [{ id: 'x' }] }));
  assert.equal(sent.length, 1); assert.equal(sent[0].title, '4 things happened while you were away'); assert.match(sent[0].body, /^a finished · b finished/);
  settings = { printers: false, agents: true };
  notifier.update(view({ printers: many(['a']) })); notifier.update(view({ printers: many(['a']).map(p => ({ ...p, status: 'error' })) }));
  assert.equal(sent.length, 1);
});

test('a toast line carries the model picture as a file and the printer photo', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-deck-toast-')); t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const assets = path.join(directory, 'assets'); fs.mkdirSync(path.join(assets, 'printers'), { recursive: true }); fs.writeFileSync(path.join(assets, 'printers', 'h2d-photo.png'), 'png');
  const line = createToastLines({ directory, assets, picture: () => ({ type: 'image/png', data: Buffer.from('model') }) });
  const decode = text => JSON.parse(Buffer.from(text.replace(/^toast /, ''), 'base64').toString('utf8'));
  const toast = decode(line({ kind: 'info', title: 'Big fella finished', body: 'Bénchy is ready.', printerId: 'h2d', model: 'H2D', attribution: 'Bambu Lab H2D' }));
  assert.equal(toast.body, 'Bénchy is ready.'); assert.equal(fs.readFileSync(toast.image, 'utf8'), 'model'); assert.equal(toast.logo, path.join(assets, 'printers', 'h2d-photo.png'));
  const plain = decode(line({ kind: 'warning', title: 'Claude Code needs your approval', body: 'run a command' }));
  assert.deepEqual(plain, { kind: 'warning', title: 'Claude Code needs your approval', body: 'run a command' });
  assert.match(line({ title: 'x', body: 'y' }), /^toast [A-Za-z0-9+/=]+$/);
});
