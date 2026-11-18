import type { ElectronApplication } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { SessionActivitySnapshot } from '@shared/types/session-activity';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';
import { allocatePort, buildMockProviderConfig, hostInvoke, startGateway, startScriptedLlm } from './fixtures/fp-p1-harness';

test('TF-0674 actual host probes, production close-to-tray continuation and restart recovery', async ({ homeDir, userDataDir, launchElectronApp }, testInfo) => {
  test.setTimeout(900_000);
  const llm = await startScriptedLlm((text) => ({ text: text.includes('A5-AFTER-APP') ? 'A5-AFTER-APP-RECEIPT' : text.includes('A5-AFTER-GATEWAY') ? 'A5-AFTER-GATEWAY-RECEIPT' : text.includes('A5-CLOSED') ? 'A5-CLOSED-RECEIPT' : 'A5-FIRST-RECEIPT' }));
  let app: ElectronApplication | null = null;
  try {
    const workspaceDir = join(homeDir, 'a5-workspace');
    const openclawDir = join(homeDir, '.openclaw');
    const sourceStateDir = join(userDataDir, 'openclaw-source-state');
    await mkdir(workspaceDir, { recursive: true });
    await mkdir(sourceStateDir, { recursive: true });
    const config = buildMockProviderConfig(llm.port, workspaceDir);
    const configText = JSON.stringify(config, null, 2);
    await writeFile(join(openclawDir, 'openclaw.json'), configText);
    await writeFile(join(sourceStateDir, 'openclaw.json'), configText);
    await writeFile(join(userDataDir, 'settings.json'), JSON.stringify({ language: 'en', gatewayPort: await allocatePort(), gatewayAutoStart: false, autoUpdate: false }));

    // This test deliberately runs the production window lifecycle: the normal
    // E2E fixture sets VERSE_CLAW_E2E=1, where close quits instead of hiding.
    async function launchProductionLifecycle(): Promise<ElectronApplication> {
      const current = await launchElectronApp({
        productionWindowLifecycle: true, skipSetup: true, skipSeed: true,
        env: {
          OPENCLAW_CONFIG_DIR: openclawDir,
          OPENCLAW_CONFIG_PATH: join(sourceStateDir, 'openclaw.json'), OPENCLAW_STATE_DIR: sourceStateDir,
          VITE_DEV_SERVER_URL: '',
        },
      });
      app = current;
      await getStableWindow(current);
      await startGateway(current);
      return current;
    }
    type Ack = { childPid: number; gatewayGeneration: string };
    const ack = (app: ElectronApplication) => hostInvoke<Ack>(app, 'gateway', 'rpc', { method: 'runtime.flags.ack', params: {}, timeoutMs: 30_000 });
    app = await launchProductionLifecycle();
    const active = await hostInvoke<{ activeWorkspace: { id: string } }>(app, 'workspaces', 'getActive');
    const workspaceId = active.activeWorkspace.id;
    await hostInvoke(app, 'workspaces', 'update', { id: workspaceId, permissionMode: 'fullAccess', rootPath: workspaceDir });
    await expect.poll(async () => {
      const status = await hostInvoke<{ state: string; gatewayReady?: boolean }>(app!, 'gateway', 'status');
      return status.state === 'running' && status.gatewayReady === true;
    }, { timeout: 120_000 }).toBe(true);
    // The protocol advertises session methods before their runtime is loaded.
    await expect.poll(async () => {
      try {
        await hostInvoke(app!, 'gateway', 'rpc', { method: 'sessions.list', params: {}, timeoutMs: 10_000 });
        return true;
      } catch (error) {
        if (String(error).includes('unavailable during gateway startup')) return false;
        throw error;
      }
    }, { timeout: 120_000, intervals: [500, 1000] }).toBe(true);
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
      await hostInvoke(current, 'chat', 'sendWithMedia', { workspaceId, sessionKey, message: marker, idempotencyKey: `a5-${marker}` });
      await expect.poll(() => history(current, `${marker}-RECEIPT`), { timeout: 150_000 }).toBe(true);
    }
    const firstApp = app;
    const mainIdentity = (current: ElectronApplication) => current.evaluate(({ app: electronApp }) => {
      const identity = electronApp.getAppMetrics().find(({ pid }) => pid === process.pid);
      if (!identity) throw new Error('Main process identity is unavailable');
      return { pid: identity.pid, creationTime: identity.creationTime };
    });
    const firstMain = await mainIdentity(firstApp);
    const before = await activity(firstApp);
    expect(before.policy?.host?.runtime.state).toBe('unknown');
    expect(before.policy?.host?.budget.state).toBe('unknown');
    await turn(firstApp, 'A5-FIRST');
    const afterRun = await activity(firstApp);
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
    await turn(firstApp, 'A5-CLOSED');
    const afterClose = await activity(firstApp);
    const closedAck = await ack(firstApp);
    expect(closedAck.gatewayGeneration).toBe(initialAck.gatewayGeneration);
    expect(afterClose.policy?.host?.runtime.state).toBe('supported');
    expect(await firstApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible())).toBe(false);
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
    expect(await history(firstApp, 'A5-CLOSED-RECEIPT')).toBe(true);
    await turn(firstApp, 'A5-AFTER-GATEWAY');
    expect((await activity(firstApp)).policy?.host?.runtime.state).toBe('supported');

    await hostInvoke(firstApp, 'gateway', 'stop');
    const firstExit = await closeElectronApp(firstApp);
    expect(firstExit.mainExited).toBe(true);
    expect(firstExit.launcherExited).toBe(true);
    expect(firstExit.processes.every(({ status }) => ['exited', 'replaced', 'terminated'].includes(status))).toBe(true);
    app = null;
    app = await launchProductionLifecycle();
    const secondApp = app;
    const secondMain = await mainIdentity(secondApp);
    expect(secondMain).not.toEqual(firstMain);
    expect(await history(secondApp, 'A5-CLOSED-RECEIPT')).toBe(true);
    expect(await history(secondApp, 'A5-AFTER-GATEWAY-RECEIPT')).toBe(true);
    expect((await activity(secondApp)).policy?.host?.runtime.state).toBe('unknown');
    await turn(secondApp, 'A5-AFTER-APP');
    const afterAppRestart = await activity(secondApp);
    expect(afterAppRestart.policy?.host?.runtime.state).toBe('supported');
    expect(llm.anomalies).toEqual([]);
    expect(llm.log.length).toBeGreaterThanOrEqual(4);
    const storedConfig = JSON.parse(await readFile(join(openclawDir, 'openclaw.json'), 'utf8')) as { runtime?: { contextBlock?: unknown } };
    expect(storedConfig.runtime?.contextBlock).toEqual((config.runtime as { contextBlock?: unknown }).contextBlock);
    const output = testInfo.outputPath('host-readiness.json');
    await writeFile(output, JSON.stringify({
      schema: 'clawx.autonomy-host-readiness/v1', driven_by: 'agent', actor: 'codex-a5-playwright', realHumanEvidence: false,
      candidate: process.env.CLAWX_E2E_CANDIDATE ?? null,
      transport: 'built Electron production-window lifecycle -> actual Main/Gateway/runner -> scripted local provider',
      scope: { workspaceId, sessionKey }, inputConfigSha256: createHash('sha256').update(configText).digest('hex'),
      probes: { before: before.policy?.host, afterRun: afterRun.policy?.host, afterClose: afterClose.policy?.host, afterGatewayRestart: afterGatewayRestart.policy?.host, afterAppRestart: afterAppRestart.policy?.host },
      journeys: { isolatedRun: true, controlledContinuation: true, productionWindowClose: closedWindow, gatewayRestart: { before: initialAck, after: restartedAck }, appRestart: { before: firstMain, after: secondMain, firstExit, transcriptReadback: true, newRunReadback: true }, configPreserved: true },
      providerRequests: llm.log.length, anomalies: llm.anomalies,
      limitations: ['scripted provider is not model quality evidence', 'no installed service or app-exit execution claim', 'no budget measurement', 'no configuration defect observed; no migration or rollback applied', 'source only; installer not tested'],
    }, null, 2));
    await testInfo.attach('host-readiness', { path: output, contentType: 'application/json' });
  } finally {
    try {
      if (app) { await hostInvoke(app, 'gateway', 'stop').catch(() => undefined); await closeElectronApp(app); }
    } finally {
      llm.server.closeAllConnections();
      await new Promise<void>((done) => llm.server.close(() => done()));
    }
  }
});
