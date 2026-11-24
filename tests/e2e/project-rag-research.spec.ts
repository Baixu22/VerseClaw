import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import type { Page } from '@playwright/test';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';
import { allocatePort, buildMockProviderConfig, MOCK_MODEL_ID, startScriptedLlm } from './fixtures/fp-p1-harness';
import type { TaskContextHintV1, RelationshipExpansionV1 } from '../../shared/knowledge/code-task-context';
import type { TaskView, TaskContractInput } from '../../shared/task-system/types';
import type { ResearchResultV1 } from '../../shared/knowledge/research';

type Json = Record<string, unknown>;
async function initWorkspaceGit(workspace: string): Promise<void> {
  // A nested fixture must not inherit the checkout's Git or Task authority.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_/iu.test(key)));
  execFileSync('git', ['init', '--quiet'], { cwd: workspace, env, windowsHide: true, stdio: 'pipe' });
  expect((await lstat(join(workspace, '.git'))).isDirectory()).toBe(true);
}
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
  await initWorkspaceGit(workspace);
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
    receipt.taskCreate = task;
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
    await expect(page.locator('[data-testid^="chat-message-"] p').filter({ hasText: /^RAG15 exact relationships ready$/ })).toBeVisible({ timeout: 30000 });
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
    await expect(page.locator('[data-testid^="chat-message-"] p').filter({ hasText: /^RAG15 two-hop relationship result recorded$/ })).toBeVisible({ timeout: 120000 });
    await expect(page.getByTestId('chat-composer-send')).toHaveAttribute('data-send-state', 'idle', { timeout: 120000 });
    const two = toolResult('rag15two');
    expect(two.relationships.sources.map(source => source.subjectId)).toContain('a/next.ts');
    expect(two.relationships.sources.map(source => source.subjectId)).not.toContain('a/last.ts');
    expect(two.relationships.edges.every(edge => edge.depth <= 2)).toBe(true); receipt.twoHop = two; steps.twoHopBound = true;
    await composer.fill('RAG15 capped incoming'); await page.getByTestId('chat-composer-send').click();
    await expect(page.locator('[data-testid^="chat-message-"] p').filter({ hasText: /^RAG15 capped incoming result recorded$/ })).toBeVisible({ timeout: 120000 });
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
    await expect(page.locator('[data-testid^="chat-message-"] p').filter({ hasText: /^RAG15 stale relationship result recorded$/ })).toBeVisible({ timeout: 120000 });
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

