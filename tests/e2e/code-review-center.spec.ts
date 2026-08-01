import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

const SESSION_KEY = 'agent:main:main';
const WORKSPACE_ID = 'workspace-1';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

const workspace = {
  id: WORKSPACE_ID,
  name: 'Demo Workspace',
  rootPath: '/workspace/demo',
  permissionMode: 'acceptEdits',
  activeSessionKey: SESSION_KEY,
  state: {},
  sessionStates: {},
};

const baseReview = {
  runId: 'code-review-base',
  readonly: true,
  status: 'completed',
  target: { kind: 'baseBranch', baseBranch: 'origin/main', label: 'origin/main', baseCommit: 'base', headCommit: 'head' },
  summary: 'Base branch review completed.',
  diffStats: { files: 1, additions: 3, deletions: 1, patchBytes: 120, truncated: false },
  patchArtifacts: [],
  findings: [
    {
      id: 'finding-base-1',
      severity: 'medium',
      file: 'src/base.ts',
      line: 12,
      reason: 'The branch diff is missing coverage for the changed branch.',
      suggestedFix: 'Add a focused regression test.',
    },
  ],
  evidenceRefs: [{ type: 'file', ref: 'src/base.ts', label: 'src/base.ts' }],
  startedAt: '2026-01-01T00:00:00.000Z',
  endedAt: '2026-01-01T00:00:01.000Z',
};

const uncommittedReview = {
  runId: 'code-review-uncommitted',
  readonly: true,
  status: 'completed',
  target: { kind: 'uncommitted', label: 'Uncommitted changes' },
  summary: 'Two findings in uncommitted changes.',
  diffStats: { files: 2, additions: 8, deletions: 2, patchBytes: 320, truncated: false },
  patchArtifacts: [],
  findings: [
    {
      id: 'finding-high',
      severity: 'high',
      file: 'src/main.ts',
      line: 42,
      reason: 'Renderer/Main boundary could be bypassed by this call.',
      suggestedFix: 'Route the call through the typed host API.',
    },
    {
      id: 'finding-low',
      severity: 'low',
      file: 'src/view.tsx',
      line: 7,
      reason: 'The label can be clearer for repeated review runs.',
      suggestedFix: 'Use the existing i18n copy for review targets.',
    },
  ],
  evidenceRefs: [
    { type: 'file', ref: 'src/main.ts', label: 'src/main.ts' },
    { type: 'file', ref: 'src/view.tsx', label: 'src/view.tsx' },
  ],
  startedAt: '2026-01-01T00:00:00.000Z',
  endedAt: '2026-01-01T00:00:01.000Z',
};

const truncatedReview = {
  runId: 'code-review-truncated',
  readonly: true,
  status: 'error',
  target: { kind: 'commit', commit: 'large123', label: 'large123', resolvedCommit: 'large123' },
  summary: 'Code review patch is truncated; model review is blocked.',
  diffStats: { files: 1, additions: 0, deletions: 0, patchBytes: 120_018, truncated: true },
  patchArtifacts: [],
  findings: [],
  evidenceRefs: [],
  startedAt: '2026-01-01T00:00:00.000Z',
  endedAt: '2026-01-01T00:00:01.000Z',
  error: 'Code review patch is truncated; model review is blocked.',
};

