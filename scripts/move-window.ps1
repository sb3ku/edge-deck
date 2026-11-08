param(
  [Parameter(Mandatory=$true)][ValidateRange(1,2147483647)][int]$TargetPid,
  [Parameter(Mandatory=$true)][string]$ProfilePath,
  [ValidateSet('Inspect','Set','Tray','Activate')][string]$Action='Set',
  [int]$Left,[int]$Top,[int]$Width,[int]$Height,
  [long]$WindowStyle=-1,[long]$ExtendedStyle=-1,
  [switch]$Borderless,[switch]$Inspect
)
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
public class EdgeDeckWindow {
  [StructLayout(LayoutKind.Sequential)] public struct Rect {public int Left,Top,Right,Bottom;}
  [StructLayout(LayoutKind.Sequential)] public struct Point {public int X,Y;}
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr handle,out Rect rect);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr handle,out Rect rect);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr handle,ref Point point);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr handle,StringBuilder text,int size);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr handle,StringBuilder text,int size);
  public delegate bool WindowCallback(IntPtr handle, IntPtr arg);
  [DllImport("user32.dll")] public static extern bool EnumWindows(WindowCallback callback, IntPtr arg);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr handle);
  [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr handle);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr handle, out uint processId);
  [DllImport("user32.dll",SetLastError=true)] public static extern bool SetWindowPos(IntPtr handle, IntPtr after, int x, int y, int width, int height, uint flags);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr handle, int mode);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr handle);
  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll",EntryPoint="GetWindowLongPtrW",SetLastError=true)] private static extern IntPtr GetWindowLongPtr64(IntPtr handle,int index);
  [DllImport("user32.dll",EntryPoint="GetWindowLongW",SetLastError=true)] private static extern int GetWindowLong32(IntPtr handle,int index);
  [DllImport("user32.dll",EntryPoint="SetWindowLongPtrW",SetLastError=true)] private static extern IntPtr SetWindowLongPtr64(IntPtr handle,int index,IntPtr value);
  [DllImport("user32.dll",EntryPoint="SetWindowLongW",SetLastError=true)] private static extern int SetWindowLong32(IntPtr handle,int index,int value);
  [DllImport("kernel32.dll")] private static extern void SetLastError(uint error);
  [DllImport("shell32.dll",SetLastError=true)] private static extern IntPtr CommandLineToArgvW([MarshalAs(UnmanagedType.LPWStr)]string commandLine,out int count);
  [DllImport("kernel32.dll")] private static extern IntPtr LocalFree(IntPtr memory);

  public static bool OwnsProfile(string commandLine,string expectedProfile) {
    if(String.IsNullOrWhiteSpace(commandLine)||String.IsNullOrWhiteSpace(expectedProfile))return false;
    int count;IntPtr args=CommandLineToArgvW(commandLine,out count);
    if(args==IntPtr.Zero)return false;
    try {
      for(int i=0;i<count;i++) {
        string arg=Marshal.PtrToStringUni(Marshal.ReadIntPtr(args,i*IntPtr.Size));
        const string prefix="--user-data-dir=";
        if(arg!=null&&arg.StartsWith(prefix,StringComparison.OrdinalIgnoreCase)) {
          string supplied=Path.GetFullPath(arg.Substring(prefix.Length)).TrimEnd('\\');
          string expected=Path.GetFullPath(expectedProfile).TrimEnd('\\');
          if(String.Equals(supplied,expected,StringComparison.OrdinalIgnoreCase))return true;
        }
      }
    } catch(ArgumentException) {return false;}
      catch(NotSupportedException) {return false;}
      catch(PathTooLongException) {return false;}
    finally {LocalFree(args);}
    return false;
  }

  public static long Style(IntPtr handle,int index) {
    return unchecked((uint)(IntPtr.Size==8?GetWindowLongPtr64(handle,index).ToInt64():GetWindowLong32(handle,index)));
  }

  public static void SetStyle(IntPtr handle,int index,long value) {
    SetLastError(0);
    long oldValue=IntPtr.Size==8
      ?SetWindowLongPtr64(handle,index,new IntPtr(unchecked((int)(uint)value))).ToInt64()
      :SetWindowLong32(handle,index,unchecked((int)(uint)value));
    int error=Marshal.GetLastWin32Error();
    if(oldValue==0&&error!=0)throw new Win32Exception(error);
  }

  public static void Apply(IntPtr handle,int left,int top,int width,int height,long style,long extendedStyle,bool borderless) {
    if(width<1||height<1)throw new ArgumentOutOfRangeException("width","Window dimensions must be positive.");
    // Keep the taskbar entry and ownership. Only the non-client frame is removed;
    // this does not put the dashboard into a permanent always-on-top state.
    ShowWindow(handle,9);
    if(style<0)style=Style(handle,-16);
    if(extendedStyle<0)extendedStyle=Style(handle,-20);
    if(borderless) {
      style&=~0x00C40000L; // WS_CAPTION | WS_THICKFRAME
      extendedStyle&=~0x00020301L; // DLGMODALFRAME | WINDOWEDGE | CLIENTEDGE | STATICEDGE
    }
    SetStyle(handle,-16,style);
    SetStyle(handle,-20,extendedStyle);
    // Windows caches frame styles; SWP_FRAMECHANGED is required even at the
    // same position/size. The remaining flags preserve z-order and focus.
    if(!SetWindowPos(handle,IntPtr.Zero,left,top,width,height,0x0074))throw new Win32Exception(Marshal.GetLastWin32Error());
  }

  public static IntPtr Find(int[] allowed) {
    IntPtr found=IntPtr.Zero;
    EnumWindows((handle,arg)=>{
      uint id;GetWindowThreadProcessId(handle,out id);
      if(IsWindowVisible(handle)&&Array.IndexOf(allowed,(int)id)>=0) {
        var title=new StringBuilder(256);var windowClass=new StringBuilder(256);
        GetWindowText(handle,title,256);GetClassName(handle,windowClass,256);
        if(title.ToString().IndexOf("Edge Deck",StringComparison.OrdinalIgnoreCase)>=0 && windowClass.ToString()=="Chrome_WidgetWin_1") {
          found=handle;return false;
        }
      }
      return true;
    },IntPtr.Zero);
    return found;
  }
}
'@

