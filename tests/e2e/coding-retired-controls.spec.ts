import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ElectronApplication } from '@playwright/test';
import type { WorkspaceSnapshot } from '../../shared/types/workspace';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';
import { buildMockProviderConfig, hostInvoke, startGateway, startScriptedLlm } from './fixtures/fp-p1-harness';

test('TF-0774 source Gateway keeps legacy-opt-in workers ordinary and renders retirement in four locales', async ({ homeDir, userDataDir, launchElectronApp }, testInfo) => {
  test.setTimeout(420_000);
  const workspace = join(userDataDir, 'retirement-workspace');
  await mkdir(workspace, { recursive: true });
  const llm = await startScriptedLlm((text, results) => {
    const writer = text.match(/RETIREMENT-WRITER-(\d)/)?.[1];
    if (!writer) return { text: 'retirement observer complete' };
    if (Object.keys(results).length === 0) return { toolCall: { id: `ordinary-write-${writer}`, name: 'write',
      args: { path: `ordinary-${writer}.txt`, content: `ordinary worker ${writer}` } } };
    return { text: `RETIREMENT-DONE-${writer}` };
  });
  llm.server.unref();
  const config = buildMockProviderConfig(llm.port, workspace, {
    coding: { patchFlow: { default: true }, symbolLease: { enabled: true }, staleWriteGuard: { enabled: false } },
  });
  const fullConfig = { ...config, tools: { profile: 'full' } };
  (config.models as { providers: { openai: { models: Array<{ reasoning: boolean }> } } }).providers.openai.models[0].reasoning = true;
  for (const root of [join(homeDir, '.openclaw'), join(userDataDir, 'openclaw-source-state')]) {
    await mkdir(root, { recursive: true });
    await writeFile(join(root, 'openclaw.json'), JSON.stringify(fullConfig));
  }
  let app: ElectronApplication | undefined;
  const evidence: Record<string, unknown> = { schema: 'CodingRetirementElectron/v1', driven_by: 'agent',
    actor: 'codex-01a1b68a', realHumanEvidence: false, runtime: 'source', provider: 'scripted-local', workspace };
  let cleanupError: unknown;
  let runError: unknown;
  try {
    app = await launchElectronApp({ skipSetup: true, env: { VERSE_CLAW_OPENCLAW_RUNTIME: 'source' } });
    const page = await getStableWindow(app);
    const created = await hostInvoke<WorkspaceSnapshot>(app, 'workspaces', 'create', { name: 'Retirement verification', rootPath: workspace, permissionMode: 'fullAccess' });
    await startGateway(app);
    const rpc = <T,>(method: string, params: Record<string, unknown>) => hostInvoke<T>(app!, 'gateway', 'rpc', { method, params, timeoutMs: 120_000 });
    const parent = await rpc<{ key: string; entry: { sessionId: string } }>('sessions.create', { agentId: 'main', label: 'Retirement parent' });
    await hostInvoke(app, 'workspaces', 'update', { id: created.activeWorkspace!.id, activeSessionKey: parent.key });
    evidence.ack = await rpc<{ effectiveFlags: Record<string, boolean | string> }>('runtime.flags.ack', { requestedFlags: {
      'runtime.coding.patchFlow.default': true, 'runtime.coding.symbolLease.enabled': true,
    } });
    const ack = evidence.ack as { effectiveFlags: Record<string, boolean | string> };
    expect(ack.effectiveFlags['runtime.coding.patchFlow.default']).toBe(false);
    expect(ack.effectiveFlags['runtime.coding.symbolLease.enabled']).toBe(false);
    const run = await rpc<{ spawnedRunIds: string[] }>('orchestrator.run', {
      task: 'Three ordinary coding writers', sessionKey: parent.key, durationMinutes: 45,
      graphMode: 'flat', maxWorkers: 3, includeVerifier: false, patchFlowExecution: true,
      workers: [1, 2, 3].map((index) => ({ roleName: 'implementer', task: `RETIREMENT-WRITER-${index}: use the ordinary write tool to write ordinary-${index}.txt with content ordinary worker ${index}.`, writeSet: [`ordinary-${index}.txt`] })),
    });
    evidence.run = run;
    expect(run.spawnedRunIds).toHaveLength(3);
    evidence.terminals = [];
    for (const runId of run.spawnedRunIds) {
      const terminal = await rpc<{ status: string }>('agent.wait', { runId, timeoutMs: 120_000 });
      (evidence.terminals as unknown[]).push(terminal);
      expect(terminal.status).toBe('ok');
    }
    const files: Record<string, string> = {};
    for (const index of [1, 2, 3]) {
      files[`ordinary-${index}.txt`] = await readFile(join(workspace, `ordinary-${index}.txt`), 'utf8');
      expect(files[`ordinary-${index}.txt`]).toBe(`ordinary worker ${index}`);
    }
    evidence.files = files;
    evidence.flags = await hostInvoke(app, 'dcsProdFlags', 'getFlags');
    for (const [language, label] of [['en', 'Retired'], ['zh', '已退役'], ['ja', '廃止済み'], ['ru', 'Выведено из эксплуатации']]) {
      await hostInvoke(app, 'settings', 'set', { key: 'language', value: language });
      await page.reload();
      await expect(page.getByTestId('main-layout')).toBeVisible();
      await page.evaluate(() => { window.location.hash = '/settings/developer'; });
      const panel = page.getByTestId('settings-dcs-prod-flags');
      if ((await panel.count()) === 0 && await page.getByTestId('settings-dev-mode-switch').count()) await page.getByTestId('settings-dev-mode-switch').click();
      await expect(panel).toBeVisible();
      for (const id of ['patch-flow', 'symbol-lease', 'symbol-lease-mode']) {
        const row = page.getByTestId(`settings-dcs-prod-flag-${id}`);
        await row.click();
        await expect(row).toContainText(label);
        await expect(page.getByTestId(`settings-dcs-prod-flag-switch-${id}`)).toHaveCount(0);
        await expect(page.getByTestId('settings-dcs-prod-flag-retired-detail')).toBeVisible();
      }
      await page.getByTestId('settings-dcs-prod-flag-retired-detail').scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath(`retired-${language}.png`), animations: 'disabled' });
    }
    evidence.status = 'pass';
  } catch (error) {
    evidence.status = 'failed';
    evidence.failure = String(error);
    runError = error;
  } finally {
    evidence.providerLog = llm.log;
    evidence.providerAnomalies = llm.anomalies;
    if (app) {
      await hostInvoke(app, 'gateway', 'stop').catch((error) => { evidence.gatewayStopError = String(error); });
      try {
        const closed = await closeElectronApp(app);
        evidence.appCleanup = closed;
        if (!closed.mainExited || !closed.launcherExited) cleanupError = new Error('Owned Electron exit not confirmed');
      } catch (error) { cleanupError = error; evidence.appCleanupError = String(error); }
    }
    await new Promise<void>((resolve) => { llm.server.closeAllConnections(); llm.server.close(() => resolve()); });
    evidence.endpointClosed = !llm.server.listening;
    if (cleanupError) evidence.status = 'failed';
    await writeFile(testInfo.outputPath('coding-retirement.json'), JSON.stringify(evidence, null, 2));
  }
  if (runError) throw runError;
  if (cleanupError) throw cleanupError;
});
