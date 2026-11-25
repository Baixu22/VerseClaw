import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';
import { allocatePort, buildMockProviderConfig, startScriptedLlm, type LlmRequestMessage } from './fixtures/fp-p1-harness';
import type { ChatSendWithMediaResult } from '../../shared/host-api/contract';
import type { RetainedEvidenceManifestV1 } from '../../shared/knowledge/packing';

type Json = Record<string, unknown>;
async function host<T = Json>(page: Page, module: string, action: string, payload?: Json): Promise<T> {
  return page.evaluate(async input => {
    const result = await window.verseClaw!.hostInvoke({ id: crypto.randomUUID(), module: input.module,
      action: input.action, ...(input.payload ? { payload: input.payload } : {}) });
    if (!result.ok) throw Error(result.error?.message ?? 'Host request failed');
    return result.data as T;
  }, { module, action, payload });
}
type WaitResult = { status: string; retainedEvidence?: RetainedEvidenceManifestV1 };

test('Project RAG packs real owner evidence for ordinary, media, queued, retry and model-only calls', async ({ homeDir, userDataDir, launchElectronApp }, testInfo) => {
  test.setTimeout(420000);
  const receipt: Json = { actor: 'codex/project-rag-relay-01a1d438', driven_by: 'agent',
    realHumanEvidence: false, providerKind: 'scripted-local-fixture', status: 'fail' };
  const wire: Array<{ text: string; messages: readonly LlmRequestMessage[] }> = [];
  const quote = 'The deployment port is 18789.';
  let releaseHeld!: () => void;
  const held = new Promise<void>(resolve => { releaseHeld = resolve; });
  const llm = await startScriptedLlm(async (userText, _tools, _index, messages) => {
    wire.push({ text: userText, messages: structuredClone(messages) });
    if (userText.includes('DCS queue-before')) await held;
    const supportLine = userText.split('\n').find(line => line.startsWith('{"claimSupportReview":'));
    if (supportLine) {
      const support = JSON.parse(supportLine) as { question: string; claims: Array<{ index: number }> };
      const unsupported = support.question.includes('RAG10 unsupported');
      return { text: JSON.stringify({ answerability: unsupported ? 'insufficient' : 'answerable',
        claims: support.claims.map(claim => ({ index: claim.index, status: unsupported ? 'unsupported' : 'supported',
          reason: unsupported ? 'The source states 18789 rather than 9999.' : 'The deployment value is present in the cited source.' })) }) };
    }
    const metadataLine = userText.split('\n').find(line => line.startsWith('{"currentQuestion":'));
    if (metadataLine) {
      const metadata = JSON.parse(metadataLine) as { currentQuestion: string; answerMode: string; evidence: Array<{ sourceId: string }> };
      if (metadata.currentQuestion.includes('RAG10 general')) return { text: JSON.stringify({ claims: [{ kind: 'general', text: 'Ports identify network services.', citations: [] }], unknowns: ['This is general knowledge.'] }) };
      if (metadata.currentQuestion.includes('RAG10 conflict')) return { text: JSON.stringify({ claims: [], unknowns: ['The sources state different deployment ports.'] }) };
      return { text: JSON.stringify({ claims: [{ kind: 'source', text: metadata.currentQuestion.includes('RAG10 unsupported') ? 'Deployment port is 9999.' : 'Deployment port is 18789.',
        citations: [{ sourceId: metadata.evidence[0].sourceId, quote }] }], unknowns: [] }) };
    }
    return { text: 'RAG09 fixture reply' };
  });
  const workspace = join(homeDir, 'dcs-workspace'), vault = join(homeDir, 'dcs-vault');
  await mkdir(workspace, { recursive: true }); await mkdir(join(vault, 'concepts'), { recursive: true });
  const app = await launchElectronApp({ skipSetup: true, env: { VERSE_CLAW_OPENCLAW_RUNTIME: 'source' } });
  try {
    const page = await getStableWindow(app);
    await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 60000 });
    const created = await host<{ activeWorkspace: { id: string; activeSessionKey: string } }>(page, 'workspaces', 'create',
      { name: 'DCS evidence fixture', rootPath: workspace, agentId: 'main', permissionMode: 'fullAccess' });
    const owner = created.activeWorkspace;
    const config = buildMockProviderConfig(llm.port, workspace, { contextBlock: { injectionBudget: { totalChars: 2000 } } });
    (config.models as { providers: { openai: { models: Array<{ input: string[] }> } } }).providers.openai.models[0].input = ['text', 'image'];
    config.channels = {}; config.update = { checkOnStart: false };
    config.plugins = { enabled: true, entries: { 'memory-wiki': { enabled: true, config: {
      vaultMode: 'isolated', vault: { path: vault }, search: { backend: 'local', corpus: 'wiki' },
    } } } };
    const states = [join(homeDir, '.openclaw'), join(userDataDir, 'openclaw-source-state')];
    const saveConfig = async () => {
      for (const state of states) { await mkdir(state, { recursive: true }); await writeFile(join(state, 'openclaw.json'), JSON.stringify(config)); }
    };
    await saveConfig();
    const document = (title: string, body: string, status = 'active') =>
      '---\ntitle: ' + title + '\nrevision: 1\nstatus: ' + status + '\ntrust: confirmed\nupdatedAt: "2026-11-13T00:00:00Z"\n'
      + 'scope:\n  workspaceId: ' + owner.id + '\n---\n' + body + '\n';
    await writeFile(join(vault, 'concepts/z-first.md'), document('Z first', quote));
    await writeFile(join(vault, 'concepts/a-second.md'), document('A second', 'The deployment timeout is 3000 ms.'));
    await writeFile(join(vault, 'concepts/large.md'), document('Too large', 'Budget chunk '.repeat(400)));
    for (let index = 0; index < 8; index++) {
      await writeFile(join(vault, 'concepts/aux-' + index + '.md'), document('Aux ' + index, quote));
    }
    await host(page, 'settings', 'set', { key: 'gatewayPort', value: await allocatePort() });
    const start = async () => {
      await host(page, 'gateway', 'start').catch(error => { if (!String(error).includes('timed out')) throw error; });
      await expect.poll(async () => (await host<{ state: string }>(page, 'gateway', 'status')).state, { timeout: 120000 }).toBe('running');
    };
    await start();
    await host(page, 'gateway', 'rpc', { method: 'sessions.create', params: { key: owner.activeSessionKey, agentId: 'main' }, timeoutMs: 30000 });
    const refs = [
      { id: 'z-first', title: 'Z first', lookup: 'concepts/z-first.md', corpus: 'wiki' },
      { id: 'a-second', title: 'A second', lookup: 'concepts/a-second.md', corpus: 'wiki' },
      { id: 'large', title: 'Too large', lookup: 'concepts/large.md', corpus: 'wiki' },
    ];
    const send = async (message: string, key: string, extra: Json = {}) => {
      const result = await host<ChatSendWithMediaResult>(page, 'chat', 'sendWithMedia', {
      sessionKey: owner.activeSessionKey, workspaceId: owner.id, message, idempotencyKey: key,
      knowledgeScope: 'wiki', knowledgeMode: 'manual', knowledgeReferences: refs, ...extra,
      });
      receipt.lastSend = { message, result };
      return result;
    };
    const wait = async (result: ChatSendWithMediaResult) => {
      expect(result.success).toBe(true); expect(result.result?.runId).toBeTruthy();
      const completed = await host<WaitResult>(page, 'gateway', 'rpc', {
        method: 'agent.wait', params: { runId: result.result!.runId, timeoutMs: 60000 }, timeoutMs: 65000,
      });
      expect(['completed', 'ok']).toContain(completed.status);
      return completed;
    };
    const ownerHistory = () => host<{ messages: unknown[] }>(page, 'gateway', 'rpc', {
      method: 'chat.history', params: { sessionKey: owner.activeSessionKey, limit: 100 }, timeoutMs: 30000,
    });
    const historyBeforeQa = await ownerHistory();
    const qa = await host<{ success: boolean; synthesisMode: string; retainedEvidence?: RetainedEvidenceManifestV1 }>(page,
      'knowledge', 'answerFromSourceSet', { question: 'What is the deployment port?',
        sourceRefs: [{ id: 'concepts/z-first.md', path: 'concepts/z-first.md', kind: 'wiki' }],
        workspaceId: owner.id, synthesis: true });
    receipt.qa = qa;
    expect(qa.success).toBe(true); expect(qa.synthesisMode).toBe('model');
    expect(qa.retainedEvidence?.units).toHaveLength(1);
    const qaWire = wire.findLast(request => request.text.includes('"currentQuestion"'))!;
    const promptMessage = qaWire.messages.find(message => typeof message.content === 'string' && message.content.includes('currentQuestion'));
    expect(String(promptMessage?.content)).not.toContain(quote);
    expect(qaWire.text).toContain(quote);
    const many = await host<{ success: boolean; synthesisMode: string; unknowns: string[]; retainedEvidence?: RetainedEvidenceManifestV1 }>(page,
      'knowledge', 'answerFromSourceSet', { question: 'What is the deployment port?',
        sourceRefs: ['concepts/z-first.md', ...Array.from({ length: 8 }, (_, index) => 'concepts/aux-' + index + '.md')]
          .map(path => ({ id: path, path, kind: 'wiki' })),
        workspaceId: owner.id, synthesis: true });
    receipt.manySources = many;
    expect(many.synthesisMode).toBe('model');
    expect(many.unknowns.join(' ')).toContain('reference transport limit');
    expect(many.retainedEvidence?.units.length).toBeLessThanOrEqual(8);
    const historyAfterQa = await ownerHistory();
    expect(historyAfterQa.messages).toEqual(historyBeforeQa.messages);
    receipt.qaIsolation = { ownerSessionKey: owner.activeSessionKey, ownerHistoryUnchanged: true };

    // RAG-10: strict/open and the separate support judge execute the same owner/DCS path.
    const selected = [{ id: 'concepts/z-first.md', path: 'concepts/z-first.md', kind: 'wiki' }];
    const qaAnswer = (question: string, answerMode: string, sourceRefs = selected) => host<Json>(page, 'knowledge', 'answerFromSourceSet',
      { question, answerMode, sourceRefs, workspaceId: owner.id, synthesis: true });
    const unsupported = await qaAnswer('RAG10 unsupported deployment port', 'strict');
    expect(unsupported.synthesisMode).toBe('unknown'); expect(unsupported.claims).toEqual([]);
    expect(JSON.stringify(unsupported.unknowns)).toContain('18789 rather than 9999');
    const missingRefs = [{ id: 'concepts/absent.md', path: 'concepts/absent.md', kind: 'wiki' }];
    const beforeMissing = wire.length;
    const missing = await qaAnswer('RAG10 missing deployment value', 'strict', missingRefs);
    expect(missing.synthesisMode).toBe('unknown'); expect(wire.length).toBe(beforeMissing);
    const general = await qaAnswer('RAG10 general network ports', 'open', missingRefs);
    expect(general.synthesisMode).toBe('model');
    expect(general.claims).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'general', citations: [] })]));
    await writeFile(join(vault, 'concepts/conflict-port.md'), document('Conflict port', 'The deployment port is 9999.'));
    const withClaim = (body: string) => body.replace('revision: 1\n', 'revision: 1\nclaims:\n  - id: deployment-port\n    text: '
      + (body.includes('9999') ? 'The deployment port is 9999.' : quote) + '\n');
    await writeFile(join(vault, 'concepts/z-first.md'), withClaim(document('Z first', quote)));
    await writeFile(join(vault, 'concepts/conflict-port.md'), withClaim(document('Conflict port', 'The deployment port is 9999.')));
    const conflict = await qaAnswer('RAG10 conflict deployment ports', 'strict', [...selected,
      { id: 'concepts/conflict-port.md', path: 'concepts/conflict-port.md', kind: 'wiki' }]);
    expect(conflict.synthesisMode).toBe('unknown'); expect(JSON.stringify(conflict.unknowns)).toContain('different deployment ports');
    expect(conflict.conflictSet).toEqual(expect.arrayContaining([expect.objectContaining({
      key: 'claim:deployment-port', stances: expect.arrayContaining([quote, 'The deployment port is 9999.']),
    })]));
    receipt.answerContract = { unsupported, missing, general, conflict };
    await writeFile(join(vault, 'concepts/z-first.md'), document('Z first', quote));

    await page.getByTestId('sidebar-nav-knowledge').click();
    await expect(page.getByTestId('knowledge-page')).toBeVisible();
    await page.getByTestId('knowledge-search-input').fill('concepts/z-first.md');
    await page.getByTestId('knowledge-search-submit').click();
    const resultRow = page.getByTestId('knowledge-search-result').filter({ hasText: 'Z first' }).first();
    await expect(resultRow).toBeVisible();
    await page.getByTestId('knowledge-source-set-add-result').first().click();
    await page.getByTestId('knowledge-librarian-open').click();
    await expect(page.getByTestId('knowledge-answer-mode')).toHaveValue('strict');
    await page.getByTestId('knowledge-answer-mode').selectOption('open');
    await page.getByTestId('knowledge-librarian-question').fill('RAG10 general network ports');
    await page.getByTestId('knowledge-librarian-ask').click();
    await expect(page.getByTestId('knowledge-librarian-message-assistant').last()).toContainText('General knowledge', { timeout: 60000 });
    await page.getByTestId('knowledge-answer-mode').selectOption('strict');
    await page.getByTestId('knowledge-librarian-question').fill('What is the deployment port?');
    await page.getByTestId('knowledge-librarian-ask').click();
    const uiAnswer = page.getByTestId('knowledge-librarian-message-assistant').last();
    await expect(uiAnswer).toContainText('Model support checked', { timeout: 60000 });
    await page.screenshot({ path: testInfo.outputPath('rag10-answer.png'), fullPage: true });
    await uiAnswer.getByTestId('knowledge-librarian-source').first().click();
    await page.getByTestId('knowledge-bot-close').click();
    await expect(page.getByTestId('knowledge-markdown-preview')).toContainText(quote);
    await expect(page.getByTestId('knowledge-citation-range')).toContainText('10–10');
    await page.screenshot({ path: testInfo.outputPath('rag10-raw-range.png'), fullPage: true });
    receipt.citationUi = { strictAndOpen: true, supportStatusVisible: true, rawRange: { startLine: 10, endLine: 10 } };
    await writeFile(join(vault, 'concepts/z-first.md'), document('Z first', quote, 'revoked'));
    await page.getByTestId('knowledge-librarian-open').click();
    await page.getByTestId('knowledge-librarian-message-assistant').last().getByTestId('knowledge-librarian-source').first().click();
    await page.getByTestId('knowledge-bot-close').click();
    await expect(page.getByTestId('knowledge-citation-range')).toHaveCount(0);
    await expect(page.getByTestId('knowledge-markdown-preview')).not.toContainText(quote);
    await page.screenshot({ path: testInfo.outputPath('rag10-revoked-citation.png'), fullPage: true });
    receipt.citationRevocation = { staleBodyCleared: true, oldRangeRemoved: true };
    await writeFile(join(vault, 'concepts/z-first.md'), document('Z first', quote));
    await page.evaluate(() => { window.location.hash = '/'; });
    await expect(page.getByTestId('main-layout')).toBeVisible();

    const ordinaryResult = await send('DCS ordinary', 'rag09-ordinary');
    const ordinary = await wait(ordinaryResult);
    expect(ordinary.retainedEvidence?.units.map(unit => unit.citations[0].intentId)).toEqual(['z-first', 'a-second']);
    expect(ordinary.retainedEvidence?.retainedChars).toBeLessThanOrEqual(2000);
    const ordinaryWire = wire.at(-1)!.text;
    expect(ordinaryWire.indexOf(quote)).toBeLessThan(ordinaryWire.indexOf('The deployment timeout'));
    expect(ordinaryWire).not.toContain('[Knowledge reference: Too large');
    receipt.ordinary = ordinary;
    const beforeRetry = wire.length;
    await wait(await send('DCS ordinary', 'rag09-ordinary'));
    expect(wire.length).toBe(beforeRetry);
    receipt.retry = { sameRun: true, providerCallsBefore: beforeRetry, providerCallsAfter: wire.length };

    const image = join(workspace, 'pixel.png');
    await writeFile(image, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+lm3sAAAAASUVORK5CYII=', 'base64'));
    const media = await wait(await send('DCS media', 'rag09-media', {
      media: [{ filePath: image, mimeType: 'image/png', fileName: 'pixel.png' }],
    }));
    expect(media.retainedEvidence?.units).toHaveLength(2);
    expect(wire.at(-1)!.text).toContain(quote);
    expect(JSON.stringify(wire.at(-1)!.messages)).toContain('image');
    receipt.media = media;

    const beforeQueue = await send('DCS queue-before', 'rag09-queue-before');
    await expect.poll(() => wire.some(request => request.text.includes('DCS queue-before')), { timeout: 60000 }).toBe(true);
    // Ordinary sends retain their normal session lane; inputMode belongs to /loop interventions.
    const queued = await send('DCS queued', 'rag09-queued');
    receipt.queueAcks = { beforeQueue, queued };
    expect(wire.some(request => request.text.includes('DCS queued'))).toBe(false);
    releaseHeld();
    await wait(beforeQueue);
    const queueResult = await wait(queued);
    expect(queueResult.retainedEvidence?.units).toHaveLength(2);
    receipt.queue = queueResult;
    const grouped = await send('DCS conflict group', 'rag09-conflict-group', {
      knowledgeReferences: refs.slice(0, 2).map(reference => ({ ...reference, conflictGroupId: 'deployment' })),
    });
    receipt.groupedAck = grouped;
    expect(grouped.knowledgeReferences?.every(reference => reference.conflictGroupId === 'deployment')).toBe(true);
    const groupedResult = await wait(grouped);
    expect(groupedResult.retainedEvidence?.units).toHaveLength(1);
    expect(groupedResult.retainedEvidence?.units[0].citations).toHaveLength(2);
    receipt.grouped = groupedResult;

    await writeFile(join(vault, 'concepts/z-first.md'), document('Z first', quote, 'revoked'));
    const revoked = await wait(await send('DCS revoked', 'rag09-revoked'));
    expect(revoked.retainedEvidence?.units.flatMap(unit => unit.citations).some(citation => citation.intentId === 'z-first')).toBe(false);
    expect(wire.at(-1)!.text).not.toContain('[Knowledge reference: Z first');
    receipt.revoked = revoked;

    await host(page, 'gateway', 'stop');
    (config.runtime as Json).contextEnhancement = { killSwitch: true };
    await saveConfig(); await start();
    const killed = await wait(await send('DCS killed', 'rag09-killed'));
    expect(killed.retainedEvidence?.retainedChars ?? 0).toBe(0);
    expect(wire.at(-1)!.text).not.toContain('[Knowledge reference:');
    receipt.killed = killed;
    await page.screenshot({ path: testInfo.outputPath('dcs-chat.png'), fullPage: true });
    receipt.status = 'pass';
  } finally {
    releaseHeld();
    await writeFile(testInfo.outputPath('dcs-lifecycle-receipt.json'), JSON.stringify(receipt, null, 2));
    await writeFile(testInfo.outputPath('provider-contexts.json'), JSON.stringify({ actor: receipt.actor,
      driven_by: 'agent', realHumanEvidence: false, providerKind: 'scripted-local-fixture', requests: wire }, null, 2));
    await closeElectronApp(app);
    await new Promise<void>(resolve => llm.server.close(() => resolve()));
  }
});