# Physical pixels, without changing global display settings or browser DPI.
$previousDpiContext=[EdgeDeckWindow]::SetThreadDpiAwarenessContext([IntPtr](-4))
try {
  $owned = New-Object 'System.Collections.Generic.HashSet[int]'
  $browserProcesses = @(Get-CimInstance Win32_Process -Filter "Name = 'msedge.exe'")
  foreach ($candidate in $browserProcesses) {
    if ([EdgeDeckWindow]::OwnsProfile($candidate.CommandLine,$ProfilePath)) { [void]$owned.Add([int]$candidate.ProcessId) }
  }
  # A PID alone never authorizes an unrelated process or browser profile.
  $targetBrowser = @($browserProcesses | Where-Object { $_.ProcessId -eq $TargetPid })
  if ($targetBrowser.Count -gt 0 -and [EdgeDeckWindow]::OwnsProfile($targetBrowser[0].CommandLine,$ProfilePath)) {
    [void]$owned.Add($TargetPid)
  }
  for ($level=0; $level -lt 5; $level++) {
    foreach ($candidate in $browserProcesses) {
      if ($owned.Contains([int]$candidate.ParentProcessId)) { [void]$owned.Add([int]$candidate.ProcessId) }
    }
  }
  $windowHandle = [EdgeDeckWindow]::Find([int[]]@($owned))
  if ($windowHandle -eq [IntPtr]::Zero) {
    if ($Inspect -or $Action -eq 'Inspect') { @{ready=$false} | ConvertTo-Json -Compress; exit }
    throw 'The dashboard window is not ready.'
  }
  # Tray: a tool window has no taskbar button (Edge Deck lives in the tray).
  # The style takes effect when the window is shown again, so hide and show it.
  if ($Action -eq 'Tray') {
    $ex = [EdgeDeckWindow]::Style($windowHandle,-20)
    $wanted = ($ex -bor 0x80) -band (-bnot 0x40000)
    if ($wanted -ne $ex) {
      [void][EdgeDeckWindow]::ShowWindow($windowHandle,0)
      [EdgeDeckWindow]::SetStyle($windowHandle,-20,$wanted)
      # SW_SHOWNOACTIVATE: show it again without taking focus (a game may be in front).
      [void][EdgeDeckWindow]::ShowWindow($windowHandle,4)
    }
  }
  # Activate: bring the dashboard to the front (from the tray icon).
  if ($Action -eq 'Activate') { [void][EdgeDeckWindow]::ShowWindow($windowHandle,5); [void][EdgeDeckWindow]::SetForegroundWindow($windowHandle) }
  if (-not $Inspect -and $Action -eq 'Set') {
    [EdgeDeckWindow]::Apply($windowHandle,$Left,$Top,$Width,$Height,$WindowStyle,$ExtendedStyle,$Borderless.IsPresent)
  }
  $rect=New-Object EdgeDeckWindow+Rect
  $client=New-Object EdgeDeckWindow+Rect
  $origin=New-Object EdgeDeckWindow+Point
  [void][EdgeDeckWindow]::GetWindowRect($windowHandle,[ref]$rect)
  [void][EdgeDeckWindow]::GetClientRect($windowHandle,[ref]$client)
  [void][EdgeDeckWindow]::ClientToScreen($windowHandle,[ref]$origin)
  $title=New-Object System.Text.StringBuilder 256
  [void][EdgeDeckWindow]::GetWindowText($windowHandle,$title,256)
  $style=[EdgeDeckWindow]::Style($windowHandle,-16)
  @{
    ready=$true;title=$title.ToString();left=$rect.Left;top=$rect.Top;
    width=($rect.Right-$rect.Left);height=($rect.Bottom-$rect.Top);
    clientLeft=$origin.X;clientTop=$origin.Y;clientWidth=($client.Right-$client.Left);clientHeight=($client.Bottom-$client.Top);
    style=$style;extendedStyle=[EdgeDeckWindow]::Style($windowHandle,-20);
    borderless=(($style -band 0x00C40000) -eq 0);maximized=[EdgeDeckWindow]::IsZoomed($windowHandle)
  } | ConvertTo-Json -Compress
} finally {
  if ($previousDpiContext -ne [IntPtr]::Zero) { [void][EdgeDeckWindow]::SetThreadDpiAwarenessContext($previousDpiContext) }
}
