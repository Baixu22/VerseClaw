import { createHash, randomUUID } from 'node:crypto';
import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { ElectronApplication } from '@playwright/test';
import type {
  KnowledgeApplyReviewedChangeResult,
  KnowledgeChangeProposal,
  KnowledgeCompileResult,
  KnowledgeDraft,
  KnowledgeGetResult,
  KnowledgeGovernanceReceipt,
  KnowledgeIngestFilesResult,
  KnowledgeListGovernanceReceiptsResult,
  KnowledgeListReviewBundlesResult,
  KnowledgeReviewBundle,
  KnowledgeSearchResult,
} from '../../shared/host-api/contract';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';
import { hostInvoke, startGateway, startScriptedLlm } from './fixtures/fp-p1-harness';
import { configureSessionChainProvider, createSessionChainProject } from './fixtures/session-task-chain';

type HostCall = {
  module?: string;
  action?: string;
  payload?: Record<string, unknown>;
};

type ChatHistory = {
  messages?: Array<{
    role?: string;
    content?: string | Array<{ type?: string; text?: string }>;
  }>;
};

async function installHostCallRecorder(app: ElectronApplication): Promise<void> {
  await app.evaluate(() => {
    const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
    const handlers = (ipcMain as unknown as {
      _invokeHandlers?: Map<string, (event: unknown, request: unknown) => Promise<unknown>>;
    })._invokeHandlers;
    const original = handlers?.get('host:invoke');
    if (!original) throw new Error('host:invoke handler is not registered');
    const state = globalThis as unknown as {
      __matrixKnowledgeHostCalls?: HostCall[];
    };
    state.__matrixKnowledgeHostCalls = [];
    ipcMain.removeHandler('host:invoke');
    ipcMain.handle('host:invoke', async (event, request: HostCall) => {
      state.__matrixKnowledgeHostCalls!.push({
        module: request.module,
        action: request.action,
        payload: request.payload,
      });
      return original(event, request);
    });
  });
}

async function readHostCalls(app: ElectronApplication): Promise<HostCall[]> {
  return await app.evaluate(() => (
    (globalThis as unknown as { __matrixKnowledgeHostCalls?: HostCall[] }).__matrixKnowledgeHostCalls ?? []
  ));
}

function assistantTexts(history: ChatHistory): string[] {
  return (history.messages ?? [])
    .filter(message => message.role === 'assistant')
    .map(message => typeof message.content === 'string'
      ? message.content
      : (message.content ?? []).map(part => part.text ?? '').join(''));
}

async function readTextIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}

async function findOperationJournal(
  candidateDirectories: string[],
  receiptId: string,
): Promise<{ path: string; json: Record<string, unknown> } | null> {
  for (const directory of [...new Set(candidateDirectories)]) {
    const names = await readdir(directory).catch(() => []);
    for (const name of names.filter(entry => entry.endsWith('.json'))) {
      const path = join(directory, name);
      const text = await readTextIfExists(path);
      if (!text?.includes(receiptId)) continue;
      try {
        return { path, json: JSON.parse(text) as Record<string, unknown> };
      } catch {
        continue;
      }
    }
  }
  return null;
}

