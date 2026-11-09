'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// A tiny DOM: enough for the module to build its tree and for the tests to walk it.
function node(tag) {
  const element = {
    tag, children: [], attributes: {}, dataset: {}, style: {}, className: '', textContent: '',
    append(...nodes) { element.children.push(...nodes); },
    setAttribute(name, value) { element.attributes[name] = String(value); },
    getAttribute(name) { return element.attributes[name] ?? null; },
    addEventListener() {},
  };
  return element;
}
const fakeDocument = { createElement: tag => node(tag), createElementNS: (namespace, tag) => node(tag) };
function load() {
  const context = { document: fakeDocument };
  context.window = context; vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'widget-gauge.js'), 'utf8'), context);
  return context.EdgeWidgets.gauge;
}
// Values built inside the vm context have another realm's prototypes; strict deep equality needs plain copies.
const plain = value => JSON.parse(JSON.stringify(value));
const classes = element => (element.className || element.attributes.class || '').split(' ').filter(Boolean);
function all(element, predicate, found = []) {
  if (predicate(element)) found.push(element);
  for (const child of element.children) all(child, predicate, found);
  return found;
}
const byClass = (element, name) => all(element, item => classes(item).includes(name));
const one = (element, name) => { const found = byClass(element, name); assert.equal(found.length, 1, `one .${name}`); return found[0]; };

// The host helpers the widget borrows, as src/app.js defines them.
const gigabytes = bytes => `${(bytes / 1073741824).toFixed(bytes >= 10737418240 ? 0 : 1)} GB`;
function uptimeText(seconds) {
  const days = Math.floor(seconds / 86400), hours = Math.floor(seconds % 86400 / 3600), minutes = Math.floor(seconds % 3600 / 60);
  return days ? `${days}d ${hours}h` : hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}
function context(pc, item, { size = 'small', mode = 'widgets' } = {}) {
  const calls = [];
  const el = (tag, className, text) => { const element = node(tag); if (className) element.className = className; if (text !== undefined && text !== null) element.textContent = String(text); return element; };
  const button = (text, fn, options = {}) => { const element = el('button', options.className || 'button'); element.type = 'button'; if (text) element.textContent = text; if (options.label) element.setAttribute('aria-label', options.label); element.onClick = fn; return element; };
  const ctx = { card: { id: 'card-1', size }, item: { id: 'view-1', type: 'gauge', ...item }, size, mode, state: () => ({ pc }), config: () => ({}), el, button, gigabytes, uptimeText, toast() {},
    glide(key, element, property, value) { element.style[property] = value; calls.push(['glide', key, value]); }, editCard() { calls.push(['edit']); }, showSettings(tab) { calls.push(['settings', tab]); } };
  return { ctx, calls };
}
const samplePc = () => ({ running: true, uptime: 14340, cpu: { load: 23, name: '12th Gen Intel(R) Core(TM) i7-12700K', cores: 20, temperature: 61, temperatureSource: 'Edge Deck' }, cpuSensor: { driver: true, enabled: true, vendor: 'intel' },
  memory: { used: 21.4e9, total: 34.2e9 }, gpu: { name: 'RTX 3080 Ti', load: 27, temperature: 50, memoryUsed: 9147, memoryTotal: 12288, power: 144 },
  apps: [{ name: 'llama-server', title: 'llama-server', memory: 8.3e9, cpu: 0 }, { name: 'firefox', title: 'Firefox', memory: 2.87e9, cpu: 3.8 }, { name: 'claude', title: 'Claude', memory: 1.87e9, cpu: 1.4 }, { name: 'Spotify', title: 'Spotify', memory: 0.74e9, cpu: 0.1 }, { name: 'msedge', title: 'Microsoft Edge', memory: 0.59e9, cpu: 12.6, icon: 'data:image/png;base64,iVBORw0KGgo=' }] });
const nullPc = () => ({ running: true, uptime: null, cpu: { load: null, name: '', cores: null, temperature: null, temperatureSource: null }, memory: { used: null, total: null }, gpu: { name: null, load: null, temperature: null, memoryUsed: null, memoryTotal: null, power: null }, apps: [] });

