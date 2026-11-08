# Edge Deck's icon in the taskbar's notification area (the hidden icons under ^).
# Clicking it shows the dashboard; its menu opens, leaves full screen, checks
# for and installs updates, or quits. Choices go to stdout as single words;
# the service sends lines on stdin ("update <version>", "current", "notice
# <text>") to update the menu and show notifications. The icon removes itself
# when the service process ends.
param(
  [Parameter(Mandatory = $true)][string]$IconPath,
  [Parameter(Mandatory = $true)][int]$ParentId
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
# Lines from the service, read on a background thread into a queue.
Add-Type -TypeDefinition @'
using System; using System.Collections.Concurrent; using System.Threading;
public static class EdgeDeckTrayInput {
  public static readonly ConcurrentQueue<string> Lines = new ConcurrentQueue<string>();
  public static void Start() {
    var thread = new Thread(() => { try { string line; while ((line = Console.In.ReadLine()) != null) Lines.Enqueue(line); } catch { } });
    thread.IsBackground = true; thread.Start();
  }
}
'@
[System.Windows.Forms.Application]::EnableVisualStyles()

function Send([string]$word) { [Console]::Out.WriteLine($word); [Console]::Out.Flush() }

$notify = New-Object System.Windows.Forms.NotifyIcon
$notify.Icon = New-Object System.Drawing.Icon($IconPath, 32, 32)
$notify.Text = 'Edge Deck'

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$open = $menu.Items.Add('Open Edge Deck')
$open.Font = New-Object System.Drawing.Font($open.Font, [System.Drawing.FontStyle]::Bold)
$open.add_Click({ Send 'show' })
$windowed = $menu.Items.Add('Exit full screen')
$windowed.add_Click({ Send 'windowed' })
[void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))
$update = $menu.Items.Add('Update Edge Deck')
$update.Visible = $false
$update.add_Click({ $update.Enabled = $false; $update.Text = 'Updating...'; Send 'update' })
$check = $menu.Items.Add('Check for updates')
$check.add_Click({ Send 'check' })
[void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))
$quit = $menu.Items.Add('Quit Edge Deck')
$quit.add_Click({ Send 'quit' })
$notify.ContextMenuStrip = $menu
$notify.add_MouseClick({ param($sender, $event) if ($event.Button -eq [System.Windows.Forms.MouseButtons]::Left) { Send 'show' } })
# Clicking an "update available" notification installs it.
$notify.add_BalloonTipClicked({ if ($update.Visible -and $update.Enabled) { $update.Enabled = $false; $update.Text = 'Updating...'; Send 'update' } })
$notify.Visible = $true
[EdgeDeckTrayInput]::Start()

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 250
$ticks = 0
$timer.add_Tick({
  $line = $null
  while ([EdgeDeckTrayInput]::Lines.TryDequeue([ref]$line)) {
    if ($line -match '^update (\d+\.\d+\.\d+)$') {
      $version = $Matches[1]
      $first = -not $update.Visible -or $update.Text -ne "Update to $version"
      $update.Text = "Update to $version"; $update.Enabled = $true; $update.Visible = $true
      $notify.Text = "Edge Deck - update $version available"
      if ($first) { $notify.ShowBalloonTip(8000, 'Edge Deck update', "Version $version is available. Click to install it.", [System.Windows.Forms.ToolTipIcon]::Info) }
    } elseif ($line -eq 'current') {
      $update.Visible = $false; $notify.Text = 'Edge Deck'
    } elseif ($line -match '^notice (.{1,200})$') {
      $notify.ShowBalloonTip(6000, 'Edge Deck', $Matches[1], [System.Windows.Forms.ToolTipIcon]::Info)
    } elseif ($line -match '^failed (.{1,200})$') {
      $update.Enabled = $true; $update.Text = $update.Text -replace '^Updating\.\.\.$', 'Update Edge Deck'
      $notify.ShowBalloonTip(8000, 'Edge Deck update failed', $Matches[1], [System.Windows.Forms.ToolTipIcon]::Warning)
    }
  }
  # Leave with the service: check every two seconds that it still runs.
  $script:ticks++
  if ($script:ticks % 8 -eq 0 -and -not (Get-Process -Id $ParentId -ErrorAction SilentlyContinue)) {
    $timer.Stop(); $notify.Visible = $false; $notify.Dispose(); [System.Windows.Forms.Application]::Exit()
  }
})
$timer.Start()

try { [System.Windows.Forms.Application]::Run() }
finally { $notify.Visible = $false; $notify.Dispose() }
