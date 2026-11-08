/**
 * Sidebar re-render containment.
 *
 * Regression guard for the audit's F7: the sidebar subscribes to `runtimeRuns`,
 * which is replaced on every runtime event while a run streams. Two things then
 * defeated `SessionRowMemo`:
 *
 *   1. the rename handlers were plain function declarations, so they changed
 *      identity every render and invalidated `renderSessionRow` — which is a
 *      prop of the memoized tree;
 *   2. `buildSidebarSessionStatus` produced a fresh object per event even when
 *      the row's displayed state was identical.
 *
 * Result: every session row re-rendered per streamed token. These tests count
 * actual renders rather than inspecting identities, so they stay meaningful if
 * the implementation changes shape.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { ChatSession } from '@shared/chat/types';

const { gatewayState, agentsState } = vi.hoisted(() => ({
  gatewayState: { status: { state: 'running', port: 18789, gatewayReady: true, pid: 1, connectedAt: 1, gatewayRestarting: false } },
  agentsState: {
    agents: [{ id: 'main', name: 'main' }] as Array<Record<string, unknown>>,
    fetchAgents: vi.fn(),
  },
}));

/**
 * `useNavigate` must return a STABLE function. React Router's real one is
 * stable across renders; returning a fresh `vi.fn()` per call would invalidate
 * `renderSessionRow` on its own and make this test measure the mock instead of
 * the component.
 */
const { navigateMock } = vi.hoisted(() => ({ navigateMock: vi.fn() }));

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useNavigate: () => navigateMock,
    useLocation: () => ({ pathname: '/' }),
  };
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

/**
 * Count SESSION-row renders only. `SidebarRow` also backs the project header
 * and folder rows; counting those conflates "the workspace group re-rendered"
 * with "every conversation in it re-rendered", which is the thing F7 is about.
 * `task-row` is the session variant (Sidebar.tsx).
 */
const { rowRenderCounts } = vi.hoisted(() => ({ rowRenderCounts: { count: 0 } }));

vi.mock('@/components/layout/SidebarRow', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/layout/SidebarRow')>();
  return {
    ...actual,
    SidebarRow: (props: Record<string, unknown>) => {
      if (typeof props.className === 'string' && props.className.includes('task-row')) {
        rowRenderCounts.count += 1;
      }
      return actual.SidebarRow(props as never);
    },
  };
});

const SESSION_KEYS = ['agent:main:one', 'agent:main:two', 'agent:main:three'];

async function seedStores() {
  const { useChatStore } = await import('@/stores/chat');
  const { useWorkspacesStore } = await import('@/stores/workspaces');

  const workspace = {
    id: 'ws-1',
    name: 'repo',
    rootPath: '/repo',
    activeSessionKey: SESSION_KEYS[0],
    sessionStates: Object.fromEntries(SESSION_KEYS.map((key) => [key, {}])),
    sessionFolders: [],
    sessionFolderAssignments: {},
    lastOpenedAt: 1_700_000_000_000,
  };

  useWorkspacesStore.setState({
    profiles: [workspace],
    activeWorkspace: workspace,
    loading: false,
    error: null,
  } as never);

  useChatStore.setState({
    sessions: SESSION_KEYS.map((key) => ({ key, displayName: key })),
    messages: [{ role: 'user', content: 'hi' }],
    currentSessionKey: SESSION_KEYS[0],
    sessionLabels: Object.fromEntries(SESSION_KEYS.map((key) => [key, key])),
    sessionLastActivity: Object.fromEntries(SESSION_KEYS.map((key, i) => [key, 1_700_000_000_000 - i])),
    runtimeRuns: {},
    activeRunId: 'run-1',
    sending: true,
    pendingFinal: false,
    runError: null,
    startupPhase: 'ready',
  } as never);

  return { useChatStore };
}

function mountedKeys(container: HTMLElement): string[] {
  return [...container.querySelectorAll('[data-testid^="sidebar-session-agent:"]')]
    .map((row) => row.getAttribute('data-testid')!.slice('sidebar-session-'.length));
}

