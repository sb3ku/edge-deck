param()
$ErrorActionPreference = 'Stop'
try {
  . (Join-Path $PSScriptRoot 'shell-launcher.ps1')
  $projectFolder = Split-Path -Parent $PSScriptRoot
  # The service runs on the installed Node.js (signed, so Smart App Control allows it).
  $executable = (Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1).Source
  if (!$executable) { $executable = Join-Path $env:ProgramFiles 'nodejs\node.exe' }
  if (!(Test-Path -LiteralPath $executable -PathType Leaf)) { throw 'Node.js is not installed. Install it from nodejs.org.' }
  $main = Join-Path $projectFolder 'main.cjs'
  if (!(Test-Path -LiteralPath $main -PathType Leaf)) { throw 'Edge Deck files are missing.' }
  # ShowWindow 0: the service has no window of its own (the dashboard is an Edge window).
  Start-ProcessThroughExplorer -Executable $executable -ArgumentLine ('"' + $main + '" --edge') -WorkingDirectory $projectFolder -ShowWindow 0
} catch {
  [Console]::Error.WriteLine('Edge Deck could not open through the Windows desktop. ' + $_.Exception.Message)
  exit 1
}
