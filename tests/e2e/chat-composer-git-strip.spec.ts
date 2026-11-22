import { createEmptySessionActivitySnapshot } from '../../shared/types/session-activity';
import type { GitRepositoryStatus } from '../../shared/types/git';
import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

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
  name: 'demo-feature-existing',
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
    { path: 'src/staged.ts', absolutePath: '/workspace/demo/src/staged.ts', status: 'M', staged: true, unstaged: false, untracked: false, conflicted: false, bucket: 'staged' },
    { path: 'src/edited.ts', absolutePath: '/workspace/demo/src/edited.ts', status: 'M', staged: false, unstaged: true, untracked: false, conflicted: false, bucket: 'unstaged' },
    { path: 'src/new.ts', absolutePath: '/workspace/demo/src/new.ts', status: '??', staged: false, unstaged: false, untracked: true, conflicted: false, bucket: 'untracked' },
  ],
};

const branches = [
  { name: 'feature/current', current: true, upstream: 'origin/feature/current', commit: 'abcdef1' },
  { name: 'main', current: false, upstream: 'origin/main', commit: '1234567' },
  { name: 'feature/existing', current: false, commit: '456789a' },
];

const worktrees = [
  { path: '/workspace/demo', branch: 'feature/current', head: 'abcdef123456' },
  { path: '/workspace/demo-feature-existing', branch: 'feature/existing', head: '456789abcdef', locked: true },
  { path: '/workspace/demo-pruned', branch: 'obsolete', head: '1234567', prunable: true },
];

async function installComposerGitMocks(
  app: Parameters<typeof installIpcMocks>[0],
  messages: Array<Record<string, unknown>> = [{ role: 'user', content: 'Review the current repository', timestamp: fixedTimestamp }],
  linked = false,
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
      [stableStringify(['sessionActivity', 'snapshot', null])]: { success: true, snapshot: { ...createEmptySessionActivitySnapshot(SESSION_KEY), git: gitStatus, availability: { git: true, tasks: true, subagents: true, terminals: true, continuity: true } } },
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
      [stableStringify(['workspaces', 'create', null])]: {
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
        worktrees: linked ? [{ path: '/workspace/main-checkout', branch: 'main', head: '1234567' }, ...worktrees] : worktrees,
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
  await app.evaluate(({ ipcMain }, seed) => {
    const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (event: unknown, request: {
      id?: string; module: string; action: string; payload?: {
        name?: string; id?: string; rootPath?: string; agentId?: string;
        activeSessionKey?: string; activate?: boolean; method?: string;
        params?: { key?: string; sessionKey?: string };
      };
    }) => Promise<unknown>> })._invokeHandlers;
    const original = handlers.get('host:invoke')!;
    let selected = seed.initialBranch;
    let created: typeof seed.target | null = null;
    let active: typeof seed.source | typeof seed.target = seed.source;
    const snapshot = () => ({ profiles: created ? [seed.source, created] : [seed.source],
      activeWorkspaceId: active.id, activeWorkspace: active,
      ...(created ? { createdWorkspace: created } : {}) });
    ipcMain.removeHandler('host:invoke');
    ipcMain.handle('host:invoke', async (event, request) => {
      const payload = request.payload ?? {};
      const record = () => (globalThis as typeof globalThis & { __verseClawE2eHostCalls?: unknown[] })
        .__verseClawE2eHostCalls?.push({ module: request.module, action: request.action, payload });
      if (request.module === 'gateway' && request.action === 'rpc' && payload.method === 'chat.history') {
        const key = payload.params?.key ?? payload.params?.sessionKey;
        if (key === seed.source.activeSessionKey || key === created?.activeSessionKey) {
          record();
          return { id: request.id, ok: true, data: { success: true,
            result: { messages: key === seed.source.activeSessionKey ? seed.messages : [] } } };
        }
      }
      if (request.module === 'workspaces' && request.action === 'create') {
        if (payload.rootPath !== seed.target.rootPath || payload.name !== 'feature/existing' || payload.agentId !== 'main'
            || payload.activate !== false || typeof payload.activeSessionKey !== 'string'
            || !payload.activeSessionKey.startsWith('agent:main:session-')) {
          return { id: request.id, ok: false, error: { code: 'INVALID_ARGUMENT', message: 'Workspace fixture identity mismatch' } };
        }
        record();
        created = { ...seed.target, name: payload.name, activeSessionKey: payload.activeSessionKey,
          agentBindings: { main: { workspaceId: seed.target.id, agentId: 'main', sessionKey: payload.activeSessionKey } },
          sessionStates: { [payload.activeSessionKey]: {} } };
        return { id: request.id, ok: true, data: snapshot() };
      }
      if (request.module === 'workspaces' && created && ['switch', 'list', 'getActive'].includes(request.action)) {
        if (request.action === 'switch') {
          if (payload.id !== created.id) return { id: request.id, ok: false, error: { code: 'INVALID_ARGUMENT', message: 'Workspace fixture identity mismatch' } };
          active = created;
        }
        record();
        return { id: request.id, ok: true, data: snapshot() };
      }
      const response = await original(event, request) as { data?: {
        success?: boolean; status?: { branch?: string }; branches?: Array<{ name: string; current: boolean }>;
      } };
      if (request.module !== 'git') return response;
      if (['checkoutBranch', 'createBranch'].includes(request.action) && response.data?.success && request.payload?.name) {
        selected = request.payload.name;
      }
      if (request.action === 'status' && response.data?.status) {
        return { ...response, data: { ...response.data, status: { ...response.data.status, branch: selected } } };
      }
      if (request.action === 'branches' && response.data?.branches) {
        const items = response.data.branches.map(entry => ({ ...entry, current: entry.name === selected }));
        if (!items.some(entry => entry.name === selected)) items.push({ name: selected, current: true });
        return { ...response, data: { ...response.data, branches: items } };
      }
      return response;
    });
  }, { initialBranch: gitStatus.branch!, source: workspace, target: worktreeWorkspace, messages });
}

