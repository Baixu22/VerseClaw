/**
 * Sidebar conversation action menu (right-click).
 *
 * What is worth locking here is the CONTRACT of the menu, not its markup:
 *
 *  1. right-click on a session row opens it, anchored to that session;
 *  2. "mark as unread" is reachable ONLY from the menu now — the permanent
 *     hover button is gone, and it must not come back by accident;
 *  3. the migrate page files the session by (workspaceId, sessionKey, folderId),
 *     the same by-id dispatch the folder tree's regression tests hold;
 *  4. handoff parks an intent instead of trying to own the draft dialog, so the
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

async function renderSidebar(overrides?: { moveSessionToFolder?: ReturnType<typeof vi.fn> }) {
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
    sessionFolderAssignments: {},
    lastOpenedAt: 1_700_000_000_000,
  };

  useWorkspacesStore.setState({
    profiles: [workspace],
    activeWorkspace: workspace,
    activeWorkspaceId: workspace.id,
    loading: false,
    error: null,
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
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it('opens on right-click and offers the actions the hover strip no longer carries', async () => {
    await renderSidebar();

    // The hover strip is down to pin / migrate / rename / delete.
    expect(screen.queryByTestId(`sidebar-session-read-${SESSION_KEY}`)).toBeNull();
    expect(screen.getByTestId(`sidebar-session-pin-${SESSION_KEY}`)).toBeInTheDocument();

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
      'sidebar-session-context-delete',
    ]) {
      expect(screen.getByTestId(testId)).toBeInTheDocument();
    }
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
