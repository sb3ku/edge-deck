'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { createApprovalBroker } = require('../lib/agent-approvals.cjs');

const HOOK = path.join(__dirname, '..', 'scripts', 'claude-permission-hook.cjs');
const input = { session_id: 's1', cwd: 'C:\\work\\demo', transcript_path: 'C:\\t.jsonl', hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'npm test' } };
function runHook(appdata, payload = input) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [HOOK], { env: { ...process.env, APPDATA: appdata }, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = ''; child.stdout.on('data', chunk => { out += chunk; });
    child.on('close', code => resolve({ code, out }));
    child.stdin.end(JSON.stringify(payload));
  });
}
const until = async check => { for (let i = 0; i < 300 && !check(); i++) await new Promise(resolve => setTimeout(resolve, 10)); };
function appdataDir(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-deck-hook-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; }

test('the hook returns the dashboard decision in Claude Code format', async t => {
  const appdata = appdataDir(t);
  const broker = createApprovalBroker({ directory: path.join(appdata, 'Edge Deck') });
  await broker.start(); t.after(() => broker.close());
  const allowed = runHook(appdata);
  await until(() => broker.list().length === 1);
  assert.equal(broker.list()[0].detail, 'npm test');
  assert.equal(broker.pending()[0].transcript, 'C:\\t.jsonl', 'The transcript path is forwarded');
  broker.decide(broker.list()[0].id, 'allow');
  const result = await allowed;
  assert.equal(result.code, 0);
  assert.deepEqual(JSON.parse(result.out), { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } } });
  const denied = runHook(appdata); await until(() => broker.list().length === 1);
  broker.decide(broker.list()[0].id, 'deny');
  assert.deepEqual(JSON.parse((await denied).out).hookSpecificOutput.decision, { behavior: 'deny', message: 'Denied from Edge Deck.', interrupt: false });
});

test('an answer without the broker\'s proof is ignored', async t => {
  const appdata = appdataDir(t);
  // Something else listening on a port from a stale connection file.
  const impostor = http.createServer((request, response) => { request.resume(); response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ decision: 'allow', message: '' })); });
  await new Promise(resolve => impostor.listen(0, '127.0.0.1', resolve)); t.after(() => impostor.close());
  fs.mkdirSync(path.join(appdata, 'Edge Deck'));
  fs.writeFileSync(path.join(appdata, 'Edge Deck', 'agent-approvals.json'), JSON.stringify({ port: impostor.address().port, token: 'x'.repeat(43), pid: process.pid }));
  assert.deepEqual(await runHook(appdata), { code: 0, out: '' });
});

test('without a running Edge Deck, or for questions, the hook makes no decision', async t => {
  const appdata = appdataDir(t);
  assert.deepEqual(await runHook(appdata), { code: 0, out: '' }, 'No connection file');
  fs.mkdirSync(path.join(appdata, 'Edge Deck'));
  fs.writeFileSync(path.join(appdata, 'Edge Deck', 'agent-approvals.json'), JSON.stringify({ port: 9, token: 'x'.repeat(43), pid: 2147483646 }));
  assert.deepEqual(await runHook(appdata), { code: 0, out: '' }, 'Stale file from a closed Edge Deck');
  assert.deepEqual(await runHook(appdata, { hook_event_name: 'PreToolUse' }), { code: 0, out: '' }, 'Other events are ignored');
  const broker = createApprovalBroker({ directory: path.join(appdata, 'Edge Deck') });
  await broker.start(); t.after(() => broker.close());
  assert.deepEqual(await runHook(appdata, { ...input, tool_name: 'AskUserQuestion', tool_input: { questions: [] } }), { code: 0, out: '' });
  assert.equal(broker.list().length, 0, 'Questions never reach the dashboard');
});
