'use strict';
// Lets Claude Code permission requests be answered on the dashboard. A Claude
// Code hook script posts each request to this loopback server and waits; the
// dashboard shows it and sends Allow or Deny back. A request that is not
// answered in time resolves to "no decision", so Claude Code falls back to its
// own prompt: nothing is ever approved by default.
//
// Both sides prove themselves with an HMAC of the request under the per-launch
// secret: the hook to the broker, and the broker's answer to the hook, so a
// stale connection file can never let another program answer.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, randomUUID, timingSafeEqual, createHmac, createHash } = require('node:crypto');

const BODY_LIMIT = 256 * 1024;
const MAX_PENDING = 20;
// Tools that need the person's own answer (Claude Code ignores a hook "allow"
// for them), so they never come to the dashboard.
const PERSON_TOOLS = new Set(['AskUserQuestion', 'ShowOnboardingRolePicker', 'OfferChromeSetup', 'PublishPlugin']);

// Control characters become spaces; invisible format characters (including
// bidi overrides that could make a command read differently) become visible.
function text(value, limit) {
  return String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
    .replace(/\p{Cf}/gu, character => `\\u{${character.codePointAt(0).toString(16)}}`).slice(0, limit);
}
// The whole value, or null when it is too long to show: never a silent cut.
function whole(value, limit) { const shown = text(value, Infinity); return shown.length <= limit ? shown : null; }
function everything(value) { return whole(JSON.stringify(value ?? {}, null, 1), 4000); }
// What the user needs to see to decide. complete=false means the request
// cannot be shown in full, so it is left to Claude Code's own prompt.
function describe(tool, input) {
  const value = input && typeof input === 'object' ? input : {};
  const name = text(tool, 120) || 'a tool';
  const result = (action, detail, note = '') => ({ action, detail: detail ?? '', note, complete: detail !== null });
  if (/^(?:Bash|PowerShell)$/.test(name)) return result('run a command', whole(value.command, 4000), text(value.description, 300));
  if (name === 'Read') return result('read a file', whole(value.file_path, 1000));
  if (name === 'WebFetch' || name === 'WebSearch') return result(name === 'WebSearch' ? 'search the web' : 'open a web page', whole(value.url || value.query, 1000));
  const all = everything(value);
  if (name === 'Write') return result('create a file', all === null ? null : `${text(value.file_path, 1000)}\n\n${all}`);
  if (/^(?:Edit|MultiEdit|NotebookEdit)$/.test(name)) return result('edit a file', all === null ? null : `${text(value.file_path || value.notebook_path, 1000)}\n\n${all}`);
  const mcp = /^mcp__(.+?)__(.+)$/.exec(name);
  if (mcp) return result(`use ${text(mcp[1], 80)}`, all === null ? null : `${text(mcp[2], 200)}\n${all}`);
  return result(`use ${name}`, all);
}
function equal(a, b) { const left = Buffer.from(String(a || '')), right = Buffer.from(String(b || '')); return left.length === right.length && timingSafeEqual(left, right); }
function digestOf(bytes) { return createHash('sha256').update(bytes).digest('base64url'); }

