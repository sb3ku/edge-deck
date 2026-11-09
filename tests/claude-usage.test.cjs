'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createClaudeUsage, USAGE_URL } = require('../lib/claude-usage.cjs');

const TOKEN = 'sk-ant-oat01-test-token-value';
function home(t, credentials) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-usage-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  if (credentials !== undefined) { fs.mkdirSync(path.join(dir, '.claude')); fs.writeFileSync(path.join(dir, '.claude', '.credentials.json'), JSON.stringify(credentials)); }
  return dir;
}
const signedIn = (extra = {}) => ({ claudeAiOauth: { accessToken: TOKEN, refreshToken: 'refresh-secret', expiresAt: 2000000000000, scopes: ['user:inference', 'user:profile'], subscriptionType: 'max', ...extra }, mcpOAuth: {} });
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

test('reads the session and weekly windows with the Claude Code sign-in, which never appears in the state', async t => {
  const calls = [];
  const usage = createClaudeUsage({ home: home(t, signedIn()), now: () => 1000000000000, fetch: async (url, options) => {
    calls.push({ url, options });
    return json({ five_hour: { utilization: 23.4, resets_at: '2026-11-09T15:00:00+00:00' }, seven_day: { utilization: 61, resets_at: '2026-11-13T09:00:00Z' }, seven_day_sonnet: null, extra_usage: { is_enabled: false } });
  } });
  const state = await usage.refresh();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, USAGE_URL);
  assert.equal(calls[0].options.headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(calls[0].options.headers['anthropic-beta'], 'oauth-2025-04-20');
  assert.equal(calls[0].options.redirect, 'error');
  assert.deepEqual(state.windows, [
    { id: 'session', label: '5-hour', usedPercent: 23.4, resetsAt: '2026-11-09T15:00:00.000Z' },
    { id: 'weekly', label: 'Weekly', usedPercent: 61, resetsAt: '2026-11-13T09:00:00.000Z' },
  ]);
  assert.equal(state.plan, 'Max');
  assert.equal(state.signedIn, true);
  assert.equal(state.error, null);
  assert.equal(state.updatedAt, '2001-09-09T01:46:40.000Z');
  assert.doesNotMatch(JSON.stringify(usage.state()), /oat01|refresh-secret/);
});

test('without a Claude Code sign-in nothing is fetched and the state says how to sign in', async t => {
  for (const credentials of [undefined, { mcpOAuth: { x: { accessToken: 'other' } } }]) {
    const usage = createClaudeUsage({ home: home(t, credentials), fetch: async () => { throw new Error('must not fetch'); } });
    const state = await usage.refresh();
    assert.equal(state.signedIn, false);
    assert.equal(state.windows, null);
    assert.match(state.error, /Sign in to Claude Code/);
  }
});

test('an expired sign-in or one without the profile scope is not sent', async t => {
  const expired = createClaudeUsage({ home: home(t, signedIn({ expiresAt: 5 })), now: () => 10, fetch: async () => { throw new Error('must not fetch'); } });
  assert.match((await expired.refresh()).error, /expired/);
  assert.equal((await expired.refresh()).plan, 'Max');
  const scoped = createClaudeUsage({ home: home(t, signedIn({ scopes: ['user:inference'] })), fetch: async () => { throw new Error('must not fetch'); } });
  assert.match((await scoped.refresh()).error, /cannot read usage/);
});

test('a rejected sign-in, a limit and an outage are reported without losing the last reading', async t => {
  let clock = 1000000000000, reply = () => json({ five_hour: { utilization: 10, resets_at: '2026-11-09T15:00:00Z' } });
  const calls = [];
  const usage = createClaudeUsage({ home: home(t, signedIn()), now: () => clock, fetch: async url => { calls.push(url); return reply(); } });
  assert.equal((await usage.refresh()).windows[0].usedPercent, 10);
  reply = () => new Response('', { status: 429, headers: { 'retry-after': '60' } });
  let state = await usage.refresh();
  assert.match(state.error, /limiting/);
  assert.equal(state.windows[0].usedPercent, 10, 'The last reading stays');
  clock += 600000; await usage.refresh();
  assert.equal(calls.length, 2, 'A limit holds for at least fifteen minutes');
  clock += 400000; reply = () => new Response('', { status: 500 });
  state = await usage.refresh();
  assert.equal(calls.length, 3);
  assert.match(state.error, /unavailable/);
  assert.equal(state.windows[0].usedPercent, 10);
  reply = () => new Response('', { status: 403 });
  state = await usage.refresh();
  assert.match(state.error, /did not accept/);
  assert.equal(state.windows, null);
});

test('turning the reading off clears it and makes no request', async t => {
  const usage = createClaudeUsage({ home: home(t, signedIn()), fetch: async () => json({ five_hour: { utilization: 5, resets_at: null } }) });
  await usage.refresh();
  usage.setEnabled(false);
  assert.deepEqual([usage.state().enabled, usage.state().windows], [false, null]);
  assert.equal((await usage.refresh()).windows, null);
});
