'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createBambuCloud, maskEmail } = require('../lib/bambu-cloud.cjs');

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('cover')]);
function fakeBambu(routes) {
  const calls = [];
  const fetch = async (url, options = {}) => {
    const href = String(url), body = options.body ? JSON.parse(options.body) : null;
    calls.push({ url: href, method: options.method || 'GET', body, auth: options.headers?.Authorization || null });
    const route = routes.find(([pattern]) => pattern.test(href));
    const result = route ? route[1]({ url: href, body }) : { status: 404, json: {} };
    return {
      ok: (result.status || 200) < 400, status: result.status || 200,
      headers: { get: name => name === 'content-length' && result.bytes ? String(result.bytes.length) : null },
      json: async () => result.json ?? {}, arrayBuffer: async () => result.bytes ?? Buffer.alloc(0),
    };
  };
  return { fetch, calls };
}
const memory = () => { let value = null; return { read: () => value, write: next => { value = next; }, get value() { return value; } }; };

test('sign-in with an emailed code keeps only the token, encrypted storage receives no password', async () => {
  const storage = memory();
  const { fetch, calls } = fakeBambu([
    [/user\/login$/, ({ body }) => body.password ? { json: { loginType: 'verifyCode' } } : body.code === '123456' ? { json: { accessToken: 'tok', refreshToken: 'ref', expiresIn: 7776000 } } : { json: { message: 'Code is incorrect' } }],
    [/sendemail\/code$/, () => ({ json: {} })],
  ]);
  const cloud = createBambuCloud({ storage, fetch });
  const first = await cloud.signIn({ account: 'seb@example.com', password: 'secret' });
  assert.equal(first.status, 'code'); assert.equal(cloud.state().awaiting, 'code');
  assert.deepEqual(calls[1].body, { email: 'seb@example.com', type: 'codeLogin' });
  await assert.rejects(cloud.verify({ code: '000000' }), /Code is incorrect/);
  assert.equal((await cloud.verify({ code: '123456' })).status, 'signed-in');
  assert.equal(cloud.state().connected, true); assert.equal(cloud.state().account, maskEmail('seb@example.com'));
  assert.equal(storage.value.accessToken, 'tok');
  assert.doesNotMatch(JSON.stringify(storage.value), /secret|seb@example/);
  cloud.signOut(); assert.equal(storage.value, null); assert.equal(cloud.state().connected, false);
});

test('bad input and refused passwords are reported without echoing secrets', async () => {
  const { fetch } = fakeBambu([[/user\/login$/, () => ({ json: { message: 'Incorrect password' } })]]);
  const cloud = createBambuCloud({ storage: memory(), fetch });
  await assert.rejects(cloud.signIn({ account: 'not-an-email', password: 'x' }), /email address/);
  await assert.rejects(cloud.signIn({ account: 'a@b.co', password: 'x' }), /did not accept that email and password/);
  await assert.rejects(cloud.verify({ code: '123456' }), /Start the sign-in again/);
});

test('the running job\'s cover is matched by name on this printer and fetched without the account header', async () => {
  const storage = memory(); storage.write({ accessToken: 'tok', account: 's•••@x.com', region: 'global' });
  const { fetch, calls } = fakeBambu([
    [/my\/tasks/, () => ({ json: { hits: [
      { deviceId: 'OTHER', title: 'RACK PRINT_Print x2 - Bottom Connector', cover: 'https://cdn.example/wrong.png', startTime: new Date().toISOString() },
      { deviceId: 'H2D1', title: 'Benchy', cover: 'https://cdn.example/benchy.png', startTime: new Date().toISOString() },
      { deviceId: 'H2D1', title: 'RACK PRINT_Print x2 - Bottom Connector', cover: 'https://cdn.example/rack.png', startTime: new Date(Date.now() - 3600000).toISOString() },
    ] } })],
    [/cdn\.example\/rack\.png/, () => ({ bytes: PNG })],
  ]);
  const cloud = createBambuCloud({ storage, fetch });
  const picture = await cloud.picture('H2D1', { name: 'RACK PRINT_Print x2 - Bottom Connector' });
  assert.deepEqual(picture.data, PNG); assert.equal(picture.type, 'image/png');
  assert.match(calls[0].url, /deviceId=H2D1/); assert.equal(calls[0].auth, 'Bearer tok');
  assert.equal(calls.at(-1).auth, null, 'the cover link gets no account token');
});

test('an expired sign-in is reported and non-image covers are refused', async () => {
  const storage = memory(); storage.write({ accessToken: 'tok', account: 'x', region: 'global' });
  const expired = createBambuCloud({ storage, fetch: fakeBambu([[/my\/tasks/, () => ({ status: 401 })]]).fetch });
  assert.equal(await expired.picture('S', { name: 'x' }), null); assert.match(expired.state().error, /expired/);
  const html = createBambuCloud({ storage, fetch: fakeBambu([
    [/my\/tasks/, () => ({ json: { hits: [{ deviceId: 'S', title: 'x', cover: 'https://cdn.example/a.png', startTime: new Date().toISOString() }] } })],
    [/cdn\.example/, () => ({ bytes: Buffer.from('<html>nope</html>') })]]).fetch });
  assert.equal(await html.picture('S', { name: 'x' }), null);
  const plain = createBambuCloud({ storage, fetch: fakeBambu([[/my\/tasks/, () => ({ json: { hits: [{ deviceId: 'S', title: 'x', cover: 'http://cdn.example/a.png', startTime: new Date().toISOString() }] } })]]).fetch });
  assert.equal(await plain.picture('S', { name: 'x' }), null, 'only HTTPS covers');
});

test('printer names come from the account by serial number and are cached', async () => {
  const storage = memory(); storage.write({ accessToken: 'tok', account: 'x', region: 'global' });
  let calls = 0;
  const { fetch } = fakeBambu([[/user\/bind$/, () => { calls++; return { json: { devices: [{ dev_id: '0948AB', name: ' Workshop H2D ' }, { dev_id: '01P00C', name: '' }, { name: 'no serial' }] } }; }]]);
  const cloud = createBambuCloud({ storage, fetch });
  const names = await cloud.printerNames();
  assert.deepEqual([...names], [['0948AB', 'Workshop H2D']]);
  await cloud.printerNames(); assert.equal(calls, 1, 'cached for ten minutes');
  assert.equal((await createBambuCloud({ storage: memory(), fetch }).printerNames()).size, 0, 'nothing without a sign-in');
});
