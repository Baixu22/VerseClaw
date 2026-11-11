import { readFile, writeFile } from 'node:fs/promises';
import type { ElectronApplication, Page } from '@playwright/test';
import type { RawMessage } from '../../shared/chat/types';
import { getTranscriptEntryId, readSessionListPages } from '../../src/lib/session-read-model';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';
import { hostInvoke, startScriptedLlm } from './fixtures/fp-p1-harness';
import {
  configureSessionChainProvider, createSessionChainProject, instrumentSessionChainHost,
  observeSessionUi, readSessionChainHostCalls,
} from './fixtures/session-task-chain';

// Agent-driven U3 AC1 boundaries and AC5 prose -> explicit existing Handoff preview.
// missing entry identity is explicitly injected into a read response, never the session DB.
const rpc = <T,>(app: ElectronApplication, method: string, params: Record<string, unknown>) =>
  hostInvoke<T>(app, 'gateway', 'rpc', { method, params, timeoutMs: 30_000 });
const text = (message: RawMessage) => typeof message.content === 'string'
  ? message.content : JSON.stringify(message.content);
async function history(app: ElectronApplication, sessionKey: string) {
  return (await rpc<{ messages: RawMessage[] }>(app, 'chat.history',
    { sessionKey, limit: 100, maxChars: 500000 })).messages;
}
async function sessionKeys(app: ElectronApplication) {
  const result = await readSessionListPages(params => rpc<Record<string, unknown>>(app, 'sessions.list', params));
  return (result.sessions as Array<{ key: string }>).map(session => session.key).sort();
}
async function modelTurn(app: ElectronApplication, project: { workspaceId: string; sessionKey: string }, message: string) {
  const sent = await hostInvoke<{ success: boolean; result?: { runId?: string } }>(app, 'chat', 'sendWithMedia', {
    workspaceId: project.workspaceId, sessionKey: project.sessionKey, message, idempotencyKey: message,
  });
  if (!sent.success || !sent.result?.runId) throw new Error('U3 turn not acknowledged: ' + JSON.stringify(sent));
  let receipt: unknown;
  await expect.poll(async () => {
    const read = await rpc<{ status: string }>(app, 'agent.wait', { runId: sent.result!.runId!, timeoutMs: 1000 });
    receipt = read; return read.status;
  }, { timeout: 90_000, intervals: [250, 500, 1000] }).toBe('ok');
  await expect.poll(async () => (await rpc<{ session: { hasActiveRun: boolean } }>(
    app, 'sessions.describe', { key: project.sessionKey })).session.hasActiveRun).toBe(false);
  return { sent, receipt };
}
const userRow = (page: Page, marker: string) =>
  page.locator('[id^="chat-message-"]').filter({ has: page.getByText(marker, { exact: true }) });
const creationCalls = (calls: Awaited<ReturnType<typeof readSessionChainHostCalls>>) => calls.filter(call =>
  (call.module === 'sessions' && ['createHandoff', 'fork'].includes(call.action ?? '')) ||
  (call.module === 'gateway' && ['sessions.create', 'sessions.fork'].includes(call.method ?? '')));

