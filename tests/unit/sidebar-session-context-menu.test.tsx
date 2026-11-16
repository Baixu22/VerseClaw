/**
 * Sidebar conversation action menu (the row's ⋯ button, or right-click).
 *
 * What is worth locking here is the CONTRACT of the menu, not its markup:
 *
 *  1. the row's hover strip is exactly pin + ⋯; ⋯ (and right-click) open the
 *     same menu, anchored to that session;
 *  2. "mark as unread", rename, move and delete are reachable from the menu —
 *     the permanent hover buttons are gone and must not come back by accident;
 *  3. the migrate page files the session by (workspaceId, sessionKey, folderId),
 *     including back OUT of a workgroup (the audit's F3 one-way door);
 *  4. archive is one click and offers an undo; permanent delete keeps its
 *     confirmation dialog;
 *  5. handoff parks an intent instead of trying to own the draft dialog, so the
 *     chat page stays the single owner of that flow.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TooltipProvider } from '@/components/ui/tooltip';

const { gatewayState, agentsState } = vi.hoisted(() => ({
  gatewayState: { status: { state: 'running', port: 18789, gatewayReady: true, pid: 1, connectedAt: 1, gatewayRestarting: false } },
  agentsState: { agents: [{ id: 'main', name: 'main' }], fetchAgents: vi.fn() },
}));

const { navigateMock } = vi.hoisted(() => ({ navigateMock: vi.fn() }));
const { toastMock } = vi.hoisted(() => ({
  toastMock: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('sonner', () => ({ toast: toastMock }));

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigateMock, useLocation: () => ({ pathname: '/' }) };
});

vi.mock('@/stores/gateway', () => {
  const useGatewayStore = Object.assign(
    (selector: (state: typeof gatewayState) => unknown) => selector(gatewayState),
    { getState: () => gatewayState },
  );
  return { useGatewayStore };
});

vi.mock('@/stores/agents', () => ({
  useAgentsStore: (selector: (state: typeof agentsState) => unknown) => selector(agentsState),
}));

vi.mock('@/stores/inbox', () => ({
  useInboxStore: (selector: (state: { items: unknown[]; refresh: () => void }) => unknown) =>
    selector({ items: [], refresh: vi.fn() }),
  isInboxItemActionable: () => false,
}));

vi.mock('@/lib/host-api', () => ({
  hostApi: {
    window: { syncTrafficLightPosition: vi.fn().mockResolvedValue(undefined) },
    dialog: { open: vi.fn().mockResolvedValue({ canceled: true, filePaths: [] }) },
  },
}));

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown> | string) => (typeof params === 'string' ? params : key),
    i18n: { language: 'en' },
  }),
}));

const SESSION_KEY = 'agent:main:one';
const OTHER_SESSION_KEY = 'agent:main:two';

async function renderSidebar(overrides?: {
  moveSessionToFolder?: ReturnType<typeof vi.fn>;
  archiveSession?: ReturnType<typeof vi.fn>;
  restoreSession?: ReturnType<typeof vi.fn>;
  assignments?: Record<string, string>;
}) {
  const { useChatStore } = await import('@/stores/chat');
  const { useWorkspacesStore } = await import('@/stores/workspaces');
  const { useSessionIntentStore } = await import('@/stores/session-intent');

  const workspace = {
    id: 'ws-1',
    name: 'repo',
    rootPath: 'C:/work/repo',
    activeSessionKey: SESSION_KEY,
    sessionStates: { [SESSION_KEY]: {}, [OTHER_SESSION_KEY]: {} },
    sessionFolders: [
      { id: 'folder-a', name: 'Research', parentId: null, order: 0, createdAt: 1, updatedAt: 2 },
    ],
    sessionFolderAssignments: overrides?.assignments ?? {},
    lastOpenedAt: 1_700_000_000_000,
  };

  useWorkspacesStore.setState({
    profiles: [workspace],
    activeWorkspace: workspace,
    activeWorkspaceId: workspace.id,
    loading: false,
    error: null,
    saveWorkspaceState: vi.fn().mockResolvedValue({ success: true }),
    ...(overrides?.moveSessionToFolder ? { moveSessionToFolder: overrides.moveSessionToFolder } : {}),
  } as never);

  useChatStore.setState({
    sessions: [
      { key: SESSION_KEY, displayName: 'Chat one' },
      { key: OTHER_SESSION_KEY, displayName: 'Chat two' },
    ],
    messages: [{ role: 'user', content: 'hi' }],
    currentSessionKey: OTHER_SESSION_KEY,
    sessionLabels: { [SESSION_KEY]: 'Chat one', [OTHER_SESSION_KEY]: 'Chat two' },
    sessionLastActivity: { [SESSION_KEY]: 1_700_000_000_000, [OTHER_SESSION_KEY]: 1_699_999_000_000 },
    runtimeRuns: {},
    activeRunId: null,
    sending: false,
    pendingFinal: false,
    runError: null,
    startupPhase: 'ready',
    ...(overrides?.archiveSession ? { archiveSession: overrides.archiveSession } : {}),
    ...(overrides?.restoreSession ? { restoreSession: overrides.restoreSession } : {}),
  } as never);

  useSessionIntentStore.getState().clear();

  const { Sidebar } = await import('@/components/layout/Sidebar');
  const view = render(<MemoryRouter><TooltipProvider><Sidebar /></TooltipProvider></MemoryRouter>);
  await screen.findByTestId(`sidebar-session-${SESSION_KEY}`);
  return { view, useSessionIntentStore };
}

describe('sidebar conversation action menu', () => {
  beforeEach(() => {
    vi.resetModules();
    navigateMock.mockClear();
    toastMock.success.mockClear();
    toastMock.error.mockClear();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it('keeps the hover strip to pin + more and opens the full menu on right-click', async () => {
    await renderSidebar();

    const strip = screen.getByTestId(`sidebar-session-pin-${SESSION_KEY}`).parentElement!;
    expect([...strip.querySelectorAll('button')].map((button) => button.dataset.testid)).toEqual([
      `sidebar-session-pin-${SESSION_KEY}`,
      `sidebar-session-more-${SESSION_KEY}`,
    ]);
    for (const retired of ['read', 'rename', 'delete', 'move']) {
      expect(screen.queryByTestId(`sidebar-session-${retired}-${SESSION_KEY}`)).toBeNull();
    }

    fireEvent.contextMenu(screen.getByTestId(`sidebar-session-${SESSION_KEY}`));

    expect(screen.getByTestId(`sidebar-session-context-menu-${SESSION_KEY}`)).toBeInTheDocument();
    for (const testId of [
      'sidebar-session-context-move',
      'sidebar-session-context-rename',
      'sidebar-session-context-unread',
      'sidebar-session-context-pin',
      'sidebar-session-context-fork',
      'sidebar-session-context-handoff',
      'sidebar-session-context-copy-path',
      'sidebar-session-context-copy-id',
      'sidebar-session-context-archive',
      'sidebar-session-context-delete',
    ]) {
      expect(screen.getByTestId(testId)).toBeInTheDocument();
    }
  });

  it('opens the same menu from the row\'s ⋯ button, anchored under it, and toggles closed', async () => {
    await renderSidebar();
    const more = screen.getByTestId(`sidebar-session-more-${SESSION_KEY}`);
    expect(more).toHaveAttribute('aria-haspopup', 'menu');
    expect(more).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(more);

    const menu = screen.getByTestId(`sidebar-session-context-menu-${SESSION_KEY}`);
    expect(menu).toHaveAttribute('data-align', 'end');
    expect(more).toHaveAttribute('aria-expanded', 'true');
    // The row keeps its controls and highlight while its menu is open.
    expect(more.closest('.sidebar-row')).toHaveAttribute('data-force-actions', 'true');

    // Pressing ⋯ again must close, not close-then-reopen.
    fireEvent.pointerDown(more);
    fireEvent.click(more);
    expect(screen.queryByTestId(`sidebar-session-context-menu-${SESSION_KEY}`)).toBeNull();
    expect(more).toHaveAttribute('aria-expanded', 'false');
    expect(more.closest('.sidebar-row')).not.toHaveAttribute('data-force-actions');
  });

  it('hands the open state to the next row when another row\'s menu opens', async () => {
    await renderSidebar();
    const first = screen.getByTestId(`sidebar-session-more-${SESSION_KEY}`);
    fireEvent.click(first);
    expect(first).toHaveAttribute('aria-expanded', 'true');

    fireEvent.contextMenu(screen.getByTestId(`sidebar-session-${OTHER_SESSION_KEY}`));

    expect(first).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByTestId(`sidebar-session-context-menu-${OTHER_SESSION_KEY}`)).toBeInTheDocument();
    expect(screen.queryByTestId(`sidebar-session-context-menu-${SESSION_KEY}`)).toBeNull();
  });

  it('moves a session filed inside a workgroup back out from its ⋯ menu', async () => {
    const moveSessionToFolder = vi.fn().mockResolvedValue(undefined);
    await renderSidebar({ moveSessionToFolder, assignments: { [SESSION_KEY]: 'folder-a' } });

    // The row now renders inside the workgroup and still carries ⋯.
    expect(screen.getByTestId('sidebar-folder-folder-a')).toContainElement(screen.getByTestId(`sidebar-session-${SESSION_KEY}`));
    fireEvent.click(screen.getByTestId(`sidebar-session-more-${SESSION_KEY}`));
    fireEvent.click(screen.getByTestId('sidebar-session-context-move'));

    // The current group is the checked entry; "no workgroup" is the way out.
    expect(screen.getByTestId('sidebar-session-context-move-to-folder-a')).toHaveClass('checked');
    fireEvent.click(screen.getByTestId('sidebar-session-context-move-none'));

    await waitFor(() => expect(moveSessionToFolder).toHaveBeenCalledWith('ws-1', SESSION_KEY, null));
  });

  it('archives in one click and offers an undo that restores the session', async () => {
    const archiveSession = vi.fn().mockResolvedValue(undefined);
    const restoreSession = vi.fn().mockResolvedValue(undefined);
    await renderSidebar({ archiveSession, restoreSession });

    fireEvent.click(screen.getByTestId(`sidebar-session-more-${SESSION_KEY}`));
    await act(async () => {
      fireEvent.click(screen.getByTestId('sidebar-session-context-archive'));
    });

    // The archive records where the session lived (project, no workgroup here).
    expect(archiveSession).toHaveBeenCalledWith(SESSION_KEY, { workspaceId: 'ws-1', folderId: null });
    // No confirmation dialog for a reversible action.
    expect(screen.queryByTestId('session-delete-dialog')).toBeNull();
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledTimes(1));
    const [, options] = toastMock.success.mock.calls[0] as [string, { action: { label: string; onClick: () => void } }];
    expect(options.action.label).toBe('chat:sidebar.undo');
    options.action.onClick();
    expect(restoreSession).toHaveBeenCalledWith(SESSION_KEY);
  });

  it('keeps permanent deletion behind the confirmation dialog', async () => {
    await renderSidebar();

    fireEvent.click(screen.getByTestId(`sidebar-session-more-${SESSION_KEY}`));
    fireEvent.click(screen.getByTestId('sidebar-session-context-delete'));

    expect(await screen.findByTestId('session-delete-dialog')).toBeInTheDocument();
  });

  it('files the session into a workstream from the migrate page', async () => {
    const moveSessionToFolder = vi.fn().mockResolvedValue(undefined);
    await renderSidebar({ moveSessionToFolder });

    fireEvent.contextMenu(screen.getByTestId(`sidebar-session-${SESSION_KEY}`));
    fireEvent.click(screen.getByTestId('sidebar-session-context-move'));

    // Second page of the same menu — not a nested popover.
    expect(screen.getByTestId('sidebar-session-context-move-none')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('sidebar-session-context-move-to-folder-a'));

    await waitFor(() => expect(moveSessionToFolder).toHaveBeenCalledWith('ws-1', SESSION_KEY, 'folder-a'));
    // Acting closes the menu.
    expect(screen.queryByTestId(`sidebar-session-context-menu-${SESSION_KEY}`)).toBeNull();
  });

  it('copies the project work path of the right-clicked session', async () => {
    await renderSidebar();

    fireEvent.contextMenu(screen.getByTestId(`sidebar-session-${SESSION_KEY}`));
    fireEvent.click(screen.getByTestId('sidebar-session-context-copy-path'));

    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith('C:/work/repo'));
  });

  it('parks a handoff intent for the chat page instead of drafting inline', async () => {
    const { useSessionIntentStore } = await renderSidebar();

    fireEvent.contextMenu(screen.getByTestId(`sidebar-session-${SESSION_KEY}`));
    await act(async () => {
      fireEvent.click(screen.getByTestId('sidebar-session-context-handoff'));
    });

    const intent = useSessionIntentStore.getState().intent;
    expect(intent).toMatchObject({ kind: 'handoff', sessionKey: SESSION_KEY });
    expect(navigateMock).toHaveBeenCalledWith('/');
  });
});