test('every reading picks its label, percent, centre value, secondary fact, detail and facts from full data', () => {
  const { pick } = load().helpers;
  const pc = samplePc();
  const cpu = pick(pc, 'cpu');
  assert.deepEqual([cpu.label, cpu.percent, cpu.centre, cpu.extra, cpu.detail, cpu.hot, cpu.hint, cpu.starting], ['CPU', 23, '23%', '61°C', 'i7-12700K', false, false, false]);
  assert.deepEqual(plain(cpu.facts), [['Temperature', '61°C'], ['Cores', '20'], ['Uptime', '3h 59m']]);
  assert.equal(cpu.aria, 'CPU gauge, 23 percent, 61 degrees');
  const gpu = pick(pc, 'gpu');
  assert.deepEqual([gpu.label, gpu.percent, gpu.centre, gpu.extra, gpu.detail], ['GPU', 27, '27%', '144 W', 'RTX 3080 Ti']);
  assert.deepEqual(plain(gpu.facts), [['Temperature', '50°C'], ['Power', '144 W'], ['VRAM', '8.9 GB']]);
  assert.deepEqual(plain(gpu.grid), [['Temperature', '50°C'], ['Power', '144 W'], ['VRAM used', '8.9 GB'], ['VRAM total', '12 GB']]);
  assert.equal(gpu.aria, 'GPU gauge, 27 percent, 144 watts');
  const memory = pick(pc, 'memory');
  assert.equal(Math.round(memory.percent), 63);
  assert.deepEqual([memory.label, memory.centre, memory.extra, memory.detail], ['RAM', '63%', '20 GB', '20 GB of 32 GB']);
  assert.deepEqual(plain(memory.facts), [['Used', '20 GB'], ['Free', '12 GB']]);
  assert.equal(memory.aria, 'RAM gauge, 63 percent, 20 GB used');
  const vram = pick(pc, 'vram');
  assert.equal(Math.round(vram.percent), 74);
  assert.deepEqual([vram.label, vram.centre, vram.extra, vram.detail], ['VRAM', '74%', '8.9 GB', '8.9 of 12 GB']);
  assert.deepEqual(plain(vram.facts), [['Used', '8.9 GB'], ['Total', '12 GB']]);
  assert.deepEqual(plain(vram.grid), [['Load', '27%'], ['Temperature', '50°C'], ['Power', '144 W'], ['Free', '3.1 GB']]);
  const cpuTemp = pick(pc, 'cpu-temp');
  assert.deepEqual([cpuTemp.label, cpuTemp.percent, cpuTemp.centre, cpuTemp.extra, cpuTemp.detail, cpuTemp.tempIn], ['CPU temp', 61, '61°C', '23%', 'i7-12700K', 'centre']);
  assert.deepEqual(plain(cpuTemp.facts), [['Load', '23%'], ['Cores', '20'], ['Source', 'Edge Deck sensor']]);
  assert.deepEqual(plain(cpuTemp.grid), [['Load', '23%'], ['Cores', '20'], ['Uptime', '3h 59m'], ['Source', 'Edge Deck sensor']]);
  assert.equal(cpuTemp.aria, 'CPU temp gauge, 61 degrees, 23 percent load');
  const gpuTemp = pick(pc, 'gpu-temp');
  assert.deepEqual([gpuTemp.label, gpuTemp.percent, gpuTemp.centre, gpuTemp.extra, gpuTemp.detail], ['GPU temp', 50, '50°C', '27%', 'RTX 3080 Ti']);
  assert.deepEqual(plain(gpuTemp.facts), [['Load', '27%'], ['Power', '144 W'], ['VRAM', '8.9 GB']]);
  assert.equal(gpuTemp.aria, 'GPU temp gauge, 50 degrees, 27 percent load');
  assert.equal(pick(pc, 'disk').label, 'CPU', 'an unknown reading falls back to the CPU');
});

test('temperatures cap the ring at 100 and the host formatting helpers are used when given', () => {
  const { pick } = load().helpers;
  const pc = samplePc(); pc.cpu.temperature = 112; pc.cpu.load = 140;
  assert.equal(pick(pc, 'cpu-temp').percent, 100);
  assert.equal(pick(pc, 'cpu').percent, 100);
  const custom = pick(pc, 'memory', { gigabytes: bytes => `${Math.round(bytes / 1e9)} gig`, uptimeText: () => 'ages' });
  assert.equal(custom.detail, '21 gig of 34 gig');
  assert.deepEqual(plain(custom.grid[3]), ['Uptime', 'ages']);
});

