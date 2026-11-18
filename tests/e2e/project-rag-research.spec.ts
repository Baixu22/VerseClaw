import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type { Page } from '@playwright/test';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';
import { allocatePort, buildMockProviderConfig, MOCK_MODEL_ID, startScriptedLlm } from './fixtures/fp-p1-harness';
import type { TaskContextHintV1, RelationshipExpansionV1 } from '../../shared/knowledge/code-task-context';
import type { TaskView, TaskContractInput } from '../../shared/task-system/types';

type Json = Record<string, unknown>;
async function host<T = Json>(page: Page, module: string, action: string, payload?: Json): Promise<T> {
  return page.evaluate(async request => {
    const response = await window.verseClaw!.hostInvoke({ id: crypto.randomUUID(), ...request });
    if (!response.ok) throw Error(response.error?.message ?? 'Host request failed');
    return response.data as T;
  }, { module, action, ...(payload ? { payload } : {}) });
}

test('Project RAG discovers exact code relationships and reads the current task through normal Chat', async ({ homeDir, userDataDir, launchElectronApp }, testInfo) => {
  test.setTimeout(480000);
  const workspace = join(homeDir, 'rag15-workspace');
  const files = {
    'src/entry.ts': 'import { calculate as compute } from "../a/model.js";\nexport function run() { return compute(); }\n',
    'a/model.ts': 'import { next } from "./next.js";\nexport function calculate() { return "RAG15_RIGHT_MODEL" + next(); }\n',
    'a/next.ts': 'import { last } from "./last.js";\nexport function next() { return last(); }\n',
    'a/last.ts': 'export function last() { return "RAG15_THIRD_HOP"; }\n',
    'b/model.ts': 'export function calculate() { return "RAG15_WRONG_MODEL"; }\n',
    'budget/target.ts': 'export function target() { return "RAG15_SCAN_TARGET"; }\n',
    'budget/helper.ts': 'export function a() { return 1; }\n',
    'budget/caller.ts': 'import { a } from "./helper.js";\nimport { target } from "./target.js";\nexport function run() {\n' + 'a();'.repeat(512) + '\ntarget();\n}\n',
  };
  for (const [file, content] of Object.entries(files)) {
    await mkdir(join(workspace, file, '..'), { recursive: true }); await writeFile(join(workspace, file), content);
  }
  const artifact = 'RAG15_EVIDENCE_REF'; await writeFile(join(workspace, 'artifact.txt'), artifact);
  const receipt: Json = { schema: 'ProjectRagCodeTaskElectron/v1', actor: process.env.PROJECT_RAG_ACTOR ?? 'rag15-electron',
    driven_by: 'agent', realHumanEvidence: false, providerKind: 'scripted-local-fixture', status: 'fail', steps: {} };
  const steps = receipt.steps as Record<string, boolean>;
  const llm = await startScriptedLlm((text, toolResults) => {
    if (text.includes('RAG15 stale')) {
      if (!toolResults['rag15stale']) return { toolCall: { id: 'rag15stale', name: 'context_understand', args: { query: 'src/entry.ts', intent: 'relationship', includeTaskHint: false } } };
      return { text: 'RAG15 stale relationship result recorded' };
    }
    if (text.includes('RAG15 capped incoming')) {
      if (!toolResults['rag15capped']) return { toolCall: { id: 'rag15capped', name: 'context_understand', args: { query: 'budget/target.ts', intent: 'relationship', includeTaskHint: false } } };
      return { text: 'RAG15 capped incoming result recorded' };
    }
    if (text.includes('RAG15 two hops')) {
      if (!toolResults['rag15two']) return { toolCall: { id: 'rag15two', name: 'context_understand', args: { query: 'src/entry.ts', intent: 'research', depth: 2 } } };
      return { text: 'RAG15 two-hop relationship result recorded' };
    }
    if (!toolResults['rag15warm']) return { toolCall: { id: 'rag15warm', name: 'context_understand', args: { query: 'calculate', activeFiles: Object.keys(files) } } };
    if (!toolResults['rag15graph']) return { toolCall: { id: 'rag15graph', name: 'context_understand', args: { query: 'src/entry.ts', intent: 'relationship' } } };
    return { text: 'RAG15 exact relationships ready' };
  });
  const app = await launchElectronApp({ skipSetup: true, env: { VERSE_CLAW_OPENCLAW_RUNTIME: 'source' } });
  let page: Page | undefined;
  try {
    page = await getStableWindow(app); await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 60000 });
    const created = await host<{ activeWorkspace: { id: string; activeSessionKey: string } }>(page, 'workspaces', 'create',
      { name: 'RAG15 exact relationships', rootPath: workspace, agentId: 'main', permissionMode: 'fullAccess' });
    const owner = created.activeWorkspace;
    const cfg = buildMockProviderConfig(llm.port, workspace); cfg.channels = {}; cfg.update = { checkOnStart: false };
    const now = new Date().toISOString();
    const account = { id: 'rag15-provider', vendorId: 'openai', label: 'RAG15 fixture', authMode: 'api_key',
      baseUrl: `http://127.0.0.1:${llm.port}/v1`, model: MOCK_MODEL_ID, enabled: true, isDefault: true, createdAt: now, updatedAt: now };
    expect((await host(page, 'providers', 'createAccount', { account, apiKey: 'test-key-ok' })).success).toBe(true);
    await host(page, 'providers', 'setDefaultAccount', { accountId: account.id });
    await host(page, 'gateway', 'stop').catch(error => { if (!String(error).includes('Owned Gateway process did not exit')) throw error; });
    await expect.poll(async () => (await host(page!, 'gateway', 'status')).state, { timeout: 30000 }).toBe('stopped');
    for (const directory of [join(homeDir, '.openclaw'), join(userDataDir, 'openclaw-source-state')]) {
      await mkdir(directory, { recursive: true }); await writeFile(join(directory, 'openclaw.json'), JSON.stringify(cfg));
    }
    await host(page, 'settings', 'set', { key: 'gatewayPort', value: await allocatePort() });
    await host(page, 'gateway', 'start').catch(error => { if (!String(error).includes('timed out')) throw error; });
    await expect.poll(async () => (await host(page!, 'gateway', 'status')).state, { timeout: 120000 }).toBe('running');
    await host(page, 'gateway', 'rpc', { method: 'sessions.create', params: { key: owner.activeSessionKey, agentId: 'main' } });
    const described = await host<{ session: { sessionId: string } }>(page, 'gateway', 'rpc', { method: 'sessions.describe', params: { key: owner.activeSessionKey } });
    const firstHint = await host<{ hint: TaskContextHintV1 }>(page, 'taskLedger', 'contextHint', { workspaceId: owner.id, sessionKey: owner.activeSessionKey });
    expect(firstHint.hint.status).toBe('unavailable'); receipt.missingTask = firstHint; steps.missingTaskDegraded = true;
    const taskContract: TaskContractInput = { objective: 'RAG15_TASK_OBJECTIVE: inspect related implementation', target: 'artifact.txt',
      constraints: ['Keep code reads in this workspace'], acceptance: [{ id: 'artifact', description: 'Owner evidence file',
        verification: { kind: 'file-sha256', path: 'artifact.txt', sha256: createHash('sha256').update(artifact).digest('hex') } }] };
    const task = await host<{ success: boolean; result: { task: TaskView } }>(page, 'taskLedger', 'command',
      { workspaceId: owner.id, command: { action: 'create', requestId: 'rag15-task', contract: taskContract } });
    expect(task.success).toBe(true); const taskId = task.result.task.contract.taskNodeId;
    await host(page, 'taskLedger', 'linkSession', { workspaceId: owner.id, sessionKey: owner.activeSessionKey, sessionGeneration: described.session.sessionId, nodeId: taskId });
    await host(page, 'workspaces', 'bindCoordinator', { workspaceId: owner.id, sessionKey: owner.activeSessionKey, agentId: 'main', expectedRevision: 0,
      taskLedgerNodeIds: [taskId], environment: { kind: 'local', rootPath: workspace }, archiveRestorePolicy: 'restore' });
    const claimed = await host<{ success: boolean; result: TaskView }>(page, 'taskLedger', 'command', { workspaceId: owner.id,
      command: { action: 'claim', taskNodeId: taskId, sessionKey: owner.activeSessionKey, requestId: 'rag15-claim' } });
    expect(claimed.success).toBe(true);
    await host(page, 'taskLedger', 'command', { workspaceId: owner.id, command: { action: 'checkpoint', credential: claimed.result.claim,
      checkpoint: { nextAction: 'Inspect code relationships', completed: [], unresolved: [], artifacts: [{ path: 'artifact.txt', sha256: createHash('sha256').update(artifact).digest('hex') }] } } });
    const currentTask = () => host<{ task: TaskView }>(page!, 'taskLedger', 'sessionTask', { workspaceId: owner.id, sessionKey: owner.activeSessionKey });
    const before = await currentTask();
    const currentHint = await host<{ hint: TaskContextHintV1 }>(page, 'taskLedger', 'contextHint', { workspaceId: owner.id, sessionKey: owner.activeSessionKey });
    expect(currentHint.hint).toMatchObject({ status: 'available', taskNodeId: taskId, revision: 1, constraints: taskContract.constraints });
    expect(currentHint.hint.evidenceRefs).toContainEqual({ path: 'artifact.txt', sha256: createHash('sha256').update(artifact).digest('hex') });
    expect(await currentTask()).toEqual(before); receipt.taskHint = currentHint; steps.taskHintReadOnly = true;
    await expect(host(page, 'taskLedger', 'contextHint', { workspaceId: 'another-workspace', sessionKey: owner.activeSessionKey })).rejects.toThrow(/workspace/i);
    steps.crossWorkspaceDenied = true;
    await page.reload();
    await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 60000 });
    await page.evaluate(() => { window.location.hash = '#/settings/models'; });
    const providerCard = page.getByTestId(`provider-card-${account.id}`);
    await expect(providerCard).toBeVisible({ timeout: 30000 });
    await expect(providerCard.getByText('Configured', { exact: true })).toBeVisible({ timeout: 30000 });
    receipt.providerUiReady = true;
    await page.evaluate(() => { window.location.hash = '#/'; });
    const composer = page.getByTestId('chat-composer-input'); await expect(composer).toBeVisible({ timeout: 30000 });
    await composer.fill('RAG15 inspect code relationships'); await page.getByTestId('chat-composer-send').click();
    await expect(page.getByText('RAG15 exact relationships ready', { exact: true })).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId('chat-composer-send')).toHaveAttribute('data-send-state', 'idle', { timeout: 120000 });
    const toolResult = (id: string) => {
      const value = llm.log.toReversed().find(entry => entry.toolResults[id])?.toolResults[id];
      expect(value, `Missing real tool result: ${id}`).toBeTruthy(); return JSON.parse(value!) as { relationships: RelationshipExpansionV1; taskHint: TaskContextHintV1; snippets: unknown[] };
    };
    const graph = toolResult('rag15graph');
    expect(graph.relationships).toMatchObject({ schema: 'RelationshipExpansion/v1', status: 'complete', maxDepth: 1, maxNodes: 32 });
    expect(graph.relationships.sources.map(source => source.subjectId)).toEqual(['src/entry.ts', 'a/model.ts']);
    expect(graph.relationships.edges.some(edge => edge.kind === 'calls' && edge.targetSymbol === 'calculate' && edge.target.subjectId === 'a/model.ts')).toBe(true);
    expect(graph.taskHint).toMatchObject({ status: 'available', taskNodeId: taskId, revision: 1 });
    expect(JSON.stringify(graph)).toContain('RAG15_RIGHT_MODEL'); expect(JSON.stringify(graph)).not.toContain('RAG15_WRONG_MODEL');
    expect(JSON.stringify(graph)).not.toContain('RAG15_THIRD_HOP'); receipt.oneHop = graph; steps.normalChatExactGraph = true;
    await page.screenshot({ path: testInfo.outputPath('code-relationships-chat.png'), fullPage: true });
    await composer.fill('RAG15 two hops'); await page.getByTestId('chat-composer-send').click();
    await expect(page.getByText('RAG15 two-hop relationship result recorded', { exact: true })).toBeVisible({ timeout: 120000 });
    await expect(page.getByTestId('chat-composer-send')).toHaveAttribute('data-send-state', 'idle', { timeout: 120000 });
    const two = toolResult('rag15two');
    expect(two.relationships.sources.map(source => source.subjectId)).toContain('a/next.ts');
    expect(two.relationships.sources.map(source => source.subjectId)).not.toContain('a/last.ts');
    expect(two.relationships.edges.every(edge => edge.depth <= 2)).toBe(true); receipt.twoHop = two; steps.twoHopBound = true;
    await composer.fill('RAG15 capped incoming'); await page.getByTestId('chat-composer-send').click();
    await expect(page.getByText('RAG15 capped incoming result recorded', { exact: true })).toBeVisible({ timeout: 120000 });
    await expect(page.getByTestId('chat-composer-send')).toHaveAttribute('data-send-state', 'idle', { timeout: 120000 });
    const capped = toolResult('rag15capped');
    expect(capped.relationships).toMatchObject({ status: 'partial', truncated: true, maxDepth: 1 });
    expect(capped.relationships.edges.length).toBeLessThanOrEqual(128); receipt.cappedIncoming = capped;
    await page.screenshot({ path: testInfo.outputPath('code-relationship-capped-result.png'), fullPage: true });
    const db = new DatabaseSync(join(workspace, '.openclaw', 'factstore.sqlite'), { readOnly: true });
    try {
      expect((db.prepare("SELECT count(*) AS n FROM edges WHERE file_path='budget/caller.ts' AND kind='calls'").get() as { n: number }).n).toBe(513);
      expect((db.prepare("SELECT count(*) AS n FROM chunks WHERE content LIKE '%RAG15_TASK_OBJECTIVE%'").get() as { n: number }).n).toBe(0);
    }
    finally { db.close(); }
    steps.incomingScanBudget = true;
    steps.taskAbsentFromCodeChunks = true;
    await writeFile(join(workspace, 'src/entry.ts'), 'export function run() { return "RAG15_REPLACED_ENTRY"; }\n');
    await composer.fill('RAG15 stale'); await page.getByTestId('chat-composer-send').click();
    await expect(page.getByText('RAG15 stale relationship result recorded', { exact: true })).toBeVisible({ timeout: 120000 });
    await expect(page.getByTestId('chat-composer-send')).toHaveAttribute('data-send-state', 'idle', { timeout: 120000 });
    const stale = toolResult('rag15stale');
    expect(stale.relationships.status).toBe('unavailable'); expect(stale.relationships.edges).toEqual([]); expect(stale.snippets).toEqual([]);
    expect(JSON.stringify(stale)).not.toContain('RAG15_RIGHT_MODEL'); receipt.stale = stale; steps.staleEdgeDenied = true;
    const disabled = await host<{ hint: TaskContextHintV1 }>(page, 'taskLedger', 'contextHint', { workspaceId: owner.id, sessionKey: owner.activeSessionKey, enabled: false });
    expect(disabled.hint).toMatchObject({ status: 'disabled', constraints: [], evidenceRefs: [] }); receipt.disabled = disabled; steps.taskHintRollback = true;
    await host(page, 'taskLedger', 'command', { workspaceId: owner.id, command: { action: 'revise', taskNodeId: taskId, expectedRevision: 1,
      contract: { ...taskContract, objective: 'RAG15_TASK_OBJECTIVE: revised inspection' } } });
    await host(page, 'taskLedger', 'command', { workspaceId: owner.id, command: { action: 'claim', taskNodeId: taskId, sessionKey: owner.activeSessionKey, requestId: 'rag15-claim-v2' } });
    const oldPin = await host<{ hint: TaskContextHintV1 }>(page, 'taskLedger', 'contextHint', { workspaceId: owner.id, sessionKey: owner.activeSessionKey, sourceRef: currentHint.hint.sourceRef });
    expect(oldPin.hint).toMatchObject({ status: 'unavailable', reason: 'task_pin_changed' }); receipt.oldTaskPin = oldPin; steps.taskRevisionPinDenied = true;
    expect(llm.anomalies).toEqual([]); receipt.providerLog = llm.log; receipt.status = 'pass';
    await page.screenshot({ path: testInfo.outputPath('code-relationship-stale-result.png'), fullPage: true });
  } catch (error) {
    receipt.failure = String(error);
    if (page) { receipt.dialogs = await page.getByRole('dialog').allTextContents(); await page.screenshot({ path: testInfo.outputPath('code-task-failure.png'), fullPage: true }); }
    throw error;
  }
  finally {
    receipt.providerLog = llm.log; receipt.providerAnomalies = llm.anomalies;
    if (page) { try { if (receipt.status !== 'pass') receipt.logs = await host(page, 'logs', 'recent'); } catch (error) { receipt.logReadError = String(error); } }
    await writeFile(testInfo.outputPath('code-task-context-receipt.json'), JSON.stringify(receipt, null, 2));
    await testInfo.attach('code-task-context-receipt', { body: await readFile(testInfo.outputPath('code-task-context-receipt.json')), contentType: 'application/json' });
    try { await host(await getStableWindow(app), 'gateway', 'stop'); } catch (error) { receipt.stopError = String(error); }
    await closeElectronApp(app);
    llm.server.closeAllConnections(); await new Promise<void>(resolve => llm.server.close(() => resolve()));
  }
});
