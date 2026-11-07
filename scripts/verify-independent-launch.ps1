param()
$ErrorActionPreference = 'Stop'
$projectFolder = Split-Path -Parent $PSScriptRoot
$helperPath = Join-Path $PSScriptRoot 'shell-launcher.ps1'
$testFolder = Join-Path ([IO.Path]::GetTempPath()) ('edge-deck-lifecycle-' + [guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $testFolder
$probeProcesses = @()
$jobHandles = @()

# All job handles and process termination below belong to these isolated probes.
# This never closes Codex, Edge Deck, Explorer or any pre-existing process.
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
public static class EdgeDeckLifecycleJob {
  [StructLayout(LayoutKind.Sequential)] struct BasicLimits {
    public long ProcessTime, JobTime; public uint Flags;
    public UIntPtr MinWorkingSet, MaxWorkingSet; public uint ActiveProcesses;
    public UIntPtr Affinity; public uint Priority, Scheduling;
  }
  [StructLayout(LayoutKind.Sequential)] struct IoCounters { public ulong A,B,C,D,E,F; }
  [StructLayout(LayoutKind.Sequential)] struct ExtendedLimits {
    public BasicLimits Basic; public IoCounters Io;
    public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
  }
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr attributes, string name);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job, int type, ref ExtendedLimits limits, uint length);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool CloseHandle(IntPtr handle);
  public static IntPtr Attach(Process process) {
    IntPtr job=CreateJobObject(IntPtr.Zero,null);
    if(job==IntPtr.Zero) throw new Win32Exception();
    var limits=new ExtendedLimits(); limits.Basic.Flags=0x2000; // KILL_ON_JOB_CLOSE
    if(!SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(limits)) || !AssignProcessToJobObject(job,process.Handle)) {
      int error=Marshal.GetLastWin32Error(); CloseHandle(job); throw new Win32Exception(error);
    }
    return job;
  }
}
'@

try {
  $probeScript = Join-Path $testFolder 'probe.ps1'
  @'
param([string]$ResultPath)
$ownProcess=Get-CimInstance Win32_Process -Filter "ProcessId=$PID"
@{pid=$PID;parentPid=$ownProcess.ParentProcessId}|ConvertTo-Json -Compress|Set-Content -LiteralPath $ResultPath
# Bounded lifetime even if the verification process is interrupted.
Start-Sleep -Seconds 30
'@ | Set-Content -LiteralPath $probeScript -Encoding UTF8
  $results = @()
  foreach ($mode in @('direct','explorer')) {
    $resultPath = Join-Path $testFolder ($mode + '.json')
    $parentScript = Join-Path $testFolder ($mode + '.vbs')
    $powerShellExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $probeArguments = '-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $probeScript + '" -ResultPath "' + $resultPath + '"'
    $vbExe = $powerShellExe.Replace('"','""')
    $vbArguments = $probeArguments.Replace('"','""')
    $action = if ($mode -eq 'explorer') {
      $brokerScript = Join-Path $testFolder 'broker.ps1'
      $quotedHelper = "'" + $helperPath.Replace("'","''") + "'"
      $quotedExe = "'" + $powerShellExe.Replace("'","''") + "'"
      $quotedArguments = "'" + $probeArguments.Replace("'","''") + "'"
      $quotedFolder = "'" + $testFolder.Replace("'","''") + "'"
      ('. ' + $quotedHelper + "`r`n" + 'Start-ProcessThroughExplorer -Executable ' + $quotedExe + ' -ArgumentLine ' + $quotedArguments + ' -WorkingDirectory ' + $quotedFolder + ' -ShowWindow 0') | Set-Content -LiteralPath $brokerScript -Encoding UTF8
      $brokerArguments = ('-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $brokerScript + '"').Replace('"','""')
      'CreateObject("WScript.Shell").Run """' + $vbExe + '"" ' + $brokerArguments + '", 0, False'
    } else {
      'CreateObject("WScript.Shell").Run """' + $vbExe + '"" ' + $vbArguments + '", 0, False'
    }
    # Attach the short-lived launcher to the test job before it spawns anything.
    ('WScript.Sleep 1500' + "`r`n" + $action + "`r`nWScript.Sleep 30000") | Set-Content -LiteralPath $parentScript -Encoding ASCII
    $parentError = Join-Path $testFolder ($mode + '-error.txt')
    $parent = Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\cscript.exe') -ArgumentList @('//NoLogo',('"'+$parentScript+'"')) -WindowStyle Hidden -PassThru -RedirectStandardError $parentError
    $job = [EdgeDeckLifecycleJob]::Attach($parent)
    $jobHandles += $job
    $deadline = [DateTime]::UtcNow.AddSeconds(15)
    while (!(Test-Path -LiteralPath $resultPath) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 100 }
    if (!(Test-Path -LiteralPath $resultPath)) { throw "The $mode probe did not report startup. $(Get-Content -LiteralPath $parentError -Raw)" }
    $probe = Get-Content -LiteralPath $resultPath -Raw | ConvertFrom-Json
    $probeProcesses += [int]$probe.pid
    $probeParent = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $probe.parentPid)
    $null = [EdgeDeckLifecycleJob]::CloseHandle($job)
    $jobHandles = @($jobHandles | Where-Object { $_ -ne $job })
    $null = $parent.WaitForExit(3000)
    Start-Sleep -Milliseconds 500
    $survived = $null -ne (Get-Process -Id $probe.pid -ErrorAction SilentlyContinue)
    $expectedSurvival = $mode -eq 'explorer'
    if ($survived -ne $expectedSurvival) { throw "The $mode probe survival did not match the expected lifetime." }
    if ($expectedSurvival -and $probeParent.Name -ne 'explorer.exe') { throw 'The independent probe was not created by Explorer.' }
    $results += [pscustomobject]@{mode=$mode;launcherExited=$parent.HasExited;parentName=$probeParent.Name;survivedLauncherJobClose=$survived}
  }
  $results | ConvertTo-Json
} finally {
  foreach ($job in $jobHandles) { $null = [EdgeDeckLifecycleJob]::CloseHandle($job) }
  foreach ($probePid in $probeProcesses) {
    $probe = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $probePid) -ErrorAction SilentlyContinue
    if ($probe -and $probe.CommandLine -like ('*' + $testFolder + '*')) { Stop-Process -Id $probePid -ErrorAction SilentlyContinue }
  }
  $resolvedTestFolder = [IO.Path]::GetFullPath($testFolder)
  $resolvedTemp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
  if ($resolvedTestFolder.StartsWith($resolvedTemp,[StringComparison]::OrdinalIgnoreCase) -and (Split-Path -Leaf $resolvedTestFolder) -like 'edge-deck-lifecycle-*') {
    Remove-Item -LiteralPath $resolvedTestFolder -Recurse -Force -ErrorAction SilentlyContinue
  }
}