test('no PC data yet is a calm starting state', () => {
  const { pick } = load().helpers;
  for (const metric of ['cpu', 'gpu', 'memory', 'vram', 'cpu-temp', 'gpu-temp']) {
    const info = pick(null, metric);
    assert.deepEqual(plain([info.percent, info.centre, info.extra, info.detail, info.facts, info.grid, info.hot, info.hint, info.starting, info.trend]), [null, '—', '', 'Starting', [], [], false, false, true, false], metric);
    assert.equal(info.aria, `${info.label} gauge, starting`);
  }
  assert.equal(pick(samplePc(), 'cpu').trend, true, 'with data the trend is drawn');
});

test('null fields show a dash everywhere and never NaN', () => {
  const { pick } = load().helpers;
  for (const metric of ['cpu', 'gpu', 'memory', 'vram', 'cpu-temp', 'gpu-temp']) {
    const info = pick(nullPc(), metric);
    const text = JSON.stringify(info);
    assert.doesNotMatch(text, /NaN|undefined|null GB|null%/, metric);
    assert.equal(info.percent, null, metric); assert.equal(info.centre, '—', metric); assert.equal(info.extra, '', metric); assert.equal(info.hot, false, metric);
    assert.ok(info.facts.every(([, value]) => value === '—'), metric);
    assert.ok(info.grid.every(([, value]) => value === '—'), metric);
    assert.match(info.aria, /not reported/, metric);
  }
  assert.equal(pick(nullPc(), 'cpu').detail, '—');
  assert.equal(pick(nullPc(), 'memory').detail, '—');
  const partial = samplePc(); partial.memory.used = null; partial.gpu.memoryTotal = null;
  assert.deepEqual([pick(partial, 'memory').percent, pick(partial, 'memory').detail, pick(partial, 'memory').extra], [null, '— of 32 GB', '']);
  assert.deepEqual([pick(partial, 'vram').percent, pick(partial, 'vram').detail, pick(partial, 'vram').extra], [null, '8.9 GB of —', '8.9 GB']);
});

test('without an NVIDIA GPU the GPU readings say so and list nothing', () => {
  const { pick } = load().helpers;
  const pc = samplePc(); pc.gpu = null;
  for (const metric of ['gpu', 'vram', 'gpu-temp']) {
    const info = pick(pc, metric);
    assert.deepEqual(plain([info.percent, info.centre, info.extra, info.detail, info.facts, info.grid, info.hot, info.trend]), [null, '—', '', 'No NVIDIA GPU', [], [], false, false], metric);
  }
  assert.equal(pick(pc, 'cpu').detail, 'i7-12700K', 'the CPU readings are unaffected');
  assert.equal(pick(pc, 'cpu').trend, true);
  const empty = samplePc(); empty.gpu = nullPc().gpu;
  assert.equal(pick(empty, 'gpu').trend, true, 'a GPU that reports nothing yet still gets its trend box');
});

test('nothing to sample means no trend box: Starting, and GPU readings without a GPU', () => {
  const gauge = load();
  const noGpu = samplePc(); noGpu.gpu = null;
  for (const size of ['medium', 'large', 'tall']) {
    const starting = node('div'); gauge.render(starting, context(null, { metric: 'memory' }, { size }).ctx);
    assert.ok(classes(one(starting, 'gauge-widget')).includes('no-trend'), `${size} starting`);
    assert.equal(byClass(starting, 'gauge-trend').length + byClass(starting, 'gauge-spark').length, 0, `${size} starting`);
    for (const metric of ['gpu', 'vram', 'gpu-temp']) {
      const body = node('div'); gauge.render(body, context(noGpu, { metric }, { size }).ctx);
      assert.ok(classes(one(body, 'gauge-widget')).includes('no-trend'), `${size} ${metric}`);
      assert.equal(byClass(body, 'gauge-trend').length, 0, `${size} ${metric}`);
      assert.equal(byClass(body, 'gauge-grid').length + byClass(body, 'gauge-apps').length, 0, `${size} ${metric}: no empty facts grid either`);
      assert.equal(one(body, 'gauge-detail').textContent, 'No NVIDIA GPU');
    }
    const cpu = node('div'); gauge.render(cpu, context(noGpu, { metric: 'cpu' }, { size }).ctx);
    assert.ok(!classes(one(cpu, 'gauge-widget')).includes('no-trend'), `${size} cpu keeps its trend without a GPU`);
    assert.equal(byClass(cpu, 'gauge-trend').length, 1);
  }
  const small = node('div'); gauge.render(small, context(noGpu, { metric: 'gpu' }, { size: 'small' }).ctx);
  assert.equal(byClass(small, 'gauge-trend').length, 0);
});

