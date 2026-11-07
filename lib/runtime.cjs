'use strict';
// The few desktop services Edge Deck's background service needs, on plain
// Node.js and Windows' own tools. Edge Deck used to run on Electron, which
// Windows Smart App Control can block; the dashboard itself runs in Edge.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const { execFile, execFileSync } = require('node:child_process');

const POWERSHELL = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
// Values reach PowerShell through an environment variable, never inside the script.
function psArgs(script, sta) { return ['-NoLogo', '-NoProfile', '-NonInteractive', ...(sta ? ['-STA'] : []), '-ExecutionPolicy', 'Bypass', '-Command', script]; }
function psSync(script, value = '', { sta = false, timeout = 20000 } = {}) {
  return execFileSync(POWERSHELL, psArgs(script, sta), { windowsHide: true, timeout, encoding: 'utf8', env: { ...process.env, EDGE_DECK_VALUE: value } }).trim();
}
function ps(script, value = '', { sta = false, timeout = 20000 } = {}) {
  return new Promise((resolve, reject) => execFile(POWERSHELL, psArgs(script, sta), { windowsHide: true, timeout, encoding: 'utf8', env: { ...process.env, EDGE_DECK_VALUE: value } },
    (error, stdout) => error ? reject(error) : resolve(String(stdout).trim())));
}

