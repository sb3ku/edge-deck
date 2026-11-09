(() => {
  'use strict';
  // Gauge widget: one PC reading (CPU, GPU, memory, video memory or a temperature)
  // as a ring. Bigger cards add the facts around it, the last minutes as a
  // sparkline and, for CPU and RAM, the busiest apps. Tapping the ring opens the
  // card editor, where the reading can be changed.
  const LABELS = { cpu: 'CPU', gpu: 'GPU', memory: 'RAM', vram: 'VRAM', 'cpu-temp': 'CPU temp', 'gpu-temp': 'GPU temp' };
  const HOT_CPU = 85, HOT_GPU = 83;
  const SOURCES = { 'Edge Deck': 'Edge Deck sensor' };
  const SPAN_MS = 2 * 60000, LARGE_SPAN_MS = 5 * 60000;
  const SAMPLE_LIMIT = 300, SAMPLE_KEEP_MS = 10 * 60000, SAMPLE_MERGE_MS = 500;
  const SPARK_WIDTH = 100, SPARK_HEIGHT = 40;
  const RADIUS = 42, CIRCUMFERENCE = 2 * Math.PI * RADIUS;
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const PNG_DATA_URL = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/;
  const samples = new Map(); // metric -> [{ t, v }]; gauges showing the same reading share one buffer

  const finite = value => Number.isFinite(value);
  const gigabytes = bytes => `${(bytes / 1073741824).toFixed(bytes >= 10737418240 ? 0 : 1)} GB`;
  function uptimeText(seconds) {
    const days = Math.floor(seconds / 86400), hours = Math.floor(seconds % 86400 / 3600), minutes = Math.floor(seconds % 3600 / 60);
    return days ? `${days}d ${hours}h` : hours ? `${hours}h ${minutes}m` : `${minutes}m`;
  }
  const FORMAT = { gigabytes, uptimeText };
  const percentText = value => finite(value) ? `${Math.round(value)}%` : '—';
  const degreesText = value => finite(value) ? `${Math.round(value)}°C` : '—';
  const wattsText = value => finite(value) ? `${Math.round(value)} W` : '—';
  const megabytesText = (mb, whole) => finite(mb) ? `${whole ? Math.round(mb / 1024) : (mb / 1024).toFixed(1)} GB` : '—';
  const appCpuText = cpu => finite(cpu) ? `${cpu >= 10 ? Math.round(cpu) : cpu.toFixed(1)}%` : '—';
  const spokenPercent = value => finite(value) ? `${Math.round(value)} percent` : 'not reported';
  const spokenDegrees = value => finite(value) ? `${Math.round(value)} degrees` : 'not reported';
  const clampPercent = value => finite(value) ? Math.max(0, Math.min(100, value)) : null;
  const ratio = (used, total) => finite(used) && finite(total) && total > 0 ? clampPercent(used / total * 100) : null;
  const ofText = (used, total) => used === '—' && total === '—' ? '—' : `${used} of ${total}`;

  // "12th Gen Intel(R) Core(TM) i7-12700K" -> "i7-12700K"; "AMD Ryzen 9 5900X 12-Core Processor" -> "AMD Ryzen 9 5900X".
  function shortCpuName(name) {
    return String(name || '').replace(/^(\d+th Gen )?Intel\(R\) Core\(TM\) /, '').replace(/ CPU.*$/, '').replace(/ \d+-Core Processor$/, '').replace(/\((R|TM)\)/g, '').replace(/\s+/g, ' ').trim();
  }

  // Everything one reading shows: the ring's percent, the value in the centre,
  // the smaller fact under it, the detail line, the facts row, the four facts of
  // the large card's grid, whether it runs hot, whether a trend can ever be
  // drawn (not before the PC reports, nor for a GPU reading without a GPU), and
  // the spoken label.
  function pick(pc, metric, format = FORMAT) {
    const key = LABELS[metric] ? metric : 'cpu', label = LABELS[key];
    const info = { metric: key, label, percent: null, centre: '—', extra: '', tempIn: '', detail: '', facts: [], grid: [], hot: false, hint: false, starting: !pc, trend: !!pc, aria: `${label} gauge, starting` };
    if (!pc) { info.detail = 'Starting'; return info; }
    const cpu = pc.cpu || {}, gpu = pc.gpu || null, memory = pc.memory || {};
    const temp = finite(cpu.temperature) ? cpu.temperature : null;
    const gpuTemp = gpu && finite(gpu.temperature) ? gpu.temperature : null;
    const gpuLoad = gpu ? gpu.load : null, gpuPower = gpu ? gpu.power : null;
    const cpuName = shortCpuName(cpu.name) || '—', gpuName = gpu ? (gpu.name || '—') : 'No NVIDIA GPU';
    const cores = finite(cpu.cores) ? String(cpu.cores) : '—', uptime = finite(pc.uptime) ? format.uptimeText(pc.uptime) : '—';
    const source = typeof cpu.temperatureSource === 'string' && cpu.temperatureSource ? (SOURCES[cpu.temperatureSource] || cpu.temperatureSource) : '';
    const used = finite(memory.used) ? format.gigabytes(memory.used) : '—', total = finite(memory.total) ? format.gigabytes(memory.total) : '—';
    const free = finite(memory.used) && finite(memory.total) ? format.gigabytes(Math.max(0, memory.total - memory.used)) : '—';
    const vramUsed = megabytesText(gpu?.memoryUsed), vramTotal = megabytesText(gpu?.memoryTotal, true);
    const vramKnown = !!gpu && finite(gpu.memoryUsed) && finite(gpu.memoryTotal);
    const vramFree = vramKnown ? megabytesText(Math.max(0, gpu.memoryTotal - gpu.memoryUsed)) : '—';
    const vramDetail = vramKnown ? `${(gpu.memoryUsed / 1024).toFixed(1)} of ${Math.round(gpu.memoryTotal / 1024)} GB` : ofText(vramUsed, vramTotal);
    let spoken;
    if (key === 'cpu') {
      info.percent = clampPercent(cpu.load); info.centre = percentText(cpu.load); info.extra = temp === null ? '' : degreesText(temp); info.tempIn = 'extra';
      info.detail = cpuName; info.hot = temp !== null && temp >= HOT_CPU;
      info.facts = [['Temperature', degreesText(temp)], ['Cores', cores], ['Uptime', uptime]];
      info.grid = [...info.facts, ['Sensor', source || '—']];
      spoken = [spokenPercent(cpu.load), temp === null ? '' : spokenDegrees(temp)];
    } else if (key === 'gpu') {
      info.percent = clampPercent(gpuLoad); info.centre = percentText(gpuLoad); info.extra = finite(gpuPower) ? wattsText(gpuPower) : '';
      info.detail = gpuName; info.hot = gpuTemp !== null && gpuTemp >= HOT_GPU;
      info.facts = [['Temperature', degreesText(gpuTemp)], ['Power', wattsText(gpuPower)], ['VRAM', vramUsed]];
      info.grid = [['Temperature', degreesText(gpuTemp)], ['Power', wattsText(gpuPower)], ['VRAM used', vramUsed], ['VRAM total', vramTotal]];
      spoken = [spokenPercent(gpuLoad), finite(gpuPower) ? `${Math.round(gpuPower)} watts` : ''];
    } else if (key === 'memory') {
      info.percent = ratio(memory.used, memory.total); info.centre = percentText(info.percent); info.extra = used === '—' ? '' : used;
      info.detail = ofText(used, total);
      info.facts = [['Used', used], ['Free', free]];
      info.grid = [['Used', used], ['Free', free], ['Total', total], ['Uptime', uptime]];
      spoken = [spokenPercent(info.percent), used === '—' ? '' : `${used} used`];
    } else if (key === 'vram') {
      info.percent = ratio(gpu?.memoryUsed, gpu?.memoryTotal); info.centre = percentText(info.percent); info.extra = vramUsed === '—' ? '' : vramUsed;
      info.detail = gpu ? vramDetail : gpuName;
      info.facts = [['Used', vramUsed], ['Total', vramTotal]];
      info.grid = [['Load', percentText(gpuLoad)], ['Temperature', degreesText(gpuTemp)], ['Power', wattsText(gpuPower)], ['Free', vramFree]];
      spoken = [spokenPercent(info.percent), vramUsed === '—' ? '' : `${vramUsed} used`];
    } else if (key === 'cpu-temp') {
      info.percent = clampPercent(temp); info.centre = degreesText(temp); info.extra = finite(cpu.load) ? percentText(cpu.load) : ''; info.tempIn = 'centre';
      info.detail = cpuName; info.hot = temp !== null && temp >= HOT_CPU;
      // No reading: Edge Deck's own sensor is off (or nothing else reports one); PC stats settings turn it on.
      info.hint = temp === null && (pc.cpuSensor?.enabled === false || cpu.temperatureSource == null);
      info.facts = [['Load', percentText(cpu.load)], ['Cores', cores], ...(source ? [['Source', source]] : [])];
      info.grid = [['Load', percentText(cpu.load)], ['Cores', cores], ['Uptime', uptime], ['Source', source || '—']];
      spoken = [spokenDegrees(temp), finite(cpu.load) ? `${spokenPercent(cpu.load)} load` : ''];
    } else {
      info.percent = clampPercent(gpuTemp); info.centre = degreesText(gpuTemp); info.extra = finite(gpuLoad) ? percentText(gpuLoad) : ''; info.tempIn = 'centre';
      info.detail = gpuName; info.hot = gpuTemp !== null && gpuTemp >= HOT_GPU;
      info.facts = [['Load', percentText(gpuLoad)], ['Power', wattsText(gpuPower)], ['VRAM', vramUsed]];
      info.grid = [['Load', percentText(gpuLoad)], ['Power', wattsText(gpuPower)], ['VRAM used', vramUsed], ['VRAM total', vramTotal]];
      spoken = [spokenDegrees(gpuTemp), finite(gpuLoad) ? `${spokenPercent(gpuLoad)} load` : ''];
    }
    if (!gpu && ['gpu', 'vram', 'gpu-temp'].includes(key)) { info.facts = []; info.grid = []; info.trend = false; } // nothing to list or sample without a GPU
    info.aria = [`${label} gauge`, ...spoken].filter(Boolean).join(', ');
    return info;
  }

  // One sample per render into the reading's buffer: at most 300, nothing older
  // than ten minutes, and two renders within half a second count as one.
  function record(metric, value, now = Date.now(), store = samples) {
    if (!finite(value)) return store.get(metric) || [];
    const list = store.get(metric) || [];
    const last = list[list.length - 1];
    if (last && now - last.t < SAMPLE_MERGE_MS) last.v = value; else list.push({ t: now, v: value });
    const keepFrom = now - SAMPLE_KEEP_MS;
    while (list.length && list[0].t < keepFrom) list.shift();
    if (list.length > SAMPLE_LIMIT) list.splice(0, list.length - SAMPLE_LIMIT);
    store.set(metric, list);
    return list;
  }

  // The samples of the last `span` ms as polyline points in a width x height box
  // (the newest at the right edge) and the area under them; empty below two samples.
  function sparkline(list, now, span, width = SPARK_WIDTH, height = SPARK_HEIGHT) {
    const from = now - span;
    const points = (Array.isArray(list) ? list : []).filter(sample => sample && finite(sample.v) && sample.t >= from && sample.t <= now)
      .map(sample => [((sample.t - from) / span * width).toFixed(1), (height - clampPercent(sample.v) / 100 * height).toFixed(1)]);
    if (points.length < 2) return { line: '', area: '', count: points.length };
    const line = points.map(point => point.join(',')).join(' ');
    const area = [`M${points[0][0]},${height}`, ...points.map(point => `L${point.join(',')}`), `L${points[points.length - 1][0]},${height}`, 'Z'].join(' ');
    return { line, area, count: points.length };
  }

  // The three apps using the most of this reading: CPU time for the CPU gauge, memory for RAM.
  function busiestApps(apps, metric, format = FORMAT) {
    const key = metric === 'cpu' ? 'cpu' : 'memory';
    const rows = (Array.isArray(apps) ? apps : []).filter(app => app && finite(app[key])).sort((a, b) => b[key] - a[key]).slice(0, 3);
    const most = Math.max(1, ...rows.map(app => app[key]));
    return rows.map(app => ({
      name: String(app.title || app.name || 'App'), icon: typeof app.icon === 'string' && PNG_DATA_URL.test(app.icon) ? app.icon : null,
      text: key === 'cpu' ? appCpuText(app.cpu) : format.gigabytes(app.memory), share: Math.max(3, app[key] / most * 100),
    }));
  }

  function svgNode(tag, attributes) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
    return node;
  }
  function dialFor(info, ctx) {
    const dial = ctx.el('div', 'gauge-dial'); dial.setAttribute('aria-hidden', 'true');
    const svg = svgNode('svg', { viewBox: '0 0 100 100', 'aria-hidden': 'true' });
    const track = svgNode('circle', { class: 'gauge-ring-track', cx: 50, cy: 50, r: RADIUS });
    const fill = svgNode('circle', { class: `gauge-ring-fill${info.percent > 0 ? '' : ' is-empty'}`, cx: 50, cy: 50, r: RADIUS });
    ctx.glide(`gauge:${ctx.card.id}:${ctx.item.id || ''}`, fill, 'strokeDasharray', `${((info.percent ?? 0) / 100 * CIRCUMFERENCE).toFixed(2)} ${CIRCUMFERENCE.toFixed(2)}`);
    svg.append(track, fill);
    const centre = ctx.el('div', 'gauge-centre');
    centre.append(ctx.el('strong', `gauge-value${info.tempIn === 'centre' ? ' gauge-temp' : ''}`, info.centre));
    if (info.extra) centre.append(ctx.el('span', `gauge-extra${info.tempIn === 'extra' ? ' gauge-temp' : ''}`, info.extra));
    dial.append(svg, centre);
    return dial;
  }
  function factsList(facts, listClass, itemClass, ctx) {
    const list = ctx.el('dl', listClass);
    for (const [name, value] of facts) {
      const item = ctx.el('div', itemClass);
      item.append(ctx.el('dt', 'gauge-fact-name', name), ctx.el('dd', 'gauge-fact-value', value));
      list.append(item);
    }
    return list;
  }
  function trendFor(info, ctx, span, now) {
    const box = ctx.el('div', 'gauge-trend');
    const minutes = Math.round(span / 60000);
    const svg = svgNode('svg', { class: 'gauge-spark', viewBox: `0 0 ${SPARK_WIDTH} ${SPARK_HEIGHT}`, preserveAspectRatio: 'none', role: 'img', 'aria-label': `${info.label} over the last ${minutes} minutes` });
    const shape = sparkline(samples.get(info.metric), now, span);
    const fadeId = `gauge-fade-${String(ctx.card.id).replace(/[^\w-]/g, '')}-${String(ctx.item.id || '').replace(/[^\w-]/g, '')}`;
    const defs = svgNode('defs', {}), fade = svgNode('linearGradient', { id: fadeId, x1: 0, y1: 0, x2: 0, y2: 1 });
    fade.append(svgNode('stop', { class: 'gauge-spark-stop-top', offset: 0 }), svgNode('stop', { class: 'gauge-spark-stop-bottom', offset: 1 }));
    defs.append(fade); svg.append(defs);
    if (shape.line) svg.append(svgNode('path', { class: 'gauge-spark-area', d: shape.area, fill: `url(#${fadeId})` }));
    svg.append(svgNode('line', { class: 'gauge-spark-base', x1: 0, y1: SPARK_HEIGHT, x2: SPARK_WIDTH, y2: SPARK_HEIGHT }));
    if (shape.line) svg.append(svgNode('polyline', { class: 'gauge-spark-line', points: shape.line }));
    box.append(svg, ctx.el('span', 'gauge-trend-caption', `last ${minutes} min`));
    return box;
  }
  function appsFor(info, pc, ctx) {
    const rows = busiestApps(pc.apps, info.metric, { gigabytes: ctx.gigabytes });
    if (!rows.length) return null;
    const list = ctx.el('div', 'gauge-apps'); list.setAttribute('role', 'list'); list.setAttribute('aria-label', info.metric === 'cpu' ? 'Busiest apps by CPU' : 'Busiest apps by memory');
    for (const row of rows) {
      const item = ctx.el('div', 'gauge-app'); item.setAttribute('role', 'listitem');
      const figure = ctx.el('span', 'gauge-app-icon');
      if (row.icon) { const image = ctx.el('img'); image.src = row.icon; image.alt = ''; image.width = 20; image.height = 20; figure.append(image); } else figure.append(ctx.el('i', 'gauge-app-blank'));
      const copy = ctx.el('div', 'gauge-app-copy'); copy.append(ctx.el('span', 'gauge-app-name', row.name));
      const bar = ctx.el('div', 'gauge-app-bar'); const fill = ctx.el('span'); fill.style.width = `${row.share.toFixed(1)}%`; bar.append(fill); copy.append(bar);
      item.append(figure, copy, ctx.el('span', 'gauge-app-value', row.text));
      list.append(item);
    }
    return list;
  }

  function render(body, ctx) {
    const pc = ctx.state().pc || null;
    const info = pick(pc, ctx.item.metric, { gigabytes: ctx.gigabytes, uptimeText: ctx.uptimeText });
    const view = ctx.mode === 'widgets' ? (ctx.size || 'medium') : 'medium';
    const now = Date.now();
    record(info.metric, info.percent, now);
    const root = ctx.el('div', ['gauge-widget', info.hot ? 'is-hot' : '', info.starting ? 'is-starting' : '', info.hint ? 'has-hint' : '', info.trend ? '' : 'no-trend'].filter(Boolean).join(' '));
    root.dataset.metric = info.metric; root.dataset.view = view;
    const main = ctx.button('', () => ctx.editCard(), { className: 'gauge-main', label: info.aria });
    main.append(dialFor(info, ctx));
    const copy = ctx.el('div', 'gauge-copy');
    copy.append(ctx.el(view === 'small' ? 'strong' : 'h3', 'gauge-title', info.label), ctx.el(view === 'small' ? 'span' : 'p', 'gauge-detail', info.detail));
    const hint = info.hint ? ctx.button('Turn on in PC stats', () => ctx.showSettings('display'), { className: 'gauge-hint' }) : null;
    if (view === 'small') {
      // The whole card is the button: ring, label and detail.
      main.append(copy); root.append(main); if (hint) root.append(hint);
      body.append(root); return;
    }
    if (info.facts.length) copy.append(factsList(info.facts, 'gauge-facts', 'gauge-fact', ctx));
    if (hint) copy.append(hint);
    root.append(main, copy);
    if (info.trend) root.append(trendFor(info, ctx, view === 'large' ? LARGE_SPAN_MS : SPAN_MS, now));
    if (view === 'large' && pc) {
      const apps = ['cpu', 'memory'].includes(info.metric) ? appsFor(info, pc, ctx) : null;
      if (apps) root.append(apps); else if (info.grid.length) root.append(factsList(info.grid, 'gauge-grid', 'gauge-tile', ctx));
    }
    body.append(root);
  }
  function signature(ctx) { return [ctx.item.metric, ctx.state().pc]; }
  function mood(ctx) { return { mood: pick(ctx.state().pc, ctx.item.metric).hot ? 'hot' : '', attention: false }; }

  window.EdgeWidgets = window.EdgeWidgets || {};
  window.EdgeWidgets.gauge = Object.freeze({ render, signature, mood, helpers: Object.freeze({ pick, record, sparkline, busiestApps, shortCpuName, LABELS, samples, SPAN_MS, LARGE_SPAN_MS }) });
})();
