'use strict';
// Claude plan usage: how much of the 5-hour session and the weekly limits is
// used, read the way Claude Code's own /usage reads it, from Anthropic's usage
// endpoint with the Claude Code sign-in stored on this PC
// (~/.claude/.credentials.json). The token is read here, sent only to
// Anthropic, never logged or shown. When it has expired it is renewed the way
// Claude Code renews it (the Claude desktop app keeps its own sign-in and
// leaves this one to expire), and the renewed sign-in is written back to the
// same file so Claude Code keeps working with it.
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
// Claude Code's own renewal endpoint and public client id.
const TOKEN_URL = 'https://platform.claude.com/v1/oauth/token';
const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const WINDOWS = [['five_hour', 'session', '5-hour'], ['seven_day', 'weekly', 'Weekly'], ['seven_day_sonnet', 'weekly-sonnet', 'Weekly · Sonnet'], ['seven_day_opus', 'weekly-opus', 'Weekly · Opus']];
const PLANS = { max: 'Max', pro: 'Pro', team: 'Team', enterprise: 'Enterprise', free: 'Free' };
const HELP = {
  absent: 'Sign in to Claude Code in a terminal (claude, then /login) to show your plan usage here.',
  scope: 'This Claude Code sign-in cannot read usage. Sign in again with /login in a terminal.',
  expired: 'The Claude Code sign-in has expired and could not be renewed yet. Edge Deck keeps trying.',
  signin: 'The Claude Code sign-in has ended. Sign in to Claude Code again (/login) to show your plan usage here.',
  rejected: 'Anthropic did not accept the Claude Code sign-in for usage. Sign in again with /login in a terminal.',
  limited: 'Anthropic is limiting usage checks. Trying again later.',
  unavailable: 'Claude usage is unavailable right now.',
};
const clamp = value => Math.max(0, Math.min(100, value));
const isoOf = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;

