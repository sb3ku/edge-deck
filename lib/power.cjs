'use strict';
// Low-power mode stills decorative animation (sky, text shimmer) and slows the
// agent orbs, while data keeps refreshing. 'auto' applies it while the user is busy elsewhere:
// a game or other full-screen app in front, or the PC locked.
const POWER_MODES = new Set(['off', 'auto', 'on']);
const DEFAULT_POWER_MODE = 'auto';

function powerState(mode, presence) {
  const chosen = POWER_MODES.has(mode) ? mode : DEFAULT_POWER_MODE;
  const busy = presence === 'fullscreen' || presence === 'away';
  const active = chosen === 'on' || (chosen === 'auto' && busy);
  return { mode: chosen, active, reason: !active ? null : chosen === 'on' ? 'manual' : presence };
}

module.exports = { POWER_MODES, DEFAULT_POWER_MODE, powerState };
