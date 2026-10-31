import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createServer, createConnection } from 'node:net';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ElectronApplication } from '@playwright/test';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';
import { hostInvoke, startGateway } from './fixtures/fp-p1-harness';

type GatewayStatus = { state: string; gatewayReady?: boolean; port?: number; pid?: number };
type Task = { id: string; status: string };
type TaskResult = { success: boolean; task: Task };
type SupportBundleResult = { success: boolean; path?: string; error?: string };
type LaunchElectron = (options?: Record<string, unknown>) => Promise<ElectronApplication>;

const packagedApp = process.env.CLAWX_AGENT_FIRST_PACKAGED_APP?.trim();
const evidenceRoot = process.env.CLAWX_AGENT_FIRST_EVIDENCE_ROOT?.trim() || 'D:/tmp/agent-first-tf0594';

function portClosed(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    socket.setTimeout(750);
    socket.once('connect', () => { socket.destroy(); resolve(false); });
    socket.once('error', () => { socket.destroy(); resolve(true); });
    socket.once('timeout', () => { socket.destroy(); resolve(false); });
  });
}

async function sha256File(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

function candidate() {
  const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8', windowsHide: true }).trim();
  return { commit: git('rev-parse', 'HEAD'), tree: git('rev-parse', 'HEAD^{tree}'), dirty: git('status', '--porcelain').length > 0 };
}

async function coreJourney(app: ElectronApplication, label: string) {
  const page = await getStableWindow(app);
  await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 60_000 });
  const port = await startGateway(app);
  const created = await hostInvoke<TaskResult>(app, 'agentBrowser', 'createTask', {
    name: `AF OAT cancel ${label}`, url: 'https://example.com', objective: 'cancel without navigation', mode: 'headless', profile: 'default',
  });
  const cancelled = await hostInvoke<TaskResult>(app, 'agentBrowser', 'cancelTask', { taskId: created.task.id });
  expect(cancelled.task.status).toBe('cancelled');
  const tasks = await hostInvoke<{ tasks: Task[] }>(app, 'agentBrowser', 'tasks');
  expect(tasks.tasks.find((task) => task.id === created.task.id)?.status).toBe('cancelled');
  const gateway = await hostInvoke<GatewayStatus>(app, 'gateway', 'status');
  expect(gateway.gatewayReady === true || gateway.state === 'running').toBe(true);
  const theme = await page.evaluate(() => JSON.parse(localStorage.getItem('verse-claw-settings') ?? '{}').state?.theme ?? 'unknown');
  return { page, port, state: { taskStatus: cancelled.task.status, gatewayReady: true, theme } };
}

async function stopGateway(app: ElectronApplication, port: number) {
  await hostInvoke(app, 'gateway', 'stop');
  await expect.poll(() => portClosed(port)).toBe(true);
}

async function startSamePort(app: ElectronApplication, port: number) {
  await hostInvoke(app, 'settings', 'set', { key: 'gatewayPort', value: port });
  await expect.poll(async () => {
    await hostInvoke(app, 'gateway', 'start').catch(() => undefined);
    return (await hostInvoke<GatewayStatus>(app, 'gateway', 'status').catch(() => ({ state: 'unavailable' }))).state;
  }, { timeout: 120_000 }).toBe('running');
}