/** Strip only the owner entry ID after the real read; keep provider/local message.id to test fail-closed identity. */
async function installEntryIdentityReadFault(app: ElectronApplication, sessionKey: string, marker: string) {
  await app.evaluate((_electron, input) => {
    const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
    type Request = { module?: string; action?: string; payload?: {
      method?: string; params?: { sessionKey?: string }; sessionKey?: string;
    } };
    type Envelope = { ok: boolean; data?: { messages?: Array<Record<string, unknown>> } };
    type Handler = (event: unknown, request: Request) => Promise<Envelope>;
    const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, Handler> })._invokeHandlers;
    const original = handlers.get('host:invoke');
    if (!original) throw new Error('host:invoke missing');
    const state = { hits: 0, originalEntry: null as Record<string, unknown> | null, restore: () => {
      ipcMain.removeHandler('host:invoke'); ipcMain.handle('host:invoke', original);
    } };
    (globalThis as unknown as { u3EntryReadFault?: typeof state }).u3EntryReadFault = state;
    ipcMain.removeHandler('host:invoke');
    ipcMain.handle('host:invoke', async (event, request: Request) => {
      const envelope = await original(event, request);
      const gatewayRead = request.module === 'gateway' && request.action === 'rpc'
        && request.payload?.method === 'chat.history' && request.payload.params?.sessionKey === input.sessionKey;
      const ownerRead = request.module === 'sessions' && request.action === 'history'
        && request.payload?.sessionKey === input.sessionKey;
      if (!envelope.ok || (!gatewayRead && !ownerRead)) return envelope;
      const data = envelope.data;
      if (!Array.isArray(data?.messages)) throw new Error('U3 fault expected the actual session history read shape');

      const messages = data.messages.map(message => {
        if (message.role !== 'user' || !JSON.stringify(message.content).includes(input.marker)) return message;
        state.hits++; state.originalEntry = structuredClone(message);
        const metadata = message.__openclaw && typeof message.__openclaw === 'object'
          ? message.__openclaw as Record<string, unknown> : {};
        const { id: _removedOwnerId, ...rest } = metadata;
        return { ...message, __openclaw: rest };
      });

      return { ...envelope, data: { ...data, messages } };
    });
  }, { sessionKey, marker });
}
async function removeEntryIdentityReadFault(app: ElectronApplication) {
  return app.evaluate(() => {
    const target = globalThis as unknown as { u3EntryReadFault?: {
      hits: number; originalEntry: Record<string, unknown> | null; restore: () => void;
    } };
    const state = target.u3EntryReadFault;
    if (!state) return null;
    state.restore(); delete target.u3EntryReadFault;
    return { driven_by: 'agent', kind: 'fault-injected-read-projection', hits: state.hits, originalEntry: state.originalEntry };
  });
}

