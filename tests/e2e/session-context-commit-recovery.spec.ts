import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ElectronApplication, Page, TestInfo } from '@playwright/test';
import type { RawMessage } from '../../shared/chat/types';
import { getTranscriptEntryId } from '../../src/lib/session-read-model';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';
import { hostInvoke, startScriptedLlm } from './fixtures/fp-p1-harness';
import { configureSessionChainProvider, createSessionChainProject } from './fixtures/session-task-chain';
import { ensureContextOwnerCheckpoint } from './fixtures/session-context-owner-seed';

type Action = 'compact' | 'compactRange' | 'restoreCheckpoint';
type Captured = { action: Action; payload: Record<string, unknown>; ownerReply?: { ok?: boolean; data?: Record<string, unknown> };
  error?: string; dropped?: boolean; fileSha256?: string; completed?: boolean };
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const rpc = <T,>(app: ElectronApplication, method: string, params: Record<string, unknown>) =>
  hostInvoke<T>(app, 'gateway', 'rpc', { method, params, timeoutMs: 30_000 });
const summary = ['## Goal and Progress', 'U5_COMMIT_SUMMARY Preserve the committed context and its checkpoints.',
  '## Attempts and Failures', 'No product failures observed before this compaction.',
  '## Key Decisions and Constraints', 'Use original owners; retain U5_RANGE_TARGET and U5_RANGE_TAIL.',
  '## Current State', '### Done\n- Recorded discussion turns.\n### In Progress\n- Verify refresh after reply loss.\n### Blocked\n- None.',
  '## Key Decisions', '- Read current history; never automatically retry unknown compression.',
  '## Files Touched', '- None during discussion.', '## Tests', '- Agent-driven UI verification pending.',
  '## Next Actions', '- Refresh original history and checkpoint views.'].join('\n');

