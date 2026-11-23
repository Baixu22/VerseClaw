import { closeElectronApp, expect, getStableWindow, hoverUntilVisible, installIpcMocks, revealSectionHeadingActionsFor, test } from './fixtures/electron';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { hostInvoke } from './fixtures/fp-p1-harness';
import { createSessionChainProject, instrumentSessionChainHost, readSessionChainHostCalls } from './fixtures/session-task-chain';
import type { WorkspaceProfile } from '../../shared/types/workspace';

const SESSION_KEY = 'agent:main:main';
const OTHER_SESSION_KEY = 'agent:main:other-project';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

const WORKSPACE = {
  id: 'workspace-1',
  name: 'Demo Workspace',
  rootPath: '/tmp/demo-workspace',
  agentId: 'main',
  selectedAgentId: 'main',
  activeSessionKey: SESSION_KEY,
  agentBindings: {
    main: {
      workspaceId: 'workspace-1',
      agentId: 'main',
      sessionKey: SESSION_KEY,
    },
  },
  permissionMode: 'acceptEdits',
  createdAt: 1,
  updatedAt: 1,
  lastOpenedAt: 1,
  state: {},
  sessionStates: {
    [SESSION_KEY]: {},
  },
};

const OTHER_WORKSPACE = {
  id: 'workspace-2',
  name: 'Other Workspace',
  rootPath: '/tmp/other-workspace',
  agentId: 'main',
  selectedAgentId: 'main',
  activeSessionKey: OTHER_SESSION_KEY,
  agentBindings: {
    main: {
      workspaceId: 'workspace-2',
      agentId: 'main',
      sessionKey: OTHER_SESSION_KEY,
    },
  },
  permissionMode: 'acceptEdits',
  createdAt: 2,
  updatedAt: 2,
  lastOpenedAt: 2,
  state: {},
  sessionStates: {
    [OTHER_SESSION_KEY]: {},
  },
};

const MAIN_HISTORY = [
  { role: 'user', content: 'Keep this workspace visible', timestamp: 1773281731 },
  { role: 'assistant', content: 'Workspace header is visible.', timestamp: 1773281732 },
];

