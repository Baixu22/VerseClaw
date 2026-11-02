import { expect, hoverUntilVisible, revealSectionHeadingActionsFor, test, installIpcMocks } from './fixtures/electron';
import type { Locator } from '@playwright/test';

const SESSION_KEY_A = 'agent:main:session-1700000000000';
const SESSION_KEY_B = 'agent:main:session-1700000001000';
const ARCHIVED_SESSION_KEY = 'agent:main:session-1600000000000';

type TestWorkspace = {
  id: string;
  name: string;
  rootPath: string;
  agentId: string;
  selectedAgentId: string;
  activeSessionKey: string;
  agentBindings: Record<string, { workspaceId: string; agentId: string; sessionKey: string }>;
  permissionMode: string;
  createdAt: number;
  updatedAt: number;
  lastOpenedAt: number;
  state: Record<string, unknown>;
  sessionStates: Record<string, Record<string, unknown>>;
  sessionFolders: Array<{
    id: string;
    name: string;
    parentId: string | null;
    order: number;
    kind?: 'folder' | 'workgroup';
    createdAt: number;
    updatedAt: number;
  }>;
  sessionFolderAssignments: Record<string, string>;
};

function makeBaseWorkspace(): TestWorkspace {
  return {
    id: 'workspace-folders',
    name: 'Folder Test Workspace',
    rootPath: 'C:/folder-test',
    agentId: 'main',
    selectedAgentId: 'main',
    activeSessionKey: SESSION_KEY_A,
    agentBindings: {
      main: {
        workspaceId: 'workspace-folders',
        agentId: 'main',
        sessionKey: SESSION_KEY_A,
      },
    },
    permissionMode: 'acceptEdits',
    createdAt: 1,
    updatedAt: 1,
    lastOpenedAt: 1,
    state: {},
    sessionStates: {
      [SESSION_KEY_A]: {},
      [SESSION_KEY_B]: {},
    },
    sessionFolders: [],
    sessionFolderAssignments: {},
  };
}

const archivedEntry = {
  sessionKey: ARCHIVED_SESSION_KEY,
  agentId: 'main',
  transcriptPath: 'C:/fake/.openclaw/agents/main/sessions/old.archived.jsonl',
  label: 'Old archived chat',
  archivedAt: 1600000005000,
  originalWorkspaceId: 'workspace-folders',
  originalFolderId: null,
  sessionsJsonSnapshot: null,
};

const SESSIONS_LIST = [
  { key: SESSION_KEY_A, displayName: 'Chat A', messageCount: 2 },
  { key: SESSION_KEY_B, displayName: 'Chat B', status: 'waiting_approval', hasActiveRun: true, messageCount: 5 },
];

async function expectActionBefore(left: Locator, right: Locator) {
  const [leftBox, rightBox] = await Promise.all([left.boundingBox(), right.boundingBox()]);
  expect(leftBox).not.toBeNull();
  expect(rightBox).not.toBeNull();
  if (!leftBox || !rightBox) return;

  expect(leftBox.x + leftBox.width).toBeLessThanOrEqual(rightBox.x + 0.5);
}

/**
 * Install a stateful `host:invoke` handler that manages workspace folders and
 * archived sessions in memory. All calls are handled directly — no delegation
 * to installIpcMocks — to avoid closure-serialization issues.
 */
