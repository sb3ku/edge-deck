(() => {
  'use strict';

  const views = new WeakMap();
  const clientPattern = /^[a-f0-9]{32}$/i;
  const playlistPattern = /^spotify:playlist:[A-Za-z0-9]{22}$/;

  function element(tag, className = '', text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
  }

  function render(container, context) {
    const { getState, bridge, updateState, toast } = context;
    const state = getState() || {};
    const spotify = state.spotify || {};
    const savedClient = state.config?.spotify?.clientId || '';
    let view = views.get(container);
    if (!view) {
      view = { draft: savedClient, dirty: false, busy: false, error: '', notice: '', setupOpen: false };
      views.set(container, view);
    } else if (!view.dirty) view.draft = savedClient;

    const root = element('section');
    root.dataset.edgeMusicRoot = 'true';
    root.setAttribute('aria-label', 'Spotify playlist settings');
    root.setAttribute('aria-busy', String(view.busy));
    container.replaceChildren(root);
    const available = typeof bridge?.spotify === 'function' && typeof bridge?.saveSpotify === 'function';

    function redraw() {
      // A request can finish after the user changes tabs. Only redraw the Music
      // view that is still mounted; there are no timers or retained listeners.
      if (container.isConnected && container.querySelector('[data-edge-music-root]')) render(container, context);
    }
    function updateSpotify(next) {
      if (next && typeof next === 'object') updateState({ ...getState(), spotify: next });
    }
    async function run(action) {
      if (view.busy) return;
      view.busy = true; view.error = ''; view.notice = '';
      redraw();
      try { await action(); }
      catch (error) {
        view.error = typeof error?.message === 'string' ? error.message : 'Spotify could not complete this action. Try again.';
        if (typeof toast === 'function') toast(view.error);
      } finally { view.busy = false; redraw(); }
    }
    function button(label, action, { primary = false, disabled = false, ariaLabel } = {}) {
      const node = element('button', primary ? 'button primary' : 'button', label);
      node.type = 'button'; node.disabled = view.busy || disabled;
      node.style.minHeight = '48px'; node.style.minWidth = '48px';
      if (ariaLabel) node.setAttribute('aria-label', ariaLabel);
      node.addEventListener('click', () => run(action));
      return node;
    }

    root.append(element('p', 'intro', 'Choose a Spotify playlist and play it on your active Spotify device.'));
    if (!available) root.append(element('p', 'notice', 'Playlist connections are available in the desktop dashboard.'));
    const status = element('p', 'notice');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.textContent = view.busy ? 'Working with Spotify…' : spotify.connecting
      ? 'Finish signing in through your browser, then tap Refresh playlists.'
      : view.notice || (spotify.connected ? 'Spotify is connected.' : 'Connect Spotify to browse your playlists.');
    root.append(status);
    const error = view.error || spotify.error;
    if (error) { const message = element('p', 'form-error', error); message.setAttribute('role', 'alert'); root.append(message); }

    const connection = element('div', 'form-actions');
    const connect = button(spotify.connecting ? 'Waiting for Spotify…' : spotify.connected ? 'Reconnect Spotify' : 'Connect Spotify', async () => {
      updateSpotify(await bridge.spotify('connect'));
      if (typeof toast === 'function') toast('Finish connecting Spotify in your browser');
    }, { primary: !spotify.connected, disabled: !available || !spotify.clientIdConfigured || view.dirty || spotify.connecting });
    connection.append(connect);
    connection.append(button('Refresh playlists', async () => {
      updateSpotify(await bridge.spotify('refresh'));
    }, { disabled: !available || (!spotify.connected && !spotify.connecting) }));
    if (spotify.connected) connection.append(button('Disconnect', async () => {
      updateSpotify(await bridge.spotify('disconnect'));
      if (typeof toast === 'function') toast('Spotify disconnected from Edge Deck');
    }, { disabled: !available }));
    root.append(connection);

    if (spotify.connected) {
      const block = element('div', 'settings-block');
      block.append(element('h3', '', 'Your playlists'));
      const playlists = Array.isArray(spotify.playlists) ? spotify.playlists.filter(item => item && playlistPattern.test(item.uri)) : [];
      if (!playlists.length) block.append(element('p', 'empty-compact', spotify.loaded
        ? 'Spotify returned no playlists. Add or follow a playlist in Spotify, then refresh here.'
        : 'Tap Refresh playlists to load your library.'));
      const list = element('div'); list.setAttribute('role', 'list');
      for (const playlist of playlists) {
        const row = element('div', 'settings-row'); row.setAttribute('role', 'listitem');
        const copy = element('div'); copy.style.minWidth = '0'; copy.style.flex = '1';
        const name = String(playlist.name || 'Untitled playlist');
        const title = element('p', 'settings-row-title', name); title.style.overflowWrap = 'anywhere';
        copy.append(title);
        if (Number.isInteger(playlist.totalTracks) && playlist.totalTracks >= 0) {
          copy.append(element('small', '', `${playlist.totalTracks} ${playlist.totalTracks === 1 ? 'track' : 'tracks'}`));
        }
        row.append(copy, button('Play', async () => {
          const result = await bridge.spotify('play', playlist.uri);
          const target = result?.deviceName || 'your active Spotify device';
          view.notice = `Playback request sent to ${target}.`;
          if (typeof toast === 'function') toast(view.notice);
        }, { ariaLabel: `Play ${name}`, disabled: !available }));
        list.append(row);
      }
      block.append(list);
      if (spotify.hasMore) block.append(element('p', 'notice', 'Showing the first 100 playlists returned by Spotify.'));
      block.append(element('p', 'empty-compact', 'Start a track in Spotify on the device you want to use. Playlist changes go to that active device.'));
      root.append(block);
    }

    const setup = element('details', 'settings-block');
    setup.open = !spotify.connected || view.setupOpen || view.dirty;
    const summary = element('summary', 'settings-row-title', spotify.connected ? 'Spotify connection settings' : 'Set up Spotify');
    summary.style.minHeight = '48px'; summary.style.cursor = 'pointer'; summary.style.padding = '12px 0';
    setup.append(summary);
    setup.addEventListener('toggle', () => { view.setupOpen = setup.open; });
    const guidance = element('p', 'notice', 'One-time setup: Spotify Premium is required. In the Spotify developer dashboard, choose Create app, name it Edge Deck, select Web API, and register the redirect address below. Use that app’s Client ID and add your Spotify account to its user allowlist.');
    const developer = element('a', 'button subtle', 'Open Spotify developer dashboard');
    developer.href = 'https://developer.spotify.com/dashboard'; developer.target = '_blank'; developer.rel = 'noopener noreferrer';
    developer.style.minHeight = '48px'; developer.style.color = 'var(--accent-text)'; developer.style.textDecoration = 'none';
    setup.append(guidance, developer);

    const redirectLabel = element('label', 'form-field');
    redirectLabel.style.marginTop = '18px';
    redirectLabel.append(element('span', '', 'Redirect address to register'));
    const redirect = element('input'); redirect.type = 'text'; redirect.readOnly = true;
    redirect.value = spotify.redirectUri || 'http://127.0.0.1:43821/callback';
    redirect.setAttribute('aria-label', 'Spotify redirect address');
    redirect.addEventListener('focus', () => redirect.select());
    redirectLabel.append(redirect, element('small', '', 'Register this exact address, including port 43821 and /callback.'));
    setup.append(redirectLabel);

    const form = element('form');
    const field = element('label', 'form-field'); field.append(element('span', '', 'Spotify Client ID'));
    const input = element('input'); input.type = 'text'; input.autocomplete = 'off'; input.spellcheck = false;
    input.value = view.draft; input.placeholder = '32-character Client ID'; input.maxLength = 32; input.required = true;
    input.pattern = '[a-fA-F0-9]{32}'; input.disabled = view.busy || !available;
    field.append(input, element('small', '', 'Use the Client ID, not the Client Secret. Sign-in tokens are encrypted on this PC.'));
    const save = element('button', 'button primary', 'Save Client ID'); save.type = 'submit'; save.style.minHeight = '48px';
    const draftHint = element('p', 'empty-compact'); draftHint.style.marginTop = '10px';
    function draftChanged() {
      view.draft = input.value;
      view.dirty = input.value.trim() !== (getState()?.config?.spotify?.clientId || '');
      save.disabled = view.busy || !available || !view.dirty || !clientPattern.test(input.value.trim());
      connect.disabled = view.busy || !available || !spotify.clientIdConfigured || view.dirty || Boolean(spotify.connecting);
      draftHint.textContent = view.dirty ? 'Save the Client ID before connecting.' : 'Your Client ID is saved when you tap Save.';
    }
    input.addEventListener('input', draftChanged);
    draftChanged();
    form.append(field, save, draftHint);
    form.addEventListener('submit', event => {
      event.preventDefault();
      const clientId = input.value.trim();
      if (!clientPattern.test(clientId)) { input.reportValidity(); return; }
      run(async () => {
        const next = await bridge.saveSpotify({ clientId });
        view.draft = next?.config?.spotify?.clientId || clientId; view.dirty = false;
        if (next?.config) updateState(next);
        else updateState(await bridge.getState());
        if (typeof toast === 'function') toast('Spotify Client ID saved');
      });
    });
    setup.append(form);
    root.append(setup);
  }

  window.EdgeMusicUI = Object.freeze({ render });
})();
