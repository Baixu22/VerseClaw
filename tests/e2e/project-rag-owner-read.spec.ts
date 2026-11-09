import { mkdir, readFile, readdir, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { Page } from '@playwright/test';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';
import { allocatePort, buildMockProviderConfig, MOCK_MODEL_ID, startScriptedLlm } from './fixtures/fp-p1-harness';
import type { OwnerReadSnapshotV1, SourceRefV2 } from '../../shared/knowledge/owner-read-contract';

type Json = Record<string, unknown>;
async function host<T = Json>(page: Page, module: string, action: string, payload?: Json): Promise<T> {
  return page.evaluate(async request => {
    const result = await window.verseClaw!.hostInvoke({ id: crypto.randomUUID(), module: request.module,
      action: request.action, ...(request.payload ? { payload: request.payload } : {}) });
    if (!result.ok) throw new Error(result.error?.message ?? 'Host request failed');
    return result.data as T;
  }, { module, action, payload });
}
const digest = (value: Uint8Array | string) => `sha256:${createHash('sha256').update(value).digest('hex')}`;

test('Project RAG owner identity, exact citations and denial cross real Electron Host/Gateway/runtime', async ({ homeDir, userDataDir, launchElectronApp }, testInfo) => {
  test.setTimeout(360_000);
  const inputs: string[] = [];
  let hold: Promise<void> | undefined;
  let release!: () => void;
  const llm = await startScriptedLlm(async userText => {
    inputs.push(userText);
    if (hold) await hold;
    const jsonStart = userText.lastIndexOf('\n{"currentQuestion"');
    if (jsonStart >= 0) {
      const parsed = JSON.parse(userText.slice(jsonStart + 1)) as { evidence: Array<{ sourceId: string; text: string }> };
      const source = parsed.evidence[0];
      return { text: JSON.stringify({ claims: source ? [{ text: 'The owner records the public fact.',
        citations: [{ sourceId: source.sourceId, quote: source.text.slice(0, 40) }] }] : [],
        unknowns: source ? [] : ['No admitted evidence.'] }) };
    }
    return { text: 'Observed admitted owner context.' };
  });
  const workspaceRoot = join(homeDir, 'rag-workspace');
  const vault = join(homeDir, 'rag-vault');
  await mkdir(workspaceRoot, { recursive: true });
  await mkdir(join(vault, 'concepts'), { recursive: true });
  const app = await launchElectronApp({ skipSetup: true, env: { VERSE_CLAW_OPENCLAW_RUNTIME: 'source' } });
  const receipt: Json = { actor: 'codex/project-rag-electron', driven_by: 'agent', platform: process.platform,
    providerMode: 'agent-scripted-local-http', status: 'fail', steps: {} };
  try {
    let page = await getStableWindow(app);
    await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 60_000 });
    const created = await host(page, 'workspaces', 'create', { name: 'Project RAG owner fixture', rootPath: workspaceRoot,
      agentId: 'main', permissionMode: 'fullAccess' });
    const owner = created.activeWorkspace as { id: string; activeSessionKey: string };
    expect(owner.id).toBeTruthy();
    const cfg = buildMockProviderConfig(llm.port, workspaceRoot);
    cfg.plugins = { enabled: true, entries: { 'memory-wiki': { enabled: true, config: {
      vaultMode: 'isolated', vault: { path: vault, renderMode: 'native' }, search: { backend: 'local', corpus: 'wiki' },
    } } } };
    cfg.channels = {}; cfg.update = { checkOnStart: false };
    for (const directory of [join(homeDir, '.openclaw'), join(userDataDir, 'openclaw-source-state')]) {
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, 'openclaw.json'), JSON.stringify(cfg, null, 2));
    }
    const file = join(vault, 'concepts', 'owner.md');
    const publicBody = Array.from({ length: 100 }, (_, i) => `RAG_PUBLIC_OWNER line ${i + 1} 中文😀`).join('\r\n');
    const raw = (policy = '', body = publicBody) => `\uFEFF---\r\nid: rag-owner\r\ntitle: Project RAG owner\r\nrevision: 1\r\nstatus: active\r\ntrust: confirmed\r\nverifiedAt: "2026-11-09T00:00:00Z"\r\nscope:\r\n  workspaceId: ${owner.id}\r\n${policy}---\r\n${body}`;
    await writeFile(file, raw());
    const port = await allocatePort();
    await host(page, 'settings', 'set', { key: 'gatewayPort', value: port });
    try { receipt.gatewayStart = await host(page, 'gateway', 'start'); }
    catch (error) {
      receipt.gatewayStartObservation = String(error);
      if (!String(error).includes('timed out')) throw error;
    }
    await expect.poll(async () => (await host(page, 'gateway', 'status')).state, { timeout: 120_000 }).toBe('running');
    expect(await host(page, 'knowledge', 'init')).toMatchObject({ success: true });
    const first = await host<{ success: boolean; ownerSnapshot: OwnerReadSnapshotV1; sourceRef: SourceRefV2; content: string }>(page, 'knowledge', 'get', {
      lookup: 'concepts/owner.md', lineCount: 80, workspaceId: owner.id, sessionKey: owner.activeSessionKey,
    });
    expect(first.success).toBe(true);
    const described = await host(page, 'gateway', 'rpc', { method: 'sessions.describe', params: { key: owner.activeSessionKey } });
    expect(first.ownerSnapshot.context.sessionId).toBe((described.session as { sessionId: string }).sessionId);
    expect(first.ownerSnapshot.context).toMatchObject({ workspaceId: owner.id, sessionKey: owner.activeSessionKey });
    const bytes = await readFile(file), locator = first.sourceRef.locator!;
    expect(first.sourceRef.sourceDigest).toBe(digest(bytes));
    expect(bytes.subarray(locator.startByte, locator.endByteExclusive).toString('utf8')).toBe(first.content);
    const reopened = await host(page, 'knowledge', 'get', { lookup: 'concepts/owner.md', sourceRef: first.sourceRef });
    expect(reopened.content).toBe(first.content);
    const wrongPins = [
      { ...first.sourceRef, revision: '999' },
      { ...first.sourceRef, sourceDigest: digest('wrong source') },
      { ...first.sourceRef, policyEpoch: 'wrong-policy' },
      { ...first.sourceRef, namespaceId: 'wrong-namespace' },
    ];
    for (const sourceRef of wrongPins) {
      const denied = await host(page, 'knowledge', 'get', { lookup: 'concepts/owner.md', sourceRef });
      expect(denied.success).toBe(false); expect(denied.content).toBeUndefined();
    }
    const generic = await host(page, 'gateway', 'rpc', { method: 'wiki.get', params: {
      lookup: 'concepts/owner.md', sourceRef: first.sourceRef, readIdentity: { workspaceId: 'forged', workspaceDir: 'C:/forged', principalId: '*' },
    } });
    expect((generic.ownerSnapshot as OwnerReadSnapshotV1).context.workspaceId).toBe(owner.id);
    const refs = [{ id: 'concepts/owner.md', path: 'concepts/owner.md', kind: 'wiki', sourceRef: first.sourceRef }];
    const answer = await host(page, 'knowledge', 'answerFromSourceSet', { question: 'What does the owner record?', sourceRefs: refs, synthesis: true });
    expect(answer).toMatchObject({ success: true, model: { status: 'completed' }, synthesisMode: 'model' });
    expect(inputs.length).toBeGreaterThan(0);
    receipt.answer = answer; receipt.snapshot = first.ownerSnapshot;
    const sent = await host(page, 'chat', 'sendWithMedia', { sessionKey: owner.activeSessionKey, workspaceId: owner.id,
      message: 'Inspect this selected owner reference.', idempotencyKey: `rag-owner-${Date.now()}`,
      knowledgeScope: 'wiki', knowledgeMode: 'manual', knowledgeReferences: [{ id: 'rag-owner', title: 'Project RAG owner',
        lookup: 'concepts/owner.md', corpus: 'wiki' }] });
    expect(sent.success).toBe(true);
    expect((sent.knowledgeReferences as Array<{ sourceRef?: SourceRefV2 }>)[0].sourceRef).toMatchObject({
      sourceDigest: first.sourceRef.sourceDigest, policyEpoch: first.sourceRef.policyEpoch, namespaceId: first.sourceRef.namespaceId,
    });
    const runId = (sent.result as { runId?: string })?.runId;
    expect(runId).toBeTruthy();
    await host(page, 'gateway', 'rpc', { method: 'agent.wait', params: { runId, timeoutMs: 60_000 } });
    expect(inputs.some(input => input.includes(first.sourceRef.namespaceId) && input.includes(first.sourceRef.policyEpoch)
      && input.includes(first.sourceRef.sourceDigest))).toBe(true);
    receipt.chatSend = sent;
    hold = new Promise<void>(resolve => { release = resolve; });
    const beforeSwitch = inputs.length;
    const late = host(page, 'knowledge', 'answerFromSourceSet', { question: 'Owner after switch?', sourceRefs: refs, synthesis: true })
      .catch(error => ({ scopeError: String(error) }));
    await expect.poll(() => inputs.length).toBeGreaterThan(beforeSwitch);
    const otherRoot = join(homeDir, 'other-workspace'); await mkdir(otherRoot, { recursive: true });
    await host(page, 'workspaces', 'create', { name: 'Other RAG workspace', rootPath: otherRoot, agentId: 'main', permissionMode: 'fullAccess' });
    release(); hold = undefined;
    const rejectedLate = await late;
    expect(rejectedLate).toHaveProperty('scopeError');
    await host(page, 'workspaces', 'switch', { id: owner.id });
    receipt.lateScopeResponseRejected = true;
    await writeFile(file, raw('', publicBody + '\r\nChanged outside the 80-line read window'));
    expect(await host(page, 'knowledge', 'get', { lookup: 'concepts/owner.md', sourceRef: first.sourceRef })).toMatchObject({ success: false });
    await writeFile(file, raw());
    const forbidden = 'RAG_FORBIDDEN_OWNER_BODY';
    const before = inputs.length;
    for (const policy of ['acl:\r\n  read: [another-principal]\r\n', 'privacyTier: secret\r\n', 'retention:\r\n  expiresAt: "2000-01-01T00:00:00Z"\r\n']) {
      await writeFile(file, raw(policy, forbidden));
      const denied = await host(page, 'knowledge', 'answerFromSourceSet', { question: 'Owner?', sourceRefs: refs, synthesis: true,
        acl: { read: ['operator'] }, scope: 'all', score: 999 });
      expect(denied.sources).toEqual([]); expect(inputs).toHaveLength(before);
      const search = await host(page, 'knowledge', 'search', { query: 'RAG_FORBIDDEN_OWNER_BODY', corpus: 'wiki' });
      expect(JSON.stringify(search)).not.toContain(forbidden);
    }
    await unlink(file);
    const deleted = await host(page, 'knowledge', 'get', { lookup: 'concepts/owner.md', sourceRef: first.sourceRef });
    expect(deleted.success).toBe(false); expect(deleted.content).toBeUndefined();
    await writeFile(file, raw());
    await page.reload(); page = await getStableWindow(app);
    await page.getByTestId('sidebar-nav-knowledge').click();
    await expect(page.getByTestId('knowledge-page')).toBeVisible();
    await page.getByTestId('knowledge-search-input').fill('RAG_PUBLIC_OWNER');
    await page.getByTestId('knowledge-search-submit').click();
    await page.getByTestId('knowledge-search-result').filter({ hasText: 'Project RAG owner' }).first().click();
    await expect(page.getByTestId('knowledge-page')).toContainText('RAG_PUBLIC_OWNER');
    await page.screenshot({ path: testInfo.outputPath('owner-citation-ui.png') });
    await writeFile(file, raw('privacyTier: secret\r\n', forbidden));
    await page.getByTestId('knowledge-search-result').filter({ hasText: 'Project RAG owner' }).first().click();
    await expect(page.getByTestId('knowledge-error')).toBeVisible();
    await expect(page.getByTestId('knowledge-page')).not.toContainText(forbidden);
    expect(inputs.every(input => !input.includes(forbidden))).toBe(true);
    receipt.steps = { exactCitation: true, pinDriftRejected: wrongPins.length + 1, forgedIdentityClamped: true,
      deniedProviderInputs: 0, deletedSourceReopened: false, electronCitationRead: true };
    receipt.status = 'pass';
  } finally {
    if (hold) { release(); hold = undefined; }
    try { receipt.gatewayDiagnostics = await host(await getStableWindow(app), 'diagnostics', 'gatewaySnapshot'); } catch { /* failed startup */ }
    try {
      const logs = join(userDataDir, 'logs');
      for (const file of (await readdir(logs)).filter(name => name.endsWith('.log'))) {
        await writeFile(testInfo.outputPath(`app-${file}.txt`), await readFile(join(logs, file), 'utf8'));
      }
    } catch { /* logging may not have started */ }
    try { receipt.gatewayStop = await host(await getStableWindow(app), 'gateway', 'stop'); } catch { /* failed startup */ }
    await closeElectronApp(app);
    await new Promise<void>(resolve => llm.server.close(() => resolve()));
    receipt.providerInputs = inputs; receipt.providerAnomalies = llm.anomalies;
    await writeFile(testInfo.outputPath('owner-read-receipt.json'), JSON.stringify(receipt, null, 2));
  }
});
