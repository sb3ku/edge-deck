'use strict';

// One-time settings preservation after moving from Codex's MSIX filesystem
// view to Explorer's ordinary user session. Credentials stay in memory and are
// re-encrypted by the destination's existing authenticated settings API.
// This helper never connects directly to a printer or sends physical controls.
const { app, safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { createConfigStore } = require('../lib/config.cjs');
const sourceDirectory = path.join(process.env.LOCALAPPDATA, 'Packages', 'OpenAI.Codex_2p2nqsd0c76g0', 'LocalCache', 'Roaming', 'Edge Deck');
app.setPath('userData', sourceDirectory);
app.setName('Edge Deck settings migration');
let stage = 'preflight';

app.whenReady().then(async () => {
  const origin = process.env.EDGE_DECK_DIAG_ORIGIN;
  const token = process.env.EDGE_DECK_DIAG_TOKEN;
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin || '') || !/^[A-Za-z0-9_-]{32,128}$/.test(token || '')) throw Error('Local connection missing.');
  const request = async (operation, ...args) => {
    const response = await fetch(origin + '/api', {
      method: 'POST', signal: AbortSignal.timeout(15000),
      headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Edge-Token': token },
      body: JSON.stringify({ operation, args }),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw Error('Local settings request failed.');
    return result.result;
  };
  const sourceFile = path.join(sourceDirectory, 'settings.json');
  const original = JSON.parse(fs.readFileSync(sourceFile, 'utf8'));
  if (original.spotify?.encryptedTokens) throw Error('This migration requires separate handling for saved Spotify tokens.');
  const store = createConfigStore(sourceDirectory, safeStorage);
  const source = store.publicConfig();
  if (source.warning) throw Error('Source settings could not be loaded.');
  const privatePrinters = store.privatePrinters().filter(printer => printer.host && printer.serial);
  if (!privatePrinters.length || privatePrinters.some(printer => !printer.accessCode)) throw Error('Saved printer credentials could not be opened.');
  const destination = await request('state:get');
  if (!destination?.config || destination.config.printers.some(printer => printer.configured) || destination.spotify?.connected) throw Error('Destination already has connected accounts or printers; refusing to replace them.');
  if (!process.argv.includes('--apply')) {
    console.log(JSON.stringify({ ready: true, configuredPrinters: privatePrinters.map(printer => printer.id), hasSpotifyTokens: false, destinationPrintersConfigured: false }));
    app.exit(0);
    return;
  }

  stage = 'backup';
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDirectory = path.join(sourceDirectory, 'backups', 'standalone-migration-' + stamp);
  fs.mkdirSync(backupDirectory, { recursive: true });
  fs.copyFileSync(sourceFile, path.join(backupDirectory, 'settings.json'), fs.constants.COPYFILE_EXCL);
  const localState = path.join(sourceDirectory, 'Local State');
  if (fs.existsSync(localState)) fs.copyFileSync(localState, path.join(backupDirectory, 'Local State'), fs.constants.COPYFILE_EXCL);
  // publicConfig excludes encrypted access codes and account tokens.
  fs.writeFileSync(path.join(backupDirectory, 'destination-public-settings.json'), JSON.stringify({ createdAt: new Date().toISOString(), config: destination.config }, null, 2), { flag: 'wx' });

  stage = 'preferences';
  await request('config:save', { theme: source.theme, clock24: source.clock24, widgets: source.widgets, launchers: source.launchers });
  await request('spotify:save', { clientId: source.spotify?.clientId || '' });
  for (const printer of privatePrinters) {
    stage = 'printer-settings';
    await request('printer:save', {
      id: printer.id, name: printer.name, model: printer.model, host: printer.host,
      serial: printer.serial, accessCode: printer.accessCode,
      allowSelfSigned: printer.allowSelfSigned === true, controlAccess: printer.controlAccess === true,
    });
  }
  stage = 'verify';
  const after = await request('state:get');
  for (const printer of privatePrinters) {
    const saved = after.config.printers.find(value => value.id === printer.id);
    if (!saved?.configured || saved.host !== printer.host || saved.serial !== printer.serial || saved.allowSelfSigned !== (printer.allowSelfSigned === true) || saved.controlAccess !== (printer.controlAccess === true)) throw Error('Saved printer settings did not match.');
  }
  if (JSON.stringify(after.config.widgets) !== JSON.stringify(source.widgets) || JSON.stringify(after.config.launchers) !== JSON.stringify(source.launchers) || after.config.clock24 !== source.clock24) throw Error('Saved preferences did not match.');
  console.log(JSON.stringify({ migrated: true, backupCreated: true, sourcePreserved: true, credentialsReencryptedByDestination: true, configuredPrinters: privatePrinters.map(printer => printer.id), widgetCount: source.widgets.length, launcherCount: source.launchers.length, hasSpotifyTokens: false, physicalCommandsSent: 0 }));
  app.exit(0);
}).catch(() => {
  // Never print upstream errors, payloads, connection URLs or credentials.
  console.error(JSON.stringify({ migrated: false, stage, message: 'Settings migration stopped. Source settings and any created backups are preserved.' }));
  app.exit(1);
});
