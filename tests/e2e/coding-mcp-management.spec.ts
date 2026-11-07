import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ElectronApplication } from '@playwright/test';
import type { McpCallToolResult, McpHeartbeatResult, McpListToolsResult } from '../../shared/types/mcp';
import type { WorkspaceSnapshot } from '../../shared/types/workspace';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';
import { buildMockProviderConfig, hostInvoke, startGateway, startScriptedLlm } from './fixtures/fp-p1-harness';
import { startCodingMcpServer } from './fixtures/coding-mcp-server';

test('TF-0772 Main, model session and UI share the real MCP owner and reject stale or denied requests', async ({ homeDir, userDataDir, launchElectronApp }, testInfo) => {
  test.setTimeout(420_000);
  const workspace = join(userDataDir, 'workspace');
  await mkdir(workspace, { recursive: true });
  const server = await startCodingMcpServer();
  const empty = await startCodingMcpServer({ empty: true });
  const slow = await startCodingMcpServer({ delayMs: 2500 });
  const llm = await startScriptedLlm((text, results) => {
    if (!text.includes('P2-MODEL')) return { text: 'P2 observer complete' };
    if (Object.values(results).some((result) => result.includes('model-sdk-round-trip'))) return { text: 'P2-MODEL-DONE' };
    return { toolCall: { id: 'sdk_echo', name: 'fixture__echo', args: { message: 'model-sdk-round-trip' } } };
  });
  llm.server.unref();
  const config = buildMockProviderConfig(llm.port, workspace);
  (config.models as { providers: { openai: { models: Array<Record<string, unknown>> } } }).providers.openai.models[0]!.reasoning = true;
  const fullConfig = { ...config, tools: { profile: 'full' } };
  for (const dir of [join(homeDir, '.openclaw'), join(userDataDir, 'openclaw-source-state')]) {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'openclaw.json'), JSON.stringify(fullConfig));
  }
  const evidence: Record<string, unknown> = { schema: 'CodingMcpManagement/v1', driven_by: 'agent',
    actor: 'codex-coding-p2-01a1b07b', realHumanEvidence: false, runtime: 'source', provider: 'scripted-local', workspace };
  let app: ElectronApplication | undefined;
  try {
    app = await launchElectronApp({ skipSetup: true, env: { VERSE_CLAW_OPENCLAW_RUNTIME: 'source' } });
    const page = await getStableWindow(app);
    const created = await hostInvoke<WorkspaceSnapshot>(app, 'workspaces', 'create', {
      name: 'P2 MCP workspace', rootPath: workspace, permissionMode: 'fullAccess',
    });
    expect(created.activeWorkspace).toBeTruthy();
    const workspaceId = created.activeWorkspace!.id;
    for (const [name, endpoint] of [['Fixture', server], ['Empty', empty], ['Slow', slow]] as const) {
      await hostInvoke(app, 'mcp', 'createServer', { name, transport: 'http', url: endpoint.url, scope: 'global', networkPolicy: 'localOnly' });
    }
    await startGateway(app);
    const rpc = <T,>(method: string, params: Record<string, unknown>) => hostInvoke<T>(app!, 'gateway', 'rpc', { method, params, timeoutMs: 90_000 });
    const runtimeConfig = await rpc<{ path?: string; config?: { mcp?: { servers?: Record<string, unknown> }; agents?: unknown } }>('config.get', {});
    evidence.runtimeConfig = { path: runtimeConfig.path, mcpServerIds: Object.keys(runtimeConfig.config?.mcp?.servers ?? {}), agents: runtimeConfig.config?.agents };
    const parent = await rpc<{ key: string; entry: { sessionId: string } }>('sessions.create', { agentId: 'main', label: 'P2 bound session' });
    await hostInvoke(app, 'workspaces', 'update', { id: workspaceId, activeSessionKey: parent.key });
    evidence.activeWorkspace = (await hostInvoke<WorkspaceSnapshot>(app, 'workspaces', 'getActive')).activeWorkspace;
    evidence.parent = parent;
    let list: McpListToolsResult | undefined;
    const discoveryAttempts: unknown[] = [];
    evidence.discovery = discoveryAttempts;
    await expect.poll(async () => {
      list = await hostInvoke<McpListToolsResult>(app!, 'mcp', 'listTools', { serverId: 'fixture' });
      discoveryAttempts.push(list);
      return list.success;
    }, { timeout: 90_000, intervals: [1000, 2000] }).toBe(true);
    expect(list).toMatchObject({ status: 'connected', sessionGeneration: parent.entry.sessionId,
      tools: expect.arrayContaining([expect.objectContaining({ name: 'echo' })]) });
    const call = (payload: Record<string, unknown>) => hostInvoke<McpCallToolResult>(app!, 'mcp', 'callTool', { serverId: 'fixture', toolName: 'echo', ...payload });
    evidence.call = await call({ args: { message: 'main-sdk-round-trip' }, catalogRevision: list!.catalogRevision });
    expect(evidence.call).toMatchObject({ success: true, result: { content: [{ type: 'text', text: 'main-sdk-round-trip' }] } });
    evidence.heartbeat = await hostInvoke<McpHeartbeatResult>(app, 'mcp', 'heartbeat', { serverId: 'fixture' });
    expect(evidence.heartbeat).toMatchObject({ success: true, status: 'connected' });
    evidence.empty = await hostInvoke<McpListToolsResult>(app, 'mcp', 'listTools', { serverId: 'empty' });
    expect(evidence.empty).toMatchObject({ success: true, status: 'connected', tools: [] });
    evidence.timeout = await hostInvoke<McpListToolsResult>(app, 'mcp', 'listTools', { serverId: 'slow' });
    expect(evidence.timeout).toMatchObject({ success: false, status: 'error', errorCode: 'TIMEOUT' });
    evidence.hostNative = await hostInvoke<McpHeartbeatResult>(app, 'mcp', 'heartbeat', { serverId: 'clawx-git' });
    expect(evidence.hostNative).toMatchObject({ success: true, status: 'registered' });
    const run = await rpc<{ runId: string }>('agent', { sessionKey: parent.key, message: 'P2-MODEL: call fixture__echo with model-sdk-round-trip, then finish.', idempotencyKey: `p2-model-${Date.now()}` });
    evidence.modelRun = run;
    const terminal = await rpc<{ status: string }>('agent.wait', { runId: run.runId, timeoutMs: 120_000 });
    evidence.modelTerminal = terminal;
    expect(terminal.status).toBe('ok');
    expect(llm.log.some((request) => request.issued === 'sdk_echo')).toBe(true);
    expect(server.requests.some((request) => request.method === 'tools/call'
      && (request.params as { arguments?: { message?: string } })?.arguments?.message === 'model-sdk-round-trip')).toBe(true);
    expect(server.requests.filter((request) => request.method === 'initialize')).toHaveLength(1);
    const callsBeforeDenials = server.requests.filter((request) => request.method === 'tools/call').length;
    const foreign = await rpc<{ key: string }>('sessions.create', { agentId: 'main', label: 'P2 unbound session' });
    const denials = [
      await call({ args: { message: 42 } }),
      await call({ args: { message: 'foreign' }, sessionKey: foreign.key }),
      await call({ args: { message: 'wrong-agent' }, agentId: 'other' }),
      await call({ args: { message: 'old' }, expectedSessionGeneration: 'old-generation' }),
      await hostInvoke<McpListToolsResult>(app, 'mcp', 'listTools', { serverId: 'missing' }),
    ];
    evidence.denials = denials;
    expect(denials.every((result) => result.success === false)).toBe(true);
    expect(server.requests.filter((request) => request.method === 'tools/call')).toHaveLength(callsBeforeDenials);
    await hostInvoke(app, 'workspaces', 'update', { id: workspaceId, permissionMode: 'readOnly' });
    evidence.readOnly = await call({ args: { message: 'denied-write' } });
    expect(evidence.readOnly).toMatchObject({ success: false, blocked: true });
    expect(server.requests.filter((request) => request.method === 'tools/call')).toHaveLength(callsBeforeDenials);
    await hostInvoke(app, 'workspaces', 'update', { id: workspaceId, permissionMode: 'acceptEdits' });
    const waiting = await call({ args: { message: 'approved-once' } });
    evidence.waiting = waiting;
    expect(waiting).toMatchObject({ success: false, approvalRequired: true, approvalId: expect.any(String) });
    expect(server.requests.filter((request) => request.method === 'tools/call')).toHaveLength(callsBeforeDenials);
    await hostInvoke(app, 'permissions', 'decideApproval', { id: waiting.approvalId, decision: 'approved' });
    evidence.approved = await call({ args: { message: 'approved-once' }, approvalId: waiting.approvalId });
    expect(evidence.approved).toMatchObject({ success: true });
    evidence.consumed = await call({ args: { message: 'approved-once' }, approvalId: waiting.approvalId });
    expect(evidence.consumed).toMatchObject({ success: false, approvalRequired: true });
    await hostInvoke(app, 'workspaces', 'update', { id: workspaceId, permissionMode: 'fullAccess' });
    const oldRevision = list!.catalogRevision;
    await hostInvoke(app, 'mcp', 'updateServer', { id: 'fixture', toolDenylist: ['echo'] });
    await expect.poll(async () => {
      const current = await hostInvoke<McpListToolsResult>(app!, 'mcp', 'listTools', { serverId: 'fixture' });
      return current.success && !current.tools.some((tool) => tool.name === 'echo');
    }, { timeout: 60_000, intervals: [1000] }).toBe(true);
    evidence.staleCatalog = await call({ args: { message: 'stale-catalog' }, catalogRevision: oldRevision });
    expect(evidence.staleCatalog).toMatchObject({ success: false, errorCode: 'VALIDATION' });
    await hostInvoke(app, 'mcp', 'updateServer', { id: 'fixture', toolDenylist: [] });
    const restoredCatalogs: McpListToolsResult[] = [];
    evidence.restoredCatalogs = restoredCatalogs;
    // Config writes are consumed by the runtime watcher; await its actual catalog.
    await expect.poll(async () => {
      const current = await hostInvoke<McpListToolsResult>(app!, 'mcp', 'listTools', { serverId: 'fixture' });
      restoredCatalogs.push(current);
      return current.success && current.tools.some((tool) => tool.name === 'echo');
    }, { timeout: 60_000, intervals: [1000] }).toBe(true);
    await page.evaluate(() => { window.location.hash = '/settings/skills?tab=mcp'; });
    const card = page.locator('[role="button"]').filter({ has: page.getByText('Fixture', { exact: true }) }).first();
    await card.click();
    const detail = page.getByRole('dialog');
    await detail.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(detail.getByText('echo', { exact: true })).toBeVisible({ timeout: 45_000 });
    await expect(detail.getByRole('paragraph').filter({ hasText: /^connected$/ })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('mcp-connected.png'), fullPage: true });
    await hostInvoke(app, 'mcp', 'updateServer', { id: 'fixture', networkPolicy: 'disabled' });
    const callsBeforeNetworkDenial = server.requests.filter((request) => request.method === 'tools/call').length;
    await detail.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(detail.getByRole('alert')).toContainText('network policy is disabled');
    await expect(detail.getByRole('paragraph').filter({ hasText: /^error$/ })).toBeVisible();
    await expect(detail.getByText('echo', { exact: true })).toHaveCount(0);
    evidence.networkDenied = await call({ args: { message: 'network-denied' } });
    expect(evidence.networkDenied).toMatchObject({ success: false });
    expect(server.requests.filter((request) => request.method === 'tools/call')).toHaveLength(callsBeforeNetworkDenial);
    await page.screenshot({ path: testInfo.outputPath('mcp-error.png'), fullPage: true });
    evidence.status = 'pass';
  } catch (error) {
    evidence.status = 'failed';
    evidence.failure = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    evidence.requests = { normal: server.requests, empty: empty.requests, slow: slow.requests };
    evidence.providerLog = llm.log;
    evidence.providerAnomalies = llm.anomalies;
    if (app) {
      const child = app.process();
      evidence.appPid = child.pid;
      await hostInvoke(app, 'gateway', 'stop').catch((error) => { evidence.gatewayStopError = String(error); });
      evidence.gatewayAfterStop = await hostInvoke(app, 'gateway', 'status').catch(() => null);
      await closeElectronApp(app);
      evidence.appExitCode = child.exitCode;
    }
    evidence.endpointCleanup = await Promise.all([server.close(), empty.close(), slow.close()]);
    llm.server.closeAllConnections(); llm.server.closeIdleConnections();
    await new Promise<void>((resolve) => llm.server.close(() => resolve()));
    if (evidence.gatewayStopError) {
      evidence.status = 'failed';
      evidence.failure ??= evidence.gatewayStopError;
    }
    await writeFile(testInfo.outputPath('coding-mcp-management.json'), JSON.stringify(evidence, null, 2));
  }
  if (evidence.gatewayStopError) throw new Error(String(evidence.gatewayStopError));
});
