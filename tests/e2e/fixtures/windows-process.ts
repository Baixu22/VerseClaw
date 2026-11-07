import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

export type WindowsProcessIdentity = { pid: number; creationTime: number };
export type WindowsProcessCheck = WindowsProcessIdentity & {
  status: 'alive' | 'exited' | 'replaced' | 'terminated' | 'unavailable';
  error?: string;
};

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
  const { stdout } = await promisify(execFile)('powershell.exe', [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script,
  ], { windowsHide: true, timeout: 10_000, encoding: 'utf8', env: {
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