// 原 handler 完成后才抛传输错误。owner拒绝/no-op不改造成成功或“已提交丢包”。
async function installReplyLoss(app: ElectronApplication, sessionKey: string) {
  await app.evaluate((_electron, key) => {
    const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
    type Request = { id?: string; module?: string; action?: string; payload?: Record<string, unknown> };
    type Handler = (event: unknown, request: Request) => Promise<{ ok?: boolean; data?: Record<string, unknown> }>;
    const original = (ipcMain as unknown as { _invokeHandlers: Map<string, Handler> })._invokeHandlers.get('host:invoke')!;
    const state = { armed: null as null | { action: string; file?: string; expectedSha256?: string }, calls: [] as Array<Record<string, unknown>>,
      reads: [] as Request[], observedMutations: [] as Request[], restore: () => { ipcMain.removeHandler('host:invoke'); ipcMain.handle('host:invoke', original); } };
    (globalThis as unknown as { u5CommitLoss: typeof state }).u5CommitLoss = state;
    ipcMain.removeHandler('host:invoke');
    ipcMain.handle('host:invoke', async (event, request: Request) => {
      if (request.module === 'sessions' && ['compact', 'compactRange', 'restoreCheckpoint'].includes(request.action ?? ''))
        state.observedMutations.push(structuredClone(request));
      if (request.module !== 'sessions' || request.payload?.sessionKey !== key) return original(event, request);
      if (!['compact', 'compactRange', 'restoreCheckpoint'].includes(request.action ?? '')) { state.reads.push(structuredClone(request)); return original(event, request); }
      const row: Record<string, unknown> = { action: request.action, payload: structuredClone(request.payload), startedAt: Date.now() }; state.calls.push(row);
      try {
        const response = await original(event, request); row.ownerReply = structuredClone(response); row.completed = true; row.completedAt = Date.now();
        const armed = state.armed, success = response.ok === true && response.data?.success === true;
        if (armed && armed.action === request.action && success && (request.action === 'restoreCheckpoint' || response.data?.compacted === true)) {
          if (armed.file) {
            const fs = process.mainModule!.require('node:fs') as typeof import('node:fs');
            const crypto = process.mainModule!.require('node:crypto') as typeof import('node:crypto');
            row.fileSha256 = crypto.createHash('sha256').update(fs.readFileSync(armed.file)).digest('hex');
            if (row.fileSha256 !== armed.expectedSha256) throw new Error('U5_OWNER_REPLY_FILE_MISMATCH');
          }
          state.armed = null; row.dropped = true;
          throw new Error(`U5_POST_COMMIT_REPLY_LOSS:${request.action}`);
        }
        return response;
      } catch (error) { row.error = String(error); row.completed = true; throw error; }
    });
  }, sessionKey);
}
const observationErrors = new WeakMap<ElectronApplication, Array<{ at: number; error: string }>>();
async function faultRead(app: ElectronApplication) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await app.evaluate(() => {
        const s = (globalThis as unknown as { u5CommitLoss: { calls: Captured[]; reads: unknown[]; observedMutations: unknown[] } }).u5CommitLoss;
        return { calls: s.calls, reads: s.reads, observedMutations: s.observedMutations };
      });
    } catch (error) {
      if (attempt >= 3 || !String(error).includes('Execution context was destroyed')) throw error;
      const observations = observationErrors.get(app) ?? [];
      observations.push({ at: Date.now(), error: String(error) }); observationErrors.set(app, observations);
      await getStableWindow(app); await new Promise(resolve => setTimeout(resolve, 150));
    }
  }
}
const arm = (app: ElectronApplication, action: Action, file?: string, expectedSha256?: string) => app.evaluate((_electron, input) => {
  (globalThis as unknown as { u5CommitLoss: { armed: unknown } }).u5CommitLoss.armed = input;
}, { action, file, expectedSha256 });
async function dropped(app: ElectronApplication, action: Action) {
  await expect.poll(async () => (await faultRead(app)).calls.some(row => row.action === action && row.completed), { timeout: 150_000 }).toBe(true);
  const row = (await faultRead(app)).calls.find(row => row.action === action)!;
  expect(row, JSON.stringify(row)).toMatchObject({ dropped: true, ownerReply: { ok: true, data: { success: true } } }); return row;
}
async function readOwner(app: ElectronApplication, sessionKey: string) {
  const described = await rpc<{ session: { sessionId: string; hasActiveRun: boolean } }>(app, 'sessions.describe', { key: sessionKey });
  const history = await hostInvoke<{ success: boolean; messages: RawMessage[] }>(app, 'sessions', 'history',
    { sessionKey, expectedSessionGeneration: described.session.sessionId, limit: 100 });
  const compactions = await rpc<{ checkpoints: Array<{ checkpointId: string; summary?: string; firstKeptEntryId?: string; postCompaction?: { sessionFile?: string } }> }>(app,
    'sessions.compaction.list', { key: sessionKey, agentId: 'main' });
  const checkpoints = await hostInvoke<{ success: boolean; checkpoints: Array<{ id: string }> }>(app, 'sessions', 'resumeCheckpoints', { sessionKey, agentId: 'main', limit: 100 });
  const compactionHistory = await hostInvoke<{ success: boolean; entries: Array<{ id: string; timestamp: number; summary?: string }> }>(app,
    'sessions', 'compactionHistory', { sessionKey, agentId: 'main', limit: 100 });
  const compactionStatus = await hostInvoke<{ success: boolean; lastCompaction?: { id: string; timestamp: number } }>(app,
    'sessions', 'compactionStatus', { sessionKey, agentId: 'main' });
  const sessions = await rpc<{ sessions: Array<{ key: string; parentSessionKey?: string }> }>(app, 'sessions.list', {});
  expect(history.success).toBe(true); expect(checkpoints.success).toBe(true);
  expect(compactionHistory.success).toBe(true); expect(compactionStatus.success).toBe(true);
  return { described, history, compactions, checkpoints, compactionHistory, compactionStatus, sessionKeys: sessions.sessions.map(row => row.key).sort() };
}
async function send(app: ElectronApplication, project: { workspaceId: string; sessionKey: string }, message: string, key: string) {
  const result = await hostInvoke<{ success: boolean; result?: { runId: string } }>(app, 'chat', 'sendWithMedia',
    { workspaceId: project.workspaceId, sessionKey: project.sessionKey, message, idempotencyKey: key });
  expect(result.success).toBe(true); expect(result.result?.runId).toBeTruthy();
  await expect.poll(async () => (await rpc<{ status: string }>(app, 'agent.wait', { runId: result.result!.runId, timeoutMs: 1000 })).status, { timeout: 90_000 }).toBe('ok');
  await expect.poll(async () => (await rpc<{ session: { hasActiveRun: boolean } }>(app, 'sessions.describe', { key: project.sessionKey })).session.hasActiveRun, { timeout: 30_000 }).toBe(false);
  return result.result!.runId;
}
async function openCheckpoints(page: Page) {
  await page.getByTestId('chat-project-session-header').getByRole('button').nth(1).click(); await page.getByTestId('chat-session-checkpoints').click();
  await expect(page.getByTestId('chat-checkpoints-dialog')).toBeVisible();
}
async function finish(app: ElectronApplication, llm: Awaited<ReturnType<typeof startScriptedLlm>>, info: TestInfo, evidence: Record<string, unknown>) {
  evidence.fault = await faultRead(app).catch(String); evidence.providerLog = llm.log;
  evidence.observationErrors = observationErrors.get(app) ?? [];
  const page = await getStableWindow(app).catch(() => null);
  evidence.uiEvents = page ? await page.evaluate(() =>
    (window as unknown as { u5UiEvents?: unknown[] }).u5UiEvents ?? []).catch(String) : 'window closed';
  await writeFile(info.outputPath('context-commit.json'), JSON.stringify(evidence, null, 2));
  await app.evaluate(() => (globalThis as unknown as { u5CommitLoss?: { restore: () => void } }).u5CommitLoss?.restore()).catch(() => undefined);
  await page?.screenshot({ path: info.outputPath('final.png') }).catch(() => undefined);
  await hostInvoke(app, 'gateway', 'stop').catch(() => undefined); await closeElectronApp(app);
  llm.server.closeAllConnections(); await new Promise<void>(done => llm.server.close(() => done()));
}
function metadata() {
  const sourceHead = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true }).trim();
  expect(sourceHead).toBe(process.env.CLAWX_U5_CONTEXT_EXPECTED_HEAD);
  return { driven_by: 'agent', actor: 'playwright-u5-context-commit', requested_route: 'ccs-workbuddy/deepseek-v4.1-flash',
    requestmodel: 'ccs-workbuddy/deepseek-v4.1-flash', backend_identity: null, provider: 'local-scripted', status: 'running', sourceHead };
}

