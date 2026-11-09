'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { createScreenTime, dayKey } = require('../lib/screen-time.cjs');

function rig(start = new Date(2026, 10, 9, 9, 0, 0).getTime(), directory = fs.mkdtempSync(path.join(os.tmpdir(), 'screen-time-'))) {
  const clock = { time: start };
  const spawned = [];
  const spawnImpl = () => {
    const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stdout.setEncoding = () => {};
    child.killed = false; child.kill = () => { child.killed = true; }; spawned.push(child); return child;
  };
  let changes = 0;
  const tracker = createScreenTime({ directory, now: () => clock.time, spawnImpl, onChange: () => { changes++; } });
  const feed = (message, advance = 5000) => { clock.time += advance; spawned.at(-1).stdout.emit('data', `${JSON.stringify(message)}\n`); };
  return { clock, tracker, spawned, feed, directory, changes: () => changes };
}
const active = (process, name) => ({ active: true, process, name });

test('samples add up per app, per hour and in total; idle samples add nothing', () => {
  const { tracker, feed, spawned, changes } = rig();
  tracker.start();
  feed(active('firefox', 'Firefox'), 0); feed(active('firefox', 'Firefox')); feed(active('code', 'Visual Studio Code'));
  feed({ active: false, process: 'code', name: 'Visual Studio Code' });
  const { today, running } = tracker.state();
  assert.equal(running, true);
  assert.equal(today.totalSeconds, 15); // 5 (first) + 5 + 5
  assert.deepEqual(today.apps, [{ name: 'firefox', label: 'Firefox', seconds: 10 }, { name: 'code', label: 'Visual Studio Code', seconds: 5 }]);
  assert.equal(today.hours[9], 15); assert.equal(today.hours.reduce((a, b) => a + b, 0), 15);
  assert.equal(today.hours.length, 24);
  assert.ok(changes() >= 4);
  assert.equal(spawned.length, 1);
  tracker.stop();
});

test('a split JSON line is joined, junk is ignored and Edge Deck itself is not counted', () => {
  const { tracker, spawned, feed } = rig();
  tracker.start();
  const out = spawned[0].stdout;
  out.emit('data', '{"active":true,"proc'); out.emit('data', 'ess":"spotify","name":"Spotify"}\nnot json\n');
  feed({ active: true, process: 'msedge', name: 'Microsoft Edge', self: true });
  feed({ active: true, process: 'msedge', name: 'Microsoft Edge' });
  const { today } = tracker.state();
  assert.deepEqual(today.apps.map(app => app.name), ['msedge', 'spotify']);
  assert.equal(today.totalSeconds, 10); // 5 each: the dashboard sample in between counts for nothing
  tracker.stop();
});

test('only the top 8 apps are listed and the order is by time', () => {
  const { tracker, feed } = rig();
  tracker.start();
  for (let i = 0; i < 10; i++) for (let n = 0; n <= i; n++) feed(active(`app${i}`, `App ${i}`));
  const { apps } = tracker.state().today;
  assert.equal(apps.length, 8);
  assert.equal(apps[0].name, 'app9'); assert.equal(apps[7].name, 'app2');
  tracker.stop();
});

test('pickups count activity that resumes after five minutes idle', () => {
  const { tracker, feed } = rig();
  tracker.start();
  feed(active('code', 'Code')); feed(active('code', 'Code'));
  feed(active('code', 'Code'), 4 * 60000);      // only 4 minutes: same session
  feed(active('code', 'Code'), 5 * 60000);      // 5 minutes: pickup
  feed(active('code', 'Code'), 20 * 60000);     // pickup
  assert.equal(tracker.state().today.pickups, 2);
  // A long gap between samples is credited at most 15 seconds.
  assert.equal(tracker.state().today.totalSeconds, 5 + 5 + 15 + 15 + 15);
  tracker.stop();
});

test('a new local day starts empty and the old day moves into the week', () => {
  const { tracker, feed, clock } = rig(new Date(2026, 10, 9, 23, 59, 50).getTime());
  tracker.start();
  feed(active('code', 'Code'), 0);
  clock.time = new Date(2026, 10, 10, 0, 0, 5).getTime();
  assert.equal(tracker.state().today.totalSeconds, 0);
  feed(active('code', 'Code'), 0);
  const state = tracker.state();
  assert.equal(state.today.date, '2026-11-10'); assert.equal(state.today.hours[0], 15); assert.equal(state.today.pickups, 0);
  assert.equal(state.week.length, 7);
  assert.deepEqual(state.week.slice(-2), [{ date: '2026-11-09', totalSeconds: 5 }, { date: '2026-11-10', totalSeconds: 15 }]);
  tracker.stop();
});

test('stop saves atomically and start loads it again; corrupt files are ignored', () => {
  const first = rig();
  first.tracker.start();
  first.feed(active('firefox', 'Firefox'), 0);
  first.tracker.stop();
  const file = path.join(first.directory, 'screen-time.json');
  assert.ok(fs.existsSync(file)); assert.equal(fs.existsSync(`${file}.tmp`), false);
  assert.equal(first.spawned[0].killed, true);
  assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /title/i);

  const second = rig(first.clock.time + 1000, first.directory);
  second.tracker.start();
  assert.equal(second.tracker.state().today.totalSeconds, 5);
  assert.equal(second.tracker.state().today.apps[0].label, 'Firefox');
  second.tracker.stop();

  fs.writeFileSync(file, '{ not json');
  const third = rig(first.clock.time, first.directory);
  third.tracker.start();
  assert.equal(third.tracker.state().today.totalSeconds, 0);
  assert.deepEqual(third.tracker.state().today.apps, []);
  third.feed(active('code', 'Code'), 0);
  third.tracker.stop();
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).days[dayKey(third.clock.time)].totalSeconds, 5);

  fs.writeFileSync(file, JSON.stringify({ days: { '2026-11-09': { totalSeconds: 'x', hours: 3, apps: { a: 5, b: { seconds: -1 } } }, bad: {} } }));
  const fourth = rig(first.clock.time, first.directory);
  fourth.tracker.start();
  assert.equal(fourth.tracker.state().today.totalSeconds, 0);
  fourth.tracker.stop();
});

test('only the last seven days are kept', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'screen-time-'));
  const day = (totalSeconds) => ({ totalSeconds, pickups: 1, hours: Array(24).fill(0), apps: { code: { label: 'Code', seconds: totalSeconds } } });
  fs.writeFileSync(path.join(directory, 'screen-time.json'), JSON.stringify({ days: {
    '2026-11-02': day(100), '2026-11-03': day(200), '2026-11-04': day(300), '2026-11-09': day(900), '2026-10-20': day(50),
  } }));
  const { tracker } = rig(new Date(2026, 10, 9, 12, 0, 0).getTime(), directory);
  tracker.start();
  assert.deepEqual(tracker.state().week.map(entry => entry.totalSeconds), [200, 300, 0, 0, 0, 0, 900]); // 11-02 is older than 7 days
  assert.equal(tracker.state().week[0].date, '2026-11-03');
  tracker.stop();
  const saved = JSON.parse(fs.readFileSync(path.join(directory, 'screen-time.json'), 'utf8'));
  assert.deepEqual(Object.keys(saved.days).sort(), ['2026-11-03', '2026-11-04', '2026-11-09']);
});

test('the helper is restarted after it exits while running, and not after stop', () => {
  const { tracker, spawned } = rig();
  tracker.start(); tracker.start();
  assert.equal(spawned.length, 1);
  tracker.stop(); tracker.stop();
  spawned[0].emit('exit', 0);
  assert.equal(tracker.state().running, false);
});
