import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { closeElectronApp, expect, getStableWindow, pinWindowContentSize, test } from './fixtures/electron';
import { hostInvoke, startGateway, startScriptedLlm } from './fixtures/fp-p1-harness';
import { configureSessionChainProvider, observeSessionUi } from './fixtures/session-task-chain';
import type { SystemPortfolio } from '../../shared/types/system-portfolio';
import type { ProjectConfigurationPreview, ProjectConfigurationResult, ProjectConfigDocument } from '../../shared/project-configuration';
import type { TaskLedgerSnapshotResult } from '../../shared/host-api/contract';

test('project configuration verifies the loaded values and restores them after a reload failure', async ({ launchElectronApp, homeDir }, info) => {
  test.setTimeout(420_000);
  const candidate = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const dirty = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim();
  if (process.env.CLAWX_S3_EXPECTED_HEAD) { expect(candidate).toBe(process.env.CLAWX_S3_EXPECTED_HEAD); expect(dirty).toBe(''); }
  const llm = await startScriptedLlm(() => ({ text: 'Configuration fixture does not need a model turn.' }));
  const app = await launchElectronApp({ skipSetup: true, visualMode: true, deviceScaleFactor: 1 });
  const capture = await observeSessionUi(app);
  const evidence: Record<string, unknown> = { driven_by: 'agent', actor: 's3-electron-verifier', candidate, dirty, provider: 'local-scripted', realHumanEvidence: false };
  try {
    const page = await getStableWindow(app);
    await configureSessionChainProvider(app, llm.port);
    const created = await hostInvoke<{ agents: Array<{ id: string; name: string }> }>(app, 'agents', 'create', { name: 'Configuration Owner' });
    const agentId = created.agents.find(agent => agent.name === 'Configuration Owner')!.id;
    await hostInvoke(app, 'agents', 'updateModel', { id: agentId, modelRef: 'custom-sessionc/mock-coder' });
    await hostInvoke(app, 'gateway', 'stop');
    const configPath = join(homeDir, '.openclaw', 'openclaw.json');
    const config = JSON.parse(await readFile(configPath, 'utf8')) as ProjectConfigDocument;
    const agent = config.agents!.list!.find(entry => entry.id === agentId)!;
    agent.contextTokens = 8192; agent.tools = { ...agent.tools, deny: ['browser'] };
    await writeFile(configPath, JSON.stringify(config, null, 2));
    const root = info.outputPath('configuration-project'); await mkdir(root, { recursive: true });
    const sessionKey = `agent:${agentId}:configuration-project`;
    const workspace = await hostInvoke<{ activeWorkspace: { id: string } }>(app, 'workspaces', 'create', {
      name: 'Configuration Project', rootPath: root, agentId, activeSessionKey: sessionKey, permissionMode: 'fullAccess',
    });
    const workspaceId = workspace.activeWorkspace.id;
    await startGateway(app);
    const session = await hostInvoke<{ sessionId: string }>(app, 'gateway', 'rpc', { method: 'sessions.create', params: { key: sessionKey, agentId }, timeoutMs: 30_000 });
    const ledger = await hostInvoke<TaskLedgerSnapshotResult>(app, 'taskLedger', 'createNode', { workspaceId,
      node: { title: 'Configuration binding', kind: 'task', status: 'todo' }, idempotencyKey: 'configuration-binding' });
    await hostInvoke(app, 'workspaces', 'bindCoordinator', { workspaceId, sessionKey, agentId, expectedRevision: 0,
      taskLedgerNodeIds: [ledger.snapshot.nodes.find(n => n.title === 'Configuration binding')!.id],
      environment: { kind: 'local', rootPath: root }, archiveRestorePolicy: 'restore' });
    const manifest = await hostInvoke<SystemPortfolio>(app, 'workspaces', 'portfolio');
    const ownerKey = manifest.profiles.find(p => p.id === workspaceId)!.ownerKey;
    const before = await readFile(configPath, 'utf8');
    const patch = { contextTokens: 4096, denyTools: ['browser', 'exec'] };
    const preview = await hostInvoke<ProjectConfigurationPreview>(app, 'workspaces', 'previewConfiguration', { workspaceId, ownerKey, patch });
    expect(await readFile(configPath, 'utf8')).toBe(before);
    expect(preview).toMatchObject({ before: { contextTokens: 8192 }, desired: { contextTokens: 4096 } });
    await page.reload(); await page.getByTestId('sidebar-nav-system').click();
    const panel = page.getByTestId(`project-config-${workspaceId}`);
    await panel.locator('summary').click();
    await page.getByTestId(`project-config-tools-${workspaceId}`).fill('browser,exec');
    await page.getByTestId(`project-config-context-${workspaceId}`).fill('4096');
    await page.getByTestId(`project-config-preview-${workspaceId}`).click();
    await expect(page.getByTestId(`project-config-values-${workspaceId}`)).toContainText('Not verified');
    await page.getByTestId(`project-config-apply-${workspaceId}`).click();
    await expect(page.getByTestId(`project-config-result-${workspaceId}`)).toHaveText('Applied and verified', { timeout: 120_000 });
    const loaded = await hostInvoke<{ projectConfiguration: { values: { contextTokens: number; denyTools: string[] } }; gatewayGeneration: string }>(app, 'gateway', 'rpc', {
      method: 'runtime.flags.ack', params: { projectAgentId: agentId } });
    expect(loaded.projectConfiguration.values).toMatchObject({ contextTokens: 4096, denyTools: ['browser', 'exec'] });
    const after = JSON.parse(await readFile(configPath, 'utf8')) as ProjectConfigDocument;
    expect(after.agents!.list!.find(entry => entry.id === agentId)?.contextTokens).toBe(4096);
    const nextInput = { workspaceId, ownerKey, patch: { contextTokens: 2048 } };
    const next = await hostInvoke<ProjectConfigurationPreview>(app, 'workspaces', 'previewConfiguration', nextInput);
    const request = { ...nextInput, requestId: 'reload-failure', digest: next.digest, configRevision: next.configRevision };
    await app.evaluate(() => {
      const cache = process.mainModule!.require('node:module')._cache;
      const module = Object.values(cache).find((value: unknown) => (value as { exports?: { gatewayManager?: { restart?: unknown } } })?.exports?.gatewayManager?.restart) as { exports: { gatewayManager: { restart: () => Promise<void>; stop: () => Promise<void> } } } | undefined;
      if (!module) throw new Error('Gateway owner not found');
      const manager = module.exports.gatewayManager, original = manager.restart;
      let failures = 2;
      manager.restart = async () => { await manager.stop(); if (--failures === 0) manager.restart = original; throw new Error('S3 injected reload failure after stop'); };
    });
    const degraded = await hostInvoke<ProjectConfigurationResult>(app, 'workspaces', 'applyConfiguration', request);
    expect(degraded.phase).toBe('degraded');
    await expect(hostInvoke(app, 'workspaces', 'delete', { id: workspaceId })).rejects.toThrow('CONFIG_RECOVER_BEFORE_PROJECT_DELETE');
    await page.reload();
    await page.getByTestId(`project-config-${workspaceId}`).locator('summary').click();
    await expect(page.getByTestId(`project-config-recover-${workspaceId}`)).toBeVisible();
    await page.getByTestId(`project-config-recover-${workspaceId}`).click();
    await expect(page.getByTestId(`project-config-result-${workspaceId}`)).toHaveText('Reload failed; previous values restored and verified', { timeout: 120_000 });
    const rollback = await hostInvoke<ProjectConfigurationResult>(app, 'workspaces', 'configurationOperation', { requestId: request.requestId });
    expect(rollback).toMatchObject({ phase: 'rolled-back', configured: { contextTokens: 4096 }, effective: { contextTokens: 4096 } });
    expect(await hostInvoke(app, 'workspaces', 'applyConfiguration', request)).toEqual(rollback);
    await expect(hostInvoke(app, 'workspaces', 'applyConfiguration', { ...request, patch: { contextTokens: 1024 } })).rejects.toThrow('CONFIG_REQUEST_CONFLICT');
    await expect(hostInvoke(app, 'workspaces', 'previewConfiguration', { workspaceId, ownerKey, patch: { approvalPolicy: 'off' } })).rejects.toThrow('CONFIG_PATCH_SCHEMA');
    const frames = [];
    await pinWindowContentSize(app, { width: 1280, height: 900 });
    for (const locale of ['en', 'zh', 'ja', 'ru']) {
      await hostInvoke(app, 'settings', 'set', { key: 'language', value: locale });
      await page.reload(); await expect(page.locator('html')).toHaveAttribute('lang', locale);
      await page.getByTestId(`project-config-${workspaceId}`).locator('summary').click();
      await expect(page.getByTestId(`project-config-preview-${workspaceId}`)).toBeVisible();
      const file = `configuration-${locale}.png`; await page.screenshot({ path: info.outputPath(file) }); frames.push(file);
    }
    evidence.preview = preview; evidence.loaded = loaded; evidence.degraded = degraded; evidence.rollback = rollback; evidence.session = session;
    evidence.modelsInvoked = llm.log.length; evidence.frames = frames; evidence.status = 'passed';
  } catch (error) { evidence.status = 'failed'; evidence.error = String(error); throw error; }
  finally {
    await capture(name => info.outputPath(name)); await writeFile(info.outputPath('configuration-operator.json'), JSON.stringify(evidence, null, 2));
    await hostInvoke(app, 'gateway', 'stop').catch(() => undefined); await closeElectronApp(app);
    llm.server.closeAllConnections(); await new Promise<void>(done => llm.server.close(() => done()));
  }
});
