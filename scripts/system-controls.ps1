# Edge Deck's quick controls helper. Reads commands from stdin, one per line,
# and answers each with one JSON line { "id", "ok", "state" | "error" }:
#   <id> state                     Wi-Fi, Bluetooth and dark mode as they are now
#   <id> radio WiFi|Bluetooth On|Off   turn a radio on or off (Windows Radios API)
#   <id> dark On|Off               dark mode for apps and Windows (your Personalize setting)
#   <id> sleep                     put the PC to sleep
#   <id> wifi-list                 visible Wi-Fi networks (netsh), which is connected and which are saved
#   <id> wifi-connect <base64 ssid>  connect to a saved network (never a new one: no passwords here)
#   <id> wifi-disconnect           disconnect from the current network
#   <id> bt-list                   paired Bluetooth devices and whether each is connected
#   <id> batteries                 devices whose charge Windows knows: Bluetooth (level, connected, kind) and this PC's battery
# Only these commands exist. It ends with the service.
param([Parameter(Mandatory = $true)][int]$ParentId)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime, System.Windows.Forms
Add-Type -TypeDefinition @'
using System; using System.Collections.Concurrent; using System.Runtime.InteropServices; using System.Threading;
public static class EdgeDeckControlsInput {
  public static readonly BlockingCollection<string> Lines = new BlockingCollection<string>();
  public static void Start() { var t = new Thread(() => { try { string line; while ((line = Console.In.ReadLine()) != null) Lines.Add(line); } catch { } Lines.CompleteAdding(); }); t.IsBackground = true; t.Start(); }
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint msg, UIntPtr wParam, string lParam, uint flags, uint timeout, out UIntPtr result);
  // Tells open apps that the light/dark setting changed.
  public static void ThemeChanged() { UIntPtr result; SendMessageTimeout((IntPtr)0xFFFF, 0x001A, UIntPtr.Zero, "ImmersiveColorSet", 0x0002, 1000, out result); }
}
'@
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
function Await($operation, $type) { $task = $asTask.MakeGenericMethod($type).Invoke($null, @($operation)); if (-not $task.Wait(10000)) { throw 'Windows did not answer.' }; $task.Result }
[void][Windows.Devices.Radios.Radio, Windows.System.Devices, ContentType = WindowsRuntime]
[void][Windows.Devices.Radios.RadioAccessStatus, Windows.System.Devices, ContentType = WindowsRuntime]
[void][Windows.Devices.Radios.RadioState, Windows.System.Devices, ContentType = WindowsRuntime]
[void][Windows.Devices.Bluetooth.BluetoothDevice, Windows.Devices.Bluetooth, ContentType = WindowsRuntime]
[void][Windows.Devices.Bluetooth.BluetoothLEDevice, Windows.Devices.Bluetooth, ContentType = WindowsRuntime]
[void][Windows.Devices.Enumeration.DeviceInformation, Windows.Devices.Enumeration, ContentType = WindowsRuntime]
$netsh = Join-Path $env:SystemRoot 'System32\netsh.exe'
function Field($text, $name) { if ($text -match "(?m)^\s*$([regex]::Escape($name))\s*:\s*(.+?)\s*$") { $Matches[1] } else { $null } }
function SavedProfiles { @((& $netsh wlan show profiles) | ForEach-Object { if ($_ -match 'Profile\s*:\s*(.+?)\s*$') { $Matches[1] } }) }
function WifiList {
  $interface = (& $netsh wlan show interfaces) -join "`n"
  $current = if ((Field $interface 'State') -eq 'connected') { Field $interface 'SSID' } else { $null }
  $saved = SavedProfiles
  $networks = @(); $entry = $null
  foreach ($line in (& $netsh wlan show networks mode=bssid)) {
    if ($line -match '^SSID \d+\s*:\s*(.*)$') { if ($entry) { $networks += $entry }; $entry = @{ ssid = $Matches[1].Trim(); signal = 0; secure = $true } }
    elseif ($entry -and $line -match '^\s*Authentication\s*:\s*(.+)$') { $entry.secure = $Matches[1].Trim() -ne 'Open' }
    elseif ($entry -and $line -match '^\s*Signal\s*:\s*(\d+)%') { $entry.signal = [Math]::Max($entry.signal, [int]$Matches[1]) }
  }
  if ($entry) { $networks += $entry }
  $list = @($networks | Where-Object { $_.ssid } | ForEach-Object { @{ ssid = $_.ssid; signal = $_.signal; secure = $_.secure; connected = ($_.ssid -eq $current); saved = ($saved -contains $_.ssid) } } | Sort-Object { -[int]$_.connected }, { -$_.signal } | Select-Object -First 20)
  if ($current -and -not ($list | Where-Object { $_.connected })) { $list = @(@{ ssid = $current; signal = [int]((Field $interface 'Signal') -replace '\D', ''); secure = $true; connected = $true; saved = $true }) + $list }
  ,$list
}
function BluetoothList {
  $devices = @()
  $classic = Await ([Windows.Devices.Enumeration.DeviceInformation]::FindAllAsync([Windows.Devices.Bluetooth.BluetoothDevice]::GetDeviceSelectorFromPairingState($true))) ([Windows.Devices.Enumeration.DeviceInformationCollection])
  foreach ($info in $classic) {
    try { $device = Await ([Windows.Devices.Bluetooth.BluetoothDevice]::FromIdAsync($info.Id)) ([Windows.Devices.Bluetooth.BluetoothDevice]); $devices += @{ name = "$($info.Name)"; connected = ("$($device.ConnectionStatus)" -eq 'Connected'); kind = "$($device.ClassOfDevice.MajorClass)" } } catch { }
  }
  $le = Await ([Windows.Devices.Enumeration.DeviceInformation]::FindAllAsync([Windows.Devices.Bluetooth.BluetoothLEDevice]::GetDeviceSelectorFromPairingState($true))) ([Windows.Devices.Enumeration.DeviceInformationCollection])
  foreach ($info in $le) {
    if ($devices | Where-Object { $_.name -eq "$($info.Name)" }) { continue }
    try { $device = Await ([Windows.Devices.Bluetooth.BluetoothLEDevice]::FromIdAsync($info.Id)) ([Windows.Devices.Bluetooth.BluetoothLEDevice]); $devices += @{ name = "$($info.Name)"; connected = ("$($device.ConnectionStatus)" -eq 'Connected'); kind = 'LowEnergy' } } catch { }
  }
  ,@($devices | Sort-Object { -[int]$_.connected }, { $_.name } | Select-Object -First 20)
}
# Charge of the Bluetooth devices Windows shows in Settings (DEVPKEY_Bluetooth_Battery on a PnP node of the
# device; for headsets that is often a service node, so nodes are grouped by the device's Bluetooth address)
# and of this PC's own battery. Devices that report no level are left out. Never throws: errors give a shorter list.
function BatteryList {
  $list = @()
  try {
    $nodes = @(Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue | Where-Object { $_.InstanceId -like 'BTH*' -or $_.Class -eq 'Bluetooth' -or $_.InstanceId -like 'HID\{0000*' })
    if ($nodes.Count -gt 0) {
      $props = @(Get-PnpDeviceProperty -InstanceId @($nodes | ForEach-Object { $_.InstanceId }) -KeyName '{104EA319-6EE2-4701-BD47-8DDBF425BBE5} 2', '{83DA6326-97A6-4088-9453-A1923F573B29} 15' -ErrorAction SilentlyContinue)
      $groups = @{}
      foreach ($node in $nodes) {
        $key = if ($node.InstanceId -match '[&_]([0-9A-Fa-f]{12})(?=_|\\|$)') { $Matches[1].ToUpper() } else { $node.InstanceId }
        if (-not $groups.ContainsKey($key)) { $groups[$key] = @{ nodes = @(); level = $null; connected = $false } }
        $group = $groups[$key]; $group.nodes += $node
        foreach ($prop in ($props | Where-Object { $_.InstanceId -eq $node.InstanceId -and $_.Data -ne $null })) {
          if ($prop.KeyName -like '{104EA319*') { $value = [int]$prop.Data; if ($value -ge 0 -and $value -le 100) { $group.level = $value } }
          elseif ($prop.Data -eq $true -and $node.InstanceId -match '^BTH(ENUM|LE)[\\]DEV_') { $group.connected = $true }
        }
      }
      foreach ($group in $groups.Values) {
        if ($group.level -eq $null) { continue }
        $named = @($group.nodes | Where-Object { $_.InstanceId -match '^BTH(ENUM|LE)[\\]DEV_' -and $_.FriendlyName })
        if (-not $named) { $named = @($group.nodes | Where-Object { $_.FriendlyName }) }
        $name = if ($named) { "$($named[0].FriendlyName)" } else { 'Bluetooth device' }
        $name = ($name -replace '\s+(Hands-Free( AG)?|Avrcp Transport|Stereo|Hands-Free Audio)$', '').Trim()
        $ids = ($group.nodes | ForEach-Object { $_.InstanceId }) -join ' '
        $kind = 'other'
        if ($name -match 'mouse|mice|trackball|trackpad') { $kind = 'mouse' }
        elseif ($name -match 'keyboard') { $kind = 'keyboard' }
        elseif ($name -match 'controller|gamepad|dualsense|dualshock|xbox|joy-?con|wireless pad') { $kind = 'controller' }
        elseif ($name -match 'headphone|earbud|earphone|buds|airpods|pods') { $kind = 'headphones' }
        elseif ($name -match 'headset') { $kind = 'headset' }
        elseif ($name -match 'iphone|android|galaxy|pixel|phone') { $kind = 'phone' }
        elseif ($ids -match '\{0000111E-' -and $ids -match '\{0000110B-') { $kind = 'headset' }
        elseif ($ids -match '\{0000110B-') { $kind = 'headphones' }
        $list += @{ name = $name; level = [int]$group.level; connected = [bool]$group.connected; kind = $kind; charging = $false }
      }
    }
  } catch { }
  try {
    $battery = @(Get-CimInstance -ClassName Win32_Battery -OperationTimeoutSec 3 -ErrorAction SilentlyContinue) | Select-Object -First 1
    if ($battery -and $battery.EstimatedChargeRemaining -ne $null) {
      $list += @{ name = 'This PC'; level = [int][Math]::Min(100, [Math]::Max(0, [int]$battery.EstimatedChargeRemaining)); connected = $true; kind = 'laptop'; charging = (@(6, 7, 8, 9) -contains [int]$battery.BatteryStatus) }
    }
  } catch { }
  ,@($list | Sort-Object { -[int]$_.connected }, { $_.name } | Select-Object -First 12)
}
$access = Await ([Windows.Devices.Radios.Radio]::RequestAccessAsync()) ([Windows.Devices.Radios.RadioAccessStatus])
$personalize = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize'