test('a hot chip warms its own readings from 85 C (CPU) and 83 C (GPU), and the mood follows', () => {
  const gauge = load(); const { pick } = gauge.helpers;
  const pc = samplePc(); pc.cpu.temperature = 85; pc.gpu.temperature = 82.9;
  assert.deepEqual(['cpu', 'cpu-temp', 'gpu', 'gpu-temp', 'memory', 'vram'].map(metric => pick(pc, metric).hot), [true, true, false, false, false, false]);
  pc.cpu.temperature = 84.9; pc.gpu.temperature = 83;
  assert.deepEqual(['cpu', 'cpu-temp', 'gpu', 'gpu-temp', 'memory', 'vram'].map(metric => pick(pc, metric).hot), [false, false, true, true, false, false]);
  assert.deepEqual(plain(gauge.mood({ item: { metric: 'gpu' }, state: () => ({ pc }) })), { mood: 'hot', attention: false });
  assert.deepEqual(plain(gauge.mood({ item: { metric: 'cpu' }, state: () => ({ pc }) })), { mood: '', attention: false });
  assert.deepEqual(plain(gauge.mood({ item: { metric: 'cpu' }, state: () => ({ pc: null }) })), { mood: '', attention: false });
});

test('the CPU temperature hint appears only when there is no reading to show', () => {
  const { pick } = load().helpers;
  const off = samplePc(); off.cpu.temperature = null; off.cpu.temperatureSource = null; off.cpuSensor.enabled = false;
  assert.equal(pick(off, 'cpu-temp').hint, true, 'sensor off, nothing else reporting');
  const noSensor = samplePc(); noSensor.cpu.temperature = null; noSensor.cpu.temperatureSource = null; delete noSensor.cpuSensor;
  assert.equal(pick(noSensor, 'cpu-temp').hint, true, 'no sensor state at all');
  const reading = samplePc(); reading.cpuSensor.enabled = false; reading.cpu.temperatureSource = 'HWiNFO';
  assert.equal(pick(reading, 'cpu-temp').hint, false, 'HWiNFO reports a temperature');
  assert.equal(pick(off, 'cpu').hint, false, 'only the temperature reading hints');
  assert.deepEqual(plain(pick(off, 'cpu-temp').facts), [['Load', '23%'], ['Cores', '20']], 'no source fact without a source');
  assert.deepEqual(plain(pick(reading, 'cpu-temp').facts[2]), ['Source', 'HWiNFO']);
});

test('CPU names are shortened the way the PC stats card does', () => {
  const { shortCpuName } = load().helpers;
  assert.equal(shortCpuName('12th Gen Intel(R) Core(TM) i7-12700K'), 'i7-12700K');
  assert.equal(shortCpuName('Intel(R) Core(TM) i9-9900K CPU @ 3.60GHz'), 'i9-9900K');
  assert.equal(shortCpuName('AMD Ryzen 9 5900X 12-Core Processor'), 'AMD Ryzen 9 5900X');
  assert.equal(shortCpuName(''), ''); assert.equal(shortCpuName(null), '');
});

test('samples merge within half a second, drop after ten minutes and never exceed 300', () => {
  const { record } = load().helpers;
  const store = new Map();
  const start = 1_000_000;
  record('cpu', 10, start, store); record('cpu', 12, start + 300, store);
  assert.deepEqual(plain(store.get('cpu')), [{ t: start, v: 12 }], 'two renders within 500 ms count once');
  record('cpu', 20, start + 2000, store);
  assert.equal(store.get('cpu').length, 2);
  record('cpu', null, start + 4000, store); record('cpu', NaN, start + 4000, store);
  assert.equal(store.get('cpu').length, 2, 'missing readings are not recorded');
  record('cpu', 30, start + 10 * 60000 + 1, store);
  assert.deepEqual(plain(store.get('cpu').map(sample => sample.v)), [20, 30], 'samples older than ten minutes are dropped');
  const busy = new Map();
  for (let i = 0; i < 400; i++) record('gpu', i, start + i * 1000, busy);
  assert.equal(busy.get('gpu').length, 300); assert.equal(busy.get('gpu')[0].v, 100);
  assert.equal(store.has('memory'), false); assert.deepEqual(plain(record('memory', null, start, store)), []);
});