// ---- Credential encryption --------------------------------------------------
// The same format as Electron's safeStorage on Windows, so existing secrets keep
// working: AES-256-GCM ("v10" + 12-byte nonce + ciphertext + 16-byte tag) with a
// key protected by Windows DPAPI for this user, kept in "Local State".
const DPAPI = `Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String($env:EDGE_DECK_VALUE)`;
function unprotect(bytes) { return Buffer.from(psSync(`${DPAPI}; [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Unprotect($b,$null,'CurrentUser'))`, bytes.toString('base64')), 'base64'); }
function protect(bytes) { return Buffer.from(psSync(`${DPAPI}; [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect($b,$null,'CurrentUser'))`, bytes.toString('base64')), 'base64'); }
function createSafeStorage(getUserData) {
  let key = null;
  function loadKey() {
    if (key) return key;
    const file = path.join(getUserData(), 'Local State');
    let state = {};
    try { state = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { state = {}; }
    const stored = state?.os_crypt?.encrypted_key;
    if (typeof stored === 'string' && stored) {
      const sealed = Buffer.from(stored, 'base64');
      if (sealed.subarray(0, 5).toString('latin1') !== 'DPAPI') throw new Error('Unrecognised credential key.');
      key = unprotect(sealed.subarray(5));
    } else {
      const fresh = crypto.randomBytes(32);
      state = { ...state, os_crypt: { ...(state.os_crypt || {}), encrypted_key: Buffer.concat([Buffer.from('DPAPI', 'latin1'), protect(fresh)]).toString('base64') } };
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const temporary = `${file}.${process.pid}.tmp`; fs.writeFileSync(temporary, JSON.stringify(state)); fs.renameSync(temporary, file);
      key = fresh;
    }
    if (key.length !== 32) { key = null; throw new Error('Invalid credential key.'); }
    return key;
  }
  return {
    isEncryptionAvailable() { if (process.platform !== 'win32') return false; try { loadKey(); return true; } catch { return false; } },
    encryptString(text) {
      const nonce = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', loadKey(), nonce);
      const body = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
      return Buffer.concat([Buffer.from('v10', 'latin1'), nonce, body, cipher.getAuthTag()]);
    },
    decryptString(buffer) {
      const data = Buffer.from(buffer);
      // Data from before the "v10" format was protected by DPAPI alone.
      if (data.subarray(0, 3).toString('latin1') !== 'v10') return unprotect(data).toString('utf8');
      const decipher = crypto.createDecipheriv('aes-256-gcm', loadKey(), data.subarray(3, 15));
      decipher.setAuthTag(data.subarray(data.length - 16));
      return Buffer.concat([decipher.update(data.subarray(15, data.length - 16)), decipher.final()]).toString('utf8');
    },
  };
}

// ---- Displays ---------------------------------------------------------------
// Physical bounds and scale of each monitor (per-monitor DPI aware), shaped like
// Electron's Display: bounds/workArea/size in DIPs, plus nativeBounds in pixels.
const SCREENS = `Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices; using System.Collections.Generic;
public static class EdgeDeckScreens {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] public struct MONITORINFOEX { public int cb; public RECT mon; public RECT work; public uint flags; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string name; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] public struct DISPLAY_DEVICE { public int cb; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string DeviceName; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string DeviceString; public int StateFlags; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string DeviceID; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string DeviceKey; }
  public delegate bool MonitorEnum(IntPtr monitor, IntPtr hdc, ref RECT rect, IntPtr data);
  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr value);
  [DllImport("user32.dll")] static extern bool EnumDisplayMonitors(IntPtr hdc, IntPtr clip, MonitorEnum callback, IntPtr data);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool GetMonitorInfo(IntPtr monitor, ref MONITORINFOEX info);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool EnumDisplayDevices(string device, uint index, ref DISPLAY_DEVICE info, uint flags);
  [DllImport("shcore.dll")] static extern int GetDpiForMonitor(IntPtr monitor, int type, out uint x, out uint y);
  public static string List() {
    SetProcessDpiAwarenessContext(new IntPtr(-4));
    var rows = new List<string>();
    EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, (IntPtr m, IntPtr h, ref RECT r, IntPtr d) => {
      var info = new MONITORINFOEX(); info.cb = Marshal.SizeOf(typeof(MONITORINFOEX)); GetMonitorInfo(m, ref info);
      uint x = 96, y = 96; if (GetDpiForMonitor(m, 0, out x, out y) != 0) x = 96;
      var device = new DISPLAY_DEVICE(); device.cb = Marshal.SizeOf(typeof(DISPLAY_DEVICE));
      string label = EnumDisplayDevices(info.name, 0, ref device, 0) ? device.DeviceString : "";
      rows.Add(string.Join("\\t", new object[] { info.name, label, info.mon.L, info.mon.T, info.mon.R - info.mon.L, info.mon.B - info.mon.T, info.work.L, info.work.T, info.work.R - info.work.L, info.work.B - info.work.T, x, info.flags & 1 }));
      return true;
    }, IntPtr.Zero);
    return string.Join("\\n", rows);
  }
}
'@; [EdgeDeckScreens]::List()`;
function parseScreens(text) {
  return String(text).split(/\r?\n/).filter(Boolean).map((line, index) => {
    const [name, label, x, y, width, height, wx, wy, ww, wh, dpi, primary] = line.split('\t');
    const scale = Math.max(1, Number(dpi) || 96) / 96, n = value => Number(value) || 0;
    const dip = (a, b, c, d) => ({ x: Math.round(n(a) / scale), y: Math.round(n(b) / scale), width: Math.round(n(c) / scale), height: Math.round(n(d) / scale) });
    const bounds = dip(x, y, width, height);
    return { id: Number(/(\d+)$/.exec(name || '')?.[1]) || index + 1, label: label || name || `Display ${index + 1}`, scaleFactor: scale, primary: primary === '1',
      bounds, workArea: dip(wx, wy, ww, wh), size: { width: bounds.width, height: bounds.height },
      nativeBounds: { x: n(x), y: n(y), width: n(width), height: n(height) } };
  });
}
function createScreen() {
  let displays = null;
  const read = () => { try { displays = parseScreens(psSync(SCREENS)); } catch { displays = displays || []; } return displays; };
  // Displays can change while the service runs: re-read in the background.
  const timer = setInterval(() => { ps(SCREENS).then(text => { const next = parseScreens(text); if (next.length) displays = next; }).catch(() => {}); }, 30000); timer.unref();
  const all = () => displays || read();
  return {
    getAllDisplays: () => all().map(display => ({ ...display })),
    getPrimaryDisplay: () => ({ ...(all().find(display => display.primary) || all()[0] || { id: 0, label: 'Display', scaleFactor: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 }, size: { width: 1920, height: 1080 } }) }),
    dipToScreenRect(_, rect) {
      const match = all().find(display => ['x', 'y', 'width', 'height'].every(key => display.bounds[key] === rect?.[key]));
      return match ? { ...match.nativeBounds } : { ...rect };
    },
  };
}

