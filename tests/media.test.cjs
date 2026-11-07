'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createMediaBridge } = require('../lib/media.cjs');

test('media commands are validated before the Windows helper is involved', async () => {
  const media = createMediaBridge();
  try {
    await assert.rejects(media.command('shutdown'), /Unsupported/);
    for (const action of ['volume', 'spotify-volume']) {
      await assert.rejects(media.command(action, 101), /between 0 and 100/);
      await assert.rejects(media.command(action, '50'), /between 0 and 100/);
      await assert.rejects(media.command(action, Number.NaN), /between 0 and 100/);
    }
    await assert.rejects(media.command('audio-output', '../device'), /audio device/);
    await assert.rejects(media.command('mute-input', 'yes'), /mute/);
  } finally { media.close(); }
});
