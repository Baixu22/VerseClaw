import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

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
      await expect(page.getByTestId('comment-anchor-state')).toHaveText('Live anchor');
    }
    fixtures[listKey] = { success: true, storeState: 'available', comments: [{ comment, anchorState: 'stale', anchorIssues: [] }] };
    await installIpcMocks(app, { hostApi: fixtures });
    await page.getByTestId('comments-refresh').click();
    await expect(page.getByTestId('comment-anchor-state')).toHaveText('Stale anchor');
    await expect(page.getByTestId('review-comment')).toContainText('src/example.ts:1–1');
    await expect(page.getByTestId('comment-reanchor')).toBeVisible();
    await page.getByTestId('change-context').screenshot({ path: testInfo.outputPath('anchor-stale.png') });
    await page.getByTestId('change-context-toggle').click();
    await expect(page.getByTestId('change-context-projection')).toHaveCount(0);
  } finally { await closeElectronApp(app); }
});