// ---- Shell ------------------------------------------------------------------
const SHORTCUT_READ = `$s=(New-Object -ComObject WScript.Shell).CreateShortcut($env:EDGE_DECK_VALUE); $i=$s.IconLocation; $p=$i.LastIndexOf(',');
[pscustomobject]@{target=$s.TargetPath;args=$s.Arguments;cwd=$s.WorkingDirectory;description=$s.Description;icon=$(if($p -ge 0){$i.Substring(0,$p)}else{$i});iconIndex=$(if($p -ge 0){[int]$i.Substring($p+1)}else{0})} | ConvertTo-Json -Compress`;
const SHORTCUT_WRITE = `$d=$env:EDGE_DECK_VALUE | ConvertFrom-Json; $s=(New-Object -ComObject WScript.Shell).CreateShortcut($d.file); $s.TargetPath=$d.target; $s.Arguments=$d.args; $s.WorkingDirectory=$d.cwd; $s.Description=$d.description; if($d.icon){$s.IconLocation=$d.icon+','+$d.iconIndex}; $s.Save(); 'ok'`;
const FILE_ICON = `Add-Type -AssemblyName System.Drawing; $i=[System.Drawing.Icon]::ExtractAssociatedIcon($env:EDGE_DECK_VALUE); if($i){$m=New-Object IO.MemoryStream; $i.ToBitmap().Save($m,[System.Drawing.Imaging.ImageFormat]::Png); [Convert]::ToBase64String($m.ToArray())}`;
const OPEN_DIALOG = `Add-Type -AssemblyName System.Windows.Forms; $o=New-Object System.Windows.Forms.Form -Property @{TopMost=$true;ShowInTaskbar=$false}; $f=New-Object System.Windows.Forms.OpenFileDialog -Property @{Title=$env:EDGE_DECK_VALUE;Filter='Apps and shortcuts (*.exe;*.lnk)|*.exe;*.lnk';DereferenceLinks=$false}; if($f.ShowDialog($o) -eq 'OK'){$f.FileName}`;
const shell = {
  readShortcutLink(file) { return JSON.parse(psSync(SHORTCUT_READ, file)); },
  writeShortcutLink(file, operation, details) {
    if (operation === 'replace' && !fs.existsSync(file)) return false;
    try { return psSync(SHORTCUT_WRITE, JSON.stringify({ file, target: details.target || '', args: details.args || '', cwd: details.cwd || '', description: details.description || '', icon: details.icon || '', iconIndex: details.iconIndex || 0 })) === 'ok'; }
    catch { return false; }
  },
  // Opens a saved app, file or URL with its Windows default handler.
  async openExternal(target) { await ps(`Start-Process -FilePath $env:EDGE_DECK_VALUE`, String(target)); },
  async openPath(target) { try { await ps(`Start-Process -FilePath $env:EDGE_DECK_VALUE`, String(target)); return ''; } catch (error) { return 'Windows could not open this app.'; } },
};
async function fileIcon(file) { try { const base64 = await ps(FILE_ICON, file); return base64 ? `data:image/png;base64,${base64}` : null; } catch { return null; } }
async function chooseFile(title) {
  const file = await ps(OPEN_DIALOG, title, { sta: true, timeout: 0 }).catch(() => '');
  return file ? { canceled: false, filePaths: [file] } : { canceled: true, filePaths: [] };
}

// ---- Process ----------------------------------------------------------------
function createApp() {
  const paths = { appData: process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), temp: os.tmpdir() };
  const handlers = new Map(); let quitting = false, lock = null;
  const emit = (event, ...args) => { for (const handler of handlers.get(event) || []) { try { handler(...args); } catch (error) { console.error(error); } } };
  return {
    getPath(name) {
      if (name === 'desktop' && !paths.desktop) paths.desktop = psSync(`[Environment]::GetFolderPath('Desktop')`) || path.join(os.homedir(), 'Desktop');
      if (!paths[name]) throw new Error(`Unknown folder: ${name}`);
      return paths[name];
    },
    setPath(name, value) { paths[name] = value; },
    setName() {},
    on(event, handler) { handlers.set(event, [...(handlers.get(event) || []), handler]); return this; },
    // One running copy per user: a second launch asks the first to come forward.
    requestSingleInstanceLock(name = 'edge-deck') {
      const pipe = `\\\\.\\pipe\\${name}-${os.userInfo().username}`.replace(/[^\w\\.-]/g, '_');
      return new Promise(resolve => {
        lock = net.createServer(socket => { socket.end(); emit('second-instance'); });
        lock.once('error', () => { lock = null; const client = net.connect(pipe, () => { client.end(); resolve(false); }); client.on('error', () => resolve(false)); });
        lock.listen(pipe, () => resolve(true));
      });
    },
    whenReady: () => Promise.resolve(),
    quit(code = process.exitCode || 0) { if (quitting) return; quitting = true; emit('before-quit'); lock?.close(); setTimeout(() => process.exit(code), 50).unref?.(); },
    exit(code = 0) { lock?.close(); process.exit(code); },
  };
}

module.exports = { createApp, createScreen, createSafeStorage, shell, fileIcon, chooseFile, parseScreens };