async function renderWorkgroups(sessions: ChatSession[], selected: string, sizes: number[]) {
  const { useChatStore } = await seedStores();
  const { useWorkspacesStore } = await import('@/stores/workspaces');
  const assignments: Record<string, string> = {};
  let offset = 0;
  const folders = sizes.map((size, index) => {
    const id = 'budget-group-' + index;
    for (const session of sessions.slice(offset, offset + size)) assignments[session.key] = id;
    offset += size;
    return { id, name: 'Group ' + index, kind: 'workgroup', parentId: null, order: index, createdAt: 1 };
  });
  const workspace = { id: 'ws-1', name: 'repo', rootPath: '/repo', activeSessionKey: selected,
    sessionStates: Object.fromEntries(sessions.map((session) => [session.key, {}])),
    sessionFolders: folders, sessionFolderAssignments: assignments, lastOpenedAt: 1_700_000_000_000 };
  useWorkspacesStore.setState({ profiles: [workspace], activeWorkspace: workspace, activeWorkspaceId: 'ws-1',
    loading: false, error: null } as never);
  useChatStore.setState({ sessions, currentSessionKey: selected, messages: [{ role: 'user', content: 'hi' }],
    sessionLabels: Object.fromEntries(sessions.map((session) => [session.key, session.key])),
    sessionLastActivity: Object.fromEntries(sessions.map((session, index) => [session.key, 1_700_000_000_000 - index])),
    runtimeRuns: {}, activeRunId: null, sending: false, pendingFinal: false } as never);
  const { Sidebar } = await import('@/components/layout/Sidebar');
  const view = render(<MemoryRouter><TooltipProvider><Sidebar /></TooltipProvider></MemoryRouter>);
  await waitFor(() => expect(mountedKeys(view.container).length).toBeGreaterThan(0));
  return { ...view, useChatStore, useWorkspacesStore, assignments };
}

async function scrollToBottom(container: HTMLElement) {
  const scroller = container.querySelector('.sidebar-scroll');
  expect(scroller).not.toBeNull();
  Object.defineProperties(scroller!, {
    scrollHeight: { value: 4_000, configurable: true },
    clientHeight: { value: 600, configurable: true },
    scrollTop: { value: 3_600, configurable: true },
  });
  await act(async () => { scroller!.dispatchEvent(new Event('scroll', { bubbles: true })); });
}

/** Push one streamed runtime event, replacing `runtimeRuns` as the store does. */
async function pushRuntimeEvent(
  useChatStore: Awaited<ReturnType<typeof seedStores>>['useChatStore'],
  seq: number,
) {
  await act(async () => {
    useChatStore.setState({
      runtimeRuns: {
        'run-1': {
          runId: 'run-1',
          sessionKey: SESSION_KEYS[0],
          status: 'running',
          startedAt: 1_700_000_000_000,
          assistantText: 'x'.repeat(seq),
          thinkingText: '',
          events: Array.from({ length: seq }, (_, i) => ({
            type: 'assistant.delta',
            text: 'x'.repeat(i + 1),
            ts: 1_700_000_000_000 + i,
          })),
        },
      },
    } as never);
  });
}

