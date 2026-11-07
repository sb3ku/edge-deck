# Runs under built-in Windows PowerShell 5.1. JSON lines are the only stdout output.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
namespace EdgeDeck {
  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
  internal class MMDeviceEnumerator { }
  [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  internal interface IMMDeviceEnumerator {
    [PreserveSig] int EnumAudioEndpoints(int flow, uint mask, out IMMDeviceCollection devices);
    [PreserveSig] int GetDefaultAudioEndpoint(int flow, int role, out IMMDevice device);
  }
  [ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  internal interface IMMDeviceCollection {
    [PreserveSig] int GetCount(out uint count);
    [PreserveSig] int Item(uint index, out IMMDevice device);
  }
  [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  internal interface IMMDevice {
    [PreserveSig] int Activate(ref Guid id, uint context, IntPtr parameters, [MarshalAs(UnmanagedType.IUnknown)] out object result);
    [PreserveSig] int OpenPropertyStore(int access, out IPropertyStore store);
    [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
    [PreserveSig] int GetState(out int state);
  }
  [StructLayout(LayoutKind.Sequential)]
  internal struct PropertyKey { public Guid Format; public int Id; }
  [StructLayout(LayoutKind.Explicit, Size = 24)]
  internal struct PropVariant { [FieldOffset(0)] public ushort Type; [FieldOffset(8)] public IntPtr Pointer; }
  [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  internal interface IPropertyStore {
    [PreserveSig] int GetCount(out uint count);
    [PreserveSig] int GetAt(uint index, out PropertyKey key);
    [PreserveSig] int GetValue(ref PropertyKey key, out PropVariant value);
  }
  // Undocumented but long-standing Windows interface used by the Sound control
  // panel to choose default endpoints. There is no public replacement API.
  [ComImport, Guid("870AF99C-171D-4F9E-AF0D-E63DF40C2BC9")]
  internal class PolicyConfigClient { }
  [ComImport, Guid("F8679F50-850A-41CF-9C72-430F290290C8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  internal interface IPolicyConfig {
    [PreserveSig] int GetMixFormat([MarshalAs(UnmanagedType.LPWStr)] string id, IntPtr format);
    [PreserveSig] int GetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string id, int defaultFormat, IntPtr format);
    [PreserveSig] int ResetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string id);
    [PreserveSig] int SetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string id, IntPtr endpointFormat, IntPtr mixFormat);
    [PreserveSig] int GetProcessingPeriod([MarshalAs(UnmanagedType.LPWStr)] string id, int defaultPeriod, IntPtr defaultValue, IntPtr minimum);
    [PreserveSig] int SetProcessingPeriod([MarshalAs(UnmanagedType.LPWStr)] string id, IntPtr period);
    [PreserveSig] int GetShareMode([MarshalAs(UnmanagedType.LPWStr)] string id, IntPtr mode);
    [PreserveSig] int SetShareMode([MarshalAs(UnmanagedType.LPWStr)] string id, IntPtr mode);
    [PreserveSig] int GetPropertyValue([MarshalAs(UnmanagedType.LPWStr)] string id, int store, IntPtr key, IntPtr value);
    [PreserveSig] int SetPropertyValue([MarshalAs(UnmanagedType.LPWStr)] string id, int store, IntPtr key, IntPtr value);
    [PreserveSig] int SetDefaultEndpoint([MarshalAs(UnmanagedType.LPWStr)] string id, int role);
    [PreserveSig] int SetEndpointVisibility([MarshalAs(UnmanagedType.LPWStr)] string id, int visible);
  }
  [ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  internal interface IAudioEndpointVolume {
    [PreserveSig] int RegisterControlChangeNotify(IntPtr notify);
    [PreserveSig] int UnregisterControlChangeNotify(IntPtr notify);
    [PreserveSig] int GetChannelCount(out uint count);
    [PreserveSig] int SetMasterVolumeLevel(float level, ref Guid context);
    [PreserveSig] int SetMasterVolumeLevelScalar(float level, ref Guid context);
    [PreserveSig] int GetMasterVolumeLevel(out float level);
    [PreserveSig] int GetMasterVolumeLevelScalar(out float level);
    [PreserveSig] int SetChannelVolumeLevel(uint channel, float level, ref Guid context);
    [PreserveSig] int SetChannelVolumeLevelScalar(uint channel, float level, ref Guid context);
    [PreserveSig] int GetChannelVolumeLevel(uint channel, out float level);
    [PreserveSig] int GetChannelVolumeLevelScalar(uint channel, out float level);
    [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid context);
    [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
  }
  // Per-app volume, as in the Windows volume mixer.
  [ComImport, Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  internal interface IAudioSessionManager2 {
    [PreserveSig] int GetAudioSessionControl(IntPtr sessionId, uint flags, out IntPtr control);
    [PreserveSig] int GetSimpleAudioVolume(IntPtr sessionId, uint flags, out IntPtr volume);
    [PreserveSig] int GetSessionEnumerator(out IAudioSessionEnumerator sessions);
  }
  [ComImport, Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  internal interface IAudioSessionEnumerator {
    [PreserveSig] int GetCount(out int count);
    [PreserveSig] int GetSession(int index, out IAudioSessionControl2 session);
  }
  [ComImport, Guid("BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  internal interface IAudioSessionControl2 {
    [PreserveSig] int GetState(out int state);
    [PreserveSig] int GetDisplayName(out IntPtr name);
    [PreserveSig] int SetDisplayName(IntPtr name, IntPtr context);
    [PreserveSig] int GetIconPath(out IntPtr path);
    [PreserveSig] int SetIconPath(IntPtr path, IntPtr context);
    [PreserveSig] int GetGroupingParam(out Guid group);
    [PreserveSig] int SetGroupingParam(IntPtr group, IntPtr context);
    [PreserveSig] int RegisterAudioSessionNotification(IntPtr client);
    [PreserveSig] int UnregisterAudioSessionNotification(IntPtr client);
    [PreserveSig] int GetSessionIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string id);
    [PreserveSig] int GetSessionInstanceIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string id);
    [PreserveSig] int GetProcessId(out uint id);
  }
  [ComImport, Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  internal interface ISimpleAudioVolume {
    [PreserveSig] int SetMasterVolume(float level, ref Guid context);
    [PreserveSig] int GetMasterVolume(out float level);
    [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid context);
    [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
  }
  public static class AppVolume {
    [DllImport("kernel32.dll")] private static extern IntPtr OpenProcess(uint access, bool inherit, uint id);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] private static extern bool QueryFullProcessImageName(IntPtr process, int flags, System.Text.StringBuilder name, ref int size);
    [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr handle);
    private static bool IsProgram(IAudioSessionControl2 session, string program) {
      uint id;
      if (session.GetProcessId(out id) == 0 && id != 0) {
        IntPtr process = OpenProcess(0x1000, false, id);  // PROCESS_QUERY_LIMITED_INFORMATION
        if (process != IntPtr.Zero) {
          try {
            var name = new System.Text.StringBuilder(1024); int size = name.Capacity;
            if (QueryFullProcessImageName(process, 0, name, ref size)) return System.IO.Path.GetFileName(name.ToString()).Equals(program, StringComparison.OrdinalIgnoreCase);
          } finally { CloseHandle(process); }
        }
      }
      // The session identifier also names the program: ...|<path>\Spotify.exe%b{...}
      string identifier;
      return session.GetSessionIdentifier(out identifier) == 0 && identifier != null && identifier.IndexOf("\\" + program + "%b", StringComparison.OrdinalIgnoreCase) >= 0;
    }
    private delegate void SessionAction(ISimpleAudioVolume volume, int rank);
    // The output the program last played on, and the default output at the
    // time. The helper runs for the whole session, so this persists.
    private static string lastActiveId, lastActiveDefaultId;
    // Every live mixer session of a program on every active output; Spotify
    // can play on an output other than the Windows default. Windows keeps an
    // idle session (and a remembered level) on each output a program has used,
    // so each session is ranked: playing now first, then the default output.
    private static void Each(string program, SessionAction action) {
      IMMDeviceEnumerator enumerator = null; IMMDeviceCollection devices = null; IMMDevice fallback = null;
      try {
        enumerator = (IMMDeviceEnumerator) new MMDeviceEnumerator();
        string defaultId = null; bool sawActive = false;
        if (enumerator.GetDefaultAudioEndpoint(0, 1, out fallback) == 0 && fallback != null) fallback.GetId(out defaultId);
        Marshal.ThrowExceptionForHR(enumerator.EnumAudioEndpoints(0, 1, out devices));
        uint count; Marshal.ThrowExceptionForHR(devices.GetCount(out count));
        for (uint i = 0; i < count && i < 32; i++) {
          IMMDevice device = null; object managerObject = null; IAudioSessionEnumerator sessions = null;
          try {
            if (devices.Item(i, out device) != 0 || device == null) continue;
            string id; bool onDefault = device.GetId(out id) == 0 && id != null && id == defaultId;
            Guid iid = typeof(IAudioSessionManager2).GUID;
            if (device.Activate(ref iid, 23, IntPtr.Zero, out managerObject) != 0 || managerObject == null) continue;
            if (((IAudioSessionManager2) managerObject).GetSessionEnumerator(out sessions) != 0 || sessions == null) continue;
            int total; if (sessions.GetCount(out total) != 0) continue;
            for (int j = 0; j < total && j < 256; j++) {
              IAudioSessionControl2 session = null;
              try {
                if (sessions.GetSession(j, out session) != 0 || session == null) continue;
                int state; if (session.GetState(out state) != 0 || state == 2) continue;  // expired
                if (!IsProgram(session, program)) continue;
                // Playing now first, then (while paused) the output it last played
                // on, unless the default output has changed since; then the default.
                int rank = state == 1 ? 4 + (onDefault ? 1 : 0) : (id != null && id == lastActiveId && defaultId == lastActiveDefaultId ? 2 : 0) + (onDefault ? 1 : 0);
                if (state == 1 && (onDefault || !sawActive)) { lastActiveId = id; lastActiveDefaultId = defaultId; sawActive = true; }
                action((ISimpleAudioVolume) session, rank);
              } finally { if (session != null) Marshal.ReleaseComObject(session); }
            }
          } finally {
            if (sessions != null) Marshal.ReleaseComObject(sessions);
            if (managerObject != null) Marshal.ReleaseComObject(managerObject);
            if (device != null) Marshal.ReleaseComObject(device);
          }
        }
      } finally {
        if (fallback != null) Marshal.ReleaseComObject(fallback);
        if (devices != null) Marshal.ReleaseComObject(devices);
        if (enumerator != null) Marshal.ReleaseComObject(enumerator);
      }
    }
    // The level of the best-ranked session; -1 when the program has no mixer
    // session (not running, or not played yet).
    public static float Get(string program) {
      float level = -1; int best = -1;
      Each(program, (volume, rank) => { float value; if (rank > best && volume.GetMasterVolume(out value) == 0) { level = value; best = rank; } });
      return level;
    }
    // Sets only the best-ranked session(s), so the levels Windows remembers for
    // the program on other outputs stay as they were.
    public static bool Set(string program, float value) {
      if (value < 0 || value > 1 || float.IsNaN(value)) throw new ArgumentOutOfRangeException("value");
      int best = -1; bool done = false;
      Each(program, (volume, rank) => { if (rank > best) best = rank; });
      if (best < 0) return false;
      Each(program, (volume, rank) => { Guid context = Guid.Empty; if (rank == best && volume.SetMasterVolume(value, ref context) == 0) done = true; });
      return done;
    }
  }
  public class AudioDevice { public string id; public string name; public bool isDefault; }
  // Whether the user is busy elsewhere: an exclusive or borderless full-screen
  // app (a game or video) in front, or a locked session or screen saver.
  public static class Presence {
    [StructLayout(LayoutKind.Sequential)] private struct Rect { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] private struct MonitorInfo { public int Size; public Rect Monitor; public Rect Work; public uint Flags; }
    [DllImport("shell32.dll")] private static extern int SHQueryUserNotificationState(out int state);
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr window, out Rect rect);
    [DllImport("user32.dll")] private static extern IntPtr MonitorFromWindow(IntPtr window, uint flags);
    [DllImport("user32.dll")] private static extern bool GetMonitorInfo(IntPtr monitor, ref MonitorInfo info);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr window, System.Text.StringBuilder text, int length);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr window, System.Text.StringBuilder text, int length);
    [DllImport("user32.dll")] private static extern int GetWindowLong(IntPtr window, int index);
    [DllImport("user32.dll")] private static extern bool IsZoomed(IntPtr window);
    [DllImport("user32.dll")] private static extern bool IsWindow(IntPtr window);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr window);
    [DllImport("dwmapi.dll")] private static extern int DwmGetWindowAttribute(IntPtr window, int attribute, out int value, int size);
    private static IntPtr lastApp;  // the app the user was using before tapping the dashboard
    public static string State() {
      int notification;
      if (SHQueryUserNotificationState(out notification) == 0) {
        if (notification == 1) return "away";        // locked, screen saver or switched user
        if (notification == 3) return "fullscreen";  // exclusive Direct3D full screen
      }
      IntPtr window = GetForegroundWindow();
      if (window == IntPtr.Zero) return "normal";
      var title = new System.Text.StringBuilder(256); GetWindowText(window, title, title.Capacity);
      if (title.ToString() == "Edge Deck") {
        // Tapping the touch display activates the dashboard; keep judging the
        // app the user was using, while it is still shown on another monitor.
        IntPtr app = lastApp; int cloaked = 0;
        if (app == IntPtr.Zero || !IsWindow(app) || !IsWindowVisible(app) || IsIconic(app)
            || (DwmGetWindowAttribute(app, 14, out cloaked, 4) == 0 && cloaked != 0)
            || MonitorFromWindow(app, 2) == MonitorFromWindow(window, 2)) return "normal";
        return CoversMonitor(app) ? "fullscreen" : "normal";
      }
      lastApp = window;
      return CoversMonitor(window) ? "fullscreen" : "normal";
    }
    private static bool CoversMonitor(IntPtr window) {
      var name = new System.Text.StringBuilder(256); GetClassName(window, name, name.Capacity);
      string className = name.ToString();
      if (className == "Progman" || className == "WorkerW" || className == "Shell_TrayWnd" || className == "Shell_SecondaryTrayWnd") return false;
      const int WS_CAPTION = 0x00C00000, WS_THICKFRAME = 0x00040000;
      int style = GetWindowLong(window, -16);
      if ((style & WS_CAPTION) == WS_CAPTION) return false;  // ordinary window with a title bar
      if (IsZoomed(window) && (style & WS_THICKFRAME) != 0) return false;  // maximised frameless app (Discord, VS Code)
      Rect rect; if (!GetWindowRect(window, out rect)) return false;
      var info = new MonitorInfo { Size = Marshal.SizeOf(typeof(MonitorInfo)) };
      if (!GetMonitorInfo(MonitorFromWindow(window, 2), ref info)) return false;
      return rect.Left <= info.Monitor.Left && rect.Top <= info.Monitor.Top && rect.Right >= info.Monitor.Right && rect.Bottom >= info.Monitor.Bottom;
    }
  }
  public static class Audio {
    private static float Access(float? set) {
      IMMDeviceEnumerator enumerator = null;
      IMMDevice device = null;
      object endpointObject = null;
      try {
        enumerator = (IMMDeviceEnumerator) new MMDeviceEnumerator();
        Marshal.ThrowExceptionForHR(enumerator.GetDefaultAudioEndpoint(0, 1, out device));
        Guid iid = typeof(IAudioEndpointVolume).GUID;
        Marshal.ThrowExceptionForHR(device.Activate(ref iid, 23, IntPtr.Zero, out endpointObject));
        var endpoint = (IAudioEndpointVolume) endpointObject;
        if (set.HasValue) {
          if (set.Value < 0 || set.Value > 1 || float.IsNaN(set.Value)) throw new ArgumentOutOfRangeException("set");
          Guid context = Guid.Empty;
          Marshal.ThrowExceptionForHR(endpoint.SetMasterVolumeLevelScalar(set.Value, ref context));
        }
        float level;
        Marshal.ThrowExceptionForHR(endpoint.GetMasterVolumeLevelScalar(out level));
        return level;
      } finally {
        if (endpointObject != null) Marshal.ReleaseComObject(endpointObject);
        if (device != null) Marshal.ReleaseComObject(device);
        if (enumerator != null) Marshal.ReleaseComObject(enumerator);
      }
    }
    public static float GetVolume() { return Access(null); }
    public static float SetVolume(float value) { return Access(value); }
    [DllImport("ole32.dll")] private static extern int PropVariantClear(ref PropVariant value);
    private static string DeviceId(IMMDevice device) { string id; Marshal.ThrowExceptionForHR(device.GetId(out id)); return id; }
    private static string FriendlyName(IMMDevice device) {
      IPropertyStore store = null;
      try {
        if (device.OpenPropertyStore(0, out store) != 0 || store == null) return null;
        var key = new PropertyKey { Format = new Guid("A45C254E-DF1C-4EFD-8020-67D146A850E0"), Id = 14 };
        PropVariant value;
        if (store.GetValue(ref key, out value) != 0) return null;
        try { return value.Type == 31 && value.Pointer != IntPtr.Zero ? Marshal.PtrToStringUni(value.Pointer) : null; }
        finally { PropVariantClear(ref value); }
      } finally { if (store != null) Marshal.ReleaseComObject(store); }
    }
    // flow: 0 = playback (render), 1 = recording (capture). Role 0 is the
    // Windows "Default device" shown in Sound settings.
    public static AudioDevice[] ListDevices(int flow) {
      IMMDeviceEnumerator enumerator = null; IMMDeviceCollection collection = null; IMMDevice fallback = null;
      var result = new System.Collections.Generic.List<AudioDevice>();
      try {
        enumerator = (IMMDeviceEnumerator) new MMDeviceEnumerator();
        string defaultId = null;
        if (enumerator.GetDefaultAudioEndpoint(flow, 0, out fallback) == 0 && fallback != null) defaultId = DeviceId(fallback);
        Marshal.ThrowExceptionForHR(enumerator.EnumAudioEndpoints(flow, 1, out collection));
        uint count; Marshal.ThrowExceptionForHR(collection.GetCount(out count));
        for (uint i = 0; i < count && i < 32; i++) {
          IMMDevice device = null;
          try {
            if (collection.Item(i, out device) != 0 || device == null) continue;
            string id = DeviceId(device);
            result.Add(new AudioDevice { id = id, name = FriendlyName(device) ?? "Audio device", isDefault = id == defaultId });
          } finally { if (device != null) Marshal.ReleaseComObject(device); }
        }
      } finally {
        if (fallback != null) Marshal.ReleaseComObject(fallback);
        if (collection != null) Marshal.ReleaseComObject(collection);
        if (enumerator != null) Marshal.ReleaseComObject(enumerator);
      }
      return result.ToArray();
    }
    public static void SetDefaultDevice(string id) {
      object policy = null;
      try {
        policy = new PolicyConfigClient();
        var config = (IPolicyConfig) policy;
        // Console, multimedia and communications, matching Sound settings.
        for (int role = 0; role < 3; role++) Marshal.ThrowExceptionForHR(config.SetDefaultEndpoint(id, role));
      } finally { if (policy != null) Marshal.ReleaseComObject(policy); }
    }
    private static bool Mute(int flow, bool? set) {
      IMMDeviceEnumerator enumerator = null; IMMDevice device = null; object endpointObject = null;
      try {
        enumerator = (IMMDeviceEnumerator) new MMDeviceEnumerator();
        Marshal.ThrowExceptionForHR(enumerator.GetDefaultAudioEndpoint(flow, 0, out device));
        Guid iid = typeof(IAudioEndpointVolume).GUID;
        Marshal.ThrowExceptionForHR(device.Activate(ref iid, 23, IntPtr.Zero, out endpointObject));
        var endpoint = (IAudioEndpointVolume) endpointObject;
        if (set.HasValue) { Guid context = Guid.Empty; Marshal.ThrowExceptionForHR(endpoint.SetMute(set.Value, ref context)); }
        bool muted; Marshal.ThrowExceptionForHR(endpoint.GetMute(out muted)); return muted;
      } finally {
        if (endpointObject != null) Marshal.ReleaseComObject(endpointObject);
        if (device != null) Marshal.ReleaseComObject(device);
        if (enumerator != null) Marshal.ReleaseComObject(enumerator);
      }
    }
    public static bool GetMute(int flow) { return Mute(flow, null); }
    public static bool SetMute(int flow, bool value) { return Mute(flow, value); }
  }
}
'@

$script:mediaInitError = $null
$script:manager = $null
$script:artworkCache = $null
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
  $script:asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetGenericArguments().Length -eq 1 -and
    $_.GetParameters().Length -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
  } | Select-Object -First 1
  $script:asStream = [System.IO.WindowsRuntimeStreamExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsStream' -and $_.GetParameters().Length -eq 1 -and
    $_.GetParameters()[0].ParameterType.FullName -eq 'Windows.Storage.Streams.IRandomAccessStream'
  } | Select-Object -First 1
} catch { $script:mediaInitError = $_.Exception.Message }

function Wait-WinRT($Operation, [Type] $ResultType, [int] $TimeoutMs = 8000) {
  $method = $script:asTask.MakeGenericMethod($ResultType)
  $task = $method.Invoke($null, @($Operation))
  if (-not $task.Wait($TimeoutMs)) {
    try { $Operation.Cancel() } catch { }
    throw 'The media app did not respond in time.'
  }
  return $task.Result
}

function Get-ThumbnailMime([byte[]] $Bytes) {
  if ($Bytes.Length -ge 8 -and [BitConverter]::ToString($Bytes, 0, 8) -eq '89-50-4E-47-0D-0A-1A-0A') { return 'image/png' }
  if ($Bytes.Length -ge 3 -and $Bytes[0] -eq 255 -and $Bytes[1] -eq 216 -and $Bytes[2] -eq 255) { return 'image/jpeg' }
  if ($Bytes.Length -ge 12 -and [Text.Encoding]::ASCII.GetString($Bytes, 0, 4) -eq 'RIFF' -and [Text.Encoding]::ASCII.GetString($Bytes, 8, 4) -eq 'WEBP') { return 'image/webp' }
  return $null
}

function Get-MediaArtwork($Properties, [string] $SourceId) {
  $identity = @($SourceId, [string] $Properties.Title, [string] $Properties.Artist,
    [string] $Properties.AlbumTitle, [string] $Properties.TrackNumber) | ConvertTo-Json -Compress
  if ($null -eq $script:artworkCache -or $script:artworkCache.Identity -ne $identity) {
    $hash = [Security.Cryptography.SHA256]::Create()
    try { $key = [BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($identity))).Replace('-', '').ToLowerInvariant() }
    finally { $hash.Dispose() }
    # Clear the previous cover before attempting to read a different track.
    $script:artworkCache = @{ Identity = $identity; Key = $key; Data = $null; NextAttempt = [DateTime]::MinValue; Available = $false }
  }
  $cache = $script:artworkCache
  if ($null -eq $Properties.Thumbnail) {
    $cache.Data = $null
    $cache.Available = $false
    return $cache
  }
  $now = [DateTime]::UtcNow
  if ($cache.Available -and $now -lt $cache.NextAttempt) { return $cache }
  $cache.Available = $true
  $cache.Data = $null
  # Missing/failed art is retried slowly; successful art is reused for a minute.
  $cache.NextAttempt = $now.AddSeconds(30)
  $stream = $null
  $managed = $null
  $cancellation = $null
  try {
    $streamType = [Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType = WindowsRuntime]
    $stream = Wait-WinRT ($Properties.Thumbnail.OpenReadAsync()) $streamType 2000
    # PowerShell sees this result as an opaque COM object. The official .NET
    # stream adapter projects its random-access interface without dynamic COM
    # property access or an additional native dependency.
    $managed = $script:asStream.Invoke($null, @($stream))
    $size = [uint64] $managed.Length
    if ($size -eq 0 -or $size -gt 2097152) { return $cache }
    $bytes = New-Object byte[] ([int] $size)
    $cancellation = [Threading.CancellationTokenSource]::new(2000)
    $watch = [Diagnostics.Stopwatch]::StartNew()
    $offset = 0
    while ($offset -lt $bytes.Length) {
      $remaining = 2000 - [int] $watch.ElapsedMilliseconds
      if ($remaining -le 0) { return $cache }
      $readTask = $managed.ReadAsync($bytes, $offset, $bytes.Length - $offset, $cancellation.Token)
      if (-not $readTask.Wait($remaining) -or $readTask.Result -le 0) { return $cache }
      $offset += $readTask.Result
    }
    # Validate raster signatures; never turn arbitrary provider bytes (including
    # SVG/HTML) into an image or trust a claimed MIME type by itself.
    $mime = Get-ThumbnailMime $bytes
    if (-not $mime) { return $cache }
    $cache.Data = 'data:' + $mime + ';base64,' + [Convert]::ToBase64String($bytes)
    $cache.NextAttempt = $now.AddSeconds(60)
  } catch {
    # Album art is optional. A missing or unreadable image must not hide the
    # track metadata or disable playback controls.
    $cache.Data = $null
  } finally {
    if ($null -ne $cancellation) { try { $cancellation.Cancel(); $cancellation.Dispose() } catch { } }
    if ($null -ne $managed) { try { $managed.Dispose() } catch { } }
    elseif ($null -ne $stream) { try { ([IDisposable] $stream).Dispose() } catch { } }
  }
  return $cache
}