function Radios { Await ([Windows.Devices.Radios.Radio]::GetRadiosAsync()) ([System.Collections.Generic.IReadOnlyList[Windows.Devices.Radios.Radio]]) }
function State {
  $result = @{ wifi = $null; bluetooth = $null; dark = $null; radiosAllowed = ("$access" -eq 'Allowed') }
  foreach ($radio in (Radios)) {
    if ("$($radio.Kind)" -eq 'WiFi' -and $result.wifi -eq $null) { $result.wifi = ("$($radio.State)" -eq 'On') }
    if ("$($radio.Kind)" -eq 'Bluetooth' -and $result.bluetooth -eq $null) { $result.bluetooth = ("$($radio.State)" -eq 'On') }
  }
  try { $theme = Get-ItemProperty -Path $personalize; $result.dark = ($theme.AppsUseLightTheme -eq 0) } catch { }
  $result
}
function Send($value) { [Console]::Out.WriteLine(($value | ConvertTo-Json -Compress -Depth 4)); [Console]::Out.Flush() }

[EdgeDeckControlsInput]::Start()
while ($true) {
  $line = $null
  if (-not [EdgeDeckControlsInput]::Lines.TryTake([ref]$line, 2000)) {
    if ([EdgeDeckControlsInput]::Lines.IsCompleted -or -not (Get-Process -Id $ParentId -ErrorAction SilentlyContinue)) { exit }
    continue
  }
  if ($line -notmatch '^(\d{1,9}) (state|radio (WiFi|Bluetooth) (On|Off)|dark (On|Off)|sleep|wifi-list|wifi-disconnect|bt-list|batteries|wifi-connect ([A-Za-z0-9+/=]{1,200}))$') { continue }
  $id = [int]$Matches[1]; $command = $Matches[2]; $encoded = $Matches[6]
  try {
    if ($command -eq 'wifi-list') { Send @{ id = $id; ok = $true; data = (WifiList) }; continue }
    if ($command -eq 'bt-list') { Send @{ id = $id; ok = $true; data = (BluetoothList) }; continue }
    if ($command -eq 'batteries') { Send @{ id = $id; ok = $true; data = (BatteryList) }; continue }
    if ($command -eq 'wifi-disconnect') { & $netsh wlan disconnect | Out-Null; Send @{ id = $id; ok = $true; data = (WifiList) }; continue }
    if ($command -like 'wifi-connect *') {
      $ssid = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($encoded))
      if (-not ((SavedProfiles) -contains $ssid)) { throw 'This network is not saved yet. Connect to it once in Windows Wi-Fi settings.' }
      $output = (& $netsh wlan connect name="$ssid" ssid="$ssid") -join ' '
      if ($LASTEXITCODE -ne 0) { throw "Windows could not connect: $output" }
      Start-Sleep -Seconds 3
      Send @{ id = $id; ok = $true; data = (WifiList) }; continue
    }
    if ($command -like 'radio *') {
      $kind = $Matches[3]; $wanted = $Matches[4]
      $radio = (Radios) | Where-Object { "$($_.Kind)" -eq $kind } | Select-Object -First 1
      if (-not $radio) { throw "This PC has no $kind radio." }
      $status = Await ($radio.SetStateAsync([Windows.Devices.Radios.RadioState]::$wanted)) ([Windows.Devices.Radios.RadioAccessStatus])
      if ("$status" -ne 'Allowed') { throw "Windows did not allow changing $kind ($status)." }
    } elseif ($command -like 'dark *') {
      $light = if ($Matches[5] -eq 'On') { 0 } else { 1 }
      Set-ItemProperty -Path $personalize -Name AppsUseLightTheme -Value $light -Type DWord
      Set-ItemProperty -Path $personalize -Name SystemUsesLightTheme -Value $light -Type DWord
      [EdgeDeckControlsInput]::ThemeChanged()
    } elseif ($command -eq 'sleep') {
      [void][System.Windows.Forms.Application]::SetSuspendState([System.Windows.Forms.PowerState]::Suspend, $false, $false)
    }
    Send @{ id = $id; ok = $true; state = (State) }
  } catch { Send @{ id = $id; ok = $false; error = "$($_.Exception.Message)".Substring(0, [Math]::Min(200, "$($_.Exception.Message)".Length)) } }
}
