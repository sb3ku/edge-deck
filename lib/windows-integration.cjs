'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);
const SHORTCUT_NAME = 'Edge Deck.lnk';
const APP_ID = 'local.EdgeDeck.Dashboard';

// StartupApproved is an implementation detail, not a promised Windows API.
// Recognize only conservative known records; never write it. Unknown records
// require checking Windows Settings rather than claiming startup is enabled.
// Electron also reads StartupApproved for its Run-key login items:
// https://github.com/electron/electron/blob/main/shell/browser/browser_win.cc
function decodeStartupApproval(value) {
  if (value === null) return 'absent';
  if (!Buffer.isBuffer(value) || value.length !== 12) return 'unknown';
  if ([0, 2].includes(value[0]) && value.subarray(1).every(byte => byte === 0)) return 'enabled';
  if (value[0] === 3 && value[1] === 0 && value[2] === 0 && value[3] === 0) return 'disabled';
  return 'unknown';
}

async function readWindowsInfo() {
  // Ask the actual standalone process's Windows session for its known folder.
  // Do not perform this integration through Codex's MSIX virtual AppData view.
  const script = `
$ErrorActionPreference='Stop'
$startup=[Environment]::GetFolderPath('Startup',[Environment+SpecialFolderOption]::DoNotVerify)
$approval='unknown'
$data=$null
try {
  $key=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\StartupFolder',$false)
  if ($null -eq $key) { $approval='absent' }
  else {
    try {
      $value=$key.GetValue('Edge Deck.lnk',$null,[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
      if ($null -eq $value) { $approval='absent' }
      elseif ($value -is [byte[]]) { $approval='binary'; $data=[Convert]::ToBase64String($value) }
    } finally { $key.Dispose() }
  }
} catch { $approval='unknown' }
@{startupDirectory=$startup;approval=$approval;data=$data}|ConvertTo-Json -Compress
`;
  const executable = path.win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const { stdout } = await run(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, timeout: 8000, maxBuffer: 16384 });
  const result = JSON.parse(stdout.trim());
  if (!path.isAbsolute(result.startupDirectory || '')) throw Error('Windows Startup folder is unavailable.');
  return {
    startupDirectory: result.startupDirectory,
    approval: result.approval === 'absent' ? 'absent' : result.approval === 'binary' ? decodeStartupApproval(Buffer.from(result.data || '', 'base64')) : 'unknown',
  };
}

