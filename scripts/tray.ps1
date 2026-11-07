# Edge Deck's icon in the taskbar's notification area (the hidden icons under ^).
# Clicking it shows the dashboard; its menu opens, leaves full screen or quits.
# Choices are written to stdout as single words for the service to act on.
# The icon removes itself when the service process ends.
param(
  [Parameter(Mandatory = $true)][string]$IconPath,
  [Parameter(Mandatory = $true)][int]$ParentId
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
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
$quit = $menu.Items.Add('Quit Edge Deck')
$quit.add_Click({ Send 'quit' })
$notify.ContextMenuStrip = $menu
$notify.add_MouseClick({ param($sender, $event) if ($event.Button -eq [System.Windows.Forms.MouseButtons]::Left) { Send 'show' } })
$notify.Visible = $true

# Leave with the service: check every two seconds that it still runs.
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 2000
$timer.add_Tick({
  if (-not (Get-Process -Id $ParentId -ErrorAction SilentlyContinue)) { $timer.Stop(); $notify.Visible = $false; $notify.Dispose(); [System.Windows.Forms.Application]::Exit() }
})
$timer.Start()

try { [System.Windows.Forms.Application]::Run() }
finally { $notify.Visible = $false; $notify.Dispose() }
