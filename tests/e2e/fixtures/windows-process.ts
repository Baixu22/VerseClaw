import { execFile, type ExecFileOptions } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

// Prefer the current shell; retry only when it is absent, never after an uncertain operation.
async function runPowerShell(script: string, options: ExecFileOptions & { encoding: 'utf8' }) {
  const args = ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script];
  try { return await exec('pwsh.exe', args, options); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return exec('powershell.exe', args, options);
  }
}

export type WindowsProcessIdentity = { pid: number; creationTime: number };
export type WindowsProcessCheck = WindowsProcessIdentity & {
  status: 'alive' | 'exited' | 'replaced' | 'terminated' | 'unavailable';
  error?: string;
};

export async function discoverWindowsElectronProcesses(runRoot: string): Promise<Array<WindowsProcessIdentity & {
  ProcessId: number; ParentProcessId: number; ParentAlive: boolean;
}>> {
  const { stdout } = await runPowerShell(String.raw`
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath($env:CLAWX_PROCESS_RUN_ROOT).TrimEnd('\') + '\'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ElectronProcessInfo {
  [DllImport("ntdll.dll")] static extern int NtQueryInformationProcess(IntPtr handle, int kind, IntPtr data, int length, out int needed);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
  [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll")] static extern bool GetProcessTimes(IntPtr handle, out long created, out long exited, out long kernel, out long user);
  [DllImport("shell32.dll", SetLastError=true)] static extern IntPtr CommandLineToArgvW([MarshalAs(UnmanagedType.LPWStr)] string command, out int count);
  [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr value);
  public static long CreationTime(IntPtr handle) {
    long created, exited, kernel, user;
    if (!GetProcessTimes(handle, out created, out exited, out kernel, out user)) throw new InvalidOperationException("Process times unavailable");
    return created / 10000 - 11644473600000L;
  }
  public static string UserDataDir(string command) {
    int count;
    IntPtr argv = CommandLineToArgvW(command, out count);
    if (argv == IntPtr.Zero) throw new InvalidOperationException("Invalid process command line");
    try {
      for (int i = 1; i < count; i++) {
        string arg = Marshal.PtrToStringUni(Marshal.ReadIntPtr(argv, i * IntPtr.Size));
        if (arg.StartsWith("--user-data-dir=", StringComparison.Ordinal)) return arg.Substring(16);
        if (arg == "--user-data-dir" && i + 1 < count) return Marshal.PtrToStringUni(Marshal.ReadIntPtr(argv, (i + 1) * IntPtr.Size));
      }
      return null;
    } finally { LocalFree(argv); }
  }
  public static string CommandLine(IntPtr handle) {
    int needed;
    NtQueryInformationProcess(handle, 60, IntPtr.Zero, 0, out needed);
    if (needed <= 0) throw new InvalidOperationException("Process command line is unavailable");
    IntPtr data = Marshal.AllocHGlobal(needed);
    try {
      if (NtQueryInformationProcess(handle, 60, data, needed, out needed) < 0) throw new InvalidOperationException("Process command line query failed");
      return Marshal.PtrToStringUni(Marshal.ReadIntPtr(data, IntPtr.Size), (ushort)Marshal.ReadInt16(data) / 2);
    } finally { Marshal.FreeHGlobal(data); }
  }
  public static int Parent(IntPtr handle) {
    IntPtr data = Marshal.AllocHGlobal(IntPtr.Size * 6);
    try {
      int needed;
      if (NtQueryInformationProcess(handle, 0, data, IntPtr.Size * 6, out needed) < 0) throw new InvalidOperationException("Parent process query failed");
      return Marshal.ReadIntPtr(data, IntPtr.Size * 5).ToInt32();
    } finally { Marshal.FreeHGlobal(data); }
  }
}
'@
$rows = @(foreach ($process in [Diagnostics.Process]::GetProcessesByName('electron')) {
  $handle = [IntPtr]::Zero
  try {
    $handle = [ElectronProcessInfo]::OpenProcess(0x1000, $false, $process.Id)
    if ($handle -eq [IntPtr]::Zero) { continue }
    $command = [ElectronProcessInfo]::CommandLine($handle)
    $profile = [ElectronProcessInfo]::UserDataDir($command)
    if (-not $profile) { continue }
    $profile = [IO.Path]::GetFullPath($profile).TrimEnd('\') + '\'
    if (-not $profile.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) { continue }
    $parent = [ElectronProcessInfo]::Parent($handle)
    [pscustomobject]@{ pid = $process.Id; creationTime = [ElectronProcessInfo]::CreationTime($handle); ProcessId = $process.Id;
      ParentProcessId = $parent; ParentAlive = $null -ne (Get-Process -Id $parent -ErrorAction SilentlyContinue) }
  } catch { Write-Verbose $_.Exception.Message } finally {
    if ($handle -ne [IntPtr]::Zero) { $null = [ElectronProcessInfo]::CloseHandle($handle) }
    $process.Dispose()
  }
})
ConvertTo-Json -InputObject $rows -Depth 3 -Compress
`, { windowsHide: true, timeout: 8_000, encoding: 'utf8', env: { ...process.env, CLAWX_PROCESS_RUN_ROOT: runRoot } });
  return JSON.parse(stdout.trim());
}