test('Matrix knowledge imports, indexes, searches, cites, and deletes through isolated Main and Gateway', async ({
  homeDir,
  userDataDir,
  launchElectronApp,
}, testInfo) => {
  test.setTimeout(300_000);
  const marker = randomUUID().replaceAll('-', '');
  const title = `Product matrix knowledge ${marker}`;
  const sourcePath = testInfo.outputPath('source', `${title}.md`);
  const vaultPath = testInfo.outputPath('wiki');
  const workspacePath = testInfo.outputPath('workspace');
  const evidence: Record<string, unknown> = {
    schema: 'product-matrix-knowledge-chain.v1',
    driven_by: 'agent',
    actor: 'product-matrix-knowledge-playwright',
    executionMode: 'explicit-memory-wiki-local-vault',
    status: 'running',
    marker,
    isolation: { homeDir, userDataDir, vaultPath, workspacePath },
  };
  let citationRequest: unknown;
  let sourcePagePath: string | undefined;
  let sourcePageBeforeDelete: string | null = null;
  let indexBeforeDelete: string | null = null;
  let indexAfterDelete: string | null = null;
  let governanceJournal: { path: string; json: Record<string, unknown> } | null;
  const llm = await startScriptedLlm(async (userText, _toolResults, _requestIndex, request) => {
    if (userText.includes(`MATRIX-KNOWLEDGE:${marker}`)) {
      citationRequest = request;
      return { text: `MATRIX-KNOWLEDGE-CITED:${marker}` };
    }
    return { text: `Matrix knowledge fixture ready: ${marker}` };
  });
  let app: ElectronApplication | undefined;
  let cleanupError: unknown;
  try {
    await mkdir(join(sourcePath, '..'), { recursive: true });
    await writeFile(sourcePath, [
      '---',
      'driven_by: agent',
      'actor: product-matrix-knowledge-playwright',
      '---',
      `# ${title}`,
      '',
      `MATRIX-KNOWLEDGE-MARKER:${marker}`,
      'The isolated launch marker must survive import, index, and retrieval before governed deletion.',
      '',
    ].join('\n'), 'utf8');

    app = await launchElectronApp({ skipSetup: true });
    const runningApp = app;
    const page = await getStableWindow(runningApp);
    await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 60_000 });
    await configureSessionChainProvider(runningApp, llm.port);
    const project = await createSessionChainProject(runningApp, workspacePath, `Matrix knowledge ${marker}`);
    evidence.project = project;
    await installHostCallRecorder(runningApp);
    const configured = await hostInvoke<{ success: boolean; error?: string }>(runningApp, 'knowledge', 'configure', { vaultPath, renderMode: 'native' });
    expect(configured.success, configured.error).toBe(true);
    const snapshot = await hostInvoke<{ hash: string }>(runningApp, 'gateway', 'rpc', { method: 'config.get', params: {}, timeoutMs: 30_000 });
    expect(snapshot.hash).toBeTruthy();
    await hostInvoke(runningApp, 'gateway', 'rpc', { method: 'config.patch', params: { baseHash: snapshot.hash,
      raw: JSON.stringify({ plugins: { entries: { 'memory-wiki': { config: {
        search: { backend: 'local', corpus: 'wiki' }, ingest: { autoCompile: true, maxConcurrentJobs: 1 },
      } } } } }), note: 'Isolated product matrix knowledge fixture' }, timeoutMs: 30_000 });
    await hostInvoke(runningApp, 'gateway', 'stop');
    await startGateway(runningApp);
    await page.reload();
    await expect(page.getByTestId('chat-composer-input')).toBeVisible({ timeout: 60_000 });

    const initialStatus = await hostInvoke<{
      success: boolean;
      error?: string;
      status?: { vaultPath?: string; sourceCounts?: Record<string, number> };
    }>(runningApp, 'knowledge', 'status');
    evidence.initialStatus = initialStatus;
    expect(initialStatus.success, initialStatus.error).toBe(true);
    expect(resolve(initialStatus.status?.vaultPath ?? '')).toBe(resolve(vaultPath));
    const init = await hostInvoke<{ success: boolean }>(runningApp, 'knowledge', 'init');
    expect(init.success).toBe(true);

    const beforeImportSearch = await hostInvoke<KnowledgeSearchResult>(runningApp, 'knowledge', 'search', {
      query: marker,
      maxResults: 10,
      corpus: 'wiki',
    });
    expect(beforeImportSearch.success).toBe(true);
    expect(beforeImportSearch.results ?? []).toHaveLength(0);

    const imported = await hostInvoke<KnowledgeIngestFilesResult>(runningApp, 'knowledge', 'ingestFiles', {
      paths: [sourcePath],
      maxFiles: 1,
      maxBytesPerFile: 16 * 1024,
    });
    expect(imported).toMatchObject({ success: true, imported: 1, failed: 0, truncated: false });
    const importedItem = imported.items.find(item => item.inputPath === sourcePath);
    expect(importedItem).toMatchObject({ title, created: true });
    expect(importedItem?.pagePath).toBeTruthy();
    expect(importedItem?.pageId).toBeTruthy();
    const sourcePageAbsolutePath = join(vaultPath, importedItem!.pagePath!);
    sourcePagePath = sourcePageAbsolutePath;
    await expect(access(sourcePageAbsolutePath)).resolves.toBeUndefined();

    const compiled = await hostInvoke<KnowledgeCompileResult>(runningApp, 'knowledge', 'compile');
    expect(compiled.success).toBe(true);
    const rootIndexPath = join(vaultPath, 'index.md');
    const sourceIndexPath = join(vaultPath, 'sources', 'index.md');
    indexBeforeDelete = [
      `# ${rootIndexPath}`,
      await readTextIfExists(rootIndexPath),
      `# ${sourceIndexPath}`,
      await readTextIfExists(sourceIndexPath),
    ].join('\n');
    expect(indexBeforeDelete).toContain(title);

    const statusAfterImport = await hostInvoke<{
      success: boolean;
      status?: { pageCounts?: Record<string, number>; sourceCounts?: Record<string, number> };
    }>(runningApp, 'knowledge', 'status');
    expect(statusAfterImport).toMatchObject({ success: true });
    expect(Object.values(statusAfterImport.status?.pageCounts ?? {}).reduce((total, count) => total + count, 0)).toBeGreaterThan(0);

    const search = await hostInvoke<KnowledgeSearchResult>(runningApp, 'knowledge', 'search', {
      query: marker,
      maxResults: 10,
      corpus: 'wiki',
    });
    expect(search.success).toBe(true);
    const searchRow = (search.results ?? []).find(row => JSON.stringify(row).includes(marker));
    expect(searchRow).toBeTruthy();
    const getBeforeDelete = await hostInvoke<KnowledgeGetResult>(runningApp, 'knowledge', 'get', {
      lookup: importedItem!.pagePath,
      corpus: 'wiki',
    });
    expect(getBeforeDelete.success).toBe(true);
    expect(JSON.stringify(getBeforeDelete)).toContain(marker);
    sourcePageBeforeDelete = await readTextIfExists(sourcePageAbsolutePath);
    expect(sourcePageBeforeDelete).toContain(marker);

    const composer = page.getByTestId('chat-composer-input');
    await composer.fill(`/wiki ${marker}`);
    await composer.press('Enter');
    await expect(page.getByTestId('chat-knowledge-search-input')).toHaveValue(marker);
    const searchResult = page.getByTestId('chat-knowledge-search-result').filter({ hasText: title }).first();
    await expect(searchResult).toBeVisible();
    await searchResult.click();
    await expect(page.getByTestId('chat-knowledge-selected')).toContainText(title);
    await composer.fill(`MATRIX-KNOWLEDGE:${marker}`);
    await page.getByTestId('chat-composer-send').click();
    await expect.poll(() => Boolean(citationRequest), { timeout: 120_000 }).toBe(true);

    const serializedRequest = JSON.stringify(citationRequest);
    expect(serializedRequest).toContain(`[Knowledge reference: ${title} (${importedItem!.pagePath})]`);
    expect(serializedRequest).toContain('owner: memory-wiki');
    expect(serializedRequest).toContain(`subjectId: ${importedItem!.pagePath}`);
    expect(serializedRequest).toContain(marker);
    await expect.poll(async () => assistantTexts(await hostInvoke<ChatHistory>(runningApp, 'gateway', 'rpc', {
      method: 'chat.history',
      params: { sessionKey: project.sessionKey, limit: 100 },
      timeoutMs: 30_000,
    })), { timeout: 60_000 }).toContain(`MATRIX-KNOWLEDGE-CITED:${marker}`);
    await expect(page.locator('body')).toContainText(`MATRIX-KNOWLEDGE-CITED:${marker}`, { timeout: 60_000 });
    const chatHistory = await hostInvoke<ChatHistory>(runningApp, 'gateway', 'rpc', {
      method: 'chat.history',
      params: { sessionKey: project.sessionKey, limit: 100 },
      timeoutMs: 30_000,
    });

    const hostCalls = await readHostCalls(runningApp);
    const chatSend = hostCalls.find(call => call.module === 'chat'
      && call.action === 'sendWithMedia'
      && JSON.stringify(call.payload).includes(marker));
    expect(chatSend?.payload).toMatchObject({
      knowledgeScope: 'wiki',
      knowledgeReferences: [{
        id: importedItem!.pageId,
        lookup: importedItem!.pagePath,
        corpus: 'wiki',
      }],
    });

    const draftResult = await hostInvoke<{ success: boolean; draft?: KnowledgeDraft }>(runningApp, 'knowledge', 'createDraft', {
      title: `Delete ${title}`,
      body: `Remove the agent-driven matrix fixture ${marker}.`,
      type: 'procedure',
      sourceIds: [importedItem!.pageId],
      sourceRefs: [{
        id: importedItem!.pageId!,
        label: title,
        kind: 'wiki',
        path: importedItem!.pagePath,
        ...(typeof getBeforeDelete.revision === 'number' ? { revision: String(getBeforeDelete.revision) } : {}),
      }],
      createdBy: 'agent',
      metadata: { driven_by: 'agent', actor: 'product-matrix-knowledge-playwright', marker },
    });
    expect(draftResult.success).toBe(true);
    expect(draftResult.draft?.id).toBeTruthy();

    const proposalResult = await hostInvoke<{ success: boolean; proposal?: KnowledgeChangeProposal }>(runningApp, 'knowledge', 'proposeChange', {
      operation: 'delete',
      targetPageIds: [importedItem!.pagePath],
      draftId: draftResult.draft!.id,
      reason: `Delete isolated matrix fixture ${marker}`,
      sources: [{ id: importedItem!.pagePath!, label: title, kind: 'wiki', path: importedItem!.pagePath }],
    });
    expect(proposalResult.success).toBe(true);
    expect(proposalResult.proposal).toMatchObject({ operation: 'delete', status: 'proposed' });

    const reviewed = await hostInvoke<{ success: boolean; draft?: KnowledgeDraft }>(runningApp, 'knowledge', 'reviewDraft', {
      id: draftResult.draft!.id,
      action: 'approve',
      stewardNotes: 'Agent-driven approval of an isolated matrix fixture.',
    });
    expect(reviewed.success).toBe(true);
    expect(reviewed.draft?.status).toBe('approved');

    const bundles = await hostInvoke<KnowledgeListReviewBundlesResult>(runningApp, 'knowledge', 'listReviewBundles', {
      status: 'approved',
      limit: 200,
    });
    expect(bundles.success).toBe(true);
    const reviewBundle: KnowledgeReviewBundle | undefined = bundles.bundles.find(bundle =>
      bundle.proposalId === proposalResult.proposal!.id && bundle.draftId === draftResult.draft!.id);
    expect(reviewBundle?.id).toBeTruthy();

    const applied = await hostInvoke<KnowledgeApplyReviewedChangeResult>(runningApp, 'knowledge', 'applyReviewedChange', {
      reviewBundleId: reviewBundle!.id,
    });
    expect(applied).toMatchObject({
      success: true,
      changed: true,
      operation: 'delete',
      receipt: {
        schema: 'knowledge-governance-receipt.v1',
        operation: 'delete',
        owner: 'memory-wiki',
        status: 'committed',
      },
    });
    const receipt = applied.receipt as KnowledgeGovernanceReceipt;
    const listedReceipts = await hostInvoke<KnowledgeListGovernanceReceiptsResult>(runningApp, 'knowledge', 'listGovernanceReceipts');
    expect(listedReceipts.success).toBe(true);
    expect(listedReceipts.receipts).toContainEqual(receipt);
    governanceJournal = await findOperationJournal([
      join(homeDir, '.openclaw', 'knowledge', 'operations'),
      join(userDataDir, 'openclaw-source-state', 'knowledge', 'operations'),
      join(userDataDir, 'knowledge', 'operations'),
    ], receipt.receiptId);
    expect(governanceJournal).toBeTruthy();
    expect(governanceJournal!.json).toMatchObject({
      schema: 'knowledge-governance-operation.v1',
      state: 'json_committed',
      operation: 'delete',
      owner: 'memory-wiki',
    });

    await expect(access(sourcePageAbsolutePath)).rejects.toThrow();
    const getAfterDelete = await hostInvoke<KnowledgeGetResult>(runningApp, 'knowledge', 'get', {
      lookup: importedItem!.pagePath,
      corpus: 'wiki',
    });
    expect(getAfterDelete.success).toBe(true);
    expect(getAfterDelete).not.toHaveProperty('corpus');
    expect(getAfterDelete).not.toHaveProperty('path');
    expect(getAfterDelete).not.toHaveProperty('content');
    const searchAfterDelete = await hostInvoke<KnowledgeSearchResult>(runningApp, 'knowledge', 'search', {
      query: marker,
      maxResults: 10,
      corpus: 'wiki',
    });
    expect(searchAfterDelete.success).toBe(true);
    expect(searchAfterDelete.results ?? []).toHaveLength(0);
    indexAfterDelete = [
      `# ${rootIndexPath}`,
      await readTextIfExists(rootIndexPath),
      `# ${sourceIndexPath}`,
      await readTextIfExists(sourceIndexPath),
    ].join('\n');
    expect(indexAfterDelete).not.toContain(title);
    expect(indexAfterDelete).not.toContain(marker);

    const callsAtEnd = await readHostCalls(runningApp);
    Object.assign(evidence, {
      status: 'passed',
      import: imported,
      compiled,
      statusInitial: initialStatus,
      statusAfterImport,
      search: searchRow,
      getBeforeDelete,
      chat: {
        hostPayload: chatSend?.payload,
        request: citationRequest,
        history: chatHistory,
        assistantReply: `MATRIX-KNOWLEDGE-CITED:${marker}`,
        requestDigest: createHash('sha256').update(serializedRequest).digest('hex'),
      },
      governance: {
        draft: draftResult.draft,
        proposal: proposalResult.proposal,
        reviewBundle: reviewBundle?.id,
        apply: applied,
        receipt,
        listedReceipts: listedReceipts.receipts,
        journalPath: governanceJournal?.path,
        journal: governanceJournal?.json,
      },
      negative: {
        deletedPagePath: sourcePageAbsolutePath,
        fileExistsAfterDelete: false,
        getAfterDelete,
        searchAfterDelete,
        indexMentionFoundAfterDelete: indexAfterDelete.includes(marker),
      },
      hostCalls: callsAtEnd,
      artifacts: {
        sourcePath,
        sourcePageSnapshot: testInfo.outputPath('source-page-before-delete.md'),
        indexBeforeDelete: testInfo.outputPath('index-before-delete.txt'),
        indexAfterDelete: testInfo.outputPath('index-after-delete.txt'),
        receipt: testInfo.outputPath('receipt.json'),
        providerRequest: testInfo.outputPath('chat-provider-request.json'),
        chatHistory: testInfo.outputPath('chat-history.json'),
        hostCalls: testInfo.outputPath('host-knowledge-calls.json'),
      },
    });
    await writeFile(testInfo.outputPath('source-page-before-delete.md'), sourcePageBeforeDelete ?? '', 'utf8');
    await writeFile(testInfo.outputPath('index-before-delete.txt'), indexBeforeDelete ?? '', 'utf8');
    await writeFile(testInfo.outputPath('index-after-delete.txt'), indexAfterDelete ?? '', 'utf8');
    await writeFile(testInfo.outputPath('receipt.json'), JSON.stringify({
      response: receipt,
      listed: listedReceipts.receipts,
      journal: governanceJournal?.json,
    }, null, 2) + '\n', 'utf8');
    await writeFile(testInfo.outputPath('chat-provider-request.json'), JSON.stringify(citationRequest, null, 2) + '\n', 'utf8');
    await writeFile(testInfo.outputPath('chat-history.json'), JSON.stringify(chatHistory, null, 2) + '\n', 'utf8');
    await writeFile(testInfo.outputPath('host-knowledge-calls.json'), JSON.stringify(callsAtEnd, null, 2) + '\n', 'utf8');
  } catch (error) {
    evidence.status = 'failed';
    evidence.error = String(error);
    throw error;
  } finally {
    if (app) {
      try {
        evidence.finalHostCalls = await readHostCalls(app);
      } catch {
        // The app can already be unavailable after a launch or runtime failure.
      }
      try {
        await hostInvoke(app, 'gateway', 'stop');
      } catch (error) {
        cleanupError = error;
      }
      try { await closeElectronApp(app); }
      catch (error) { cleanupError ??= error; }
    }
    llm.server.closeAllConnections();
    await new Promise<void>(resolveClose => llm.server.close(() => resolveClose()));
    evidence.providerLog = llm.log;
    evidence.providerAnomalies = llm.anomalies;
    evidence.sourcePagePath = sourcePagePath;
    evidence.citationRequest = citationRequest;
    evidence.sourcePageBeforeDelete = sourcePageBeforeDelete;
    evidence.indexBeforeDelete = indexBeforeDelete;
    evidence.indexAfterDelete = indexAfterDelete;
    if (cleanupError) { evidence.status = 'failed'; evidence.cleanupError = String(cleanupError); }
    if (citationRequest !== undefined) {
      await writeFile(testInfo.outputPath('chat-provider-request.json'), JSON.stringify(citationRequest, null, 2) + '\n', 'utf8');
    }
    if (sourcePageBeforeDelete !== null) {
      await writeFile(testInfo.outputPath('source-page-before-delete.md'), sourcePageBeforeDelete, 'utf8');
    }
    await writeFile(testInfo.outputPath('evidence.json'), JSON.stringify(evidence, null, 2) + '\n', 'utf8');
  }
  if (cleanupError) throw cleanupError;
});

