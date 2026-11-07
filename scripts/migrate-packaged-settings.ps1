param(
  [Parameter(Mandatory=$true)][int]$DashboardProcessId,
  [switch]$Apply
)
$ErrorActionPreference = 'Stop'
$projectFolder = Split-Path -Parent $PSScriptRoot
$electronPath = Join-Path $projectFolder 'node_modules\electron\dist\electron.exe'
$hostProcess = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $DashboardProcessId)
if (!$hostProcess -or $hostProcess.ExecutablePath -ne $electronPath) { throw 'The specified process is not this Edge Deck installation.' }
$hostParent = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $hostProcess.ParentProcessId)
if ($hostParent.Name -ne 'explorer.exe') { throw 'The destination must be the independently launched dashboard.' }
$browser = Get-CimInstance Win32_Process -Filter ("ParentProcessId=" + $DashboardProcessId) | Where-Object {
  $_.Name -eq 'msedge.exe' -and $_.CommandLine -like '*Edge Deck\BrowserProfile*'
} | Select-Object -First 1
if (!$browser -or $browser.CommandLine -notmatch '--app="?(http://127\.0\.0\.1:\d+)/index\.html#edge-token=([A-Za-z0-9_-]+)') { throw 'The local dashboard connection was not found.' }
# The transient authentication token is passed only in the child environment.
# It is never written into a command line, artifact or console output.
$env:EDGE_DECK_DIAG_ORIGIN = $Matches[1]
$env:EDGE_DECK_DIAG_TOKEN = $Matches[2]
try {
  $phase = if ($Apply) { 'applied' } else { 'preflight' }
  $outputPath = Join-Path $projectFolder ('artifacts\migration-' + $phase + '.json')
  $errorPath = Join-Path $projectFolder ('artifacts\migration-' + $phase + '-errors.log')
  $arguments = '"' + (Join-Path $PSScriptRoot 'migrate-packaged-settings.cjs') + '"'
  if ($Apply) { $arguments += ' --apply' }
  $worker = Start-Process -FilePath $electronPath -ArgumentList $arguments -WorkingDirectory $projectFolder -WindowStyle Hidden -PassThru -Wait -RedirectStandardOutput $outputPath -RedirectStandardError $errorPath
  [pscustomobject]@{exitCode=$worker.ExitCode;phase=$phase}|ConvertTo-Json -Compress
  if ((Get-Item -LiteralPath $outputPath).Length -gt 0) { Get-Content -LiteralPath $outputPath }
  if ($worker.ExitCode -ne 0) { throw 'Settings migration stopped; only sanitized status is written in artifacts.' }
} finally {
  Remove-Item Env:EDGE_DECK_DIAG_ORIGIN -ErrorAction SilentlyContinue
  Remove-Item Env:EDGE_DECK_DIAG_TOKEN -ErrorAction SilentlyContinue
}