test.describe('Verse Claw chat workspace header', () => {
  test('creates a new session in another project after saving the current project draft', async ({ launchElectronApp }, info) => {
    test.setTimeout(240_000);
    const app = await launchElectronApp({ skipSetup: true });
    try {
      const source = await createSessionChainProject(app, info.outputPath('source-project'), 'G5 Source');
      const target = await createSessionChainProject(app, info.outputPath('target-project'), 'G5 Target');
      await hostInvoke(app, 'workspaces', 'switch', { id: source.workspaceId });
      const page = await getStableWindow(app);
      await page.reload();
      await expect(page.getByTestId('chat-page')).toHaveAttribute('data-session-generation', source.generation, { timeout: 60_000 });
      const draft = 'G5 source draft stays in its original project';
      await instrumentSessionChainHost(app);
      await page.getByTestId('chat-composer-input').fill(draft);
      await hoverUntilVisible(
        page.getByTestId(`sidebar-project-open-${target.workspaceId}`).locator('xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " sidebar-row ")][1]'),
        page.getByTestId(`sidebar-project-new-session-${target.workspaceId}`),
      );
      await page.getByTestId(`sidebar-project-new-session-${target.workspaceId}`).click();
      await expect.poll(async () => (await hostInvoke<{ activeWorkspace: WorkspaceProfile }>(app, 'workspaces', 'getActive')).activeWorkspace.id)
        .toBe(target.workspaceId);
      await expect(page.getByTestId('chat-project-session-header')).toContainText('G5 Target');
      await expect(page.getByTestId('chat-composer-input')).toHaveValue('');
      const owner = await hostInvoke<{ profiles: WorkspaceProfile[]; activeWorkspace: WorkspaceProfile }>(app, 'workspaces', 'list');
      expect(owner.activeWorkspace.activeSessionKey).toMatch(/^agent:main:session-\d+-[a-z0-9]+$/);
      expect(owner.activeWorkspace.activeSessionKey).not.toBe(target.sessionKey);
      expect(owner.profiles.find(profile => profile.id === source.workspaceId)?.sessionStates?.[source.sessionKey]?.draftInput).toBe(draft);
      expect(owner.profiles.find(profile => profile.id === source.workspaceId)?.activeSessionKey).toBe(source.sessionKey);
      const calls = await readSessionChainHostCalls(app);
      const save = calls.findIndex(call => call.module === 'workspaces' && call.action === 'saveState');
      const create = calls.findIndex(call => call.module === 'workspaces' && call.action === 'update');
      const activate = calls.findIndex(call => call.module === 'workspaces' && call.action === 'switch');
      expect(save).toBeGreaterThanOrEqual(0); expect(create).toBeGreaterThan(save); expect(activate).toBeGreaterThan(create);
      await info.attach('project-new-session-owner-readback', { body: JSON.stringify({ driven_by: 'agent', actor: 'g5-unified-autonomy-20261113-01a1d34a', realHumanEvidence: false, source, target, owner, calls }), contentType: 'application/json' });
    } finally { await closeElectronApp(app); }
  });

  test('opens an idle worktree from the header after saving its source session', async ({ launchElectronApp }, info) => {
    test.setTimeout(240_000);
    const app = await launchElectronApp({ skipSetup: true });
    try {
      const root = info.outputPath('header-base');
      const target = info.outputPath('header-worktree');
      mkdirSync(root, { recursive: true });
      const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { windowsHide: true, encoding: 'utf8' });
      git('init'); git('config', 'user.name', 'G5 agent'); git('config', 'user.email', 'g5-agent@example.invalid');
      await writeFile(join(root, 'header.txt'), 'G5 header fixture\n');
      git('add', 'header.txt'); git('commit', '-m', 'G5 header fixture');
      git('worktree', 'add', '--detach', target, 'HEAD');
      const project = await createSessionChainProject(app, root, 'G5 Header base');
      const page = await getStableWindow(app);
      await page.reload();
      await expect(page.getByTestId('chat-project-session-header')).toContainText('G5 Header base', { timeout: 60_000 });
      const draft = 'G5 source draft survives the header worktree switch';
      await instrumentSessionChainHost(app);
      await page.getByTestId('chat-composer-input').fill(draft);
      await page.getByTestId('chat-header-environment-project').getByRole('button').click();
      await page.getByTestId('composer-context-more').click();
      const worktree = page.getByTestId('session-worktree-menu').getByRole('button', { name: /header-worktree/ });
      await expect(worktree).toBeEnabled(); await worktree.click();
      await expect.poll(async () => (await hostInvoke<{ activeWorkspace: WorkspaceProfile }>(app, 'workspaces', 'getActive')).activeWorkspace.rootPath.replace(/\\/g, '/').toLowerCase())
        .toBe(target.replace(/\\/g, '/').toLowerCase());
      await expect(page.getByTestId('chat-project-session-header')).toContainText('header-worktree');
      const owner = await hostInvoke<{ profiles: WorkspaceProfile[] }>(app, 'workspaces', 'list');
      expect(owner.profiles.find(profile => profile.id === project.workspaceId)?.sessionStates?.[project.sessionKey]?.draftInput).toBe(draft);
      const calls = await readSessionChainHostCalls(app);
      const save = calls.findIndex(call => call.module === 'workspaces' && call.action === 'saveState');
      const create = calls.findIndex(call => call.module === 'workspaces' && call.action === 'create');
      const activate = calls.findIndex(call => call.module === 'workspaces' && call.action === 'switch');
      expect(save).toBeGreaterThanOrEqual(0); expect(create).toBeGreaterThan(save); expect(activate).toBeGreaterThan(create);
      await info.attach('header-worktree-owner-readback', { body: JSON.stringify({ driven_by: 'agent', actor: 'g5-unified-autonomy-20261113-01a1d34a', realHumanEvidence: false, project, target, owner, calls }), contentType: 'application/json' });
    } finally { await closeElectronApp(app); }
  });

  test('shows workspace and conversation without the legacy topic selector', async ({ launchElectronApp }, testInfo) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345 },
        gatewayRpc: {
          [stableStringify(['sessions.list', {}])]: {
            success: true,
            result: {
              sessions: [
                { key: SESSION_KEY, displayName: 'main', updatedAt: 1773281732000 },
                { key: OTHER_SESSION_KEY, displayName: 'Other project', updatedAt: 1773281733000 },
              ],
            },
          },
          [stableStringify(['sessions.list', { includeDerivedTitles: true, includeLastMessage: true }])]: {
            success: true,
            result: {
              sessions: [
                { key: SESSION_KEY, displayName: 'main', updatedAt: 1773281732000 },
                { key: OTHER_SESSION_KEY, displayName: 'Other project', updatedAt: 1773281733000 },
              ],
            },
          },
          [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 200, maxChars: 500000 }])]: {
            success: true,
            result: { messages: MAIN_HISTORY },
          },
          [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 1000, maxChars: 500000 }])]: {
            success: true,
            result: { messages: MAIN_HISTORY },
          },
        },
        hostApi: {
          [stableStringify(['git', 'status', null])]: { success: true, status: { isRepository: true, workspaceRoot: WORKSPACE.rootPath,
            repoRoot: WORKSPACE.rootPath, branch: 'main', detached: false, clean: true, changes: [] } },
          [stableStringify(['git', 'worktrees', null])]: { success: true, worktrees: [{ path: WORKSPACE.rootPath, branch: 'main' },
            { path: '/tmp/demo-feature', branch: 'feature' }] },
          [stableStringify(['/api/settings', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: { language: 'en', setupComplete: true },
            },
          },
          [stableStringify(['/api/agents', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: {
                success: true,
                agents: [{ id: 'main', name: 'main' }],
              },
            },
          },
          [stableStringify(['workspaces', 'list', null])]: {
            profiles: [WORKSPACE, OTHER_WORKSPACE],
            activeWorkspaceId: WORKSPACE.id,
            activeWorkspace: WORKSPACE,
          },
          [stableStringify(['/api/skills/quick-access', 'POST'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: { success: true, skills: [] },
            },
          },
        },
      });

      const page = await getStableWindow(app);
      await expect(page.getByTestId('chat-project-session-header')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('chat-project-session-header')).toContainText('Demo Workspace');
      await expect(page.getByTestId('chat-topic-selector')).toHaveCount(0);
      await revealSectionHeadingActionsFor(page.getByTestId('sidebar-session-organize'));
      await expect(page.getByTestId('sidebar-session-organize')).toBeVisible();
      await expect(page.getByTestId('sidebar-session-search')).toBeVisible();
      await expect(page.getByTestId('sidebar-session-project-workspace-1')).toContainText('Demo Workspace');
      await expect(page.getByTestId('sidebar-session-project-workspace-2')).toContainText('Other Workspace');
      await expect(page.getByTestId('sidebar-session-project-workspace-1')).not.toContainText('/tmp/demo-workspace');
      await expect(page.getByTestId('sidebar-session-project-workspace-2')).not.toContainText('/tmp/other-workspace');

      await expect(page.getByTestId('sidebar-session-project-toggle-workspace-1')).toHaveAttribute('aria-expanded', 'true');
      await expect(page.getByTestId(`sidebar-session-${SESSION_KEY}`)).toBeVisible();

      await page.getByTestId('chat-header-environment-project').getByRole('button').click();
      await page.getByTestId('composer-context-more').click();
      await expect(page.getByTestId('session-worktree-create')).toBeEnabled();
      await expect(page.getByTestId('session-worktree-menu').getByRole('button', { name: /feature/ })).toBeEnabled();

      await app.evaluate(({ BrowserWindow }, sessionKey) => {
        for (const win of BrowserWindow.getAllWindows()) {
          win.webContents.send('chat:runtime-event', {
            type: 'run.started',
            runId: 'sidebar-status-run',
            sessionKey,
            startedAt: Date.now(),
          });
        }
      }, SESSION_KEY);
      await expect(page.getByTestId(`sidebar-session-status-${SESSION_KEY}`)).toHaveAttribute('data-state', 'running');
      await expect(page.getByTestId('session-worktree-create')).toBeDisabled();
      await expect(page.getByTestId('session-worktree-menu').getByRole('button', { name: /feature/ })).toBeDisabled();
      await page.keyboard.press('Escape');
      await page.getByTestId('chat-header-session-name').click();
      await expect(page.getByTestId(`chat-session-item-${SESSION_KEY}`).locator('[data-state="streaming"]')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('chat-turn-summary-orb')).toBeVisible();
      await expect(page.getByTestId('assistant-stream-status')).toHaveCount(0);
      await expect(page.getByTestId('assistant-status-dot-matrix')).toHaveCount(0);

      const screenshotPath = testInfo.outputPath('chat-dot-matrix-running-status.png');
      await page.screenshot({ path: screenshotPath, fullPage: false });
      await testInfo.attach('chat-dot-matrix-running-status', {
        path: screenshotPath,
        contentType: 'image/png',
      });
      const screenshotDir = process.env.CLAWX_DOT_MATRIX_SCREENSHOT_DIR;
      if (screenshotDir) {
        const resolvedDir = join(process.cwd(), screenshotDir);
        mkdirSync(resolvedDir, { recursive: true });
        await page.screenshot({ path: join(resolvedDir, 'chat-dot-matrix-running-status.png'), fullPage: false });
      }

      await app.evaluate(({ BrowserWindow }, sessionKey) => {
        for (const win of BrowserWindow.getAllWindows()) {
          win.webContents.send('chat:runtime-event', {
            type: 'run.ended',
            runId: 'sidebar-status-run',
            sessionKey,
            status: 'completed',
            endedAt: Date.now(),
          });
        }
      }, SESSION_KEY);
      await expect(page.getByTestId(`sidebar-session-status-${SESSION_KEY}`)).toHaveAttribute('data-state', 'completed');
      await page.getByTestId(`sidebar-session-status-${SESSION_KEY}`).click();
      await expect(page.getByTestId(`sidebar-session-status-${SESSION_KEY}`)).toHaveCount(0);

      await page.getByTestId('sidebar-session-project-toggle-workspace-1').click();
      await expect(page.getByTestId('sidebar-session-project-workspace-1')).toHaveAttribute('data-state', 'collapsed');
      await expect(page.getByTestId('sidebar-session-project-toggle-workspace-1')).toHaveAttribute('aria-expanded', 'false');
      // The official collapse animates grid-template-rows 1fr→0fr, so rows stay
      // mounted and are clipped to zero height rather than unmounting.
      const collapsedList = page
        .getByTestId('sidebar-session-project-workspace-1')
        .locator('.project-tasks-outer');
      await expect(collapsedList).toHaveAttribute('aria-hidden', 'true');
      // Fully clipped: only the reference's 4px `.project-tasks` top padding
      // survives the 0fr track, so no session row remains on screen.
      await expect
        .poll(() => collapsedList.evaluate((el) => Math.round(el.getBoundingClientRect().height)))
        .toBeLessThanOrEqual(4);
      await page.getByTestId('sidebar-session-project-toggle-workspace-1').click();
      await expect(page.getByTestId(`sidebar-session-${SESSION_KEY}`)).toBeVisible();

      await revealSectionHeadingActionsFor(page.getByTestId('sidebar-session-organize'));
      await page.getByTestId('sidebar-session-organize').click();
      await page.getByRole('menuitemradio', { name: 'Time' }).click();
      await expect(page.getByTestId('sidebar-session-project-workspace-1')).toHaveCount(0);
      await expect(page.getByText('Other project')).toBeVisible();
    } finally {
      await closeElectronApp(app);
    }
  });

  for (const entry of ['sidebar', 'slash'] as const) test(`keeps ${entry} new chat scoped to the active workspace and preserves drafts after owner refusal`, async ({ launchElectronApp }, info) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345 },
        gatewayRpc: {
          [stableStringify(['sessions.list', {}])]: {
            success: true,
            result: {
              sessions: [
                { key: SESSION_KEY, displayName: 'main', updatedAt: 1773281732000 },
                { key: OTHER_SESSION_KEY, displayName: 'Other project', updatedAt: 1773281733000 },
              ],
            },
          },
          [stableStringify(['sessions.list', { includeDerivedTitles: true, includeLastMessage: true }])]: {
            success: true,
            result: {
              sessions: [
                { key: SESSION_KEY, displayName: 'main', updatedAt: 1773281732000 },
                { key: OTHER_SESSION_KEY, displayName: 'Other project', updatedAt: 1773281733000 },
              ],
            },
          },
          [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 200, maxChars: 500000 }])]: {
            success: true,
            result: { messages: MAIN_HISTORY },
          },
          [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 1000, maxChars: 500000 }])]: {
            success: true,
            result: { messages: MAIN_HISTORY },
          },
        },
        hostApi: {
          [stableStringify(['/api/settings', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: { language: 'en', setupComplete: true },
            },
          },
          [stableStringify(['/api/agents', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: {
                success: true,
                agents: [{ id: 'main', name: 'main' }],
              },
            },
          },
          [stableStringify(['workspaces', 'list', null])]: {
            profiles: [WORKSPACE, OTHER_WORKSPACE],
            activeWorkspaceId: WORKSPACE.id,
            activeWorkspace: WORKSPACE,
          },
          [stableStringify(['workspaces', 'getActive', null])]: {
            activeWorkspaceId: WORKSPACE.id,
            activeWorkspace: WORKSPACE,
          },
          [stableStringify(['/api/skills/quick-access', 'POST'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: { success: true, skills: [] },
            },
          },
        },
      });

      const page = await getStableWindow(app);
      await expect(page.getByTestId('chat-project-session-header')).toContainText('Demo Workspace', { timeout: 30_000 });

      await app.evaluate((_, params) => {
        const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
        const originalHostInvoke = (ipcMain as unknown as {
          _invokeHandlers?: Map<string, (event: unknown, request: unknown) => Promise<unknown>>;
        })._invokeHandlers?.get('host:invoke');
        const calls = {
          workspaceUpdate: [] as Record<string, unknown>[],
          workspaceSaveState: [] as Record<string, unknown>[],
          rejectedUpdates: [] as Record<string, unknown>[],
          sourceSavesBeforeRejection: [] as Record<string, unknown>[],
        };
        let activeWorkspace = params.workspace;
        const respond = (id: unknown, data: unknown) => ({ id: typeof id === 'string' ? id : undefined, ok: true, data });
        const buildSnapshot = () => ({
          success: true,
          profiles: [activeWorkspace, params.otherWorkspace],
          activeWorkspaceId: activeWorkspace.id,
          activeWorkspace,
        });

        (globalThis as typeof globalThis & {
          __workspaceNewChatCalls?: typeof calls;
        }).__workspaceNewChatCalls = calls;

        ipcMain.removeHandler('host:invoke');
        ipcMain.handle('host:invoke', async (event: unknown, request: {
          id?: string;
          module?: string;
          action?: string;
          payload?: Record<string, unknown>;
        }) => {
          if (request.module === 'workspaces' && request.action === 'update') {
            if (calls.rejectedUpdates.length === 0) {
              calls.sourceSavesBeforeRejection = calls.workspaceSaveState.filter(payload =>
                payload.id === params.workspace.id && payload.sessionKey === params.workspace.activeSessionKey);
              calls.rejectedUpdates.push(request.payload ?? {});
              return { id: request.id, ok: false, error: { code: 'CONFLICT', message: 'U5_NEW_SESSION_REJECTED' } };
            }
            calls.workspaceUpdate.push(request.payload ?? {});
            const payload = request.payload ?? {};
            const agentId = String(payload.agentId ?? activeWorkspace.selectedAgentId);
            const sessionKey = String(payload.sessionKey ?? activeWorkspace.activeSessionKey);
            activeWorkspace = {
              ...activeWorkspace,
              agentId,
              selectedAgentId: agentId,
              activeSessionKey: String(payload.activeSessionKey ?? sessionKey),
              agentBindings: {
                ...activeWorkspace.agentBindings,
                [agentId]: {
                  workspaceId: activeWorkspace.id,
                  agentId,
                  sessionKey,
                },
              },
              state: payload.state ?? {},
              sessionStates: {
                ...activeWorkspace.sessionStates,
                [sessionKey]: payload.state ?? {},
              },
              updatedAt: Date.now(),
              lastOpenedAt: Date.now(),
            };
            return respond(request.id, buildSnapshot());
          }
          if (request.module === 'workspaces' && request.action === 'saveState') {
            calls.workspaceSaveState.push(request.payload ?? {});
            return respond(request.id, { success: true });
          }
          if (request.module === 'workspaces' && request.action === 'list') {
            return respond(request.id, buildSnapshot());
          }
          if (request.module === 'workspaces' && request.action === 'getActive') {
            return respond(request.id, {
              success: true,
              activeWorkspaceId: activeWorkspace.id,
              activeWorkspace,
            });
          }
          if (request.module === 'files' && request.action === 'writeText') {
            return respond(request.id, { success: true });
          }
          return originalHostInvoke?.(event, request) ?? respond(request.id, {});
        });
      }, { workspace: WORKSPACE, otherWorkspace: OTHER_WORKSPACE });

      const draft = entry === 'slash' ? '/new' : 'Preserve this source draft after rejected creation';
      const create = async () => {
        if (entry === 'sidebar') await page.getByTestId('sidebar-new-chat').click();
        else {
          await page.getByTestId('chat-composer-input').fill('/ne'); await page.getByTestId('chat-composer-input').press('w');
          const option = page.getByTestId('chat-slash-command-option-new');
          await expect(option).toBeVisible(); await option.focus(); await expect(option).toBeFocused(); await option.press('Enter');
        }
      };
      await page.getByTestId('chat-composer-input').fill(draft);
      await create();
      await expect(page.getByText('U5_NEW_SESSION_REJECTED', { exact: false })).toBeVisible();
      await expect(page.getByTestId('chat-composer-input')).toHaveValue(draft);
      const rejectedSourceSaves = await app.evaluate(() => (globalThis as unknown as {
        __workspaceNewChatCalls: { sourceSavesBeforeRejection: Record<string, unknown>[] };
      }).__workspaceNewChatCalls.sourceSavesBeforeRejection);
      expect(rejectedSourceSaves).toContainEqual(expect.objectContaining({ id: WORKSPACE.id, sessionKey: SESSION_KEY }));
      expect(await app.evaluate(() => (globalThis as unknown as {
        __workspaceNewChatCalls: { workspaceUpdate: unknown[]; rejectedUpdates: unknown[] };
      }).__workspaceNewChatCalls)).toMatchObject({ workspaceUpdate: [], rejectedUpdates: [expect.objectContaining({ id: WORKSPACE.id })] });
      await create();

      await expect.poll(async () => app.evaluate(() => (
        (globalThis as typeof globalThis & {
          __workspaceNewChatCalls?: { workspaceUpdate: unknown[] };
        }).__workspaceNewChatCalls?.workspaceUpdate.length ?? 0
      ))).toBe(1);

      await expect.poll(async () => app.evaluate(() => (
        (globalThis as typeof globalThis & {
          __workspaceNewChatCalls?: { workspaceSaveState?: unknown[] };
        }).__workspaceNewChatCalls?.workspaceSaveState?.length ?? 0
      ))).toBeGreaterThan(0);
      const calls = await app.evaluate(() => (
        (globalThis as typeof globalThis & {
          __workspaceNewChatCalls?: {
            workspaceUpdate: Record<string, unknown>[];
            workspaceSaveState: Record<string, unknown>[];
          };
        }).__workspaceNewChatCalls
      ));
      expect(calls?.workspaceSaveState[0]).toEqual(expect.objectContaining({
        id: WORKSPACE.id,
        sessionKey: SESSION_KEY,
      }));
      expect(calls?.workspaceUpdate[0]).toEqual(expect.objectContaining({
        id: WORKSPACE.id,
        agentId: 'main',
        state: { activeTopicId: null },
      }));
      expect(calls?.workspaceUpdate[0]?.sessionKey).toEqual(expect.stringMatching(/^agent:main:session-\d+-[a-z0-9]+$/));
      expect(calls?.workspaceUpdate[0]?.activeSessionKey).toBe(calls?.workspaceUpdate[0]?.sessionKey);
      await expect(page.getByTestId('chat-composer-input')).toHaveValue('');
      await info.attach('new-session-refusal-recovery', { body: JSON.stringify({ driven_by: 'agent', actor: 'playwright-u5-new-session',
        fixture: 'Host owner rejection followed by original UI retry', sourceDraftRetained: true, calls }), contentType: 'application/json' });
    } finally {
      await closeElectronApp(app);
    }
  });
});
