'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');

// This helper mounts a separate widget with a fully fake bridge. It must never
// delegate media, authorization, playlist opening, or storage to window.edge.
async function verifyMediaWidget(page, directory) {
  await page.evaluate(() => {
    if (!window.EdgeMediaWidget) throw new Error('Music widget module was not loaded.');
    const container = document.createElement('div'); container.id = 'media-widget-verification';
    Object.assign(container.style, { position: 'fixed', left: '24px', top: '24px', width: '550px', height: '512px', padding: '30px',
      background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: '22px', zIndex: '1000' });
    document.body.append(container);
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 32;
    const paint = canvas.getContext('2d'); paint.fillStyle = '#692a3a'; paint.fillRect(0, 0, 32, 32);
    paint.fillStyle = '#f0a6b7'; paint.fillRect(8, 8, 16, 16);
    const fixture = { container, calls: [], browse: [], setup: 0, artwork: canvas.toDataURL('image/png') };
    fixture.model = {
      config: { music: { savedPlaylists: [{ id: 'saved-1', name: 'Evening favourites', uri: 'spotify:playlist:1234567890ABCDEFGHIJKL' }] } },
      media: { connected: true, title: 'Fixture track', artist: 'Fixture artist', source: 'Spotify', playing: true, volume: 32,
        canPlay: true, canPause: true, canPrevious: true, canNext: true, artwork: fixture.artwork },
      spotify: { connected: false, clientIdConfigured: false, playlists: [], loaded: false },
    };
    fixture.context = {
      getState: () => fixture.model,
      bridge: {
        media: async (action, value) => {
          fixture.calls.push({ method: 'media', action, ...(value === undefined ? {} : { value }) });
          return { ...fixture.model.media, ...(action === 'volume' ? { volume: value } : action === 'spotify-volume' ? { spotifyVolume: value } : action === 'play-pause' ? { playing: !fixture.model.media.playing } : {}) };
        },
        spotify: async (action, value) => {
          fixture.calls.push({ method: 'spotify', action, ...(value === undefined ? {} : { value }) });
          return action === 'play' ? { requested: true, deviceName: 'Fixture player' } : fixture.model.spotify;
        },
        savePlaylist: async item => {
          fixture.calls.push({ method: 'save', item });
          return { ...fixture.model, config: { ...fixture.model.config, music: { savedPlaylists: [...fixture.model.config.music.savedPlaylists, { id: 'saved-2', ...item }] } } };
        },
        removePlaylist: async id => {
          fixture.calls.push({ method: 'remove', id });
          return { ...fixture.model, config: { ...fixture.model.config, music: { savedPlaylists: fixture.model.config.music.savedPlaylists.filter(item => item.id !== id) } } };
        },
        spotifyPlayer: async (action, value) => {
          fixture.calls.push({ method: 'player', action, ...(value === undefined ? {} : { value }) });
          const player = fixture.model.spotify.player;
          if (action === 'shuffle') player.shuffle = value;
          if (action === 'seek') player.progressMs = value;
          return { ...fixture.model, spotify: { ...fixture.model.spotify, player: { ...player, fetchedAt: Date.now() } } };
        },
        spotifyBrowse: async (kind, value) => {
          // The home feed and searches load by themselves; they are recorded apart from taps.
          if (kind === 'home' || kind === 'search') {
            fixture.browse.push({ kind, value });
            if (kind === 'search') return { query: value, items: [{ uri: 'spotify:playlist:1234567890ABCDEFGHIJKZ', type: 'playlist', name: 'Found mix', subtitle: 'Playlist · Spotify', by: 'Spotify', artwork: fixture.artwork },
              { uri: 'spotify:artist:1234567890ABCDEFGHIJKY', type: 'artist', name: 'Found artist', subtitle: 'Artist' }] };
            return { recent: [{ uri: 'spotify:playlist:1234567890ABCDEFGHIJKX', type: 'playlist', name: 'Daily Mix 1', subtitle: 'Playlist', artwork: fixture.artwork },
              { uri: 'spotify:album:1234567890ABCDEFGHIJKW', type: 'album', name: 'Recent album', subtitle: 'Duo', by: 'Duo', artwork: fixture.artwork },
              { uri: 'spotify:track:1234567890ABCDEFGHIJKV', type: 'track', name: 'Single song', subtitle: 'Singer', by: 'Singer' }],
              artists: [{ uri: 'spotify:artist:1234567890ABCDEFGHIJKU', type: 'artist', name: 'Top artist', subtitle: 'Artist', artwork: fixture.artwork }], albums: [], missing: ['albums'] };
          }
          fixture.calls.push({ method: 'browse', kind, ...(value === undefined ? {} : { value }) });
          if (value === 'spotify:playlist:1234567890ABCDEFGHIJKX') return { uri: value, items: [], total: null, restricted: true };
          if (kind === 'devices') return [{ id: 'tv', name: 'Living room TV', type: 'TV', active: true, restricted: false }, { id: 'pc', name: 'Desk PC', type: 'Computer', active: false, restricted: false }];
          if (kind === 'queue') return { current: { uri: 'spotify:track:1234567890ABCDEFGHIJKA', name: 'API track', artists: 'API artist' }, items: [{ uri: 'spotify:track:1234567890ABCDEFGHIJKB', name: 'Next song', artists: 'Someone', durationMs: 200000 }] };
          return { uri: value, total: 1, items: [{ uri: 'spotify:track:1234567890ABCDEFGHIJKC', name: 'Playlist song', artists: 'Band', durationMs: 180000 }] };
        },
        openPlaylist: async uri => {
          fixture.calls.push({ method: 'open', uri });
          return { opened: true, message: 'Opened playlist in Spotify. Start playback there.' };
        },
      },
      updateState: next => { fixture.model = next; window.EdgeMediaWidget.render(container, fixture.context); },
      toast: () => {}, onSetup: () => { fixture.setup++; },
    };
    window.__mediaWidgetFixture = fixture;
    window.EdgeMediaWidget.render(container, fixture.context);
  });
  const fixture = page.locator('#media-widget-verification');
  const count = () => page.evaluate(() => window.__mediaWidgetFixture.calls.length);
  const waitCount = expected => page.waitForFunction(value => window.__mediaWidgetFixture.calls.length === value, expected);
  const lastCall = () => page.evaluate(() => window.__mediaWidgetFixture.calls.at(-1));
  const checks = [];
  try {
    assert.equal(await count(), 0, 'Mounting the music widget calls no services');
    await fixture.locator('.song-cover').evaluate(image => image.decode());
    assert.ok(await fixture.locator('.song-cover').evaluate(image => image.naturalWidth > 0));
    await fixture.screenshot({ path: path.join(directory, 'music-widget-now-playing.png') });
    const measureControls = () => fixture.evaluate(root => {
      const bounds = root.getBoundingClientRect();
      const controls = [...root.querySelectorAll('.emw-transport button,.emw-volume input,.emw-seek')].filter(node => node.offsetParent).map(node => {
        const box = node.getBoundingClientRect(); return { label: node.getAttribute('aria-label'), width: box.width, height: box.height, top: box.top, bottom: box.bottom, left: box.left, right: box.right };
      });
      // No two touch boxes may overlap: a tap must land on the control it is nearest to.
      const overlap = controls.some((a, i) => controls.slice(i + 1).some(b => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5));
      return { bottom: bounds.bottom, controls, overlap, overflow: root.querySelector('.edge-media-widget').scrollWidth > root.clientWidth };
    });
    for (const compact of [false, true]) {
      await fixture.evaluate((root, small) => Object.assign(root.style, small ? { width: '348px', height: '302px', padding: '18px' } : { width: '552px', height: '514px', padding: '30px' }), compact);
      const layout = await measureControls(); assert.equal(layout.overflow, false);
      assert.ok(layout.controls.every(control => control.width >= 48 && control.height >= 48 && control.bottom <= layout.bottom), JSON.stringify(layout));
    }
    await fixture.evaluate(root => Object.assign(root.style, { width: '552px', height: '514px', padding: '30px' }));
    checks.push('Music cover renders from a raster data URL; playback and volume remain visible with 48px targets at native and compact sizes');

    // The player minimises to the browse pages with a tab bar, as in Spotify's mobile app.
    await fixture.getByRole('button', { name: 'Minimise player', exact: true }).click();
    // The player slides out as a sheet: minimised, inert and moved down out of the card.
    await page.waitForTimeout(500);
    assert.deepEqual(await fixture.locator('.edge-media-widget').evaluate(root => { const now = root.querySelector('.emw-now'); const card = root.closest('.container-card') || root; return [root.classList.contains('is-minimised'), now.inert, now.getBoundingClientRect().top >= card.getBoundingClientRect().bottom - 2]; }), [true, true, true]);
    assert.equal(await fixture.locator('.emw-tabbar').isVisible(), true);
    await fixture.getByRole('button', { name: 'Your Library', exact: true }).click();
    assert.equal(await fixture.getByRole('button', { name: 'Your Library', exact: true }).getAttribute('aria-pressed'), 'true');
    assert.equal(await page.evaluate(() => window.__mediaWidgetFixture.setup), 0);
    assert.equal(await count(), 0);
    await fixture.getByRole('button', { name: 'Open Evening favourites in Spotify', exact: true }).click();
    await waitCount(1);
    assert.deepEqual(await lastCall(), { method: 'open', uri: 'spotify:playlist:1234567890ABCDEFGHIJKL' });
    assert.match(await fixture.locator('.emw-feedback').textContent(), /Start playback there/);
    await fixture.getByRole('button', { name: 'Connect Spotify', exact: true }).click();
    assert.equal(await page.evaluate(() => window.__mediaWidgetFixture.setup), 1);
    assert.equal(await count(), 1, 'Missing credentials open setup without authorization or playback');
    checks.push('Playlists opens inside the widget; saved links work without API credentials and clearly open Spotify without claiming playback');

    await fixture.getByRole('button', { name: 'Add playlist', exact: true }).click();
    const name = fixture.getByLabel('Name', { exact: true }); const link = fixture.getByLabel('Spotify playlist link', { exact: true });
    await name.fill('Morning mix'); await link.fill('https://example.invalid/playlist/1234567890ABCDEFGHIJKM');
    await fixture.getByRole('button', { name: 'Save playlist', exact: true }).click();
    assert.equal(await count(), 1, 'Non-Spotify links are rejected before storage or opening');
    await link.fill('https://open.spotify.com/playlist/1234567890ABCDEFGHIJKM?si=fixture');
    await name.focus(); const draftNode = await name.elementHandle();
    await page.evaluate(() => { const f = window.__mediaWidgetFixture; f.model.media.title = 'Updated fixture track'; window.EdgeMediaWidget.render(f.container, f.context); });
    assert.equal(await draftNode.evaluate(node => node === document.activeElement), true);
    assert.equal(await name.inputValue(), 'Morning mix');
    await fixture.getByRole('button', { name: 'Save playlist', exact: true }).click(); await waitCount(2);
    assert.deepEqual(await lastCall(), { method: 'save', item: { name: 'Morning mix', uri: 'spotify:playlist:1234567890ABCDEFGHIJKM' } });
    assert.equal(await fixture.getByRole('button', { name: 'Open Morning mix in Spotify', exact: true }).count(), 1);
    checks.push('Manual playlist save validates the link and preserves its name draft/focus across live updates');

    await page.evaluate(() => {
      const f = window.__mediaWidgetFixture;
      f.model.spotify = { connected: true, loaded: true, clientIdConfigured: true, playlists: [
        { name: 'Evening favourites', uri: 'spotify:playlist:1234567890ABCDEFGHIJKL', totalTracks: 42, artwork: f.artwork },
        { name: 'Focus sessions', uri: 'spotify:playlist:1234567890ABCDEFGHIJKN', totalTracks: 25, artwork: f.artwork },
      ] };
      window.EdgeMediaWidget.render(f.container, f.context);
    });
    assert.equal(await fixture.locator('.emw-playlist', { hasText: 'Evening favourites' }).count(), 1, 'Saved/API duplicates merge by Spotify URI');
    assert.equal(await fixture.locator('.emw-playlist', { hasText: 'Focus sessions' }).count(), 1);
    await fixture.locator('.emw-playlist-art img').first().evaluate(image => image.decode());
    assert.ok(await fixture.locator('.emw-playlist-art img').first().evaluate(image => image.naturalWidth > 0));
    await fixture.getByRole('button', { name: 'Home', exact: true }).click();
    await fixture.getByRole('button', { name: 'Open Daily Mix 1, Playlist', exact: true }).first().waitFor();
    assert.deepEqual(await page.evaluate(() => window.__mediaWidgetFixture.browse), [{ kind: 'home', value: false }]);
    const shelfTitles = await fixture.locator('.emw-shelf h4').allTextContents();
    for (const title of ['Made for you', 'Jump back in', 'Your top artists', 'Your playlists']) assert.ok(shelfTitles.includes(title), JSON.stringify(shelfTitles));
    assert.ok(await fixture.locator('.emw-shortcut').count() >= 4, 'Home starts with a grid of recent shortcuts');
    assert.equal(await fixture.getByRole('button', { name: 'Reconnect', exact: true }).isVisible(), true, 'Missing permissions offer a reconnect');
    await fixture.locator('.emw-tile-art img').first().evaluate(image => image.decode());
    await fixture.screenshot({ path: path.join(directory, 'music-widget-for-you.png') });
    await fixture.getByRole('button', { name: 'Search', exact: true }).click();
    const search = fixture.getByRole('searchbox', { name: 'Search Spotify', exact: true });
    await search.fill('focus'); const searchNode = await search.elementHandle();
    await page.evaluate(() => { const f = window.__mediaWidgetFixture; f.model.media.volume = 39; window.EdgeMediaWidget.render(f.container, f.context); });
    assert.equal(await searchNode.evaluate(node => node === document.activeElement), true);
    assert.equal(await search.inputValue(), 'focus'); assert.equal(await fixture.locator('.emw-playlist').count(), 1);
    assert.equal(await fixture.getByRole('button', { name: 'Search', exact: true }).getAttribute('aria-pressed'), 'true');
    assert.equal(await count(), 2, 'Filtering and telemetry updates make no service calls');
    await fixture.getByRole('button', { name: 'Play Found mix, Playlist by Spotify', exact: true }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.__mediaWidgetFixture.browse.at(-1)), { kind: 'search', value: 'focus' });
    assert.equal(await fixture.locator('.emw-result').count(), 2); assert.equal(await fixture.locator('.emw-home').isVisible(), false);
    await fixture.screenshot({ path: path.join(directory, 'music-widget-search.png') });
    // A Spotify connection blip while a search is shown runs the search again.
    await page.evaluate(() => { const f = window.__mediaWidgetFixture; const connected = f.model.spotify; f.model.spotify = { ...connected, connected: false }; window.EdgeMediaWidget.render(f.container, f.context); f.model.spotify = connected; window.EdgeMediaWidget.render(f.container, f.context); });
    await fixture.getByRole('button', { name: 'Play Found mix, Playlist by Spotify', exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.__mediaWidgetFixture.browse.filter(call => call.kind === 'search').length), 2);
    await search.fill(''); await fixture.getByRole('button', { name: 'Your Library', exact: true }).click(); await fixture.screenshot({ path: path.join(directory, 'music-widget-playlists.png') });
    await fixture.getByRole('button', { name: 'Play Focus sessions', exact: true }).click(); await waitCount(3);
    assert.deepEqual(await lastCall(), { method: 'spotify', action: 'play', value: 'spotify:playlist:1234567890ABCDEFGHIJKN' });
    assert.match(await fixture.locator('.emw-feedback').textContent(), /Playback request sent to Fixture player/);
    await fixture.getByRole('button', { name: 'Remove saved link for Morning mix', exact: true }).click(); await waitCount(4);
    assert.deepEqual(await lastCall(), { method: 'remove', id: 'saved-2' });
    checks.push('Real API-shaped playlist covers render; search/tab/focus survive live updates; explicit Play sends the exact URI and Remove sends only the saved-link ID');

    // Tapping the mini player opens the player again.
    await fixture.locator('.emw-mini-open').click(); await page.waitForTimeout(500);
    assert.equal(await fixture.locator('.emw-now').isVisible(), true);
    await fixture.locator('.emw-now').getByRole('button', { name: 'Pause playback', exact: true }).click(); await waitCount(5);
    assert.deepEqual(await lastCall(), { method: 'media', action: 'play-pause' });
    assert.equal(await fixture.getByRole('slider', { name: 'System volume', exact: true }).count(), 0, 'System volume lives in Quick actions, not the music card');
    await page.evaluate(() => { const f = window.__mediaWidgetFixture; f.model.media.spotifyVolume = 30; window.EdgeMediaWidget.render(f.container, f.context); });
    const range = fixture.getByRole('slider', { name: 'Spotify volume', exact: true }); await range.focus(); const volumeNode = await range.elementHandle();
    await range.evaluate(node => { node.value = '57'; node.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.evaluate(() => { const f = window.__mediaWidgetFixture; f.model.media.title = 'Another fixture track'; f.model.media.spotifyVolume = 40; window.EdgeMediaWidget.render(f.container, f.context); });
    assert.equal(await volumeNode.evaluate(node => node === document.activeElement), true); assert.equal(await range.inputValue(), '57');
    assert.equal(await count(), 5, 'Volume input changes remain local until change/commit');
    await range.dispatchEvent('change'); await waitCount(6);
    assert.deepEqual(await lastCall(), { method: 'media', action: 'spotify-volume', value: 57 });
    await page.evaluate(() => {
      const f = window.__mediaWidgetFixture; f.model.media.canNext = false; f.model.media.artwork = 'https://example.invalid/untrusted-cover.png';
      window.EdgeMediaWidget.render(f.container, f.context);
    });
    assert.equal(await fixture.getByRole('button', { name: 'Next track', exact: true }).isDisabled(), true);
    assert.equal(await fixture.locator('.song-cover').getAttribute('src'), null, 'Remote artwork URLs are rejected');
    assert.equal(await count(), 6);
    checks.push('Playback and volume use only explicit fake callbacks; volume focus/draft survives telemetry, unavailable controls disable, and remote artwork is rejected');

    // Spotify Web API mode: progress, shuffle, devices, queue and playlist songs.
    await page.evaluate(() => {
      const f = window.__mediaWidgetFixture;
      f.model.spotify = { ...f.model.spotify, connected: true, player: { active: true, fetchedAt: Date.now(), isPlaying: true, progressMs: 60000, shuffle: false, repeat: 'off', liked: false, libraryAccess: true,
        device: { id: 'tv', name: 'Living room TV', type: 'TV', supportsVolume: true, volume: 40 }, can: { seek: true, shuffle: true, repeat: true, next: true, previous: true },
        track: { uri: 'spotify:track:1234567890ABCDEFGHIJKA', type: 'track', name: 'API track', artists: 'API artist', durationMs: 240000, artwork: f.artwork } } };
      window.EdgeMediaWidget.render(f.container, f.context);
    });
    const before = await count();
    assert.equal(await fixture.locator('.emw-song').textContent(), 'API track');
    assert.equal(await fixture.locator('.emw-progress').isVisible(), true);
    const elapsed = await fixture.locator('.emw-time').first().textContent();
    await page.waitForTimeout(1300);
    assert.notEqual(await fixture.locator('.emw-time').first().textContent(), elapsed, 'Progress advances locally between polls');
    assert.equal(await fixture.getByRole('slider', { name: 'Spotify volume', exact: true }).inputValue(), '40');
    await fixture.screenshot({ path: path.join(directory, 'music-widget-spotify.png') });
    await fixture.getByRole('button', { name: 'Shuffle', exact: true }).click();
    assert.equal(await fixture.getByRole('button', { name: 'Shuffle', exact: true }).getAttribute('aria-pressed'), 'true', 'Shuffle updates optimistically');
    await waitCount(before + 1); assert.deepEqual(await lastCall(), { method: 'player', action: 'shuffle', value: true });
    await fixture.locator('.emw-now').getByRole('button', { name: 'Choose a Spotify device', exact: true }).click(); await waitCount(before + 2);
    assert.equal(await fixture.getByText('Desk PC').count(), 1);
    await fixture.getByRole('button', { name: 'Close devices', exact: true }).click();
    await fixture.locator('.emw-now').getByRole('button', { name: 'Up Next', exact: true }).click(); await waitCount(before + 3);
    assert.equal(await fixture.getByText('Next song').count(), 1);
    await fixture.getByRole('button', { name: 'Your Library', exact: true }).click();
    await fixture.getByRole('button', { name: 'Show songs in Focus sessions', exact: true }).click(); await waitCount(before + 4);
    await fixture.getByRole('button', { name: 'Play Playlist song by Band', exact: true }).click(); await waitCount(before + 5);
    assert.deepEqual(await lastCall(), { method: 'player', action: 'play-item', value: { contextUri: 'spotify:playlist:1234567890ABCDEFGHIJKN', trackUri: 'spotify:track:1234567890ABCDEFGHIJKC' } });
    // When that song starts, its row is marked in place: rows keep their DOM and focus.
    const songRow = await fixture.getByRole('button', { name: 'Play Playlist song by Band', exact: true }).elementHandle();
    await page.evaluate(() => { const f = window.__mediaWidgetFixture; f.model.spotify.player.track = { ...f.model.spotify.player.track, uri: 'spotify:track:1234567890ABCDEFGHIJKC' }; window.EdgeMediaWidget.render(f.container, f.context); });
    assert.deepEqual(await songRow.evaluate(node => [node.isConnected, node.classList.contains('is-current'), node.getAttribute('aria-current')]), [true, true, 'true']);
    checks.push('Spotify mode interpolates progress, uses Spotify device volume, updates shuffle optimistically, lists devices and the queue, and plays a song inside its playlist');

    // For you tiles play any context; playlists you do not own say why songs are missing.
    await fixture.getByRole('button', { name: 'Back', exact: true }).click(); await fixture.getByRole('button', { name: 'Home', exact: true }).click();
    await fixture.getByRole('button', { name: 'Play Daily Mix 1, Playlist', exact: true }).first().click(); await waitCount(before + 6);
    assert.deepEqual(await lastCall(), { method: 'spotify', action: 'play', value: 'spotify:playlist:1234567890ABCDEFGHIJKX' });
    await fixture.getByRole('button', { name: 'Open Daily Mix 1, Playlist', exact: true }).first().click(); await waitCount(before + 7);
    assert.match(await fixture.locator('.emw-detail .emw-help').textContent(), /playlists you own or collaborate on/);
    await fixture.getByRole('button', { name: 'Play Daily Mix 1', exact: true }).click(); await waitCount(before + 8);
    assert.deepEqual(await lastCall(), { method: 'spotify', action: 'play', value: 'spotify:playlist:1234567890ABCDEFGHIJKX' });
    await fixture.getByRole('button', { name: 'Back', exact: true }).click();
    await fixture.getByRole('button', { name: 'Play Single song, Song by Singer', exact: true }).first().click(); await waitCount(before + 9);
    assert.deepEqual(await lastCall(), { method: 'spotify', action: 'play', value: 'spotify:track:1234567890ABCDEFGHIJKV' });
    checks.push('Mobile layout: the player minimises to Home, Search and Your Library tabs with a mini player; Home shows recent shortcuts and shelves (recently played, top artists) and Spotify-wide search results; tiles play any playlist, album, artist or song, and playlists you do not own explain that only playback is possible');

    // Spotify keeps its own slider next to the system one.
    await fixture.locator('.emw-mini-open').click(); await page.waitForTimeout(500);
    await page.evaluate(() => { const f = window.__mediaWidgetFixture; f.model.spotify.player.device.supportsVolume = false; f.model.media.spotifyVolume = 70; window.EdgeMediaWidget.render(f.container, f.context); });
    assert.equal(await fixture.getByRole('slider', { name: 'Spotify volume', exact: true }).count(), 0, 'A remote device without remote volume never moves this PC\'s mixer');
    assert.equal(await fixture.locator('.emw-volume-spotify .emw-volume-note').textContent(), 'Volume is set on Living room TV');
    await page.evaluate(() => { const f = window.__mediaWidgetFixture; f.model.system = { hostname: 'DESK PC' }; f.model.spotify.player.device = { id: 'pc', name: 'Desk PC', type: 'Computer', supportsVolume: false, volume: null }; window.EdgeMediaWidget.render(f.container, f.context); });
    const spotifyRange = fixture.getByRole('slider', { name: 'Spotify volume', exact: true });
    assert.equal(await spotifyRange.inputValue(), '70', 'On this PC without device volume, Spotify follows its Windows mixer level');
    await spotifyRange.evaluate(node => { node.value = '64'; node.dispatchEvent(new Event('input', { bubbles: true })); node.dispatchEvent(new Event('change', { bubbles: true })); });
    await waitCount(before + 10);
    assert.deepEqual(await lastCall(), { method: 'media', action: 'spotify-volume', value: 64 });
    for (const compact of [false, true]) {
      await fixture.evaluate((root, small) => Object.assign(root.style, small ? { width: '348px', height: '302px', padding: '18px' } : { width: '552px', height: '514px', padding: '30px' }), compact);
      const layout = await measureControls(); assert.equal(layout.overflow, false);
      assert.equal(layout.controls.filter(control => /volume/.test(control.label)).length, 1, JSON.stringify(layout));
      assert.equal(layout.overlap, false, `Controls overlap: ${JSON.stringify(layout)}`);
      assert.ok(layout.controls.every(control => control.width >= 48 && control.height >= 48 && control.bottom <= layout.bottom), JSON.stringify(layout));
    }
    await fixture.screenshot({ path: path.join(directory, 'music-widget-volume.png') });
    checks.push('Spotify has its own volume slider with a speaker icon, and no system slider: the playing device\'s volume, this PC\'s Windows mixer level when Spotify plays here without one, and a note for remote devices without remote volume; 48px targets that never overlap at native and compact sizes');
    return checks;
  } finally {
    await page.evaluate(() => { window.__mediaWidgetFixture?.container.remove(); delete window.__mediaWidgetFixture; });
  }
}

module.exports = { verifyMediaWidget };