test('the sparkline maps time to x and percent to y, and stays empty below two samples', () => {
  const { sparkline } = load().helpers;
  const now = 5_000_000, span = 120000;
  assert.deepEqual(plain(sparkline([], now, span)), { line: '', area: '', count: 0 });
  assert.deepEqual(plain(sparkline([{ t: now, v: 50 }], now, span)), { line: '', area: '', count: 1 });
  assert.deepEqual(sparkline(undefined, now, span).count, 0);
  const shape = sparkline([{ t: now - span, v: 0 }, { t: now - span / 2, v: 150 }, { t: now, v: 100 }, { t: now - span - 1, v: 99 }, { t: now + 1, v: 99 }, { t: now, v: null }], now, span, 100, 40);
  assert.equal(shape.count, 3, 'samples outside the span or without a value are left out');
  assert.equal(shape.line, '0.0,40.0 50.0,0.0 100.0,0.0', 'percent is clamped to 100');
  assert.equal(shape.area, 'M0.0,40 L0.0,40.0 L50.0,0.0 L100.0,0.0 L100.0,40 Z');
  assert.equal(sparkline([{ t: now - 60000, v: 25 }, { t: now, v: 75 }], now, span, 200, 80).line, '100.0,60.0 200.0,20.0');
});

test('the busiest apps are ranked by CPU or memory, with valid icons only and a visible bar', () => {
  const { busiestApps } = load().helpers;
  const apps = samplePc().apps;
  const byCpu = busiestApps(apps, 'cpu');
  assert.deepEqual(byCpu.map(app => [app.name, app.text]), [['Microsoft Edge', '13%'], ['Firefox', '3.8%'], ['Claude', '1.4%']]);
  assert.equal(byCpu[0].share, 100); assert.ok(byCpu[2].share > 3 && byCpu[2].share < 12);
  assert.equal(byCpu[0].icon, 'data:image/png;base64,iVBORw0KGgo='); assert.equal(byCpu[1].icon, null);
  const byMemory = busiestApps(apps, 'memory');
  assert.deepEqual(byMemory.map(app => [app.name, app.text]), [['llama-server', '7.7 GB'], ['Firefox', '2.7 GB'], ['Claude', '1.7 GB']]);
  assert.deepEqual(busiestApps([{ name: 'x', memory: 1e9, cpu: 0, icon: 'javascript:alert(1)' }, { name: 'y', memory: null, cpu: 0 }, null], 'memory').map(app => [app.name, app.icon, app.share]), [['x', null, 100]]);
  assert.deepEqual(plain(busiestApps(undefined, 'cpu')), []);
  assert.deepEqual(plain(busiestApps([{ title: '', name: '', cpu: 0 }], 'cpu')[0]), { name: 'App', icon: null, text: '0.0%', share: 3 });
});

test('Small renders the whole card as one button that opens the editor', () => {
  const gauge = load();
  const { ctx, calls } = context(samplePc(), { metric: 'cpu' }, { size: 'small' });
  const body = node('div'); gauge.render(body, ctx);
  const root = one(body, 'gauge-widget');
  assert.deepEqual([root.dataset.metric, root.dataset.view], ['cpu', 'small']);
  const buttons = all(root, item => item.tag === 'button');
  assert.equal(buttons.length, 1);
  assert.equal(buttons[0].getAttribute('aria-label'), 'CPU gauge, 23 percent, 61 degrees');
  buttons[0].onClick(); assert.deepEqual(calls.at(-1), ['edit']);
  assert.equal(one(root, 'gauge-value').textContent, '23%'); assert.equal(one(root, 'gauge-extra').textContent, '61°C');
  assert.equal(one(root, 'gauge-title').textContent, 'CPU'); assert.equal(one(root, 'gauge-detail').textContent, 'i7-12700K');
  assert.equal(byClass(root, 'gauge-trend').length, 0); assert.equal(byClass(root, 'gauge-facts').length, 0);
  assert.ok(byClass(one(root, 'gauge-main'), 'gauge-title').length, 'the label sits inside the button');
  assert.equal(one(root, 'gauge-dial').getAttribute('aria-hidden'), 'true');
  const glide = calls.find(call => call[0] === 'glide');
  assert.equal(glide[1], 'gauge:card-1:view-1'); assert.equal(glide[2], `${(0.23 * 2 * Math.PI * 42).toFixed(2)} ${(2 * Math.PI * 42).toFixed(2)}`);
  assert.ok(!classes(one(root, 'gauge-ring-fill')).includes('is-empty'));
});