function createApprovalBroker({ directory, onChange = () => {}, waitMs = 55000, now = Date.now }) {
  const file = path.join(directory, 'agent-approvals.json');
  const pending = new Map();
  let server = null, token = '', host = '';
  const sign = message => createHmac('sha256', token).update(message).digest('base64url');
  function publicList() {
    return [...pending.values()].sort((a, b) => a.createdAt - b.createdAt)
      .map(({ respond, timer, transcript, toolInput, ...item }) => ({ ...item, remainingMs: Math.max(0, item.expiresAt - now()) }));
  }
  function settle(id, decision, message) {
    const item = pending.get(id); if (!item) return false;
    pending.delete(id); clearTimeout(item.timer); item.respond({ decision, message }); onChange();
    return true;
  }
  function readRaw(request) {
    return new Promise((resolve, reject) => {
      let size = 0; const chunks = [];
      request.on('data', chunk => { size += chunk.length; if (size > BODY_LIMIT) { reject(new Error('Too large')); request.destroy(); } else chunks.push(chunk); });
      request.on('end', () => resolve(Buffer.concat(chunks)));
      request.on('error', reject);
    });
  }
  async function handle(request, response) {
    const reply = (status, body) => { if (!response.writableEnded) { response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(body)); } };
    // Only the hook, holding the per-launch secret, can submit requests. A page
    // cannot send these headers without a CORS preflight, which is never
    // answered, and the Host check stops DNS rebinding.
    const nonce = String(request.headers['x-edge-deck-nonce'] || '');
    if (request.method !== 'POST' || request.url !== '/permission-request' || request.headers.host !== host ||
        !/^application\/json\b/i.test(request.headers['content-type'] || '') || !/^[A-Za-z0-9_-]{16,64}$/.test(nonce)) { request.resume(); reply(404, {}); return; }
    let raw; try { raw = await readRaw(request); } catch { reply(400, {}); return; }
    const digest = digestOf(raw);
    if (!equal(request.headers['x-edge-deck-proof'], sign(`hook\n${nonce}\n${digest}`))) { reply(404, {}); return; }
    let input; try { input = JSON.parse(raw.toString('utf8')); } catch { reply(400, {}); return; }
    // Every answer carries the broker's proof for this exact request.
    const answer = ({ decision, message }) => reply(200, { decision, message, proof: sign(`broker\n${nonce}\n${digest}\n${decision ?? ''}\n${message ?? ''}`) });
    if (!input || typeof input !== 'object' || PERSON_TOOLS.has(input.tool_name) || pending.size >= MAX_PENDING) { answer({ decision: null, message: '' }); return; }
    const info = describe(input.tool_name, input.tool_input);
    if (!info.complete) { answer({ decision: null, message: '' }); return; }
    // The answer is written as soon as the request settles (decision, timeout or shutdown).
    const id = randomUUID();
    const item = { id, agent: 'Claude Code', tool: text(input.tool_name, 120), action: info.action, detail: info.detail, note: info.note,
      project: text(path.basename(String(input.cwd || '')), 80), session: text(input.session_id, 80), createdAt: now(), expiresAt: now() + waitMs,
      transcript: typeof input.transcript_path === 'string' ? input.transcript_path.slice(0, 1000) : '', toolInput: input.tool_input, respond: answer };
    item.timer = setTimeout(() => settle(id, null, ''), waitMs);
    pending.set(id, item); onChange();
    // If Claude Code gives up (the hook was cancelled), drop the request.
    response.on('close', () => { if (pending.has(id)) settle(id, null, ''); });
  }
  return {
    async start() {
      if (server) return;
      token = randomBytes(32).toString('base64url');
      server = http.createServer({ maxHeaderSize: 8192 }, (request, response) => { handle(request, response).catch(() => { if (!response.writableEnded) { response.writeHead(500); response.end(); } }); });
      server.headersTimeout = 5000; server.requestTimeout = 0; server.keepAliveTimeout = 1000;
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); }); });
      host = `127.0.0.1:${server.address().port}`;
      fs.mkdirSync(directory, { recursive: true });
      const temporary = file + '.tmp';
      fs.writeFileSync(temporary, JSON.stringify({ port: server.address().port, token, pid: process.pid }), { mode: 0o600 });
      fs.renameSync(temporary, file);
    },
    list: publicList,
    // Internal view (with transcript and tool input) for reconciling with logs.
    pending: () => [...pending.values()].map(({ respond, timer, ...item }) => item),
    // Claude Code moved on (answered in its own window): drop the request.
    dismiss: id => settle(id, null, ''),
    decide(id, decision) {
      if (typeof id !== 'string' || !['allow', 'deny'].includes(decision)) throw new Error('Choose Allow or Deny.');
      if (!settle(id, decision, decision === 'deny' ? 'Denied from Edge Deck.' : '')) throw new Error('This request was already answered or has expired.');
      return publicList();
    },
    close() {
      for (const id of [...pending.keys()]) settle(id, null, '');
      try { const saved = JSON.parse(fs.readFileSync(file, 'utf8')); if (saved.token === token) fs.unlinkSync(file); } catch { /* already gone */ }
      // Let the answers just written reach their hooks, then drop what remains.
      const closing = server; server = null;
      if (closing) { closing.close(); setTimeout(() => closing.closeAllConnections?.(), 1000).unref(); }
    },
  };
}

module.exports = { createApprovalBroker, describe, PERSON_TOOLS };
