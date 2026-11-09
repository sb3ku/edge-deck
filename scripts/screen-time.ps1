# Edge Deck's Screen Time helper. Every five seconds it writes one JSON line:
#   { "active": true|false, "process": "firefox", "name": "Firefox", "self": false }
# active: the last keyboard/mouse/touch input was under two minutes ago, or a
# full-screen app (a game) is in front. process/name: the foreground program's
# executable name and its FileDescription/ProductName. Window titles are never read.
# self: the foreground window is Edge Deck's own dashboard (msedge with the BrowserProfile folder).
# It reads only; it ends with the service.
param([Parameter(Mandatory = $true)][int]$ParentId, [int]$IntervalSeconds = 5)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class EdgeDeckScreenTime {
  [StructLayout(LayoutKind.Sequential)] struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
  [StructLayout(LayoutKind.Sequential)] struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags; }
  [DllImport("user32.dll")] static extern bool GetLastInputInfo(ref LASTINPUTINFO info);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr window, out RECT rect);
  [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr window, uint flags);
  [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr monitor, ref MONITORINFO info);
  [DllImport("kernel32.dll")] static extern uint GetTickCount();
  public static double IdleSeconds() {
    var info = new LASTINPUTINFO(); info.cbSize = (uint)Marshal.SizeOf(typeof(LASTINPUTINFO));
    if (!GetLastInputInfo(ref info)) return 0;
    return unchecked((uint)(GetTickCount() - info.dwTime)) / 1000.0;
  }
  public static uint ForegroundProcess(out bool fullScreen) {
    fullScreen = false; uint pid = 0;
    IntPtr window = GetForegroundWindow(); if (window == IntPtr.Zero) return 0;
    GetWindowThreadProcessId(window, out pid);
    RECT rect; var monitor = new MONITORINFO(); monitor.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
    if (GetWindowRect(window, out rect) && GetMonitorInfo(MonitorFromWindow(window, 2), ref monitor)) {
      var m = monitor.rcMonitor;
      fullScreen = rect.Left <= m.Left && rect.Top <= m.Top && rect.Right >= m.Right && rect.Bottom >= m.Bottom;
    }
    return pid;
  }
}
'@
function Send($value) { [Console]::Out.WriteLine(($value | ConvertTo-Json -Compress -Depth 4)); [Console]::Out.Flush() }
$names = @{}; $selfPids = @{}
$shell = @('explorer', 'searchhost', 'startmenuexperiencehost', 'shellexperiencehost', 'lockapp', 'applicationframehost', 'textinputhost')
while ($true) {
  if (-not (Get-Process -Id $ParentId -ErrorAction SilentlyContinue)) { exit }
  try {
    $idle = [EdgeDeckScreenTime]::IdleSeconds()
    $full = $false
    $foreground = [EdgeDeckScreenTime]::ForegroundProcess([ref]$full)
    $process = ''; $label = ''; $self = $false
    if ($foreground -gt 0) {
      $item = Get-Process -Id $foreground -ErrorAction SilentlyContinue
      if ($item) {
        $process = $item.ProcessName.ToLowerInvariant()
        if (-not $names.ContainsKey($process)) {
          $text = $null
          try { $info = $item.MainModule.FileVersionInfo; $text = if ($info.FileDescription) { $info.FileDescription } else { $info.ProductName } } catch { }
          $names[$process] = if ($text -and $text.Trim()) { $text.Trim() } else { $item.ProcessName }
        }
        $label = $names[$process]
        if ($process -eq 'msedge') {
          if (-not $selfPids.ContainsKey($foreground)) {
            $line = $null
            try { $line = (Get-CimInstance Win32_Process -Filter "ProcessId=$foreground").CommandLine } catch { }
            $selfPids[$foreground] = [bool]($line -and $line -match 'BrowserProfile')
          }
          $self = $selfPids[$foreground]
        }
      }
    }
    $game = $full -and $process -and ($shell -notcontains $process) -and -not $self
    Send @{ active = [bool]($idle -lt 120 -or $game); process = $process; name = $label; self = $self }
  } catch { }
  Start-Sleep -Seconds $IntervalSeconds
}
