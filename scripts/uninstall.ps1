# Removes Edge Deck installed by install.ps1: stops it, deletes its shortcuts,
# its Settings > Apps entry and its folder. Your settings in %APPDATA%\Edge Deck
# are kept unless you choose to remove them.
param([switch]$Quiet, [switch]$RemoveSettings)
$ErrorActionPreference = 'Continue'
$installDir = Split-Path -Parent $PSScriptRoot
if (-not $Quiet) {
  Add-Type -AssemblyName System.Windows.Forms
  $answer = [System.Windows.Forms.MessageBox]::Show("Remove Edge Deck from this PC?`n`n$installDir", 'Uninstall Edge Deck', 'YesNo', 'Question')
  if ($answer -ne 'Yes') { exit 0 }
  $RemoveSettings = [System.Windows.Forms.MessageBox]::Show('Also remove your Edge Deck settings and sign-ins?', 'Uninstall Edge Deck', 'YesNo', 'Question') -eq 'Yes'
}
# Stop the service and its dashboard window.
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains((Join-Path $installDir 'main.cjs')) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 2
$data = Join-Path $env:APPDATA 'Edge Deck'
Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains((Join-Path $data 'BrowserProfile')) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
# Shortcuts that point at this installation.
$shell = New-Object -ComObject WScript.Shell
foreach ($folder in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Startup'))) {
  $link = Join-Path $folder 'Edge Deck.lnk'
  if ((Test-Path $link) -and $shell.CreateShortcut($link).Arguments.Contains($installDir)) { Remove-Item -Force $link }
}
Remove-Item -Recurse -Force (Join-Path ([Environment]::GetFolderPath('Programs')) 'Edge Deck') -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\EdgeDeck' -ErrorAction SilentlyContinue
# The CPU temperature sensor (task and admin-only folder) needs administrator rights to remove.
if (Test-Path (Join-Path $env:ProgramFiles 'Edge Deck Sensors')) {
  try { Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe') -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"{0}"' -f (Join-Path $installDir 'scripts\sensors\enable-cpu-temp.ps1')), '-Disable', '-RemoveDriver' } catch { }
}
# Notification name/icon and the edgedeck: link that opens the dashboard.
Remove-Item -Recurse -Force 'HKCU:\Software\Classes\AppUserModelId\EdgeDeck', 'HKCU:\Software\Classes\edgedeck' -ErrorAction SilentlyContinue
if ($RemoveSettings) { Remove-Item -Recurse -Force $data -ErrorAction SilentlyContinue }
# The folder is removed after this script ends (it runs from inside it).
Start-Process -WindowStyle Hidden (Join-Path $env:SystemRoot 'System32\cmd.exe') -ArgumentList "/c timeout /t 2 /nobreak >nul & rmdir /s /q `"$installDir`""
if (-not $Quiet) { [System.Windows.Forms.MessageBox]::Show('Edge Deck was removed.', 'Uninstall Edge Deck') | Out-Null }
