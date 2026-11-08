# Edge Deck's PC stats helper. Every two seconds it writes one JSON line:
#   { "apps": [{ "name", "title", "memory", "cpu", "path" }], "cpuTemp": { "value", "source" } | null }
# The busiest apps by memory (grouped by program, CPU from processor-time
# deltas), and the CPU temperature: from Edge Deck's own sensor (PawnIO, see sensors\), else
# from HWiNFO or Core Temp shared memory when one of them runs (Windows reports
# real CPU temperatures only to drivers).
# Icons are sent once per program as { "icon": { "name", "data" } }.
# It reads only; it never changes a process or a setting. It ends with the service.
param([Parameter(Mandatory = $true)][int]$ParentId)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.IO.MemoryMappedFiles;
using System.Text;
public static class EdgeDeckSensors {
  // HWiNFO "Shared Memory Support": the CPU package (or hottest core) temperature.
  public static double[] Hwinfo() {
    try {
      using (var map = MemoryMappedFile.OpenExisting("Global\\HWiNFO_SENS_SM2", MemoryMappedFileRights.Read))
      using (var view = map.CreateViewAccessor(0, 0, MemoryMappedFileAccess.Read)) {
        if (view.ReadUInt32(0) != 0x53695748) return null; // "HWiS"
        long offset = view.ReadUInt32(32), size = view.ReadUInt32(36), count = view.ReadUInt32(40);
        double best = double.NaN; int rank = 99;
        for (long i = 0; i < count && i < 4096; i++) {
          long at = offset + i * size;
          if (view.ReadUInt32(at) != 1) continue; // temperature readings only
          var bytes = new byte[128]; view.ReadArray(at + 12, bytes, 0, 128);
          string label = Encoding.ASCII.GetString(bytes).Split('\0')[0];
          double value = view.ReadDouble(at + 284);
          int r = label == "CPU Package" ? 0 : label == "CPU (Tctl/Tdie)" ? 1 : label == "Core Max" ? 2 : label.StartsWith("CPU Package") ? 3 : 99;
          if (r < rank && value > 0 && value < 125) { rank = r; best = value; }
        }
        return double.IsNaN(best) ? null : new double[] { best };
      }
    } catch { return null; }
  }
  // Core Temp's shared memory: the hottest core.
  public static double[] CoreTemp() {
    try {
      using (var map = MemoryMappedFile.OpenExisting("CoreTempMappingObject", MemoryMappedFileRights.Read))
      using (var view = map.CreateViewAccessor(0, 0, MemoryMappedFileAccess.Read)) {
        uint cores = view.ReadUInt32(1536), cpus = view.ReadUInt32(1540);
        bool fahrenheit = view.ReadByte(2684) != 0, delta = view.ReadByte(2685) != 0;
        double best = double.NaN;
        for (uint i = 0; i < cores * Math.Max(1, cpus) && i < 256; i++) {
          double value = view.ReadSingle(1544 + i * 4);
          if (delta) value = view.ReadUInt32(1024 + (i / Math.Max(1, cores)) * 4) - value;
          if (fahrenheit) value = (value - 32) * 5 / 9;
          if (value > 0 && value < 125 && (double.IsNaN(best) || value > best)) best = value;
        }
        return double.IsNaN(best) ? null : new double[] { best };
      }
    } catch { return null; }
  }
}
'@

$cores = [Environment]::ProcessorCount
$previous = @{}
$previousAt = Get-Date
$titles = @{}
$iconSent = @{}
# Windows itself and background services are not "apps" here.
$skip = @('Idle', 'System', 'Registry', 'Memory Compression', 'svchost', 'csrss', 'smss', 'wininit', 'services', 'lsass', 'fontdrvhost', 'dwm', 'winlogon', 'MsMpEng', 'WmiPrvSE', 'conhost', 'dllhost', 'RuntimeBroker', 'sihost', 'ctfmon', 'audiodg', 'spoolsv', 'SearchIndexer', 'SecurityHealthService', 'NisSrv')

function Send($value) { [Console]::Out.WriteLine(($value | ConvertTo-Json -Compress -Depth 4)); [Console]::Out.Flush() }

while ($true) {
  if (-not (Get-Process -Id $ParentId -ErrorAction SilentlyContinue)) { exit }
  $now = Get-Date
  $seconds = [Math]::Max(0.5, ($now - $previousAt).TotalSeconds)
  $groups = @{}
  $current = @{}
  foreach ($process in [System.Diagnostics.Process]::GetProcesses()) {
    try {
      $name = $process.ProcessName
      if ($skip -contains $name) { continue }
      $cpu = $null
      try { $cpu = $process.TotalProcessorTime.TotalMilliseconds } catch { }
      $key = "$($process.Id)"
      if ($cpu -ne $null) { $current[$key] = $cpu }
      if (-not $groups.ContainsKey($name)) { $groups[$name] = @{ memory = 0; cpu = 0.0; path = $null } }
      $group = $groups[$name]
      $group.memory += $process.WorkingSet64
      if ($cpu -ne $null -and $previous.ContainsKey($key)) { $group.cpu += [Math]::Max(0, $cpu - $previous[$key]) }
      if (-not $group.path) { try { $group.path = $process.MainModule.FileName } catch { } }
    } catch { }
  }
  $previous = $current; $previousAt = $now
  $apps = @()
  foreach ($entry in ($groups.GetEnumerator() | Sort-Object { $_.Value.memory } -Descending | Select-Object -First 6)) {
    $name = $entry.Key; $group = $entry.Value
    if (-not $titles.ContainsKey($name)) {
      $title = $null
      if ($group.path) { try { $title = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($group.path).FileDescription } catch { } }
      $titles[$name] = if ($title -and $title.Trim()) { $title.Trim() } else { $name }
    }
    if ($group.path -and -not $iconSent.ContainsKey($name)) {
      $iconSent[$name] = $true
      try {
        $icon = [System.Drawing.Icon]::ExtractAssociatedIcon($group.path)
        $bitmap = $icon.ToBitmap(); $stream = New-Object System.IO.MemoryStream
        $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
        Send @{ icon = @{ name = $name; data = [Convert]::ToBase64String($stream.ToArray()) } }
        $bitmap.Dispose(); $icon.Dispose(); $stream.Dispose()
      } catch { }
    }
    $apps += @{ name = $name; title = $titles[$name]; memory = $group.memory; cpu = [Math]::Round($group.cpu / ($seconds * 10 * $cores), 1) }
  }
  $temperature = $null
  # Edge Deck's sensor writes about once a second; older readings are ignored.
  try {
    $sensor = Get-Content -LiteralPath (Join-Path $env:ProgramFiles 'Edge Deck Sensors\cpu-temp.json') -Raw -ErrorAction Stop | ConvertFrom-Json
    if ($sensor.value -gt 0 -and $sensor.value -lt 125 -and ((Get-Date).ToUniversalTime() - [DateTime]::Parse($sensor.at).ToUniversalTime()).TotalSeconds -lt 10) { $temperature = @{ value = [Math]::Round([double]$sensor.value, 1); source = 'Edge Deck' } }
  } catch { }
  $reading = if ($temperature) { $null } else { [EdgeDeckSensors]::Hwinfo() }
  if ($reading) { $temperature = @{ value = [Math]::Round($reading[0], 1); source = 'HWiNFO' } }
  elseif (-not $temperature) { $reading = [EdgeDeckSensors]::CoreTemp(); if ($reading) { $temperature = @{ value = [Math]::Round($reading[0], 1); source = 'Core Temp' } } }
  Send @{ apps = $apps; cpuTemp = $temperature }
  Start-Sleep -Seconds 2
}