describe('Sidebar re-render containment', () => {
  it('persists the selected session before navigation can remount Chat', async () => {
    const { useChatStore } = await seedStores();
    const { useWorkspacesStore } = await import('@/stores/workspaces');
    const originalSwitch = useChatStore.getState().switchSession;
    const originalSave = useWorkspacesStore.getState().saveWorkspaceState;
    let releaseSave!: () => void;
    const saveGate = new Promise<void>((resolve) => { releaseSave = resolve; });
    const save = vi.fn(async (input: { activeSessionKey?: string }) => {
      if (!input.activeSessionKey) return;
      await saveGate;
      useWorkspacesStore.setState((state) => ({
        activeWorkspace: { ...state.activeWorkspace!, activeSessionKey: input.activeSessionKey! },
      }));
    });
    const change = vi.fn((key: string) => useChatStore.setState({ currentSessionKey: key }));
    useWorkspacesStore.setState({ activeWorkspaceId: 'ws-1', saveWorkspaceState: save });
    useChatStore.setState({ switchSession: change });
    const { Sidebar } = await import('@/components/layout/Sidebar');
    const view = render(<MemoryRouter><TooltipProvider><Sidebar /></TooltipProvider></MemoryRouter>);
    try {
      fireEvent.click(view.getByTestId(`sidebar-session-${SESSION_KEYS[1]}`));
      await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ activeSessionKey: SESSION_KEYS[1] })));
      expect(change).not.toHaveBeenCalled();
      expect(navigateMock).not.toHaveBeenCalled();
      await act(async () => { releaseSave(); await saveGate; });
      await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/'));
      expect(change).toHaveBeenCalledWith(SESSION_KEYS[1]);
      expect(useWorkspacesStore.getState().activeWorkspace?.activeSessionKey).toBe(SESSION_KEYS[1]);
    } finally {
      releaseSave();
      view.unmount();
      useChatStore.setState({ switchSession: originalSwitch });
      useWorkspacesStore.setState({ saveWorkspaceState: originalSave });
    }
  });
  beforeEach(() => {
    vi.resetModules();
    rowRenderCounts.count = 0;
  });

  /**
   * The invariant is that row renders must not SCALE with the number of
   * streamed events — not that the count is some exact number. A fixed
   * post-mount settle (async workspace/session hydration) is fine; growth per
   * token is the bug. Running the same scenario at two very different event
   * counts and demanding the same total states that directly, and stays honest
   * if the settle changes shape.
   */
  it('does not re-render session rows as streamed runtime events arrive', async () => {
    async function countAfter(eventCount: number): Promise<{ mount: number; total: number }> {
      vi.resetModules();
      rowRenderCounts.count = 0;
      const { useChatStore } = await seedStores();
      const { Sidebar } = await import('@/components/layout/Sidebar');

      const view = render(<MemoryRouter><TooltipProvider><Sidebar /></TooltipProvider></MemoryRouter>);
      const mount = rowRenderCounts.count;
      for (let seq = 1; seq <= eventCount; seq += 1) {
        await pushRuntimeEvent(useChatStore, seq);
      }
      const total = rowRenderCounts.count;
      view.unmount();
      return { mount, total };
    }

    const few = await countAfter(5);
    const many = await countAfter(40);

    expect(few.mount).toBeGreaterThan(0);
    // 8x the events, identical render count: the deltas cost the list nothing.
    expect(many.total).toBe(few.total);
    // And the streaming itself adds at most a constant, not a per-event pass.
    expect(many.total - many.mount).toBeLessThanOrEqual(SESSION_KEYS.length);
  });

  it('still re-renders rows when a session status actually changes', async () => {
    const { useChatStore } = await seedStores();
    const { Sidebar } = await import('@/components/layout/Sidebar');

    render(<MemoryRouter><TooltipProvider><Sidebar /></TooltipProvider></MemoryRouter>);
    await pushRuntimeEvent(useChatStore, 1);
    const settled = rowRenderCounts.count;

    // The run ends: the row's status kind flips running -> completed, which is
    // a real change and must reach the DOM.
    await act(async () => {
      useChatStore.setState({
        sending: false,
        activeRunId: null,
        runtimeRuns: {
          'run-1': {
            runId: 'run-1',
            sessionKey: SESSION_KEYS[0],
            status: 'completed',
            startedAt: 1_700_000_000_000,
            endedAt: 1_700_000_001_000,
            assistantText: 'done',
            thinkingText: '',
            events: [],
          },
        },
      } as never);
    });

    expect(rowRenderCounts.count).toBeGreaterThan(settled);
  });
  /**
   * TF-0423: mounting every row of a long-lived sidebar made the renderer emit
   * >50 ms long tasks (6-8 per 2.5 s with 333 sessions vs 0-1 with 20). The list
   * now mounts one chunk at a time; this guards the bound and the scroll-driven
   * growth that keeps every session reachable.
   */
  it('mounts session rows incrementally instead of all at once', async () => {
    const keys = Array.from({ length: 200 }, (_, index) => `agent:main:s${String(index).padStart(3, '0')}`);
    const { useChatStore } = await seedStores();
    const { useWorkspacesStore } = await import('@/stores/workspaces');

    const workspace = {
      id: 'ws-1',
      name: 'repo',
      rootPath: '/repo',
      activeSessionKey: keys[0],
      sessionStates: Object.fromEntries(keys.map((key) => [key, {}])),
      sessionFolders: [],
      sessionFolderAssignments: {},
      lastOpenedAt: 1_700_000_000_000,
    };
    useWorkspacesStore.setState({ profiles: [workspace], activeWorkspace: workspace, loading: false, error: null } as never);
    useChatStore.setState({
      sessions: keys.map((key, index) => ({ key, displayName: key, updatedAt: 1_700_000_000_000 + index })),
      messages: [{ role: 'user', content: 'hi' }],
      currentSessionKey: keys[0],
      sessionLabels: Object.fromEntries(keys.map((key) => [key, key])),
      sessionLastActivity: Object.fromEntries(keys.map((key) => [key, 1])),
    } as never);

    const { Sidebar } = await import('@/components/layout/Sidebar');
    const view = render(<MemoryRouter><TooltipProvider><Sidebar /></TooltipProvider></MemoryRouter>);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
    });

    const mounted = view.container.querySelectorAll('[data-testid^="sidebar-session-agent:main:s"]').length;
    expect(mounted).toBeGreaterThan(0);
    expect(mounted).toBeLessThanOrEqual(80);

    const scroller = view.container.querySelector('.sidebar-scroll');
    expect(scroller).not.toBeNull();
    if (scroller) {
      Object.defineProperty(scroller, 'scrollHeight', { value: 4_000, configurable: true });
      Object.defineProperty(scroller, 'clientHeight', { value: 600, configurable: true });
      Object.defineProperty(scroller, 'scrollTop', { value: 3_600, configurable: true });
      await act(async () => {
        scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
      });
    }

    const afterScroll = view.container.querySelectorAll('[data-testid^="sidebar-session-agent:main:s"]').length;
    expect(afterScroll).toBeGreaterThan(mounted);
  });

  it('shares 80 initial slots across two 80-row workgroups and ungrouped sessions', async () => {
    const sessions = Array.from({ length: 180 }, (_, index) => ({ key: 'agent:main:budget-' + index }));
    const selected = sessions[179].key;
    const view = await renderWorkgroups(sessions, selected, [80, 80]);
    expect(mountedKeys(view.container)).toHaveLength(80);
    expect(mountedKeys(view.container)).toContain(selected);

    fireEvent.click(view.getByTestId('sidebar-session-project-toggle-ws-1'));
    expect(mountedKeys(view.container)).toHaveLength(0);
    fireEvent.click(view.getByTestId('sidebar-session-project-toggle-ws-1'));
    expect(mountedKeys(view.container)).toHaveLength(80);
    expect(mountedKeys(view.container)).toContain(selected);

    await scrollToBottom(view.container);
    expect(mountedKeys(view.container)).toHaveLength(160);
    await scrollToBottom(view.container);
    expect(mountedKeys(view.container).sort()).toEqual(sessions.map((session) => session.key).sort());
    expect(view.useChatStore.getState().sessions.map((session) => session.key).sort()).toEqual(sessions.map((session) => session.key).sort());
    expect(view.useWorkspacesStore.getState().profiles[0].sessionFolderAssignments).toEqual(view.assignments);
  });

  it('unmounts collapsed workgroups without consuming their slots or losing their full count', async () => {
    const sessions = Array.from({ length: 160 }, (_, index) => ({ key: 'agent:main:fold-' + index }));
    const view = await renderWorkgroups(sessions, sessions[159].key, [80, 80]);
    expect(mountedKeys(view.container)).toHaveLength(80);
    const first = view.getByTestId('sidebar-folder-budget-group-0');
    const second = view.getByTestId('sidebar-folder-budget-group-1');
    fireEvent.click(view.getByTestId('sidebar-folder-toggle-budget-group-0'));
    expect(mountedKeys(first)).toHaveLength(0);
    expect(mountedKeys(second)).toHaveLength(80);
    expect(view.getByTestId('sidebar-workgroup-count-budget-group-0')).toHaveTextContent('80');
    fireEvent.click(view.getByTestId('sidebar-folder-toggle-budget-group-1'));
    expect(mountedKeys(view.container)).toHaveLength(0);
    expect(view.getByTestId('sidebar-workgroup-count-budget-group-1')).toHaveTextContent('80');
    fireEvent.click(view.getByTestId('sidebar-folder-toggle-budget-group-0'));
    expect(mountedKeys(first)).toHaveLength(80);
    expect(mountedKeys(second)).toHaveLength(0);
    fireEvent.click(view.getByTestId('sidebar-folder-toggle-budget-group-1'));
    expect(mountedKeys(view.container)).toHaveLength(80);
    expect(mountedKeys(view.container)).toContain(sessions[159].key);
    await scrollToBottom(view.container);
    expect(mountedKeys(view.container).sort()).toEqual(sessions.map((session) => session.key).sort());
  });

  it.each([2, 20, 100])('preserves all %s child keys and the selected family entry inside the shared budget', async (count) => {
    const parent = 'agent:main:budget-parent';
    const fillers = Array.from({ length: 80 }, (_, index) => ({ key: 'agent:main:filler-' + index }));
    const children = Array.from({ length: count }, (_, index) => ({ key: 'agent:main:family-' + index, parentSessionKey: parent }));
    const sessions = [...fillers, { key: parent }, ...children];
    const selected = children[count - 1].key;
    const view = await renderWorkgroups(sessions, selected, [80, count + 1]);
    await waitFor(() => expect(view.getByTestId('session-family-toggle-' + parent)).toHaveAttribute('aria-expanded', 'true'));
    expect(mountedKeys(view.container)).toHaveLength(80);
    expect(mountedKeys(view.container)).toEqual(expect.arrayContaining([parent, selected]));
    expect(view.getByTestId('session-family-toggle-' + parent)).toHaveTextContent(String(count));
    for (let chunk = 0; chunk < Math.ceil(sessions.length / 80) - 1; chunk += 1) await scrollToBottom(view.container);
    expect(mountedKeys(view.container).sort()).toEqual(sessions.map((session) => session.key).sort());
    expect(view.useChatStore.getState().sessions.map((session) => session.key).sort()).toEqual(sessions.map((session) => session.key).sort());
    expect(view.useWorkspacesStore.getState().profiles[0].sessionFolderAssignments).toEqual(view.assignments);
  });

  it('reserves the selected session and its visible ancestors without adding slots', async () => {
    const fillers = Array.from({ length: 80 }, (_, index) => ({ key: 'agent:main:ancestor-filler-' + index }));
    const parent = { key: 'agent:main:ancestor-parent' };
    const middle = { key: 'agent:main:ancestor-middle', parentSessionKey: parent.key };
    const children = Array.from({ length: 100 }, (_, index) => ({ key: 'agent:main:ancestor-child-' + index, parentSessionKey: middle.key }));
    const sessions = [...fillers, parent, middle, ...children];
    const selected = children[99].key;
    const view = await renderWorkgroups(sessions, selected, [80, 102]);
    await waitFor(() => expect(view.getByTestId('session-family-toggle-' + parent.key)).toHaveAttribute('aria-expanded', 'true'));
    expect(mountedKeys(view.container)).toHaveLength(80);
    expect(mountedKeys(view.container)).toEqual(expect.arrayContaining([parent.key, middle.key, selected]));
    await scrollToBottom(view.container); await scrollToBottom(view.container);
    expect(mountedKeys(view.container).sort()).toEqual(sessions.map((session) => session.key).sort());
  });
});
