import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';
import type { GitRepositoryStatus } from '../../shared/types/git';

const SESSION_KEY = 'agent:main:main';
const WORKSPACE_ID = 'workspace-composer-git';
const fixedTimestamp = 1_772_100_000_000;
const COMPOSER_APPROVAL_ID = 'approval-composer-inline';

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
  name: 'Composer Git Workspace',
  rootPath: '/workspace/demo',
  agentId: 'main',
  selectedAgentId: 'main',
  activeSessionKey: SESSION_KEY,
  permissionMode: 'acceptEdits',
  createdAt: fixedTimestamp,
  updatedAt: fixedTimestamp,
  lastOpenedAt: fixedTimestamp,
  agentBindings: {},
  state: {
    draftInput: 'draft before switch',
    artifactPanel: { open: false },
  },
  sessionStates: {
    [SESSION_KEY]: {
      draftInput: 'draft before switch',
      artifactPanel: { open: false },
    },
  },
};

const worktreeWorkspace = {
  ...workspace,
  id: 'workspace-demo-feature-existing',
  name: 'feature/existing',
  rootPath: '/workspace/demo-feature-existing',
  state: {},
  sessionStates: {},
};

const gitStatus: GitRepositoryStatus = {
  isRepository: true,
  workspaceRoot: '/workspace/demo',
  repoRoot: '/workspace/demo',
  branch: 'feature/current',
  upstream: 'origin/feature/current',
  ahead: 2,
  behind: 1,
  clean: false,
  detached: false,
  hasConflicts: false,
  stagedCount: 1,
  unstagedCount: 1,
  untrackedCount: 1,
  conflictedCount: 0,
  changes: [
    { path: 'src/app.ts', absolutePath: '/workspace/demo/src/app.ts', status: 'M ', staged: true, unstaged: false, untracked: false, conflicted: false, bucket: 'staged' },
    { path: 'README.md', absolutePath: '/workspace/demo/README.md', status: ' M', staged: false, unstaged: true, untracked: false, conflicted: false, bucket: 'unstaged' },
    { path: 'notes.txt', absolutePath: '/workspace/demo/notes.txt', status: '??', staged: false, unstaged: false, untracked: true, conflicted: false, bucket: 'untracked' },
  ],
};

const branches = [
  { name: 'feature/current', current: true, upstream: 'origin/feature/current', commit: 'abcdef1' },
  { name: 'main', current: false, upstream: 'origin/main', commit: '1234567' },
  { name: 'feature/existing', current: false, commit: '456789a' },
];

const worktrees = [
  { path: '/workspace/demo', branch: 'feature/current', head: 'abcdef123456' },
  { path: '/workspace/demo-feature-existing', branch: 'feature/existing', head: '456789abcdef', locked: true, prunable: true },
];

async function installComposerGitMocks(
  app: Parameters<typeof installIpcMocks>[0],
  messages: Array<Record<string, unknown>> = [],
) {
  await installIpcMocks(app, {
    gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
    gatewayRpc: {
      [stableStringify(['sessions.list', {}])]: {
        success: true,
        result: { sessions: [{ key: SESSION_KEY, displayName: 'main' }] },
      },
      [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 200, maxChars: 500000 }])]: {
        success: true,
        result: { messages },
      },
      [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 1000, maxChars: 500000 }])]: {
        success: true,
        result: { messages },
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
      [stableStringify(['/api/agents', 'GET'])]: {
        ok: true,
        data: {
          status: 200,
          ok: true,
          json: { success: true, agents: [{ id: 'main', name: 'Main', workspace: '/workspace/demo' }] },
        },
      },
      [stableStringify(['/api/gateway/status', 'GET'])]: {
        ok: true,
        data: { status: 200, ok: true, json: { state: 'running', port: 18789, pid: 12345 } },
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
      [stableStringify(['workspaces', 'create', {
        agentId: 'main',
        name: 'demo-feature-existing',
        rootPath: '/workspace/demo-feature-existing',
      }])]: {
        profiles: [workspace, worktreeWorkspace],
        activeWorkspaceId: worktreeWorkspace.id,
        activeWorkspace: worktreeWorkspace,
      },
      [stableStringify(['workspaces', 'switch', { id: 'workspace-demo-feature-existing' }])]: {
        activeWorkspaceId: worktreeWorkspace.id,
        activeWorkspace: worktreeWorkspace,
      },
      [stableStringify(['workspaces', 'saveState', null])]: { success: true },
      [stableStringify(['git', 'status', null])]: {
        success: true,
        status: gitStatus,
      },
      [stableStringify(['git', 'branches', null])]: {
        success: true,
        branches,
      },
      [stableStringify(['git', 'worktrees', null])]: {
        success: true,
        worktrees,
      },
      [stableStringify(['git', 'checkoutBranch', { name: 'main' }])]: {
        success: true,
      },
      [stableStringify(['git', 'createBranch', { name: 'feature/new-branch', checkout: true }])]: {
        success: true,
      },
      [stableStringify(['git', 'worktreeAdd', { branch: 'feature/new-worktree', checkoutNewBranch: true }])]: {
        success: true,
      },
      [stableStringify(['runtimeApprovals', 'list', null])]: { pending: [] },
      [stableStringify(['runtimeApprovals', 'resolve', { approvalId: COMPOSER_APPROVAL_ID, decision: 'deny' }])]: {
        success: true,
        approvalId: COMPOSER_APPROVAL_ID,
        decision: 'deny',
      },
    },
  });
}

