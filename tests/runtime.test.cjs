'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { parseScreens, createSafeStorage } = require('../lib/runtime.cjs');

test('displays are shaped like Electron displays, with physical bounds kept apart', () => {
  const [main, edge] = parseScreens('\\\\.\\DISPLAY1\tGeneric PnP Monitor\t0\t0\t3840\t2160\t0\t0\t3840\t2100\t144\t1\n\\\\.\\DISPLAY3\tGeneric PnP Monitor\t504\t2160\t2560\t720\t504\t2160\t2560\t720\t96\t0');
  assert.equal(main.id, 1); assert.equal(main.primary, true); assert.equal(main.scaleFactor, 1.5);
  assert.deepEqual(main.size, { width: 2560, height: 1440 }); assert.deepEqual(main.nativeBounds, { x: 0, y: 0, width: 3840, height: 2160 });
  assert.equal(edge.id, 3); assert.deepEqual(edge.bounds, { x: 504, y: 2160, width: 2560, height: 720 });
});

test('credentials use Electron\'s safeStorage format, so settings saved before keep working', { skip: process.platform !== 'win32' }, t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-deck-runtime-')); t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const storage = createSafeStorage(() => folder);
  assert.equal(storage.isEncryptionAvailable(), true);
  const sealed = storage.encryptString('access-code');
  assert.equal(sealed.subarray(0, 3).toString(), 'v10');
  assert.equal(storage.decryptString(sealed), 'access-code');
  assert.match(JSON.parse(fs.readFileSync(path.join(folder, 'Local State'), 'utf8')).os_crypt.encrypted_key, /^RFBBUEk/, 'The key is stored DPAPI-protected, as Electron stores it');
  // A second instance reads the same key back.
  assert.equal(createSafeStorage(() => folder).decryptString(sealed), 'access-code');
  const tampered = Buffer.from(sealed); tampered[tampered.length - 1] ^= 1;
  assert.throws(() => storage.decryptString(tampered));
  assert.equal(crypto.getCiphers().includes('aes-256-gcm'), true);
});
