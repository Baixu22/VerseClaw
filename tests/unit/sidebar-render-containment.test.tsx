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
import { act, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TooltipProvider } from '@/components/ui/tooltip';

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
});
