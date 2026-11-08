# Edge Deck's icon in the taskbar's notification area (the hidden icons under ^).
# Clicking it shows the dashboard; its menu opens, leaves full screen, checks
# for and installs updates, or quits. Choices go to stdout as single words;
# the service sends lines on stdin ("update <version>", "current", "notice
# <text>", "toast <base64 JSON>") to update the menu and show notifications.
# Toasts are Windows notifications under the name "Edge Deck" (registered for
# this user under HKCU\Software\Classes); clicking one opens the dashboard
# through the edgedeck: link. If Windows notifications are unavailable, a
# balloon from the icon is shown instead. The icon removes itself
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
    // The service writes UTF-8 (job and project names may have accents).
    var thread = new Thread(() => { try { var input = new System.IO.StreamReader(Console.OpenStandardInput(), new System.Text.UTF8Encoding(false)); string line; while ((line = input.ReadLine()) != null) Lines.Enqueue(line); } catch { } });
    thread.IsBackground = true; thread.Start();
  }
}
'@
[System.Windows.Forms.Application]::EnableVisualStyles()

function Send([string]$word) { [Console]::Out.WriteLine($word); [Console]::Out.Flush() }

$appRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$dataRoot = [IO.Path]::GetFullPath((Join-Path $env:APPDATA 'Edge Deck'))
$script:toasts = $false
try {
  # The name and icon Windows shows on Edge Deck's notifications.
  $id = 'HKCU:\Software\Classes\AppUserModelId\EdgeDeck'
  if (-not (Test-Path $id)) { New-Item -Path $id | Out-Null }
  Set-ItemProperty -Path $id -Name DisplayName -Value 'Edge Deck'
  Set-ItemProperty -Path $id -Name IconUri -Value (Join-Path $appRoot 'src\assets\app\edge-deck-256.png')
  # edgedeck: opens the dashboard (Start Edge Deck.vbs reaches the running copy).
  $link = 'HKCU:\Software\Classes\edgedeck'
  foreach ($key in @($link, "$link\DefaultIcon", "$link\shell", "$link\shell\open", "$link\shell\open\command")) { if (-not (Test-Path $key)) { New-Item -Path $key | Out-Null } }
  Set-ItemProperty -Path $link -Name '(default)' -Value 'URL:Edge Deck'
  Set-ItemProperty -Path $link -Name 'URL Protocol' -Value ''
  Set-ItemProperty -Path "$link\DefaultIcon" -Name '(default)' -Value (Join-Path $appRoot 'src\assets\app\edge-deck.ico')
  Set-ItemProperty -Path "$link\shell\open\command" -Name '(default)' -Value ('"{0}" "{1}"' -f (Join-Path $env:SystemRoot 'System32\wscript.exe'), (Join-Path $appRoot 'Start Edge Deck.vbs'))
  [void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
  [void][Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime]
  $script:toasts = $true
} catch { $script:toasts = $false }

# A picture for a toast: only PNG/JPEG files from Edge Deck's own folders.
function Picture([string]$file) {
  if (-not $file -or -not [IO.Path]::IsPathRooted($file) -or $file -notmatch '\.(png|jpg)$') { return $null }
  $full = [IO.Path]::GetFullPath($file)
  if (-not ($full.StartsWith($appRoot + '\', 'OrdinalIgnoreCase') -or $full.StartsWith($dataRoot + '\', 'OrdinalIgnoreCase'))) { return $null }
  if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { return $null }
  return ([Uri]$full).AbsoluteUri
}
function Show-Toast($note) {
  $e = { param($text) [Security.SecurityElement]::Escape([string]$text) }
  $parts = New-Object System.Collections.Generic.List[string]
  $logo = Picture $note.logo; $image = Picture $note.image
  if ($logo) { $parts.Add("<image placement=""appLogoOverride"" hint-crop=""circle"" src=""$(& $e $logo)""/>") }
  if ($image) { $parts.Add("<image placement=""hero"" src=""$(& $e $image)""/>") }
  $parts.Add("<text>$(& $e $note.title)</text>")
  $parts.Add("<text>$(& $e $note.body)</text>")
  if ($note.attribution) { $parts.Add("<text placement=""attribution"">$(& $e $note.attribution)</text>") }
  $sound = if ($note.kind -eq 'warning') { 'ms-winsoundevent:Notification.Reminder' } else { 'ms-winsoundevent:Notification.Default' }
  $xml = "<toast activationType=""protocol"" launch=""edgedeck:open""><visual><binding template=""ToastGeneric"">$($parts -join '')</binding></visual><audio src=""$sound""/></toast>"
  $document = New-Object Windows.Data.Xml.Dom.XmlDocument
  $document.LoadXml($xml)
  [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('EdgeDeck').Show((New-Object Windows.UI.Notifications.ToastNotification $document))
}

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
# Other notifications (prints, approvals) open the dashboard.
$script:balloon = ''
$notify.add_BalloonTipClicked({
  if ($script:balloon -eq 'update') { if ($update.Visible -and $update.Enabled) { $update.Enabled = $false; $update.Text = 'Updating...'; Send 'update' } }
  elseif ($script:balloon -eq 'toast') { Send 'show' }
})
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
      if ($first) { $script:balloon = 'update'; $notify.ShowBalloonTip(8000, 'Edge Deck update', "Version $version is available. Click to install it.", [System.Windows.Forms.ToolTipIcon]::Info) }
    } elseif ($line -eq 'current') {
      $update.Visible = $false; $notify.Text = 'Edge Deck'
    } elseif ($line -match '^toast ([A-Za-z0-9+/=]{1,6000})$') {
      $note = $null
      try { $note = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Matches[1])) | ConvertFrom-Json } catch { }
      if ($note -and $note.title -and $note.body) {
        $shown = $false
        if ($script:toasts) { try { Show-Toast $note; $shown = $true } catch { } }
        if (-not $shown) {
          $script:balloon = 'toast'
          $icon = if ($note.kind -eq 'warning') { [System.Windows.Forms.ToolTipIcon]::Warning } else { [System.Windows.Forms.ToolTipIcon]::Info }
          $notify.ShowBalloonTip(8000, ([string]$note.title).Substring(0, [Math]::Min(60, ([string]$note.title).Length)), [string]$note.body, $icon)
        }
      }
    } elseif ($line -match '^notice (.{1,200})$') {
      $script:balloon = 'notice'
      $notify.ShowBalloonTip(6000, 'Edge Deck', $Matches[1], [System.Windows.Forms.ToolTipIcon]::Info)
    } elseif ($line -match '^failed (.{1,200})$') {
      $script:balloon = 'notice'
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