test.describe('Chat composer Git strip', () => {
  for (const theme of ['light', 'dark'] as const) {
    test(`identifies a linked worktree in the composer and session status (${theme})`, async ({ launchElectronApp }, testInfo) => {
      const app = await launchElectronApp({ skipSetup: true, visualMode: true, theme });
      try {
        await installComposerGitMocks(app, undefined, true);
        const page = await getStableWindow(app);
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.setViewportSize({ width: 1280, height: 820 });
        await expect(page.getByTestId('composer-git-strip')).toContainText('3 files changed');
        await page.getByTestId('composer-git-trigger').click();
        const menu = page.getByTestId('composer-git-menu');
        await expect(menu.locator('.codex-git-kind')).toHaveText('Worktree');
        await expect(menu).toContainText('Linked worktree');
        await expect(menu).toHaveCSS('backdrop-filter', 'none');
        await expect(menu).toHaveCSS('opacity', '1');
        await page.screenshot({ path: testInfo.outputPath(`${theme}-worktree-menu.png`) });
        await page.keyboard.press('Escape');
        const toggle = page.getByTestId('chat-session-activity-toggle');
        if (!await page.getByTestId('session-activity-panel').isVisible()) await toggle.click();
        await expect(page.getByTestId('session-activity-head-branch')).toHaveAttribute('data-git-kind', 'worktree');
        await expect(page.getByTestId('session-activity-worktree-kind')).toHaveText('Worktree');
        await page.screenshot({ path: testInfo.outputPath(`${theme}-session-worktree.png`) });
      } finally { await closeElectronApp(app); }
    });
  }

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
      await expect(strip).toBeVisible();
      const currentStripBox = (await strip.boundingBox())!;
      expect(currentStripBox.y + currentStripBox.height).toBeLessThanOrEqual(promptBox.y + 1);

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
      await installComposerGitMocks(app);
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
      await expect(page.getByTestId('composer-git-trigger')).toContainText('feature/current');

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
      const assertStripAboveComposer = async () => {
        await expect.poll(async () => {
          const stripBox = await strip.boundingBox();
          const composerBox = await composerShell.boundingBox();
          if (!stripBox || !composerBox) return false;
          return stripBox.y + stripBox.height <= composerBox.y + 1;
        }).toBe(true);
      };
      await assertStripAboveComposer();
      await page.setViewportSize({ width: 960, height: 820 });
      await assertComposerAligned();
      await assertStripAboveComposer();
      await page.setViewportSize({ width: 640, height: 820 });
      await assertComposerAligned();
      await assertStripAboveComposer();
      expect(await strip.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      await page.setViewportSize({ width: 390, height: 720 });
      await assertComposerAligned();
      await assertStripAboveComposer();
      await expect(page.getByTestId('composer-git-review').locator('.composer-git-review-label')).toBeHidden();
      expect(await strip.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath('composer-git-layout-narrow.png'), animations: 'disabled' });
      await page.setViewportSize({ width: 1280, height: 820 });
      await page.screenshot({ path: testInfo.outputPath('composer-git-layout.png') });

      await page.getByTestId('composer-git-trigger').click();
      const menu = page.getByTestId('composer-git-menu');
      await expect(menu).toBeVisible();
      await expect(menu).toContainText('feature/current');
      await expect(menu).toContainText('ahead 2 / behind 1');
      await expect(menu).toContainText('demo');
      const reopenMenu = async () => {
        await expect(menu).toHaveCount(0);
        await page.getByTestId('composer-git-trigger').click();
        await expect(menu).toBeVisible();
      };
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
      await expect(page.getByTestId('composer-git-switch-worktree-/workspace/demo-pruned')).toBeDisabled();

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
      await reopenMenu();
      await expect(menu.locator('.codex-git-menu__head p').first()).toHaveText('main');

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
      await reopenMenu();
      await expect(menu.locator('.codex-git-menu__head p').first()).toHaveText('feature/new-branch');

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

      await reopenMenu();
      await page.getByRole('button', { name: 'Open Git Panel' }).click();
      await expect(page.getByTestId('artifact-panel')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('workspace-git-panel')).toBeVisible({ timeout: 30_000 });

      await page.getByTestId('composer-git-trigger').click();
      await page.getByTestId('composer-git-switch-worktree-/workspace/demo-feature-existing').click();
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
          }),
        }),
        expect.objectContaining({
          module: 'workspaces',
          action: 'create',
          payload: expect.objectContaining({
            agentId: 'main',
            name: 'feature/existing',
            rootPath: '/workspace/demo-feature-existing',
            activeSessionKey: expect.stringMatching(/^agent:main:session-/),
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
      await page.keyboard.press('Escape');
      await expect(menu).toHaveCount(0);
      await page.getByTestId('composer-git-review').click();
      await expect(page.getByTestId('workspace-review-panel')).toBeVisible({ timeout: 30_000 });
    } finally {
      await closeElectronApp(app);
    }
  });
});