async function setupStatefulHostHandler(
  electronApp: import('@playwright/test').ElectronApplication,
  options: {
    workspace: TestWorkspace;
    archivedEntries: typeof archivedEntry[];
    sessionsList?: Array<{ key: string; displayName: string; status?: string; hasActiveRun?: boolean; messageCount?: number }>;
  },
): Promise<void> {
  await electronApp.evaluate((_ctx, params) => {
    const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');

    const respond = (id: unknown, data: unknown) => ({
      id: typeof id === 'string' ? id : undefined,
      ok: true,
      data,
    });

    type WorkspaceShape = typeof params.workspace;
    type ArchivedEntry = typeof params.archivedEntries[number];

    const snapshot = (ws: WorkspaceShape) => ({
      success: true,
      profiles: [ws],
      activeWorkspaceId: ws.id,
      activeWorkspace: ws,
    });

    const GATEWAY_STATUS = { state: 'running', port: 18789, pid: 12345, gatewayReady: true };

    let workspace: WorkspaceShape = params.workspace;
    let archived: ArchivedEntry[] = [...params.archivedEntries];
    const sessionsList = params.sessionsList ?? [
      { key: 'agent:main:session-1700000000000', displayName: 'Chat A' },
      { key: 'agent:main:session-1700000001000', displayName: 'Chat B' },
    ];


    try { ipcMain.removeHandler('host:invoke'); } catch { /* not registered */ }
    ipcMain.handle('host:invoke', async (_event: unknown, request: {
      id?: string;
      module?: string;
      action?: string;
      payload?: Record<string, unknown>;
    }) => {
      const mod = request.module;
      const action = request.action;
      const payload = request.payload ?? {};

      // ── Gateway ──
      if (mod === 'gateway' && action === 'status') {
        return respond(request.id, GATEWAY_STATUS);
      }
      if (mod === 'gateway' && action === 'rpc') {
        const method = typeof payload.method === 'string' ? payload.method : '';
        if (method === 'sessions.list') {
          return respond(request.id, { sessions: sessionsList });
        }
        if (method === 'chat.history') {
          return respond(request.id, {
            messages: [{ role: 'user', content: 'Existing conversation', timestamp: 1_700_000_000_000 }],
          });
        }
        return respond(request.id, {});
      }

      // ── Workspaces ──
      if (mod === 'workspaces' && action === 'list') {
        return respond(request.id, snapshot(workspace));
      }
      if (mod === 'workspaces' && action === 'getActive') {
        return respond(request.id, {
          success: true,
          activeWorkspaceId: workspace.id,
          activeWorkspace: workspace,
        });
      }
      if (mod === 'workspaces' && action === 'saveState') {
        const sessionKey = typeof payload.sessionKey === 'string' ? payload.sessionKey : null;
        const statePatch = payload.state && typeof payload.state === 'object' ? payload.state : {};
        if (sessionKey) {
          workspace = {
            ...workspace,
            sessionStates: {
              ...workspace.sessionStates,
              [sessionKey]: { ...(workspace.sessionStates[sessionKey] ?? {}), ...statePatch },
            },
          };
        }
        return respond(request.id, { success: true });
      }
      if (mod === 'workspaces' && action === 'createFolder') {
        const name = String(payload.name ?? '');
        const folderId = `folder-${Date.now()}`;
        const now = Date.now();
        workspace = {
          ...workspace,
          sessionFolders: [...workspace.sessionFolders, {
            id: folderId,
            name,
            parentId: (payload.parentId as string | null) ?? null,
            order: workspace.sessionFolders.length,
            kind: (payload.kind as 'folder' | 'workgroup') ?? 'workgroup',
            createdAt: now,
            updatedAt: now,
          }],
          updatedAt: now,
        };
        return respond(request.id, snapshot(workspace));
      }
      if (mod === 'workspaces' && action === 'renameFolder') {
        const folderId = String(payload.folderId ?? '');
        const name = String(payload.name ?? '');
        const now = Date.now();
        workspace = {
          ...workspace,
          sessionFolders: workspace.sessionFolders.map((f) =>
            f.id === folderId ? { ...f, name, updatedAt: now } : f,
          ),
          updatedAt: now,
        };
        return respond(request.id, snapshot(workspace));
      }
      if (mod === 'workspaces' && action === 'deleteFolder') {
        const folderId = String(payload.folderId ?? '');
        workspace = {
          ...workspace,
          sessionFolders: workspace.sessionFolders.filter((f) => f.id !== folderId),
          sessionFolderAssignments: Object.fromEntries(
            Object.entries(workspace.sessionFolderAssignments).filter(([, fid]) => fid !== folderId),
          ),
          updatedAt: Date.now(),
        };
        return respond(request.id, snapshot(workspace));
      }
      if (mod === 'workspaces' && action === 'moveSessionToFolder') {
        const sessionKey = String(payload.sessionKey ?? '');
        const folderId = (payload.folderId as string | null) ?? null;
        const assignments = { ...workspace.sessionFolderAssignments };
        if (!folderId) {
          delete assignments[sessionKey];
        } else {
          assignments[sessionKey] = folderId;
        }
        workspace = {
          ...workspace,
          sessionFolderAssignments: assignments,
          updatedAt: Date.now(),
        };
        return respond(request.id, snapshot(workspace));
      }

      // ── Sessions ──
      if (mod === 'sessions' && action === 'listArchived') {
        return respond(request.id, { success: true, entries: archived });
      }
      if (mod === 'sessions' && action === 'archive') {
        const sessionKey = String(payload.sessionKey ?? '');
        archived = [...archived, {
          ...params.archivedEntries[0],
          sessionKey,
          label: `Archived ${sessionKey}`,
          archivedAt: Date.now(),
        }];
        return respond(request.id, { success: true, entries: archived });
      }
      if (mod === 'sessions' && action === 'restore') {
        const sessionKey = String(payload.sessionKey ?? '');
        archived = archived.filter((e) => e.sessionKey !== sessionKey);
        return respond(request.id, { success: true });
      }
      if (mod === 'sessions' && action === 'permanentDelete') {
        const sessionKey = String(payload.sessionKey ?? '');
        archived = archived.filter((e) => e.sessionKey !== sessionKey);
        return respond(request.id, { success: true });
      }
      if (mod === 'sessions' && action === 'delete') {
        return respond(request.id, { success: true });
      }
      if (mod === 'sessions' && action === 'summaries') {
        return respond(request.id, { success: true, summaries: [] });
      }
      if (mod === 'sessions' && action === 'compactionStatus') {
        return respond(request.id, {
          success: true,
          available: true,
          canCompact: true,
          inProgress: false,
          pressure: 'low',
          truncatedMessageCount: 0,
          warnings: [],
        });
      }

      // ── Usage ──
      if (mod === 'usage' && action === 'contextRange') {
        return respond(request.id, {
          success: true,
          range: {
            sessionKey: payload.sessionKey ?? '',
            usedTokens: 1000,
            maxTokens: 128000,
            truncatedMessageCount: 0,
            status: 'bestEffort',
          },
        });
      }
      if (mod === 'usage' && action === 'live') {
        return respond(request.id, { success: true, usage: null });
      }

      // ── Agents ──
      if (mod === 'agents' && action === 'list') {
        return respond(request.id, {
          success: true,
          agents: [{ id: 'main', name: 'Main' }],
        });
      }

      // ── Settings ──
      if (mod === 'settings' && action === 'getMany') {
        return respond(request.id, {});
      }
      if (mod === 'settings' && action === 'getAll') {
        return respond(request.id, {});
      }

      // Default: return success for unhandled calls.
      return respond(request.id, { success: true });
    });
  }, {
    workspace: options.workspace,
    archivedEntries: options.archivedEntries,
    sessionsList: options.sessionsList ?? SESSIONS_LIST,
  });
  await installIpcMocks(electronApp, { gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true } });
}