test('U5 compact and compactRange lose only committed replies; refresh reads current state without redispatch', async ({ launchElectronApp, homeDir }, info) => {
  test.skip(process.env.CLAWX_U5_CONTEXT_COMMIT !== '1', '主 agent 串行显式启动');
  test.setTimeout(420_000);
  const evidence: Record<string, unknown> = metadata();
  let summarizing = false;
  const llm = await startScriptedLlm(() => ({ text: summarizing ? summary : 'U5 discussion acknowledged. ' + 'Preserve the exact goal and current context. '.repeat(80) }));
  const app = await launchElectronApp({ skipSetup: true });
  try {
    await configureSessionChainProvider(app, llm.port); await hostInvoke(app, 'settings', 'set', { key: 'language', value: 'en' });
    // 显式隔离夹具设置，仅缩短保留尾部，不关闭原compaction审计或owner。
    const configPath = join(homeDir, '.openclaw', 'openclaw.json'), config = JSON.parse(await readFile(configPath, 'utf8'));
    config.agents ??= {}; config.agents.defaults ??= {}; config.agents.defaults.compaction = { ...config.agents.defaults.compaction, keepRecentTokens: 256 };
    await writeFile(configPath, JSON.stringify(config, null, 2)); evidence.fixture = { keepRecentTokens: 256, configPath };
    const project = await createSessionChainProject(app, info.outputPath('workspace'), 'U5 commit compact'); evidence.project = project;
    const locale = JSON.parse(await readFile('shared/i18n/locales/en/chat.json', 'utf8'));
    for (const action of ['compact', 'compactRange'] as const) {
      summarizing = false;
      for (let i = 0; i < 3; i++) await send(app, project, `U5_${action}_HEAD_${i}: discuss the current goal.`, `${action}-${i}`);
      if (action === 'compactRange') { await send(app, project, 'U5_RANGE_TARGET', 'range-target'); await send(app, project, 'U5_RANGE_TAIL', 'range-tail'); }
      const before = await readOwner(app, project.sessionKey), page = await getStableWindow(app); await page.reload();
      evidence[`${action}Before`] = before;
      await expect(page.getByTestId('chat-page')).toHaveAttribute('data-session-generation', before.described.session.sessionId, { timeout: 30_000 });
      await expect(page.getByText(action === 'compact' ? 'U5_compact_HEAD_2: discuss the current goal.' : 'U5_RANGE_TAIL', { exact: true })).toBeVisible({ timeout: 60_000 });
      await expect(page.getByTestId('chat-project-session-header')).toContainText('U5 commit compact');
      await expect(page.getByTestId('chat-startup-skeleton')).toHaveCount(0);
      await expect(page.getByTestId('chat-composer-input')).toBeEnabled({ timeout: 30_000 });
      if (action === 'compact') await installReplyLoss(app, project.sessionKey);
      const draft = action === 'compact' ? '' : `U5 unsent draft for ${action}`; await page.getByTestId('chat-composer-input').fill(draft);
      const boundary = action === 'compactRange' ? before.history.messages.findLast(row => JSON.stringify(row.content).includes('U5_RANGE_TARGET') && row.role === 'user') : undefined;
      const entryId = boundary ? getTranscriptEntryId(boundary) : null;
      summarizing = true; const providerBefore = llm.log.length; await arm(app, action);
      if (action === 'compact') {
        await page.getByTestId('chat-composer-input').fill('/compact');
        const option = page.getByTestId('chat-slash-command-option-compact');
        await expect(option).toContainText(/[\d.]+k?\s*\/\s*[\d.]+k?\s*tokens/);
        await option.focus(); await option.press('Enter');
        await expect(page.getByTestId('chat-compaction-dialog')).toBeVisible();
        await expect(page.getByTestId('chat-composer-input')).toHaveValue('');
        await page.getByTestId('chat-compaction-instructions').fill('Preserve U5_COMMIT_SUMMARY and exact context markers.');
        const window = await app.browserWindow(page);
        await window.evaluate(window => { window.show(); window.focus(); }); await window.dispose();
        await page.bringToFront();
        await page.evaluate(() => {
          const rows: unknown[] = []; (window as unknown as { u5UiEvents: unknown[] }).u5UiEvents = rows;
          for (const type of ['focusin', 'focusout', 'keydown', 'keyup', 'click']) document.addEventListener(type, event => {
            if (rows.length >= 100) return;
            const element = event.target as HTMLElement;
            rows.push({ type, time: Date.now(), target: element.getAttribute('data-testid'),
              key: event instanceof KeyboardEvent ? event.key : null, documentFocused: document.hasFocus(),
              active: document.activeElement?.getAttribute('data-testid'), disabled: element.getAttribute('disabled') });
          }, { capture: true });
        });
        const confirm = page.getByTestId('chat-compaction-confirm');
        await expect(confirm).toBeEnabled(); await confirm.focus(); await expect(confirm).toBeFocused();
        await confirm.press('Enter');
        await expect.poll(async () => (await faultRead(app)).calls.some(row => row.action === action)
          || await page.getByTestId('prompt-cache-risk-toast').isVisible(), { timeout: 30_000 }).toBe(true);
        if (await page.getByTestId('prompt-cache-risk-toast').isVisible())
          await page.getByTestId('prompt-cache-risk-toast').getByRole('button', { name: locale.composer.promptCacheGuard.continue, exact: true }).click();
      } else {
        expect(entryId).toBeTruthy(); const text = page.getByText('U5_RANGE_TARGET', { exact: true }); await text.hover();
        const window = await app.browserWindow(page);
        await window.evaluate(window => { window.show(); window.focus(); }); await window.dispose();
        await page.bringToFront();
        const select = page.locator('[id^="chat-message-"]').filter({ has: text }).getByTestId('chat-user-message-summarize-from');
        await expect(select).toBeEnabled(); await select.focus(); await expect(select).toBeFocused(); await select.press('Enter');
      }
      const lost = await dropped(app, action); expect(lost.ownerReply!.data!.compacted).toBe(true); expect(llm.log.length).toBeGreaterThan(providerBefore);
      expect(lost.payload.expectedSessionId).toBe(before.described.session.sessionId);
      await expect(page.getByText(new RegExp(`U5_POST_COMMIT_REPLY_LOSS:${action}`))).toBeVisible();
      await expect(page.getByTestId('chat-composer-input')).toHaveValue(draft);
      if (action === 'compact') {
        await expect(page.getByTestId('chat-compaction-instructions')).toHaveValue('Preserve U5_COMMIT_SUMMARY and exact context markers.');
        await expect(page.getByTestId('chat-compaction-dialog')).toBeVisible();
        await page.getByTestId('chat-compaction-dialog').getByRole('button', { name: locale.composer.compaction.cancel, exact: true }).click();
      }
      await page.getByTestId('chat-toolbar-refresh').click();
      await openCheckpoints(page); await page.getByTestId('chat-checkpoints-refresh').click();
      await expect(page.getByTestId('chat-checkpoints-dialog')).toHaveAttribute('aria-busy', 'false'); await page.getByTestId('chat-checkpoints-close').click();
      const after = await readOwner(app, project.sessionKey);
      const added = after.compactions.checkpoints.filter(row => !before.compactions.checkpoints.some(old => old.checkpointId === row.checkpointId));
      expect(added).toHaveLength(1); expect(added[0].summary).toContain('U5_COMMIT_SUMMARY'); expect(after.sessionKeys).toEqual(before.sessionKeys);
      const latest = added[0];
      expect(latest.postCompaction?.sessionFile, 'owner must expose the committed transcript').toBeTruthy();
      const transcriptBytes = await readFile(latest.postCompaction!.sessionFile!);
      expect(transcriptBytes.toString('utf8')).toContain('U5_COMMIT_SUMMARY');
      expect(after.compactionHistory.entries.find(row => row.id === latest.checkpointId)?.summary).toContain('U5_COMMIT_SUMMARY');
      expect(after.compactionStatus.lastCompaction?.id).toBe(latest.checkpointId);
      let visibleTime: string | null = null;
      if (action === 'compact') {
        await page.getByTestId('chat-composer-input').fill('/compact');
        const option = page.getByTestId('chat-slash-command-option-compact');
        await expect(option).toBeVisible(); await option.focus(); await option.press('Enter');
        await expect(page.getByTestId('chat-compaction-dialog')).toBeVisible();
        visibleTime = await page.evaluate(timestamp => new Intl.DateTimeFormat(undefined,
          { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(timestamp)), after.compactionStatus.lastCompaction!.timestamp);
        const statusRow = page.getByTestId('chat-compaction-dialog').getByText(locale.composer.compaction.lastCompaction, { exact: true }).locator('..');
        await expect(statusRow).toContainText(visibleTime); await expect(statusRow).not.toContainText(locale.composer.compaction.neverCompacted);
        await page.getByTestId('chat-compaction-dialog').getByRole('button', { name: locale.composer.compaction.cancel, exact: true }).click();
      }
      if (action === 'compactRange') {
        expect(lost.payload.fromLeafId).toBe(entryId); expect(added[0].firstKeptEntryId).toBe(entryId);
        await expect(page.getByText('U5_RANGE_TARGET', { exact: true })).toBeVisible(); await expect(page.getByText('U5_RANGE_TAIL', { exact: true })).toBeVisible();
      }
      await page.waitForTimeout(1000); const audit = await faultRead(app);
      expect(audit.calls.filter(row => row.action === action)).toHaveLength(1); await expect(page.getByTestId('chat-composer-input')).toHaveValue(draft);
      expect(audit.reads.some(request => (request as { action?: string }).action === 'resumeCheckpoints')).toBe(true);
      evidence[action] = { before, after, lost, transcriptSha256: sha(transcriptBytes), visibleLastCompaction: visibleTime, latestStateVisible: true, clientOperationIdConfirmed: false,
        statement: 'compact has no durable client operationId; current checkpoint/history only', automaticRedispatches: audit.calls.filter(row => row.action === action).length - 1, observationWindowAfterRefreshMs: 1000 };
      await page.screenshot({ path: info.outputPath(`${action}-readback.png`) });
    }
    expect(llm.anomalies).toEqual([]); evidence.status = 'passed';
  } catch (error) { evidence.status = 'failed'; evidence.error = String(error); throw error; }
  finally { await finish(app, llm, info, evidence); }
});

test('U5 real journal checkpoint restore changes v2 to v1 despite reply loss and retains generation', async ({ launchElectronApp, userDataDir }, info) => {
  test.skip(process.env.CLAWX_U5_CONTEXT_COMMIT !== '1', '主 agent 串行显式启动');
  test.setTimeout(420_000); const target = info.outputPath('workspace', 'result.txt');
  const evidence: Record<string, unknown> = metadata();
  const llm = await startScriptedLlm((text, results) => {
    if (!results.u5taskstart) return { toolCall: { id: 'u5taskstart', name: 'task_control', args: { action: 'start', requestId: 'u5taskstart',
      contract: { objective: 'Verify recovery of the journaled file', target: 'result.txt', constraints: ['Preserve the restore checkpoint'],
        acceptance: [{ id: 'restored', description: 'The recovered file contains v1', verification: { kind: 'file-sha256', path: 'result.txt', sha256: sha('v1\n') } }] } } } };
    const version = text.lastIndexOf('U5_WRITE_V2') > text.lastIndexOf('U5_WRITE_V1') ? 'v2' : 'v1';
    const id = `u5commitwrite${version}`;
    if (version === 'v2' && !results['u5commitreadv1']) return { toolCall: { id: 'u5commitreadv1', name: 'read', args: { path: target } } };
    if (!results[id]) return { toolCall: { id, name: 'write', args: { path: target, content: `${version}\n` } } };
    return { text: `U5_${version}_DONE` };
  });
  const app = await launchElectronApp({ skipSetup: true });
  try {
    await configureSessionChainProvider(app, llm.port); await hostInvoke(app, 'settings', 'set', { key: 'language', value: 'en' });
    const project = await createSessionChainProject(app, info.outputPath('workspace'), 'U5 commit restore'); evidence.project = project;
    const runV1 = await send(app, project, 'U5_WRITE_V1', 'write-v1'); expect(await readFile(target, 'utf8')).toBe('v1\n');
    const first = await readOwner(app, project.sessionKey), generation = first.described.session.sessionId;
    const seed = await ensureContextOwnerCheckpoint(app, { ...project, workspaceRoot: project.rootPath, userDataDir, generation, runId: runV1 }); evidence.seed = seed;
    await send(app, project, 'U5_WRITE_V2', 'write-v2'); expect(await readFile(target, 'utf8')).toBe('v2\n');
    const { getOrCreateWriteJournal, __resetWriteJournals } = await import('../../openclaw_runtime/src/agents/tools/write-journal-core');
    __resetWriteJournals(); const journalV2 = getOrCreateWriteJournal(project.rootPath, generation);
    const writeV2 = journalV2.entries.find(row => row.lineage?.requestId === 'u5commitwritev2');
    expect(writeV2?.seq).toBeGreaterThan(seed.journal.seq); expect(await readFile(writeV2!.snapshotPath, 'utf8')).toBe('v1\n');
    evidence.writeJournal = { entries: journalV2.entries, v2PreimageSha256: sha(await readFile(writeV2!.snapshotPath)),
      v2MetaSha256: sha(await readFile(`${writeV2!.snapshotPath}.meta.json`)), v2FileSha256: sha(await readFile(target)) };
    const diffBefore = await hostInvoke<{ success: boolean; files: Array<{ filePath: string; unifiedDiff: string }> }>(app, 'sessions', 'checkpointDiff',
      { sessionKey: project.sessionKey, agentId: 'main', checkpointId: seed.record.id });
    expect(diffBefore.success).toBe(true); expect(diffBefore.files.some(file => file.filePath === 'result.txt' && file.unifiedDiff.includes('v1') && file.unifiedDiff.includes('v2'))).toBe(true);
    const stale = await hostInvoke<{ success: boolean; error?: string }>(app, 'sessions', 'restoreCheckpoint', { sessionKey: project.sessionKey, agentId: 'main', checkpointId: seed.record.id,
      expectedSessionId: `stale-${generation}` }).then(value => ({ result: value }), error => ({ error: String(error) }));
    expect('error' in stale || stale.result.success === false).toBe(true);
    expect(JSON.stringify(stale)).toMatch(/generation/i); expect(await readFile(target, 'utf8')).toBe('v2\n');
    const refusalDiff = await hostInvoke(app, 'sessions', 'checkpointDiff', { sessionKey: project.sessionKey, agentId: 'main', checkpointId: seed.record.id });
    expect(refusalDiff).toEqual(diffBefore); evidence.staleOwnerRefusal = { stale, refusalDiff, fileSha256: sha(await readFile(target)) };
    const before = await readOwner(app, project.sessionKey); evidence.restoreBefore = before; await installReplyLoss(app, project.sessionKey);
    await arm(app, 'restoreCheckpoint', target, sha('v1\n'));
    const page = await getStableWindow(app); await page.reload(); await expect(page.getByTestId('chat-composer-input')).toBeEnabled({ timeout: 30_000 });
    await page.getByTestId('chat-composer-input').fill('U5 retained restore draft'); await openCheckpoints(page);
    await page.getByTestId(`chat-checkpoint-restore-${seed.record.id}`).click(); const lost = await dropped(app, 'restoreCheckpoint');
    expect(lost.ownerReply!.data!.mode).toBe('legacy_checkpoint_fallback'); expect(lost.fileSha256).toBe(sha('v1\n'));
    expect(lost.payload).toMatchObject({ checkpointId: seed.record.id, expectedSessionId: generation });
    await expect(page.getByTestId('chat-checkpoints-error')).toContainText('U5_POST_COMMIT_REPLY_LOSS:restoreCheckpoint');
    await expect(page.getByTestId('chat-checkpoints-restored')).toHaveCount(0);
    await page.getByTestId('chat-checkpoints-refresh').click(); await expect(page.getByTestId('chat-checkpoints-dialog')).toHaveAttribute('aria-busy', 'false');
    await page.getByTestId(`chat-checkpoint-diff-${seed.record.id}`).click();
    const locale = JSON.parse(await readFile('shared/i18n/locales/en/chat.json', 'utf8'));
    await expect(page.getByTestId(`chat-checkpoint-diff-panel-${seed.record.id}`)).toContainText(locale.filePreview.checkpoints.diffEmpty);
    const after = await readOwner(app, project.sessionKey);
    const diffAfter = await hostInvoke<{ success: boolean; files: unknown[]; errors: string[] }>(app, 'sessions', 'checkpointDiff',
      { sessionKey: project.sessionKey, agentId: 'main', checkpointId: seed.record.id });
    expect(diffAfter).toMatchObject({ success: true, files: [], errors: [] });
    expect(after.described.session.sessionId).toBe(generation); expect(after.sessionKeys).toEqual(before.sessionKeys);
    expect(after.checkpoints.checkpoints.some(row => row.id === seed.record.id)).toBe(true); expect(await readFile(target, 'utf8')).toBe('v1\n');
    await page.getByTestId('chat-checkpoints-close').click(); await page.getByTestId('chat-toolbar-refresh').click(); await page.waitForTimeout(1000);
    await expect(page.getByTestId('chat-composer-input')).toHaveValue('U5 retained restore draft');
    const translations: Array<{ language: string; title: string; emptyDiff: string }> = [];
    evidence.restore = { before, after, lost, diffBefore, diffAfter, restoredFileSha256: sha(await readFile(target)), source: seed.source, translations };
    await writeFile(info.outputPath('context-commit.json'), JSON.stringify(evidence, null, 2));
    for (const language of ['en', 'zh', 'ja', 'ru'] as const) {
      await hostInvoke(app, 'settings', 'set', { key: 'language', value: language });
      await page.reload(); await expect(page.getByTestId('chat-composer-input')).toBeEnabled();
      await expect(page.getByTestId('chat-page')).toHaveAttribute('data-session-generation', generation, { timeout: 30_000 });
      await openCheckpoints(page);
      const messages = JSON.parse(await readFile(`shared/i18n/locales/${language}/chat.json`, 'utf8')).filePreview.checkpoints;
      await expect(page.getByTestId('chat-checkpoints-dialog')).toContainText(messages.title);
      await expect(page.getByTestId(`chat-checkpoint-restore-${seed.record.id}`)).toBeEnabled();
      await page.getByTestId(`chat-checkpoint-diff-${seed.record.id}`).click();
      await expect(page.getByTestId(`chat-checkpoint-diff-panel-${seed.record.id}`)).toContainText(messages.diffEmpty);
      const dialog = page.getByTestId('chat-checkpoints-dialog');
      const layout = await dialog.evaluate(element => {
        const box = element.getBoundingClientRect();
        const title = element.querySelector('[data-testid="chat-checkpoints-title"]')!.getBoundingClientRect();
        const description = element.querySelector('[data-testid="chat-checkpoints-description"]')!.getBoundingClientRect();
        return { width: box.width, background: getComputedStyle(element).backgroundColor,
          titleBottom: title.bottom, descriptionTop: description.top, overflow: element.scrollWidth > element.clientWidth };
      });
      expect(layout.background).not.toBe('rgba(0, 0, 0, 0)'); expect(layout.width).toBeLessThanOrEqual(512);
      expect(layout.descriptionTop).toBeGreaterThanOrEqual(layout.titleBottom); expect(layout.overflow).toBe(false);
      translations.push({ language, title: messages.title, emptyDiff: messages.diffEmpty });
      await writeFile(info.outputPath('context-commit.json'), JSON.stringify(evidence, null, 2));
      await page.screenshot({ path: info.outputPath(`checkpoint-restored-${language}.png`) });
      await page.getByTestId('chat-checkpoints-close').click();
      await expect(page.getByTestId('chat-composer-input')).toHaveValue('U5 retained restore draft');
    }
    const audit = await faultRead(app); expect(audit.calls).toHaveLength(1);
    evidence.restore = { before, after, lost, diffBefore, diffAfter, restoredFileSha256: sha(await readFile(target)),
      source: seed.source, translations, naturalProductCheckpoint: seed.source === 'existing-runtime-checkpoint', automaticRedispatches: audit.calls.length - 1, clientOperationIdConfirmed: false };
    expect(llm.anomalies).toEqual([]); evidence.status = 'passed';
  } catch (error) { evidence.status = 'failed'; evidence.error = String(error); throw error; }
  finally { await finish(app, llm, info, evidence); }
});