function createWindowsIntegration({ app, shell, root, verify = false, platform = process.platform, fs: fileSystem = fs, readWindowsInfo: inspectWindows = readWindowsInfo, wscriptPath = path.win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'wscript.exe') }) {
  if (!path.isAbsolute(root || '')) throw new TypeError('An absolute application folder is required.');
  const supported = platform === 'win32' && !verify;
  const launcher = path.join(root, 'Start Edge Deck.vbs');
  const icon = path.join(root, 'src', 'assets', 'app', 'edge-deck.ico');
  const legacyExecutable = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
  let desktopDirectory;
  let startupDirectory;
  let folderError = false;
  if (supported) {
    try {
      desktopDirectory = app.getPath('desktop');
      startupDirectory = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
      if (!path.isAbsolute(desktopDirectory) || !path.isAbsolute(startupDirectory)) throw Error('Invalid Windows folder.');
    } catch { folderError = true; }
  }
  let initialized = false;
  let approval = 'unknown';
  let refreshError = false;
  let refreshFlight = null;
  let queue = Promise.resolve();
  const args = `//NoLogo "${launcher}"`;
  const normalizePath = value => typeof value === 'string' ? path.resolve(value).replaceAll('/', '\\').toLowerCase() : '';
  const normalizeArgs = value => typeof value === 'string' ? value.trim().toLowerCase() : '';

  function inspectShortcut(directory) {
    if (!directory) return { kind: 'unavailable', file: null };
    const file = path.join(directory, SHORTCUT_NAME);
    let stat;
    try { stat = fileSystem.lstatSync(file); }
    catch (error) { return { kind: error.code === 'ENOENT' ? 'absent' : 'unavailable', file }; }
    if (!stat.isFile() || stat.isSymbolicLink()) return { kind: 'conflict', file };
    try {
      const details = shell.readShortcutLink(file);
      const independent = normalizePath(details.target) === normalizePath(wscriptPath) && normalizeArgs(details.args) === normalizeArgs(args);
      const legacy = normalizePath(details.target) === normalizePath(legacyExecutable) && normalizeArgs(details.args) === normalizeArgs(`"${root}" --edge`);
      return { kind: independent || legacy ? 'owned' : 'conflict', file };
    } catch { return { kind: 'conflict', file }; }
  }

  function getState() {
    const desktop = supported ? inspectShortcut(desktopDirectory) : { kind: 'absent', file: null };
    const startup = supported ? inspectShortcut(startupDirectory) : { kind: 'absent', file: null };
    let startupStatus = 'disabled';
    let message = 'Edge Deck will open when you launch it.';
    if (!supported) { startupStatus = 'unavailable'; message = verify ? 'Windows shortcuts are disabled during verification.' : 'Windows integration is available on Windows.'; }
    else if (folderError || refreshError || startup.kind === 'unavailable') { startupStatus = 'unavailable'; message = 'Windows startup settings could not be read. Try again before changing this option.'; }
    else if (!initialized) { startupStatus = 'unknown'; message = 'Checking Windows startup settings.'; }
    else if (startup.kind === 'conflict') { startupStatus = 'unavailable'; message = 'A different Edge Deck shortcut is already in the Startup folder. It has been left unchanged.'; }
    else if (startup.kind === 'owned') {
      if (approval === 'disabled') { startupStatus = 'blocked_by_windows'; message = 'Windows has disabled this startup entry. Turn on Edge Deck in Windows Settings → Apps → Startup, or remove the entry here.'; }
      else if (approval === 'unknown') { startupStatus = 'unknown'; message = 'The startup shortcut exists, but Windows approval could not be confirmed. Check Edge Deck in Windows Settings → Apps → Startup.'; }
      else { startupStatus = 'enabled'; message = 'Edge Deck is set to open when you sign in to Windows.'; }
    }
    return {
      supported, startupEnabled: startupStatus === 'enabled', startupShortcutPresent: startup.kind === 'owned',
      startupStatus, message, desktopShortcutPresent: desktop.kind === 'owned',
      desktopShortcutConflict: desktop.kind === 'conflict', startupShortcutConflict: startup.kind === 'conflict',
      desktopShortcutPath: desktop.file, startupShortcutPath: startup.file,
    };
  }

  async function refresh() {
    if (!supported || folderError) return getState();
    if (refreshFlight) return refreshFlight;
    refreshFlight = (async () => {
      try {
        const result = await inspectWindows();
        if (!path.isAbsolute(result?.startupDirectory || '')) throw Error('Invalid Windows Startup folder.');
        startupDirectory = result.startupDirectory;
        approval = ['absent', 'enabled', 'disabled'].includes(result.approval) ? result.approval : 'unknown';
        refreshError = false;
      } catch { approval = 'unknown'; refreshError = true; }
      initialized = true;
      return getState();
    })().finally(() => { refreshFlight = null; });
    return refreshFlight;
  }

  function ensureSupported() {
    if (!supported || folderError) throw Error(verify ? 'Windows shortcuts cannot change during verification.' : 'Windows shortcuts are unavailable.');
  }

  function writeOwnedShortcut(directory) {
    const before = inspectShortcut(directory);
    if (before.kind === 'conflict') throw Error('A different Edge Deck shortcut already exists there. It has been left unchanged.');
    if (before.kind === 'unavailable') throw Error('The Windows shortcut folder could not be read.');
    for (const file of [launcher, icon, path.join(root, 'scripts', 'start-independent.ps1'), path.join(root, 'scripts', 'shell-launcher.ps1')]) {
      if (!fileSystem.existsSync(file)) throw Error('The Edge Deck launcher or icon is missing. Restore the application files and try again.');
    }
    fileSystem.mkdirSync(directory, { recursive: true });
    const details = { target: wscriptPath, cwd: root, args, description: 'Edge Deck touchscreen dashboard', icon, iconIndex: 0, appUserModelId: APP_ID };
    if (!shell.writeShortcutLink(before.file, before.kind === 'owned' ? 'replace' : 'create', details)) throw Error('Windows could not save the Edge Deck shortcut.');
    if (inspectShortcut(directory).kind !== 'owned') throw Error('Windows did not confirm the Edge Deck shortcut.');
  }

  function serialize(operation) {
    const result = queue.then(operation);
    queue = result.catch(() => {});
    return result;
  }

  function setStartup(enabled) {
    if (typeof enabled !== 'boolean') return Promise.reject(new TypeError('Startup must be on or off.'));
    return serialize(async () => {
      ensureSupported();
      await refresh();
      if (refreshError) throw Error('Windows startup settings could not be read. No shortcut was changed.');
      const before = inspectShortcut(startupDirectory);
      if (before.kind === 'conflict' || before.kind === 'unavailable') throw Error('The existing Startup shortcut could not be verified as Edge Deck. It has been left unchanged.');
      if (enabled) writeOwnedShortcut(startupDirectory);
      else if (before.kind === 'owned') fileSystem.unlinkSync(before.file);
      // Windows' separate StartupApproved setting is intentionally untouched.
      return refresh();
    });
  }

  function createDesktopShortcut() {
    return serialize(async () => {
      ensureSupported();
      writeOwnedShortcut(desktopDirectory);
      return refresh();
    });
  }

  return { getState, refresh, setStartup, createDesktopShortcut };
}

module.exports = { createWindowsIntegration, decodeStartupApproval };