test('U3 rejects question Fork without an assistant ancestor and disables missing-entry projections', async ({ launchElectronApp }, testInfo) => {
  test.setTimeout(300_000);
  const llm = await startScriptedLlm(input => ({ text: input.includes('U3_NO_ENTRY') ? 'U3_SECOND_ANSWER' : 'U3_FIRST_ANSWER' }));
  const app = await launchElectronApp({ skipSetup: true });
  const captureUi = await observeSessionUi(app);
  const evidence: Record<string, unknown> = {
    driven_by: 'agent', actor: 'playwright-u3-fork-boundaries', provider: 'local-scripted',
    acceptance: ['TF-0659/AC1'], status: 'running',
  };
  try {
    await configureSessionChainProvider(app, llm.port);
    await hostInvoke(app, 'settings', 'set', { key: 'language', value: 'en' });
    const project = await createSessionChainProject(app, testInfo.outputPath('workspace'), 'U3 Fork');
    evidence.project = project;
    evidence.firstTurn = await modelTurn(app, project, 'U3_FIRST_QUESTION');
    const original = await history(app, project.sessionKey);
    const firstIndex = original.findIndex(message => message.role === 'user' && text(message).includes('U3_FIRST_QUESTION'));
    expect(firstIndex).toBeGreaterThanOrEqual(0);
    expect(original.slice(0, firstIndex).some(message => message.role === 'assistant')).toBe(false);
    const firstId = getTranscriptEntryId(original[firstIndex]);
    expect(firstId).toBeTruthy();
    const before = await sessionKeys(app);
    const page = await getStableWindow(app); await page.reload();
    const firstRow = userRow(page, 'U3_FIRST_QUESTION');
    await expect(firstRow).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('chat-composer-input').fill('U3 source draft remains here');
    await instrumentSessionChainHost(app);
    await page.getByText('U3_FIRST_QUESTION', { exact: true }).hover();
    await firstRow.getByTestId('chat-user-message-fork').click();
    const locale = JSON.parse(await readFile('shared/i18n/locales/en/chat.json', 'utf8'));
    await expect(page.getByText(locale.questionFork.noAncestor, { exact: true })).toBeVisible();
    await expect(page.getByTestId('question-fork-dialog')).toHaveCount(0);
    expect(creationCalls(await readSessionChainHostCalls(app))).toEqual([]);
    expect(await sessionKeys(app)).toEqual(before);
    // Also ask the real owner for that exact boundary; it must reject, never retry without fromLeafId.
    const rejected = await hostInvoke<{ success: boolean; error?: string }>(app, 'sessions', 'fork', {
      workspaceId: project.workspaceId, sessionKey: project.sessionKey, fromLeafId: firstId,
    }).then(result => ({ success: result.success, error: result.error ?? '' }),
      error => ({ success: false, error: String(error) }));
    expect(rejected.success).toBe(false);
    expect(rejected.error).toMatch(/assistant turn|from-leaf-unresolved|No fork was created/i);
    expect(await sessionKeys(app)).toEqual(before);
    await expect(page.getByTestId('chat-composer-input')).toHaveValue('U3 source draft remains here');
    evidence.noAncestor = { firstId, rejected, calls: await readSessionChainHostCalls(app), sessionKeys: before };
    await page.screenshot({ path: testInfo.outputPath('u3-no-assistant-ancestor.png') });

    evidence.secondTurn = await modelTurn(app, project, 'U3_NO_ENTRY');
    const persisted = await history(app, project.sessionKey);
    const secondIndex = persisted.findIndex(message => message.role === 'user' && text(message).includes('U3_NO_ENTRY'));
    expect(secondIndex).toBeGreaterThan(firstIndex);
    expect(persisted.slice(0, secondIndex).some(message => message.role === 'assistant' && getTranscriptEntryId(message))).toBe(true);
    const secondId = getTranscriptEntryId(persisted[secondIndex]);
    expect(secondId).toBeTruthy();
    await instrumentSessionChainHost(app);
    await installEntryIdentityReadFault(app, project.sessionKey, 'U3_NO_ENTRY');
    await page.reload();
    const missingRow = userRow(page, 'U3_NO_ENTRY');
    await expect(missingRow).toBeVisible({ timeout: 30_000 });
    const fault = await app.evaluate(() => {
      const state = (globalThis as unknown as { u3EntryReadFault?: {
        hits: number; originalEntry: Record<string, unknown> | null;
      } }).u3EntryReadFault;
      return { driven_by: 'agent', kind: 'fault-injected-read-projection', hits: state?.hits ?? 0,
        originalEntry: state?.originalEntry ?? null };
    });
    evidence.readProjectionFault = fault;
    expect(fault.hits).toBeGreaterThan(0);
    const readFaultRemoved = await removeEntryIdentityReadFault(app);
    expect(readFaultRemoved?.hits).toBeGreaterThan(0);
    // The sessions owner route bypasses only this gateway-read projection fault; keep it active for the UI assertion.
    const unchanged = await hostInvoke<{ success: boolean; messages?: RawMessage[] }>(app, 'sessions', 'history', {
      sessionKey: project.sessionKey, expectedSessionGeneration: project.generation, limit: 100,
    });
    expect(unchanged.success).toBe(true);
    expect(getTranscriptEntryId(unchanged.messages!.find(message => message.role === 'user' && text(message).includes('U3_NO_ENTRY'))!)).toBe(secondId);
    expect(await sessionKeys(app)).toEqual(before);
    expect(creationCalls(await readSessionChainHostCalls(app))).toEqual([]);
    await installEntryIdentityReadFault(app, project.sessionKey, 'U3_NO_ENTRY');
    evidence.locales=[];
    for(const language of ['en','zh','ja','ru']){
      const labels=JSON.parse(await readFile(`shared/i18n/locales/${language}/chat.json`,'utf8'));
      await hostInvoke(app,'settings','set',{key:'language',value:language});await page.reload();
      await expect(page.locator('html')).toHaveAttribute('lang',language);
      await page.getByText('U3_NO_ENTRY',{exact:true}).hover();
      // Missing owner identity remains visible and disabled, with a readable reason.
      const missingAction=userRow(page,'U3_NO_ENTRY').getByTestId('chat-user-message-fork');
      await expect(missingAction).toBeVisible();await expect(missingAction).toBeDisabled();
      await expect(missingAction).toHaveAttribute('aria-description',labels.messageActions.forkMissingBoundary);
      await missingAction.locator('..').hover();
      await expect(page.getByRole('tooltip')).toContainText(labels.messageActions.forkMissingBoundary);
      await page.screenshot({path:testInfo.outputPath(`u3-missing-entry-${language}.png`)});
      (evidence.locales as unknown[]).push({language,status:'passed'});
    }
    expect(creationCalls(await readSessionChainHostCalls(app))).toEqual([]);
    await expect(page.getByTestId('question-fork-dialog')).toHaveCount(0);
    evidence.status = 'passed';
  } catch (error) { evidence.status = 'failed'; evidence.error = String(error); throw error; }
  finally {
    const remainingFault = await removeEntryIdentityReadFault(app).catch(() => null);
    if (remainingFault) evidence.readProjectionFault = remainingFault;
    await captureUi(name => testInfo.outputPath(name)).catch(error => { evidence.diagnosticError = String(error); });
    evidence.providerLog = llm.log;
    await writeFile(testInfo.outputPath('u3-fork-boundaries.json'), JSON.stringify(evidence, null, 2));
    await hostInvoke(app, 'gateway', 'stop').catch(() => undefined); await closeElectronApp(app);
    llm.server.closeAllConnections(); await new Promise<void>(resolve => llm.server.close(() => resolve()));
  }
});

