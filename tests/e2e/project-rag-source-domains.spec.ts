import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';
import { allocatePort, buildMockProviderConfig, startScriptedLlm, MOCK_MODEL_ID } from './fixtures/fp-p1-harness';
import type { SourceRefV2 } from '../../shared/knowledge/owner-read-contract';
import type { ChatSendWithMediaResult } from '../../shared/host-api/contract';
import type { KnowledgeSekbRetrieveForTaskResult, KnowledgeRuntimeLessonsReportResult } from '../../shared/host-api/contract';
import type { TaskView } from '../../shared/task-system/types';
import { createHash } from 'node:crypto';

type Json = Record<string, unknown>;
async function host<T = Json>(page: Page, module: string, action: string, payload?: Json): Promise<T> {
  return page.evaluate(async request => {
    const response = await window.verseClaw!.hostInvoke({ id: crypto.randomUUID(), ...request });
    if (!response.ok) throw Error(response.error?.message ?? 'Host request failed');
    return response.data as T;
  }, { module, action, ...(payload ? { payload } : {}) });
}

test('Project RAG reads native and role memory independently and fences changed owners', async ({ homeDir, userDataDir, launchElectronApp }, testInfo) => {
  test.setTimeout(360000);
  const wire: string[] = [];
  const llm = await startScriptedLlm(async text => {
    wire.push(text);
    return { text: text.includes('You are the read-only Knowledge Librarian.')
      ? JSON.stringify({ claims: [], unknowns: ['The selected memory does not record the requested task result.'] })
      : 'RAG13 scripted fixture reply' };
  });
  const workspace = join(homeDir, 'rag13-workspace'), vault = join(homeDir, 'rag13-vault');
  await mkdir(join(workspace, 'memory'), { recursive: true });
  await mkdir(vault, { recursive: true });
  const app = await launchElectronApp({ skipSetup: true, env: { VERSE_CLAW_OPENCLAW_RUNTIME: 'source' } });
  const receipt: Json = { schema: 'ProjectRagMemoryDomainsElectron/v1', actor: process.env.PROJECT_RAG_ACTOR ?? 'project-rag-memory-domains-e2e',
    driven_by: 'agent', realHumanEvidence: false, status: 'fail', steps: {} };
  const steps = receipt.steps as Json;
  try {
    const page = await getStableWindow(app);
    await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 60000 });
    const created = await host(page, 'workspaces', 'create', { name: 'Agent memory domains', rootPath: workspace, agentId: 'main', permissionMode: 'fullAccess' });
    const owner = created.activeWorkspace as { id: string; activeSessionKey: string };
    const cfg = buildMockProviderConfig(llm.port, workspace);
    cfg.channels = {}; cfg.update = { checkOnStart: false };
    cfg.plugins = { enabled: true, slots: { memory: 'memory-core' }, entries: { 'memory-core': { enabled: true },
      'memory-wiki': { enabled: true, config: { vaultMode: 'isolated', vault: { path: vault }, search: { backend: 'shared', corpus: 'all' } } } } };
    const agentCfg = cfg.agents as { defaults: Json };
    agentCfg.defaults.memorySearch = { enabled: true, provider: 'openai', fallback: 'none',
      sync: { onSearch: false, onSessionStart: false, watch: false }, sources: ['memory'] };
    const account = { id: 'rag13-provider', vendorId: 'openai', label: 'RAG13 fixture', authMode: 'api_key',
      baseUrl: `http://127.0.0.1:${llm.port}/v1`, model: MOCK_MODEL_ID, enabled: true, isDefault: true,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    expect((await host(page, 'providers', 'createAccount', { account, apiKey: 'test-key-ok' })).success).toBe(true);
    await host(page, 'providers', 'setDefaultAccount', { accountId: account.id });
    // Provider writes schedule a reload; cancel it before starting the configured fixture.
    await host(page, 'gateway', 'stop').catch(error => {
      if (!String(error).includes('Owned Gateway process did not exit')) throw error;
    });
    await expect.poll(async () => (await host(page, 'gateway', 'status')).state, { timeout: 30000 }).toBe('stopped');
    const state = join(userDataDir, 'openclaw-source-state');
    for (const directory of [join(homeDir, '.openclaw'), state]) {
      await mkdir(directory, { recursive: true }); await writeFile(join(directory, 'openclaw.json'), JSON.stringify(cfg));
    }
    const raw = (body: string) => `---\ntrust: confirmed\nupdatedAt: "2026-11-16T00:00:00Z"\nscope:\n  workspaceId: ${owner.id}\n---\n${body}\r\n`;
    const file = join(workspace, 'memory/shared.md');
    const nativeRaw = raw('RAG13_NATIVE_ORIGINAL 中文😀');
    await writeFile(file, nativeRaw);
    await host(page, 'settings', 'set', { key: 'gatewayPort', value: await allocatePort() });
    await host(page, 'gateway', 'start').catch(error => { if (!String(error).includes('timed out')) throw error; });
    await expect.poll(async () => (await host(page, 'gateway', 'status')).state, { timeout: 120000 }).toBe('running');
    await host(page, 'gateway', 'rpc', { method: 'sessions.create', params: { key: owner.activeSessionKey, agentId: 'main' } });
    const role = await host(page, 'gateway', 'rpc', { method: 'memory.store', params: { proposal: {
      content: 'RAG13_ROLE_ORIGINAL', type: 'fact', scope: 'workspace', scopeKey: owner.id,
      roleTags: [], evidence: [], confidence: 1, importance: 0.5, source: 'user' } } });
    receipt.roleProposal = role;
    expect(role.accepted).toBe(true);
    const cardId = (role.card as { id: string }).id;
    const refs = [{ id: 'native', title: 'Native memory', lookup: 'native-memory:memory/shared.md', corpus: 'memory' },
      { id: 'role', title: 'Role memory', lookup: `memory-slot:${cardId}`, corpus: 'memory' }];
    const send = async (references: unknown[], suffix: string) => {
      const sent = await host<ChatSendWithMediaResult>(page, 'chat', 'sendWithMedia', { sessionKey: owner.activeSessionKey,
        workspaceId: owner.id, message: 'RAG13 bounded memory use', idempotencyKey: `rag13-${suffix}`,
        knowledgeScope: 'memory', knowledgeMode: 'manual', knowledgeReferences: references });
      expect(sent.success).toBe(true); expect(sent.result?.runId).toBeTruthy();
      const done = await host(page, 'gateway', 'rpc', { method: 'agent.wait', params: { runId: sent.result!.runId, timeoutMs: 60000 }, timeoutMs: 65000 });
      expect(['completed', 'ok']).toContain(done.status);
      return done;
    };
    const conflict = await send(refs.map(ref => ({ ...ref, corpus: 'wiki' })), 'wiki-corpus-conflict');
    expect(conflict.retainedEvidence).toBeUndefined();
    expect(wire.length).toBeGreaterThan(0);
    expect(wire.at(-1)).not.toContain('RAG13_NATIVE_ORIGINAL');
    expect(wire.at(-1)).not.toContain('RAG13_ROLE_ORIGINAL');
    receipt.corpusConflict = conflict; steps.conflictingCorpusDenied = true;
    const initial = await send(refs, 'initial');
    receipt.initial = initial;
    const initialJson = JSON.stringify(initial);
    expect(initialJson).toContain('native-memory'); expect(initialJson).toContain('role-memory');
    const sourceRefs = (initial.retainedEvidence as { units: Array<{ citations: Array<{ sourceRef: SourceRefV2 }> }> }).units
      .flatMap(unit => unit.citations.map(citation => citation.sourceRef));
    const nativePin = sourceRefs.find(ref => ref.domain === 'native-memory')!;
    const rolePin = sourceRefs.find(ref => ref.domain === 'role-memory')!;
    expect(nativePin).toBeTruthy(); expect(rolePin).toBeTruthy();
    const nativeRead = await host(page, 'knowledge', 'get', { lookup: nativePin.subjectId, sourceRef: nativePin, corpus: 'memory' });
    const roleRead = await host(page, 'knowledge', 'get', { lookup: rolePin.subjectId, sourceRef: rolePin, corpus: 'memory' });
    expect(nativeRead.content).toBe(nativeRaw); expect(roleRead.content).toBe('RAG13_ROLE_ORIGINAL');
    expect(await readFile(file, 'utf8')).toBe(nativeRaw);
    receipt.native = nativeRead; receipt.role = roleRead; steps.independentOwnerReads = true;
    await page.getByTestId('sidebar-nav-knowledge').click();
    await expect(page.getByTestId('knowledge-page')).toBeVisible();
    for (const pin of [nativePin, rolePin]) {
      await page.evaluate(pin => {
        const url = `#/knowledge?lookup=${encodeURIComponent(pin.subjectId)}`;
        window.history.pushState({ usr: { knowledgeCitation: { sourceRef: pin } }, key: crypto.randomUUID() }, '', url);
        window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }));
      }, pin);
      await expect(page.getByTestId('knowledge-markdown-preview')).toContainText(pin.domain === 'native-memory' ? 'RAG13_NATIVE_ORIGINAL' : 'RAG13_ROLE_ORIGINAL');
    }
    steps.memoryCitationUi = true;
    await page.screenshot({ path: testInfo.outputPath('memory-citation-preview.png'), fullPage: true });
    await expect(host(page, 'knowledge', 'get', { lookup: nativePin.subjectId, corpus: 'memory' }))
      .resolves.toMatchObject({ success: false, readDenial: 'denied' });
    steps.unpinnedHostMemoryDenied = true;
    await writeFile(join(workspace, 'memory/invalid.md'),
      Buffer.concat([Buffer.from(raw('RAG13_INVALID_UTF8_BODY')), Buffer.from([0x80])]));
    const invalid = await send([{ id: 'invalid-native', title: 'Invalid native',
      lookup: 'native-memory:memory/invalid.md', corpus: 'memory' }, { ...refs[1], sourceRef: rolePin }], 'invalid-utf8');
    const invalidDomains = (invalid.retainedEvidence as { units: Array<{ citations: Array<{ sourceRef: SourceRefV2 }> }> }).units
      .flatMap(unit => unit.citations.map(citation => citation.sourceRef.domain));
    expect(invalidDomains).toContain('role-memory');
    expect(invalidDomains).not.toContain('native-memory');
    expect(wire.at(-1)).not.toContain('RAG13_INVALID_UTF8_BODY');
    receipt.invalidUtf8 = invalid; steps.invalidUtf8DeniedBeforePrompt = true;
    const readIdentity = { workspaceId: owner.id, workspaceDir: workspace, agentSessionKey: owner.activeSessionKey,
      sessionId: (nativeRead.ownerSnapshot as { context: { sessionId: string } }).context.sessionId };
    for (const identity of [{ ...readIdentity, sessionId: '22222222-2222-4222-8222-222222222222' },
      { ...readIdentity, workspaceDir: vault }, { ...readIdentity, workspaceId: 'another-workspace' }]) {
      const denied = await host(page, 'gateway', 'rpc', { method: 'memory.readSource',
        params: { sourceRef: nativePin, readIdentity: identity } });
      expect(denied).toMatchObject({ success: false, rejectedBeforeDispatch: true });
      expect(JSON.stringify(denied)).not.toContain('RAG13_NATIVE_ORIGINAL');
    }
    await expect(host(page, 'knowledge', 'get', { lookup: nativePin.subjectId, sourceRef: nativePin,
      workspaceId: 'another-workspace', corpus: 'memory' })).resolves.toMatchObject({ success: false, error: expect.stringMatching(/workspace/i) });
    steps.gatewayOwnerIdentityFenced = true;
    const selected = [nativePin, rolePin].map(pin => ({ id: pin.subjectId, path: pin.subjectId,
      kind: pin.domain === 'native-memory' ? 'file' : 'other', sourceRef: pin }));
    const saved = await host(page, 'knowledge', 'saveSourceSet', { title: 'RAG13 memory sources', sourceRefs: selected });
    expect(saved.success).toBe(true);
    const sourceSet = saved.sourceSet as { id: string; sourceRefs: unknown[] };
    const answer = await host(page, 'knowledge', 'answerFromSourceSet', { question: 'RAG13 bounded memory use',
      sourceSetId: sourceSet.id, sourceRefs: sourceSet.sourceRefs, synthesis: true });
    receipt.sourceSetAnswer = answer;
    expect(answer.model).toMatchObject({ status: 'completed' });
    const owners = (answer.sources as Array<{ citation: { owner: string } }>).map(source => source.citation.owner);
    expect(owners).toContain('native-memory'); expect(owners).toContain('memory-slot');
    expect(JSON.stringify(answer.retainedEvidence)).toContain('native-memory');
    expect(JSON.stringify(answer.retainedEvidence)).toContain('role-memory');
    expect(answer.retrievalDiagnostics).toMatchObject({ corpus: 'memory', items: [
      expect.objectContaining({ owner: 'native-memory', sourceKind: 'memory-file' }),
      expect.objectContaining({ owner: 'memory-slot', sourceKind: 'memory-card' }),
    ] });
    const studio = await host(page, 'knowledge', 'createArtifactDraft', { artifactType: 'summary', sourceRefs: sourceSet.sourceRefs });
    expect(studio.success).toBe(true);
    const draftPins = (studio.draft as { sourceRefs: Array<{ sourceRef: SourceRefV2 }> }).sourceRefs.map(ref => ref.sourceRef.domain);
    expect(draftPins).toContain('native-memory'); expect(draftPins).toContain('role-memory');
    receipt.studio = studio; steps.memorySourceSetAndStudio = true;
    const legacyRefs = refs.map(ref => ({ id: ref.lookup, kind: 'file' }));
    const legacy = await host(page, 'knowledge', 'answerFromSourceSet', { question: 'Review legacy memory', sourceRefs: legacyRefs, synthesis: true });
    expect(legacy.sources).toEqual([]);
    expect(legacy.retrievalDiagnostics).toMatchObject({ corpus: 'memory', items: [] });
    expect(legacy.model).toMatchObject({ status: 'unavailable' });
    expect((await host(page, 'knowledge', 'createArtifactDraft', { artifactType: 'summary', sourceRefs: legacyRefs })).success).toBe(false);
    receipt.legacySelection = legacy; steps.missingMemoryPinDenied = true;
    await writeFile(file, raw('RAG13_NATIVE_CORRECTED'));
    expect((await host(page, 'knowledge', 'get', { lookup: nativePin.subjectId, sourceRef: nativePin, corpus: 'memory' })).success).toBe(false);
    steps.correctionInvalidatedPin = true;
    await unlink(file);
    const stale = await send([{ ...refs[0], sourceRef: nativePin }, { ...refs[1], sourceRef: rolePin }], 'deleted');
    expect(JSON.stringify(stale)).not.toContain('RAG13_NATIVE_ORIGINAL');
    receipt.afterDelete = stale; steps.deleteInvalidatedPin = true;
    await host(page, 'gateway', 'rpc', { method: 'memory.archive', params: { id: cardId, tombstone: true } });
    expect((await host(page, 'knowledge', 'get', { lookup: rolePin.subjectId, sourceRef: rolePin, corpus: 'memory' })).success).toBe(false);
    steps.roleDeleteInvalidatedPin = true;
    const rejectedMemory = await host(page, 'knowledge', 'answerFromSourceSet', { question: 'Review removed memory', sourceRefs: selected, synthesis: true });
    expect(rejectedMemory.sources).toEqual([]);
    expect(rejectedMemory.retrievalDiagnostics).toMatchObject({ corpus: 'memory', items: [] });
    expect(rejectedMemory.model).toMatchObject({ status: 'unavailable' });
    receipt.rejectedMemory = rejectedMemory; steps.rejectedMemoryDomainPreserved = true;
    await page.evaluate(() => { window.location.hash = '#/settings/models'; });
    await expect(page.getByTestId('knowledge-operations-settings')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('memory-domain-settings.png'), fullPage: true });
    receipt.wire = wire; receipt.status = 'pass';
  } finally {
    await writeFile(testInfo.outputPath('memory-domains-receipt.json'), JSON.stringify(receipt, null, 2));
    await testInfo.attach('memory-domains', { body: await readFile(testInfo.outputPath('memory-domains-receipt.json')), contentType: 'application/json' });
    try { await host(await getStableWindow(app), 'gateway', 'stop'); } catch { /* Keep the observed first failure. */ }
    await closeElectronApp(app); await new Promise<void>(resolve => llm.server.close(() => resolve()));
  }
});