test('Medium, Large and Tall add the facts, the trend and, on Large, the apps or a facts grid', () => {
  const gauge = load();
  const medium = node('div'); gauge.render(medium, context(samplePc(), { metric: 'gpu' }, { size: 'medium' }).ctx);
  assert.equal(byClass(medium, 'gauge-fact').length, 3);
  assert.equal(one(medium, 'gauge-trend-caption').textContent, 'last 2 min');
  assert.equal(one(medium, 'gauge-spark').getAttribute('aria-label'), 'GPU over the last 2 minutes');
  assert.equal(one(medium, 'gauge-spark').getAttribute('role'), 'img');
  assert.equal(byClass(medium, 'gauge-spark-line').length, 0, 'one sample draws only the baseline');
  assert.equal(byClass(medium, 'gauge-spark-base').length, 1);
  assert.equal(byClass(medium, 'gauge-apps').length + byClass(medium, 'gauge-grid').length, 0);
  assert.equal(one(medium, 'gauge-main').children.length, 1, 'the ring alone is the button');
  gauge.helpers.samples.set('cpu', [{ t: Date.now() - 90000, v: 20 }, { t: Date.now() - 45000, v: 40 }]); // earlier renders
  const largeCpu = node('div'); gauge.render(largeCpu, context(samplePc(), { metric: 'cpu' }, { size: 'large' }).ctx);
  assert.equal(one(largeCpu, 'gauge-trend-caption').textContent, 'last 5 min');
  assert.equal(gauge.helpers.samples.get('cpu').length, 3, 'the render records its sample');
  assert.equal(byClass(largeCpu, 'gauge-spark-line').length, 1, 'with earlier samples the line is drawn');
  assert.equal(byClass(largeCpu, 'gauge-spark-area').length, 1);
  const apps = one(largeCpu, 'gauge-apps');
  assert.equal(apps.getAttribute('aria-label'), 'Busiest apps by CPU');
  assert.deepEqual(byClass(apps, 'gauge-app-name').map(item => item.textContent), ['Microsoft Edge', 'Firefox', 'Claude']);
  assert.equal(all(apps, item => item.tag === 'img').length, 1); assert.equal(byClass(apps, 'gauge-app-blank').length, 2);
  assert.equal(byClass(apps, 'gauge-app-bar')[0].children[0].style.width, '100.0%');
  const largeGpu = node('div'); gauge.render(largeGpu, context(samplePc(), { metric: 'gpu-temp' }, { size: 'large' }).ctx);
  assert.equal(byClass(largeGpu, 'gauge-apps').length, 0); assert.equal(byClass(largeGpu, 'gauge-tile').length, 4);
  const noApps = samplePc(); noApps.apps = [];
  const largeMemory = node('div'); gauge.render(largeMemory, context(noApps, { metric: 'memory' }, { size: 'large' }).ctx);
  assert.equal(byClass(largeMemory, 'gauge-apps').length, 0); assert.equal(byClass(largeMemory, 'gauge-tile').length, 4, 'facts stand in when no apps are reported');
  const tall = node('div'); gauge.render(tall, context(samplePc(), { metric: 'vram' }, { size: 'tall' }).ctx);
  assert.deepEqual(byClass(tall, 'gauge-fact-value').map(item => item.textContent), ['8.9 GB', '12 GB']);
  assert.equal(byClass(tall, 'gauge-trend').length, 1);
});

