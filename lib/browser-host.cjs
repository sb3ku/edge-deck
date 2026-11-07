'use strict';

const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs/promises');
const { randomBytes, timingSafeEqual } = require('node:crypto');

// Bounded full settings payload: up to 16 cards, 30 saved apps and 50 playlists.
const BODY_LIMIT = 128 * 1024;
const OPERATIONS = new Set([
  'state:get', 'state:wait', 'config:save', 'printer:save', 'media:command', 'app:choose', 'app:icon', 'icons:search', 'agent:decide', 'claude:approvals',
  'app:open', 'window:fullscreen', 'window:display', 'displays:get',
  'spotify:save', 'spotify:action', 'spotify:player', 'spotify:browse', 'printer:command', 'printer:camera', 'printer:thumbnail', 'bambu:signin', 'bambu:verify', 'bambu:signout', 'canvas:save', 'canvas:remove',
  'system:startup', 'system:desktop-shortcut',
  'weather:search', 'weather:save', 'weather:refresh',
  'music:save-playlist', 'music:remove-playlist', 'music:open-playlist',
]);
const FILES = new Map([
  ['/cards.css', ['cards.css', 'text/css; charset=utf-8']],
  ['/layout-ui.css', ['layout-ui.css', 'text/css; charset=utf-8']],
  ['/apple-ui.css', ['apple-ui.css', 'text/css; charset=utf-8']],
  ['/layout-ui.js', ['layout-ui.js', 'text/javascript; charset=utf-8']],
  ['/layout-engine.js', ['layout-engine.js', 'text/javascript; charset=utf-8']],
  ['/card-drag.js', ['card-drag.js', 'text/javascript; charset=utf-8']],

  ['/assets/app/edge-deck.ico', ['assets/app/edge-deck.ico', 'image/x-icon']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/printer-panel.css', ['printer-panel.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/browser-bridge.js', ['browser-bridge.js', 'text/javascript; charset=utf-8']],
  ['/music-ui.js', ['music-ui.js', 'text/javascript; charset=utf-8']],
  ['/printer-ui.js', ['printer-ui.js', 'text/javascript; charset=utf-8']],
  ['/media-widget.js', ['media-widget.js', 'text/javascript; charset=utf-8']],
  ['/media-widget.css', ['media-widget.css', 'text/css; charset=utf-8']],
  ['/weather-ui.js', ['weather-ui.js', 'text/javascript; charset=utf-8']],
  ['/weather-ui.css', ['weather-ui.css', 'text/css; charset=utf-8']],
  ['/quick-actions.js', ['quick-actions.js', 'text/javascript; charset=utf-8']],
  ['/weather-sky.js', ['weather-sky.js', 'text/javascript; charset=utf-8']],
  ['/agent-orbs.js', ['agent-orbs.js', 'text/javascript; charset=utf-8']],
  ['/vendor/thinking-orbs.js', ['vendor/thinking-orbs.js', 'text/javascript; charset=utf-8']],
  ['/theme.css', ['theme.css', 'text/css; charset=utf-8']],
  ['/assets/printers/h2d.svg', ['assets/printers/h2d.svg', 'image/svg+xml']],
  ['/assets/printers/p1s.svg', ['assets/printers/p1s.svg', 'image/svg+xml']],
  ['/assets/printers/p1s-outline-v1.svg', ['assets/printers/p1s-outline-v1.svg', 'image/svg+xml']],
  ['/assets/printers/p1s-outline-v2.svg', ['assets/printers/p1s-outline-v2.svg', 'image/svg+xml']],
  ['/assets/printers/p1s-line-art.png', ['assets/printers/p1s-line-art.png', 'image/png']],
  ['/assets/printers/h2d-photo.png', ['assets/printers/h2d-photo.png', 'image/png']],
  ['/assets/printers/p1s-photo.png', ['assets/printers/p1s-photo.png', 'image/png']],
]);
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src https://canvaz.scdn.co; connect-src 'self'; frame-src https:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";

class RequestError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function readJSON(request) {
  return new Promise((resolve, reject) => {
    const declaredLength = request.headers['content-length'];
    if (declaredLength && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > BODY_LIMIT)) {
      request.resume();
      reject(new RequestError(413, 'Request is too large.'));
      return;
    }
    let length = 0;
    const chunks = [];
    const cleanup = () => {
      request.off('data', onData);
      request.off('end', onEnd);
      request.off('error', onError);
      request.off('aborted', onAborted);
    };
    const onError = () => { cleanup(); reject(new RequestError(400, 'Request could not be read.')); };
    const onAborted = () => { cleanup(); reject(new RequestError(400, 'Request was interrupted.')); };
    const onData = chunk => {
      length += chunk.length;
      if (length > BODY_LIMIT) {
        cleanup();
        request.resume();
        reject(new RequestError(413, 'Request is too large.'));
      } else chunks.push(chunk);
    };
    const onEnd = () => {
      cleanup();
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new RequestError(400, 'Request must contain valid JSON.')); }
    };
    request.on('data', onData);
    request.on('end', onEnd);
    request.on('error', onError);
    request.on('aborted', onAborted);
  });
}

