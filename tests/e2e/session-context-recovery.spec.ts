import { readFile, writeFile } from 'node:fs/promises';
import type { ElectronApplication, Page, TestInfo } from '@playwright/test';
import type { RawMessage } from '../../shared/chat/types';
import { getTranscriptEntryId } from '../../src/lib/session-read-model';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';
import { hostInvoke, startScriptedLlm } from './fixtures/fp-p1-harness';
import {
  addSessionChainChildren, configureSessionChainProvider, createSessionChainProject, observeSessionUi,
} from './fixtures/session-task-chain';

// Agent-driven failure/recovery-access proof. Mutation failures are injected at Host;
// successful readback is performed only after removing that interceptor.
// No fixture returns mutation success. A timeout here is before owner dispatch, not lost-after-commit.
type Action = 'compact' | 'compactRange' | 'restoreCheckpoint';
const FIXTURE_CHECKPOINT = 'u5-read-projection-only';
const rpc = <T,>(app: ElectronApplication, method: string, params: Record<string, unknown>) =>
  hostInvoke<T>(app, 'gateway', 'rpc', { method, params, timeoutMs: 30_000 });

async function seed(app: ElectronApplication, info: TestInfo, label: string) {
  const project = await createSessionChainProject(app, info.outputPath('workspace'), label);
  for (const marker of ['U5_HEAD', 'U5_TARGET']) {
    const sent = await hostInvoke<{ success: boolean; result?: { runId?: string } }>(app, 'chat', 'sendWithMedia', {
      workspaceId: project.workspaceId, sessionKey: project.sessionKey, message: marker, idempotencyKey: marker,
    });
    if (!sent.success || !sent.result?.runId) throw new Error('U5 seed turn was not acknowledged');
    await expect.poll(async () => (await rpc<{ session: { hasActiveRun: boolean } }>(app,
      'sessions.describe', { key: project.sessionKey })).session.hasActiveRun, { timeout: 90_000 }).toBe(false);
    const settled = await rpc<{ status: string }>(app, 'agent.wait', { runId: sent.result!.runId!, timeoutMs: 1000 });
    expect(settled.status).toBe('ok');
  }
  await expect.poll(async () => (await rpc<{ session: { hasActiveRun: boolean } }>(app,
    'sessions.describe', { key: project.sessionKey })).session.hasActiveRun).toBe(false);
  return project;
}
async function ownerReadback(app: ElectronApplication, sessionKey: string) {
  const described = await rpc<{ session: { sessionId: string; hasActiveRun: boolean } }>(app, 'sessions.describe', { key: sessionKey });
  const history = await hostInvoke<{ success: boolean; messages?: RawMessage[] }>(app, 'sessions', 'history', {
    sessionKey, expectedSessionGeneration: described.session.sessionId,
  });
  const status = await hostInvoke<{ success: boolean }>(app, 'sessions', 'compactionStatus', { sessionKey, agentId: 'main' });
  const checkpoints = await hostInvoke<{ success: boolean; checkpoints: Array<{ id: string }> }>(app,
    'sessions', 'resumeCheckpoints', { sessionKey, agentId: 'main', limit: 20 });
  expect(history.success).toBe(true); expect(status.success).toBe(true); expect(checkpoints.success).toBe(true);
  return { described, history, status, checkpoints };
}
async function installFault(app: ElectronApplication, action: Action, sessionKey: string, checkpointProjection = false) {
  await app.evaluate((_electron, input) => {
    const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
    type Request = { module?: string; action?: string; payload?: Record<string, unknown> };
    type Handler = (event: unknown, request: Request) => Promise<unknown>;
    const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, Handler> })._invokeHandlers;
    const original = handlers.get('host:invoke')!;
    const state = {
      calls: [] as Request[], reads: [] as Request[], cacheChecks: [] as Array<Record<string, unknown>>, ownerMutationDispatches: 0,
      release: null as null | ((mode: 'reject' | 'timeout' | 'accepted-pending') => void),
      restore: () => { ipcMain.removeHandler('host:invoke'); ipcMain.handle('host:invoke', original); },
    };
    (globalThis as unknown as { u5ContextFault: typeof state }).u5ContextFault = state;
    ipcMain.removeHandler('host:invoke');
    ipcMain.handle('host:invoke', async (event, request: Request) => {
      if (request.module === 'usage' && request.action === 'promptCacheStatus') {
        const check: Record<string, unknown> = { payload: request.payload, startedAt: Date.now() }; state.cacheChecks.push(check);
        try { const result = await original(event, request); check.result = result; return result; }
        catch (error) { check.error = String(error); throw error; } finally { check.finishedAt = Date.now(); }
      }
      if (request.module === 'sessions' && request.payload?.sessionKey === input.sessionKey) {
        if (request.action === input.action) {
          state.calls.push(structuredClone(request));
          const mode = await new Promise<'reject' | 'timeout' | 'accepted-pending'>(resolve => { state.release = resolve; });
          state.release = null;
          if (mode === 'timeout') throw new Error('U5_TIMEOUT_OUTCOME_UNKNOWN');
          if (mode === 'accepted-pending') return { ok: true, data: { success: true, status: 'pending', compacted: false, sessionKey: input.sessionKey } };
          return { ok: true, data: { success: false, compacted: false, status: 'failed',
            key: input.sessionKey, checkpointId: request.payload.checkpointId,
            error: state.calls.length === 3 ? 'U5_STALE_OWNER_REJECTED' : 'U5_OWNER_REJECTED',
            reason: state.calls.length === 3 ? 'U5_STALE_OWNER_REJECTED' : 'U5_OWNER_REJECTED' } };
        }
        if (input.checkpointProjection && request.action === 'resumeCheckpoints') {
          const createdAt = '2026-11-09T00:00:00.000Z';
          // Read-only fixture row to reach the Restore interaction; it is never persisted or restored.
          return { ok: true, data: { success: true, key: input.sessionKey, checkpoints: [{
            id: input.checkpointId, sessionKey: input.sessionKey, trigger: 'guide', status: 'repair',
            createdAt: Date.parse(createdAt), updatedAt: Date.parse(createdAt),
            checkpoint: { schemaVersion: 1, id: input.checkpointId, sessionKey: input.sessionKey,
              trigger: 'guide', objective: 'U5 read-projection checkpoint', createdAt,
              filesTouched: [], testsRun: [], decisions: [], deviations: [], openBlockers: [], reviewNeededItems: [], evidenceRefs: [] },
          }] } };
        }
        state.reads.push(structuredClone(request));
      }
      return original(event, request);
    });
  }, { action, sessionKey, checkpointProjection, checkpointId: FIXTURE_CHECKPOINT });
}
async function faultState(app: ElectronApplication) {
  return app.evaluate(() => {
    const state = (globalThis as unknown as { u5ContextFault?: { calls: unknown[]; reads: unknown[]; release: unknown; ownerMutationDispatches: number } }).u5ContextFault;
    return { calls: state?.calls ?? [], reads: state?.reads ?? [], held: Boolean(state?.release), ownerMutationDispatches: state?.ownerMutationDispatches ?? 0 };
  });
}
async function releaseFault(app: ElectronApplication, mode: 'reject' | 'timeout' | 'accepted-pending') {
  await app.evaluate((_electron, mode) => {
    const state = (globalThis as unknown as { u5ContextFault?: { release: null | ((mode: 'reject' | 'timeout' | 'accepted-pending') => void) } }).u5ContextFault;
    if (!state?.release) throw new Error('U5 mutation was not held');
    state.release(mode);
  }, mode);
}
async function removeFault(app: ElectronApplication) {
  return app.evaluate(() => {
    const target = globalThis as unknown as { u5ContextFault?: {
      calls: unknown[]; reads: unknown[]; cacheChecks: unknown[]; ownerMutationDispatches: number;
      release: null | ((mode: 'reject' | 'timeout' | 'accepted-pending') => void); restore: () => void;
    } };
    const state = target.u5ContextFault;
    if (!state) return null;
    state.release?.('timeout'); state.restore(); delete target.u5ContextFault;
    return { driven_by: 'agent', injection: 'Host failure before mutation dispatch',
      calls: state.calls, reads: state.reads, cacheChecks: state.cacheChecks, ownerMutationDispatches: state.ownerMutationDispatches };
  });
}
const openCheckpoints = async (page: Page) => {
  await page.getByTestId('chat-project-session-header').getByRole('button').nth(1).click();
  await page.getByTestId('chat-session-checkpoints').click();
  await expect(page.getByTestId('chat-checkpoints-dialog')).toBeVisible();
};
const paint = (page: Page) => page.evaluate(() => new Promise<void>(resolve =>
  requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));