test.describe('Chat composer Git strip', () => {
  test('renders runtime approval inline with the composer and Git strip', async ({ launchElectronApp }, testInfo) => {
    const app = await launchElectronApp({ skipSetup: true, visualMode: true });

    try {
      await installComposerGitMocks(app, [
        {
          role: 'user',
          content: [{ type: 'text', text: 'Check the workspace.' }],
          timestamp: fixedTimestamp,
        },
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'The workspace is ready.' }],
          timestamp: fixedTimestamp + 1,
        },
      ]);
      const page = await getStableWindow(app);
      await page.setViewportSize({ width: 1280, height: 820 });
      try {
        await page.reload();
      } catch (error) {
        if (!String(error).includes('ERR_FILE_NOT_FOUND')) throw error;
      }

      const strip = page.getByTestId('composer-git-strip');
      const composerShell = page.getByTestId('chat-composer-shell');
      const composer = page.getByTestId('chat-composer-input');
      await expect(strip).toBeVisible({ timeout: 30_000 });
      await expect(composerShell).toBeVisible();
      await composer.fill('Keep this draft.');
      const stripBox = (await strip.boundingBox())!;
      const composerBox = (await composerShell.boundingBox())!;
      await page.screenshot({ path: testInfo.outputPath('composer-aligned-with-strip.png') });

      await app.evaluate(({ BrowserWindow }, frame) => {
        for (const win of BrowserWindow.getAllWindows()) {
          win.webContents.send('runtime-approvals:requested', frame);
        }
      }, {
        approvalId: COMPOSER_APPROVAL_ID,
        command: 'pnpm test --filter acceptance',
        commandPreview: null,
        cwd: '/workspace/demo',
        host: 'gateway',
        agentId: 'main',
        sessionKey: SESSION_KEY,
        allowedDecisions: ['allow-once', 'allow-always', 'deny'],
        createdAtMs: 1,
        expiresAtMs: 2,
      });

      const prompt = page.getByTestId('runtime-approval-prompt');
      await expect(prompt).toBeVisible();
      await expect(composer).toBeHidden();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(page.locator('.verse-claw-dialog-overlay')).toHaveCount(0);
      const promptBox = (await prompt.boundingBox())!;
      expect(Math.abs(promptBox.x - composerBox.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(promptBox.width - composerBox.width)).toBeLessThanOrEqual(1);
      expect(Math.abs(promptBox.x - stripBox.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(promptBox.width - stripBox.width)).toBeLessThanOrEqual(1);
      await page.screenshot({ path: testInfo.outputPath('runtime-approval-inline-with-git.png') });
      await prompt.screenshot({ path: testInfo.outputPath('runtime-approval-inline-prompt.png') });
      const currentStripBox = (await strip.boundingBox())!;
      const currentPromptBox = (await prompt.boundingBox())!;
      expect(currentStripBox.y).toBeGreaterThanOrEqual(currentPromptBox.y + currentPromptBox.height - 1);

      await page.getByTestId('runtime-approval-deny').click();
      await expect(prompt).toHaveCount(0);
      await expect(composer).toBeVisible();
      await expect(composer).toHaveValue('Keep this draft.');
      await expect(page.locator('.verse-claw-dialog-overlay')).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('shows repository context and routes branch/worktree actions through host APIs', async ({ launchElectronApp }, testInfo) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installComposerGitMocks(app, [
        {
          role: 'user',
          content: [{ type: 'text', text: 'Check the workspace.' }],
          timestamp: fixedTimestamp,
        },
      ]);
      await app.evaluate(({ ipcMain }, seed) => {
        const original = (ipcMain as unknown as {
          _invokeHandlers?: Map<string, (event: unknown, request: unknown) => Promise<unknown>>;
        })._invokeHandlers?.get('host:invoke');
        let created: typeof seed.worktree | null = null;
        let switched = false;
        const snapshot = () => ({ success: true, profiles: created ? [seed.source, created] : [seed.source],
          activeWorkspaceId: switched && created ? created.id : seed.source.id,
          activeWorkspace: switched && created ? created : seed.source });
        ipcMain.removeHandler('host:invoke');
        ipcMain.handle('host:invoke', async (event, request: {
          id?: string; module?: string; action?: string; payload?: Record<string, unknown>;
        }) => {
          if (request.module !== 'workspaces' || !['create', 'switch', 'list', 'getActive'].includes(request.action ?? '')) {
            return original?.(event, request);
          }
          const payload = request.payload ?? {};
          const record = () => (globalThis as typeof globalThis & { __verseClawE2eHostCalls?: unknown[] })
            .__verseClawE2eHostCalls?.push({ module: request.module, action: request.action, payload });
          const reject = () => ({ id: request.id, ok: false,
            error: { code: 'INVALID_ARGUMENT', message: 'Worktree fixture requires its declared workspace identity.' } });
          if (request.action === 'create') {
            if (payload.rootPath !== seed.worktree.rootPath || payload.name !== seed.worktree.name || payload.agentId !== 'main'
              || typeof payload.activeSessionKey !== 'string' || !/^agent:main:session-\d+-[a-z0-9]+$/.test(payload.activeSessionKey)) return reject();
            record();
            created = { ...seed.worktree, activeSessionKey: payload.activeSessionKey,
              agentBindings: { main: { workspaceId: seed.worktree.id, agentId: 'main', sessionKey: payload.activeSessionKey } },
              sessionStates: { [payload.activeSessionKey]: {} } };
            switched = true;
            (globalThis as typeof globalThis & { __composerWorktreeWorkspace?: typeof created }).__composerWorktreeWorkspace = created;
            return { id: request.id, ok: true, data: snapshot() };
          }
          if (request.action === 'switch') {
            if (!created || payload.id !== created.id) return reject();
            record(); switched = true;
            return { id: request.id, ok: true, data: snapshot() };
          }
          if (!created) return original?.(event, request);
          if (Object.keys(payload).length) return reject();
          record();
          const data = snapshot();
          return { id: request.id, ok: true, data: request.action === 'getActive'
            ? { success: true, activeWorkspaceId: data.activeWorkspaceId, activeWorkspace: data.activeWorkspace } : data };
        });
      }, { source: workspace, worktree: worktreeWorkspace });
      const page = await getStableWindow(app);
      await page.setViewportSize({ width: 1280, height: 820 });
      try {
        await page.reload();
      } catch (error) {
        if (!String(error).includes('ERR_FILE_NOT_FOUND')) throw error;
      }

      await expect(page.getByTestId('chat-page')).toBeVisible();
      const strip = page.getByTestId('composer-git-strip');
      await expect(strip).toBeVisible({ timeout: 30_000 });
      await expect(strip).toContainText('3 files changed');

      const composerShell = page.getByTestId('chat-composer-shell');
      await expect(composerShell).toBeVisible();
      const assertComposerAligned = async () => {
        await expect.poll(async () => {
          const stripBox = await strip.boundingBox();
          const composerBox = await composerShell.boundingBox();
          if (!stripBox || !composerBox) return Number.POSITIVE_INFINITY;
          return Math.abs(stripBox.x - composerBox.x) + Math.abs(stripBox.width - composerBox.width);
        }, { timeout: 5_000 }).toBeLessThanOrEqual(2);
      };
      await assertComposerAligned();
      await page.setViewportSize({ width: 960, height: 820 });
      await assertComposerAligned();
      await page.setViewportSize({ width: 1280, height: 820 });
      await page.screenshot({ path: testInfo.outputPath('composer-git-layout.png') });

      await page.getByTestId('composer-git-trigger').click();
      const menu = page.getByTestId('composer-git-menu');
      await expect(menu).toBeVisible();
      await expect(menu).toContainText('feature/current');
      await expect(menu).toContainText('3 changes');
      await expect(menu).toContainText('ahead 2 / behind 1');
      await expect(menu).toContainText('demo');
      const menuBounds = await page.getByTestId('composer-git-menu').boundingBox();
      expect(menuBounds).toBeTruthy();
      expect(menuBounds!.y).toBeGreaterThanOrEqual(0);
      expect(menuBounds!.y + menuBounds!.height).toBeLessThanOrEqual(820);
      await page.screenshot({ path: testInfo.outputPath('git-menu.png') });
      await expect(menu).toContainText('Branches');
      await expect(menu).toContainText('Worktrees');
      await expect(menu).toContainText('demo-feature-existing · feature/existing · 456789a');
      await expect(menu).toContainText('Locked');
      await expect(menu).toContainText('Prunable');

      await page.getByTestId('composer-git-branch-search').fill('main');
      await page.getByTestId('composer-git-checkout-main').click();
      await expect.poll(async () => app.evaluate(() => (
        (globalThis as typeof globalThis & { __verseClawE2eHostCalls?: Array<{ module?: string; action?: string; payload?: unknown }> })
          .__verseClawE2eHostCalls ?? []
      ))).toContainEqual(expect.objectContaining({
        module: 'git',
        action: 'checkoutBranch',
        payload: { name: 'main' },
      }));

      await page.getByTestId('composer-git-new-branch').fill('feature/new-branch');
      await page.getByTestId('composer-git-create-branch').click();
      await expect.poll(async () => app.evaluate(() => (
        (globalThis as typeof globalThis & { __verseClawE2eHostCalls?: Array<{ module?: string; action?: string; payload?: unknown }> })
          .__verseClawE2eHostCalls ?? []
      ))).toContainEqual(expect.objectContaining({
        module: 'git',
        action: 'createBranch',
        payload: { name: 'feature/new-branch', checkout: true },
      }));

      await page.getByTestId('composer-git-worktree-branch').fill('feature/current');
      await expect(page.getByTestId('composer-git-worktree-blocked')).toContainText('Branch already exists');
      await expect(page.getByTestId('composer-git-add-worktree')).toBeDisabled();

      await page.getByTestId('composer-git-worktree-branch').fill('feature/new-worktree');
      await expect(page.getByTestId('composer-git-worktree-target')).toContainText('/workspace/demo-feature-new-worktree');
      await page.getByTestId('composer-git-add-worktree').click();
      await expect.poll(async () => app.evaluate(() => (
        (globalThis as typeof globalThis & { __verseClawE2eHostCalls?: Array<{ module?: string; action?: string; payload?: unknown }> })
          .__verseClawE2eHostCalls ?? []
      ))).toContainEqual(expect.objectContaining({
        module: 'git',
        action: 'worktreeAdd',
        payload: { branch: 'feature/new-worktree', checkoutNewBranch: true },
      }));

      await page.getByTestId('composer-git-trigger').click();
      await page.getByTestId('composer-git-trigger').click();
      await page.getByRole('button', { name: 'Open Git Panel' }).click();
      await expect(page.getByTestId('artifact-panel')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('workspace-git-panel')).toBeVisible({ timeout: 30_000 });

      const savedDraft = 'Keep this draft when switching to the existing worktree.';
      await page.getByTestId('chat-composer-input').fill(savedDraft);
      await expect.poll(() => app.evaluate((_, draft) => (
        (globalThis as typeof globalThis & {
          __verseClawE2eHostCalls?: Array<{ module?: string; action?: string; payload?: { id?: string; sessionKey?: string; state?: { draftInput?: string } } }>;
        }).__verseClawE2eHostCalls?.some((call) => call.module === 'workspaces' && call.action === 'saveState'
          && call.payload?.id === 'workspace-composer-git' && call.payload.sessionKey === 'agent:main:main'
          && call.payload.state?.draftInput === draft) ?? false
      ), savedDraft)).toBe(true);
      await page.getByTestId('composer-git-trigger').click();
      await page.getByTestId('composer-git-switch-worktree-/workspace/demo-feature-existing').click();
      const switchCalls = await app.evaluate(() => (
        (globalThis as typeof globalThis & { __verseClawE2eHostCalls?: unknown[] }).__verseClawE2eHostCalls ?? []
      ));
      await testInfo.attach('composer-git-worktree-calls', { body: JSON.stringify(switchCalls), contentType: 'application/json' });
      await expect.poll(async () => app.evaluate(() => (
        (globalThis as typeof globalThis & { __verseClawE2eHostCalls?: Array<{ module?: string; action?: string; payload?: unknown }> })
          .__verseClawE2eHostCalls ?? []
      ))).toEqual(expect.arrayContaining([
        expect.objectContaining({
          module: 'workspaces',
          action: 'saveState',
          payload: expect.objectContaining({
            id: WORKSPACE_ID,
            sessionKey: SESSION_KEY,
            state: expect.objectContaining({ draftInput: savedDraft }),
          }),
        }),
        expect.objectContaining({
          module: 'workspaces',
          action: 'create',
          payload: expect.objectContaining({
            agentId: 'main',
            name: 'feature/existing',
            rootPath: '/workspace/demo-feature-existing',
            activeSessionKey: expect.stringMatching(/^agent:main:session-\d+-[a-z0-9]+$/),
          }),
        }),
        expect.objectContaining({
          module: 'workspaces',
          action: 'switch',
          payload: { id: 'workspace-demo-feature-existing' },
        }),
      ]));

      const calls = await app.evaluate(() => (
        (globalThis as typeof globalThis & { __verseClawE2eHostCalls?: Array<{ module?: string; action?: string; payload?: unknown }> })
          .__verseClawE2eHostCalls ?? []
      ));
      expect(calls.filter((call) => call.module === 'shell')).toHaveLength(0);
    } finally {
      await closeElectronApp(app);
    }
  });
});