test.describe('Code Review Center', () => {
  test('opens review center, reviews two targets, displays findings, and preserves read-only behavior', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
        gatewayRpc: {
          [stableStringify(['sessions.list', {}])]: {
            success: true,
            result: { sessions: [{ key: SESSION_KEY, displayName: 'main' }] },
          },
          [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 200, maxChars: 500000 }])]: {
            success: true,
            result: { messages: [] },
          },
          [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 1000, maxChars: 500000 }])]: {
            success: true,
            result: { messages: [] },
          },
        },
        hostApi: {
          [stableStringify(['agents', 'list', null])]: {
            success: true,
            agents: [{
              id: 'main',
              name: 'Main',
              isDefault: true,
              workspace: '/workspace/demo',
              mainSessionKey: SESSION_KEY,
              channelTypes: [],
            }],
            defaultAgentId: 'main',
            configuredChannelTypes: [],
            channelOwners: {},
            channelAccountOwners: {},
          },
          [stableStringify(['workspaces', 'list', null])]: {
            profiles: [workspace],
            activeWorkspaceId: WORKSPACE_ID,
            activeWorkspace: workspace,
          },
          [stableStringify(['workspaces', 'getActive', null])]: {
            activeWorkspaceId: WORKSPACE_ID,
            activeWorkspace: workspace,
          },
          [stableStringify(['git', 'branches', null])]: {
            success: true,
            branches: [
              { name: 'feature/review', current: true, upstream: 'origin/feature/review', commit: 'head' },
              { name: 'origin/main', current: false, commit: 'base' },
            ],
          },
          [stableStringify(['codeReview', 'run', {
            focus: 'renderer/Main boundary',
            target: { kind: 'uncommitted' },
          }])]: {
            success: true,
            review: uncommittedReview,
          },
          [stableStringify(['codeReview', 'run', {
            focus: 'renderer/Main boundary',
            target: { kind: 'baseBranch', baseBranch: 'origin/main' },
          }])]: {
            success: true,
            review: baseReview,
          },
          [stableStringify(['codeReview', 'run', {
            focus: 'renderer/Main boundary',
            target: { kind: 'commit', commit: 'large123' },
          }])]: {
            success: false,
            error: truncatedReview.error,
            review: truncatedReview,
          },
          [stableStringify(['codeReview', 'createTaskLedgerNode', {
            runId: 'code-review-uncommitted',
            findingId: 'finding-high',
          }])]: {
            success: true,
            nodeId: 'review-node-1',
            snapshot: { nodes: [] },
          },
        },
      });

      const page = await getStableWindow(app);
      try {
        await page.reload();
      } catch (error) {
        if (!String(error).includes('ERR_FILE_NOT_FOUND')) throw error;
      }

      await expect(page.getByTestId('main-layout')).toBeVisible();
      await app.evaluate(() => {
        (globalThis as unknown as { __verseClawE2eHostCalls?: unknown[] }).__verseClawE2eHostCalls = [];
      });
      await page.getByTestId('sidebar-footer-menu-trigger').click();
      await page.getByTestId('sidebar-more-code-review').click();
      await expect(page.getByTestId('code-review-page')).toBeVisible();
      await expect(page.getByTestId('code-review-readonly')).toContainText('Read-only review');

      await page.getByTestId('code-review-target-baseBranch').click();
      await expect(page.getByTestId('code-review-base-input')).toBeVisible();
      await page.getByTestId('code-review-base-input').fill('origin/main');
      await page.getByTestId('code-review-focus').fill('renderer/Main boundary');

      await page.getByTestId('code-review-target-uncommitted').click();
      await page.getByTestId('code-review-run').click();

      await expect(page.getByTestId('code-review-summary')).toContainText('Two findings');
      const findings = page.getByTestId('code-review-finding');
      await expect(findings).toHaveCount(2);
      await expect(findings.first()).toContainText('High');
      await expect(findings.first()).toContainText('src/main.ts:42');
      await expect(findings.nth(1)).toContainText('Low');

      await page.getByTestId('code-review-create-finding-node-0').click();
      await expect(page.getByTestId('code-review-create-finding-node-0')).toContainText('Node created');

      await page.getByTestId('code-review-target-baseBranch').click();
      await page.getByTestId('code-review-run').click();
      await expect(page.getByTestId('code-review-target-label')).toContainText('origin/main');
      await expect(page.getByTestId('code-review-finding')).toHaveCount(1);

      await page.getByTestId('code-review-target-commit').click();
      await page.getByTestId('code-review-commit-input').fill('large123');
      await page.getByTestId('code-review-run').click();
      await expect(page.getByTestId('code-review-error')).toContainText(
        'The Git diff exceeded the review limit, so AI review was not started.',
      );

      const hostCalls = await app.evaluate(() => (
        globalThis as unknown as { __verseClawE2eHostCalls?: Array<{ module?: string; action?: string; payload?: unknown }> }
      ).__verseClawE2eHostCalls ?? []);
      expect(hostCalls).toEqual(expect.arrayContaining([
        expect.objectContaining({ module: 'codeReview', action: 'run' }),
        expect.objectContaining({ module: 'codeReview', action: 'createTaskLedgerNode' }),
      ]));
      const mutatingCalls = hostCalls.filter((call) => {
        if (call.module === 'git') {
          return ['stage', 'unstage', 'commit', 'revertFile', 'checkoutBranch', 'createBranch', 'stashPush', 'stashApply', 'stashPop', 'worktreeAdd', 'worktreeRemove', 'worktreePrune', 'fetch', 'pull', 'push', 'prCreate', 'openPr'].includes(call.action ?? '');
        }
        if (call.module === 'files') {
          return ['writeText', 'stagePaths', 'stageBuffer'].includes(call.action ?? '');
        }
        return false;
      });
      expect(mutatingCalls).toEqual([]);
    } finally {
      await closeElectronApp(app);
    }
  });
});
