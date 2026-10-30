import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';
import { hostInvoke } from './fixtures/fp-p1-harness';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { WorkspaceSnapshot } from '@shared/types/workspace';
import type { TaskLedgerSnapshot } from '@shared/types/task-ledger';
import type { ChangeContextPullChangesResult, ChangeContextReviewCommentListResult } from '@shared/types/change-context';

// Real Electron renderer/IPC with deterministic read-model replay. Backend owner
// integration and zero-write controls are tested separately; no live provider claim.
function stable(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => `${JSON.stringify(key)}:${stable(entry)}`).join(',')}}`;
}

test('opt-in context comparisons and visible comment freshness never move an anchor', async ({ launchElectronApp }, testInfo) => {
  const app = await launchElectronApp({ skipSetup: true });
  try {
    const sessionKey = 'agent:main:main';
    const workspace = { id: 'workspace-1', name: 'Review fixture', rootPath: '/workspace/demo', permissionMode: 'acceptEdits', activeSessionKey: sessionKey, state: {}, sessionStates: {} };
    const contextId = 'context-fixture';
    const identity = { workspaceId: workspace.id, sessionKey };
    const anchor = { path: 'src/example.ts', range: { startLine: 1, endLine: 1 }, fileDigest: 'sha256:file', rangeDigest: 'sha256:range', baseRevision: null, candidateRevision: null, originalExcerpt: 'before' };
    const comment = { id: 'comment-1', schemaVersion: 1, ...identity, contextId, body: 'Keep this anchored', author: { id: 'agent:fixture', kind: 'agent', drivenBy: 'agent' }, anchor, createdAt: '2026-10-30T00:00:00Z', updatedAt: '2026-10-30T00:00:00Z', resolvedAt: null, deletedAt: null, deletionReason: null, reanchorCount: 0 };
    const fixtures: Record<string, unknown> = {
      [stable(['workspaces', 'list', null])]: { profiles: [workspace], activeWorkspaceId: workspace.id, activeWorkspace: workspace },
      [stable(['workspaces', 'getActive', null])]: { activeWorkspaceId: workspace.id, activeWorkspace: workspace },
      [stable(['git', 'branches', null])]: { success: true, branches: [] },
    };
    for (const comparison of [{ mode: 'merge-base', baseRef: 'base' }, { mode: 'last-commit', commit: 'base' }, { mode: 'last-turn' }, { mode: 'checkpoint', checkpointId: 'base' }]) {
      fixtures[stable(['changeContext', 'getProjection', { ...identity, comparison }])] = { success: true, projection: {
        schemaVersion: 1, contextId, identity: { ...identity, runId: 'fixture-run', turn: null },
        comparison: { mode: comparison.mode, state: 'available', base: null, candidate: null, resolvedAt: '2026-10-30T00:00:00Z', issues: [] },
        diff: { state: 'available', files: [{ path: anchor.path }], patchArtifacts: [], stats: null, truncated: false, issues: [] }, comments: [], evidence: [], issues: [], generatedAt: '2026-10-30T00:00:00Z',
      } };
    }
    const listKey = stable(['changeContext', 'listComments', { ...identity, contextId }]);
    fixtures[listKey] = { success: true, storeState: 'available', comments: [{ comment, anchorState: 'live', anchorIssues: [] }] };
    await installIpcMocks(app, { gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true }, hostApi: fixtures });
    const page = await getStableWindow(app);
    await page.reload();
    await expect(page.getByTestId('main-layout')).toBeVisible();
    await page.getByTestId('sidebar-footer-menu-trigger').click();
    await page.getByTestId('sidebar-more-code-review').click();
    await expect(page.getByTestId('change-context-toggle')).toBeVisible();
    await expect(page.getByTestId('change-context-load')).toHaveCount(0);
    await page.getByTestId('change-context-toggle').click();
    await page.getByTestId('change-context-session').fill(sessionKey);
    for (const mode of ['merge-base', 'last-commit', 'last-turn', 'checkpoint']) {
      await page.getByTestId('change-context-mode').selectOption(mode);
      if (mode !== 'last-turn') await page.getByTestId('change-context-revision').fill('base');
      await page.getByTestId('change-context-load').click();
      await page.getByTestId('comment-anchor-state').scrollIntoViewIfNeeded();
      await expect(page.getByTestId('comment-anchor-state')).toHaveText('Live anchor');
      await expect(page.getByTestId('comment-anchor-state')).toBeVisible();
    }
    fixtures[listKey] = { success: true, storeState: 'available', comments: [{ comment, anchorState: 'stale', anchorIssues: [] }] };
    await installIpcMocks(app, { hostApi: fixtures });
    await page.getByTestId('comments-refresh').click();
    await page.getByTestId('comment-anchor-state').scrollIntoViewIfNeeded();
    await expect(page.getByTestId('comment-anchor-state')).toHaveText('Stale anchor');
    await expect(page.getByTestId('comment-anchor-state')).toBeVisible();
    await expect(page.getByTestId('review-comment')).toContainText('src/example.ts:1–1');
    await expect(page.getByTestId('comment-reanchor')).toBeVisible();
    await page.getByTestId('review-comment').screenshot({ path: testInfo.outputPath('anchor-stale.png') });
    await page.getByTestId('change-context-toggle').click();
    await expect(page.getByTestId('change-context-projection')).toHaveCount(0);
    for (const [language, label] of [['en', 'Stale anchor'], ['zh', '锚点已过期'], ['ja', 'アンカー期限切れ'], ['ru', 'Якорь устарел']]) {
      await hostInvoke(app, 'settings', 'set', { key: 'language', value: language });
      await page.reload(); await expect(page.getByTestId('main-layout')).toBeVisible();
      await page.getByTestId('sidebar-footer-menu-trigger').click(); await page.getByTestId('sidebar-more-code-review').click();
      await page.getByTestId('change-context-toggle').click(); await page.getByTestId('change-context-session').fill(sessionKey);
      await page.getByTestId('change-context-revision').fill('base'); await page.getByTestId('change-context-load').click();
      await page.getByTestId('comment-anchor-state').scrollIntoViewIfNeeded();
      await expect(page.getByTestId('comment-anchor-state')).toHaveText(label); await expect(page.getByTestId('comment-anchor-state')).toBeVisible();
      await page.getByTestId('review-comment').screenshot({ path: testInfo.outputPath(`anchor-${language}.png`) });
    }
  } finally { await closeElectronApp(app); }
});

for (const vgEnabled of [false, true]) {
test(`real Main owners bind comments, verdicts and approved journaled apply (VG ${vgEnabled ? 'opt-in' : 'off'})`, async ({ launchElectronApp, homeDir }, testInfo) => {
  const root = join(homeDir, 'review-workspace');
  await mkdir(root, { recursive: true });
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, windowsHide: true, encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_DATE: '2026-10-30T00:00:00Z', GIT_COMMITTER_DATE: '2026-10-30T00:00:00Z' } }).trim();
  git('init', '-q'); git('config', 'user.name', 'Agent Fixture'); git('config', 'user.email', 'fixture@example.invalid');
  git('config', 'core.autocrlf', 'false'); git('config', 'core.eol', 'lf');
  const file = join(root, 'example.txt');
  // Host-owned metadata is intentionally outside this fixture's code changes.
  // The production collector still reports unavailable user sources as partial.
  await writeFile(join(root, '.gitignore'), '.verse-claw/\n.openclaw/\n');
  await writeFile(file, 'before\n'); git('add', '.gitignore', 'example.txt'); git('commit', '-qm', 'base');
  const base = git('rev-parse', 'HEAD');
  await writeFile(file, 'after\n'); git('add', 'example.txt');
  execFileSync('git', ['commit', '-qm', 'candidate'], { cwd: root, windowsHide: true,
    env: { ...process.env, GIT_AUTHOR_DATE: '2026-10-30T00:02:00Z', GIT_COMMITTER_DATE: '2026-10-30T00:02:00Z' } });
  const candidate = git('rev-parse', 'HEAD'); const patch = git('diff', base, candidate, '--', 'example.txt');
  const app = await launchElectronApp({ skipSetup: true, env: { CLAWX_VERSGIT_BINDING_ENABLED: vgEnabled ? '1' : '0' } });
  const sessionKey = 'agent:main:main';
  try {
    const page = await getStableWindow(app);
    await expect(page.getByTestId('main-layout')).toBeVisible();
    // Only runtime turn/checkpoint facts are scripted. All Change Context,
    // files, Git, permission, journal, comment and Task Ledger owners stay real.
    await app.evaluate((_electron, fixture) => {
      const main = process.mainModule!.require(fixture.entry) as { gatewayManager: { rpc: (method: string, params?: Record<string, unknown>) => Promise<unknown> } };
      main.gatewayManager.rpc = async (method, params) => {
        if (method === 'chat.history') return { messages: [
          { id: 'turn-user', role: 'user', content: 'Agent fixture change', timestamp: Date.parse('2026-10-30T00:01:00Z'), __openclaw: { seq: 1 } },
          { id: 'turn-assistant', role: 'assistant', content: 'Applied fixture change', timestamp: Date.parse('2026-10-30T00:02:00Z'), __openclaw: { seq: 2 }, details: { runId: 'fixture-run', turnId: 'fixture-turn', attemptIndex: 0, modelCallIndex: 1 } },
        ] };
        if (method === 'sessions.list') return { sessions: [{ key: fixture.sessionKey, displayName: 'Agent fixture' }] };
        if (method === 'sessions.checkpointDiff') return params?.checkpointId === 'fixture-checkpoint'
          ? { ok: true, key: fixture.sessionKey, checkpointId: params.checkpointId, files: [{ filePath: 'example.txt', status: 'modified', unifiedDiff: fixture.patch + '\n' }], errors: [] }
          : { ok: false, error: 'Fixture checkpoint unavailable' };
        throw new Error(`Fixture runtime source unavailable: ${method}`);
      };
      const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
      type Request = { module: string; action: string; payload?: Record<string, unknown> };
      const handlers = ipcMain as unknown as { _invokeHandlers: Map<string, (event: unknown, request: Request) => Promise<unknown>> };
      const original = handlers._invokeHandlers.get('host:invoke')!;
      const calls: Array<{ module: string; action: string; payload?: unknown; reply: unknown }> = [];
      (globalThis as unknown as { __changeContextRelayCalls: typeof calls }).__changeContextRelayCalls = calls;
      ipcMain.removeHandler('host:invoke');
      ipcMain.handle('host:invoke', async (event, request: Request) => {
        if (request.module === 'changeContext' && request.payload?.author) {
          request = { ...request, payload: { ...request.payload, author: { id: 'agent:electron-e2e', kind: 'agent', drivenBy: 'agent' } } };
        }
        const reply = await original(event, request);
        if (['changeContext', 'permissions', 'taskLedger', 'versegit'].includes(request.module)) calls.push({ ...request, reply });
        return reply;
      });
    }, { entry: join(process.cwd(), 'dist-electron/main/index.js'), sessionKey, patch });
    const created = await hostInvoke<WorkspaceSnapshot>(app, 'workspaces', 'create', { name: 'Review owner acceptance', rootPath: root, agentId: 'main', activeSessionKey: sessionKey, permissionMode: 'acceptEdits' });
    const workspaceId = created.activeWorkspaceId!;
    await installIpcMocks(app, { gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true } });
    await page.reload();
    await expect(page.getByTestId('main-layout')).toBeVisible();
    await page.getByTestId('sidebar-footer-menu-trigger').click(); await page.getByTestId('sidebar-more-code-review').click();
    expect(await app.evaluate(() => (globalThis as unknown as { __changeContextRelayCalls: Array<{ module: string }> }).__changeContextRelayCalls.filter((call) => call.module === 'changeContext').length)).toBe(0);
    await page.getByTestId('change-context-toggle').click(); await page.getByTestId('change-context-session').fill(sessionKey);
    const comparisons: Record<string, string> = { 'merge-base': base, 'last-commit': candidate, 'last-turn': '', checkpoint: 'fixture-checkpoint' };
    for (const [mode, revision] of Object.entries(comparisons)) {
      await page.getByTestId('change-context-mode').selectOption(mode);
      if (revision) await page.getByTestId('change-context-revision').fill(revision);
      await page.getByTestId('change-context-load').click();
      try { await expect(page.getByTestId('change-context-state')).toHaveText('Available'); }
      catch (error) {
        const calls = await app.evaluate(() => (globalThis as unknown as { __changeContextRelayCalls: unknown[] }).__changeContextRelayCalls);
        await writeFile(testInfo.outputPath(`projection-${mode}.json`), JSON.stringify(calls, null, 2));
        throw new Error(`${mode}: ${String(error)}; calls=${JSON.stringify(calls.at(-1))}`, { cause: error });
      }
      await expect(page.getByTestId('change-context-error')).toHaveCount(0);
    }
    await page.getByTestId('change-context-revision').fill('missing-checkpoint'); await page.getByTestId('change-context-load').click();
    await expect(page.getByTestId('change-context-error')).toBeVisible();
    await expect(page.getByTestId('change-context-state')).toHaveText('Unavailable');
    await page.getByTestId('change-context-mode').selectOption('last-commit'); await page.getByTestId('change-context-revision').fill(candidate);
    await page.getByTestId('change-context-load').click(); await expect(page.getByTestId('change-context-state')).toHaveText('Available');
    await expect(page.getByTestId('change-context-vg-evidence')).toHaveCount(vgEnabled ? 2 : 0);
    if (vgEnabled) {
      await expect(page.getByTestId('change-context-vg-evidence').last()).toContainText('Unmeasured execution');
      await expect(page.getByTestId('change-context-vg-evidence').last()).toContainText('host verdict unchanged');
    }
    await page.getByTestId('comment-path').fill('example.txt'); await page.getByTestId('comment-body').fill('Agent-driven anchor acceptance');
    await page.getByTestId('comment-create').click();
    await page.getByTestId('comment-anchor-state').scrollIntoViewIfNeeded(); await expect(page.getByTestId('comment-anchor-state')).toHaveText('Live anchor');
    await writeFile(file, 'changed after review\n');
    await page.getByTestId('comments-refresh').click(); await page.getByTestId('comment-anchor-state').scrollIntoViewIfNeeded();
    await expect(page.getByTestId('comment-anchor-state')).toHaveText('Stale anchor'); await expect(page.getByTestId('comment-anchor-state')).toBeVisible();
    await expect(page.getByTestId('review-comment')).toContainText('example.txt:1–1');
    await page.getByTestId('review-comment').screenshot({ path: testInfo.outputPath('real-anchor-stale.png') });
    await page.getByTestId('comment-reanchor').click(); await expect(page.getByTestId('comment-anchor-state')).toHaveText('Live anchor');
    const initial = await hostInvoke<{ snapshot: TaskLedgerSnapshot }>(app, 'taskLedger', 'snapshot', { workspaceId });
    await page.getByTestId('review-verdict-request_changes').click(); await expect(page.getByTestId('review-verdict-result')).toContainText('Request changes');
    const before = await hostInvoke<{ snapshot: TaskLedgerSnapshot }>(app, 'taskLedger', 'snapshot', { workspaceId });
    expect(before.snapshot.nodes).toHaveLength(initial.snapshot.nodes.length + 1);
    const reviewNodes = before.snapshot.nodes.filter((node) => node.metadata?.source === 'change-context');
    expect(reviewNodes).toHaveLength(1); expect(reviewNodes[0].completedAt).toBeNull(); expect(reviewNodes[0].status).toBe('todo');
    await page.getByTestId('review-verdict-approve').click(); await expect(page.getByTestId('review-verdict-result')).toHaveText('Approve');
    const after = await hostInvoke<{ snapshot: TaskLedgerSnapshot }>(app, 'taskLedger', 'snapshot', { workspaceId });
    expect(after.snapshot.nodes).toEqual(before.snapshot.nodes);
    await page.getByTestId('pull-head').fill('f'.repeat(40)); await page.getByTestId('pull-changes').click();
    await expect(page.getByTestId('pull-state')).toHaveText('Stale'); expect(await readFile(file, 'utf8')).toBe('changed after review\n');
    await page.getByTestId('pull-head').fill(candidate); await page.getByTestId('pull-changes').click();
    await expect(page.getByTestId('pull-state')).toHaveText('Conflicted'); expect(await readFile(file, 'utf8')).toBe('changed after review\n');
    await writeFile(file, 'after\n'); git('checkout', '--detach', base);
    await page.getByTestId('pull-head').fill(base); await page.getByTestId('pull-changes').click(); await expect(page.getByTestId('pull-state')).toHaveText('Denied');
    expect(await readFile(file, 'utf8')).toBe('before\n');
    const calls = await app.evaluate(() => (globalThis as unknown as { __changeContextRelayCalls: Array<{ module: string; action: string; reply: { data?: ChangeContextPullChangesResult } }> }).__changeContextRelayCalls);
    const denied = calls.filter((call) => call.module === 'changeContext' && call.action === 'pullChanges').at(-1)!.reply.data!;
    if (denied.success) throw new Error('Expected real approval request');
    const approvalId = (denied.error.details?.approval as { id: string }).id;
    await hostInvoke(app, 'permissions', 'decideApproval', { id: approvalId, decision: 'approved' });
    await page.getByTestId('pull-approval').fill(approvalId); await page.getByTestId('pull-changes').click(); await expect(page.getByTestId('pull-state')).toHaveText('Applied');
    expect(await readFile(file, 'utf8')).toBe('after\n'); expect(git('rev-parse', 'HEAD')).toBe(base);
    const finalCalls = await app.evaluate(() => (globalThis as unknown as { __changeContextRelayCalls: unknown[] }).__changeContextRelayCalls);
    const applied = (finalCalls as typeof calls).filter((call) => call.module === 'changeContext' && call.action === 'pullChanges').at(-1)!.reply.data!;
    expect(applied.success).toBe(true);
    if (!applied.success) throw new Error('Expected owner-backed apply receipt');
    const [, journalSession, seq] = applied.receipt.writeJournalId.split(':');
    const preimage = join(root, '.openclaw', 'journal', journalSession, `${seq.padStart(4, '0')}-example.txt.pre`);
    expect(await readFile(preimage, 'utf8')).toBe('before\n');
    expect(JSON.parse(await readFile(`${preimage}.meta.json`, 'utf8')).batch.state).toBe('committed');
    const commentsCall = (finalCalls as typeof calls).filter((call) => call.module === 'changeContext' && call.action === 'getProjection').find((call) => (call as unknown as { payload: { comparison: { mode: string } } }).payload.comparison.mode === 'last-commit');
    const contextId = (commentsCall?.reply.data as unknown as { projection: { contextId: string } }).projection.contextId;
    const comments = await hostInvoke<ChangeContextReviewCommentListResult>(app, 'changeContext', 'listComments', { workspaceId, sessionKey, contextId });
    expect(comments.comments[0].comment.reanchorCount).toBe(1); expect(comments.comments[0].comment.author).toMatchObject({ kind: 'agent', drivenBy: 'agent' });
    await page.getByTestId('pull-state').scrollIntoViewIfNeeded(); await page.screenshot({ path: testInfo.outputPath('real-review-final.png') });
    const countBeforeClose = await app.evaluate(() => (globalThis as unknown as { __changeContextRelayCalls: Array<{ module: string }> }).__changeContextRelayCalls.filter((call) => call.module === 'changeContext').length);
    await page.getByTestId('change-context-toggle').click(); await expect(page.getByTestId('change-context-load')).toHaveCount(0);
    await page.getByTestId('code-review-focus').fill('Feature gate rollback acceptance');
    const countAfterClose = await app.evaluate(() => (globalThis as unknown as { __changeContextRelayCalls: Array<{ module: string }> }).__changeContextRelayCalls.filter((call) => call.module === 'changeContext').length);
    expect(countAfterClose).toBe(countBeforeClose); expect(await readFile(file, 'utf8')).toBe('after\n');
    await page.reload(); await expect(page.getByTestId('main-layout')).toBeVisible();
    await page.getByTestId('sidebar-footer-menu-trigger').click(); await page.getByTestId('sidebar-more-code-review').click();
    await expect(page.getByTestId('change-context-load')).toHaveCount(0);
    const countAfterReload = await app.evaluate(() => (globalThis as unknown as { __changeContextRelayCalls: Array<{ module: string }> }).__changeContextRelayCalls.filter((call) => call.module === 'changeContext').length);
    expect(countAfterReload).toBe(countAfterClose);
    const retained = await hostInvoke<ChangeContextReviewCommentListResult>(app, 'changeContext', 'listComments', { workspaceId, sessionKey, contextId });
    expect(retained.comments.map((entry) => entry.comment)).toEqual(comments.comments.map((entry) => entry.comment));
    await writeFile(testInfo.outputPath('owner-flow.json'), JSON.stringify({ driven_by: 'agent', actor: 'codex', runtimeFacts: 'scripted history/checkpoint only', transportAnnotation: 'test IPC stamps agent actor', base, candidate, workspaceId, taskNode: after.snapshot.nodes.find((node) => node.id === reviewNodes[0].id), comments, calls: finalCalls,
      rollback: { countBeforeClose, countAfterClose, countAfterReload, commentsRetained: true, destinationPreserved: true } }, null, 2));
  } finally { await closeElectronApp(app); }
});
}