test('U5 manual compact preserves its instructions on cancel, pending, refusal and timeout', async ({ launchElectronApp }, testInfo) => {
  test.setTimeout(300_000);
  const llm = await startScriptedLlm(() => ({ text: 'U5 original context stays readable.' }));
  const app = await launchElectronApp({ skipSetup: true });
  const captureUi = await observeSessionUi(app);
  const evidence: Record<string, unknown> = { driven_by: 'agent', actor: 'playwright-u5-context',
    action: 'compact', status: 'running', mutationSuccess: 'not_claimed', postCommitReplyLoss: 'not_run' };
  try {
    await configureSessionChainProvider(app, llm.port);
    await hostInvoke(app, 'settings', 'set', { key: 'language', value: 'en' });
    const project = await seed(app, testInfo, 'U5 Compact'); evidence.project = project;
    const before = await ownerReadback(app, project.sessionKey); evidence.before = before;
    await installFault(app, 'compact', project.sessionKey);
    const page = await getStableWindow(app); await page.reload();
    await expect(page.getByText('U5_TARGET', { exact: true })).toBeVisible({ timeout: 60_000 });
    const locale = JSON.parse(await readFile('shared/i18n/locales/en/chat.json', 'utf8'));
    const open = async () => {
      await page.getByTestId('chat-composer-input').fill('/compact');
      const option = page.getByTestId('chat-slash-command-option-compact');
      await expect(option).toContainText(/[\d.]+k?\s*\/\s*[\d.]+k?\s*tokens/);
      await option.focus(); await option.press('Enter');
      await expect(page.getByTestId('chat-compaction-dialog')).toBeVisible();
    };
    await open();
    const dialog = page.getByTestId('chat-compaction-dialog'), instructions = page.getByTestId('chat-compaction-instructions');
    await instructions.fill('U5 preserve this explicit instruction');
    await dialog.getByRole('button', { name: locale.composer.compaction.cancel, exact: true }).click();
    expect((await faultState(app)).calls).toHaveLength(0);
    await open(); await expect(instructions).toHaveValue('U5 preserve this explicit instruction');
    await page.getByTestId('chat-compaction-confirm').focus(); await page.getByTestId('chat-compaction-confirm').press('Enter');
    await expect.poll(async () => (await faultState(app)).held, { timeout: 60_000 }).toBe(true);
    await expect(page.getByTestId('chat-compaction-confirm')).toBeDisabled();
    expect((await faultState(app)).calls).toEqual([expect.objectContaining({ payload: expect.objectContaining({ expectedSessionId: project.generation }) })]);
    await expect(instructions).toHaveValue('U5 preserve this explicit instruction');
    await expect(dialog).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('compact-pending.png') });
    await releaseFault(app, 'reject');
    await expect(page.getByText('U5_OWNER_REJECTED', { exact: true })).toBeVisible();
    await expect(instructions).toHaveValue('U5 preserve this explicit instruction');
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId('chat-compaction-confirm')).toBeEnabled();
    await page.getByTestId('chat-compaction-confirm').focus(); await page.getByTestId('chat-compaction-confirm').press('Enter');
    await expect.poll(async () => (await faultState(app)).held, { timeout: 60_000 }).toBe(true);
    await releaseFault(app, 'timeout');
    await expect(page.getByText(/U5_TIMEOUT_OUTCOME_UNKNOWN/)).toBeVisible();
    await expect(instructions).toHaveValue('U5 preserve this explicit instruction');
    await paint(page); expect((await faultState(app)).calls).toHaveLength(2);
    await expect(page.getByTestId('chat-compaction-confirm')).toBeEnabled();
    await page.getByTestId('chat-compaction-confirm').focus(); await page.getByTestId('chat-compaction-confirm').press('Enter');
    await expect.poll(async () => (await faultState(app)).held, { timeout: 60_000 }).toBe(true);
    await releaseFault(app, 'accepted-pending');
    await expect(page.getByText(locale.composer.compaction.toastPending, { exact: true })).toBeVisible();
    await expect(dialog).toBeVisible(); await expect(instructions).toHaveValue('U5 preserve this explicit instruction');
    await paint(page); expect((await faultState(app)).calls).toHaveLength(3);
    evidence.fault = await removeFault(app);
    evidence.after = await ownerReadback(app, project.sessionKey);
    expect((evidence.after as typeof before).described.session.sessionId).toBe(project.generation);
    expect((evidence.after as typeof before).history.messages).toEqual(before.history.messages);
    await dialog.getByRole('button', { name: locale.composer.compaction.cancel, exact: true }).click();
    await openCheckpoints(page); await page.getByTestId('chat-checkpoints-refresh').click();
    await expect(page.getByTestId('chat-checkpoints-dialog')).toHaveAttribute('aria-busy', 'false');
    await page.getByTestId('chat-checkpoints-close').click();
    evidence.status = 'passed';
  } catch (error) { evidence.status = 'failed'; evidence.error = String(error); throw error; }
  finally {
    evidence.remainingFault = await removeFault(app).catch(String);
    await captureUi(name => testInfo.outputPath(name)).catch(String);
    await writeFile(testInfo.outputPath('u5-compact.json'), JSON.stringify(evidence, null, 2));
    await hostInvoke(app, 'gateway', 'stop').catch(() => undefined); await closeElectronApp(app);
    llm.server.closeAllConnections(); await new Promise<void>(resolve => llm.server.close(() => resolve()));
  }
});

