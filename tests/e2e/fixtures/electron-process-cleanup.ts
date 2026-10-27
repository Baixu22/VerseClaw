import { execFile } from 'node:child_process';
import { appendFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { FullConfig } from '@playwright/test';
import { assertTrackedSourceStateUnchanged, captureTrackedSourceState } from './source-mutation-guard';

const execFileAsync = promisify(execFile);

export const ELECTRON_PID_LEDGER = 'electron-pids.jsonl';

// Electron child processes on this Windows host cannot create their .openclaw
// profile below a low-integrity D:\tmp path. Keep the default run root inside
// the ignored workspace scratch directory; explicit CLAWX_E2E_RUN_ROOT* values
// still take precedence for CI and isolated diagnostics.
const DEFAULT_E2E_RUN_ROOT_BASE = join(process.cwd(), '.tmp', 'e2e-runs');

/*
 * Why the CIM sweep is no longer the primary mechanism.
 *
 * The previous teardown enumerated every process with
 * `Get-CimInstance Win32_Process` and matched on the run-root user-data-dir.
 * On Windows hosts with a degraded WMI/CIM provider that call blocks for
 * minutes - reproduced on this repo's Windows dev box, where both the
 * unfiltered query and a `Name = 'electron.exe'` filtered query exceeded five
 * minutes without returning. The teardown budget is 10s, so every Playwright
 * run ended with `Command failed: powershell.exe ...` and a non-zero exit code
 * even when all tests passed.
 *
 * Launch PIDs are now recorded in a ledger and reaped directly: Node's own
 * process.kill (TerminateProcess, no helper process) first, then a bounded
 * taskkill /T for the child tree. The CIM sweep survives as a bounded,
 * best-effort cross-check: when the provider is unavailable it is reported as
 * `status: 'unavailable'` instead of failing the run, while a successful sweep
 * that still observes owned Electron processes still fails the run.
 */
const cleanupScript = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$root = [IO.Path]::GetFullPath($env:CLAWX_E2E_RUN_ROOT).TrimEnd('\') + '\'
function Get-OwnedElectron {
  @(Get-CimInstance Win32_Process -Filter "Name = 'electron.exe'" -OperationTimeoutSec 5 | Where-Object {
    $_.CommandLine -and
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

type LedgerEntry = { pid: number; userDataDir?: string; at?: string };

type ReapOutcome = { pid: number; aliveBefore: boolean; nodeKill: boolean; taskkill: boolean };

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function readLedger(runRoot: string): Promise<LedgerEntry[]> {
  try {
    const raw = await readFile(join(runRoot, ELECTRON_PID_LEDGER), 'utf8');
    return raw
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as LedgerEntry)
      .filter((entry) => Number.isInteger(entry.pid) && entry.pid > 0);
  } catch {
    return [];
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but cannot be signalled by this account.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Reaps one recorded PID.
 *
 * Node's own kill maps to TerminateProcess and needs no helper process, which
 * matters on hosts where taskkill.exe itself blocks (observed here: taskkill
 * exceeded 30s for a single pid). taskkill /T is still attempted afterwards to
 * collapse the child tree, with a short bound and without failing the reaper on
 * its own.
 */
async function killTree(pid: number): Promise<{ nodeKill: boolean; taskkill: boolean; aliveAfter: boolean }> {
  let nodeKill = false;
  try {
    process.kill(pid, 'SIGKILL');
    nodeKill = true;
  } catch {
    // Keep nodeKill false; taskkill still gets a chance below.
  }
  await delay(150);
  let taskkill = false;
  if (isAlive(pid)) {
    try {
      await execFileAsync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, timeout: 8_000 });
      taskkill = true;
    } catch {
      taskkill = false;
    }
  }
  await delay(100);
  return { nodeKill, taskkill, aliveAfter: isAlive(pid) };
}

/**
 * Records a launched Electron PID so the global teardown can reap it without
 * enumerating processes through WMI. Never throws: a launch must not fail just
 * because the ledger could not be written.
 */
export async function recordElectronProcess(userDataDir: string, pid: number | undefined): Promise<void> {
  if (process.platform !== 'win32' || !pid || pid <= 0) return;
  const runRoot = process.env.CLAWX_E2E_RUN_ROOT;
  if (!runRoot) return;
  try {
    await appendFile(
      join(runRoot, ELECTRON_PID_LEDGER),
      `${JSON.stringify({ pid, userDataDir, at: new Date().toISOString() } satisfies LedgerEntry)}\n`,
      'utf8',
    );
  } catch {
    // best effort only
  }
}

export async function cleanupElectronProcesses(runRoot: string, outputDir: string) {
  if (process.platform !== 'win32') return;
  runRoot = resolve(runRoot);
  if (!/^verse-claw-e2e-run-[A-Za-z0-9]+$/.test(basename(runRoot))) throw new Error('Invalid Electron test run root');
  await mkdir(outputDir, { recursive: true });
  const reportPath = join(outputDir, 'electron-process-cleanup.json');

  const ledger = await readLedger(runRoot);
  const outcomes: ReapOutcome[] = [];
  const seen = new Set<number>();
  for (const entry of ledger) {
    if (seen.has(entry.pid)) continue;
    seen.add(entry.pid);
    const aliveBefore = isAlive(entry.pid);
    const kill = aliveBefore
      ? await killTree(entry.pid)
      : { nodeKill: false, taskkill: false, aliveAfter: false };
    outcomes.push({ pid: entry.pid, aliveBefore, nodeKill: kill.nodeKill, taskkill: kill.taskkill });
  }
  const survivors = outcomes.filter((outcome) => isAlive(outcome.pid)).map((outcome) => outcome.pid);

  let sweep: Record<string, unknown>;
  try {
    const { stdout } = await execFileAsync('powershell.exe', [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-Command', cleanupScript,
    ], { windowsHide: true, timeout: 10_000, encoding: 'utf8', env: { ...process.env, CLAWX_E2E_RUN_ROOT: runRoot } });
    sweep = { status: 'ok', ...(JSON.parse(stdout.trim()) as Record<string, unknown>) };
  } catch (error) {
    sweep = { status: 'unavailable', error: String(error).split('\n')[0] };
  }

  const sweepRemaining = Array.isArray(sweep.remaining) ? sweep.remaining.length : 0;
  await writeFile(reportPath, JSON.stringify({
    driven_by: 'agent',
    actor: 'playwright-runner',
    runRoot,
    ledgerEntries: ledger.length,
    reaped: outcomes,
    survivors,
    sweep,
  }, null, 2));

  if (survivors.length > 0) {
    throw new Error(`Electron processes survived reaping: ${survivors.join(', ')}`);
  }
  if (sweep.status === 'ok' && sweepRemaining > 0) {
    throw new Error(`Electron sweep left ${sweepRemaining} process(es) under ${runRoot}`);
  }
}

export default async function setupElectronProcessCleanup(config: FullConfig) {
  if (process.platform !== 'win32') return;
  const previousRoot = process.env.CLAWX_E2E_RUN_ROOT;
  const requestedBase = process.env.CLAWX_E2E_RUN_ROOT_BASE?.trim() || previousRoot?.trim();
  const baseRoot = requestedBase ? resolve(requestedBase) : DEFAULT_E2E_RUN_ROOT_BASE;
  await mkdir(baseRoot, { recursive: true });
  const runRoot = await mkdtemp(join(baseRoot, 'verse-claw-e2e-run-'));
  process.env.CLAWX_E2E_RUN_ROOT = resolve(runRoot);
  const outputDir = config.projects[0].outputDir;
  await mkdir(outputDir, { recursive: true });
  const sourceStateBefore = await captureTrackedSourceState(process.cwd());
  await writeFile(join(outputDir, 'electron-process-run.json'), JSON.stringify({ runRoot, baseRoot, runnerPid: process.pid }, null, 2));
  await writeFile(join(outputDir, 'source-state-before.json'), JSON.stringify(sourceStateBefore, null, 2));

  return async () => {
    let cleanupError: unknown;
    try { await cleanupElectronProcesses(runRoot, outputDir); }
    catch (error) { cleanupError = error; }
    finally {
      if (previousRoot === undefined) delete process.env.CLAWX_E2E_RUN_ROOT;
      else process.env.CLAWX_E2E_RUN_ROOT = previousRoot;
    }

    const sourceStateAfter = await captureTrackedSourceState(process.cwd());
    let sourceChanged = false;
    let sourceGuardError: unknown;
    try {
      assertTrackedSourceStateUnchanged(sourceStateBefore, sourceStateAfter);
    } catch (error) {
      sourceChanged = true;
      sourceGuardError = error;
    }
    await writeFile(join(outputDir, 'source-state-after.json'), JSON.stringify(sourceStateAfter, null, 2));
    await writeFile(join(outputDir, 'source-mutation-guard.json'), JSON.stringify({
      schemaVersion: 'ElectronE2ESourceMutationGuard/v1',
      driven_by: 'agent',
      actor: 'playwright-runner',
      ok: !sourceChanged,
      sourceChanged,
      before: sourceStateBefore,
      after: sourceStateAfter,
    }, null, 2));

    if (cleanupError && sourceGuardError) throw new AggregateError([cleanupError, sourceGuardError], 'Electron E2E cleanup and source guard failed');
    if (cleanupError) throw cleanupError;
    if (sourceGuardError) throw sourceGuardError;
  };
}
