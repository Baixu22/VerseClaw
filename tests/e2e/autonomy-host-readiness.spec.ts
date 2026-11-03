import electronBinaryPath from 'electron';
import { _electron as electron, type ElectronApplication } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import type { SessionActivitySnapshot } from '@shared/types/session-activity';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';
import { allocatePort, buildMockProviderConfig, hostInvoke, startGateway, startScriptedLlm } from './fixtures/fp-p1-harness';
import { recordElectronProcess } from './fixtures/electron-process-cleanup';

test('TF-0674 actual host probes, production close-to-tray continuation and restart recovery', async ({ homeDir, userDataDir }, testInfo) => {
  // Source isolation defers sidecars for 600_000 ms on each of three boots
  // (buildSourceRuntimeIsolationEnv); preserve that production schedule.
  test.setTimeout(2_700_000);
  const llm = await startScriptedLlm((text) => ({ text: text.includes('A5-AFTER-APP') ? 'A5-AFTER-APP-RECEIPT' : text.includes('A5-AFTER-GATEWAY') ? 'A5-AFTER-GATEWAY-RECEIPT' : text.includes('A5-CLOSED') ? 'A5-CLOSED-RECEIPT' : 'A5-FIRST-RECEIPT' }));
  const workspaceDir = join(homeDir, 'a5-workspace');
  const openclawDir = join(homeDir, '.openclaw');
  const sourceStateDir = join(userDataDir, 'openclaw-source-state');
  await mkdir(workspaceDir, { recursive: true });
  await mkdir(sourceStateDir, { recursive: true });
  const config = buildMockProviderConfig(llm.port, workspaceDir);
  const configText = JSON.stringify(config, null, 2);
  await writeFile(join(openclawDir, 'openclaw.json'), configText);
  await writeFile(join(sourceStateDir, 'openclaw.json'), configText);
  await writeFile(join(userDataDir, 'settings.json'), JSON.stringify({ language: 'en', gatewayAutoStart: false, autoUpdate: false }));

  async function waitForSessionRuntime(current: ElectronApplication, phase: string): Promise<void> {
    const startedAt = Date.now();
    // A read-only startup-gated method proves more than the socket handshake.
    // Allow the actual ten-minute source defer plus one minute of startup work.
    await expect.poll(async () => {
      try {
        await hostInvoke(current, 'gateway', 'rpc', { method: 'sessions.list', params: {} });
        return true;
      } catch (error) {
        if (error instanceof Error && error.message.includes('sessions.list unavailable during gateway startup')) return false;
        throw error;
      }
    }, { timeout: 660_000, intervals: [500, 1000, 2000] }).toBe(true);
    await testInfo.attach(`${phase}-runtime-readiness`, {
      body: JSON.stringify({ driven_by: 'agent', actor: 'codex-a5-playwright', phase, waitMs: Date.now() - startedAt, probe: 'sessions.list', ready: true }),
      contentType: 'application/json',
    });
  }

  // This test deliberately runs the production window lifecycle: the normal
  // E2E fixture sets VERSE_CLAW_E2E=1, where close quits instead of hiding.
  async function launchProductionLifecycle(phase: string): Promise<ElectronApplication> {
    const port = await allocatePort();
    const env = Object.fromEntries(Object.entries({
      ...process.env,
      HOME: homeDir, USERPROFILE: homeDir,
      APPDATA: join(homeDir, 'AppData', 'Roaming'), LOCALAPPDATA: join(homeDir, 'AppData', 'Local'),
      OPENCLAW_CONFIG_DIR: openclawDir,
      OPENCLAW_CONFIG_PATH: join(sourceStateDir, 'openclaw.json'), OPENCLAW_STATE_DIR: sourceStateDir,
      VERSE_CLAW_USER_DATA_DIR: userDataDir,
      VERSE_CLAW_E2E: '0', VERSE_CLAW_E2E_SKIP_SETUP: '1',
      VERSE_CLAW_PORT_CLAWX_HOST_API: String(port),
      VITE_DEV_SERVER_URL: undefined,
    }).filter((entry): entry is [string, string] => entry[1] !== undefined));
    const app = await electron.launch({ executablePath: String(electronBinaryPath), args: ['--no-sandbox', `--user-data-dir=${userDataDir}`, '--disable-gpu', '--in-process-gpu', resolve('dist-electron/main/index.js')], env, timeout: 90_000 });
    try {
      await recordElectronProcess(userDataDir, app.process().pid);
      await getStableWindow(app);
      await startGateway(app);
      await waitForSessionRuntime(app, phase);
      return app;
    } catch (error) {
      await closeElectronApp(app);
      throw error;
    }
  }
  type Ack = { childPid: number; gatewayGeneration: string };
  const ack = (app: ElectronApplication) => hostInvoke<Ack>(app, 'gateway', 'rpc', { method: 'runtime.flags.ack', params: {}, timeoutMs: 30_000 });
  let app: ElectronApplication | null = null;
  try {
    app = await launchProductionLifecycle('initial-app');
    const active = await hostInvoke<{ activeWorkspace: { id: string } }>(app, 'workspaces', 'getActive');
    const workspaceId = active.activeWorkspace.id;
    await hostInvoke(app, 'workspaces', 'update', { id: workspaceId, permissionMode: 'fullAccess', rootPath: workspaceDir });
    const created = await hostInvoke<{ key?: string; sessionKey?: string }>(app, 'gateway', 'rpc', { method: 'sessions.create', params: { agentId: 'main', label: 'A5 isolated host-readiness' } });
    const sessionKey = created.key ?? created.sessionKey;
    if (!sessionKey) throw new Error('sessions.create returned no session key');
    await hostInvoke(app, 'workspaces', 'update', { id: workspaceId, activeSessionKey: sessionKey, sessionKey });
    const activity = async (current: ElectronApplication) => (await hostInvoke<{ snapshot: SessionActivitySnapshot }>(current, 'sessionActivity', 'snapshot', { workspaceId, sessionKey })).snapshot;
    const history = async (current: ElectronApplication, marker: string) => {
      const result = await hostInvoke<{ messages?: unknown[] }>(current, 'sessions', 'history', { sessionKey });
      return JSON.stringify(result.messages ?? []).includes(marker);
    };
    async function turn(current: ElectronApplication, marker: string) {
      const dispatchedAt = Date.now();
      await hostInvoke(current, 'chat', 'sendWithMedia', { workspaceId, sessionKey, message: marker, idempotencyKey: `a5-${marker}` });
      let fresh: SessionActivitySnapshot | undefined;
      try {
        await expect.poll(async () => {
          fresh = await activity(current);
          return fresh.policy?.host?.runtime.state === 'supported'
            && Date.parse(fresh.policy.generation.observedAt ?? '') >= dispatchedAt;
        }, { timeout: 150_000 }).toBe(true);
      } finally {
        await testInfo.attach(`${marker}-capability-observation`, {
          body: JSON.stringify({ driven_by: 'agent', actor: 'codex-a5-playwright', dispatchedAt, policy: fresh?.policy }),
          contentType: 'application/json',
        });
      }
      if (!fresh) throw new Error('No fresh capability observation');
      await expect.poll(() => history(current, `${marker}-RECEIPT`), { timeout: 150_000 }).toBe(true);
      const afterReceipt = await activity(current);
      const receiptAgeMs = Date.parse(afterReceipt.policy?.host?.observedAt ?? '')
        - Date.parse(afterReceipt.policy?.generation.observedAt ?? fresh.policy?.generation.observedAt ?? '');
      if (receiptAgeMs > 30_000) {
        expect(afterReceipt.policy?.host?.runtime).toMatchObject({ state: 'unknown', reason: 'capability-observation-missing-or-stale' });
      } else {
        expect(afterReceipt.policy?.host?.runtime.state).toBe('supported');
      }
      return { fresh, afterReceipt };
    }
    const firstApp = app;
    const before = await activity(firstApp);
    expect(before.policy?.host?.runtime.state).toBe('unknown');
    expect(before.policy?.host?.budget.state).toBe('unknown');
    const firstTurn = await turn(firstApp, 'A5-FIRST');
    const afterRun = firstTurn.fresh;
    expect(afterRun.policy?.host?.runtime.state, JSON.stringify(afterRun.policy?.host)).toBe('supported');
    expect(afterRun.policy?.tools?.status).toBe('effective');
    expect(afterRun.policy?.host?.tools).toMatchObject({ state: 'unknown', reason: 'adapter-health-not-probed' });
    expect(afterRun.policy?.host?.unattendedService.state).toBe('unknown');
    const initialAck = await ack(firstApp);

    const closedWindow = await firstApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (!win) throw new Error('No production window');
      win.close();
      return { destroyed: win.isDestroyed(), visible: win.isDestroyed() ? null : win.isVisible() };
    });
    expect(closedWindow).toEqual({ destroyed: false, visible: false });
    const closedTurn = await turn(firstApp, 'A5-CLOSED');
    const afterClose = closedTurn.fresh;
    const closedAck = await ack(firstApp);
    expect(closedAck.gatewayGeneration).toBe(initialAck.gatewayGeneration);
    expect(afterClose.policy?.host?.runtime.state).toBe('supported');
    await firstApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.show());

    await hostInvoke(firstApp, 'gateway', 'restart');
    await expect.poll(async () => {
      const current = await ack(firstApp).catch(() => null);
      return Boolean(current?.gatewayGeneration && current.gatewayGeneration !== initialAck.gatewayGeneration);
    }, { timeout: 150_000 }).toBe(true);
    const restartedAck = await ack(firstApp);
    expect(restartedAck.childPid).not.toBe(initialAck.childPid);
    const afterGatewayRestart = await activity(firstApp);
    expect(afterGatewayRestart.policy?.host?.runtime.state).toBe('unknown');
    await waitForSessionRuntime(firstApp, 'gateway-restart');
    expect(await history(firstApp, 'A5-CLOSED-RECEIPT')).toBe(true);
    const gatewayTurn = await turn(firstApp, 'A5-AFTER-GATEWAY');
    expect(gatewayTurn.fresh.policy?.host?.runtime.state).toBe('supported');

    await hostInvoke(firstApp, 'gateway', 'stop');
    await closeElectronApp(firstApp);
    app = null;
    app = await launchProductionLifecycle('app-restart');
    const secondApp = app;
    expect(await history(secondApp, 'A5-CLOSED-RECEIPT')).toBe(true);
    expect(await history(secondApp, 'A5-AFTER-GATEWAY-RECEIPT')).toBe(true);
    expect((await activity(secondApp)).policy?.host?.runtime.state).toBe('unknown');
    const appTurn = await turn(secondApp, 'A5-AFTER-APP');
    const afterAppRestart = appTurn.fresh;
    expect(afterAppRestart.policy?.host?.runtime.state).toBe('supported');
    expect(llm.anomalies).toEqual([]);
    expect(llm.log.length).toBeGreaterThanOrEqual(4);
    const storedConfig = JSON.parse(await readFile(join(openclawDir, 'openclaw.json'), 'utf8')) as { runtime?: { contextBlock?: unknown } };
    expect(storedConfig.runtime?.contextBlock).toEqual((config.runtime as { contextBlock?: unknown }).contextBlock);
    const output = testInfo.outputPath('host-readiness.json');
    await writeFile(output, JSON.stringify({
      schema: 'clawx.autonomy-host-readiness/v1', driven_by: 'agent', actor: 'codex-a5-playwright',
      candidate: process.env.CLAWX_E2E_CANDIDATE ?? null,
      transport: 'built Electron production-window lifecycle -> actual Main/Gateway/runner -> scripted local provider',
      scope: { workspaceId, sessionKey }, inputConfigSha256: createHash('sha256').update(configText).digest('hex'),
      probes: { before: before.policy?.host, freshFirstRun: afterRun.policy?.host, afterRun: firstTurn.afterReceipt.policy?.host, freshClosedRun: afterClose.policy?.host, afterClose: closedTurn.afterReceipt.policy?.host, afterGatewayRestart: afterGatewayRestart.policy?.host, freshGatewayRun: gatewayTurn.fresh.policy?.host, freshAppRun: afterAppRestart.policy?.host, afterAppRestart: appTurn.afterReceipt.policy?.host },
      journeys: { isolatedRun: true, controlledContinuation: true, productionWindowClose: closedWindow, gatewayRestart: { before: initialAck, after: restartedAck }, appRestart: { transcriptReadback: true, newRunReadback: true }, configPreserved: true },
      providerRequests: llm.log.length, anomalies: llm.anomalies,
      limitations: ['scripted provider is not model quality evidence', 'no installed service or app-exit execution claim', 'no budget measurement', 'no configuration defect observed; no migration or rollback applied', 'source only; installer not tested'],
    }, null, 2));
    await testInfo.attach('host-readiness', { path: output, contentType: 'application/json' });
  } finally {
    if (app) { await hostInvoke(app, 'gateway', 'stop').catch(() => undefined); await closeElectronApp(app); }
    llm.server.closeAllConnections();
    await new Promise<void>((done) => llm.server.close(() => done()));
  }
});
