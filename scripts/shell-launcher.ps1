# Execute through the existing desktop Explorer, not the caller's process tree.
# Microsoft: https://learn.microsoft.com/en-us/windows/win32/shell/samples-execinexplorer
# https://devblogs.microsoft.com/oldnewthing/20131118-00/?p=2643
function Start-ProcessThroughExplorer {
  param(
    [Parameter(Mandatory=$true)][string]$Executable,
    [string]$ArgumentLine = '',
    [Parameter(Mandatory=$true)][string]$WorkingDirectory,
    [ValidateRange(0,10)][int]$ShowWindow = 1
  )
  $shell = New-Object -ComObject Shell.Application
  $windows = $shell.Windows()
  $shellLocation = $null
  $shellRoot = $null
  $desktopHandle = 0
  # SWC_DESKTOP=8 and SWFO_NEEDDISPATCH=1 find the desktop even when all
  # File Explorer folder windows are closed. Use its out-of-process shell.
  $desktop = $windows.FindWindowSW([ref]$shellLocation,[ref]$shellRoot,8,[ref]$desktopHandle,1)
  if (!$desktop -or !$desktopHandle) { throw 'The Windows desktop shell is unavailable.' }
  $desktop.Document.Application.ShellExecute($Executable,$ArgumentLine,$WorkingDirectory,'open',$ShowWindow)
}