function publicError(error) {
  // File/OS errors can contain absolute paths or credentials. Keep those in the
  // host process; ordinary short validation messages remain useful to the UI.
  const message = typeof error?.message === 'string' ? error.message : '';
  if (!message || message.length > 240 || error.code || /(?:[a-z]:[\\/]|\\\\|\/(?:Users|home|tmp|var)\/|password|access.?code\s*[:=]|token\s*[:=])/i.test(message)) {
    return 'The action could not be completed. Please check the settings and try again.';
  }
  return message.replace(/[\u0000-\u001f\u007f]/g, ' ');
}

async function createBrowserHost({ root, handle }) {
  if (typeof root !== 'string' || !path.isAbsolute(root) || typeof handle !== 'function') {
    throw new TypeError('An absolute application root and request handler are required.');
  }
  const token = randomBytes(32).toString('base64url');
  const expectedToken = Buffer.from(token);
  const source = path.join(root, 'src');
  let origin;
  let expectedHost;
  let closing;
  const server = http.createServer({ maxHeaderSize: 8192 }, (request, response) => {
    response.setHeader('Content-Security-Policy', CSP);
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');

    const json = (status, value) => {
      if (response.destroyed || response.writableEnded) return;
      let body;
      try { body = JSON.stringify(value); }
      catch { status = 500; body = JSON.stringify({ ok: false, error: 'The action returned an unsupported response.' }); }
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(body);
    };
    (async () => {
      if (closing) throw new RequestError(503, 'The dashboard is closing.');
      if (request.headers.host !== expectedHost) throw new RequestError(421, 'Invalid dashboard address.');
      if (request.url === '/api') {
        if (request.method !== 'POST') throw new RequestError(405, 'Use POST for dashboard actions.');
        if (request.headers.origin !== origin) throw new RequestError(403, 'This page cannot control the dashboard.');
        const supplied = typeof request.headers['x-edge-token'] === 'string' ? Buffer.from(request.headers['x-edge-token']) : Buffer.alloc(0);
        if (supplied.length !== expectedToken.length || !timingSafeEqual(supplied, expectedToken)) {
          throw new RequestError(401, 'Dashboard connection expired. Reopen Edge Deck.');
        }
        if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] || '')) {
          throw new RequestError(415, 'Use JSON for dashboard actions.');
        }
        const body = await readJSON(request);
        if (!body || typeof body !== 'object' || Array.isArray(body) ||
            !OPERATIONS.has(body.operation) || !Array.isArray(body.args) || body.args.length > 8) {
          throw new RequestError(400, 'Unknown dashboard action or invalid arguments.');
        }
        try { json(200, { ok: true, result: await handle(body.operation, body.args) }); }
        catch (error) { json(400, { ok: false, error: publicError(error) }); }
        return;
      }
      if (request.method !== 'GET') throw new RequestError(405, 'This request method is not supported.');
      // Exact routing avoids path traversal, query variants, and exposure of any
      // application files beyond these four frontend resources.
      const file = FILES.get(request.url);
      if (!file) throw new RequestError(404, 'Page not found.');
      let data;
      try { data = await fs.readFile(path.join(source, file[0])); }
      catch { throw new RequestError(404, 'Dashboard file is unavailable.'); }
      response.writeHead(200, { 'Content-Type': file[1], 'Content-Length': data.length });
      response.end(data);
    })().catch(error => {
      request.resume();
      json(error instanceof RequestError ? error.status : 500,
        { ok: false, error: error instanceof RequestError ? error.message : 'Dashboard request failed.' });
    });
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 5000;
  server.keepAliveTimeout = 2000;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  expectedHost = `127.0.0.1:${server.address().port}`;
  origin = `http://${expectedHost}`;
  return {
    url: `${origin}/index.html#edge-token=${token}`,
    close() {
      if (closing) return closing;
      closing = new Promise(resolve => { server.close(() => resolve()); server.closeAllConnections(); });
      return closing;
    },
  };
}

module.exports = { createBrowserHost };