test('U3 plain model advice needs explicit Handoff preview and cancellation creates no child', async ({ launchElectronApp }, testInfo) => {
  test.setTimeout(240_000);
  const answer = 'U3_TEXT_ONLY：已创建新会话。建议换会话。若要继续，请打开 Chat options → Handoff，审阅草稿后再决定。';
  const llm = await startScriptedLlm(() => ({ text: answer }));
  const app = await launchElectronApp({ skipSetup: true });
  const captureUi = await observeSessionUi(app);
  const evidence: Record<string, unknown> = {
    driven_by: 'agent', actor: 'playwright-u3-text-intent', provider: 'local-scripted',
    acceptance: ['TF-0659/AC5'], structuredModelIntent: false, status: 'running',
  };
  try {
    await configureSessionChainProvider(app, llm.port);
    await hostInvoke(app, 'settings', 'set', { key: 'language', value: 'en' });
    const project = await createSessionChainProject(app, testInfo.outputPath('workspace'), 'U3 Prose');
    const before = await sessionKeys(app);
    const page = await getStableWindow(app); await page.reload();
    await page.getByTestId('chat-composer-input').fill('U3 unsubmitted source draft');
    await instrumentSessionChainHost(app);
    evidence.turn = await modelTurn(app, project, 'U3_PROSE_ONLY');
    await expect(page.getByTestId('chat-scroll-container')).toContainText(answer, { timeout: 30_000 });
    await expect(page.getByTestId('question-fork-dialog')).toHaveCount(0);
    await expect(page.getByTestId('chat-handoff-dialog')).toHaveCount(0);
    await expect(page.getByTestId('chat-composer-input')).toHaveValue('U3 unsubmitted source draft');
    const after = await sessionKeys(app);
    expect(after).toEqual(before);
    const calls = await readSessionChainHostCalls(app);
    expect(creationCalls(calls)).toEqual([]);
    expect(calls.filter(call => call.module === 'chat' && call.action === 'sendWithMedia')).toHaveLength(1);
    expect(llm.log.length).toBeGreaterThan(0);
    expect(llm.log.every(call => call.issued?.startsWith('text:'))).toBe(true);
    const owner = await rpc<{ session: { sessionId: string } }>(app, 'sessions.describe', { key: project.sessionKey });
    expect(owner.session.sessionId).toBe(project.generation);
    const workspace = await hostInvoke<{ activeWorkspace: { activeSessionKey: string } }>(app, 'workspaces', 'getActive');
    expect(workspace.activeWorkspace.activeSessionKey).toBe(project.sessionKey);
    const operation = await hostInvoke<{ operation: unknown }>(app, 'sessions', 'handoffOperation', {
      workspaceId: project.workspaceId, sessionKey: project.sessionKey,
    });
    expect(operation.operation).toBeNull();
    evidence.project = project; evidence.before = before; evidence.after = after;
    evidence.owner = owner; evidence.calls = calls; evidence.handoffOperation = operation;
    await page.screenshot({ path: testInfo.outputPath('u3-prose-no-hidden-child.png') });

    // Prose offers advice; only this explicit user action opens the existing Handoff preview.
    const locale = JSON.parse(await readFile('shared/i18n/locales/en/chat.json', 'utf8'));
    await page.getByTestId('chat-project-session-header').getByRole('button').nth(1).click();
    const handoffAction = page.getByTestId('chat-session-handoff');
    await expect(handoffAction).toBeEnabled();
    await handoffAction.click();
    const preview = page.getByTestId('chat-handoff-dialog');
    await expect(preview).toBeVisible({ timeout: 30_000 });
    await expect(preview).toContainText(locale.composer.handoff.dialogDescription);
    const draft = page.getByTestId('chat-handoff-draft');
    await expect(draft).toBeEditable();
    await expect(draft).not.toHaveValue('');
    const preparedDraft = await draft.inputValue();
    const reviewedDraft = preparedDraft + '\n\nU3 reviewed: continue the original work after checking this draft.';
    await draft.fill(reviewedDraft);
    await expect(draft).toHaveValue(reviewedDraft);
    await expect(page.getByTestId('chat-handoff-create')).toBeEnabled();
    expect(await sessionKeys(app)).toEqual(before);
    expect(creationCalls(await readSessionChainHostCalls(app))).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath('u3-explicit-handoff-preview.png') });
    await preview.getByRole('button', { name: locale.composer.handoff.cancel, exact: true }).click();
    await expect(preview).toHaveCount(0);
    await expect(page.getByTestId('chat-composer-input')).toHaveValue('U3 unsubmitted source draft');
    const afterCancel = await sessionKeys(app);
    expect(afterCancel).toEqual(before);
    const afterCalls = await readSessionChainHostCalls(app);
    expect(afterCalls.filter(call => call.module === 'sessions' && call.action === 'prepareHandoff')).toHaveLength(1);
    expect(creationCalls(afterCalls)).toEqual([]);
    expect(afterCalls.filter(call => call.module === 'chat' && call.action === 'sendWithMedia')).toHaveLength(1);
    const afterOperation = await hostInvoke<{ operation: unknown }>(app, 'sessions', 'handoffOperation', {
      workspaceId: project.workspaceId, sessionKey: project.sessionKey,
    });
    expect(afterOperation.operation).toBeNull();
    const afterWorkspace = await hostInvoke<{ activeWorkspace: { activeSessionKey: string } }>(app, 'workspaces', 'getActive');
    expect(afterWorkspace.activeWorkspace.activeSessionKey).toBe(project.sessionKey);
    evidence.explicitPreview = { preparedDraft, reviewedDraft, afterCancel, calls: afterCalls, operation: afterOperation };

    evidence.status = 'passed';
  } catch (error) { evidence.status = 'failed'; evidence.error = String(error); throw error; }
  finally {
    await captureUi(name => testInfo.outputPath(name)).catch(error => { evidence.diagnosticError = String(error); });
    evidence.providerLog = llm.log;
    await writeFile(testInfo.outputPath('u3-text-intent.json'), JSON.stringify(evidence, null, 2));
    await hostInvoke(app, 'gateway', 'stop').catch(() => undefined); await closeElectronApp(app);
    llm.server.closeAllConnections(); await new Promise<void>(resolve => llm.server.close(() => resolve()));
  }
});
