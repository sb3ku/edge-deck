#!/usr/bin/env node
'use strict';
// Claude Code PermissionRequest hook: shows the request on Edge Deck and
// returns the user's Allow or Deny. Any problem (Edge Deck closed, no answer
// in time, an unverified reply, an error) returns no decision, so Claude Code
// asks in its own window instead. It never approves anything by itself.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { randomBytes, createHmac, createHash, timingSafeEqual } = require('node:crypto');

const WAIT_MS = 55000; // the hook is registered with a 60 s timeout
const STDIN_LIMIT = 1024 * 1024;
// Tools that need the person's own answer: Claude Code shows its own UI for them.
const PERSON_TOOLS = new Set(['AskUserQuestion', 'ShowOnboardingRolePicker', 'OfferChromeSetup', 'PublishPlugin']);

function readInput() {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    process.stdin.on('data', chunk => { size += chunk.length; if (size > STDIN_LIMIT) reject(new Error('Too large')); else chunks.push(chunk); });
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    process.stdin.on('error', reject);
  });
}
function connection() {
  const file = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Edge Deck', 'agent-approvals.json');
  // A file from before the last restart belongs to an Edge Deck that is gone.
  if (fs.statSync(file).mtimeMs < Date.now() - os.uptime() * 1000) throw new Error('Edge Deck is not running.');
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Number.isInteger(saved.port) || typeof saved.token !== 'string' || saved.token.length < 32) throw new Error('Edge Deck is not running.');
  try { process.kill(saved.pid, 0); } catch { throw new Error('Edge Deck is not running.'); }
  return saved;
}
const sign = (token, message) => createHmac('sha256', token).update(message).digest('base64url');
function same(a, b) { const left = Buffer.from(String(a || '')), right = Buffer.from(String(b || '')); return left.length === right.length && timingSafeEqual(left, right); }
function ask({ port, token }, request) {
  return new Promise(resolve => {
    const body = Buffer.from(JSON.stringify(request));
    const nonce = randomBytes(16).toString('base64url');
    const digest = createHash('sha256').update(body).digest('base64url');
    const call = http.request({ host: '127.0.0.1', port, path: '/permission-request', method: 'POST', timeout: WAIT_MS,
      headers: { 'Content-Type': 'application/json', 'Content-Length': body.length, 'X-Edge-Deck-Nonce': nonce, 'X-Edge-Deck-Proof': sign(token, `hook\n${nonce}\n${digest}`) } }, response => {
      let data = ''; response.setEncoding('utf8');
      response.on('data', chunk => { if (data.length < 65536) data += chunk; });
      response.on('end', () => {
        try {
          const answer = JSON.parse(data);
          const decision = answer.decision ?? '', message = answer.message ?? '';
          // Only an answer signed by the Edge Deck that issued the secret counts.
          if (response.statusCode !== 200 || !same(answer.proof, sign(token, `broker\n${nonce}\n${digest}\n${decision}\n${message}`))) { resolve({ decision: null }); return; }
          resolve({ decision: answer.decision, message: answer.message });
        } catch { resolve({ decision: null }); }
      });
    });
    call.on('timeout', () => { call.destroy(); resolve({ decision: null }); });
    call.on('error', () => resolve({ decision: null }));
    call.end(body);
  });
}
// The answer in Claude Code's PermissionRequest hook format.
function hookOutput(decision, message) {
  const result = decision === 'deny' ? { behavior: 'deny', message: message || 'Denied from Edge Deck.', interrupt: false } : { behavior: 'allow' };
  return { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: result } };
}
async function main() {
  const input = JSON.parse(await readInput());
  if (!input || typeof input !== 'object' || (input.hook_event_name && input.hook_event_name !== 'PermissionRequest') || PERSON_TOOLS.has(input.tool_name)) return;
  const answer = await ask(connection(), { session_id: input.session_id, cwd: input.cwd, transcript_path: input.transcript_path,
    hook_event_name: input.hook_event_name, tool_name: input.tool_name, tool_input: input.tool_input });
  if (answer && (answer.decision === 'allow' || answer.decision === 'deny')) process.stdout.write(JSON.stringify(hookOutput(answer.decision, answer.message)));
}
// Exit normally once the answer is written (process.exit could cut off stdout);
// always exit 0, so a failure never blocks or denies the tool call.
if (require.main === module) main().catch(() => {}).finally(() => { process.exitCode = 0; });
module.exports = { hookOutput };
