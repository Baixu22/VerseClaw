import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { FullConfig } from '@playwright/test';

// Playwright exposes a cmd.exe wrapper PID on Windows. After that wrapper or
// its worker dies, only the run-specific profile identifies the real Electron.
const cleanupScript = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$root = [IO.Path]::GetFullPath($env:CLAWX_E2E_RUN_ROOT).TrimEnd('\') + '\'
function Get-OwnedElectron {
  @(Get-CimInstance Win32_Process | Where-Object {
    $_.Name -eq 'electron.exe' -and $_.CommandLine -and
    $_.CommandLine.Contains('--user-data-dir') -and
    $_.CommandLine.IndexOf($root, [StringComparison]::OrdinalIgnoreCase) -ge 0
  })
}
$owned = @(Get-OwnedElectron)
$observed = @($owned | Select-Object ProcessId, ParentProcessId, Name, @{Name='ParentAlive'; Expression={ $null -ne (Get-Process -Id $_.ParentProcessId -ErrorAction SilentlyContinue) }})
$ids = @($owned | ForEach-Object { $_.ProcessId })
$roots = @($owned | Where-Object { $_.ParentProcessId -notin $ids })
foreach ($item in $roots) {
  $killArgs = @('/PID', [string]$item.ProcessId, '/T', '/F')
  $null = Start-Process -FilePath taskkill.exe -ArgumentList $killArgs -Wait -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $root ($item.ProcessId.ToString() + '.stdout.txt')) -RedirectStandardError (Join-Path $root ($item.ProcessId.ToString() + '.stderr.txt'))
}
$remaining = @(Get-OwnedElectron)
[ordered]@{
  runRoot = $root
  owned = $observed
  remaining = @($remaining | Select-Object ProcessId, ParentProcessId, Name)
} | ConvertTo-Json -Depth 4 -Compress
if ($remaining.Count -gt 0) { exit 1 }
`;

export async function cleanupElectronProcesses(runRoot: string, outputDir: string) {
  if (process.platform !== 'win32') return;
  runRoot = resolve(runRoot);
  if (!/^verse-claw-e2e-run-[A-Za-z0-9]+$/.test(basename(runRoot))) throw new Error('Invalid Electron test run root');
  await mkdir(outputDir, { recursive: true });
  const reportPath = join(outputDir, 'electron-process-cleanup.json');
  try {
    const { stdout } = await promisify(execFile)('powershell.exe', [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-Command', cleanupScript,
    ], { windowsHide: true, timeout: 15_000, encoding: 'utf8', env: { ...process.env, CLAWX_E2E_RUN_ROOT: runRoot } });
    await writeFile(reportPath, JSON.stringify({ driven_by: 'agent', actor: 'playwright-runner', ...JSON.parse(stdout.trim()) }, null, 2));
  } catch (error) {
    await writeFile(reportPath, JSON.stringify({ driven_by: 'agent', actor: 'playwright-runner', runRoot, error: String(error) }, null, 2));
    throw error;
  }
}

export default async function setupElectronProcessCleanup(config: FullConfig) {
  if (process.platform !== 'win32') return;
  const previousRoot = process.env.CLAWX_E2E_RUN_ROOT;
  const runRoot = await mkdtemp(join(tmpdir(), 'verse-claw-e2e-run-'));
  process.env.CLAWX_E2E_RUN_ROOT = resolve(runRoot);
  const outputDir = config.projects[0].outputDir;
  await mkdir(outputDir, { recursive: true });
  await writeFile(join(outputDir, 'electron-process-run.json'), JSON.stringify({ runRoot, runnerPid: process.pid }));

  return async () => {
    try { await cleanupElectronProcesses(runRoot, outputDir); }
    finally {
      if (previousRoot === undefined) delete process.env.CLAWX_E2E_RUN_ROOT;
      else process.env.CLAWX_E2E_RUN_ROOT = previousRoot;
    }
  };
}