// Keep the process handle open from identity comparison through termination.
// A recycled PID must never select a different process for the kill operation.
const script = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$entries = $env:CLAWX_PROCESS_IDENTITIES | ConvertFrom-Json
$results = @(foreach ($entry in $entries) {
  $result = [ordered]@{ pid = $entry.pid; creationTime = $entry.creationTime; status = 'unavailable' }
  $owned = $null
  try {
    try { $owned = [Diagnostics.Process]::GetProcessById([int]$entry.pid) }
    catch [ArgumentException] { $result.status = 'exited' }
    if ($null -ne $owned) {
      $null = $owned.Handle
      if ($owned.HasExited) { $result.status = 'exited' }
      elseif (([DateTimeOffset]$owned.StartTime).ToUnixTimeMilliseconds() -ne [long]$entry.creationTime) {
        $result.status = 'replaced'
      } else {
        $result.status = 'alive'
        if ($env:CLAWX_PROCESS_TERMINATE -eq '1') {
          $owned.Kill()
          if ($owned.WaitForExit(2000)) { $result.status = 'terminated' }
        }
      }
    }
  } catch {
    if ($null -ne $owned -and $owned.HasExited) { $result.status = 'exited' }
    else { $result.status = 'unavailable'; $result.error = $_.Exception.Message }
  } finally {
    if ($null -ne $owned) { $owned.Dispose() }
  }
  [pscustomobject]$result
})
ConvertTo-Json -InputObject $results -Depth 3 -Compress
`;

export async function checkWindowsProcesses(
  identities: WindowsProcessIdentity[],
  terminate = false,
): Promise<WindowsProcessCheck[]> {
  if (!identities.length) return [];
  if (process.platform !== 'win32') throw new Error('Windows process checks require Windows');
  if (identities.some(({ pid, creationTime }) => !Number.isSafeInteger(pid) || pid <= 0
    || !Number.isFinite(creationTime) || creationTime <= 0)) {
    throw new Error('A PID and creation time are required for every owned process');
  }
  const entries = identities.map(({ pid, creationTime }) => ({ pid, creationTime: Math.floor(creationTime) }));
  const { stdout } = await runPowerShell(script, { windowsHide: true, timeout: 10_000, encoding: 'utf8', env: {
    ...process.env,
    CLAWX_PROCESS_IDENTITIES: JSON.stringify(entries),
    CLAWX_PROCESS_TERMINATE: terminate ? '1' : '0',
  } });
  const results = JSON.parse(stdout.trim()) as WindowsProcessCheck[];
  if (!Array.isArray(results) || results.length !== entries.length
    || results.some((row, index) => row.pid !== entries[index].pid
      || row.creationTime !== entries[index].creationTime
      || !['alive', 'exited', 'replaced', 'terminated', 'unavailable'].includes(row.status))) {
    throw new Error('Invalid Windows process identity report');
  }
  return results;
}
