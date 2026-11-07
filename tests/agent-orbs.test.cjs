'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Loads the vendored engine and the orb module in a minimal browser-like context.
function load() {
  const context = { matchMedia: () => ({ matches: false, addEventListener() {} }), document: { addEventListener() {} },
    requestAnimationFrame: () => 1, performance: { now: () => 1000 }, devicePixelRatio: 1 };
  context.window = context; vm.createContext(context);
  for (const file of ['vendor/thinking-orbs.js', 'agent-orbs.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', file), 'utf8'), context);
  return context;
}

test('agent activity maps to a thinking-orb state the engine provides', () => {
  const { EdgeAgentOrbs: orbs, ThinkingOrbsEngine: engine } = load();
  const cases = { 'Thinking': 'working', 'Planning': 'working', 'Running commands': 'solving', 'Editing files': 'composing', 'Updating files': 'composing',
    'Creating files': 'shaping', 'Reading the project': 'listening', 'Searching the web': 'searching', 'Browsing the web': 'searching',
    'Coordinating agents': 'weaving', 'Coordinating tasks': 'weaving', 'Running in the background': 'weaving', 'Using an app integration': 'connecting', 'Waiting for your reply': 'breathing', 'Waiting for your approval': 'breathing',
    'Working on your request': 'working', 'In progress': 'working', '': 'working' };
  for (const [activity, state] of Object.entries(cases)) {
    assert.equal(orbs.stateFor(activity), state, activity);
    assert.ok(engine.STATE_TO_MODE[state], `engine has ${state}`);
  }
});

test('every orb state renders dots at the dashboard size', () => {
  const { ThinkingOrbsEngine: engine } = load();
  for (const state of Object.keys(engine.STATE_TO_MODE)) {
    const preset = engine.resolvePreset(state, 64);
    const frame = engine.MODE_FRAMES[preset.mode](64, 2, preset.opts);
    assert.ok(frame.dots.length > 10, state);
    assert.ok(frame.dots.every(dot => Number.isFinite(dot.x) && Number.isFinite(dot.y) && dot.r > 0), state);
  }
});

// A fake engine and DOM, with animation frames and timers run by hand.
function loadWithFakes() {
  const frames = [], timers = [], paints = new Map();
  const engine = { MODE_FRAMES: { m: () => ({}) }, resolvePreset: () => ({ mode: 'm', speed: 1, opts: {} }),
    paintFrame(ctx) { if (ctx.broken) throw new Error('Canvas lost'); paints.set(ctx.name, (paints.get(ctx.name) || 0) + 1); } };
  let count = 0;
  const document = { hidden: false, addEventListener() {}, createElement() {
    const ctx = { name: `orb${++count}`, setTransform() {}, clearRect() {} };
    return { dataset: {}, style: {}, setAttribute() {}, isConnected: true, offsetParent: {}, getContext: () => ctx, ctx };
  } };
  const context = { matchMedia: () => ({ matches: false, addEventListener() {} }), document, devicePixelRatio: 1, ThinkingOrbsEngine: engine,
    requestAnimationFrame: callback => frames.push(callback), setTimeout: callback => timers.push(callback), performance: { now: () => 1000 } };
  context.window = context; vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'agent-orbs.js'), 'utf8'), context);
  let clock = 2000;
  const step = () => { frames.shift()?.((clock += 33)); timers.shift()?.(); };
  return { orbs: context.EdgeAgentOrbs, paints, step };
}

test('one orb that fails to draw never stops the others, and low power slows orbs instead of freezing them', () => {
  const { orbs, paints, step } = loadWithFakes();
  const broken = orbs.create({ activity: 'Thinking' }); orbs.create({ activity: 'Running commands' });
  broken.ctx.broken = true;
  for (let i = 0; i < 5; i++) step();
  assert.equal(paints.get('orb2'), 6, 'The healthy orb drew at creation and on every frame');
  orbs.setLowPower(true);
  for (let i = 0; i < 3; i++) step();
  assert.equal(paints.get('orb2'), 9, 'Low power keeps orbs moving (more slowly)');
});
