(() => {
  'use strict';
  // Apple Weather-style living sky for weather cards. CSS draws the
  // condition/time-of-day gradient, sun, drifting clouds and fog; canvases
  // draw stars, the moon, rain, snow and lightning. One shared loop animates
  // every sky and stops when nothing on a canvas moves.
  const instances = new WeakMap();
  const skies = new Set();
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const KINDS = new Set(['clear', 'partly', 'cloudy', 'fog', 'rain', 'snow', 'storm', 'unknown']);
  const PHASES = new Set(['day', 'night', 'dawn', 'dusk']);
  const palettes = {
    clear: { day: ['#0d58c2', '#3a8de0', '#80c0f2'], night: ['#02040d', '#0a1530', '#1b2d55'], dawn: ['#1d3769', '#7b6c9f', '#f0a274'], dusk: ['#141f47', '#6b4c86', '#e57d5a'] },
    partly: { day: ['#2a6cc0', '#5a98d6', '#a0c7eb'], night: ['#050a1c', '#12203f', '#293a60'], dawn: ['#283f6a', '#7d7397', '#e6a07c'], dusk: ['#1c2a4f', '#6a5584', '#d98563'] },
    cloudy: { day: ['#4b5d73', '#6e8196', '#9bacbc'], night: ['#0e131c', '#1b2331', '#2e3849'] },
    fog: { day: ['#76869a', '#97a5b4', '#bfc8d1'], night: ['#1a202a', '#2a323e', '#3e4754'] },
    rain: { day: ['#2f3c4e', '#4b5a6d', '#6e7e90'], night: ['#090e17', '#141c29', '#24303f'] },
    storm: { day: ['#1c222c', '#323b49', '#4a5464'], night: ['#05070c', '#0f1420', '#1c2331'] },
    snow: { day: ['#5d6f87', '#8496ab', '#b2c1d0'], night: ['#121926', '#24303e', '#3b485a'] },
    unknown: { day: ['#2b303b', '#262b35', '#1c2029'], night: ['#1a1d25', '#15181f', '#0f1116'] },
  };
  // Every condition gets its own sky, for day, night, sunrise and sunset, as in
  // Apple Weather. A scene names its base kind (cloud shapes, icon), its
  // palette, cloud tone and amount, whether the sun or stars show through, how
  // much fog or haze hangs in it, and what falls: rain, drizzle, snow, ice
  // pellets, hail, wind streaks, lightning.
  const warm = (day, night, dawn, dusk) => ({ day, night, dawn, dusk });
  const SCENES = {
    clear: { kind: 'clear', palette: palettes.clear, clouds: 0, sun: 'show', stars: 1, moon: true },
    'mostly-clear': { kind: 'clear', palette: palettes.clear, clouds: 2, sun: 'show', stars: 0.95, moon: true },
    partly: { kind: 'partly', palette: palettes.partly, clouds: 4, sun: 'show', stars: 0.8, moon: true },
    'mostly-cloudy': { kind: 'cloudy', clouds: 7, tone: 'light', sun: 'veil', stars: 0.35, moon: true,
      palette: warm(['#3f638c', '#6688ad', '#9db6cf'], ['#0a1222', '#172238', '#2b3a54'], ['#3a4a6c', '#86809a', '#d6a58c'], ['#2a3456', '#6f6488', '#c98c74']) },
    cloudy: { kind: 'cloudy', clouds: 9, tone: 'overcast', sun: 'none', stars: 0.1,
      palette: warm(palettes.cloudy.day, palettes.cloudy.night, ['#4a5068', '#7d7a8c', '#b09a94'], ['#3a3f58', '#6c6478', '#a1867f']) },
    windy: { kind: 'partly', clouds: 6, tone: 'light', sun: 'show', stars: 0.6, moon: true, streaks: 1, windy: true,
      palette: warm(['#2f6fb8', '#5d97d1', '#a6c8e6'], ['#060c1e', '#13213f', '#2a3c62'], ['#2c4270', '#7e7598', '#e3a07e'], ['#1d2a50', '#6a5584', '#d38664']) },
    fog: { kind: 'fog', clouds: 4, tone: 'overcast', sun: 'veil', fog: 1,
      palette: warm(palettes.fog.day, palettes.fog.night, ['#6f7590', '#a39fae', '#d4c2b8'], ['#5d6280', '#948c9e', '#c4a89c']) },
    'freezing-fog': { kind: 'fog', clouds: 3, tone: 'frost', sun: 'veil', fog: 1, frost: true,
      palette: warm(['#7f96ad', '#a8bccd', '#d6e2ec'], ['#141d2b', '#25344a', '#3d4f68'], ['#76829e', '#aab0c6', '#e0d0cc'], ['#626c8c', '#9c9cb4', '#d0b8b2']) },
    drizzle: { kind: 'rain', clouds: 7, tone: 'rain-light', sun: 'none', drizzle: 1, fog: 0.25,
      palette: warm(['#4a5b6f', '#6b7c8f', '#97a6b5'], ['#0c121c', '#18212f', '#2b3646'], ['#4a5068', '#78748a', '#a99492'], ['#3c4058', '#686276', '#97807e']) },
    'freezing-drizzle': { kind: 'rain', clouds: 7, tone: 'frost', sun: 'none', drizzle: 1, pellets: 0.25, fog: 0.3, frost: true,
      palette: warm(['#56697f', '#7b8fa3', '#aabbc9'], ['#0e1520', '#1b2636', '#2f3d50'], ['#525a74', '#82829a', '#b5a3a3'], ['#434a66', '#727088', '#a38f8e']) },
    rain: { kind: 'rain', clouds: 8, tone: 'rain', sun: 'none', rain: 1, fog: 0.35,
      palette: warm(palettes.rain.day, palettes.rain.night, ['#3a4058', '#665f74', '#8f7c7c'], ['#2e3248', '#58506a', '#7f6c6e']) },
    'heavy-rain': { kind: 'rain', clouds: 10, tone: 'storm', sun: 'none', rain: 1.6, fog: 0.55, streaks: 0.4,
      palette: warm(['#222b38', '#36424f', '#4f5c6b'], ['#05080e', '#0e141e', '#1a222e'], ['#2a2e40', '#4c4658', '#6a5c60'], ['#22253a', '#433c52', '#5e5056']) },
    showers: { kind: 'rain', clouds: 6, tone: 'rain', sun: 'veil', rain: 0.7, stars: 0.2, broken: true, fog: 0.15,
      palette: warm(['#3d5a7d', '#64809f', '#9cb1c6'], ['#0a1120', '#172235', '#2a384e'], ['#3c4868', '#79738e', '#c39a88'], ['#2e3656', '#675c7c', '#b4846f']) },
    'freezing-rain': { kind: 'rain', clouds: 9, tone: 'frost', sun: 'none', rain: 0.9, pellets: 0.5, fog: 0.35, frost: true,
      palette: warm(['#3e4f63', '#5e7186', '#8ea2b5'], ['#0a111b', '#162130', '#283749'], ['#424a64', '#6e6c84', '#9c8c90'], ['#363c58', '#5e5a74', '#8c7a80']) },
    sleet: { kind: 'snow', clouds: 9, tone: 'frost', sun: 'none', rain: 0.5, snow: 0.5, pellets: 0.6, fog: 0.35, frost: true,
      palette: warm(['#4d5d72', '#718196', '#a1b0c0'], ['#0e1520', '#1c2736', '#313f52'], ['#4c5470', '#7a7890', '#aa999c'], ['#3e4462', '#6a667e', '#988688']) },
    flurries: { kind: 'snow', clouds: 6, tone: 'light', sun: 'veil', snow: 0.35, stars: 0.25,
      palette: warm(['#5f7895', '#86a0ba', '#b9cbdc'], ['#101a2a', '#20304a', '#38496a'], ['#56607e', '#8c8aa4', '#d2b8b0'], ['#46506e', '#7c7894', '#c0a49e']) },
    snow: { kind: 'snow', clouds: 8, tone: 'overcast', sun: 'none', snow: 1, fog: 0.3,
      palette: warm(palettes.snow.day, palettes.snow.night, ['#5a6280', '#8e8ca4', '#c4b0ac'], ['#4a5070', '#7e7a94', '#b29e9c']) },
    'snow-showers': { kind: 'snow', clouds: 6, tone: 'light', sun: 'veil', snow: 0.8, stars: 0.2, broken: true, fog: 0.15,
      palette: warm(['#56769a', '#7f9dbd', '#b6cbe0'], ['#0e1828', '#1c2c46', '#334666'], ['#4e5a7c', '#8a86a2', '#d0b2a6'], ['#40486a', '#787290', '#bc9c94']) },
    'heavy-snow': { kind: 'snow', clouds: 10, tone: 'overcast', sun: 'none', snow: 1.7, fog: 0.6,
      palette: warm(['#6e7f94', '#95a4b5', '#c6d0da'], ['#141b26', '#262f3d', '#3e4a5a'], ['#646a84', '#9692a6', '#c8b6b2'], ['#545a76', '#86809a', '#b6a4a2']) },
    blizzard: { kind: 'snow', clouds: 10, tone: 'overcast', sun: 'none', snow: 2, fog: 0.85, streaks: 1, windy: true,
      palette: warm(['#8090a2', '#a8b4c2', '#d4dbe3'], ['#181f2a', '#2b3442', '#46505f'], ['#727890', '#a29eb0', '#d2c2be'], ['#62687e', '#928ea2', '#c2b0ac']) },
    'snow-grains': { kind: 'snow', clouds: 8, tone: 'overcast', sun: 'none', pellets: 0.7, snow: 0.2, fog: 0.25,
      palette: warm(['#62748b', '#8899ad', '#b6c3d1'], ['#121926', '#232e3d', '#3a4657'], ['#5a6080', '#8c88a0', '#bca9a6'], ['#4a4f6e', '#7a7690', '#a8968f']) },
    storm: { kind: 'storm', clouds: 9, tone: 'storm', sun: 'none', rain: 1.2, lightning: 1, fog: 0.35,
      palette: warm(palettes.storm.day, palettes.storm.night, ['#262838', '#47404e', '#6a5050'], ['#1e2032', '#3d3446', '#5c4446']) },
    'severe-storm': { kind: 'storm', clouds: 10, tone: 'storm', sun: 'none', rain: 1.7, lightning: 2, fog: 0.5, streaks: 0.6,
      palette: warm(['#141820', '#262d38', '#3a4350'], ['#030407', '#0a0e16', '#151b26'], ['#1c1c2a', '#382f3c', '#553e40'], ['#16172a', '#302838', '#4a3638']) },
    hail: { kind: 'storm', clouds: 10, tone: 'storm', sun: 'none', rain: 0.9, pellets: 1, hail: true, lightning: 1, fog: 0.35,
      palette: warm(['#1f2630', '#353f4c', '#4f5a68'], ['#05070c', '#10151f', '#1d2532'], ['#282a3a', '#484250', '#6a5656'], ['#202232', '#3e3648', '#5c484a']) },
    unknown: { kind: 'unknown', palette: palettes.unknown, clouds: 0, sun: 'none' },
  };
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  function random(seed) { // small deterministic PRNG so layouts stay stable
    let state = seed >>> 0;
    return () => { state = (state + 0x6D2B79F5) >>> 0; let t = state; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function normalize(model = {}) {
    const kind = KINDS.has(model.kind) ? model.kind : 'unknown';
    const fallback = kind === 'clear' && model.mostlyClear ? 'mostly-clear' : kind;
    const scene = Object.hasOwn(SCENES, model.scene) ? model.scene : fallback;
    return {
      scene,
      kind: SCENES[scene].kind,
      phase: PHASES.has(model.phase) ? model.phase : 'day',
      intensity: clamp(Number.isFinite(model.intensity) ? model.intensity : 0.6, 0, 1),
      cloudCover: Number.isFinite(model.cloudCover) ? clamp(model.cloudCover, 0, 100) : null,
      wind: Number.isFinite(model.wind) ? clamp(model.wind, 0, 150) : 10,
      mostlyClear: model.mostlyClear === true,
      visibility: Number.isFinite(model.visibility) ? clamp(model.visibility, 0, 200000) : null,
    };
  }
  function palette({ scene, phase }) {
    const set = SCENES[scene].palette;
    return set[phase] || set[phase === 'night' ? 'night' : 'day'];
  }
  function cloudTone({ scene, kind, phase }) {
    const night = phase === 'night', warm = phase === 'dawn' || phase === 'dusk';
    const tone = SCENES[scene].tone;
    if (tone === 'frost') return night ? ['rgb(96 112 136 / 88%)', 'rgb(70 84 108 / 88%)', 'rgb(46 56 76 / 88%)'] : ['rgb(236 244 252 / 96%)', 'rgb(200 216 232 / 93%)', 'rgb(146 166 190 / 90%)'];
    if (tone === 'rain-light') return night ? ['rgb(80 90 108 / 86%)', 'rgb(58 67 84 / 86%)', 'rgb(38 45 58 / 86%)'] : ['rgb(196 204 214 / 95%)', 'rgb(156 166 180 / 94%)', 'rgb(112 122 138 / 92%)'];
    if (tone === 'light') kind = 'partly';
    if (tone === 'overcast') kind = 'cloudy';
    if (tone === 'rain') kind = 'rain';
    if (tone === 'storm') kind = 'storm';
    if (warm && (tone === 'overcast' || tone === 'rain')) return ['rgb(214 196 196 / 92%)', 'rgb(160 140 150 / 90%)', 'rgb(104 92 108 / 88%)'];
    if (kind === 'storm') return night ? ['rgb(58 64 78 / 95%)', 'rgb(40 45 56 / 95%)', 'rgb(24 28 36 / 95%)'] : ['rgb(122 130 144 / 96%)', 'rgb(88 96 110 / 96%)', 'rgb(56 62 74 / 96%)'];
    if (kind === 'rain') return night ? ['rgb(72 82 100 / 90%)', 'rgb(52 61 78 / 90%)', 'rgb(34 41 54 / 90%)'] : ['rgb(172 182 195 / 95%)', 'rgb(134 145 160 / 94%)', 'rgb(94 105 120 / 94%)'];
    if (kind === 'cloudy' || kind === 'fog' || kind === 'snow') return night ? ['rgb(84 94 114 / 85%)', 'rgb(62 71 90 / 85%)', 'rgb(40 47 62 / 85%)'] : ['rgb(240 243 248 / 96%)', 'rgb(208 216 227 / 93%)', 'rgb(152 165 182 / 90%)'];
    if (warm) return ['rgb(255 220 198 / 95%)', 'rgb(236 176 166 / 88%)', 'rgb(142 112 142 / 82%)'];
    return night ? ['rgb(132 146 182 / 50%)', 'rgb(92 106 142 / 45%)', 'rgb(54 66 98 / 45%)'] : ['rgb(255 255 255 / 98%)', 'rgb(242 246 252 / 92%)', 'rgb(196 210 226 / 88%)'];
  }
  function cloudCount({ scene, kind, cloudCover }) {
    let count = SCENES[scene].clouds;
    if (cloudCover !== null && ['clear', 'mostly-clear', 'partly', 'mostly-cloudy', 'cloudy', 'windy'].includes(scene)) {
      count = Math.round(clamp(count * 0.5 + cloudCover / 100 * 7, kind === 'clear' ? 0 : 2, 10));
    }
    return count;
  }
  // Moon phase from the mean synodic month (0 = new, 0.5 = full).
  function moonPhase(date = Date.now()) {
    const days = (date - Date.UTC(2000, 0, 6, 18, 14)) / 86400000;
    return ((days / 29.530588853) % 1 + 1) % 1;
  }

  function create(model) {
    const root = document.createElement('div'); root.className = 'sky'; root.setAttribute('aria-hidden', 'true');
    const sun = document.createElement('div'); sun.className = 'sky-sun'; sun.append(document.createElement('i'));
    const back = document.createElement('canvas'); back.className = 'sky-back';
    const clouds = document.createElement('div'); clouds.className = 'sky-clouds';
    const fog = document.createElement('div'); fog.className = 'sky-fog'; fog.append(document.createElement('i'), document.createElement('i'), document.createElement('i'));
    const front = document.createElement('canvas'); front.className = 'sky-front';
    const flash = document.createElement('div'); flash.className = 'sky-flash';
    const shade = document.createElement('div'); shade.className = 'sky-shade';
    root.append(sun, back, clouds, fog, front, flash, shade);
    const sky = { root, back, front, clouds, backCtx: back.getContext('2d', { willReadFrequently: true }), frontCtx: front.getContext('2d', { willReadFrequently: true }), w: 0, h: 0, dpr: 1,
      model: null, signature: '', cloudSignature: '', stars: [], drops: [], flakes: [], pellets: [], streaks: [], nextFlash: 0, bolt: null, shooting: null, nextShooting: 0, lastBack: 0, still: false };
    sky.observer = new ResizeObserver(entries => { const box = entries[0].contentRect; resize(sky, box.width, box.height); });
    sky.observer.observe(root);
    instances.set(root, sky); skies.add(sky);
    update(root, model);
    return root;
  }
  function update(root, model) {
    const sky = instances.get(root); if (!sky) return;
    const next = normalize(model); const signature = JSON.stringify(next);
    if (signature === sky.signature) return;
    const previous = sky.model; sky.model = next; sky.signature = signature;
    const [a, b, c] = palette(next); const [hi, mid, lo] = cloudTone(next);
    root.style.setProperty('--sky-a', a); root.style.setProperty('--sky-b', b); root.style.setProperty('--sky-c', c);
    root.style.setProperty('--cloud-hi', hi); root.style.setProperty('--cloud', mid); root.style.setProperty('--cloud-lo', lo);
    root.dataset.kind = next.kind; root.dataset.scene = next.scene; root.dataset.phase = next.phase;
    const scene = SCENES[next.scene];
    root.dataset.sun = scene.sun === 'none' || next.phase === 'night' ? 'none' : next.phase === 'day' ? 'high' : 'low';
    root.dataset.veil = String(scene.sun === 'veil');
    root.dataset.frost = String(scene.frost === true);
    root.style.setProperty('--fog-o', '0');
    if (!previous || previous.scene !== next.scene || previous.intensity !== next.intensity || previous.wind !== next.wind || previous.visibility !== next.visibility) seedParticles(sky);
    buildClouds(sky);
    sky.still = false; schedule();
  }
  function resize(sky, width, height) {
    const w = Math.round(width), h = Math.round(height);
    if (w === sky.w && h === sky.h) return;
    sky.w = w; sky.h = h; sky.dpr = Math.min(2, window.devicePixelRatio || 1);
    sky.root.style.setProperty('--sky-w', `${w}px`);
    for (const canvas of [sky.back, sky.front]) { canvas.width = Math.max(1, Math.round(w * sky.dpr)); canvas.height = Math.max(1, Math.round(h * sky.dpr)); }
    const rand = random(w * 7919 + h);
    const count = Math.round(clamp(w * h / 1500, 50, 320));
    sky.stars = Array.from({ length: count }, () => {
      const bright = rand() < 0.08;
      return { x: rand() * w, y: Math.pow(rand(), 1.6) * h * 0.9, r: bright ? 1.1 + rand() * 0.7 : 0.35 + rand() * 0.6, a: 0.35 + rand() * 0.65, speed: 0.6 + rand() * 2.2, phase: rand() * Math.PI * 2 };
    });
    seedParticles(sky); sky.cloudSignature = ''; buildClouds(sky);
    sky.still = false; schedule();
  }
  function seedParticles(sky) {
    const { w, h } = sky; const model = sky.model; if (!w || !h || !model) return;
    const rand = random(Math.round(w + h * 3 + model.intensity * 1000));
    const area = w * h / 260000;
    sky.drops = []; sky.flakes = []; sky.pellets = []; sky.streaks = [];
    const scene = SCENES[model.scene];
    if (scene.rain) {
      const count = Math.round(clamp((40 + 300 * model.intensity) * area * scene.rain, 20, 760));
      for (let i = 0; i < count; i++) {
        const near = rand() < 0.4;
        sky.drops.push({ x: rand() * w, y: rand() * h, near, len: (near ? 16 + rand() * 12 : 8 + rand() * 6) * (0.65 + model.intensity * 0.5), speed: near ? 800 + rand() * 300 : 520 + rand() * 180 });
      }
    }
    if (scene.drizzle) {
      // Drizzle: many short, fine, slower drops.
      const count = Math.round(clamp((120 + 260 * model.intensity) * area, 40, 620));
      for (let i = 0; i < count; i++) sky.drops.push({ x: rand() * w, y: rand() * h, near: rand() < 0.25, fine: true, len: 3 + rand() * 4, speed: 260 + rand() * 140 });
    }
    if (scene.snow) {
      const count = Math.round(clamp((30 + 170 * model.intensity) * area * scene.snow, 15, 560));
      for (let i = 0; i < count; i++) {
        const r = 0.8 + rand() * 2.2;
        sky.flakes.push({ x: rand() * w, y: rand() * h, r, speed: 14 + r * 14 + rand() * 10, sway: 6 + rand() * 16, freq: 0.4 + rand() * 0.8, phase: rand() * Math.PI * 2, a: r < 1.4 ? 0.45 + rand() * 0.25 : 0.7 + rand() * 0.28 });
      }
    }
    if (scene.pellets) {
      // Ice pellets, snow grains and hail: small hard grains falling fast and straight.
      const count = Math.round(clamp((30 + 140 * model.intensity) * area * scene.pellets, 10, 300));
      for (let i = 0; i < count; i++) {
        const r = scene.hail ? 1.6 + rand() * 2.2 : 0.7 + rand() * 1.1;
        sky.pellets.push({ x: rand() * w, y: rand() * h, r, speed: scene.hail ? 520 + rand() * 260 : 300 + rand() * 180, a: 0.55 + rand() * 0.4 });
      }
    }
    buildFog(sky, rand);
    if (scene.streaks || model.wind >= 45) {
      // Wind: faint horizontal streaks racing across.
      const count = Math.round(clamp(10 * area * Math.max(scene.streaks || 0, (model.wind - 30) / 40), 4, 40));
      for (let i = 0; i < count; i++) sky.streaks.push({ x: rand() * w, y: rand() * h, len: 40 + rand() * 90, speed: 420 + rand() * 360, a: 0.06 + rand() * 0.1 });
    }
  }
  // Fog, as in Apple Weather: banks of mist rolling slowly across at three
  // depths (denser and slower near the ground) over a wash that softens the
  // whole sky. Strength comes from the condition (fog, freezing fog, the haze
  // of rain and snow) or from low visibility, which also brings mist and haze
  // to otherwise dry skies.
  function fogStrength(model) {
    const scene = SCENES[model.scene];
    const visibility = model.visibility;
    const fromVisibility = visibility === null ? 0 : visibility < 500 ? 1 : visibility < 1000 ? 0.85 : visibility < 2500 ? 0.6 : visibility < 5000 ? 0.35 : visibility < 8000 ? 0.18 : 0;
    return clamp(Math.max(scene.fog || 0, fromVisibility), 0, 1);
  }
  function fogTexture(width, height, rand, puffs, color) {
    const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(width)); canvas.height = Math.max(1, Math.round(height));
    const ctx = canvas.getContext('2d');
    for (let i = 0; i < puffs; i++) {
      const r = height * (0.22 + rand() * 0.2), x = rand() * width, y = height * (0.38 + rand() * 0.24), a = 0.2 + rand() * 0.25;
      // Drawn three times across the seam so the band tiles seamlessly.
      for (const dx of [-width, 0, width]) {
        const glow = ctx.createRadialGradient(x + dx, y, 0, x + dx, y, r);
        glow.addColorStop(0, `rgb(${color} / ${(a * 100).toFixed(0)}%)`); glow.addColorStop(0.6, `rgb(${color} / ${(a * 40).toFixed(0)}%)`); glow.addColorStop(1, `rgb(${color} / 0%)`);
        ctx.fillStyle = glow; ctx.beginPath(); ctx.ellipse(x + dx, y, r * 1.9, r, 0, 0, Math.PI * 2); ctx.fill();
      }
    }
    // Feathered top and bottom, so a band never shows an edge.
    ctx.globalCompositeOperation = 'destination-in';
    const fade = ctx.createLinearGradient(0, 0, 0, height);
    fade.addColorStop(0, 'rgb(0 0 0 / 0%)'); fade.addColorStop(0.3, 'rgb(0 0 0 / 100%)'); fade.addColorStop(0.7, 'rgb(0 0 0 / 100%)'); fade.addColorStop(1, 'rgb(0 0 0 / 0%)');
    ctx.fillStyle = fade; ctx.fillRect(0, 0, width, height);
    ctx.globalCompositeOperation = 'source-over';
    return canvas;
  }
  function buildFog(sky, rand) {
    const { w, h, model } = sky;
    const strength = fogStrength(model);
    if (strength <= 0) { sky.fog = null; return; }
    const night = model.phase === 'night', frost = SCENES[model.scene].frost === true;
    const color = frost ? (night ? '150 168 196' : '232 240 250') : night ? '128 138 158' : model.phase === 'dawn' || model.phase === 'dusk' ? '232 214 210' : '224 230 238';
    const layers = [
      { y: 0.1, height: 0.45, speed: 6, alpha: 0.5 },
      { y: 0.36, height: 0.5, speed: 11, alpha: 0.65 },
      { y: 0.58, height: 0.55, speed: 17, alpha: 0.85 },
    ].map(layer => ({ ...layer, texture: fogTexture(w * 1.6, h * layer.height, rand, 22, color), offset: rand() * w }));
    sky.fog = { strength, color, layers };
  }
  function paintFog(sky, ctx, dt) {
    const fog = sky.fog; if (!fog) return false;
    const { w, h } = sky;
    // The wash: the sky itself goes soft, more so lower down.
    const wash = ctx.createLinearGradient(0, 0, 0, h);
    wash.addColorStop(0, `rgb(${fog.color} / ${(fog.strength * 8).toFixed(0)}%)`);
    wash.addColorStop(1, `rgb(${fog.color} / ${(fog.strength * 26).toFixed(0)}%)`);
    ctx.fillStyle = wash; ctx.fillRect(0, 0, w, h);
    // The mist banks, tinted, rolling at their own speeds.
    for (const layer of fog.layers) {
      if (!sky.still) layer.offset = (layer.offset + layer.speed * (1 + sky.model.wind / 40) * dt) % layer.texture.width;
      const top = h * layer.y, height = layer.texture.height;
      ctx.globalAlpha = layer.alpha * fog.strength;
      ctx.drawImage(layer.texture, layer.offset - layer.texture.width, top, layer.texture.width, height);
      ctx.drawImage(layer.texture, layer.offset, top, layer.texture.width, height);
    }
    ctx.globalAlpha = 1;
    return true;
  }
  function buildClouds(sky) {
    const { w, h, model } = sky; if (!model) return;
    const count = cloudCount(model);
    const signature = JSON.stringify([count, model.scene, model.wind, w, h]);
    if (signature === sky.cloudSignature) return;
    sky.cloudSignature = signature;
    const rand = random(count * 131 + model.kind.length * 17);
    const scale = clamp((w || 480) / 500, 0.7, 1.6);
    const overcast = ['cloudy', 'rain', 'storm', 'snow'].includes(model.kind) && !SCENES[model.scene].broken;
    const nodes = [];
    for (let i = 0; i < count; i++) {
      const front = i % 2 === 1;
      const width = (front ? 230 + rand() * 140 : 150 + rand() * 90) * scale;
      const height = width * (0.34 + rand() * 0.08);
      const top = overcast ? -6 + rand() * (front ? 46 : 30) : (front ? 14 + rand() * 42 : 2 + rand() * 30);
      const speed = (3 + model.wind * (SCENES[model.scene].windy ? 0.7 : 0.25)) * (front ? 1 : 0.6);
      const duration = ((w || 480) + width) / speed;
      const cloud = document.createElement('div'); cloud.className = `sky-cloud${front ? ' is-front' : ''}`; cloud.dataset.shape = String(i % 3);
      cloud.style.cssText = `--w:${width.toFixed(0)}px;--h:${height.toFixed(0)}px;--y:${top.toFixed(1)}%;--o:${(front ? 0.88 + rand() * 0.12 : 0.55 + rand() * 0.2).toFixed(2)};--dur:${duration.toFixed(1)}s;--delay:${(-rand() * duration).toFixed(1)}s;--static-x:${(rand() * (w || 480) - width / 2).toFixed(0)}px`;
      for (let k = 0; k < 5; k++) cloud.append(document.createElement('i'));
      nodes.push(cloud);
    }
    sky.clouds.replaceChildren(...nodes);
  }

  // ---- Canvas painting ----------------------------------------------------
  function drawMoon(ctx, x, y, r, phase) {
    const glow = ctx.createRadialGradient(x, y, r * 0.8, x, y, r * 5);
    glow.addColorStop(0, 'rgb(205 218 255 / 22%)'); glow.addColorStop(1, 'rgb(205 218 255 / 0%)');
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(x, y, r * 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgb(190 205 235 / 10%)'; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    // Lit limb plus a half-ellipse terminator.
    const waxing = phase < 0.5, t = Math.cos(phase * Math.PI * 2);
    const light = ctx.createLinearGradient(x - r, y - r, x + r, y + r);
    light.addColorStop(0, '#fbf8ee'); light.addColorStop(1, '#d8d2c2');
    ctx.fillStyle = light; ctx.beginPath();
    ctx.arc(x, y, r, -Math.PI / 2, Math.PI / 2, !waxing);
    const throughRight = waxing ? t > 0 : t < 0;
    if (throughRight) ctx.ellipse(x, y, r * Math.abs(t), r, 0, Math.PI / 2, -Math.PI / 2, true);
    else ctx.ellipse(x, y, r * Math.abs(t), r, 0, Math.PI / 2, Math.PI * 1.5, false);
    ctx.fill();
  }
  function starVisibility({ scene, phase }) {
    const base = SCENES[scene].stars || 0;
    return phase === 'night' ? base : phase === 'dawn' || phase === 'dusk' ? base * 0.3 : 0;
  }
  function paintBack(sky, seconds, now) {
    const { backCtx: ctx, w, h, dpr, model } = sky;
    const visible = starVisibility(model);
    const moon = model.phase === 'night' && SCENES[model.scene].moon === true && (model.scene !== 'mostly-cloudy' || (model.cloudCover ?? 100) < 85);
    if (!visible && !moon) {
      if (sky.backDirty) { ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h); sky.backDirty = false; }
      return false;
    }
    sky.backDirty = true;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    if (visible > 0) {
      for (const star of sky.stars) {
        const twinkle = sky.still ? 1 : 0.62 + 0.38 * Math.sin(seconds * star.speed + star.phase);
        ctx.fillStyle = `rgb(255 255 255 / ${(star.a * twinkle * visible * 100).toFixed(1)}%)`;
        ctx.beginPath(); ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2); ctx.fill();
      }
      if (!sky.still && ['clear', 'mostly-clear'].includes(model.scene) && model.phase === 'night') paintShootingStar(sky, ctx, now);
    }
    if (moon) {
      drawMoon(ctx, w * 0.8, h * 0.17, clamp(Math.min(w, h) * 0.045, 10, 22), moonPhase());
    }
    return visible > 0;
  }
  function paintShootingStar(sky, ctx, now) {
    if (!sky.shooting && now >= sky.nextShooting) {
      const rand = Math.random;
      if (sky.nextShooting) sky.shooting = { x: sky.w * (0.1 + rand() * 0.55), y: sky.h * (0.05 + rand() * 0.25), angle: 0.35 + rand() * 0.25, length: 90 + rand() * 60, start: now, duration: 900 };
      sky.nextShooting = now + 9000 + Math.random() * 13000;
    }
    const star = sky.shooting; if (!star) return;
    const progress = (now - star.start) / star.duration;
    if (progress >= 1) { sky.shooting = null; return; }
    const travel = progress * star.length * 2.2, fade = Math.sin(progress * Math.PI);
    const hx = star.x + Math.cos(star.angle) * travel, hy = star.y + Math.sin(star.angle) * travel;
    const tx = hx - Math.cos(star.angle) * star.length, ty = hy - Math.sin(star.angle) * star.length;
    const trail = ctx.createLinearGradient(hx, hy, tx, ty);
    trail.addColorStop(0, `rgb(255 255 255 / ${(fade * 90).toFixed(0)}%)`); trail.addColorStop(1, 'rgb(255 255 255 / 0%)');
    ctx.strokeStyle = trail; ctx.lineWidth = 1.4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(tx, ty); ctx.stroke();
  }
  function paintFront(sky, seconds, dt, now) {
    const { frontCtx: ctx, w, h, dpr, model } = sky;
    const scene = SCENES[model.scene];
    const busy = sky.drops.length || sky.flakes.length || sky.pellets.length || sky.streaks.length || scene.lightning || sky.fog;
    if (!busy) {
      if (sky.frontDirty) { ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h); sky.frontDirty = false; }
      return false;
    }
    sky.frontDirty = true;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    let moving = false;
    if (sky.drops.length) {
      moving = true;
      const slant = clamp(model.wind / 90, 0.04, 0.35);
      for (const near of [false, true]) {
        ctx.beginPath();
        for (const drop of sky.drops) {
          if (drop.near !== near || drop.fine) continue;
          if (!sky.still) {
            drop.y += drop.speed * dt; drop.x += drop.speed * slant * dt;
            if (drop.y - drop.len > h) { drop.y = -drop.len - Math.random() * h * 0.3; drop.x = Math.random() * (w + h * slant) - h * slant; }
          }
          ctx.moveTo(drop.x, drop.y); ctx.lineTo(drop.x - drop.len * slant, drop.y - drop.len);
        }
        ctx.strokeStyle = near ? 'rgb(214 228 248 / 42%)' : 'rgb(200 216 240 / 22%)';
        ctx.lineWidth = near ? 1.3 : 0.9; ctx.lineCap = 'round'; ctx.stroke();
      }
      // Drizzle drops: short and fine.
      ctx.beginPath();
      for (const drop of sky.drops) {
        if (!drop.fine) continue;
        if (!sky.still) {
          drop.y += drop.speed * dt; drop.x += drop.speed * slant * 0.6 * dt;
          if (drop.y - drop.len > h) { drop.y = -drop.len - Math.random() * h * 0.2; drop.x = Math.random() * (w + h * slant) - h * slant; }
        }
        ctx.moveTo(drop.x, drop.y); ctx.lineTo(drop.x - drop.len * slant * 0.6, drop.y - drop.len);
      }
      ctx.strokeStyle = 'rgb(214 226 244 / 30%)'; ctx.lineWidth = 0.8; ctx.stroke();
    }
    if (sky.pellets.length) {
      moving = true;
      for (const pellet of sky.pellets) {
        if (!sky.still) {
          pellet.y += pellet.speed * dt; pellet.x += model.wind * 0.6 * dt;
          if (pellet.y - pellet.r > h) { pellet.y = -pellet.r - Math.random() * h * 0.3; pellet.x = Math.random() * w; }
          if (pellet.x > w + 10) pellet.x -= w + 20;
        }
        ctx.fillStyle = `rgb(240 246 255 / ${(pellet.a * 100).toFixed(0)}%)`;
        ctx.beginPath(); ctx.arc(pellet.x, pellet.y, pellet.r, 0, Math.PI * 2); ctx.fill();
      }
    }
    if (sky.streaks.length) {
      moving = true;
      for (const streak of sky.streaks) {
        if (!sky.still) { streak.x += streak.speed * dt; if (streak.x - streak.len > w) { streak.x = -Math.random() * w * 0.4; streak.y = Math.random() * h; } }
        const gradient = ctx.createLinearGradient(streak.x - streak.len, 0, streak.x, 0);
        gradient.addColorStop(0, 'rgb(255 255 255 / 0%)'); gradient.addColorStop(1, `rgb(255 255 255 / ${(streak.a * 100).toFixed(0)}%)`);
        ctx.strokeStyle = gradient; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(streak.x - streak.len, streak.y); ctx.lineTo(streak.x, streak.y + 2); ctx.stroke();
      }
    }
    if (sky.flakes.length) {
      moving = true;
      const drift = model.wind * (scene.windy ? 1.4 : 0.35);
      for (const flake of sky.flakes) {
        if (!sky.still) {
          flake.y += flake.speed * dt; flake.x += drift * dt;
          if (flake.y - flake.r > h) { flake.y = -flake.r - Math.random() * 20; flake.x = Math.random() * w; }
          if (flake.x > w + 30) flake.x -= w + 60;
        }
        const x = flake.x + Math.sin(seconds * flake.freq + flake.phase) * flake.sway;
        ctx.fillStyle = `rgb(255 255 255 / ${(flake.a * 100).toFixed(0)}%)`;
        ctx.beginPath(); ctx.arc(x, flake.y, flake.r, 0, Math.PI * 2); ctx.fill();
      }
    }
    if (scene.lightning && !sky.still) { moving = true; paintLightning(sky, ctx, now); }
    if (paintFog(sky, ctx, dt)) moving = true;
    return moving;
  }
  function paintLightning(sky, ctx, now) {
    if (!sky.nextFlash) sky.nextFlash = now + 2500 + Math.random() * 5000;
    if (now >= sky.nextFlash) {
      sky.root.style.setProperty('--flash-x', `${(20 + Math.random() * 60).toFixed(0)}%`);
      sky.root.classList.remove('is-flashing'); void sky.root.offsetWidth; sky.root.classList.add('is-flashing');
      if (Math.random() < 0.55) {
        const points = []; let x = sky.w * (0.2 + Math.random() * 0.6), y = sky.h * 0.12;
        while (y < sky.h * 0.68) { points.push([x, y]); x += (Math.random() - 0.5) * 34; y += 12 + Math.random() * 22; }
        points.push([x, y]);
        sky.bolt = { points, until: now + 180 };
      }
      sky.nextFlash = now + (5000 + Math.random() * 9000) / (SCENES[sky.model.scene].lightning || 1);
    }
    if (sky.bolt && now < sky.bolt.until) {
      ctx.save(); ctx.strokeStyle = 'rgb(246 248 255 / 95%)'; ctx.lineWidth = 2; ctx.lineJoin = 'round';
      ctx.shadowColor = 'rgb(190 205 255 / 90%)'; ctx.shadowBlur = 14;
      ctx.beginPath(); sky.bolt.points.forEach(([x, y], index) => index ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.stroke(); ctx.restore();
    } else sky.bolt = null;
  }

  // ---- Shared loop --------------------------------------------------------
  let raf = 0, last = 0, lowPower = false;
  const frozen = () => reduced.matches || lowPower;
  function loop(now) {
    raf = 0;
    const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016); last = now;
    const seconds = now / 1000; let active = false;
    for (const sky of skies) {
      if (!sky.root.isConnected) { sky.observer.disconnect(); skies.delete(sky); continue; }
      if (!sky.w || !sky.h || !sky.model) continue;
      if (frozen()) {
        if (sky.still) continue;
        sky.still = true; paintBack(sky, seconds, now); paintFront(sky, seconds, 0, now); continue;
      }
      sky.still = false;
      const front = paintFront(sky, seconds, dt, now);
      // Stars twinkle slowly: ~15 fps is smooth; a shooting star gets full rate.
      const stars = starVisibility(sky.model) > 0;
      const interval = sky.shooting ? 0 : front ? 33 : 66;
      if (!stars || now - sky.lastBack >= interval) { paintBack(sky, seconds, now); sky.lastBack = now; }
      active = active || front || stars;
    }
    if (active && !document.hidden) raf = requestAnimationFrame(loop); else last = 0;
  }
  function schedule() { if (!raf) raf = requestAnimationFrame(loop); }
  document.addEventListener('visibilitychange', schedule);
  reduced.addEventListener?.('change', () => { for (const sky of skies) sky.still = false; schedule(); });
  function setLowPower(value) {
    if ((value === true) === lowPower) return;
    lowPower = value === true; for (const sky of skies) sky.still = false; schedule();
  }
  window.EdgeWeatherSky = Object.freeze({ create, update, setLowPower, scenes: Object.freeze(Object.keys(SCENES)) });
})();
