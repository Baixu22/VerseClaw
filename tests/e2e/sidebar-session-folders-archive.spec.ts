import { expect, test } from './fixtures/electron';
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
  { key: SESSION_KEY_A, displayName: 'Chat A' },
  { key: SESSION_KEY_B, displayName: 'Chat B', status: 'running', hasActiveRun: true },
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
    sessionsList?: Array<{ key: string; displayName: string; status?: string; hasActiveRun?: boolean }>;
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

    // Set up legacy gateway:status channel (some main-process code may poll it).
    try { ipcMain.removeHandler('gateway:status'); } catch { /* not registered */ }
    ipcMain.handle('gateway:status', async () => GATEWAY_STATUS);

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
          return respond(request.id, { messages: [] });
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
}

test.describe('Sidebar session workgroups and archive', () => {
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
    await expect(page.getByTestId(`sidebar-session-${SESSION_KEY_A}`)).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId(`sidebar-session-${SESSION_KEY_B}`)).toBeVisible({ timeout: 15000 });

    // Create a new workgroup. The affordance is hover-revealed management
    // chrome, so the workspace group must be hovered first.
    await page.locator('.project-tasks').first().hover();
    await page.getByTestId('sidebar-folder-create-workspace-folders').click();
    await page.getByPlaceholder('Workgroup name').fill('Research');
    await page.getByPlaceholder('Workgroup name').press('Enter');

    // The workgroup should appear in the sidebar.
    await expect(page.getByText('Research')).toBeVisible({ timeout: 5000 });

    // Move session B into the workgroup via the move menu.
    await page.getByTestId(`sidebar-session-${SESSION_KEY_B}`).hover();
    const moveAction = page.getByTestId(`sidebar-session-move-${SESSION_KEY_B}`);
    const renameAction = page.getByTestId(`sidebar-session-rename-${SESSION_KEY_B}`);
    const deleteAction = page.getByTestId(`sidebar-session-delete-${SESSION_KEY_B}`);
    await expect(moveAction).toBeVisible();
    await expect(renameAction).toBeVisible();
    await expect(deleteAction).toBeVisible();
    await expectActionBefore(moveAction, renameAction);
    await expectActionBefore(renameAction, deleteAction);
    await page.getByTestId(`sidebar-session-move-${SESSION_KEY_B}`).click();
    await expect(page.getByTestId(`sidebar-session-move-menu-${SESSION_KEY_B}`)).toBeVisible();
    await page.getByTestId(`sidebar-session-move-menu-${SESSION_KEY_B}`).getByText('Research').click();

    // The session should still be visible (now inside the workgroup), and the
    // workgroup should surface its aggregate running state and session count.
    await expect(page.getByTestId(`sidebar-session-${SESSION_KEY_B}`)).toBeVisible();
    const folderContainer = page.locator('[data-testid^="sidebar-folder-folder-"]').filter({ hasText: 'Research' });
    // Aggregate state is a bare dot in the row; its wording rides the label so
    // it can never crowd out the workgroup name.
    await expect(folderContainer.locator('[data-testid^="sidebar-workgroup-status-"]'))
      .toHaveAttribute('aria-label', 'Running');
    await expect(folderContainer.locator('[data-testid^="sidebar-workgroup-count-"]')).toHaveText('1');
    await expect(page.getByTestId('sidebar-workgroup-ungrouped-workspace-folders')).toContainText('Ungrouped');
    await page.screenshot({ path: testInfo.outputPath('workgroup-sidebar.png'), fullPage: true });

    // Workgroup names participate in the spotlight search.
    await page.locator('.section-heading').first().hover();
    await page.getByTestId('sidebar-session-search').click();
    await page.getByPlaceholder('Search conversations by name, workgroup, workspace, or agent...').fill('Research');
    await expect(page.getByTestId('session-search-modal')).toBeVisible();
    await expect(page.getByTestId('session-search-result-0')).toContainText('Chat B');
    await expect(page.getByTestId('session-search-result-0')).toContainText('Research');
    await page.keyboard.press('Escape');

    // Delete the workgroup. The delete button's testid uses the dynamic folder ID,
    // so locate the folder row by name and find the delete button within it.
    await folderContainer.hover();
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

    // Click the delete button on session B.
    await page.getByTestId(`sidebar-session-${SESSION_KEY_B}`).hover();
    await page.getByTestId(`sidebar-session-delete-${SESSION_KEY_B}`).click();

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