function Get-MediaSession {
  if ($script:mediaInitError) { throw $script:mediaInitError }
  if ($null -eq $script:manager) {
    $script:manager = Wait-WinRT ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
  }
  # Selecting Spotify explicitly keeps an unrelated browser video from stealing controls.
  foreach ($session in $script:manager.GetSessions()) {
    if ($session.SourceAppUserModelId -match '(?i)spotify') { return $session }
  }
  return $script:manager.GetCurrentSession()
}

function Get-AudioState {
  $audio = [ordered]@{ outputs = @(); inputs = @(); outputMuted = $null; inputMuted = $null; error = $null }
  try {
    $audio.outputs = @([EdgeDeck.Audio]::ListDevices(0))
    $audio.inputs = @([EdgeDeck.Audio]::ListDevices(1))
    if ($audio.outputs.Count) { try { $audio.outputMuted = [EdgeDeck.Audio]::GetMute(0) } catch { } }
    if ($audio.inputs.Count) { try { $audio.inputMuted = [EdgeDeck.Audio]::GetMute(1) } catch { } }
  } catch { $audio.error = $_.Exception.Message }
  return $audio
}

function Assert-AudioDevice($Value, [int] $Flow) {
  if ($Value -isnot [string] -or $Value.Length -gt 200) { throw 'Choose an audio device.' }
  $match = [EdgeDeck.Audio]::ListDevices($Flow) | Where-Object { $_.id -eq $Value } | Select-Object -First 1
  if ($null -eq $match) { throw 'That audio device is no longer available.' }
  return $match.id
}

