'use strict';

const { spawn } = require('node:child_process');
const { join } = require('node:path');
const { createInterface } = require('node:readline');

const ACTIONS = new Set(['play-pause', 'next', 'previous', 'volume', 'spotify-volume', 'audio-output', 'audio-input', 'mute-output', 'mute-input']);
// Windows endpoint IDs, e.g. {0.0.0.00000000}.{45032385-96ea-47e8-a4a2-121d0259aff9}
const DEVICE_ID = /^{[0-9.]{1,40}}.{[0-9a-f-]{36}}$/i;

function createMediaBridge() {
  let child = null;
  let sequence = 0;
  let closed = false;
  let stderr = '';
  const pending = new Map();

  function failPending(error) {
    for (const { reject, timer } of pending.values()) {
      clearTimeout(timer);
      reject(error);
    }
    pending.clear();
  }

  function start() {
    if (closed) throw new Error('Media bridge is closed.');
    if (process.platform !== 'win32') throw new Error('Windows media controls are available on Windows only.');
    if (child) return child;
    stderr = '';
    const executable = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const processHandle = spawn(executable, [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-MTA', '-ExecutionPolicy', 'Bypass',
      '-File', join(__dirname, '..', 'scripts', 'media.ps1'),
    ], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    child = processHandle;
    const lines = createInterface({ input: processHandle.stdout });
    lines.on('line', line => {
      let message;
      try { message = JSON.parse(line); } catch { return; }
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      clearTimeout(request.timer);
      if (message.ok) request.resolve(message.state);
      else request.reject(new Error(message.error || 'Windows rejected the media request.'));
    });
    processHandle.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-2000); });
    processHandle.stdin.on('error', error => {
      if (child === processHandle) failPending(error);
    });
    processHandle.on('error', error => {
      if (child !== processHandle) return;
      child = null;
      failPending(error);
    });
    processHandle.on('exit', () => {
      lines.close();
      if (child !== processHandle) return;
      child = null;
      failPending(new Error(stderr.trim() || 'Windows media helper stopped. It will reconnect on the next refresh.'));
    });
    return processHandle;
  }

  function request(action, value) {
    return new Promise((resolve, reject) => {
      let processHandle;
      try { processHandle = start(); } catch (error) { reject(error); return; }
      const id = ++sequence;
      const timer = setTimeout(() => {
        // A hung WinRT call blocks the serial helper. Restart it before accepting new work.
        if (child === processHandle) child = null;
        failPending(new Error('Windows media request timed out. Try again.'));
        processHandle.kill();
      }, 25000);
      pending.set(id, { resolve, reject, timer });
      processHandle.stdin.write(JSON.stringify({ id, action, value }) + '\n');
    });
  }

  return {
    async getState() {
      try { return await request('state'); }
      catch (error) {
        return { connected: false, title: '', artist: '', source: '', playing: false,
          volume: null, canPlay: false, canPause: false, canNext: false, canPrevious: false,
          error: error.message, artwork: null, artworkKey: null, audio: null, presence: 'normal', spotifyVolume: null };
      }
    },
    async command(action, value) {
      if (!ACTIONS.has(action)) throw new Error('Unsupported media action.');
      if ((action === 'volume' || action === 'spotify-volume') && (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100)) {
        throw new Error('Volume must be a number between 0 and 100.');
      }
      if (['audio-output', 'audio-input'].includes(action) && (typeof value !== 'string' || !DEVICE_ID.test(value))) {
        throw new Error('Choose an audio device.');
      }
      if (['mute-output', 'mute-input'].includes(action) && typeof value !== 'boolean') throw new Error('Choose whether to mute.');
      return request(action, value);
    },
    close() {
      closed = true;
      failPending(new Error('Media bridge is closed.'));
      const processHandle = child;
      child = null;
      if (processHandle) { processHandle.stdin.end(); processHandle.kill(); }
    },
  };
}

module.exports = { createMediaBridge, DEVICE_ID };
