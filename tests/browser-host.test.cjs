'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { createBrowserHost } = require('../lib/browser-host.cjs');

function request(url, { method = 'POST', headers = {}, body = '', chunks } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method, headers }, response => {
      let data = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { data += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, data }));
    });
    req.on('error', reject);
    if (chunks) { for (const chunk of chunks) req.write(chunk); req.end(); }
    else req.end(body);
  });
}

test('local browser host rejects unauthorized requests and serves only frontend resources', async t => {
  const calls = [];
  const host = await createBrowserHost({ root: path.resolve(__dirname, '..'), handle: async (operation, args) => {
    calls.push({ operation, args });
    if (operation === 'app:open') throw Object.assign(new Error('Cannot open C:\\Users\\Private\\secret.exe'), { code: 'ENOENT' });
    return { connected: true };
  } });
  t.after(() => host.close());
  const entry = new URL(host.url);
  const token = new URLSearchParams(entry.hash.slice(1)).get('edge-token');
  assert.equal(entry.hostname, '127.0.0.1');
  assert.ok(token.length >= 40);
  assert.equal(entry.search, '');
  const api = `${entry.origin}/api`;
  const headers = { Origin: entry.origin, 'X-Edge-Token': token, 'Content-Type': 'application/json' };
  const body = JSON.stringify({ operation: 'state:get', args: [] });

  await t.test('authorized request reaches the dispatcher', async () => {
    const response = await request(api, { headers, body });
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(response.data), { ok: true, result: { connected: true } });
    assert.equal(calls.length, 1);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.match(response.headers['content-security-policy'], /frame-ancestors 'none'/);
    assert.equal(response.headers['access-control-allow-origin'], undefined);
  });
  await t.test('wrong or missing token is rejected', async () => {
    for (const candidate of ['', 'incorrect']) {
      const response = await request(api, { headers: { ...headers, 'X-Edge-Token': candidate }, body });
      assert.equal(response.status, 401);
    }
    assert.equal(calls.length, 1);
  });
  await t.test('foreign, null and missing origins are rejected', async () => {
    for (const candidate of ['https://example.com', 'null', '']) {
      const response = await request(api, { headers: { ...headers, Origin: candidate }, body });
      assert.equal(response.status, 403);
    }
  });
  await t.test('spoofed Host is rejected', async () => {
    const response = await request(api, { headers: { ...headers, Host: 'localhost' }, body });
    assert.equal(response.status, 421);
  });
  await t.test('unknown operation and invalid args are rejected', async () => {
    for (const value of [{ operation: 'shell:execute', args: [] }, { operation: 'state:get', args: {} }]) {
      const response = await request(api, { headers, body: JSON.stringify(value) });
      assert.equal(response.status, 400);
    }
  });
  await t.test('fixed and chunked oversized bodies are rejected', async () => {
    const large = 'x'.repeat(131073);
    const fixed = await request(api, { headers: { ...headers, 'Content-Length': Buffer.byteLength(large) }, body: large });
    assert.equal(fixed.status, 413);
    const chunked = await request(api, { headers, chunks: ['x'.repeat(70000), 'x'.repeat(70000)] });
    assert.equal(chunked.status, 413);
  });
  await t.test('only explicit static resources are served', async () => {
    const page = await request(`${entry.origin}/index.html`, { method: 'GET' });
    assert.equal(page.status, 200);
    assert.match(page.headers['content-type'], /text\/html/);
    assert.match(page.headers['content-security-policy'], /frame-src https:/);
    for(const asset of ['cards.css','layout-ui.css','apple-ui.css','layout-ui.js','layout-engine.js','card-drag.js']){
      assert.equal((await request(`${entry.origin}/${asset}`,{method:'GET'})).status,200,asset+' is explicitly served');
    }
    for (const route of ['/main.cjs', '/lib/config.cjs', '/..%2fmain.cjs', '/index.html?other=1']) {
      const response = await request(`${entry.origin}${route}`, { method: 'GET' });
      assert.equal(response.status, 404);
    }
    assert.equal((await request(api, { method: 'GET' })).status, 405);
    assert.equal((await request(api, { method: 'OPTIONS', headers })).status, 405);
  });
  await t.test('host errors do not expose absolute paths', async () => {
    const response = await request(api, { headers, body: JSON.stringify({ operation: 'app:open', args: ['test'] }) });
    assert.equal(response.status, 400);
    assert.doesNotMatch(response.data, /Private|secret\.exe|C:/);
  });
});