test('other layout modes use the Medium layout, and the starting state keeps the ring empty', () => {
  const gauge = load();
  const overview = node('div'); gauge.render(overview, context(samplePc(), { metric: 'memory' }, { size: 'small', mode: 'overview' }).ctx);
  assert.equal(one(overview, 'gauge-widget').dataset.view, 'medium');
  assert.equal(byClass(overview, 'gauge-trend').length, 1); assert.equal(byClass(overview, 'gauge-apps').length, 0);
  const starting = node('div'); gauge.render(starting, context(null, { metric: 'cpu' }, { size: 'large' }).ctx);
  assert.ok(classes(one(starting, 'gauge-widget')).includes('is-starting'));
  assert.ok(classes(one(starting, 'gauge-ring-fill')).includes('is-empty'));
  assert.equal(one(starting, 'gauge-value').textContent, '—'); assert.equal(byClass(starting, 'gauge-extra').length, 0);
  assert.equal(byClass(starting, 'gauge-apps').length + byClass(starting, 'gauge-grid').length + byClass(starting, 'gauge-facts').length + byClass(starting, 'gauge-trend').length, 0);
  assert.equal(one(starting, 'gauge-main').getAttribute('aria-label'), 'CPU gauge, starting');
  const zero = samplePc(); zero.cpu.load = 0;
  const idle = node('div'); gauge.render(idle, context(zero, { metric: 'cpu' }).ctx);
  assert.ok(classes(one(idle, 'gauge-ring-fill')).includes('is-empty'), 'no round-cap dot at 0%');
});

test('the CPU temperature hint is a real button beside the gauge that opens the display settings', () => {
  const gauge = load();
  const pc = samplePc(); pc.cpu.temperature = null; pc.cpu.temperatureSource = null; pc.cpuSensor.enabled = false;
  const small = node('div'); const { ctx, calls } = context(pc, { metric: 'cpu-temp' }, { size: 'small' }); gauge.render(small, ctx);
  const root = one(small, 'gauge-widget');
  assert.ok(classes(root).includes('has-hint'));
  const hint = one(root, 'gauge-hint');
  assert.equal(hint.tag, 'button'); assert.equal(hint.textContent, 'Turn on in PC stats');
  assert.equal(byClass(one(root, 'gauge-main'), 'gauge-hint').length, 0, 'never nested inside the main button');
  hint.onClick(); assert.deepEqual(calls.at(-1), ['settings', 'display']);
  assert.equal(one(root, 'gauge-value').textContent, '—'); assert.equal(one(root, 'gauge-extra').textContent, '23%');
  const medium = node('div'); gauge.render(medium, context(pc, { metric: 'cpu-temp' }, { size: 'medium' }).ctx);
  assert.equal(byClass(one(medium, 'gauge-copy'), 'gauge-hint').length, 1, 'the hint sits with the facts on bigger cards');
  const fine = node('div'); gauge.render(fine, context(samplePc(), { metric: 'cpu-temp' }, { size: 'small' }).ctx);
  assert.equal(byClass(fine, 'gauge-hint').length, 0);
});

test('the hot state marks the widget and the temperature text, and the signature follows the reading and the PC', () => {
  const gauge = load();
  const pc = samplePc(); pc.cpu.temperature = 90;
  const cpu = node('div'); gauge.render(cpu, context(pc, { metric: 'cpu' }, { size: 'small' }).ctx);
  assert.ok(classes(one(cpu, 'gauge-widget')).includes('is-hot'));
  assert.ok(classes(one(cpu, 'gauge-extra')).includes('gauge-temp')); assert.ok(!classes(one(cpu, 'gauge-value')).includes('gauge-temp'));
  const temp = node('div'); gauge.render(temp, context(pc, { metric: 'cpu-temp' }, { size: 'small' }).ctx);
  assert.ok(classes(one(temp, 'gauge-value')).includes('gauge-temp')); assert.ok(!classes(one(temp, 'gauge-extra')).includes('gauge-temp'));
  const signature = gauge.signature({ item: { metric: 'vram' }, state: () => ({ pc }) });
  assert.equal(signature.length, 2); assert.equal(signature[0], 'vram'); assert.equal(signature[1], pc);
  assert.equal(typeof gauge.live, 'undefined', 'the host empties the body before each render');
});
