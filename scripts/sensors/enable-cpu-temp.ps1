# Turns Edge Deck's CPU temperature sensor on or off. Runs elevated (one UAC
# prompt, started from Customize > Display or the PC stats card).
#   On:  installs the signed PawnIO driver if it is missing (the pinned official
#        installer from github.com/namazso/PawnIO.Setup, checked against its
#        SHA-256 and its namazso.eu signature before it runs), copies
#        cpu-sensor.ps1 and the signed PawnIO modules to
#        C:\Program Files\Edge Deck Sensors (only administrators can change it)
#        and adds the scheduled task "Edge Deck CPU temperature", which starts
#        the sensor elevated when you sign in.
#   Off (-Disable): stops and removes the task and that folder. With
#        -RemoveDriver (the Edge Deck uninstaller) it also uninstalls PawnIO if
#        Edge Deck installed it.
# Exit codes: 0 done, 2 PawnIO missing and could not be installed, 4 the
# downloaded installer failed its checks, 1 anything else.
param([switch]$Disable, [switch]$RemoveDriver)
$ErrorActionPreference = 'Stop'
$task = 'Edge Deck CPU temperature'
$folder = Join-Path $env:ProgramFiles 'Edge Deck Sensors'
# Remembered in an admin-only registry key, so only a PawnIO that Edge Deck installed is removed later.
$marker = 'HKLM:\SOFTWARE\Edge Deck'
$setupUrl = 'https://github.com/namazso/PawnIO.Setup/releases/download/2.2.0/PawnIO_setup.exe'
$setupHash = '1F519A22E47187F70A1379A48CA604981C4FCF694F4E65B734AAA74A9FBA3032'
try {
  if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Administrator rights are required.' }
  $existing = Get-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue
  if ($existing) { Stop-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue; Unregister-ScheduledTask -TaskName $task -Confirm:$false }
  # The sensor's PowerShell process ends with its task; any copy still running is stopped.
  Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains('Edge Deck Sensors\cpu-sensor.ps1') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  if (Test-Path -LiteralPath $folder) { Remove-Item -LiteralPath $folder -Recurse -Force }
  if ($Disable) {
    if ($RemoveDriver -and (Get-ItemProperty -Path $marker -Name InstalledPawnIO -ErrorAction SilentlyContinue).InstalledPawnIO -eq 1) {
      $entry = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -eq 'PawnIO' } | Select-Object -First 1
      if ($entry -and $entry.UninstallString -match '^"?([A-Za-z]:\\[^"]+PawnIO[^"]*\.exe)"?') { Start-Process -FilePath $Matches[1] -ArgumentList '-uninstall', '-silent' -Wait }
      Remove-Item -Path $marker -Recurse -Force -ErrorAction SilentlyContinue
    }
    exit 0
  }

  New-Item -ItemType Directory -Path $folder | Out-Null
  if (-not (Get-Service -Name PawnIO -ErrorAction SilentlyContinue)) {
    # Downloaded into the admin-only folder, so nothing can swap it between the checks and running it.
    $setup = Join-Path $folder 'PawnIO_setup.exe'
    try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; $ProgressPreference = 'SilentlyContinue'; Invoke-WebRequest -UseBasicParsing -Uri $setupUrl -OutFile $setup } catch { exit 2 }
    $signature = Get-AuthenticodeSignature -LiteralPath $setup
    if ((Get-FileHash -LiteralPath $setup -Algorithm SHA256).Hash -ne $setupHash -or $signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'CN=namazso\.eu') { Remove-Item -LiteralPath $setup -Force; exit 4 }
    $install = Start-Process -FilePath $setup -ArgumentList '-install', '-silent' -Wait -PassThru
    Remove-Item -LiteralPath $setup -Force -ErrorAction SilentlyContinue
    if ($install.ExitCode -ne 0 -or -not (Get-Service -Name PawnIO -ErrorAction SilentlyContinue)) { exit 2 }
    if (-not (Test-Path $marker)) { New-Item -Path $marker | Out-Null }
    Set-ItemProperty -Path $marker -Name InstalledPawnIO -Value 1 -Type DWord
  }
  # A fresh folder under Program Files: administrators and SYSTEM can change it, everyone else can only read.
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'cpu-sensor.ps1'), (Join-Path $PSScriptRoot 'IntelMSR.bin'), (Join-Path $PSScriptRoot 'AMDFamily17.bin'), (Join-Path $PSScriptRoot 'PawnIO-Modules-COPYING.txt') -Destination $folder
  $user = [Security.Principal.WindowsIdentity]::GetCurrent().Name
  $powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $action = New-ScheduledTaskAction -Execute $powershell -Argument ('-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}"' -f (Join-Path $folder 'cpu-sensor.ps1'))
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
  $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Highest
  $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -Hidden -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
  Register-ScheduledTask -TaskName $task -Description 'Reads the CPU temperature for Edge Deck through the PawnIO driver (read-only).' -Action $action -Trigger $trigger -Principal $principal -Settings $settings | Out-Null
  Start-ScheduledTask -TaskName $task
  exit 0
} catch { exit 1 }