async function runTarget(
  launchElectronApp: LaunchElectron,
  profileDir: string,
  target: 'source' | 'packaged',
) {
  const base = { skipSetup: true, theme: 'light', profileDir, ...(target === 'packaged' ? { packaged: true, executablePath: packagedApp } : {}) };
  let app = await launchElectronApp(base);
  const core = await coreJourney(app, target);
  let page = core.page;
  let port = core.port;
  const drills: Record<string, unknown> = {};

  await stopGateway(app, port);
  drills.gatewayLoss = { observed: true, portClosed: true };
  await startSamePort(app, port);
  drills.gatewayRecovery = { state: (await hostInvoke<GatewayStatus>(app, 'gateway', 'status')).state };

  await stopGateway(app, port);
  const blocker = createServer();
  await new Promise<void>((resolve, reject) => { blocker.once('error', reject); blocker.listen(0, '127.0.0.1', () => resolve()); });
  const occupiedPort = (blocker.address() as { port: number }).port;
  let startupError = '';
  let failedStatus: GatewayStatus;
  try {
    try {
      await hostInvoke(app, 'settings', 'set', { key: 'gatewayPort', value: occupiedPort });
      await hostInvoke(app, 'gateway', 'start');
    } catch (error) { startupError = String(error); }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    failedStatus = await hostInvoke<GatewayStatus>(app, 'gateway', 'status').catch(() => ({ state: 'unavailable' }));
    expect(failedStatus.state).not.toBe('running');
  } finally {
    await new Promise<void>((resolve) => blocker.close(() => resolve()));
  }
  await startSamePort(app, port);
  drills.gatewayStartupFailure = { observed: startupError.length > 0 || failedStatus.state !== 'running', failedState: failedStatus.state, recovered: true };

  const snapshot = await hostInvoke<{ capturedAt: number; gateway: { state: string } }>(app, 'diagnostics', 'gatewaySnapshot');
  expect(snapshot.capturedAt).toBeGreaterThan(0); expect(['running', 'healthy']).toContain(snapshot.gateway.state);
  drills.diagnostics = { observed: true, gatewayState: snapshot.gateway.state };

  const appData = await app.evaluate(({ app: electronApp }) => electronApp.getPath('userData'));
  const supportDir = join(appData, 'support-bundles');
  await rm(supportDir, { recursive: true, force: true });
  await writeFile(supportDir, 'blocked');
  const blocked = await hostInvoke<SupportBundleResult>(app, 'diagnostics', 'exportSupportBundle');
  expect(blocked.success).toBe(false); expect(blocked.error).toBeTruthy();
  await rm(supportDir, { force: true });
  const exported = await hostInvoke<SupportBundleResult>(app, 'diagnostics', 'exportSupportBundle');
  expect(exported.success).toBe(true); expect(exported.path).toBeTruthy();
  drills.writeFailure = { observed: true, recoveryExport: true, exportBytes: (await stat(exported.path!)).size };

  await page.getByTestId('sidebar-nav-settings').click();
  await page.getByTestId('settings-theme-mode').getByRole('radio', { name: 'Dark' }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await closeElectronApp(app);
  app = await launchElectronApp({ ...base, skipSeed: true });
  page = await getStableWindow(app);
  await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('verse-claw-settings') ?? '{}').state?.theme)).toBe('dark');
  port = await startGateway(app);
  drills.restart = { observed: true, theme: 'dark' };

  const gatewayBeforeCrash = await hostInvoke<GatewayStatus>(app, 'gateway', 'status');
  expect(gatewayBeforeCrash.pid).toBeTruthy();
  try { execFileSync('taskkill.exe', ['/F', '/T', '/PID', String(gatewayBeforeCrash.pid)], { windowsHide: true }); }
  catch (error) { throw new Error(`gateway crash injection failed: ${String(error)}`); }
  await expect.poll(async () => {
    const status: GatewayStatus = await hostInvoke<GatewayStatus>(app, 'gateway', 'status').catch(() => ({ state: 'unavailable' }));
    return status.gatewayReady === true || ['running', 'healthy'].includes(status.state);
  }, { timeout: 120_000 }).toBe(true);
  const afterCrashTask = await hostInvoke<TaskResult>(app, 'agentBrowser', 'createTask', {
    name: 'AF OAT post-crash follow-up', url: 'https://example.com', objective: 'cancel after gateway recovery', mode: 'headless', profile: 'default',
  });
  const afterCrashCancelled = await hostInvoke<TaskResult>(app, 'agentBrowser', 'cancelTask', { taskId: afterCrashTask.task.id });
  expect(afterCrashCancelled.task.status).toBe('cancelled');
  drills.crashRecovery = { observed: true, crashedPid: gatewayBeforeCrash.pid, recovered: true, followUpTask: afterCrashCancelled.task.status };

  const finalProcess = app.process();
  await hostInvoke(app, 'gateway', 'stop').catch(() => undefined);
  await closeElectronApp(app);
  await expect.poll(() => finalProcess.exitCode !== null || finalProcess.signalCode !== null).toBe(true);
  await expect.poll(() => portClosed(port)).toBe(true);
  return { core: core.state, drills, cleanup: { appExitObserved: true, gatewayPortClosed: true, crashRelaunchClean: true } };
}

test.describe('Agent First operational acceptance', () => {
  test.setTimeout(720_000);
  test('runs source OAT and, when a frozen package is provided, packaged parity', async ({ launchElectronApp, homeDir }, testInfo) => {
    const identity = candidate();
    const sourceProfile = join(homeDir, 'source-oat-profile');
    await mkdir(sourceProfile, { recursive: true });
    const source = await runTarget(launchElectronApp as LaunchElectron, sourceProfile, 'source');
    let packaged: Awaited<ReturnType<typeof runTarget>> | null = null;
    let packageIdentity: Record<string, unknown> | null = null;
    if (packagedApp) {
      const profile = join(homeDir, 'packaged-oat-profile'); await mkdir(profile, { recursive: true });
      packaged = await runTarget(launchElectronApp as LaunchElectron, profile, 'packaged');
      expect(packaged.core).toEqual(source.core);
      const resources = join(packagedApp, '..', 'resources');
      packageIdentity = { path: packagedApp, executableSha256: await sha256File(packagedApp), appAsarSha256: await sha256File(join(resources, 'app.asar')).catch(() => null), mainRuntimeSha256: await sha256File(join(resources, 'main-runtime.asar')).catch(() => null) };
    }
    const report = {
      schemaVersion: 'AgentFirstOperationalAcceptance/v1', driven_by: 'agent', actor: 'codex/agent-first-oat', candidate: identity,
      source, packaged: packaged ? { package: packageIdentity, ...packaged } : null,
      verdict: { operational: 'pass', distribution: packaged ? 'pass-unpacked' : 'not-run' },
      distribution: packaged ? { status: 'pass-unpacked', profile: 'win-unpacked core journey and OAT; signed installer/NSIS not exercised' }
        : { status: 'not-run', reason: 'CLAWX_AGENT_FIRST_PACKAGED_APP was not provided; source OAT remains valid and distribution is not inferred.' },
      claims: { realHuman: false, releaseApproved: false, signedInstaller: false, crossPlatform: false },
      limitations: ['Provider timeout/cancel evidence is produced by the existing space-bunny fault suite and is retained separately.', 'Source and packaged results are separate real Electron/Gateway runs; distribution is not extrapolated from source.'],
    };
    await mkdir(evidenceRoot, { recursive: true });
    await writeFile(join(evidenceRoot, 'operational.json'), JSON.stringify(report, null, 2) + '\n');
    await writeFile(testInfo.outputPath('operational.json'), JSON.stringify(report, null, 2) + '\n');
  });
});