function createClaudeUsage({ home = os.homedir(), fetch = globalThis.fetch, now = Date.now, interval = 300000 } = {}) {
  let enabled = true, timer = null, flight = null, retryAt = 0;
  // A renewal Anthropic refused is not repeated with the same sign-in for ten minutes.
  let refused = { refresh: null, until: 0 };
  // A renewed token that could not be saved still serves until it expires.
  let held = null;
  let snapshot = { enabled: true, signedIn: false, plan: null, windows: null, updatedAt: null, checkedAt: null, error: null };
  const file = path.join(home, '.claude', '.credentials.json');

  // The sign-in Claude Code keeps on this PC, if any. The token itself leaves
  // this function only as the request header.
  async function credentials() {
    let data;
    try { data = JSON.parse(await fs.readFile(file, 'utf8')); } catch { return { status: 'absent' }; }
    const oauth = data?.claudeAiOauth;
    if (!oauth || typeof oauth !== 'object' || typeof oauth.accessToken !== 'string' || !oauth.accessToken) return { status: 'absent' };
    const plan = PLANS[String(oauth.subscriptionType || '').toLowerCase()] || null;
    const scopes = Array.isArray(oauth.scopes) ? oauth.scopes.map(String) : String(oauth.scopes || '').split(/\s+/);
    if (!scopes.includes('user:profile')) return { status: 'scope', plan };
    if (Number.isFinite(oauth.expiresAt) && oauth.expiresAt <= now()) {
      if (held && held.expiresAt > now()) return { status: 'ok', plan, token: held.token };
      return { status: 'expired', plan, scopes, refresh: typeof oauth.refreshToken === 'string' && oauth.refreshToken ? oauth.refreshToken : null };
    }
    return { status: 'ok', plan, token: oauth.accessToken };
  }
  // Renews an expired sign-in with its refresh token and saves the result.
  // Returns 'ok', 'signin' (Anthropic refused it) or 'expired' (try again later).
  async function renew(found) {
    if (refused.refresh === found.refresh && now() < refused.until) return 'signin';
    let response;
    try {
      response = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: found.refresh, client_id: CLIENT_ID, scope: found.scopes.filter(Boolean).join(' ') }), redirect: 'error', signal: AbortSignal.timeout(15000) });
    } catch { return 'expired'; }
    if (response.status === 400 || response.status === 401 || response.status === 403) { refused = { refresh: found.refresh, until: now() + 600000 }; return 'signin'; }
    if (!response.ok) return 'expired';
    let body;
    try { const text = await response.text(); if (text.length > 65536) throw Error('too long'); body = JSON.parse(text); } catch { return 'expired'; }
    const seconds = Number(body?.expires_in);
    if (typeof body?.access_token !== 'string' || !body.access_token || !(seconds > 0)) return 'expired';
    const expiresAt = now() + seconds * 1000;
    held = { token: body.access_token, expiresAt };
    // Saved into the file as it is now, so nothing written meanwhile is lost.
    let data = null;
    try { data = JSON.parse(await fs.readFile(file, 'utf8')); } catch {}
    const oauth = data?.claudeAiOauth;
    // Someone signed in or renewed meanwhile: theirs stands.
    if (!oauth || typeof oauth !== 'object' || oauth.refreshToken !== found.refresh) return 'ok';
    const life = Number(body.refresh_token_expires_in);
    data.claudeAiOauth = { ...oauth, accessToken: body.access_token, expiresAt,
      ...(typeof body.refresh_token === 'string' && body.refresh_token ? { refreshToken: body.refresh_token } : {}),
      ...(life > 0 ? { refreshTokenExpiresAt: now() + life * 1000 } : {}),
      ...(typeof body.scope === 'string' && body.scope.trim() ? { scopes: body.scope.trim().split(/\s+/) } : {}) };
    const text = JSON.stringify(data), temp = `${file}.edge-deck-${process.pid}.tmp`;
    try { await fs.writeFile(temp, text, { mode: 0o600 }); await fs.rename(temp, file); }
    catch { try { await fs.writeFile(file, text, { mode: 0o600 }); } catch {} await fs.rm(temp, { force: true }).catch(() => {}); }
    return 'ok';
  }
  function windowsOf(data) {
    const windows = [];
    for (const [key, id, label] of WINDOWS) {
      const window = data?.[key]; if (!window || typeof window !== 'object') continue;
      const value = Number(window.utilization); if (!Number.isFinite(value)) continue;
      windows.push({ id, label, usedPercent: clamp(value), resetsAt: isoOf(window.resets_at) });
    }
    return windows;
  }
  async function read() {
    let found = await credentials();
    if (found.status === 'expired' && found.refresh) {
      const result = await renew(found);
      found = result === 'ok' ? await credentials() : { status: result, plan: found.plan };
    }
    const base = { ...snapshot, enabled, checkedAt: new Date(now()).toISOString(), plan: found.plan ?? snapshot.plan };
    if (found.status !== 'ok') { snapshot = { ...base, signedIn: false, windows: null, updatedAt: null, error: HELP[found.status] || HELP.absent }; return snapshot; }
    if (now() < retryAt) { snapshot = { ...base, signedIn: true, error: HELP.limited }; return snapshot; }
    let response;
    try {
      response = await fetch(USAGE_URL, { headers: { Authorization: `Bearer ${found.token}`, 'anthropic-beta': 'oauth-2025-04-20', Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(10000) });
    } catch { snapshot = { ...base, signedIn: true, error: HELP.unavailable }; return snapshot; }
    if (response.status === 429) {
      const seconds = Number(response.headers?.get?.('retry-after'));
      retryAt = now() + Math.max(Number.isFinite(seconds) && seconds > 0 ? seconds : 0, 900) * 1000;
      snapshot = { ...base, signedIn: true, error: HELP.limited }; return snapshot;
    }
    if (response.status === 401 || response.status === 403) { snapshot = { ...base, signedIn: true, windows: null, updatedAt: null, error: HELP.rejected }; return snapshot; }
    if (!response.ok) { snapshot = { ...base, signedIn: true, error: HELP.unavailable }; return snapshot; }
    let data;
    try { const text = await response.text(); if (text.length > 65536) throw Error('too long'); data = JSON.parse(text); } catch { snapshot = { ...base, signedIn: true, error: HELP.unavailable }; return snapshot; }
    const windows = windowsOf(data);
    snapshot = { ...base, signedIn: true, windows: windows.length ? windows : (snapshot.windows || []), updatedAt: windows.length ? base.checkedAt : snapshot.updatedAt, error: windows.length ? null : HELP.unavailable };
    return snapshot;
  }
  return {
    // Callers asking at the same time share one read.
    refresh() { if (!enabled) return Promise.resolve(snapshot); if (!flight) flight = read().finally(() => { flight = null; }); return flight; },
    state() { return snapshot; },
    setEnabled(value) {
      enabled = value !== false;
      snapshot = { ...snapshot, enabled };
      if (!enabled) snapshot = { ...snapshot, windows: null, updatedAt: null, error: null, signedIn: false };
      else void this.refresh();
    },
    start() { if (timer) return; timer = setInterval(() => { void this.refresh(); }, interval); timer.unref?.(); void this.refresh(); },
    close() { clearInterval(timer); timer = null; },
  };
}

module.exports = { createClaudeUsage, USAGE_URL, TOKEN_URL };
