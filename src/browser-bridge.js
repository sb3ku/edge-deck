'use strict';

(() => {
  if (window.edge || !['http:', 'https:'].includes(location.protocol)) return;
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname)) return;

  const storageKey = 'edge-deck-token';
  const fragment = new URLSearchParams(location.hash.slice(1));
  let token = fragment.get('edge-token');
  try { token ||= sessionStorage.getItem(storageKey); } catch {}
  if (!token) return;
  try { sessionStorage.setItem(storageKey, token); } catch {}
  if (location.hash) history.replaceState(history.state, '', location.pathname + location.search);

  const listeners = new Set();
  const pending = new Set();
  let timer = null;
  let stopped = false;
  let stateRequest = null;
  let lastState = null;

  function publish(state) {
    for (const listener of listeners) {
      try { listener(state); } catch (error) { console.error('Dashboard update could not be displayed.', error); }
    }
  }

  function disconnected() {
    if (!lastState || stopped) return;
    const message = 'The local Edge Deck service is disconnected. Reopen Edge Deck to reconnect.';
    publish({
      ...lastState,
      media: { connected: false, playing: false, volume: null, canPlay: false, canPause: false, canNext: false, canPrevious: false, error: message },
      spotify: { ...lastState.spotify, connected: false, error: message },
      weather: { ...lastState.weather, status: lastState.weather?.updatedAt ? 'stale' : 'error', stale: true, error: message },
      tasks: { ...lastState.tasks, connected: false, error: message, items: (lastState.tasks?.items || []).map(item => item.status === 'working' ? { ...item, status: 'unknown' } : item) },
      printers: (lastState.printers || []).map(printer => printer.status === 'not_configured' ? printer : { ...printer, status: 'offline', message }),
      system: { ...lastState.system, hostname: 'Service disconnected' }
    });
  }

  async function request(operation, args = []) {
    if (stopped) throw new Error('The dashboard is closing.');
    const controller = new AbortController();
    pending.add(controller);
    const timeout = operation === 'app:choose' ? null : setTimeout(() => controller.abort(), operation === 'state:get' ? 10000 : 30000);
    try {
      let response;
      try {
        response = await fetch('/api', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Edge-Token': token },
          body: JSON.stringify({ operation, args }),
          cache: 'no-store',
          credentials: 'omit',
          redirect: 'error',
          referrerPolicy: 'no-referrer',
          signal: controller.signal
        });
      } catch {
        disconnected();
        throw new Error('Could not reach the local Edge Deck service. Reopen Edge Deck to reconnect.');
      }
      let body;
      try { body = await response.json(); } catch {
        disconnected();
        throw new Error('The local Edge Deck service returned an unreadable response.');
      }
      if (!response.ok || body?.ok === false) {
        if ([401, 403, 502, 503, 504].includes(response.status)) disconnected();
        throw new Error(typeof body?.error === 'string' ? body.error : `Edge Deck could not complete this action (${response.status}).`);
      }
      const result = body?.result;
      if (result?.config) lastState = result;
      return result;
    } finally {
      if (timeout) clearTimeout(timeout);
      pending.delete(controller);
    }
  }

  function getState() {
    if (!stateRequest) {
      stateRequest = request('state:get').then(state => {
        if (!state?.config) throw new Error('The local Edge Deck service returned incomplete dashboard data.');
        return state;
      }).catch(error => { disconnected(); throw error; }).finally(() => { stateRequest = null; });
    }
    return stateRequest;
  }

  // Waits for the service's next change (long-poll) instead of polling, so
  // updates such as agent activity appear as soon as they happen.
  let version = -1;
  function startPolling() {
    if (timer || stopped || !listeners.size) return;
    const run = timer = {};
    (async () => {
      while (timer === run && !stopped && listeners.size) {
        try {
          const result = await request('state:wait', [version]);
          if (timer !== run || stopped) break;
          if (result?.state?.config) { version = result.version; lastState = result.state; publish(result.state); }
        } catch {
          // request() has already shown the disconnected state; retry shortly.
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
      if (timer === run) timer = null;
    })();
  }

  window.edge = Object.freeze({
    getState,
    saveConfig: config => request('config:save', [config]),
    savePrinter: config => request('printer:save', [config]),
    media: (action, value) => request('media:command', [action, value]),
    systemControl: (action, value) => request('system:control', [action, value]),
    systemList: kind => request('system:list', [kind]),
    saveSpotify: config => request('spotify:save', [config]),
    spotify: (action, value) => request('spotify:action', [action,value]),
    spotifyPlayer: (action, value) => request('spotify:player', [action, value]),
    spotifyBrowse: (kind, value) => request('spotify:browse', [kind, value]),
    searchWeather: query => request('weather:search', [query]),
    saveWeather: input => request('weather:save', [input]),
    refreshWeather: () => request('weather:refresh'),
    savePlaylist: input => request('music:save-playlist', [input]),
    removePlaylist: id => request('music:remove-playlist', [id]),
    openPlaylist: uri => request('music:open-playlist', [uri]),
    printerCommand: (id,action,params={}) => request('printer:command',[id,action,params]),
    reprintPlan: id => request('printer:reprint-plan',[id]),
    reprint: (id,planId) => request('printer:reprint',[id,planId]),
    cameraVideo: id => request('printer:camera-video', [id]),
    cameraFrame: (id, after = null) => request('printer:camera', after ? [id, after] : [id]),
    printerThumbnail: id => request('printer:thumbnail',[id]),
    bambuSignIn: input => request('bambu:signin',[input]),
    bambuVerify: input => request('bambu:verify',[input]),
    bambuSignOut: () => request('bambu:signout'),
    saveCanvas: value => request('canvas:save',[value]),
    removeCanvas: () => request('canvas:remove'),
    checkUpdate: () => request('update:check'),
    speedTest: () => request('pc:speedtest'),
    setCpuSensor: enable => request('pc:cpu-sensor', [enable === true]),
    installUpdate: () => request('update:install'),
    updateNotes: () => request('update:notes'),
    openApp: target => request('app:open', [target]),
    appIcon: (target, id) => request('app:icon', [target, id]),
    searchIcons: query => request('icons:search', [query]),
    decideApproval: (id, decision) => request('agent:decide', [id, decision]),
    setClaudeApprovals: enabled => request('claude:approvals', [enabled]),
    chooseApp: () => request('app:choose'),
    getDisplays: () => request('displays:get'),
    setStartup: enabled => request('system:startup', [enabled]),
    createDesktopShortcut: () => request('system:desktop-shortcut'),
    moveToDisplay: async id => {
      if (document.fullscreenElement) await document.exitFullscreen();
      return request('window:display', [id]);
    },
    fullscreen: async () => {
      if (document.fullscreenElement) await document.exitFullscreen();
      const fullscreen = await request('window:fullscreen');
      if (lastState) {
        lastState = { ...lastState, system: { ...lastState.system, fullscreen } };
        publish(lastState);
      }
      return fullscreen;
    },
    onState(callback) {
      if (typeof callback !== 'function') throw new TypeError('A dashboard update callback is required.');
      listeners.add(callback); startPolling();
      return () => { listeners.delete(callback); if (!listeners.size) timer = null; };
    }
  });

  // F11 must use the same window mode as the touch button, rather than layering
  // Chromium's separate native full screen on top of the dashboard's frame.
  window.addEventListener('keydown', event => {
    if (event.key === 'F11') {
      event.preventDefault();
      if (!event.repeat) window.edge.fullscreen().catch(error => console.error(error.message));
    } else if (event.key === 'Escape' && !document.querySelector('dialog[open], #widgets[data-dragging], #widgets[data-drag-pending]') && lastState?.system?.fullscreen) {
      event.preventDefault();
      if (!event.repeat) window.edge.fullscreen().catch(error => console.error(error.message));
    }
  }, true);

  window.addEventListener('pagehide', () => {
    stopped = true;
    timer = null;
    for (const controller of pending) controller.abort();
  });
  window.addEventListener('pageshow', () => { if (stopped) { stopped = false; startPolling(); } });
})();
