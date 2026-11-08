(() => {
  'use strict';
  // Spotify-style player. When Spotify is connected and has an active device,
  // the Web API supplies progress, shuffle/repeat, likes, devices and the
  // queue. Otherwise the widget falls back to the Windows media session.
  // Laid out like Spotify's mobile app: a full-screen player that minimises
  // (arrow or swipe down) to a mini player above a tab bar with Home, Search
  // and Your Library; tapping the mini player or swiping up opens it again.
  const views = new WeakMap();
  const live = new Set();
  const playlistPattern = /^spotify:playlist:[A-Za-z0-9]{22}$/;
  const typeNames = { playlist: 'Playlist', album: 'Album', artist: 'Artist', track: 'Song', collection: 'Playlist' };
  // Liked Songs' cover: Spotify's violet gradient with a white heart, drawn once.
  let likedCover = '';
  function likedArtwork() {
    if (likedCover) return likedCover;
    try {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128; const ctx = canvas.getContext('2d');
      const gradient = ctx.createLinearGradient(0, 0, 128, 128); gradient.addColorStop(0, '#450af5'); gradient.addColorStop(1, '#c4efd9');
      ctx.fillStyle = gradient; ctx.fillRect(0, 0, 128, 128);
      ctx.fillStyle = '#fff'; ctx.translate(64, 68); ctx.scale(2.2, 2.2); ctx.translate(-12, -12);
      ctx.fill(new Path2D('M12 20s-7.5-4.6-9.3-9.2C1.4 7.4 3.6 4 7 4c2.1 0 3.6 1.1 5 3 1.4-1.9 2.9-3 5-3 3.4 0 5.6 3.4 4.3 6.8C19.5 15.4 12 20 12 20Z'));
      likedCover = canvas.toDataURL('image/png');
    } catch { likedCover = ''; }
    return likedCover;
  }
  // Spoken description that tells same-named items apart: "Album by Daft Punk".
  const describe = item => [typeNames[item.type] || '', item.by ? `by ${item.by}` : ''].filter(Boolean).join(' ');
  const paths = {
    music: ['M9 18V5l11-2v13', 'M9 5l11-2v4L9 9', 'M9 18c0 2-6 3-6 0s6-3 6 0Z', 'M20 16c0 2-6 3-6 0s6-3 6 0Z'],
    play: ['M7 4.5v15a1 1 0 0 0 1.5.9l12-7.5a1 1 0 0 0 0-1.8l-12-7.5A1 1 0 0 0 7 4.5Z'], pause: ['M7 4h3.5v16H7Z', 'M13.5 4H17v16h-3.5Z'],
    previous: ['M6 5v14', 'M19 5.5v13a.8.8 0 0 1-1.2.7L8.5 12.7a.8.8 0 0 1 0-1.4l9.3-6.5a.8.8 0 0 1 1.2.7Z'],
    next: ['M18 5v14', 'M5 5.5v13a.8.8 0 0 0 1.2.7l9.3-6.5a.8.8 0 0 0 0-1.4L6.2 4.8A.8.8 0 0 0 5 5.5Z'],
    shuffle: ['M3 7h3.5c2 0 3.2 1 4.3 2.8l2.4 4.4C14.3 16 15.5 17 17.5 17H21', 'M3 17h3.5c1.4 0 2.4-.5 3.2-1.4', 'M14.3 8.4C15.1 7.5 16.1 7 17.5 7H21', 'm18 4 3 3-3 3', 'm18 14 3 3-3 3'],
    repeat: ['M17 3l3 3-3 3', 'M4 11V9a3 3 0 0 1 3-3h13', 'M7 21l-3-3 3-3', 'M20 13v2a3 3 0 0 1-3 3H4'],
    heart: ['M12 20s-7.5-4.6-9.3-9.2C1.4 7.4 3.6 4 7 4c2.1 0 3.6 1.1 5 3 1.4-1.9 2.9-3 5-3 3.4 0 5.6 3.4 4.3 6.8C19.5 15.4 12 20 12 20Z'],
    volume: ['M11 5 6 9H3v6h3l5 4Z', 'M15.5 8.5a5 5 0 0 1 0 7', 'M18.5 5.5a9 9 0 0 1 0 13'],
    devices: ['M3 5h12v9H3Z', 'M6 18h6', 'M9 14v4', 'M17 9h4v11h-4Z', 'M19 17h0'],
    list: ['M9 6h12', 'M9 12h12', 'M9 18h12', 'M4 6h.5', 'M4 12h.5', 'M4 18h.5'],
    plus: ['M12 5v14', 'M5 12h14'], refresh: ['M20 7a9 9 0 1 0 1 8', 'M20 2v5h-5'],
    settings: ['M4 6h10', 'M18 6h2', 'M16 4v4', 'M4 12h4', 'M12 12h8', 'M10 10v4', 'M4 18h12', 'M18 16v4'],
    remove: ['M5 7h14l-1 14H6Z', 'M3 7h18', 'M9 7V3h6v4', 'M10 11v6', 'M14 11v6'],
    back: ['m15 5-7 7 7 7'], check: ['m5 12 5 5L20 7'], close: ['m6 6 12 12', 'M18 6 6 18'],
    search: ['M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z', 'm15 15 6 6'],
    home: ['M3 11 12 3l9 8', 'M5 10v10h5v-6h4v6h5V10'], library: ['M4 4v16', 'M9 4v16', 'm14 4.5 5 15'], chevronDown: ['m6 9 6 6 6-6'],
    computer: ['M3 4h18v12H3Z', 'M8 20h8', 'M12 16v4'], phone: ['M7 2h10v20H7Z', 'M11 18h2'], speaker: ['M6 3h12v18H6Z', 'M12 15.5a2.5 2.5 0 1 0 0-.1', 'M12 7h0'], tv: ['M2 5h20v12H2Z', 'M7 21h10'],
  };
  function el(tag, className = '', text) {
    const node = document.createElement(tag); node.className = className;
    if (text !== undefined) node.textContent = String(text); return node;
  }
  function icon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
    for (const d of paths[name] || paths.music) { const p = document.createElementNS(svg.namespaceURI, 'path'); p.setAttribute('d', d); svg.append(p); }
    if (['play', 'pause', 'heart'].includes(name)) svg.classList.add('is-solid');
    return svg;
  }
  function setIcon(node, name) { if (node.dataset.icon !== name) { node.replaceChildren(icon(name)); node.dataset.icon = name; } }
  function safeMessage(value, fallback = 'That action could not be completed. Please try again.') {
    const text = typeof value === 'string' ? value : value?.message;
    return typeof text === 'string' && text.length <= 600 && !/(?:[a-z]:[\\/]|bearer\s|(?:secret|token|password|access.?code)\s*[:=])/i.test(text)
      ? text.replace(/[\u0000-\u001f\u007f]/g, ' ') : fallback;
  }
  function playlistUri(value) {
    const text = String(value || '').trim(); if (playlistPattern.test(text)) return text;
    try {
      const url = new URL(text); const match = /^\/playlist\/([A-Za-z0-9]{22})\/?$/.exec(url.pathname);
      if (url.protocol === 'https:' && url.hostname === 'open.spotify.com' && !url.username && !url.password && !url.port && match) return `spotify:playlist:${match[1]}`;
    } catch { /* Show the input error instead of opening an arbitrary address. */ }
    return null;
  }
  function artwork(value) {
    return typeof value === 'string' && value.length <= 3000000 && /^data:image\/(?:jpeg|png|webp|gif|bmp);base64,[A-Za-z0-9+/=]+$/.test(value) ? value : '';
  }
  function time(ms) {
    if (!Number.isFinite(ms) || ms < 0) return '0:00';
    const total = Math.floor(ms / 1000); const h = Math.floor(total / 3600), m = Math.floor(total % 3600 / 60), s = total % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
  }
  // The ambient background is blurred once into a tiny image and scaled up.
  // A live CSS blur would be recomposited on every animation frame.
  function blurredAmbient(source, done) {
    const image = new Image();
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 48;
        const ctx = canvas.getContext('2d'); ctx.filter = 'blur(5px) saturate(1.7) brightness(0.52)';
        ctx.drawImage(image, -10, -10, 68, 68); done(canvas.toDataURL('image/jpeg', 0.85));
      } catch { done(''); }
    };
    image.onerror = () => done('');
    image.src = source;
  }
  function cover(className) {
    const root = el('div', className); const image = el('img'); image.hidden = true; image.decoding = 'async'; image.draggable = false; image.alt = '';
    const fallback = el('span', 'emw-art-placeholder'); fallback.append(icon('music')); root.append(image, fallback);
    image.addEventListener('error', () => { image.hidden = true; fallback.hidden = false; root.classList.remove('has-artwork'); });
    return { root, image, fallback, value: '' };
  }
  function updateCover(node, source, alt) {
    const value = artwork(source); node.image.alt = alt;
    if (value === node.value) return;
    node.value = value; node.image.hidden = !value; node.fallback.hidden = !!value; node.root.classList.toggle('has-artwork', !!value);
    if (value) node.image.src = value; else node.image.removeAttribute('src');
  }
  function snapshot(view) { return view.context.getState() || {}; }
  function mounted(view) { return view.root?.isConnected && views.get(view.container) === view; }
  function publish(view, result, part) {
    if (!result || typeof result !== 'object') return;
    if (result.config) view.context.updateState(result);
    else if (part) view.context.updateState({ ...snapshot(view), [part]: result });
  }
  function fail(view, error) { view.error = safeMessage(error); view.notice = ''; view.context.toast?.(view.error); }
  async function run(view, key, action) {
    if (view.busy) return;
    // A control that has to be disabled while busy gets keyboard focus back afterwards.
    const focused = view.root?.contains(document.activeElement) ? document.activeElement : null;
    view.busy = key; view.error = ''; view.notice = ''; update(view);
    try { await action(); }
    catch (error) { fail(view, error); }
    finally {
      view.busy = ''; if (mounted(view)) update(view);
      if (focused?.isConnected && !focused.disabled && !focused.closest('[hidden]') && document.activeElement === document.body) focused.focus({ preventScroll: true });
    }
  }
  function button(label, action, symbol, className = '') {
    const node = el('button', `emw-button ${className}`); node.type = 'button'; node.setAttribute('aria-label', label); node.title = label;
    if (symbol) setIcon(node, symbol); else node.textContent = label;
    node.addEventListener('click', action); return node;
  }

  // ---- Player model -------------------------------------------------------
  function spotifyPlayer(view) {
    const spotify = snapshot(view).spotify || {};
    return spotify.connected && spotify.player?.active && spotify.player.track && typeof view.context.bridge?.spotifyPlayer === 'function' ? spotify.player : null;
  }
  // Optimistic values are shown immediately and kept until the server agrees
  // (or a short grace period passes), so taps never "bounce" back.
  function effective(view) {
    const spotify = spotifyPlayer(view); const media = snapshot(view).media || {};
    const base = spotify ? { mode: 'spotify', isPlaying: spotify.isPlaying, progressMs: spotify.progressMs, anchor: spotify.fetchedAt, shuffle: spotify.shuffle,
      repeat: spotify.repeat, liked: spotify.liked, volume: spotify.device?.supportsVolume ? spotify.device.volume : media.volume, trackUri: spotify.track.uri }
      : { mode: 'windows', isPlaying: !!media.playing, volume: media.volume, trackUri: media.connected ? `${media.title}|${media.artist}` : '' };
    const override = view.override;
    if (override) {
      const expired = override.settled && Date.now() > override.until;
      const agreed = override.settled && Object.entries(override.expect || {}).every(([key, value]) => base[key] === value);
      if (expired || agreed || override.mode !== base.mode) view.override = null;
      else return { ...base, ...override.fields };
    }
    return base;
  }
  function position(view, player = effective(view)) {
    const duration = spotifyPlayer(view)?.track?.durationMs || 0;
    if (player.mode !== 'spotify') return { at: 0, duration: 0 };
    const elapsed = player.isPlaying && Number.isFinite(player.anchor) ? Math.max(0, Date.now() - player.anchor) : 0;
    return { at: Math.min(duration, Math.max(0, (player.progressMs || 0) + elapsed)), duration };
  }
  async function command(view, key, fields, expect, send) {
    if (view.pending.has(key)) return;
    view.pending.add(key); view.error = '';
    if (fields) view.override = { mode: effective(view).mode, fields, expect, settled: false, until: Infinity };
    update(view);
    try { await send(); if (view.override && fields) { view.override.settled = true; view.override.until = Date.now() + 2500; } }
    catch (error) { if (fields) view.override = null; fail(view, error); }
    finally { view.pending.delete(key); if (mounted(view)) update(view); }
  }
  async function playerAction(view, action, value) {
    publish(view, await view.context.bridge.spotifyPlayer(action, value));
  }
  async function mediaAction(view, action, value) {
    const media = snapshot(view).media || {};
    const capability = action === 'previous' ? 'canPrevious' : action === 'next' ? 'canNext' : action === 'volume' ? 'volume' : media.playing ? 'canPause' : 'canPlay';
    if (action !== 'volume' && (!media.connected || media[capability] !== true)) throw new Error('This playback control is not available for the current media app.');
    if (typeof view.context.bridge?.media !== 'function') throw new Error('Playback controls are available in the desktop app.');
    publish(view, await view.context.bridge.media(action, value), 'media');
  }
  function togglePlay(view) {
    const player = effective(view); const next = !player.isPlaying;
    const fields = player.mode === 'spotify' ? { isPlaying: next, progressMs: position(view, player).at, anchor: Date.now() } : { isPlaying: next };
    command(view, 'play', fields, { isPlaying: next }, () => player.mode === 'spotify' ? playerAction(view, 'play-pause') : mediaAction(view, 'play-pause'));
  }
  function skip(view, direction) {
    const player = effective(view);
    const fields = player.mode === 'spotify' ? { progressMs: 0, anchor: Date.now(), changing: true } : { changing: true };
    command(view, direction, fields, {}, () => player.mode === 'spotify' ? playerAction(view, direction) : mediaAction(view, direction));
  }
  // Spotify has its own slider: the volume of the device Spotify plays on, or
  // Spotify's level in the Windows mixer when it plays on this PC without
  // remote volume, or without the Web API. System is the Windows volume.
  function volumeControls(view) {
    const state = snapshot(view); const media = state.media || {}; const player = state.spotify?.connected ? state.spotify.player : null;
    const device = player?.active && typeof view.context.bridge?.spotifyPlayer === 'function' ? player.device : null;
    const mediaBridge = typeof view.context.bridge?.media === 'function';
    const mixer = Number.isFinite(media.spotifyVolume) && mediaBridge
      ? { value: media.spotifyVolume, source: 'mixer', title: 'Spotify volume in the Windows mixer', send: async value => publish(view, await view.context.bridge.media('spotify-volume', value), 'media') } : null;
    let spotify = mixer;
    if (device) {
      // Spotify names the app on this PC after the computer.
      const here = /computer/i.test(device.type || '') && !!device.name && device.name.toLowerCase() === String(state.system?.hostname || '').toLowerCase();
      spotify = device.supportsVolume && Number.isFinite(device.volume)
        ? { value: device.volume, source: `device:${device.id}`, title: `Spotify volume on ${device.name}`, send: value => playerAction(view, 'volume', Math.round(value)) }
        : here && mixer ? mixer : { note: `Volume is set on ${device.name}`, source: `remote:${device.id}` };
    }
    // System volume lives in Quick actions; the music card controls Spotify only.
    return { spotify, system: null };
  }
  async function commitVolume(view, kind, value) {
    const slider = view.sliders[kind]; slider.queued = value;
    if (slider.sending) return;
    slider.sending = true; view.error = '';
    try {
      while (slider.queued !== null) {
        const target = slider.queued; slider.queued = null;
        const control = volumeControls(view)[kind];
        if (!control?.send || control.disabled) throw new Error(kind === 'spotify' ? 'Spotify volume is currently unavailable.' : 'System volume is currently unavailable.');
        await control.send(target);
        // Show the new level until the source reports it; Spotify can lag behind.
        slider.hold = { value: Math.round(target), source: control.source, until: Date.now() + 3000 };
      }
    } catch (error) { slider.queued = null; slider.hold = null; slider.touchedAt = 0; fail(view, error); }
    // Only the pointer handlers end 'adjusting': a second drag may have begun.
    finally { slider.sending = false; if (mounted(view)) update(view); }
  }

  // ---- Structure ----------------------------------------------------------
  function build(view) {
    const root = el('section', 'edge-media-widget'); root.dataset.edgeMediaRoot = 'true'; root.setAttribute('aria-label', 'Music'); view.root = root;
    const ambient = el('div', 'emw-ambient'); ambient.setAttribute('aria-hidden', 'true'); const ambientImage = el('img'); ambientImage.alt = ''; ambientImage.hidden = true;
    const canvasVideo = el('video', 'emw-canvas'); canvasVideo.muted = true; canvasVideo.loop = true; canvasVideo.playsInline = true; canvasVideo.preload = 'auto'; canvasVideo.hidden = true;
    canvasVideo.setAttribute('aria-hidden', 'true'); canvasVideo.disablePictureInPicture = true;
    canvasVideo.addEventListener('error', () => { canvasVideo.hidden = true; root.classList.remove('has-canvas'); });
    ambient.append(ambientImage, canvasVideo);
    root.append(ambient);

    // Now Playing: full screen; the arrow (or a swipe down) minimises it.
    const now = el('div', 'emw-now'); const hero = el('div', 'emw-hero');
    const nowTop = el('div', 'emw-now-top');
    const minimise = button('Minimise player', () => showBrowse(view), 'chevronDown', 'emw-minimise');
    const nowContext = el('p', 'emw-now-context'); nowTop.append(minimise, nowContext); now.append(nowTop); const art = cover('emw-art'); art.image.classList.add('song-cover');
    const copy = el('div', 'emw-copy'); const titleRow = el('div', 'emw-title-row'); const song = el('h3', 'emw-song');
    const like = button('Add to Liked Songs', () => toggleLike(view), 'heart', 'emw-like'); titleRow.append(song, like);
    const artist = el('p', 'emw-artist'); const source = el('button', 'emw-source'); source.type = 'button';
    source.addEventListener('click', () => openDevices(view));
    copy.append(titleRow, artist, source); hero.append(art.root, copy); now.append(hero);
    const progress = el('div', 'emw-progress'); const elapsed = el('span', 'emw-time'); const remaining = el('span', 'emw-time emw-time-end');
    const seek = el('input', 'emw-seek'); seek.type = 'range'; seek.min = '0'; seek.max = '1000'; seek.step = '1'; seek.setAttribute('aria-label', 'Song position');
    seek.addEventListener('pointerdown', () => { view.seeking = true; });
    seek.addEventListener('input', () => { view.seeking = true; paintProgress(view, Number(seek.value) / 1000); });
    seek.addEventListener('change', () => {
      const { duration } = position(view); const target = Math.round(Number(seek.value) / 1000 * duration); view.seeking = false;
      command(view, 'seek', { progressMs: target, anchor: Date.now() }, {}, () => playerAction(view, 'seek', target));
    });
    seek.addEventListener('pointercancel', () => { view.seeking = false; });
    progress.append(seek, elapsed, remaining); now.append(progress);
    const transport = el('div', 'emw-transport');
    const shuffle = button('Shuffle', () => { const value = !effective(view).shuffle; command(view, 'shuffle', { shuffle: value }, { shuffle: value }, () => playerAction(view, 'shuffle', value)); }, 'shuffle', 'emw-mode');
    const previous = button('Previous track', () => skip(view, 'previous'), 'previous');
    const play = button('Play', () => togglePlay(view), 'play', 'emw-play');
    const next = button('Next track', () => skip(view, 'next'), 'next');
    const repeat = button('Repeat', () => { const order = ['off', 'context', 'track']; const value = order[(order.indexOf(effective(view).repeat) + 1) % 3]; command(view, 'repeat', { repeat: value }, { repeat: value }, () => playerAction(view, 'repeat', value)); }, 'repeat', 'emw-mode emw-repeat');
    transport.append(shuffle, previous, play, next, repeat); now.append(transport);
    const volume = el('div', 'emw-volume'); const sliders = el('div', 'emw-volume-sliders');
    const volumeRow = (kind, label) => {
      const row = el('div', `emw-volume-row emw-volume-${kind}`); const name = el('span', 'emw-volume-label'); name.append(icon('volume')); name.setAttribute('aria-hidden', 'true');
      const range = el('input'); range.type = 'range'; range.min = '0'; range.max = '100'; range.step = '1'; range.setAttribute('aria-label', `${label} volume`);
      const note = el('span', 'emw-volume-note'); note.hidden = true;
      const slider = view.sliders[kind];
      range.addEventListener('pointerdown', () => { slider.adjusting = true; slider.pressedAt = Date.now(); });
      range.addEventListener('input', () => { slider.draft = Number(range.value); slider.touchedAt = slider.pressedAt = Date.now(); range.style.setProperty('--volume', `${range.value}%`); });
      range.addEventListener('change', () => { slider.adjusting = false; commitVolume(view, kind, Number(range.value)); });
      for (const type of ['pointerup', 'lostpointercapture']) range.addEventListener(type, () => { slider.adjusting = false; });
      range.addEventListener('pointercancel', () => { slider.adjusting = false; if (!slider.sending) update(view); });
      range.addEventListener('blur', () => { if (!slider.sending) update(view); });
      row.append(name, range, note); sliders.append(row); return { row, range, note };
    };
    const spotifyVolume = volumeRow('spotify', 'Spotify'), systemVolume = volumeRow('system', 'System');
    const devicesButton = button('Choose a Spotify device', () => openDevices(view), 'devices', 'emw-devices-button');
    const queueButton = button('Up Next', () => { view.tab = 'queue'; view.openItem = null; update(view); loadQueue(view); }, 'list', 'emw-queue-button');
    // As in the Spotify desktop app: queue and devices, then the volume, at the right.
    volume.append(queueButton, devicesButton, sliders); now.append(volume);
    const mediaHelp = el('p', 'emw-help'); now.append(mediaHelp);

    // Up Next
    const queue = el('div', 'emw-queue'); const queueList = el('div', 'emw-track-list'); queueList.setAttribute('role', 'list');
    const queueHead = el('div', 'emw-page-head'); queueHead.append(button('Back to player', () => showPlayer(view), 'chevronDown', 'emw-back emw-queue-back'), el('h3', 'emw-page-title', 'Up Next'));
    const queueEmpty = el('p', 'emw-help emw-queue-empty'); queue.append(queueHead, queueList, queueEmpty);

    // Library
    const playlists = el('div', 'emw-playlists'); const toolbar = el('div', 'emw-library-toolbar');
    const searchBox = el('label', 'emw-search'); searchBox.append(icon('search')); const search = el('input'); search.type = 'search'; search.placeholder = 'Search playlists'; search.setAttribute('aria-label', 'Search playlists'); search.autocomplete = 'off'; search.value = view.filter;
    search.addEventListener('input', () => { view.filter = search.value; scheduleSearch(view); updateLibrary(view); });
    search.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); scheduleSearch(view, true); } }); searchBox.append(search);
    const add = button('Add playlist', () => { view.adding = !view.adding; view.error = ''; update(view); if (view.adding) view.nodes.name.focus(); }, 'plus');
    const refresh = button('Refresh playlists', () => run(view, 'refresh', async () => { publish(view, await view.context.bridge.spotify('refresh'), 'spotify'); loadHome(view, true); }), 'refresh');
    const setup = button('Spotify settings', () => view.context.onSetup?.(), 'settings');
    const pageTitle = el('h3', 'emw-page-title'); toolbar.append(pageTitle, searchBox, add, refresh, setup); playlists.append(toolbar);
    const libraryBody = el('div', 'emw-library-body'); playlists.append(libraryBody);
    const connection = el('div', 'emw-connection'); const connectionCopy = el('p', 'emw-help');
    const connect = button('Connect Spotify', () => {
      if (!snapshot(view).spotify?.clientIdConfigured) { view.context.onSetup?.(); return; }
      run(view, 'connect', async () => { publish(view, await view.context.bridge.spotify('connect'), 'spotify'); view.notice = 'Finish connecting Spotify in your browser.'; });
    }); connect.classList.add('emw-primary'); connection.append(connectionCopy, connect); libraryBody.append(connection);
    const form = el('form', 'emw-add-form'); form.noValidate = true; form.append(el('h3', '', 'Add a playlist link'));
    const nameField = el('label'); nameField.append(el('span', '', 'Name')); const name = el('input'); name.type = 'text'; name.maxLength = 80; name.placeholder = 'Playlist name'; name.autocomplete = 'off'; name.value = view.nameDraft; nameField.append(name);
    const linkField = el('label'); linkField.append(el('span', '', 'Spotify playlist link')); const link = el('input'); link.type = 'text'; link.inputMode = 'url'; link.maxLength = 2048; link.placeholder = 'https://open.spotify.com/playlist/…'; link.autocomplete = 'off'; link.spellcheck = false; link.value = view.linkDraft; linkField.append(link);
    name.addEventListener('input', () => { view.nameDraft = name.value; }); link.addEventListener('input', () => { view.linkDraft = link.value; });
    const formActions = el('div', 'emw-form-actions'); const cancel = button('Cancel', () => { if (view.busy) return; view.adding = false; update(view); add.focus(); });
    const save = button('Save playlist', () => form.requestSubmit(), undefined, 'emw-primary'); formActions.append(cancel, save); form.append(nameField, linkField, formActions);
    form.addEventListener('submit', event => {
      event.preventDefault(); const uri = playlistUri(view.linkDraft); const name = view.nameDraft.trim();
      if (!uri || !name) { view.error = !name ? 'Enter a name for this playlist.' : 'Use a Spotify playlist link or spotify:playlist address.'; update(view); return; }
      run(view, 'save', async () => {
        if (typeof view.context.bridge?.savePlaylist !== 'function') throw new Error('Saving playlist links is unavailable.');
        publish(view, await view.context.bridge.savePlaylist({ name, uri }));
        view.adding = false; view.nameDraft = ''; view.linkDraft = ''; view.nodes.name.value = ''; view.nodes.link.value = ''; view.notice = 'Playlist link saved.';
      });
    }); libraryBody.append(form);
    const empty = el('div', 'emw-empty'); empty.append(icon('list')); const emptyTitle = el('h3'); const emptyCopy = el('p'); empty.append(emptyTitle, emptyCopy);
    const list = el('div', 'emw-playlist-list'); list.setAttribute('role', 'list'); const libraryHelp = el('p', 'emw-help emw-library-help');
    // Home: recent shortcuts in a grid (Discover Weekly first), then shelves.
    const home = el('div', 'emw-home'); const shortcuts = el('div', 'emw-shortcuts'); shortcuts.setAttribute('role', 'list'); shortcuts.setAttribute('aria-label', 'Recent');
    const shelves = el('div', 'emw-shelves'); home.append(shortcuts);
    const homeNotice = el('div', 'emw-connection emw-home-notice'); const homeNoticeCopy = el('p', 'emw-help');
    const reconnect = button('Reconnect', () => run(view, 'connect', async () => { publish(view, await view.context.bridge.spotify('connect'), 'spotify'); view.notice = 'Finish connecting Spotify in your browser.'; }));
    homeNotice.append(homeNoticeCopy, reconnect); const homeHelp = el('p', 'emw-help'); home.append(shelves, homeNotice, homeHelp);
    // Search results from all of Spotify, below matches in your library.
    const results = el('section', 'emw-results'); results.setAttribute('aria-label', 'On Spotify');
    const resultsList = el('div', 'emw-playlist-list'); resultsList.setAttribute('role', 'list'); const resultsHelp = el('p', 'emw-help');
    results.append(el('p', 'emw-section-label', 'On Spotify'), resultsList, resultsHelp);
    const listLabel = el('p', 'emw-section-label', 'Your playlists');
    libraryBody.append(home, listLabel, list, empty, results, libraryHelp);

    // Playlist detail
    const detail = el('div', 'emw-detail'); const detailHead = el('div', 'emw-detail-head');
    const back = button('Back', () => { view.openItem = null; update(view); libraryBody.scrollTop = view.libraryScroll || 0; }, 'back', 'emw-back');
    const detailArt = cover('emw-detail-art'); const detailCopy = el('div', 'emw-detail-copy'); const detailTitle = el('h3'); const detailMeta = el('p'); detailCopy.append(detailTitle, detailMeta);
    const detailPlay = button('Play playlist', () => { const item = view.openItem; if (item) playPlaylist(view, item); }, 'play', 'emw-play emw-detail-play');
    detailHead.append(back, detailArt.root, detailCopy, detailPlay);
    const detailList = el('div', 'emw-track-list'); detailList.setAttribute('aria-label', 'Songs'); const detailHelp = el('p', 'emw-help');
    detail.append(detailHead, detailList, detailHelp); playlists.append(detail);

    // Device picker sheet
    const sheet = el('div', 'emw-sheet'); sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-label', 'Spotify devices');
    const sheetHead = el('div', 'emw-sheet-head'); sheetHead.append(el('h3', '', 'Connect to a device'), button('Close devices', () => { view.devicesOpen = false; update(view); }, 'close'));
    const deviceList = el('div', 'emw-device-list'); const sheetHelp = el('p', 'emw-help'); sheet.append(sheetHead, deviceList, sheetHelp);

    // Mini player above the tab bar: tap or swipe up to open the player.
    const mini = el('div', 'emw-mini'); const miniOpen = el('button', 'emw-mini-open'); miniOpen.type = 'button';
    const miniArt = cover('emw-mini-art'); const miniCopy = el('span', 'emw-mini-copy'); const miniTitle = el('span', 'emw-mini-title'); const miniSub = el('span', 'emw-mini-sub');
    miniCopy.append(miniTitle, miniSub); miniOpen.append(miniArt.root, miniCopy); miniOpen.addEventListener('click', () => { if (!view.swiped) showPlayer(view); });
    const miniDevices = button('Choose a Spotify device', () => openDevices(view), 'devices', 'emw-mini-devices');
    const miniPlay = button('Play', () => togglePlay(view), 'play', 'emw-mini-play');
    const miniBar = el('span', 'emw-mini-progress'); const miniFill = el('i'); miniBar.append(miniFill); miniBar.setAttribute('aria-hidden', 'true');
    mini.append(miniOpen, miniDevices, miniPlay, miniBar);
    const tabbar = el('nav', 'emw-tabbar'); tabbar.setAttribute('aria-label', 'Music');
    const tabButton = (id, label, symbol) => {
      const node = button(label, () => { view.tab = id; view.browseTab = id; view.openItem = null; view.devicesOpen = false; if (id !== 'search') view.filter = view.filter; update(view); if (id === 'search') setTimeout(() => view.nodes.search.focus({ preventScroll: true }), 0); }, symbol, 'emw-tabbar-item');
      node.append(el('span', 'emw-tabbar-label', label)); tabbar.append(node); return node;
    };
    const homeTab = tabButton('home', 'Home', 'home'), searchTab = tabButton('search', 'Search', 'search'), listTab = tabButton('library', 'Your Library', 'library');
    const browse = el('div', 'emw-browse'); browse.append(queue, playlists, mini, tabbar);
    const feedback = el('p', 'emw-feedback'); feedback.setAttribute('aria-live', 'polite');
    // The player is a sheet over the browse pages (with its background); it
    // slides down to minimise and up to open, following the finger while dragged.
    const stage = el('div', 'emw-stage'); stage.append(now, browse);
    const solid = el('div', 'emw-solid'); solid.setAttribute('aria-hidden', 'true');
    root.prepend(solid); root.append(stage, sheet, feedback);
    dragSheet(view, now, false); dragSheet(view, mini, true);
    new ResizeObserver(() => placeSheet(view)).observe(root);
    view.nodes = { ambient, ambientImage, canvasVideo, nowContext, minimise, browse, mini, miniArt, miniTitle, miniSub, miniDevices, miniPlay, miniFill, homeTab, searchTab, listTab, pageTitle, shortcuts,
      now, queue, queueList, queueEmpty, playlists, libraryBody, hero, art, song, like, artist, source, progress, seek, elapsed, remaining,
      shuffle, previous, play, next, repeat, spotifyVolume, systemVolume, devicesButton, queueButton, mediaHelp,
      search, add, refresh, setup, connection, connectionCopy, connect, form, name, link, save, cancel, list, empty, emptyTitle, emptyCopy, libraryHelp,
      home, shelves, homeNotice, homeNoticeCopy, reconnect, homeHelp, results, resultsList, resultsHelp, listLabel,
      detail, detailArt, detailTitle, detailMeta, detailPlay, detailList, detailHelp, toolbar, sheet, deviceList, sheetHelp, feedback };
    view.rows = new Map(); view.container.replaceChildren(root);
  }

  // The page under the player: the current one, or the last one while the player is open.
  function browsePage(view) { return view.tab === 'now' ? view.browseTab || 'home' : view.tab; }
  function showBrowse(view) { view.tab = view.browseTab || 'home'; view.devicesOpen = false; update(view); }
  function showPlayer(view) { view.tab = 'now'; view.openItem = null; view.devicesOpen = false; update(view); }
  // How far the sheet travels: the whole card, so it leaves completely.
  function sheetDistance(view) { return Math.max(1, view.nodes?.ambient?.offsetHeight || view.root?.offsetHeight || 1); }
  function placeSheet(view, offset) {
    if (!view.root) return;
    const y = offset ?? (view.tab === 'now' ? 0 : sheetDistance(view));
    view.root.style.setProperty('--sheet-y', `${Math.round(y)}px`);
  }
  // Drag the player down (from the player) or up (from the mini player). The
  // sheet follows the pointer; on release it settles by distance or speed. A
  // click that ends a drag is swallowed so it does not press a button.
  function dragSheet(view, node, opening) {
    let start = null;
    node.addEventListener('pointerdown', event => {
      if (event.button > 0 || event.target.closest('input, .emw-sheet')) { start = null; return; }
      start = { x: event.clientX, y: event.clientY, t: performance.now(), id: event.pointerId, dragging: false, last: event.clientY, lastT: performance.now(), speed: 0 };
      view.swiped = false;
    });
    node.addEventListener('pointermove', event => {
      if (!start || event.pointerId !== start.id) return;
      const dx = event.clientX - start.x, dy = event.clientY - start.y;
      if (!start.dragging) {
        if (Math.abs(dy) < 8 || Math.abs(dy) < Math.abs(dx) * 1.2 || (opening ? dy > 0 : dy < 0)) return;
        start.dragging = true; view.root.classList.add('is-dragging'); try { node.setPointerCapture(event.pointerId); } catch {}
      }
      const now = performance.now(); start.speed = (event.clientY - start.last) / Math.max(1, now - start.lastT); start.last = event.clientY; start.lastT = now;
      const distance = sheetDistance(view);
      placeSheet(view, opening ? Math.min(distance, Math.max(0, distance + dy)) : Math.max(0, Math.min(distance, dy)));
    });
    const end = event => {
      if (!start || event.pointerId !== start.id) return;
      const drag = start; start = null;
      if (!drag.dragging) return;
      view.swiped = true; setTimeout(() => { view.swiped = false; }, 0);
      view.root.classList.remove('is-dragging');
      const moved = event.clientY - drag.y, distance = sheetDistance(view);
      const go = opening ? (-moved > distance * 0.15 || drag.speed < -0.5) : (moved > distance * 0.22 || drag.speed > 0.5);
      if (go) { if (opening) showPlayer(view); else showBrowse(view); } else placeSheet(view);
    };
    node.addEventListener('pointerup', end); node.addEventListener('pointercancel', event => { if (start) { start.dragging && view.root.classList.remove('is-dragging'); start = null; placeSheet(view); } });
    node.addEventListener('click', event => { if (view.swiped) { event.stopPropagation(); event.preventDefault(); } }, true);
  }

  // ---- Secondary views ----------------------------------------------------
  async function toggleLike(view) {
    const spotify = spotifyPlayer(view);
    if (!spotify) return;
    if (!spotify.libraryAccess) { fail(view, 'Reconnect Spotify in Music settings to use Liked Songs.'); update(view); return; }
    const value = !effective(view).liked;
    command(view, 'like', { liked: value }, { liked: value }, () => playerAction(view, 'like', value));
  }
  async function openDevices(view) {
    if (!snapshot(view).spotify?.connected || typeof view.context.bridge?.spotifyBrowse !== 'function') { view.context.onSetup?.(); return; }
    view.devicesOpen = true; view.devices = view.devices || null; view.devicesError = ''; update(view);
    try { view.devices = await view.context.bridge.spotifyBrowse('devices'); }
    catch (error) { view.devicesError = safeMessage(error); }
    if (mounted(view)) update(view);
  }
  async function loadQueue(view, quiet = false) {
    if (!spotifyPlayer(view) || typeof view.context.bridge?.spotifyBrowse !== 'function' || view.queueLoading) return;
    view.queueLoading = true; if (!quiet) update(view);
    try { view.queueData = await view.context.bridge.spotifyBrowse('queue'); view.queueFor = spotifyPlayer(view)?.track?.uri || ''; view.queueError = ''; }
    catch (error) { view.queueError = safeMessage(error); }
    finally { view.queueLoading = false; if (mounted(view)) update(view); }
  }
  // Songs of a playlist or album. Artists have no song list (Spotify no longer
  // shares top tracks with apps like this one), but they play.
  async function openCollection(view, item) {
    view.libraryScroll = view.nodes.libraryBody.scrollTop;
    view.openItem = item; view.playlistData = null; view.playlistError = ''; update(view);
    view.nodes.detail.scrollTop = 0;
    if (item.type === 'artist') { view.playlistData = { uri: item.uri, items: [], total: null, restricted: true }; update(view); return; }
    try {
      const data = await view.context.bridge.spotifyBrowse(item.type === 'album' ? 'album' : item.type === 'collection' ? 'liked' : 'playlist', item.uri);
      if (view.openItem?.uri === item.uri) view.playlistData = data;
    } catch (error) { if (view.openItem?.uri === item.uri) view.playlistError = safeMessage(error); }
    if (mounted(view)) update(view);
  }
  function openItem(view, item) {
    if (item.type !== 'track' && snapshot(view).spotify?.connected && typeof view.context.bridge?.spotifyBrowse === 'function') openCollection(view, item);
    else playPlaylist(view, item);
  }
  async function loadHome(view, force = false) {
    const spotify = snapshot(view).spotify || {};
    if (!spotify.connected || typeof view.context.bridge?.spotifyBrowse !== 'function' || view.homeLoading) return;
    view.homeLoading = true; view.homeAt = Date.now(); view.homeError = ''; view.homeAccess = JSON.stringify(spotify.access ?? null);
    if (mounted(view)) updateLibrary(view);
    try { view.home = await view.context.bridge.spotifyBrowse('home', force); }
    catch (error) { view.homeError = safeMessage(error); }
    finally { view.homeLoading = false; if (mounted(view)) updateLibrary(view); }
  }
  // Library playlists filter as you type; Spotify is searched once typing pauses.
  function scheduleSearch(view, immediate = false) {
    clearTimeout(view.searchTimer); view.searchTimer = 0;
    const term = view.filter.trim();
    if (term.length < 2 || !snapshot(view).spotify?.connected || typeof view.context.bridge?.spotifyBrowse !== 'function') return;
    if (view.search?.query === term && !view.search.error) return;
    view.searchTimer = setTimeout(() => { view.searchTimer = 0; searchSpotify(view, term); }, immediate ? 0 : 450);
  }
  async function searchSpotify(view, term) {
    const sequence = ++view.searchSequence; view.search = { query: term, loading: true };
    if (mounted(view)) updateLibrary(view);
    let result;
    try { const data = await view.context.bridge.spotifyBrowse('search', term); result = { query: term, items: Array.isArray(data?.items) ? data.items : [] }; }
    catch (error) { result = snapshot(view).spotify?.connected ? { query: term, error: safeMessage(error) } : null; }
    if (sequence !== view.searchSequence) return;
    view.search = result; if (mounted(view)) updateLibrary(view);
  }
  function playPlaylist(view, selected) {
    return run(view, `playlist:${selected.uri}`, async () => {
      const connected = snapshot(view).spotify?.connected === true;
      if (connected && typeof view.context.bridge?.spotify === 'function') {
        const result = await view.context.bridge.spotify('play', selected.uri);
        view.notice = `Playback request sent to ${safeMessage(result?.deviceName, 'your active Spotify device')}.`;
      } else {
        const stillSaved = (snapshot(view).config?.music?.savedPlaylists || []).some(item => item.uri === selected.uri);
        if (!stillSaved || typeof view.context.bridge?.openPlaylist !== 'function') throw new Error('Save this playlist link before opening it.');
        const result = await view.context.bridge.openPlaylist(selected.uri);
        view.notice = safeMessage(result?.message, 'Opened playlist in Spotify. Start playback there.');
      }
      view.context.toast?.(view.notice);
    });
  }
  function trackRow(item, { onPlay, current, index, art = true } = {}) {
    const row = el(onPlay ? 'button' : 'div', 'emw-track');
    if (!onPlay) row.setAttribute('role', 'listitem');
    if (onPlay) { row.type = 'button'; row.addEventListener('click', onPlay); row.setAttribute('aria-label', `Play ${item.name} by ${item.artists || 'unknown artist'}`); }
    row.dataset.uri = item.uri || '';
    row.classList.toggle('is-current', !!current);
    const thumb = cover('emw-track-art'); updateCover(thumb, item.artwork, '');
    const copy = el('span', 'emw-track-copy'); copy.append(el('span', 'emw-track-name', item.name), el('span', 'emw-track-artist', [item.explicit ? 'E' : '', item.artists].filter(Boolean).join(' · ')));
    row.append(...(Number.isInteger(index) ? [el('span', 'emw-track-index', index + 1)] : []), ...(art ? [thumb.root] : []), copy, el('span', 'emw-track-time', item.durationMs ? time(item.durationMs) : ''));
    return row;
  }
  function deviceIcon(type) { return /computer/i.test(type) ? 'computer' : /smartphone|tablet/i.test(type) ? 'phone' : /tv|cast|stb/i.test(type) ? 'tv' : 'speaker'; }
  function updateSheet(view) {
    const n = view.nodes; n.sheet.hidden = !view.devicesOpen; if (!view.devicesOpen) return;
    const active = spotifyPlayer(view)?.device?.id;
    n.deviceList.replaceChildren(...(view.devices || []).map(device => {
      const row = el('button', 'emw-device'); row.type = 'button'; row.classList.toggle('is-active', device.id === active || device.active);
      const glyph = el('span', 'emw-device-glyph'); glyph.append(icon(deviceIcon(device.type)));
      const copy = el('span', 'emw-device-copy'); copy.append(el('span', 'emw-device-name', device.name), el('span', 'emw-device-type', device.id === active || device.active ? 'Listening on' : device.type));
      row.append(glyph, copy); if (device.id === active || device.active) row.append(icon('check'));
      row.disabled = device.restricted || view.pending.has('transfer');
      row.addEventListener('click', () => command(view, 'transfer', null, null, async () => { await playerAction(view, 'transfer', device.id); view.devicesOpen = false; view.devices = null; }));
      return row;
    }));
    n.sheetHelp.textContent = view.devicesError || (!view.devices ? 'Looking for devices…' : view.devices.length ? '' : 'No Spotify devices are online. Open Spotify on a device first.');
    n.sheetHelp.hidden = !n.sheetHelp.textContent;
  }
  function updateQueue(view) {
    const n = view.nodes; const spotify = spotifyPlayer(view);
    if (view.tab === 'queue' && spotify && view.queueFor && view.queueFor !== spotify.track.uri) loadQueue(view, true);
    const data = spotify ? view.queueData : null;
    const rows = [];
    if (data?.current) { rows.push(el('p', 'emw-section-label', 'Now playing')); rows.push(trackRow(data.current, { current: true })); }
    if (data?.items?.length) { rows.push(el('p', 'emw-section-label', 'Next up')); for (const item of data.items) rows.push(trackRow(item)); }
    const signature = JSON.stringify([data?.current?.uri, data?.items?.map(item => [item.uri, !!item.artwork])]);
    if (n.queueList.dataset.signature !== signature) { n.queueList.dataset.signature = signature; n.queueList.replaceChildren(...rows); }
    n.queueEmpty.textContent = !snapshot(view).spotify?.connected ? 'Connect Spotify in Library to see what plays next.'
      : !spotify ? 'Start playing on a Spotify device to see the queue.' : view.queueError || (view.queueLoading && !data ? 'Loading queue…' : data && !data.items.length ? 'Nothing queued after this song.' : '');
    n.queueEmpty.hidden = !n.queueEmpty.textContent;
  }
  function updateDetail(view) {
    const n = view.nodes; const item = view.openItem; n.detail.hidden = !item; n.toolbar.hidden = !!item; n.libraryBody.hidden = !!item;
    if (!item) return;
    const type = typeNames[item.type] ? item.type : 'playlist'; const name = item.name || typeNames[type];
    n.detail.dataset.type = type; n.detailTitle.textContent = name; updateCover(n.detailArt, item.artwork, '');
    const data = view.playlistData; const current = spotifyPlayer(view)?.track?.uri;
    const total = Number.isInteger(data?.total) ? data.total : !data && Number.isInteger(item.totalTracks) ? item.totalTracks : null;
    n.detailMeta.textContent = [item.subtitle || typeNames[type], total === null ? '' : `${total} ${total === 1 ? 'song' : 'songs'}`].filter(Boolean).join(' · ');
    n.detailPlay.setAttribute('aria-disabled', String(!!view.busy)); n.detailPlay.setAttribute('aria-label', `Play ${name}`); n.detailPlay.title = `Play ${name}`;
    const signature = JSON.stringify([data?.uri, data?.items?.length, type]);
    if (n.detailList.dataset.signature !== signature) {
      n.detailList.dataset.signature = signature;
      n.detailList.replaceChildren(...(data?.items || []).map((track, index) => trackRow(track, { index, art: type !== 'album',
        onPlay: () => command(view, `track:${track.uri}`, null, null, () => playerAction(view, 'play-item', { contextUri: item.uri, trackUri: track.uri })) })));
    }
    for (const row of n.detailList.children) {
      const playing = !!current && row.dataset.uri === current; row.classList.toggle('is-current', playing);
      if (playing) row.setAttribute('aria-current', 'true'); else row.removeAttribute('aria-current');
    }
    const restricted = type === 'artist' ? 'Plays this artist on your Spotify device.'
      : type === 'album' ? 'Spotify did not list the songs on this album. You can still play it.'
        : 'Spotify only lets apps list songs from playlists you own or collaborate on. You can still play it.';
    if (type === 'playlist' && item.type === 'collection') n.detail.dataset.type = 'collection';
    n.detailHelp.textContent = view.playlistError || (!data ? 'Loading songs…' : data.restricted ? restricted : !data.items.length ? `This ${typeNames[type].toLowerCase()} has no songs Spotify can show here.` : data.total > data.items.length ? `Showing the first ${data.items.length} songs.` : '');
    n.detailHelp.hidden = !n.detailHelp.textContent;
  }

  // ---- Library ------------------------------------------------------------
  function library(view) {
    const state = snapshot(view); const spotify = state.spotify || {}; const entries = new Map();
    for (const item of state.config?.music?.savedPlaylists || []) {
      if (!item || !playlistPattern.test(item.uri) || typeof item.id !== 'string') continue;
      entries.set(item.uri, { ...item, savedId: item.id, saved: true });
    }
    if (spotify.connected) for (const item of spotify.playlists || []) {
      if (!item || !playlistPattern.test(item.uri)) continue;
      entries.set(item.uri, { ...entries.get(item.uri), ...item });
    }
    return [...entries.values()];
  }
  // Your Library like Spotify's mobile app: Liked Songs, your playlists,
  // Spotify-made playlists you played recently (Spotify no longer lists those to
  // apps), saved albums and the artists you follow.
  function likedItem(view) { const liked = view.home?.liked; return liked ? { ...liked, artwork: likedArtwork() } : null; }
  function libraryItems(view) {
    const playlists = library(view); const known = new Set(playlists.map(item => item.uri));
    const recent = (view.home?.recent || []).filter(item => item.type === 'playlist' && !known.has(item.uri) && known.add(item.uri)).map(item => ({ ...item, fromSpotify: true }));
    const albums = (view.home?.albums || []).filter(item => !known.has(item.uri) && known.add(item.uri));
    const artists = (view.home?.following || []).filter(item => !known.has(item.uri) && known.add(item.uri));
    return [likedItem(view), ...playlists, ...recent, ...albums, ...artists].filter(Boolean);
  }
  function createRow(view, item) {
    const root = el('article', 'emw-playlist'); root.setAttribute('role', 'listitem'); const art = cover('emw-playlist-art');
    const copy = el('button', 'emw-playlist-copy'); copy.type = 'button'; const title = el('h3'); const subtitle = el('p'); copy.append(title, subtitle);
    const row = { root, art, title, subtitle, copy, item };
    copy.addEventListener('click', () => {
      if (snapshot(view).spotify?.connected && typeof view.context.bridge?.spotifyBrowse === 'function') openCollection(view, row.item);
      else row.action.click();
    });
    row.action = button('Open playlist', () => playPlaylist(view, row.item), 'play', 'emw-playlist-action');
    row.remove = button('Remove saved playlist link', () => run(view, 'remove', async () => {
      if (typeof view.context.bridge?.removePlaylist !== 'function') throw new Error('Removing saved playlist links is unavailable.');
      publish(view, await view.context.bridge.removePlaylist(row.item.savedId)); view.notice = 'Saved playlist link removed.';
    }), 'remove', 'emw-remove');
    root.append(art.root, copy, row.action, row.remove); return row;
  }
  // A cover tile like Spotify's Home: open it, or play it straight away.
  function tile(view, item) {
    const root = el('div', `emw-tile is-${item.type}`); root.setAttribute('role', 'listitem');
    const open = el('button', 'emw-tile-open'); open.type = 'button'; open.title = item.name;
    const art = cover('emw-tile-art'); updateCover(art, item.artwork, '');
    open.append(art.root, el('span', 'emw-tile-name', item.name), el('span', 'emw-tile-sub', item.subtitle || typeNames[item.type] || ''));
    open.setAttribute('aria-label', `${item.type === 'track' ? 'Play' : 'Open'} ${item.name}, ${describe(item)}`);
    open.addEventListener('click', () => openItem(view, item)); root.append(open);
    if (item.type !== 'track') root.append(button(`Play ${item.name}, ${describe(item)}`, () => playPlaylist(view, item), 'play', 'emw-tile-play'));
    return root;
  }
  function shelf(view, title, items) {
    const section = el('section', 'emw-shelf'); section.setAttribute('aria-label', title);
    const row = el('div', 'emw-shelf-row'); row.setAttribute('role', 'list'); row.append(...items.map(item => tile(view, item)));
    section.append(el('h4', 'emw-section-label', title), row); return section;
  }
  function resultRow(view, item) {
    const root = el('article', `emw-result is-${item.type}`); root.setAttribute('role', 'listitem');
    const art = cover('emw-playlist-art'); updateCover(art, item.artwork, '');
    const copy = el('button', 'emw-playlist-copy'); copy.type = 'button'; copy.append(el('h3', '', item.name), el('p', '', item.subtitle || typeNames[item.type] || ''));
    copy.setAttribute('aria-label', `Open ${item.name}, ${describe(item)}`); copy.addEventListener('click', () => openItem(view, item));
    root.append(art.root, copy, button(`Play ${item.name}, ${describe(item)}`, () => playPlaylist(view, item), 'play', 'emw-playlist-action'));
    return root;
  }
  // The small cover-and-name shortcuts at the top of Spotify's Home.
  function shortcut(view, item) {
    const node = el('button', `emw-shortcut is-${item.type}`); node.type = 'button'; node.setAttribute('role', 'listitem');
    const art = cover('emw-shortcut-art'); updateCover(art, item.artwork, '');
    node.append(art.root, el('span', 'emw-shortcut-name', item.name));
    node.setAttribute('aria-label', `Open ${item.name}, ${describe(item)}`); node.title = item.name;
    node.addEventListener('click', () => openItem(view, item)); return node;
  }
  // Spotify no longer shares Discover Weekly with apps; its link is saved once
  // (Share → Copy link to playlist in Spotify) and it then stays first on Home.
  // Spotify's DJ: the same address for every account. Spotify does not list it
  // to apps, but it starts like a playlist on your active device.
  const DJ_URI = 'spotify:playlist:37i9dQZF1EYkqdzj48dyYq';
  function djTile(view) {
    const node = el('button', 'emw-shortcut emw-shortcut-dj'); node.type = 'button'; node.setAttribute('role', 'listitem');
    node.addEventListener('click', () => playPlaylist(view, { uri: DJ_URI, name: 'DJ', type: 'playlist' }));
    const art = el('span', 'emw-shortcut-art emw-dj-art'); art.append(el('span', 'emw-dj-mark', 'DJ'));
    node.append(art, el('span', 'emw-shortcut-name', 'DJ'));
    node.setAttribute('aria-label', 'Play DJ, your personal AI DJ on Spotify'); node.title = 'DJ'; return node;
  }
  function weeklyTile(view) {
    const node = el('button', 'emw-shortcut emw-shortcut-weekly'); node.type = 'button';
    node.addEventListener('click', () => {
      view.tab = 'library'; view.browseTab = 'library'; view.openItem = null; view.adding = true; view.error = '';
      view.nameDraft = 'Discover Weekly'; view.nodes.name.value = 'Discover Weekly';
      update(view); setTimeout(() => view.nodes.link.focus({ preventScroll: true }), 0);
    });
    node.setAttribute('role', 'listitem');
    const art = el('span', 'emw-shortcut-art emw-weekly-art'); art.append(icon('plus'));
    node.append(art, el('span', 'emw-shortcut-name', 'Add Discover Weekly'));
    node.setAttribute('aria-label', 'Add Discover Weekly: paste its link from Spotify'); return node;
  }
  const madeForYou = /discover weekly|release radar|daily mix|on repeat|repeat rewind|daylist|time capsule|blend|radar/i;
  function updateHome(view, visible) {
    const n = view.nodes; n.home.hidden = !visible;
    if (!visible) return;
    const spotify = snapshot(view).spotify || {}; const data = view.home;
    const saved = library(view).map(item => ({ ...item, type: 'playlist', subtitle: item.subtitle || 'Playlist' }));
    const recent = Array.isArray(data?.recent) ? data.recent : [];
    const seen = new Set(); const unique = items => items.filter(item => item?.uri && !seen.has(item.uri) && seen.add(item.uri));
    const made = unique([...recent, ...saved].filter(item => madeForYou.test(item.name || '')))
      .sort((a, b) => /discover weekly/i.test(b.name) - /discover weekly/i.test(a.name));
    seen.clear();
    // Discover Weekly first, then what you played recently, then your playlists: eight in all.
    const liked = likedItem(view);
    const top = unique([...(liked ? [liked] : []), ...made.filter(item => /discover weekly/i.test(item.name)), ...recent, ...saved]).slice(0, 8);
    // DJ always leads; "Add Discover Weekly" takes a slot until its link is saved.
    const needsWeekly = spotify.connected && !made.some(item => /discover weekly/i.test(item.name || '')) && typeof view.context.bridge?.savePlaylist === 'function';
    const extras = [...(spotify.connected ? ['dj'] : []), ...(needsWeekly ? ['weekly'] : [])];
    const shown = top.slice(0, Math.max(0, 8 - extras.length));
    const weeklySignature = JSON.stringify(shown.map(item => [item.uri, item.name, !!item.artwork])) + extras.join('|');
    if (n.shortcuts.dataset.signature !== weeklySignature) { n.shortcuts.dataset.signature = weeklySignature; n.shortcuts.replaceChildren(...(extras.includes('dj') ? [djTile(view)] : []), ...shown.map(item => shortcut(view, item)), ...(needsWeekly ? [weeklyTile(view)] : [])); }
    n.shortcuts.hidden = !top.length;
    const sections = [['Made for you', made], ['Jump back in', recent], ['Your top artists', data?.artists], ['Your albums', data?.albums], ['Your playlists', saved.slice(0, 20)]]
      .filter(([, items]) => Array.isArray(items) && items.length);
    const signature = JSON.stringify(sections.map(([title, items]) => [title, items.map(item => [item.uri, item.name, !!item.artwork])]));
    if (n.shelves.dataset.signature !== signature) { n.shelves.dataset.signature = signature; n.shelves.replaceChildren(...sections.map(([title, items]) => shelf(view, title, items))); }
    for (const node of n.shelves.querySelectorAll('.emw-tile-play, .emw-tile.is-track > .emw-tile-open')) node.setAttribute('aria-disabled', String(!!view.busy));
    n.homeNotice.hidden = !data?.missing?.length;
    n.homeNoticeCopy.textContent = 'Reconnect Spotify to show what you played recently, your top artists and saved albums.';
    n.reconnect.textContent = spotify.connecting ? 'Connecting…' : 'Reconnect';
    n.reconnect.disabled = !!view.busy || !!spotify.connecting || typeof view.context.bridge?.spotify !== 'function';
    n.homeHelp.textContent = view.homeError || (view.homeLoading && !data ? 'Loading your Spotify home…' : '');
    n.homeHelp.hidden = !n.homeHelp.textContent;
  }
  function updateResults(view, term) {
    const n = view.nodes; n.results.hidden = !term;
    if (!term) return;
    const found = view.search?.query === term ? view.search : null; const items = found?.items || [];
    const signature = JSON.stringify([term, items.map(item => [item.uri, !!item.artwork])]);
    if (n.resultsList.dataset.signature !== signature) { n.resultsList.dataset.signature = signature; n.resultsList.replaceChildren(...items.map(item => resultRow(view, item))); }
    for (const node of n.resultsList.querySelectorAll('.emw-playlist-action')) node.setAttribute('aria-disabled', String(!!view.busy));
    n.resultsHelp.textContent = found?.error || (!found || found.loading ? 'Searching Spotify…' : !items.length ? 'Nothing found on Spotify.' : '');
    n.resultsHelp.hidden = !n.resultsHelp.textContent;
  }
  function updateLibrary(view) {
    if (!view.nodes) return;
    const state = snapshot(view); const spotify = state.spotify || {}; const n = view.nodes;
    const page = browsePage(view); const searching = page === 'search';
    const query = searching ? view.filter.trim().toLocaleLowerCase() : ''; const all = libraryItems(view);
    const term = searching && spotify.connected && view.filter.trim().length >= 2 ? view.filter.trim() : '';
    if (term && view.search?.query !== term && !view.searchTimer) scheduleSearch(view);
    updateHome(view, page === 'home' && !!spotify.connected); updateResults(view, term);
    // Search lists matching playlists only once something is typed.
    n.list.hidden = page === 'home' || (searching && !query);
    const items = all.filter(item => String(item.name || 'Untitled playlist').toLocaleLowerCase().includes(query));
    const keep = new Set();
    items.forEach((item, index) => {
      let row = view.rows.get(item.uri); if (!row) { row = createRow(view, item); view.rows.set(item.uri, row); }
      keep.add(item.uri); row.item = item; const name = String(item.name || 'Untitled playlist'); row.title.textContent = name;
      const count = Number.isInteger(item.totalTracks) && item.totalTracks >= 0 ? `${item.totalTracks} ${item.totalTracks === 1 ? 'song' : 'songs'}` : '';
      row.subtitle.textContent = item.type === 'collection' ? item.subtitle : item.type && item.type !== 'playlist' ? item.subtitle || typeNames[item.type]
        : [item.savedId ? 'Saved link' : 'Playlist', item.fromSpotify || item.madeBySpotify ? item.by || '' : count].filter(Boolean).join(' · ');
      row.root.classList.toggle('is-artist', item.type === 'artist');
      updateCover(row.art, item.artwork, `Cover for ${name}`);
      const canPlay = spotify.connected && typeof view.context.bridge?.spotify === 'function';
      const mode = canPlay ? 'play' : 'open';
      if (row.mode !== mode) { if (canPlay) setIcon(row.action, 'play'); else { row.action.replaceChildren(document.createTextNode('Open')); delete row.action.dataset.icon; } row.mode = mode; }
      row.action.setAttribute('aria-label', canPlay ? `Play ${name}` : `Open ${name} in Spotify`); row.action.title = canPlay ? `Play ${name}` : 'Open in Spotify; start playback there';
      row.copy.setAttribute('aria-label', canPlay ? `Show songs in ${name}` : `Open ${name}`);
      row.action.disabled = !canPlay && typeof view.context.bridge?.openPlaylist !== 'function'; row.action.setAttribute('aria-disabled', String(!!view.busy));
      row.remove.hidden = !item.savedId; row.remove.disabled = !!view.busy || typeof view.context.bridge?.removePlaylist !== 'function';
      row.remove.setAttribute('aria-label', `Remove saved link for ${name}`);
      if (n.list.children[index] !== row.root) n.list.insertBefore(row.root, n.list.children[index] || null);
    });
    for (const [key, row] of view.rows) if (!keep.has(key)) { row.root.remove(); view.rows.delete(key); }
    n.listLabel.hidden = !spotify.connected || !items.length || page !== 'search';
    n.listLabel.textContent = 'In your library';
    n.empty.hidden = !!items.length || !!term || page === 'home' || (searching && !query); n.emptyTitle.textContent = query ? 'No matching playlists' : 'Your playlists, right here';
    n.emptyCopy.textContent = query ? 'Try another name.' : spotify.connected ? spotify.loaded ? 'Spotify returned no playlists. Save a link or refresh your library.' : 'Refresh to load your Spotify library, or save a playlist link.' : 'Add a Spotify playlist link to keep it on your dashboard.';
    const missingFollow = view.home?.missing?.includes('following');
    n.libraryHelp.textContent = spotify.connected ? [spotify.hasMore ? 'Showing the first 500 Spotify playlists.' : '', view.tab === 'library' ? 'Spotify-made playlists (like Discover Weekly) appear here once you play them, since Spotify no longer lists them to apps.' : '', view.tab === 'library' && missingFollow ? 'Reconnect Spotify in Music settings to also show the artists you follow.' : ''].filter(Boolean).join(' ') : all.length ? 'Saved links open in Spotify. Start playback there.' : '';
    n.libraryHelp.hidden = !n.libraryHelp.textContent;
  }

  // ---- Now Playing --------------------------------------------------------
  function paintProgress(view, fraction) {
    const n = view.nodes; const { at, duration } = position(view);
    const shown = fraction === undefined ? (duration ? at / duration : 0) : fraction;
    n.miniFill.style.width = `${Math.max(0, Math.min(1, shown)) * 100}%`;
    if (!view.seeking || fraction !== undefined) n.seek.value = String(Math.round(shown * 1000));
    n.seek.style.setProperty('--progress', `${shown * 100}%`);
    n.elapsed.textContent = time(shown * duration); n.remaining.textContent = `-${time(Math.max(0, duration - shown * duration))}`;
  }
  function tick() {
    for (const view of live) {
      if (!mounted(view)) { live.delete(view); continue; }
      if (!view.seeking && effective(view).mode === 'spotify') paintProgress(view);
    }
  }
  // Progress repaints four times a second; low power runs the timer at 1 Hz.
  let ticker = 0, tickMs = 0;
  function setLowPower(value) {
    const ms = value === true ? 1000 : 250;
    if (ms === tickMs) return; // called on every render: keep the timer's rhythm
    clearInterval(ticker); tickMs = ms; ticker = setInterval(tick, ms); tick();
  }
  setLowPower(false);
  function greeting() { const hour = new Date().getHours(); return hour < 5 ? 'Good night' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'; }
  function update(view) {
    if (!view.nodes) return; const state = snapshot(view); const media = state.media || {}; const spotify = state.spotify || {}; const n = view.nodes;
    if (spotify.connected && view.session !== spotify.session) {
      if (view.session !== undefined) { view.home = null; view.homeAt = 0; view.search = null; view.openItem = null; view.playlistData = null; }
      view.session = spotify.session;
    }
    const player = effective(view); const api = spotifyPlayer(view);
    view.root.setAttribute('aria-busy', String(!!view.busy || view.pending.size > 0));
    view.root.dataset.mode = player.mode;
    const browsing = view.tab !== 'now';
    // Both stay rendered; the sheet slides. Only the side in front takes input.
    n.now.inert = browsing; n.browse.inert = !browsing;
    view.root.classList.toggle('is-minimised', browsing);
    if (!view.root.classList.contains('is-dragging')) placeSheet(view); const page = browsePage(view); n.queue.hidden = page !== 'queue'; n.playlists.hidden = !['home', 'search', 'library'].includes(page);
    view.root.dataset.view = view.tab;
    for (const [id, tab] of [['home', n.homeTab], ['search', n.searchTab], ['library', n.listTab]]) tab.setAttribute('aria-pressed', String(page === id || (page === 'queue' && view.browseTab === id)));
    view.root.dataset.page = page;
    n.pageTitle.textContent = page === 'search' ? 'Search' : page === 'library' ? 'Your Library' : greeting();
    n.search.closest('.emw-search').hidden = page !== 'search';
    n.add.hidden = n.refresh.hidden = page !== 'library'; n.setup.hidden = page === 'search';
    const connected = player.mode === 'spotify' || media.connected;
    const track = api?.track;
    const title = player.mode === 'spotify' ? track.name : media.connected ? media.title || 'Untitled track' : 'Put something on';
    const artistName = player.mode === 'spotify' ? track.artists || 'Unknown artist' : media.connected ? media.artist || 'Artist not reported' : 'Open Spotify or another media app';
    if (n.song.textContent !== title) n.song.textContent = title;
    n.song.title = title; n.artist.textContent = artistName;
    const cover = player.mode === 'spotify' ? track.artwork : media.connected ? media.artwork : '';
    updateCover(n.art, cover, `Cover for ${title}`);
    const ambient = artwork(cover);
    if (n.ambientImage.dataset.value !== ambient) {
      n.ambientImage.dataset.value = ambient;
      if (!ambient) { n.ambientImage.hidden = true; n.ambientImage.removeAttribute('src'); view.root.classList.remove('has-artwork'); }
      else blurredAmbient(ambient, blurred => {
        if (n.ambientImage.dataset.value !== ambient) return;
        n.ambientImage.hidden = !blurred; view.root.classList.toggle('has-artwork', !!blurred);
        if (blurred) n.ambientImage.src = blurred;
      });
    }
    // Canvas: the song's looping video behind the card, while it plays.
    const canvas = state.spotifyCanvas || {};
    const canvasUrl = player.mode === 'spotify' && canvas.url && canvas.trackUri === track?.uri && /^https:\/\/canvaz\.scdn\.co\//.test(canvas.url) ? canvas.url : '';
    if (n.canvasVideo.dataset.value !== canvasUrl) {
      n.canvasVideo.dataset.value = canvasUrl;
      if (canvasUrl) { n.canvasVideo.src = canvasUrl; n.canvasVideo.hidden = false; } else { n.canvasVideo.removeAttribute('src'); n.canvasVideo.load(); n.canvasVideo.hidden = true; }
    }
    view.root.classList.toggle('has-canvas', !!canvasUrl);
    const still = document.documentElement.classList.contains('low-power') || matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (canvasUrl && player.isPlaying && !still && !browsing) { if (n.canvasVideo.paused) n.canvasVideo.play().catch(() => {}); }
    else if (!n.canvasVideo.paused) n.canvasVideo.pause();
    n.hero.classList.toggle('is-changing', !!player.changing);
    // Device line: Spotify Connect device, or the Windows media source.
    const device = api?.device;
    // Top line, as in Spotify: what the song plays from (its album here).
    n.nowContext.textContent = player.mode === 'spotify' && track?.album ? track.album : media.connected && media.album ? media.album : 'Now playing';
    // Mini player
    n.mini.hidden = !connected;
    updateCover(n.miniArt, cover, '');
    n.miniTitle.textContent = title; n.miniSub.textContent = device ? `${artistName} · ${device.name}` : artistName;
    n.mini.querySelector('.emw-mini-open').setAttribute('aria-label', `Open player: ${title}, ${artistName}`);
    setIcon(n.miniPlay, player.isPlaying ? 'pause' : 'play');
    n.miniPlay.setAttribute('aria-label', player.isPlaying ? 'Pause playback' : 'Play'); n.miniPlay.title = n.miniPlay.getAttribute('aria-label');
    n.miniPlay.disabled = player.mode !== 'spotify' && !(typeof view.context.bridge?.media === 'function' && media.connected);
    n.miniDevices.hidden = !spotify.connected;
    n.source.replaceChildren(icon(device ? deviceIcon(device.type) : 'music'), document.createTextNode(device ? `${player.isPlaying ? 'Playing on' : 'Paused on'} ${device.name}` : media.connected ? media.source || 'Windows media' : spotify.connected ? 'Spotify connected · no active device' : ''));
    n.source.disabled = !spotify.connected; n.source.hidden = !n.source.textContent;
    n.source.setAttribute('aria-label', device ? `Playing on ${device.name}. Choose a device` : 'Choose a Spotify device');
    // Like
    n.like.hidden = !(player.mode === 'spotify' && track.type === 'track');
    n.like.classList.toggle('is-active', player.liked === true);
    n.like.setAttribute('aria-pressed', String(player.liked === true));
    n.like.setAttribute('aria-label', player.liked ? 'Remove from Liked Songs' : 'Add to Liked Songs'); n.like.title = n.like.getAttribute('aria-label');
    n.like.disabled = view.pending.has('like');
    // Progress
    n.progress.hidden = player.mode !== 'spotify';
    n.seek.disabled = player.mode !== 'spotify' || !api.can?.seek || !track.durationMs;
    if (!view.seeking) paintProgress(view);
    // Transport
    setIcon(n.play, player.isPlaying ? 'pause' : 'play');
    n.play.setAttribute('aria-label', player.isPlaying ? 'Pause playback' : 'Play'); n.play.title = n.play.getAttribute('aria-label');
    const windowsAvailable = typeof view.context.bridge?.media === 'function' && media.connected;
    if (player.mode === 'spotify') {
      n.previous.disabled = api.can?.previous === false; n.next.disabled = api.can?.next === false; n.play.disabled = false;
    } else {
      n.previous.disabled = !windowsAvailable || media.canPrevious !== true;
      n.play.disabled = !windowsAvailable || (media.playing ? media.canPause : media.canPlay) !== true;
      n.next.disabled = !windowsAvailable || media.canNext !== true;
    }
    n.shuffle.hidden = n.repeat.hidden = player.mode !== 'spotify';
    n.shuffle.classList.toggle('is-active', !!player.shuffle); n.shuffle.setAttribute('aria-pressed', String(!!player.shuffle));
    n.shuffle.disabled = player.mode === 'spotify' && api.can?.shuffle === false;
    n.repeat.classList.toggle('is-active', player.repeat && player.repeat !== 'off'); n.repeat.dataset.repeat = player.repeat || 'off';
    n.repeat.setAttribute('aria-label', player.repeat === 'track' ? 'Repeat song' : player.repeat === 'context' ? 'Repeat all' : 'Repeat off'); n.repeat.title = n.repeat.getAttribute('aria-label');
    n.repeat.disabled = player.mode === 'spotify' && api.can?.repeat === false;
    // Volume: Spotify's own level and the Windows system volume.
    const controls = volumeControls(view);
    for (const [kind, node] of [['spotify', n.spotifyVolume], ['system', n.systemVolume]]) {
      const control = controls[kind]; const slider = view.sliders[kind];
      node.row.hidden = !control;
      if (!control) { slider.source = ''; slider.hold = null; continue; }
      node.range.hidden = !!control.note; node.note.hidden = !control.note; node.note.textContent = control.note || ''; node.note.title = control.note || '';
      node.row.classList.toggle('is-note', !!control.note);
      if (control.note) { slider.source = control.source; slider.hold = null; continue; }
      node.range.title = control.title; node.range.disabled = !!control.disabled;
      // Keep the user's draft while they adjust, and a new level until the source
      // reports it; otherwise follow the source, and always when it switches.
      const hold = slider.hold?.source === control.source && Date.now() < slider.hold.until && Math.round(control.value) !== slider.hold.value ? slider.hold : null;
      slider.hold = hold;
      const adjusting = slider.adjusting && Date.now() - (slider.pressedAt || 0) < 15000;
      const recentlyTouched = document.activeElement === node.range && Date.now() - (slider.touchedAt || 0) < 1500;
      if (slider.source !== control.source || (!adjusting && !slider.sending && !recentlyTouched)) {
        slider.source = control.source;
        const shown = hold ? hold.value : control.value;
        node.range.value = Number.isFinite(shown) ? String(Math.round(shown)) : '0'; slider.draft = Number(node.range.value);
      }
      node.range.style.setProperty('--volume', `${node.range.value}%`);
    }
    n.devicesButton.hidden = !spotify.connected; n.queueButton.hidden = player.mode !== 'spotify';
    n.mediaHelp.textContent = [!connected && media.error ? safeMessage(media.error) : '', spotify.playerError && spotify.connected ? safeMessage(spotify.playerError) : ''].filter(Boolean).join(' ');
    n.mediaHelp.hidden = !n.mediaHelp.textContent;
    // Library
    n.form.hidden = !view.adding; n.add.setAttribute('aria-expanded', String(view.adding));
    n.add.disabled = !!view.busy || typeof view.context.bridge?.savePlaylist !== 'function';
    n.refresh.disabled = typeof view.context.bridge?.spotify !== 'function' || (!spotify.connected && !spotify.connecting); n.refresh.setAttribute('aria-disabled', String(!!view.busy));
    n.setup.disabled = typeof view.context.onSetup !== 'function';
    for (const node of [n.save, n.cancel]) node.setAttribute('aria-disabled', String(!!view.busy));
    n.name.readOnly = n.link.readOnly = !!view.busy;
    n.connection.hidden = !!spotify.connected;
    n.search.setAttribute('aria-label', spotify.connected ? 'Search Spotify' : 'Search playlists');
    n.search.placeholder = spotify.connected ? 'Playlists, albums, artists' : 'Search playlists';
    n.connectionCopy.textContent = spotify.connecting ? 'Finish signing in through your browser, then refresh your playlists.' : 'Save links, or connect Spotify to play your library here.';
    n.connect.textContent = spotify.connecting ? 'Connecting…' : 'Connect Spotify';
    n.connect.disabled = !!view.busy || !!spotify.connecting || (spotify.clientIdConfigured ? typeof view.context.bridge?.spotify !== 'function' : typeof view.context.onSetup !== 'function');
    const inLibrary = ['home', 'search', 'library'].includes(view.tab);
    const feedback = view.error || (inLibrary && spotify.error ? safeMessage(spotify.error) : '') || view.notice || (view.busy ? 'Working…' : '');
    n.feedback.textContent = feedback; n.feedback.hidden = !feedback; n.feedback.classList.toggle('is-error', !!view.error || !!(inLibrary && spotify.error));
    n.feedback.setAttribute('role', n.feedback.classList.contains('is-error') ? 'alert' : 'status');
    updateLibrary(view); updateDetail(view); updateQueue(view); updateSheet(view);
    if (!spotify.connected) { view.home = null; view.homeAt = 0; view.search = null; }
    else if (['home', 'search', 'library'].includes(browsePage(view)) && !view.openItem && !view.homeLoading &&
      (Date.now() - view.homeAt > 300000 || view.homeAccess !== JSON.stringify(spotify.access ?? null))) loadHome(view);
  }
  function render(container, context) {
    let view = views.get(container);
    if (!view) {
      view = { container, context, root: null, tab: 'now', browseTab: 'home', swiped: false, filter: '', adding: false, nameDraft: '', linkDraft: '', busy: '', error: '', notice: '',
        sliders: { spotify: { queued: null, sending: false, adjusting: false }, system: { queued: null, sending: false, adjusting: false } },
        pending: new Set(), override: null, seeking: false, devicesOpen: false, devices: null, queueData: null, openItem: null, playlistData: null,
        home: null, homeAt: 0, homeLoading: false, homeError: '', homeAccess: '', search: null, searchSequence: 0, searchTimer: 0 };
      views.set(container, view);
    }
    view.context = context;
    if (!view.root || view.root.parentElement !== container) build(view);
    live.add(view);
    update(view); return true;
  }
  window.EdgeMediaWidget = Object.freeze({ render, setLowPower });
})();
