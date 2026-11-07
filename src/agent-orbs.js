(() => {
  'use strict';
  // Thinking orbs for agent activity, drawn with the vendored thinking-orbs
  // engine (src/vendor). Orbs share one clock and one animation loop, so a
  // re-rendered list continues in phase instead of restarting.
  const engine = window.ThinkingOrbsEngine;
  const orbs = new Set();
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  // What the agent is doing -> which orb animation expresses it. Each
  // activity has its own orb; thinking and anything unrecognised use 'working'.
  const states = [
    [/waiting for your (?:reply|approval)/i, 'breathing'], // calm ring: your turn
    [/search|brows/i, 'searching'],                // globe scan: the web
    [/creating files/i, 'shaping'],                // outline forms new shapes
    [/editing files|updating files/i, 'composing'],// flowing bands: writing
    [/running commands/i, 'solving'],              // bands scramble and solve
    [/reading/i, 'listening'],                     // waveform: taking it in
    [/integration/i, 'connecting'],                // constellation wiring up
    [/coordinating|in the background/i, 'weaving'],// strands: several agents or background work
  ];
  // Brand colours: Claude's terracotta and OpenAI green for Codex.
  const tints = { claude: { r: 217, g: 119, b: 87 }, codex: { r: 16, g: 163, b: 127 }, chatgpt: { r: 167, g: 139, b: 250 } };
  const SIZES = new Set([64, 32, 20]);
  function stateFor(activity) {
    for (const [pattern, state] of states) if (pattern.test(activity || '')) return state;
    return 'working';
  }
  // Orbs show that an agent is alive, so low power slows them (8 fps) rather
  // than freezing them: a still orb reads as a stuck agent. Only reduced
  // motion shows a single representative frame.
  let raf = 0, timer = 0, lowPower = false;
  const frozen = () => reduced.matches;
  const interval = () => lowPower ? 125 : 33;
  function draw(orb, seconds) {
    const { ctx, size, dpr, preset } = orb;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    engine.paintFrame(ctx, engine.MODE_FRAMES[preset.mode](size, seconds * preset.speed, preset.opts), true, orb.tint);
  }
  function frame(now) {
    raf = 0;
    const still = frozen();
    for (const orb of orbs) {
      if (!orb.canvas.isConnected) { orbs.delete(orb); continue; }
      if (orb.canvas.offsetParent === null || (still && orb.drawn)) continue;
      // An orb that fails to draw keeps its last frame and is retried a few
      // times before it is let go; the others go on either way.
      try { draw(orb, still ? 2.4 : now / 1000); orb.drawn = true; orb.failures = 0; } catch { if (++orb.failures >= 3) orbs.delete(orb); }
    }
    // A timer paces the frames, so the page is not woken on every refresh.
    if (orbs.size && !still && !document.hidden) timer = setTimeout(() => { timer = 0; raf = requestAnimationFrame(frame); }, interval());
  }
  function schedule() { if (!raf && !timer && orbs.size) raf = requestAnimationFrame(frame); }
  function create({ activity = '', agent = '', size = 64 } = {}) {
    if (!engine) return null;
    const pixels = SIZES.has(size) ? size : 64;
    const state = stateFor(activity);
    const canvas = document.createElement('canvas'); canvas.className = 'agent-orb';
    canvas.dataset.state = state; canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', activity || 'Working');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(pixels * dpr); canvas.height = Math.round(pixels * dpr);
    canvas.style.width = canvas.style.height = `${pixels}px`;
    // CPU-backed: hundreds of tiny dots draw faster in software than as GPU paths.
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    const born = performance.now();
    const orb = { canvas, ctx, size: pixels, dpr, preset: engine.resolvePreset(state, pixels), tint: tints[agent], drawn: true, failures: 0, born };
    // Paint the current phase now, so a re-rendered list never flashes empty.
    // If even that fails, the caller shows its CSS animation instead.
    try { draw(orb, frozen() ? 2.4 : born / 1000); } catch { return null; }
    // Rows replaced while the page was hidden (no frames run then) are let go
    // here. New rows are attached right after they are built, so only orbs
    // detached for a while are removed.
    for (const old of orbs) if (!old.canvas.isConnected && born - old.born > 2000) orbs.delete(old);
    orbs.add(orb); schedule();
    return canvas;
  }
  document.addEventListener('visibilitychange', schedule);
  reduced.addEventListener?.('change', () => { for (const orb of orbs) orb.drawn = false; schedule(); });
  function setLowPower(value) {
    if ((value === true) === lowPower) return;
    lowPower = value === true; for (const orb of orbs) orb.drawn = false; schedule();
  }
  window.EdgeAgentOrbs = Object.freeze({ create, stateFor, setLowPower });
})();