function Get-MediaState {
  $state = [ordered]@{
    connected = $false; title = ''; artist = ''; source = ''; playing = $false
    volume = $null; canPlay = $false; canPause = $false; canNext = $false; canPrevious = $false
    error = $null; volumeError = $null; artwork = $null; artworkKey = $null; audio = $null; presence = 'normal'
    spotifyVolume = $null
  }
  try { $state.presence = [EdgeDeck.Presence]::State() } catch { }
  try { $state.volume = [int][Math]::Round([EdgeDeck.Audio]::GetVolume() * 100) }
  catch { $state.volumeError = $_.Exception.Message }
  # Spotify's own level in the Windows volume mixer, when it has played here.
  try { $level = [EdgeDeck.AppVolume]::Get('Spotify.exe'); if ($level -ge 0) { $state.spotifyVolume = [int][Math]::Round($level * 100) } } catch { }
  $state.audio = Get-AudioState
  try {
    $session = Get-MediaSession
    if ($null -eq $session) { $script:artworkCache = $null; return $state }
    $properties = Wait-WinRT ($session.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
    $info = $session.GetPlaybackInfo()
    $state.connected = $true
    $state.title = [string] $properties.Title
    $state.artist = [string] $properties.Artist
    $sourceId = [string] $session.SourceAppUserModelId
    $state.source = $sourceId
    if ($sourceId -match '(?i)spotify') { $state.source = 'Spotify' }
    elseif ($sourceId -match '(?i)chrome') { $state.source = 'Google Chrome' }
    elseif ($sourceId -match '(?i)msedge') { $state.source = 'Microsoft Edge' }
    $state.playing = $info.PlaybackStatus.ToString() -eq 'Playing'
    $state.canPlay = [bool] $info.Controls.IsPlayEnabled
    $state.canPause = [bool] $info.Controls.IsPauseEnabled
    $state.canNext = [bool] $info.Controls.IsNextEnabled
    $state.canPrevious = [bool] $info.Controls.IsPreviousEnabled
    $artwork = Get-MediaArtwork $properties $sourceId
    $state.artwork = $artwork.Data
    $state.artworkKey = $artwork.Key
  } catch {
    $state.error = $_.Exception.Message
    $script:manager = $null
    $script:artworkCache = $null
    $state.artwork = $null
    $state.artworkKey = $null
  }
  return $state
}

function Invoke-MediaCommand($Request) {
  if ($Request.action -eq 'state') { return }
  if ($Request.action -in @('volume', 'spotify-volume')) {
    if ($null -eq $Request.value -or $Request.value -is [bool] -or $Request.value -is [string]) { throw 'Volume must be numeric.' }
    $volume = [double] $Request.value
    if ([double]::IsNaN($volume) -or [double]::IsInfinity($volume) -or $volume -lt 0 -or $volume -gt 100) { throw 'Volume must be between 0 and 100.' }
    if ($Request.action -eq 'spotify-volume') {
      if (-not [EdgeDeck.AppVolume]::Set('Spotify.exe', [float] ($volume / 100))) { throw 'Spotify is not playing on this PC. Start a song in Spotify first.' }
    }
    else { $null = [EdgeDeck.Audio]::SetVolume([float] ($volume / 100)) }
    return
  }
  if ($Request.action -eq 'audio-output') { [EdgeDeck.Audio]::SetDefaultDevice((Assert-AudioDevice $Request.value 0)); return }
  if ($Request.action -eq 'audio-input') { [EdgeDeck.Audio]::SetDefaultDevice((Assert-AudioDevice $Request.value 1)); return }
  if ($Request.action -in @('mute-output', 'mute-input')) {
    if ($Request.value -isnot [bool]) { throw 'Choose whether to mute.' }
    $null = [EdgeDeck.Audio]::SetMute($(if ($Request.action -eq 'mute-input') { 1 } else { 0 }), $Request.value)
    return
  }
  $session = Get-MediaSession
  if ($null -eq $session) { throw 'Open Spotify or another media player and start a track first.' }
  $info = $session.GetPlaybackInfo()
  $controls = $info.Controls
  switch ($Request.action) {
    'play-pause' {
      if ($info.PlaybackStatus.ToString() -eq 'Playing') {
        if (-not $controls.IsPauseEnabled) { throw 'This media app does not support pausing.' }
        $operation = $session.TryPauseAsync()
      } else {
        if (-not $controls.IsPlayEnabled) { throw 'This media app does not support resuming playback.' }
        $operation = $session.TryPlayAsync()
      }
    }
    'next' {
      if (-not $controls.IsNextEnabled) { throw 'This media app does not support next track.' }
      $operation = $session.TrySkipNextAsync()
    }
    'previous' {
      if (-not $controls.IsPreviousEnabled) { throw 'This media app does not support previous track.' }
      $operation = $session.TrySkipPreviousAsync()
    }
    default { throw 'Unsupported media action.' }
  }
  $accepted = Wait-WinRT $operation ([bool])
  if (-not $accepted) { throw 'The media app could not complete this action.' }
}

while ($null -ne ($line = [Console]::ReadLine())) {
  $request = $null
  try {
    $request = $line | ConvertFrom-Json
    Invoke-MediaCommand $request
    $reply = @{ id = $request.id; ok = $true; state = (Get-MediaState) }
  } catch {
    $failure = $_.Exception
    while ($failure -is [System.Management.Automation.MethodInvocationException] -and $null -ne $failure.InnerException) { $failure = $failure.InnerException }
    $reply = @{ id = $request.id; ok = $false; error = $failure.Message }
  }
  [Console]::WriteLine(($reply | ConvertTo-Json -Depth 6 -Compress))
}