test('Project RAG Research follows evidence gaps and shows bounded progress, cancellation and partial results', async ({ homeDir, userDataDir, launchElectronApp }, testInfo) => {
  test.setTimeout(480000);
  const workspace = join(homeDir, 'rag16-workspace'), vault = join(homeDir, 'rag16-vault');
  await mkdir(workspace, { recursive: true }); await mkdir(join(vault, 'concepts'), { recursive: true });
  await initWorkspaceGit(workspace);
  const receipt: Json = { schema: 'ProjectRagResearchElectron/v1', actor: process.env.PROJECT_RAG_ACTOR ?? 'rag16-electron',
    driven_by: 'agent', realHumanEvidence: false, providerKind: 'scripted-local-fixture', status: 'fail', steps: {} };
  const steps = receipt.steps as Record<string, boolean>;
  let releaseHeld!: () => void;
  const held = new Promise<void>(resolve => { releaseHeld = resolve; });
  let releaseTransport!: () => void;
  const heldTransport = new Promise<void>(resolve => { releaseTransport = resolve; });
  let releaseRejectedStatus!: () => void;
  const heldRejectedStatus = new Promise<void>(resolve => { releaseRejectedStatus = resolve; });
  let releaseLateStart!: () => void;
  const heldLateStart = new Promise<void>(resolve => { releaseLateStart = resolve; });
  let releaseRecovery!: () => void;
  const heldRecovery = new Promise<void>(resolve => { releaseRecovery = resolve; });
  const scopeQuestions = Array.from({ length: 9 }, (_, index) => `RAG16_SCOPE_${index + 1}`);
  const scopeQuery = scopeQuestions.join('; ');
  const planningCalls: Array<{ query: string; round: number; references: string[] }> = [];
  const llm = await startScriptedLlm(async text => {
    const line = text.split('\n').map(line => line.trim()).find(line => line.startsWith('{"researchPlanning":true'));
    if (!line) return { text: 'RAG16 ordinary reply' };
    const input = JSON.parse(line) as { query: string; round: number; questions: string[]; evidence: Array<{ sourceId: string; lookup: string }> };
    planningCalls.push({ query: input.query, round: input.round, references: input.evidence.map(source => source.sourceId) });
    if (input.query === scopeQuery) {
      const source = input.evidence.find(source => source.lookup.endsWith('question-scope.md'));
      return { text: JSON.stringify({ queries: [], coverage: source && text.includes('RAG16_FIRST_EIGHT_FACTS')
        ? input.questions.filter(question => scopeQuestions.slice(0, 8).includes(question))
          .map(question => ({ question, sourceId: source.sourceId, quote: 'RAG16_FIRST_EIGHT_FACTS' })) : [],
        inferences: [], conflicts: [], gaps: [] }) };
    }
    if (input.query === 'RAG16_PLANNING_USAGE_OVERRUN') return {
      text: 'RAG16 malformed planning JSON with an over-budget usage receipt',
      usage: { prompt_tokens: 100000, completion_tokens: 30, total_tokens: 100030 },
    };
    if (input.query === 'RAG16_LINK_BUDGET_ROOT') return { text: JSON.stringify({
      queries: [input.round === 1 ? 'concepts/betaunique.md' : 'concepts/gammaunique.md'],
      coverage: [], inferences: [], conflicts: [], gaps: [],
    }) };
    const find = (path: string) => input.evidence.find(source => source.lookup.endsWith(path))?.sourceId;
    const port = find('gateway.md'), archive = find('archive.md'), other = find('other-port.md');
    if (input.query.includes('cancellation')) await held;
    if (input.query === 'Gateway port transport failure') await heldTransport;
    if (input.query === 'Gateway port rejected status') await heldRejectedStatus;
    if (input.query === 'Gateway port delayed start cancellation') await heldLateStart;
    if (input.query === 'Gateway port recovery cancellation') await heldRecovery;
    const coverage = port && text.includes('Gateway port is 8080.')
      ? [{ question: input.questions[0], sourceId: port, quote: 'port is 8080' }] : [];
    if (input.query.includes('conflicting')) return { text: JSON.stringify({
      queries: port && other ? [] : [port ? 'concepts/other-port.md' : 'concepts/gateway.md'],
      coverage, inferences: [], gaps: [port && other ? 'The gateway ports conflict.' : 'The second gateway source is missing.'],
      conflicts: port && other && text.includes('Gateway port is 9090.') ? [{ description: 'RAG16_CONFLICT: gateway ports 8080 and 9090 disagree.',
        citations: [{ sourceId: port, quote: 'port is 8080' }, { sourceId: other, quote: 'port is 9090' }] }] : [],
    }) };
    if (input.query.includes('giant policy')) return { text: JSON.stringify({ queries: [], coverage,
      inferences: [], conflicts: [], gaps: ['RAG16_DCS_GAP: giant policy was not available in the retained context.'] }) };
    if (archive && text.includes('Archive destination is /archive.')) coverage.push({ question: input.questions[1], sourceId: archive, quote: 'destination is /archive' });
    return { text: JSON.stringify({ queries: input.round === 1 && !archive ? ['Archive destination'] : [], coverage,
      inferences: archive ? ['RAG16_INFERENCE: the two sources describe runtime and archival settings.'] : [], conflicts: [],
      gaps: archive ? [] : ['Archive destination evidence is missing.'] }) };
  });
  const app = await launchElectronApp({ skipSetup: true, env: { VERSE_CLAW_OPENCLAW_RUNTIME: 'source' } });
  let page: Page | undefined;
  type Entry = { action: string; payload: Json; response: { data?: { success?: boolean; research?: ResearchResultV1 } } };
  type StatusFault = { requestId: string; failed: boolean; replyFailure?: boolean; cancelHeld: Promise<void>; releaseCancel: () => void;
    readback?: Json; readbackHeld?: Promise<void>; releaseReadback?: () => void };
  type StartFault = { query: string; queued?: Json; held: Promise<void>; release: () => void };
  try {
    page = await getStableWindow(app); await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 60000 });
    const created = await host<{ activeWorkspace: { id: string; activeSessionKey: string } }>(page, 'workspaces', 'create',
      { name: 'RAG16 bounded Research', rootPath: workspace, agentId: 'main', permissionMode: 'fullAccess' });
    const owner = created.activeWorkspace, now = new Date().toISOString();
    const cfg = buildMockProviderConfig(llm.port, workspace, { contextBlock: { injectionBudget: { totalChars: 2000 } } });
    (cfg.models as { providers: { openai: { models: Array<{ cost: Json }> } } }).providers.openai.models[0].cost = { input: 0.1, output: 0.1, cacheRead: 0.1, cacheWrite: 0.1 };
    cfg.channels = {}; cfg.update = { checkOnStart: false };
    cfg.plugins = { enabled: true, entries: { 'memory-wiki': { enabled: true, config: {
      vaultMode: 'isolated', vault: { path: vault }, search: { backend: 'local', corpus: 'wiki' },
    } } } };
    const account = { id: 'rag16-provider', vendorId: 'openai', label: 'RAG16 fixture', authMode: 'api_key',
      baseUrl: `http://127.0.0.1:${llm.port}/v1`, model: MOCK_MODEL_ID, enabled: true, isDefault: true, createdAt: now, updatedAt: now };
    expect((await host(page, 'providers', 'createAccount', { account, apiKey: 'test-key-ok' })).success).toBe(true);
    await host(page, 'providers', 'setDefaultAccount', { accountId: account.id });
    await host(page, 'gateway', 'stop').catch(error => { if (!String(error).includes('Owned Gateway process did not exit')) throw error; });
    await expect.poll(async () => (await host(page!, 'gateway', 'status')).state, { timeout: 30000 }).toBe('stopped');
    for (const directory of [join(homeDir, '.openclaw'), join(userDataDir, 'openclaw-source-state')]) {
      await mkdir(directory, { recursive: true }); await writeFile(join(directory, 'openclaw.json'), JSON.stringify(cfg));
    }
    const raw = (title: string, body: string, revision = 1) => `---\ntitle: ${title}\nrevision: ${revision}\nstatus: active\ntrust: confirmed\nupdatedAt: "${now}"\nscope:\n  workspaceId: ${owner.id}\n---\n${body}\n`;
    await writeFile(join(vault, 'concepts/gateway.md'), raw('Gateway port', 'Gateway port is 8080.'));
    await writeFile(join(vault, 'concepts/archive.md'), raw('Archive destination', 'Archive destination is /archive.'));
    await writeFile(join(vault, 'concepts/giant.md'), raw('Giant policy', 'Giant policy: ' + 'Giant retention policy. '.repeat(120)));
    await writeFile(join(vault, 'concepts/chain-root.md'), raw('RAG16_LINK_BUDGET_ROOT', 'RAG16_LINK_BUDGET_ROOT. [next](betaunique.md)'));
    await writeFile(join(vault, 'concepts/betaunique.md'), raw('Beta unique', '[next](gammaunique.md)'));
    await writeFile(join(vault, 'concepts/gammaunique.md'), raw('Gamma unique', '[next](deltaunique.md)'));
    await writeFile(join(vault, 'concepts/deltaunique.md'), raw('Delta unique', 'The linked guide beyond the two-hop limit.'));
    await writeFile(join(vault, 'concepts/usage-root.md'), raw('RAG16_PLANNING_USAGE_OVERRUN', 'RAG16_PLANNING_USAGE_OVERRUN. [next](usage-child.md)'));
    await writeFile(join(vault, 'concepts/usage-child.md'), raw('Budget follow-up', 'A local guide for a later round.'));
    await writeFile(join(vault, 'concepts/question-scope.md'), raw('Question scope', scopeQuestions.slice(0, 8).join(' ') + '. RAG16_FIRST_EIGHT_FACTS. '
      + `${scopeQuestions[8]} is listed but has no supporting fact.`));
    await host(page, 'settings', 'set', { key: 'gatewayPort', value: await allocatePort() });
    await host(page, 'gateway', 'start').catch(error => { if (!String(error).includes('timed out')) throw error; });
    await expect.poll(async () => (await host(page!, 'gateway', 'status')).state, { timeout: 120000 }).toBe('running');
    await host(page, 'gateway', 'rpc', { method: 'sessions.create', params: { key: owner.activeSessionKey, agentId: 'main' } });
    const configState = await host<{ hash: string }>(page, 'gateway', 'rpc', { method: 'config.get' });
    await host(page, 'gateway', 'rpc', { method: 'config.patch', params: { baseHash: configState.hash,
      raw: JSON.stringify({ models: cfg.models }) } });
    await expect.poll(async () => {
      const current = await host<{ config: { models: { providers: { openai: { models: Array<{ id: string; cost: { input: number } }> } } } } }>(page!, 'gateway', 'rpc', { method: 'config.get' });
      return current.config.models.providers.openai.models.find(model => model.id === MOCK_MODEL_ID)?.cost.input;
    }, { timeout: 30000 }).toBe(0.1);
    receipt.pricing = { source: 'runtime-config-owner', input: 0.1, output: 0.1, cacheRead: 0.1, cacheWrite: 0.1 };
    await expect(host(page, 'gateway', 'rpc', { method: 'agent', params: { sessionKey: owner.activeSessionKey, message: 'RAG16 invalid normal-turn budget',
      modelBudget: { maxInputTokens: 1000, maxOutputTokens: 100, maxCostUsd: 0.01, maxCalls: 1 }, idempotencyKey: 'rag16-invalid-budget' } })).rejects.toThrow(/model.only|budget/i);
    steps.normalTurnCannotAcquirePlanningBudget = true;
    await app.evaluate(({ ipcMain }) => {
      const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (event: unknown, request: Json) => Promise<Json>> })._invokeHandlers;
      const original = handlers.get('host:invoke')!;
      const entries: Entry[] = [];
      (globalThis as unknown as { rag16Entries: Entry[] }).rag16Entries = entries;
      const fault: StatusFault = { requestId: '', failed: false, cancelHeld: Promise.resolve(), releaseCancel: () => {} };
      (globalThis as unknown as { rag16StatusFault: StatusFault }).rag16StatusFault = fault;
      const startFault: StartFault = { query: '', held: Promise.resolve(), release: () => {} };
      (globalThis as unknown as { rag16StartFault: StartFault }).rag16StartFault = startFault;
      ipcMain.removeHandler('host:invoke');
      ipcMain.handle('host:invoke', async (event, request: Json) => {
        if (request.module === 'knowledge' && request.action === 'researchStart' && (request.payload as Json)?.query === startFault.query) {
          startFault.queued = request.payload as Json;
          await startFault.held;
        }
        const faultRequest = request.module === 'knowledge' && (request.payload as Json)?.requestId === fault.requestId;
        if (faultRequest && request.action === 'researchStatus' && !fault.failed) {
          fault.failed = true;
          if (fault.replyFailure) {
            const response = { id: request.id, ok: true, data: { success: false, error: 'RAG16 injected failed status reply' } };
            entries.push({ action: String(request.action), payload: request.payload as Json, response });
            return response;
          }
          throw new Error('RAG16 injected status transport failure');
        }
        if (faultRequest && request.action === 'researchCancel') await fault.cancelHeld;
        const response = await original(event, request);
        if (request.module === 'knowledge') entries.push({ action: String(request.action), payload: request.payload as Json, response });
        if (faultRequest && request.action === 'researchStatus' && !fault.readback) {
          fault.readback = response;
          fault.releaseCancel();
          if (fault.readbackHeld) await fault.readbackHeld;
        }
        return response;
      });
    });
    await page.reload(); await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 60000 });
    await page.evaluate(() => { window.location.hash = '#/settings/models'; });
    await expect(page.getByTestId(`provider-card-${account.id}`).getByText('Configured', { exact: true })).toBeVisible({ timeout: 30000 });
    await page.evaluate(() => { window.location.hash = '#/'; });
    const composer = page.getByTestId('chat-composer-input'), profile = page.getByTestId('chat-knowledge-profile'), mode = page.getByTestId('chat-knowledge-interaction');
    await expect(composer).toBeVisible({ timeout: 30000 });
    await composer.fill('RAG16 draft survives research'); await mode.selectOption('manual'); await profile.selectOption('research');
    await page.getByTestId('chat-knowledge-scope-button').click();
    const queryInput = page.getByTestId('chat-knowledge-search-input');
    const entries = () => app.evaluate(() => (globalThis as unknown as { rag16Entries: Entry[] }).rag16Entries);
    const final = async (query: string) => {
      const values = await entries();
      const research = values.toReversed().find(entry => entry.action === 'researchStatus' && entry.response.data?.research?.plan.query === query
        && entry.response.data.research.phase === 'finished')?.response.data?.research;
      expect(research, 'Missing terminal Research owner receipt').toBeTruthy(); return research!;
    };
    const execute = async (query: string) => {
      await queryInput.fill(query); await page!.getByTestId('chat-knowledge-search-submit').click();
      await expect(page!.getByTestId('chat-research-progress')).toHaveAttribute('data-phase', 'finished', { timeout: 45000 });
      await expect(page!.getByTestId('chat-research-status')).toHaveText(/Partial research|Research complete|Research unavailable/, { timeout: 45000 });
      return final(query);
    };
    const multi = await execute('Gateway port and backup location');
    expect(multi).toMatchObject({ stopReason: 'covered', usage: { rounds: 2, queries: 4, planningModelCalls: 2 } });
    expect(multi.evidence.map(source => source.lookup)).toEqual(expect.arrayContaining(['concepts/gateway.md', 'concepts/archive.md']));
    expect(multi.retainedEvidence).toHaveLength(2); expect(multi.usage.actualCostUsd).not.toBeNull();
    expect(multi.usage.reservedCostUsd).toBeLessThanOrEqual(0.05); expect(multi.usage.reservedPlanningTokens).toBeLessThanOrEqual(16000);
    await expect(page.getByTestId('chat-research-inferences')).toContainText('RAG16_INFERENCE');
    await expect(composer).toHaveValue('RAG16 draft survives research');
    receipt.multi = multi; steps.realMultiRoundEvidence = true; steps.frozenTotalBudget = true;
    await page.getByTestId('chat-research-inferences').scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath('research-result.png'), fullPage: true });
    await page.getByTestId('chat-knowledge-search-result').filter({ hasText: 'concepts/archive.md' }).first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath('research-source-evidence.png'), fullPage: true });

    const questionScope = await execute(scopeQuery);
    expect(questionScope.plan.questions).toEqual([scopeQuery]);
    expect(questionScope.status).toBe('partial'); expect(questionScope.coverage).toEqual([]);
    expect(questionScope.gaps).toContainEqual({ schema: 'EvidenceGap/v1', question: scopeQuery, reason: 'not-covered' });
    expect(planningCalls.filter(call => call.query === scopeQuery)).toHaveLength(1);
    expect(questionScope.usage.queries).toBe(1);
    await expect(page.getByTestId('chat-research-gaps')).toContainText(scopeQuestions[8]);
    receipt.questionScope = questionScope; steps.completeQuestionScopePreserved = true;

    const dcs = await execute('Gateway port and giant policy');
    const retained = dcs.retainedEvidence.at(-1)!;
    expect(retained).toBeTruthy();
    const retainedIds = retained.units.flatMap(unit => unit.citations.map(citation => citation.intentId ?? citation.refId));
    expect(dcs.evidence).toHaveLength(1); expect(dcs.evidence.every(source => retainedIds.includes(source.id))).toBe(true);
    expect(dcs.evidence.some(source => source.lookup.endsWith('giant.md'))).toBe(false);
    expect(dcs.gaps.some(gap => gap.reason === 'dcs-evidence-not-retained')).toBe(true);
    await expect(page.getByTestId('chat-knowledge-search-result').filter({ hasText: 'concepts/giant.md' })).toHaveCount(0);
    receipt.dcs = dcs; steps.realDcsBudgetReadback = true;
    await page.getByTestId('chat-research-gaps').scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath('research-dcs-partial.png'), fullPage: true });

    const linked = await execute('RAG16_LINK_BUDGET_ROOT');
    const rootSource = linked.evidence.find(source => source.lookup === 'concepts/chain-root.md')!;
    const betaSource = linked.evidence.find(source => source.lookup === 'concepts/betaunique.md')!;
    expect(rootSource).toBeTruthy(); expect(betaSource).toBeTruthy();
    expect(linked.steps.map(step => step.query)).toEqual(['RAG16_LINK_BUDGET_ROOT', 'concepts/betaunique.md', 'concepts/gammaunique.md']);
    expect(linked.graph.edges).toEqual([
      { sourceId: rootSource.id, lookup: 'concepts/betaunique.md', depth: 1 },
      { sourceId: betaSource.id, lookup: 'concepts/gammaunique.md', depth: 2 },
    ]);
    expect(linked.graph.nodes).not.toContain('concepts/deltaunique.md');
    expect(linked.usage).toMatchObject({ rounds: 3, queries: 3, planningModelCalls: 2 });
    receipt.linked = linked; steps.plannerPreservesLinkedDepth = true;

    const overrun = await execute('RAG16_PLANNING_USAGE_OVERRUN');
    expect(overrun).toMatchObject({ status: 'partial', stopReason: 'unavailable',
      usage: { planningModelCalls: 1, queries: 1, actualPlanningTokens: null, actualCostUsd: null } });
    expect(planningCalls.filter(call => call.query === 'RAG16_PLANNING_USAGE_OVERRUN')).toHaveLength(1);
    expect(overrun.evidence.length).toBeGreaterThan(0);
    receipt.planningUsageOverrun = overrun; steps.planningReservationViolationStopsCalls = true;
    steps.usageViolationPrecedesMalformedOutput = true;

    await writeFile(join(vault, 'concepts/cancel.md'), raw('Gateway port cancellation', 'Gateway port is 8080. Cancellation evidence remains available before model completion.'));
    await queryInput.fill('Gateway port cancellation'); await page.getByTestId('chat-knowledge-search-submit').click();
    await expect.poll(() => planningCalls.some(call => call.query.includes('cancellation')), { timeout: 30000 }).toBe(true);
    await expect(page.getByTestId('chat-research-cancel')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('research-progress.png'), fullPage: true });
    await page.getByTestId('chat-research-cancel').click();
    await expect(page.getByTestId('chat-research-status')).toHaveText('Research cancelled', { timeout: 10000 });
    const cancelled = await final('Gateway port cancellation'); expect(cancelled.stopReason).toBe('cancelled'); expect(cancelled.evidence.length).toBeGreaterThan(0);
    expect(cancelled.usage).toMatchObject({ planningModelCalls: 1, reservedPlanningTokens: 8000, reservedCostUsd: 0.025,
      actualPlanningTokens: null, actualCostUsd: null });
    const beforeLate = planningCalls.length; releaseHeld(); await page.waitForTimeout(700);
    await expect(page.getByTestId('chat-research-status')).toHaveText('Research cancelled'); expect(planningCalls.length).toBe(beforeLate);
    await expect(composer).toHaveValue('RAG16 draft survives research');
    receipt.cancelled = cancelled; steps.ownerCancellationWithPartialEvidence = true; steps.pendingUsageRemainsUnknown = true;
    steps.lateModelCannotResume = true; steps.draftPreserved = true;
    await page.screenshot({ path: testInfo.outputPath('research-cancelled.png'), fullPage: true });

    const transportQuery = 'Gateway port transport failure';
    await writeFile(join(vault, 'concepts/transport.md'), raw(transportQuery,
      'Gateway port is 8080. Transport failure recovery retains local evidence while the model is pending.'));
    await queryInput.fill(transportQuery); await page.getByTestId('chat-knowledge-search-submit').click();
    await expect.poll(() => planningCalls.some(call => call.query === transportQuery), { timeout: 30000 }).toBe(true);
    const transportStart = (await entries()).find(entry => entry.action === 'researchStart' && entry.payload.query === transportQuery)!;
    expect(transportStart).toBeTruthy();
    await app.evaluate((_electron, requestId) => {
      const fault = (globalThis as unknown as { rag16StatusFault: StatusFault }).rag16StatusFault;
      fault.cancelHeld = new Promise<void>(resolve => { fault.releaseCancel = resolve; });
      fault.requestId = requestId;
    }, String(transportStart.payload.requestId));
    try {
      await expect(page.getByTestId('chat-research-progress')).toHaveAttribute('data-phase', 'finished', { timeout: 10000 });
      await expect(page.getByTestId('chat-research-status')).toHaveText('Partial research');
      await expect(page.getByTestId('chat-research-progress')).toContainText('Research could not continue.');
      await expect(page.getByTestId('chat-research-progress')).not.toContainText('The research time limit was reached.');
      const recovered = await app.evaluate(() => (globalThis as unknown as { rag16StatusFault: StatusFault }).rag16StatusFault.readback);
      const recoveredOwner = (recovered?.data as { research?: ResearchResultV1 })?.research;
      expect(recoveredOwner?.phase).toBe('planning'); expect(recoveredOwner?.evidence.length).toBeGreaterThan(0);
      receipt.transportRecovery = recoveredOwner; steps.transportFailureReasonPreserved = true;
    } finally {
      await app.evaluate(() => (globalThis as unknown as { rag16StatusFault: StatusFault }).rag16StatusFault.releaseCancel());
      releaseTransport();
    }

    const recoveryQuery = 'Gateway port recovery cancellation';
    await writeFile(join(vault, 'concepts/recovery-cancel.md'), raw(recoveryQuery, 'Gateway port is 8080. Recovery readback cancellation evidence.'));
    await queryInput.fill(recoveryQuery); await page.getByTestId('chat-knowledge-search-submit').click();
    await expect.poll(() => planningCalls.some(call => call.query === recoveryQuery), { timeout: 30000 }).toBe(true);
    const recoveryStart = (await entries()).find(entry => entry.action === 'researchStart' && entry.payload.query === recoveryQuery)!;
    expect(recoveryStart).toBeTruthy();
    await app.evaluate((_electron, requestId) => {
      const fault = (globalThis as unknown as { rag16StatusFault: StatusFault }).rag16StatusFault;
      Object.assign(fault, { requestId, failed: false, replyFailure: false, readback: undefined });
      fault.cancelHeld = new Promise<void>(resolve => { fault.releaseCancel = resolve; });
      fault.readbackHeld = new Promise<void>(resolve => { fault.releaseReadback = resolve; });
    }, String(recoveryStart.payload.requestId));
    try {
      await expect.poll(() => app.evaluate(() => (globalThis as unknown as { rag16StatusFault: StatusFault }).rag16StatusFault.readback),
        { timeout: 10000 }).toBeTruthy();
      await expect.poll(async () => (await entries()).some(entry => entry.action === 'researchCancel'
        && entry.payload.requestId === recoveryStart.payload.requestId && entry.response.data?.success === true), { timeout: 10000 }).toBe(true);
      const beforeRecoveryCancel = (await entries()).filter(entry => entry.action === 'researchCancel'
        && entry.payload.requestId === recoveryStart.payload.requestId).length;
      await page.getByTestId('chat-knowledge-cancel').click();
      await expect.poll(async () => (await entries()).filter(entry => entry.action === 'researchCancel'
        && entry.payload.requestId === recoveryStart.payload.requestId).length, { timeout: 10000 }).toBeGreaterThan(beforeRecoveryCancel);
      const ownerReadback = await app.evaluate(() => (globalThis as unknown as { rag16StatusFault: StatusFault }).rag16StatusFault.readback);
      await app.evaluate(() => (globalThis as unknown as { rag16StatusFault: StatusFault }).rag16StatusFault.releaseReadback!());
      await expect(page.getByTestId('chat-research-status')).toHaveText('Research cancelled', { timeout: 10000 });
      await expect(page.getByTestId('chat-knowledge-search-submit')).toBeEnabled({ timeout: 10000 });
      const recoverySelection = { requestId: String(recoveryStart.payload.requestId), sessionKey: owner.activeSessionKey, workspaceId: owner.id };
      let recoveryStopped: { research?: ResearchResultV1 } = {};
      await expect.poll(async () => {
        recoveryStopped = await host<{ research?: ResearchResultV1 }>(page!, 'knowledge', 'researchStatus', recoverySelection);
        return recoveryStopped.research;
      }, { timeout: 10000 }).toMatchObject({ status: 'cancelled', phase: 'finished', stopReason: 'cancelled' });
      receipt.recoveryCancellation = { ownerReadback, terminal: recoveryStopped.research };
      steps.cancelDuringRecoveryKeepsListener = true; steps.explicitCancelWinsRecoveryReadback = true;
    } finally {
      await app.evaluate(() => (globalThis as unknown as { rag16StatusFault: StatusFault }).rag16StatusFault.releaseReadback?.());
      releaseRecovery();
    }

    const rejectedQuery = 'Gateway port rejected status';
    await writeFile(join(vault, 'concepts/rejected-status.md'), raw(rejectedQuery, 'Gateway port is 8080. Research status delivery can fail.'));
    await queryInput.fill(rejectedQuery); await page.getByTestId('chat-knowledge-search-submit').click();
    await expect.poll(() => planningCalls.some(call => call.query === rejectedQuery), { timeout: 30000 }).toBe(true);
    const rejectedStart = (await entries()).find(entry => entry.action === 'researchStart' && entry.payload.query === rejectedQuery)!;
    expect(rejectedStart).toBeTruthy();
    await app.evaluate((_electron, requestId) => {
      const fault = (globalThis as unknown as { rag16StatusFault: StatusFault }).rag16StatusFault;
      Object.assign(fault, { requestId, failed: false, replyFailure: true, readback: undefined,
        cancelHeld: Promise.resolve(), releaseCancel: () => {} });
    }, String(rejectedStart.payload.requestId));
    await expect.poll(async () => (await entries()).some(entry => entry.action === 'researchCancel'
      && entry.payload.requestId === rejectedStart.payload.requestId), { timeout: 10000 }).toBe(true);
    const rejectedSelection = { requestId: String(rejectedStart.payload.requestId), sessionKey: owner.activeSessionKey, workspaceId: owner.id };
    let stoppedAfterRejection: { research?: ResearchResultV1 } = {};
    await expect.poll(async () => {
      stoppedAfterRejection = await host<{ research?: ResearchResultV1 }>(page!, 'knowledge', 'researchStatus', rejectedSelection);
      return stoppedAfterRejection.research;
    }, { timeout: 10000 }).toMatchObject({ status: 'cancelled', phase: 'finished', stopReason: 'cancelled' });
    releaseRejectedStatus();
    await expect(page.getByTestId('chat-knowledge-search-submit')).toBeEnabled({ timeout: 10000 });
    expect((await host<{ research?: ResearchResultV1 }>(page, 'knowledge', 'researchStatus', rejectedSelection)).research?.stopReason).toBe('cancelled');
    receipt.failedStatusCancellation = stoppedAfterRejection.research; steps.failedStatusReplyCancelsBackend = true;

    const delayedQuery = 'Gateway port delayed start cancellation';
    await writeFile(join(vault, 'concepts/delayed-start.md'), raw(delayedQuery, 'Gateway port is 8080. Delayed startup cancellation evidence.'));
    await app.evaluate((_electron, query) => {
      const fault = (globalThis as unknown as { rag16StartFault: StartFault }).rag16StartFault;
      fault.query = query;
      fault.held = new Promise<void>(resolve => { fault.release = resolve; });
    }, delayedQuery);
    await queryInput.fill(delayedQuery); await page.getByTestId('chat-knowledge-search-submit').click();
    let queuedStart: Json = {};
    await expect.poll(async () => {
      queuedStart = await app.evaluate(() => (globalThis as unknown as { rag16StartFault: StartFault }).rag16StartFault.queued ?? {});
      return queuedStart.requestId;
    }, { timeout: 10000 }).toBeTruthy();
    await page.getByTestId('chat-knowledge-cancel').click();
    const delayedSelection = { requestId: String(queuedStart.requestId), sessionKey: owner.activeSessionKey, workspaceId: owner.id };
    await expect.poll(async () => (await entries()).some(entry => entry.action === 'researchCancel'
      && entry.payload.requestId === delayedSelection.requestId && entry.response.data?.success === false), { timeout: 10000 }).toBe(true);
    await expect(page.getByTestId('chat-knowledge-search-submit')).toBeEnabled({ timeout: 10000 });
    await app.evaluate(() => (globalThis as unknown as { rag16StartFault: StartFault }).rag16StartFault.release());
    await expect.poll(async () => (await entries()).some(entry => entry.action === 'researchCancel'
      && entry.payload.requestId === delayedSelection.requestId && entry.response.data?.success === true), { timeout: 10000 }).toBe(true);
    let delayedStopped: { research?: ResearchResultV1 } = {};
    await expect.poll(async () => {
      delayedStopped = await host<{ research?: ResearchResultV1 }>(page!, 'knowledge', 'researchStatus', delayedSelection);
      return delayedStopped.research;
    }, { timeout: 10000 }).toMatchObject({ status: 'cancelled', phase: 'finished', stopReason: 'cancelled' });
    const delayedCancels = (await entries()).filter(entry => entry.action === 'researchCancel' && entry.payload.requestId === delayedSelection.requestId);
    const delayedAccepted = (await entries()).find(entry => entry.action === 'researchStart' && entry.payload.requestId === delayedSelection.requestId);
    expect(delayedAccepted?.response.data?.success).toBe(true);
    expect(delayedCancels.length).toBeGreaterThan(1);
    expect(delayedCancels.every(entry => entry.payload.sessionKey === delayedSelection.sessionKey && entry.payload.workspaceId === delayedSelection.workspaceId)).toBe(true);
    releaseLateStart();
    expect((await host<{ research?: ResearchResultV1 }>(page, 'knowledge', 'researchStatus', delayedSelection)).research?.stopReason).toBe('cancelled');
    await expect(page.getByTestId('chat-research-progress')).toHaveCount(0);
    receipt.delayedStartCancellation = { queuedStart, accepted: delayedAccepted, cancellations: delayedCancels, terminal: delayedStopped.research };
    steps.lateStartCancellationCompensated = true; steps.lateStartResultIgnored = true;

    await writeFile(join(vault, 'concepts/other-port.md'), raw('Conflicting Gateway port', 'Gateway port is 9090.'));
    const conflict = await execute('conflicting Gateway port');
    expect(conflict.status).toBe('partial'); expect(conflict.conflicts.length).toBeGreaterThan(0);
    await expect(page.getByTestId('chat-research-conflicts')).toContainText('RAG16_CONFLICT');
    receipt.conflict = conflict; steps.realConflictingSources = true;
    await page.getByTestId('chat-research-conflicts').scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath('research-conflict.png'), fullPage: true });
    const selected = { requestId: multi.plan.requestId, sessionKey: owner.activeSessionKey, workspaceId: owner.id };
    expect((await host(page, 'knowledge', 'researchStatus', { ...selected, workspaceId: 'foreign-project' })).success).toBe(false);
    expect((await host(page, 'knowledge', 'researchStart', { requestId: 'rag16-scope-forgery', query: 'Gateway port', sessionKey: owner.activeSessionKey,
      workspaceId: owner.id, scope: { workspaceId: 'foreign-project' }, tools: ['write'] })).success).toBe(false);
    steps.scopeAndPermissionForgeryDenied = true;
    await writeFile(join(vault, 'concepts/gateway.md'), raw('Gateway port', 'Gateway port is 8181.', 2));
    const stale = await host<{ success: boolean; research?: ResearchResultV1 }>(page, 'knowledge', 'researchStatus', selected);
    expect(stale.research?.evidence ?? []).toEqual([]); expect(JSON.stringify(stale)).not.toContain('port is 8080');
    await writeFile(join(vault, 'concepts/gateway.md'), raw('Gateway port', 'Gateway port is 8080.'));
    const restored = await host<{ success: boolean; research?: ResearchResultV1 }>(page, 'knowledge', 'researchStatus', selected);
    expect(restored.research).toMatchObject({ stopReason: 'scope-changed', evidence: [], retainedEvidence: [] });
    receipt.stale = stale; steps.ownerRevisionRecheckedOnDelivery = true;

    const callsBeforeLocal = (await entries()).filter(entry => entry.action === 'researchStart').length;
    await profile.selectOption('local'); await expect(mode).toHaveValue('manual');
    await queryInput.fill('concepts/archive.md'); await page.getByTestId('chat-knowledge-search-submit').click();
    const archiveRow = page.getByTestId('chat-knowledge-search-result').filter({ hasText: 'concepts/archive.md' }).first();
    await expect(archiveRow).toBeVisible({ timeout: 15000 }); await archiveRow.click(); await composer.press('Escape');
    expect((await entries()).filter(entry => entry.action === 'researchStart').length).toBe(callsBeforeLocal);
    await composer.fill('RAG16 explicit evidence send'); await page.getByTestId('chat-composer-send').click();
    await expect(page.locator('[data-testid^="chat-message-"] p').filter({ hasText: /^RAG16 ordinary reply$/ })).toBeVisible({ timeout: 90000 });
    await expect(page.getByTestId('chat-used-knowledge-sources').last()).toContainText('Archive destination', { timeout: 30000 });
    steps.localRollbackPreservesScope = true; steps.normalChatUsesOwnerEvidence = true;
    receipt.entries = await entries(); receipt.status = 'pass';
    await page.screenshot({ path: testInfo.outputPath('research-local-rollback.png'), fullPage: true });
  } catch (error) {
    receipt.failure = String(error);
    if (page) await page.screenshot({ path: testInfo.outputPath('research-failure.png'), fullPage: true });
    throw error;
  } finally {
    releaseHeld(); releaseTransport(); releaseRejectedStatus(); releaseLateStart(); releaseRecovery(); receipt.providerLog = llm.log; receipt.planningCalls = planningCalls; receipt.providerAnomalies = llm.anomalies;
    await app.evaluate(() => (globalThis as unknown as { rag16StatusFault?: StatusFault }).rag16StatusFault?.releaseReadback?.()).catch(error => { receipt.readbackReleaseError = String(error); });
    await app.evaluate(() => (globalThis as unknown as { rag16StartFault?: StartFault }).rag16StartFault?.release()).catch(error => { receipt.startReleaseError = String(error); });
    if (page && receipt.status !== 'pass') { try { receipt.logs = await host(page, 'logs', 'recent'); receipt.entries = await app.evaluate(() => (globalThis as unknown as { rag16Entries?: Entry[] }).rag16Entries ?? []); } catch (error) { receipt.logReadError = String(error); } }
    await writeFile(testInfo.outputPath('research-receipt.json'), JSON.stringify(receipt, null, 2));
    await testInfo.attach('research-receipt', { body: await readFile(testInfo.outputPath('research-receipt.json')), contentType: 'application/json' });
    try { await host(await getStableWindow(app), 'gateway', 'stop'); } catch (error) { receipt.stopError = String(error); }
    await closeElectronApp(app); llm.server.closeAllConnections(); await new Promise<void>(resolve => llm.server.close(() => resolve()));
  }
});
