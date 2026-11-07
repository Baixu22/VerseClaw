import { appendFile, mkdir, mkdtemp, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import type { FullConfig } from '@playwright/test';
import { checkWindowsProcesses, discoverWindowsElectronProcesses, type WindowsProcessIdentity, type WindowsProcessCheck } from './windows-process';
import { assertTrackedSourceStateUnchanged, captureTrackedSourceState } from './source-mutation-guard';

export const ELECTRON_PID_LEDGER = 'electron-pids.jsonl';

// Electron child processes on this Windows host cannot create their .openclaw
// profile below a low-integrity D:\tmp path. Keep the default run root inside
// the ignored workspace scratch directory; explicit CLAWX_E2E_RUN_ROOT* values
// still take precedence for CI and isolated diagnostics.
const DEFAULT_E2E_RUN_ROOT_BASE = join(process.cwd(), '.tmp', 'e2e-runs');

type LedgerEntry = WindowsProcessIdentity & { userDataDir: string; at: string };

export async function recordElectronLaunch(userDataDir: string): Promise<string | undefined> {
  if (process.platform !== 'win32') return;
  const runRoot = process.env.CLAWX_E2E_RUN_ROOT;
  if (!runRoot) throw new Error('Electron launch requires an active test run');
  const marker = join(runRoot, `electron-launch-${randomUUID()}.json`);
  await writeFile(marker, JSON.stringify({ userDataDir }));
  return marker;
}

export async function completeElectronLaunch(marker: string | undefined): Promise<void> {
  if (marker) await unlink(marker);
}

export async function recordElectronProcesses(userDataDir: string, identities: WindowsProcessIdentity[]): Promise<void> {
  if (process.platform !== 'win32') return;
  const runRoot = process.env.CLAWX_E2E_RUN_ROOT;
  if (!runRoot) throw new Error('Electron process ledger requires an active test run');
  const at = new Date().toISOString();
  await appendFile(join(runRoot, ELECTRON_PID_LEDGER), identities.map(({ pid, creationTime }) =>
    JSON.stringify({ pid, creationTime, userDataDir, at } satisfies LedgerEntry)).join('\n') + '\n', 'utf8');
}

export async function cleanupElectronProcesses(runRoot: string, outputDir: string) {
  if (process.platform !== 'win32') return;
  runRoot = resolve(runRoot);
  if (!/^verse-claw-e2e-run-[A-Za-z0-9]+$/.test(basename(runRoot))) throw new Error('Invalid Electron test run root');
  await mkdir(outputDir, { recursive: true });
  let checks: WindowsProcessCheck[] = [];
  let failure: unknown;
  let ledger: LedgerEntry[] = [];
  let owned: Awaited<ReturnType<typeof discoverWindowsElectronProcesses>> = [];
  let pending: string[] = [];
  try {
    let raw = '';
    try { raw = await readFile(join(runRoot, ELECTRON_PID_LEDGER), 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    ledger = raw.split(/\r?\n/).filter((line) => line.trim()).map((line) => JSON.parse(line) as LedgerEntry);
    for (const entry of ledger) {
      const path = typeof entry.userDataDir === 'string' ? relative(runRoot, resolve(entry.userDataDir)) : '..';
      if (path === '..' || path.startsWith('../') || path.startsWith('..\\') || isAbsolute(path)) {
        throw new Error('Electron process ledger entry is outside this test run');
      }
    }
    pending = (await readdir(runRoot)).filter((name) => /^electron-launch-[\da-f-]+\.json$/.test(name));
    // The runner owns cleanup even when its worker aborts inside Electron spawn,
    // before Playwright returns an app and before any native identity is recorded.
    if (pending.length || !ledger.length) owned = await discoverWindowsElectronProcesses(runRoot);
    const identities = [...new Map([...ledger, ...owned].map((entry) => [`${entry.pid}:${entry.creationTime}`, entry])).values()];
    checks = await checkWindowsProcesses(identities, true);
    if (checks.some(({ status }) => status === 'alive' || status === 'unavailable')) {
      throw new Error('Owned Electron processes survived cleanup or could not be checked');
    }
    await Promise.all(pending.map((name) => unlink(join(runRoot, name))));
  } catch (error) { failure = error; }
  await writeFile(join(outputDir, 'electron-process-cleanup.json'), JSON.stringify({
    driven_by: 'agent', actor: 'playwright-runner', runRoot, ledgerEntries: ledger.length,
    checks, owned, remaining: checks.filter(({ status }) => status === 'alive'),
    survivors: checks.filter(({ status }) => status === 'alive'), pendingLaunches: pending.length,
    status: failure ? 'failed' : 'passed', ...(failure ? { error: String(failure) } : {}),
  }, null, 2));
  if (failure) throw failure;
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