test('Project RAG binds confirmed experience to DCS and observed adoption', async ({ homeDir, userDataDir, launchElectronApp }, testInfo) => {
  test.setTimeout(360000);
  let principleId = '', version = '';
  let operationStep = 0;
  const wire: string[] = [];
  const llm = await startScriptedLlm(async text => {
    wire.push(text);
    if (text.includes('RAG14_ADOPT')) {
      const step = operationStep++;
      if (step === 0) return { toolCall: { id: 'rag14write', name: 'write', args: { path: 'adopted.txt', content: 'RAG14_OBSERVED_OPERATION' } } };
      if (step === 1) return { toolCall: { id: 'rag14cite', name: 'record_sekb_adoption', args: { principleId, principleVersion: version, trigger: 'cited' } } };
      if (step === 2) return { toolCall: { id: 'rag14adopt', name: 'record_sekb_adoption', args: { principleId, principleVersion: version, trigger: 'adopted', operationToolCallId: 'rag14write' } } };
    }
    return { text: 'RAG14 scripted completion' };
  });
  const workspace = join(homeDir, 'rag14-workspace'), vault = join(homeDir, 'rag14-vault');
  await mkdir(workspace, { recursive: true }); await mkdir(vault, { recursive: true });
  const app = await launchElectronApp({ skipSetup: true, env: { VERSE_CLAW_OPENCLAW_RUNTIME: 'source' } });
  const receipt: Json = { schema: 'ProjectRagExperienceElectron/v1', actor: process.env.PROJECT_RAG_ACTOR ?? 'rag14-e2e',
    driven_by: 'agent', realHumanEvidence: false, status: 'fail', steps: {} };
  const steps = receipt.steps as Json;
  try {
    const page = await getStableWindow(app);
    await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 60000 });
    const created = await host(page, 'workspaces', 'create', { name: 'Agent experience lane', rootPath: workspace, agentId: 'main', permissionMode: 'fullAccess' });
    const owner = created.activeWorkspace as { id: string; activeSessionKey: string };
    const config = buildMockProviderConfig(llm.port, workspace);
    config.channels = {}; config.update = { checkOnStart: false };
    config.runtime = { contextBlock: { sekb: { enabled: true } } };
    config.plugins = { enabled: true, entries: { 'memory-wiki': { enabled: true, config: { vaultMode: 'isolated', vault: { path: vault }, search: { backend: 'local', corpus: 'wiki' } } } } };
    const account = { id: 'rag14-provider', vendorId: 'openai', label: 'RAG14 fixture', authMode: 'api_key',
      baseUrl: `http://127.0.0.1:${llm.port}/v1`, model: MOCK_MODEL_ID, enabled: true, isDefault: true,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    expect((await host(page, 'providers', 'createAccount', { account, apiKey: 'test-key-ok' })).success).toBe(true);
    await host(page, 'providers', 'setDefaultAccount', { accountId: account.id });
    await host(page, 'gateway', 'stop').catch(error => {
      if (!String(error).includes('Owned Gateway process did not exit')) throw error;
    });
    await expect.poll(async () => (await host(page, 'gateway', 'status')).state, { timeout: 30000 }).toBe('stopped');
    for (const directory of [join(homeDir, '.openclaw'), join(userDataDir, 'openclaw-source-state')]) {
      await mkdir(directory, { recursive: true }); await writeFile(join(directory, 'openclaw.json'), JSON.stringify(config));
    }
    await host(page, 'settings', 'set', { key: 'gatewayPort', value: await allocatePort() });
    await host(page, 'gateway', 'start');
    await expect.poll(async () => (await host(page, 'gateway', 'status')).state, { timeout: 120000 }).toBe('running');
    await host(page, 'gateway', 'rpc', { method: 'sessions.create', params: { key: owner.activeSessionKey, agentId: 'main' } });
    const session = await host(page, 'gateway', 'rpc', { method: 'sessions.describe', params: { key: owner.activeSessionKey } });
    const sessionId = (session.session as { sessionId: string }).sessionId;
    const task = await host<{ success: boolean; result: { task: TaskView } }>(page, 'taskLedger', 'command', { workspaceId: owner.id,
      command: { action: 'create', requestId: 'rag14-task', contract: { objective: 'Apply confirmed nebula experience', target: 'adopted.txt',
        constraints: [], acceptance: [{ id: 'file', description: 'Observed output', verification: { kind: 'file-sha256', path: 'adopted.txt',
          sha256: createHash('sha256').update('RAG14_OBSERVED_OPERATION').digest('hex') } }] } } });
    expect(task.success).toBe(true);
    const taskId = task.result.task.contract.taskNodeId;
    await host(page, 'taskLedger', 'linkSession', { workspaceId: owner.id, sessionKey: owner.activeSessionKey, sessionGeneration: sessionId, nodeId: taskId });
    await host(page, 'workspaces', 'bindCoordinator', { workspaceId: owner.id, sessionKey: owner.activeSessionKey, agentId: 'main', expectedRevision: 0,
      taskLedgerNodeIds: [taskId], environment: { kind: 'local', rootPath: workspace }, archiveRestorePolicy: 'restore' });
    expect((await host(page, 'taskLedger', 'command', { workspaceId: owner.id,
      command: { action: 'claim', taskNodeId: taskId, sessionKey: owner.activeSessionKey, requestId: 'rag14-claim' } })).success).toBe(true);
    const suggestion = { cluster_summary: 'RAG14 confirmed fixture', source_trajectory_ids: [], confidence: 1,
      suggested_principle: { title: 'Nebula operation evidence', condition: 'When processing nebula tasks',
        action: 'Write RAG14_OBSERVED_OPERATION and verify the result', reason: 'Nebula work needs an observed operation',
        full_content: 'RAG14_CONFIRMED_NEBULA_BODY: verify the observed operation before attributing adoption.', task_types: ['chat'], context_tags: ['nebula'] } };
    const lookup = () => host<KnowledgeSekbRetrieveForTaskResult>(page, 'knowledge', 'sekbRetrieveForTask', {
      taskIntent: 'nebula', taskType: 'chat', workspaceId: owner.id, sessionKey: owner.activeSessionKey });
    expect((await lookup()).principles).toEqual([]); steps.unconfirmedAbsent = true;
    const confirmed = await host(page, 'knowledge', 'sekbConfirmPrinciple', { suggestion, sessionId });
    expect(confirmed.success).toBe(true); principleId = confirmed.principleId as string;
    const found = await lookup(); expect(found.principles).toHaveLength(1);
    const pin = found.principles[0].sourceRef!; version = pin.revision;
    expect(pin).toMatchObject({ domain: 'experience', authorityId: 'sekb', subjectId: principleId });
    receipt.pin = pin; steps.confirmedPin = true;
    expect((await host<KnowledgeRuntimeLessonsReportResult>(page, 'knowledge', 'runtimeLessonsReport')).attribution?.uiExposures).toBe(0);
    expect((await host(page, 'knowledge', 'recordExperienceExposure', { requestId: found.experienceExposureId!, principleIds: [principleId] })).recorded).toBe(1);
    const before = await host<KnowledgeRuntimeLessonsReportResult>(page, 'knowledge', 'runtimeLessonsReport');
    expect(before.attribution).toMatchObject({ uiExposures: 1, contextExposures: 0, adoptions: 0, taskGrades: 0 });
    const got = await host(page, 'knowledge', 'get', { lookup: principleId, sourceRef: pin, corpus: 'all' });
    expect(got.content).toContain('RAG14_CONFIRMED_NEBULA_BODY');
    expect((await host(page, 'knowledge', 'get', { lookup: `sekb:${principleId}`, corpus: 'all' })).success).toBe(false);
    steps.pinnedRead = true;
    const refs = [{ id: `sekb:${principleId}`, title: 'Nebula experience', lookup: `sekb:${principleId}`, sourceRef: pin, corpus: 'all' }];
    const send = async (message: string, references: unknown[]) => {
      const sent = await host<ChatSendWithMediaResult>(page, 'chat', 'sendWithMedia', { sessionKey: owner.activeSessionKey,
        workspaceId: owner.id, message, idempotencyKey: crypto.randomUUID(), knowledgeScope: 'all', knowledgeMode: 'manual', knowledgeReferences: references });
      expect(sent.success).toBe(true);
      const done = await host(page, 'gateway', 'rpc', { method: 'agent.wait', params: { runId: sent.result!.runId, timeoutMs: 50000 }, timeoutMs: 55000 });
      expect(['completed', 'ok']).toContain(done.status); return done;
    };
    const done = await send('RAG14_ADOPT nebula', refs);
    receipt.run = done; expect(wire.some(text => text.includes('RAG14_CONFIRMED_NEBULA_BODY'))).toBe(true);
    expect(await readFile(join(workspace, 'adopted.txt'), 'utf8')).toBe('RAG14_OBSERVED_OPERATION');
    const after = await host<KnowledgeRuntimeLessonsReportResult>(page, 'knowledge', 'runtimeLessonsReport');
    receipt.attribution = after.attribution;
    expect(after.attribution).toMatchObject({ uiExposures: 1, contextExposures: 1, citations: 1, adoptions: 1, operationalOutcomes: 1, taskGrades: 0 });
    expect(after.activePrinciples.find(p => p.principle_id === principleId)?.adoption_count).toBe(1);
    steps.observedAdoption = true;
    await page.getByTestId('sidebar-nav-knowledge').click();
    await page.evaluate(pin => {
      window.history.pushState({ usr: { knowledgeCitation: { sourceRef: pin } }, key: crypto.randomUUID() }, '', `#/knowledge?lookup=${encodeURIComponent(pin.subjectId)}`);
      window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }));
    }, pin);
    await expect(page.getByTestId('knowledge-markdown-preview')).toContainText('RAG14_CONFIRMED_NEBULA_BODY');
    await page.screenshot({ path: testInfo.outputPath('experience-citation.png'), fullPage: true }); steps.citationPreview = true;
    await page.getByTestId('knowledge-more-actions').click();
    await page.getByTestId('knowledge-tab-runtime').click();
    await expect(page.getByTestId('knowledge-runtime-attribution')).toBeVisible();
    await expect(page.getByTestId('knowledge-runtime-adoptions')).toContainText('1');
    await expect(page.getByTestId('knowledge-runtime-taskGrades')).toContainText('0');
    await page.screenshot({ path: testInfo.outputPath('experience-attribution.png'), fullPage: true }); steps.attributionUi = true;
    await page.getByTestId('knowledge-runtime-retrieve-intent').fill('nebula');
    await page.getByTestId('knowledge-runtime-retrieve-type').fill('chat');
    await page.getByTestId('knowledge-runtime-retrieve').click();
    await expect(page.getByTestId('knowledge-runtime-retrieve-result')).toContainText(suggestion.suggested_principle.title);
    await expect.poll(async () => (await host<KnowledgeRuntimeLessonsReportResult>(page, 'knowledge', 'runtimeLessonsReport')).attribution?.uiExposures).toBe(2);
    steps.uiAcknowledgment = true;
    await host(page, 'knowledge', 'sekbConfirmPrinciple', { suggestion, sessionId, edits: { full_content: 'RAG14_CORRECTED_NEBULA_BODY' } });
    expect((await host(page, 'knowledge', 'get', { lookup: principleId, sourceRef: pin, corpus: 'all' })).success).toBe(false);
    steps.correctionInvalidatesPin = true;
    const fresh = await lookup(); const freshPin = fresh.principles[0].sourceRef!;
    await host(page, 'gateway', 'stop').catch(error => {
      if (!String(error).includes('Owned Gateway process did not exit')) throw error;
    });
    await expect.poll(async () => (await host(page, 'gateway', 'status')).state, { timeout: 30000 }).toBe('stopped');
    (config.runtime as { contextBlock: { sekb: { enabled: boolean } } }).contextBlock.sekb.enabled = false;
    for (const directory of [join(homeDir, '.openclaw'), join(userDataDir, 'openclaw-source-state')]) await writeFile(join(directory, 'openclaw.json'), JSON.stringify(config));
    await host(page, 'gateway', 'start');
    expect((await lookup()).principles).toEqual([]);
    expect((await host(page, 'knowledge', 'get', { lookup: principleId, sourceRef: freshPin, corpus: 'all' })).success).toBe(false);
    steps.rollbackDisablesLane = true;
    receipt.status = 'pass';
  } finally {
    receipt.wire = wire; receipt.provider = llm.log;
    await writeFile(testInfo.outputPath('experience-receipt.json'), JSON.stringify(receipt, null, 2));
    try { await host(await getStableWindow(app), 'gateway', 'stop'); } catch { /* Preserve the first failure. */ }
    await closeElectronApp(app); await new Promise<void>(resolve => llm.server.close(() => resolve()));
  }
});