test.describe('Sidebar session workgroups and archive', () => {
  test('pins the project header instead of repeating it per row, and supports pinned, unread, priority, and active sorting', async ({ electronApp, page }) => {
    await setupStatefulHostHandler(electronApp, {
      workspace: makeBaseWorkspace(),
      archivedEntries: [],
    });

    await page.getByTestId('setup-skip-button').click().catch(() => {});
    await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId(`sidebar-session-${SESSION_KEY_A}`)).toBeVisible({ timeout: 15000 });

    /*
     * The project name is answered ONCE, by the section title plus the sticky
     * project header — not by a subtitle on every conversation row. The row
     * assertion is a negative one on purpose: the subtitle is what doubled the
     * row height, so its absence is the thing worth locking.
     */
    await expect(page.getByTestId('sidebar-session-section-toggle')).toContainText('Projects');
    await expect(page.getByTestId('sidebar-session-project-toggle-workspace-folders'))
      .toContainText('Folder Test Workspace');
    await expect(page.locator('[data-testid^="sidebar-session-project-subtitle-"]')).toHaveCount(0);
    const stickyPosition = await page
      .getByTestId('sidebar-session-project-toggle-workspace-folders')
      .evaluate((element) => getComputedStyle(element.closest('.sidebar-row') as Element).position);
    expect(stickyPosition).toBe('sticky');

    await revealSectionHeadingActionsFor(page.getByTestId('sidebar-session-organize'));
    await page.getByTestId('sidebar-session-organize').click();
    await page.getByRole('menuitemradio', { name: 'Priority' }).click();

    const priorityOrder = await page.locator('[data-testid^="sidebar-session-agent:main:session-"]').evaluateAll((elements) =>
      elements.map((element) => element.getAttribute('data-testid')),
    );
    expect(priorityOrder.slice(0, 2)).toEqual([
      `sidebar-session-${SESSION_KEY_B}`,
      `sidebar-session-${SESSION_KEY_A}`,
    ]);

    // Unread is no longer a permanent hover button; it lives in the row's
    // right-click action menu.
    await page.getByTestId(`sidebar-session-${SESSION_KEY_B}`).click({ button: 'right' });
    await expect(page.getByTestId(`sidebar-session-context-menu-${SESSION_KEY_B}`)).toBeVisible();
    await page.getByTestId('sidebar-session-context-unread').click();
    await page.getByTestId(`sidebar-session-${SESSION_KEY_B}`).click();
    await expect(page.getByTestId(`sidebar-session-unread-${SESSION_KEY_B}`)).toHaveCount(0);

    await revealSectionHeadingActionsFor(page.getByTestId('sidebar-session-organize'));
    await page.getByTestId('sidebar-session-organize').click();
    await page.getByRole('menuitemradio', { name: 'Most active' }).click();
    const activeOrder = await page.locator('[data-testid^="sidebar-session-agent:main:session-"]').evaluateAll((elements) =>
      elements.map((element) => element.getAttribute('data-testid')),
    );
    expect(activeOrder.slice(0, 2)).toEqual([
      `sidebar-session-${SESSION_KEY_B}`,
      `sidebar-session-${SESSION_KEY_A}`,
    ]);

    await page.getByTestId(`sidebar-session-${SESSION_KEY_A}`).hover();
    await page.getByTestId(`sidebar-session-pin-${SESSION_KEY_A}`).click();
    await expect(page.getByTestId(`sidebar-session-pinned-${SESSION_KEY_A}`)).toBeVisible();
  });

  test('keeps workgroups inside the project and renders time sorting as a direct list', async ({ electronApp, page }) => {
    await setupStatefulHostHandler(electronApp, {
      workspace: makeBaseWorkspace(),
      archivedEntries: [],
    });

    await page.getByTestId('setup-skip-button').click().catch(() => {});
    await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('sidebar-session-project-toggle-workspace-folders')).toBeVisible({ timeout: 10000 });

    await revealSectionHeadingActionsFor(page.getByTestId('sidebar-session-organize'));
    await page.getByTestId('sidebar-session-organize').click();
    await page.getByRole('menuitemradio', { name: 'Time' }).click();

    await expect(page.getByTestId('sidebar-session-project-workspace-folders')).toHaveCount(0);
    await expect(page.locator('[data-testid^="sidebar-folder-"]')).toHaveCount(0);
    await expect(page.locator('[data-testid^="sidebar-time-slice-"]')).toHaveCount(0);
    const orderedSessionIds = await page
      .locator('[data-testid^="sidebar-session-agent:main:session-"]')
      .evaluateAll((elements) => elements.map((element) => element.getAttribute('data-testid')));
    expect(orderedSessionIds).toEqual([
      `sidebar-session-${SESSION_KEY_B}`,
      `sidebar-session-${SESSION_KEY_A}`,
    ]);
  });

  test('creates a workgroup, moves a running session into it, searches it, then deletes the workgroup', async ({ electronApp, page }, testInfo) => {
    await setupStatefulHostHandler(electronApp, {
      workspace: makeBaseWorkspace(),
      archivedEntries: [],
    });

    await page.getByTestId('setup-skip-button').click().catch(() => {});
    await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 15000 });

    // The workspace group is expanded by default; sessions become visible once
    // loadSessions resolves. Waiting on the project container ensures the group
    // is rendered, and the session rows should follow.
    await expect(page.getByTestId('sidebar-session-project-workspace-folders')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('sidebar-session-project-toggle-workspace-folders')).toBeVisible();
    await expect(page.getByTestId(`sidebar-session-${SESSION_KEY_A}`)).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId(`sidebar-session-${SESSION_KEY_B}`)).toBeVisible({ timeout: 15000 });

    // Create a new workgroup. The affordance is hover-revealed management
    // chrome, so the workspace group must be hovered first.
    await page.locator('.project-tasks').first().hover();
    await page.getByTestId('sidebar-folder-create-workspace-folders').click();
    await page.getByPlaceholder('Workstream name').fill('Research');
    await page.getByPlaceholder('Workstream name').press('Enter');

    // The workgroup should appear in the sidebar.
    await expect(page.getByText('Research')).toBeVisible({ timeout: 5000 });

    // Move session B into the workgroup from its ⋯ menu. The hover strip is
    // exactly pin then ⋯; every other action lives in that one menu.
    const pinAction = page.getByTestId(`sidebar-session-pin-${SESSION_KEY_B}`);
    const moreAction = page.getByTestId(`sidebar-session-more-${SESSION_KEY_B}`);
    await hoverUntilVisible(page.getByTestId(`sidebar-session-${SESSION_KEY_B}`), moreAction);
    await expect(pinAction).toBeVisible();
    await expectActionBefore(pinAction, moreAction);
    for (const retired of ['move', 'rename', 'delete']) {
      await expect(page.getByTestId(`sidebar-session-${retired}-${SESSION_KEY_B}`)).toHaveCount(0);
    }
    await moreAction.click();
    const moreMenu = page.getByTestId(`sidebar-session-context-menu-${SESSION_KEY_B}`);
    await expect(moreMenu).toBeVisible();
    await expect(moreAction).toHaveAttribute('aria-expanded', 'true');
    // Anchored under its button: the menu's right edge meets the button's.
    const [menuBox, moreBox] = await Promise.all([moreMenu.boundingBox(), moreAction.boundingBox()]);
    expect(Math.abs((menuBox!.x + menuBox!.width) - (moreBox!.x + moreBox!.width))).toBeLessThanOrEqual(2);
    await page.getByTestId('sidebar-session-context-move').click();
    await moreMenu.getByText('Research').click();
    await expect(moreMenu).toBeHidden();

    // The session should still be visible (now inside the workgroup), and the
    // workgroup should surface its aggregate running state and session count.
    await expect(page.getByTestId(`sidebar-session-${SESSION_KEY_B}`)).toBeVisible();
    const folderContainer = page.locator('[data-testid^="sidebar-folder-folder-"]').filter({ hasText: 'Research' });
    /*
     * Count and aggregate state are ONE mark now, and it only appears while the
     * group is shut.
     *
     * Open, the members are right there — a number restating them just pulled the
     * eye to the right edge, where it also collided with the hover controls. And
     * the state used to be a second dot beside it; a shut group is the only place
     * that state is not already visible on the rows themselves, so it rides the
     * count as a tint plus the accessible label.
     */
    await expect(folderContainer.locator('[data-testid^="sidebar-workgroup-count-"]')).toHaveCount(0);
    await folderContainer.locator('[data-testid^="sidebar-folder-toggle-"]').first().click();
    const workgroupCount = folderContainer.locator('[data-testid^="sidebar-workgroup-count-"]');
    await expect(workgroupCount).toHaveText('1');
    /* Chat B is seeded as `waiting_approval`, and waiting outranks running in
       the aggregate (a group holding a conversation that needs the user is a
       group that needs the user). Asserting /Running/ here predates that
       fixture state. */
    await expect(workgroupCount).toHaveAttribute('aria-label', /Waiting/);
    await folderContainer.locator('[data-testid^="sidebar-folder-toggle-"]').first().click();
    await expect(page.getByTestId('sidebar-workgroup-ungrouped-workspace-folders')).toContainText('Unfiled');
    await page.screenshot({ path: testInfo.outputPath('workgroup-sidebar.png'), fullPage: true });

    // Workgroup names participate in the spotlight search.
    await revealSectionHeadingActionsFor(page.getByTestId('sidebar-session-search'));
    await page.getByTestId('sidebar-session-search').click();
    await page.getByPlaceholder('Search conversations by name, workgroup, workspace, or agent...').fill('Research');
    await expect(page.getByTestId('session-search-modal')).toBeVisible();
    await expect(page.getByTestId('session-search-result-0')).toContainText('Chat B');
    await expect(page.getByTestId('session-search-result-0')).toContainText('Research');
    await page.keyboard.press('Escape');

    // Delete the workgroup. The delete button's testid uses the dynamic folder ID,
    // so locate the folder row by name and find the delete button within it.
    // Only the group's OWN header row reveals its controls.
    await hoverUntilVisible(
      folderContainer.locator('[data-testid^="sidebar-folder-toggle-"]'),
      folderContainer.locator('[data-testid^="sidebar-folder-delete-"]'),
    );
    await folderContainer.locator('[data-testid^="sidebar-folder-delete-"]').click();

    // After deletion, the workgroup name should disappear.
    await expect(page.getByText('Research')).toBeHidden({ timeout: 5000 });
  });

  test('delete dialog offers archive and permanent delete; archive modal restores sessions', async ({ electronApp, page }) => {
    await setupStatefulHostHandler(electronApp, {
      workspace: makeBaseWorkspace(),
      archivedEntries: [archivedEntry],
    });

    await page.getByTestId('setup-skip-button').click().catch(() => {});
    await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 15000 });

    await expect(page.getByTestId('sidebar-session-project-workspace-folders')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId(`sidebar-session-${SESSION_KEY_B}`)).toBeVisible({ timeout: 15000 });

    // Delete session B from its ⋯ menu. The row's controls are hover-revealed
    // and the sidebar re-renders as sessions settle, so wait for the button to
    // actually appear rather than trusting a single hover.
    await hoverUntilVisible(
      page.getByTestId(`sidebar-session-${SESSION_KEY_B}`),
      page.getByTestId(`sidebar-session-more-${SESSION_KEY_B}`),
    );
    await page.getByTestId(`sidebar-session-more-${SESSION_KEY_B}`).click();
    await page.getByTestId('sidebar-session-context-delete').click();

    // The delete dialog should show three buttons.
    await expect(page.getByTestId('session-delete-dialog')).toBeVisible();
    await expect(page.getByTestId('session-delete-dialog-cancel')).toBeVisible();
    await expect(page.getByTestId('session-delete-dialog-archive')).toBeVisible();
    await expect(page.getByTestId('session-delete-dialog-permanent')).toBeVisible();

    // Click Archive — session should disappear from sidebar.
    await page.getByTestId('session-delete-dialog-archive').click();
    await expect(page.getByTestId('session-delete-dialog')).toBeHidden({ timeout: 5000 });
    await expect(page.getByTestId(`sidebar-session-${SESSION_KEY_B}`)).toBeHidden({ timeout: 5000 });

    // Archive is available in the compact FakeCoding footer menu.
    await page.getByTestId('sidebar-footer-menu-trigger').click();
    await page.getByTestId('sidebar-archive').click();
    await expect(page.getByTestId('settings-archived-section')).toBeVisible();

    // The pre-existing archived entry should be visible.
    await expect(page.getByTestId(`settings-archived-item-${ARCHIVED_SESSION_KEY}`)).toBeVisible();

    // Restore it.
    await page.getByTestId(`settings-archived-restore-${ARCHIVED_SESSION_KEY}`).click();
    await expect(page.getByTestId(`settings-archived-item-${ARCHIVED_SESSION_KEY}`)).toBeHidden({ timeout: 5000 });
  });

  test('drags a conversation after another to auto-group, rename, and remove the group', async ({ electronApp, page }) => {
    await setupStatefulHostHandler(electronApp, {
      workspace: makeBaseWorkspace(),
      archivedEntries: [],
    });

    await page.getByTestId('setup-skip-button').click().catch(() => {});
    await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId(`sidebar-session-${SESSION_KEY_A}`)).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId(`sidebar-session-${SESSION_KEY_B}`)).toBeVisible({ timeout: 15000 });

    // HTML5 drag-and-drop: drag Chat A and drop it AFTER Chat B. Playwright's
    // locator.dragTo() is mouse-based; dispatching the drag event sequence
    // keeps the E2E deterministic and exercises the same React handlers.
    await page.evaluate(async ({ sourceKey, targetKey }) => {
      const source = document.querySelector<HTMLElement>(`[data-testid="sidebar-session-drag-${sourceKey}"]`);
      const target = document.querySelector<HTMLElement>(`[data-testid="sidebar-session-drag-${targetKey}"]`);
      if (!source || !target) throw new Error('Missing drag source or drop target');

      const dataTransfer = new DataTransfer();
      source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer }));
      // Let React commit the drag-source state before the drop target decides
      // whether it should accept the drag.
      await new Promise((resolve) => setTimeout(resolve, 50));
      target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer }));
      target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
      source.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer }));
    }, { sourceKey: SESSION_KEY_A, targetKey: SESSION_KEY_B });

    /* Match the group CONTAINER only. `[data-testid^="sidebar-folder-"]` also
       matches its own toggle button (`sidebar-folder-toggle-<id>`), and both
       carry the group name — which is a strict-mode violation, not a choice
       between two candidates. Folder ids are themselves `folder-*`, so the
       container's testid starts with `sidebar-folder-folder-`. */
    const groupByName = (name: string) => page
      .locator('div[data-testid^="sidebar-folder-folder-"]')
      .filter({ hasText: name });

    // Both conversations land in the auto-created workgroup named after the
    // drop target.
    const autoGroup = groupByName('Chat B group');
    await expect(autoGroup).toBeVisible({ timeout: 5000 });
    await expect(autoGroup.locator(`[data-testid="sidebar-session-${SESSION_KEY_A}"]`)).toBeVisible();
    await expect(autoGroup.locator(`[data-testid="sidebar-session-${SESSION_KEY_B}"]`)).toBeVisible();
    /* The count is a shut-group affordance (see the comment in the workgroup
       test above), and a freshly auto-created group is OPEN — so read it by
       folding the group, after its members have been asserted while visible. */
    const autoGroupToggle = autoGroup.locator('[data-testid^="sidebar-folder-toggle-"]').first();
    await autoGroupToggle.click();
    await expect(autoGroup.locator('[data-testid^="sidebar-workgroup-count-"]')).toHaveText('2');
    await autoGroupToggle.click();

    // Rename the auto-created group.
    /* Pin the group by ID first. Renaming swaps the header row for an <input>,
       and `filter({ hasText })` reads text content — not input values — so a
       name-based locator stops matching the moment the editor opens. */
    const autoGroupTestId = await autoGroup.getAttribute('data-testid');
    expect(autoGroupTestId).toBeTruthy();
    const autoGroupById = page.getByTestId(autoGroupTestId!);
    await hoverUntilVisible(
      autoGroupById.locator('[data-testid^="sidebar-folder-toggle-"]'),
      autoGroupById.locator('button[aria-label="Rename workstream"]'),
    );
    await autoGroupById.locator('button[aria-label="Rename workstream"]').click();
    await autoGroupById.locator('input').fill('Prompt pairing');
    await autoGroupById.locator('input').press('Enter');

    const renamedGroup = groupByName('Prompt pairing');
    await expect(renamedGroup).toBeVisible({ timeout: 5000 });

    // Removing the group keeps the conversations and returns them to the
    // ungrouped area.
    await hoverUntilVisible(
      renamedGroup.locator('[data-testid^="sidebar-folder-toggle-"]'),
      renamedGroup.locator('[data-testid^="sidebar-folder-delete-"]'),
    );
    await renamedGroup.locator('[data-testid^="sidebar-folder-delete-"]').click();
    await expect(groupByName('Prompt pairing')).toBeHidden({ timeout: 5000 });
    await expect(page.getByTestId(`sidebar-session-${SESSION_KEY_A}`)).toBeVisible();
    await expect(page.getByTestId(`sidebar-session-${SESSION_KEY_B}`)).toBeVisible();
  });

  test('permanent delete from the archived settings page removes the entry', async ({ electronApp, page }) => {
    await setupStatefulHostHandler(electronApp, {
      workspace: makeBaseWorkspace(),
      archivedEntries: [archivedEntry],
      sessionsList: [{ key: SESSION_KEY_A, displayName: 'Chat A' }],
    });

    await page.getByTestId('setup-skip-button').click().catch(() => {});
    await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 15000 });

    // Open Settings -> Archived via the compact footer menu.
    await page.getByTestId('sidebar-footer-menu-trigger').click();
    await expect(page.getByTestId('sidebar-archive')).toBeVisible({ timeout: 10000 });
    await page.getByTestId('sidebar-archive').click();
    await expect(page.getByTestId('settings-archived-section')).toBeVisible();

    // Verify the archived entry is present.
    await expect(page.getByTestId(`settings-archived-item-${ARCHIVED_SESSION_KEY}`)).toBeVisible();

    // Click permanent delete.
    await page.getByTestId(`settings-archived-delete-${ARCHIVED_SESSION_KEY}`).click();
    await expect(page.getByTestId(`settings-archived-item-${ARCHIVED_SESSION_KEY}`)).toBeHidden({ timeout: 5000 });
  });
});