test('U5 range compact keeps the exact boundary and draft, and ignores a late error in another session', async ({ launchElectronApp }, testInfo) => {
  test.setTimeout(300_000);
  const llm = await startScriptedLlm(() => ({ text: 'U5 context preceding the next question.' }));
  const app = await launchElectronApp({ skipSetup: true }); const captureUi = await observeSessionUi(app);
  const evidence: Record<string, unknown> = { driven_by: 'agent', actor: 'playwright-u5-context',
    action: 'compactRange', status: 'running', previewCancel: 'not_applicable: explicit message action',
    mutationSuccess: 'not_claimed', postCommitReplyLoss: 'not_run' };
  try {
    await configureSessionChainProvider(app, llm.port);
    await hostInvoke(app, 'settings', 'set', { key: 'language', value: 'en' });
    const project = await seed(app, testInfo, 'U5 Range'), child = (await addSessionChainChildren(app, project, 0, 1))[0];
    const before = await ownerReadback(app, project.sessionKey); evidence.before = before;
    const target = before.history.messages!.find(message => message.role === 'user' && JSON.stringify(message.content).includes('U5_TARGET'))!;
    const entryId = getTranscriptEntryId(target); expect(entryId).toBeTruthy();
    await installFault(app, 'compactRange', project.sessionKey);
    const page = await getStableWindow(app); await page.reload();
    await expect(page.getByText('U5_TARGET', { exact: true })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText('U5_TARGET', { exact: true })).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('chat-composer-input').fill('U5 range draft');
    const row = page.locator('[id^="chat-message-"]').filter({ has: page.getByText('U5_TARGET', { exact: true }) });
    const act = async () => { await page.getByText('U5_TARGET', { exact: true }).hover(); await row.getByTestId('chat-user-message-summarize-from').click(); };
    const locale = JSON.parse(await readFile('shared/i18n/locales/en/chat.json', 'utf8'));
    await act(); await expect.poll(async () => (await faultState(app)).held, { timeout: 60_000 }).toBe(true);
    await expect(page.getByText(locale.composer.compactRange.toastCompacted, { exact: true })).toHaveCount(0);
    await expect(page.getByTestId('chat-composer-input')).toHaveValue('U5 range draft');
    await releaseFault(app, 'reject'); await expect(page.getByText('U5_OWNER_REJECTED', { exact: true })).toBeVisible();
    await act(); await expect.poll(async () => (await faultState(app)).held, { timeout: 60_000 }).toBe(true);
    await releaseFault(app, 'timeout'); await expect(page.getByText(/U5_TIMEOUT_OUTCOME_UNKNOWN/)).toBeVisible();
    await expect(page.getByTestId('chat-composer-input')).toHaveValue('U5 range draft');
    await act(); await expect.poll(async () => (await faultState(app)).held, { timeout: 60_000 }).toBe(true);
    // Move through the existing family action while A's mutation response is still held.
    await page.getByTestId('session-family-children').selectOption(child);
    await expect(page.getByTestId('chat-composer-input')).toHaveValue('Child 1 draft');
    await releaseFault(app, 'reject'); await paint(page);
    await expect(page.getByText('U5_STALE_OWNER_REJECTED', { exact: true })).toHaveCount(0);
    await expect(page.getByTestId('chat-composer-input')).toHaveValue('Child 1 draft');
    // Return to the source before owner readback; no mutation is blindly retried.
    await page.getByTestId('session-family-source').click();
    await expect(page.getByTestId('chat-composer-input')).toHaveValue('U5 range draft');
    await act(); await expect.poll(async () => (await faultState(app)).held, { timeout: 60_000 }).toBe(true);
    await releaseFault(app, 'accepted-pending');
    await expect(page.getByText(locale.composer.compaction.toastPending, { exact: true })).toBeVisible();
    await expect(page.getByText(locale.composer.compactRange.toastCompacted, { exact: true })).toHaveCount(0);
    await expect(page.getByTestId('chat-composer-input')).toHaveValue('U5 range draft');
    await paint(page);
    const faults = await faultState(app);
    expect(faults.calls).toHaveLength(4);
    evidence.acceptedPending = { inputRetained: true, successNotShown: true, dispatchedCalls: faults.calls.length };
    for (const call of faults.calls as Array<{ payload: Record<string, unknown> }>) {
      expect(call.payload.expectedSessionId).toBe(project.generation);
      expect(call.payload).toMatchObject({ sessionKey: project.sessionKey, fromLeafId: entryId });
      expect(call.payload).not.toHaveProperty('toLeafId');
    }
    evidence.fault = await removeFault(app);
    const after = await ownerReadback(app, project.sessionKey); evidence.after = after;
    expect(after.history.messages).toEqual(before.history.messages);
    expect(after.described.session.sessionId).toBe(project.generation);
    await page.getByTestId('chat-toolbar-refresh').click();
    await expect(page.getByText('U5_TARGET', { exact: true })).toBeVisible();
    evidence.project = project; evidence.entryId = entryId; evidence.status = 'passed';
  } catch (error) { evidence.status = 'failed'; evidence.error = String(error); throw error; }
  finally {
    evidence.remainingFault = await removeFault(app).catch(String);
    await captureUi(name => testInfo.outputPath(name)).catch(String);
    await writeFile(testInfo.outputPath('u5-range.json'), JSON.stringify(evidence, null, 2));
    await hostInvoke(app, 'gateway', 'stop').catch(() => undefined); await closeElectronApp(app);
    llm.server.closeAllConnections(); await new Promise<void>(resolve => llm.server.close(() => resolve()));
  }
});

