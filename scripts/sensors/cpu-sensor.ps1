# Edge Deck CPU temperature sensor. Runs elevated (a scheduled task set up by
# enable-cpu-temp.ps1) from C:\Program Files\Edge Deck Sensors, which only
# administrators can change. Once a second it reads the CPU temperature through
# the signed PawnIO driver and a signed PawnIO module, read-only:
#   Intel (IntelMSR.bin): IA32_TEMPERATURE_TARGET (0x1A2, the limit TjMax) and
#     IA32_PACKAGE_THERM_STATUS (0x1B1, degrees below it), package-wide.
#   AMD Ryzen, families 17h-1Ah (AMDFamily17.bin): the Tctl register
#     THM_TCON_CUR_TMP (SMN 0x59800), 0.125 C per step, minus 49 C when the
#     range bit is set (as LibreHardwareMonitor reads it), and the known Tdie
#     offsets of early Ryzen X models.
# It writes { "value": <deg C>, "at": "<ISO time>" } to cpu-temp.json next to
# itself (admin-only to change, readable by everyone) for Edge Deck to read.
# It never writes a register and reads nothing else.
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using Microsoft.Win32.SafeHandles;
public static class EdgeDeckCpuSensor {
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern SafeFileHandle CreateFile(string name, uint access, uint share, IntPtr security, uint mode, uint flags, IntPtr template);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool DeviceIoControl(SafeFileHandle device, uint code, byte[] input, int inputSize, byte[] output, int outputSize, out int returned, IntPtr overlapped);
  const uint LoadBinary = 0xA1B22084, Execute = 0xA1B22104;
  static SafeFileHandle device;
  static bool amd;
  static double tdieOffset;
  public static bool Open(string folder, bool isAmd, double offset) {
    Close();
    amd = isAmd; tdieOffset = offset;
    var handle = CreateFile(@"\\?\GLOBALROOT\Device\PawnIO", 0xC0000000, 3, IntPtr.Zero, 3, 0, IntPtr.Zero);
    if (handle.IsInvalid) return false;
    byte[] blob = File.ReadAllBytes(Path.Combine(folder, isAmd ? "AMDFamily17.bin" : "IntelMSR.bin")); int returned;
    if (!DeviceIoControl(handle, LoadBinary, blob, blob.Length, null, 0, out returned, IntPtr.Zero)) { handle.Dispose(); return false; }
    device = handle; return true;
  }
  public static void Close() { if (device != null) { device.Dispose(); device = null; } }
  static ulong Call(string function, long argument) {
    byte[] input = new byte[40]; Encoding.ASCII.GetBytes(function).CopyTo(input, 0); BitConverter.GetBytes(argument).CopyTo(input, 32);
    byte[] output = new byte[8]; int returned;
    if (device == null || !DeviceIoControl(device, Execute, input, input.Length, output, 8, out returned, IntPtr.Zero)) throw new IOException("read failed");
    return BitConverter.ToUInt64(output, 0);
  }
  // CPU temperature in degrees C, or NaN.
  public static double Read() {
    if (!amd) {
      ulong target = Call("ioctl_read_msr", 0x1A2), status = Call("ioctl_read_msr", 0x1B1);
      double limit = (target >> 16) & 0xFF, below = (status >> 16) & 0x7F;
      return limit > 0 ? limit - below : double.NaN;
    }
    // Other tools reading AMD's internal bus take this shared lock first.
    using (var bus = new Mutex(false, @"Global\Access_PCI")) {
      bool held = false;
      try { held = bus.WaitOne(50); } catch (AbandonedMutexException) { held = true; }
      if (!held) return double.NaN;
      try {
        uint raw = (uint)Call("ioctl_read_smn", 0x00059800);
        double value = (raw >> 21) * 0.125;
        if ((raw & 0x80000) != 0 || (raw & 0x30000) == 0x30000) value -= 49;
        return value + tdieOffset;
      } finally { bus.ReleaseMutex(); }
    }
  }
}
'@
$processor = Get-CimInstance Win32_Processor | Select-Object -First 1
$isAmd = "$($processor.Manufacturer)" -match 'AMD'
$name = "$($processor.Name)"
# Early Ryzen X models report Tctl above the real die temperature (Tdie).
$offset = if ($name -match '1600X|1700X|1800X') { -20 } elseif ($name -match 'Threadripper (19|29)\d\d') { -27 } elseif ($name -match '2700X') { -10 } else { 0 }
$Out = Join-Path $PSScriptRoot 'cpu-temp.json'
$temporary = "$Out.tmp"
$opened = $false
while ($true) {
  try {
    if (-not $opened) { $opened = [EdgeDeckCpuSensor]::Open($PSScriptRoot, $isAmd, $offset) }
    if ($opened) {
      $value = [EdgeDeckCpuSensor]::Read()
      if (-not [double]::IsNaN($value) -and $value -gt 0 -and $value -lt 125) {
        Set-Content -LiteralPath $temporary -Value (@{ value = [Math]::Round($value, 1); at = (Get-Date).ToUniversalTime().ToString('o') } | ConvertTo-Json -Compress) -Encoding ascii
        Move-Item -LiteralPath $temporary -Destination $Out -Force
      }
    }
  } catch { $opened = $false; [EdgeDeckCpuSensor]::Close() }
  Start-Sleep -Seconds $(if ($opened) { 1 } else { 30 })
}
