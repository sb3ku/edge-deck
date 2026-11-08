# Edge Deck installer (per user, no administrator rights needed).
#   - checks for Node.js 20 or later (offers to install it with winget)
#   - copies the app to %LOCALAPPDATA%\Programs\Edge Deck and installs its
#     runtime package (mqtt) with npm
#   - adds Start menu shortcuts (Edge Deck, Uninstall Edge Deck), optionally a
#     desktop shortcut and start with Windows
#   - registers Edge Deck in Settings > Apps > Installed apps, with uninstall
# Settings stay in %APPDATA%\Edge Deck, so reinstalling keeps them.
param(
  [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'Programs\Edge Deck'),
  [switch]$DesktopShortcut,
  [switch]$StartWithWindows,
  [switch]$NoShortcuts,
  [switch]$NoLaunch,
  [switch]$Quiet
)
$ErrorActionPreference = 'Stop'
$source = Split-Path -Parent $PSScriptRoot
function Say([string]$text) { if (-not $Quiet) { Write-Host $text } }
function Ask([string]$question) { if ($Quiet) { return $false }; $answer = Read-Host "$question [y/N]"; return $answer -match '^(y|yes)$' }

Say ''
Say 'Edge Deck installer'
Say '-------------------'

# 1. Node.js
$node = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $node -and (Test-Path (Join-Path $env:ProgramFiles 'nodejs\node.exe'))) { $node = Get-Item (Join-Path $env:ProgramFiles 'nodejs\node.exe') }
$nodePath = if ($node) { if ($node.Source) { $node.Source } else { $node.FullName } } else { $null }
$major = if ($nodePath) { [int](((& $nodePath --version) -replace '^v', '') -split '\.')[0] } else { 0 }
if ($major -lt 20) {
  Say 'Edge Deck needs Node.js 20 or later.'
  if ((Get-Command winget.exe -ErrorAction SilentlyContinue) -and (Ask 'Install Node.js LTS now with winget?')) {
    winget install --id OpenJS.NodeJS.LTS -e --silent --accept-package-agreements --accept-source-agreements
    $nodePath = Join-Path $env:ProgramFiles 'nodejs\node.exe'
    if (-not (Test-Path $nodePath)) { throw 'Node.js did not install. Install it from https://nodejs.org and run this installer again.' }
  } else {
    throw 'Install Node.js 20 or later from https://nodejs.org, then run this installer again.'
  }
}
$npm = Join-Path (Split-Path -Parent $nodePath) 'npm.cmd'
if (-not (Test-Path $npm)) { $npm = 'npm.cmd' }
Say "Node.js: $nodePath"

# 2. Copy the app (not the tests, developer files or local data).
$running = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains((Join-Path $InstallDir 'main.cjs')) }
if ($running) { Say 'Closing the running Edge Deck...'; $running | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }; Start-Sleep -Seconds 2 }
# Its dashboard window too (Edge with Edge Deck's own profile), or the new copy cannot open it.
$dashboardProfile = Join-Path $env:APPDATA 'Edge Deck\BrowserProfile'
for ($attempt = 0; $attempt -lt 8; $attempt++) {
  $windows = @(Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($dashboardProfile) })
  if (-not $windows.Count) { break }
  $windows | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }; Start-Sleep -Seconds 1
}
New-Item -ItemType Directory -Force $InstallDir | Out-Null
$items = 'main.cjs', 'package.json', 'package-lock.json', 'LICENSE', 'README.md', 'Start Edge Deck.vbs', 'lib', 'src', 'scripts'
foreach ($item in $items) {
  $from = Join-Path $source $item
  if (-not (Test-Path $from)) { continue }
  $to = Join-Path $InstallDir $item
  if (Test-Path $to) { Remove-Item -Recurse -Force $to }
  Copy-Item -Recurse -Force $from $to
}
Say "Installed to: $InstallDir"
# Marks this as an installed copy, which updates itself from GitHub releases.
$installedVersion = (Get-Content (Join-Path $InstallDir 'package.json') -Raw | ConvertFrom-Json).version
@{ version = $installedVersion; installedAt = (Get-Date).ToUniversalTime().ToString('o') } | ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $InstallDir 'installed.json')

# 3. Runtime package
Say 'Installing the printer connection package...'
Push-Location $InstallDir
try {
  & $npm ci --omit=dev --no-audit --no-fund --loglevel=error
  if ($LASTEXITCODE -ne 0) { throw 'npm could not install Edge Deck''s package. Check your internet connection and try again.' }
} finally { Pop-Location }

# 4. Shortcuts
$launcher = Join-Path $InstallDir 'Start Edge Deck.vbs'
$icon = Join-Path $InstallDir 'src\assets\app\edge-deck.ico'
$wscript = Join-Path $env:SystemRoot 'System32\wscript.exe'
$shell = New-Object -ComObject WScript.Shell
function Shortcut([string]$file, [string]$target, [string]$arguments, [string]$description) {
  $link = $shell.CreateShortcut($file)
  $link.TargetPath = $target; $link.Arguments = $arguments; $link.WorkingDirectory = $InstallDir
  $link.IconLocation = "$icon,0"; $link.Description = $description; $link.Save()
}
$uninstallScript = Join-Path $InstallDir 'scripts\uninstall.ps1'
$powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$uninstallArgs = "-NoProfile -ExecutionPolicy Bypass -File `"$uninstallScript`""
if (-not $NoShortcuts) {
  $programs = Join-Path ([Environment]::GetFolderPath('Programs')) 'Edge Deck'
  New-Item -ItemType Directory -Force $programs | Out-Null
  Shortcut (Join-Path $programs 'Edge Deck.lnk') $wscript "`"$launcher`"" 'Touchscreen dashboard for the XENEON EDGE'
  Shortcut (Join-Path $programs 'Uninstall Edge Deck.lnk') $powershell $uninstallArgs 'Remove Edge Deck'
  if ($DesktopShortcut -or (Ask 'Add a desktop shortcut?')) { Shortcut (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Edge Deck.lnk') $wscript "`"$launcher`"" 'Touchscreen dashboard for the XENEON EDGE' }
  if ($StartWithWindows -or (Ask 'Start Edge Deck when you sign in to Windows?')) { Shortcut (Join-Path ([Environment]::GetFolderPath('Startup')) 'Edge Deck.lnk') $wscript "`"$launcher`"" 'Start Edge Deck' }

  # 5. Settings > Apps entry (this user only).
  $version = (Get-Content (Join-Path $InstallDir 'package.json') -Raw | ConvertFrom-Json).version
  $key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\EdgeDeck'
  New-Item -Force $key | Out-Null
  $values = @{ DisplayName = 'Edge Deck'; DisplayVersion = $version; Publisher = 'Edge Deck contributors'; DisplayIcon = $icon; InstallLocation = $InstallDir
    UninstallString = "`"$powershell`" $uninstallArgs"; URLInfoAbout = 'https://github.com/sb3ku/edge-deck'; NoModify = 1; NoRepair = 1 }
  foreach ($name in $values.Keys) { New-ItemProperty -Path $key -Name $name -Value $values[$name] -PropertyType ($(if ($values[$name] -is [int]) { 'DWord' } else { 'String' })) -Force | Out-Null }
}

Say ''
Say 'Edge Deck is installed. Find it in the Start menu; its icon sits in the taskbar''s hidden icons (^) while it runs.'
if (-not $NoLaunch) { Start-Process $wscript -ArgumentList "`"$launcher`"" }
