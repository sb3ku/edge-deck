Option Explicit
Dim files, shell, folder, executable, helperPath, powershell, launchError
Set files = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
folder = files.GetParentFolderName(WScript.ScriptFullName)
executable = files.BuildPath(folder, "main.cjs")
helperPath = files.BuildPath(folder, "scripts\start-independent.ps1")
powershell = shell.ExpandEnvironmentStrings("%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe")
If Not files.FileExists(executable) Then
  MsgBox "Edge Deck's files are missing. Restore main.cjs in the project folder.", 48, "Edge Deck"
  WScript.Quit 1
ElseIf Not files.FileExists(helperPath) Then
  MsgBox "Edge Deck's launch helper is missing. Restore scripts\start-independent.ps1 in the project folder.", 48, "Edge Deck"
  WScript.Quit 1
Else
  On Error Resume Next
  ' Only this short-lived helper belongs to the caller. Explorer owns the app.
  launchError = shell.Run(Chr(34) & powershell & Chr(34) & " -NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File " & Chr(34) & helperPath & Chr(34), 0, True)
  If Err.Number <> 0 Then launchError = 1
  On Error GoTo 0
  If launchError <> 0 Then
    MsgBox "Edge Deck could not open through the Windows desktop. Wait for the desktop to finish loading, then try the shortcut again.", 48, "Edge Deck"
    WScript.Quit 1
  End If
End If