test('U5 checkpoint restore keeps pending and rejected states honest and refreshes the original owner after timeout', async ({ launchElectronApp }, testInfo) => {
  test.setTimeout(300_000);
  const llm = await startScriptedLlm(() => ({ text: 'U5 checkpoint source context.' }));
  const app = await launchElectronApp({ skipSetup: true }); const captureUi = await observeSessionUi(app);
  const evidence: Record<string, unknown> = { driven_by: 'agent', actor: 'playwright-u5-context',
    action: 'restoreCheckpoint', status: 'running', checkpointSelection: 'fault-injected read projection only',
    mutationSuccess: 'not_claimed', postCommitReplyLoss: 'not_run' };
  try {
    await configureSessionChainProvider(app, llm.port);
    const project = await seed(app, testInfo, 'U5 Restore');
    const before = await ownerReadback(app, project.sessionKey); evidence.before = before;
    await installFault(app, 'restoreCheckpoint', project.sessionKey, true);
    const page = await getStableWindow(app); await page.reload();
    await expect(page.getByText('U5_TARGET', { exact: true })).toBeVisible({ timeout: 60_000 });
    await page.getByTestId('chat-composer-input').fill('U5 restore draft');
    await openCheckpoints(page);
    await expect(page.getByTestId('chat-checkpoint-restore-' + FIXTURE_CHECKPOINT)).toBeVisible();
    await page.getByTestId('chat-checkpoints-close').click();
    expect((await faultState(app)).calls).toHaveLength(0);
    await openCheckpoints(page);
    const restore = page.getByTestId('chat-checkpoint-restore-' + FIXTURE_CHECKPOINT);
    await restore.click(); await expect.poll(async () => (await faultState(app)).held, { timeout: 60_000 }).toBe(true);
    await expect(restore).toBeDisabled();
    expect((await faultState(app)).calls).toEqual([expect.objectContaining({ payload: expect.objectContaining({ expectedSessionId: project.generation }) })]);
    await expect(page.getByTestId('chat-checkpoints-dialog')).toHaveAttribute('aria-busy', 'true');
    await expect(page.getByTestId('chat-checkpoints-restored')).toHaveCount(0);
    await releaseFault(app, 'reject');
    await expect(page.getByTestId('chat-checkpoints-error')).toContainText('U5_OWNER_REJECTED');
    await expect(restore).toBeEnabled();
    await restore.click(); await expect.poll(async () => (await faultState(app)).held, { timeout: 60_000 }).toBe(true);
    await releaseFault(app, 'timeout');
    await expect(page.getByTestId('chat-checkpoints-error')).toContainText('U5_TIMEOUT_OUTCOME_UNKNOWN');
    await expect(page.getByTestId('chat-checkpoints-restored')).toHaveCount(0);
    expect((await faultState(app)).calls).toHaveLength(2);
    evidence.fault = await removeFault(app);
    const after = await ownerReadback(app, project.sessionKey); evidence.after = after;
    expect(after.described.session.sessionId).toBe(project.generation);
    expect(after.history.messages).toEqual(before.history.messages);
    expect(after.checkpoints.checkpoints.some(checkpoint => checkpoint.id === FIXTURE_CHECKPOINT)).toBe(false);
    // The same dialog's refresh now reaches the real original resumeCheckpoints owner.
    await page.getByTestId('chat-checkpoints-refresh').click();
    await expect(restore).toHaveCount(0);
    await expect(page.getByTestId('chat-checkpoints-dialog')).toHaveAttribute('aria-busy', 'false');
    await expect(page.getByTestId('chat-checkpoints-restored')).toHaveCount(0);
    await page.getByTestId('chat-checkpoints-close').click();
    await expect(page.getByTestId('chat-composer-input')).toHaveValue('U5 restore draft');
    await page.screenshot({ path: testInfo.outputPath('checkpoint-owner-readback.png') });
    evidence.project = project; evidence.status = 'passed';
  } catch (error) { evidence.status = 'failed'; evidence.error = String(error); throw error; }
  finally {
    evidence.remainingFault = await removeFault(app).catch(String);
    await captureUi(name => testInfo.outputPath(name)).catch(String);
    await writeFile(testInfo.outputPath('u5-checkpoint.json'), JSON.stringify(evidence, null, 2));
    await hostInvoke(app, 'gateway', 'stop').catch(() => undefined); await closeElectronApp(app);
    llm.server.closeAllConnections(); await new Promise<void>(resolve => llm.server.close(() => resolve()));
  }
});
