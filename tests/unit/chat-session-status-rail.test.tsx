/** Session environment triggers, automatic inline layout and manual overlay disclosure. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { Chat } from '@/pages/Chat';
import { createEmptySessionActivitySnapshot } from '@shared/types/session-activity';
import { useSettingsStore } from '@/stores/settings';

const SESSION_KEY = 'main:test';

const planState = vi.hoisted(() => ({ hasPlan: true }));

// The page renders without a router, so `Link` (used by the task-ledger
// summary) is a plain anchor here rather than the context-bound original.
vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: '/', search: '', hash: '', state: null }),
  Link: ({ to, children, ...props }: { to: string; children?: ReactNode } & Record<string, unknown>) => (
    <a href={typeof to === 'string' ? to : '#'} {...props}>{children}</a>
  ),
}));

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({
    /* Interpolation options arrive as an object; returning it would hand React a
       non-element child and crash the render instead of failing an assertion. */
    t: (key: string, options?: unknown) => (typeof options === 'string' ? options : key),
    // The session task dock formats times with the active locale.
    i18n: { language: 'en' },
  }),
}));

vi.mock('@/stores/gateway', () => ({
  useGatewayStore: (selector: (state: { status: { state: string; gatewayReady: boolean } }) => unknown) => selector({
    status: { state: 'running', gatewayReady: true },
  }),
}));

/**
 * The plan is projected from run events by `promoteRunSurfaces`. Faking the
 * projection keeps this test about the rail rather than about event shapes —
 * `run-surface-promotion` has its own coverage.
 */
vi.mock('@/pages/Chat/run-surface-promotion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/pages/Chat/run-surface-promotion')>();
  return {
    ...actual,
    promoteRunSurfaces: () => ({
      terminals: [],
      diffs: [],
      promotedStepIds: new Set<string>(),
      plan: planState.hasPlan
        ? {
          id: 'plan-1',
          title: 'Ship the rail',
          todos: [{ id: 'todo-1', title: 'Wire the layers', status: 'in-progress' as const }],
        }
        : null,
    }),
  };
});

const chatState = {
  hydrateStartup: vi.fn(async () => {}),
  startupPhase: 'ready',
  messages: [{ role: 'user', content: 'do the thing' }],
  currentSessionKey: SESSION_KEY,
  currentAgentId: 'main',
  sessionLabels: {},
  loading: false,
  loadingMoreHistory: false,
  hasMoreHistory: false,
  sending: false,
  error: null,
  runError: null,
  streamingMessage: null,
  streamingTools: [],
  pendingFinal: false,
  activeRunId: null,
  handoffOperation: null,
  taskLedgerSnapshot: null,
  taskLedgerLoaded: true,
  runtimeRuns: {
    'run-1': {
      runId: 'run-1',
      sessionKey: SESSION_KEY,
      status: 'running',
      startedAt: 1,
      events: [],
      assistantText: '',
      thinkingText: '',
    },
  },
  sendMessage: vi.fn(),
  abortRun: vi.fn(),
  clearError: vi.fn(),
  loadMoreHistory: vi.fn(),
  loadHistory: vi.fn(),
  refresh: vi.fn(),
  refreshTaskLedger: vi.fn(),
  cleanupEmptySession: vi.fn(),
  lastUserMessageAt: null,
};

const artifactPanelState = vi.hoisted(() => ({
  open: false,
  expanded: false,
  widthPct: 34,
  openWorkspacePanel: vi.fn(),
  tabs: [],
  activeTabId: null,
  terminalPlacement: 'side',
  setTerminalPlacement: vi.fn(),
  restoreSessionState: vi.fn(),
  close: vi.fn(),
}));

vi.mock('@/stores/chat', () => ({
  useChatStore: (selector: (state: typeof chatState) => unknown) => selector(chatState),
}));

vi.mock('@/stores/agents', () => ({
  useAgentsStore: (selector: (state: { agents: Array<{ id: string; name: string; workspace: string }>; fetchAgents: () => void }) => unknown) => selector({
    agents: [{ id: 'main', name: 'main', workspace: '/workspace' }],
    fetchAgents: vi.fn(),
  }),
}));

vi.mock('@/stores/artifact-panel', () => ({
  ARTIFACT_PANEL_MIN_WIDTH: 28,
  ARTIFACT_PANEL_MAX_WIDTH: 50,
  useArtifactPanel: Object.assign(
    (selector: (state: typeof artifactPanelState) => unknown) => selector(artifactPanelState),
    { getState: () => artifactPanelState },
  ),
}));

const activityState = vi.hoisted(() => ({
  scopedSnapshots: {} as Record<string, unknown>,
  load: vi.fn(),
}));

vi.mock('@/stores/session-activity', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/stores/session-activity')>(),
  useSessionActivityStore: Object.assign(
    (selector: (state: typeof activityState) => unknown) => selector(activityState),
    { getState: () => activityState },
  ),
}));

vi.mock('@/components/file-preview/ArtifactPanel', () => ({
  ArtifactPanel: () => <div data-testid="artifact-panel" />,
}));

vi.mock('@/components/file-preview/PanelResizeDivider', () => ({
  PanelResizeDivider: () => <div data-testid="panel-resize-divider" />,
}));

vi.mock('@/hooks/use-stick-to-bottom-instant', () => ({
  useStickToBottomInstant: () => ({
    contentRef: { current: null },
    scrollRef: { current: null },
    scrollToBottom: vi.fn(),
    isAtBottom: true,
  }),
}));

vi.mock('@/hooks/use-min-loading', () => ({ useMinLoading: (value: boolean) => value }));

vi.mock('@/pages/Chat/ChatInput', () => ({ ChatInput: () => <div data-testid="chat-input" /> }));

/** Stands in for the toolbar: reports the props it receives, forwards the click. */
vi.mock('@/pages/Chat/ChatToolbar', () => ({
  ChatToolbar: ({ sessionActivityAvailable, sessionActivityOpen, onToggleSessionActivity }: {
    sessionActivityAvailable?: boolean;
    sessionActivityOpen?: boolean;
    onToggleSessionActivity?: () => void;
  }) => (
    <button
      type="button"
      data-testid="stub-activity-toggle"
      data-available={sessionActivityAvailable ? 'true' : 'false'}
      data-open={sessionActivityOpen ? 'true' : 'false'}
      onClick={onToggleSessionActivity}
    />
  ),
}));

function seedSnapshotWithGitRepo() {
  const snapshot = createEmptySessionActivitySnapshot(SESSION_KEY);
  snapshot.git = {
    isRepository: true,
    workspaceRoot: '/workspace',
    branch: 'main',
    detached: false,
    ahead: 0,
    behind: 0,
    clean: false,
    hasConflicts: false,
    changes: [{
      path: 'src/pages/Chat/index.tsx',
      absolutePath: '/workspace/src/pages/Chat/index.tsx',
      status: 'M',
      staged: false,
      unstaged: true,
      untracked: false,
      conflicted: false,
      bucket: 'unstaged',
      additions: 4,
      deletions: 1,
    }],
    stagedCount: 0,
    unstagedCount: 1,
    untrackedCount: 0,
    conflictedCount: 0,
  };
  activityState.scopedSnapshots = { [JSON.stringify([null, SESSION_KEY])]: snapshot };
}

function railElement() {
  return screen.queryByTestId('chat-session-status-rail');
}

describe('Chat session status rail', () => {
  beforeEach(() => {
    Element.prototype.scrollTo = vi.fn();
    window.electron.platform = 'win32';
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 1600 });
    planState.hasPlan = true;
    artifactPanelState.open = false;
    useSettingsStore.setState({ sessionActivityAutoExpand: 'active' });
    seedSnapshotWithGitRepo();
  });

  it('keeps the sidebar closed when a plan arrives and leaves transcript width unchanged', async () => {
    render(<Chat />);

    await screen.findByTestId('stub-activity-toggle');
    expect(railElement()).not.toBeInTheDocument();
    expect(screen.getByTestId('chat-scroll-container')).toHaveAttribute('data-rail', 'collapsed');
    // The toggle reflects the effective state, not just an override.
    expect(screen.getByTestId('stub-activity-toggle')).toHaveAttribute('data-open', 'false');
  });

  it('keeps changed environments quiet until the user opens status', async () => {
    planState.hasPlan = false;
    render(<Chat />);
    await screen.findByTestId('stub-activity-toggle');
    expect(railElement()).not.toBeInTheDocument();
    expect(screen.getByTestId('chat-scroll-container')).toHaveAttribute('data-rail', 'collapsed');
  });

  it('keeps a clean environment hidden even while a reply is running', async () => {
    planState.hasPlan = false;
    const snapshot = createEmptySessionActivitySnapshot(SESSION_KEY);
    activityState.scopedSnapshots = { [JSON.stringify([null, SESSION_KEY])]: snapshot };
    render(<Chat />);
    expect(await screen.findByTestId('stub-activity-toggle')).toHaveAttribute('data-available', 'false');
    expect(railElement()).not.toBeInTheDocument();
  });

  it('honors never-auto-expand and opens an overlay on demand', async () => {
    planState.hasPlan = false;
    useSettingsStore.setState({ sessionActivityAutoExpand: 'never' });

    render(<Chat />);

    await screen.findByTestId('stub-activity-toggle');
    expect(railElement()).not.toBeInTheDocument();
    expect(screen.getByTestId('chat-scroll-container')).toHaveAttribute('data-rail', 'collapsed');

    fireEvent.click(screen.getByTestId('stub-activity-toggle'));

    const rail = await screen.findByTestId('chat-session-status-rail');
    // Asked for, so it floats: over the transcript, which does not move.
    expect(rail).toHaveAttribute('data-layer', 'overlay');
    expect(screen.getByTestId('chat-scroll-container')).toHaveAttribute('data-rail', 'collapsed');

    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    escape.preventDefault();
    fireEvent(rail, escape);
    expect(railElement()).not.toBeInTheDocument();
  });

  it('uses the manual overlay at narrow widths without automatically covering the conversation', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 900 });
    render(<Chat />);
    expect(railElement()).not.toBeInTheDocument();
    fireEvent.click(await screen.findByTestId('stub-activity-toggle'));
    expect(railElement()).toHaveAttribute('data-layer', 'overlay');
  });



  it('opens and closes the requested overlay without creating a passive sidebar', async () => {
    render(<Chat />);

    await screen.findByTestId('stub-activity-toggle');
    fireEvent.click(screen.getByTestId('stub-activity-toggle'));
    expect(screen.getByTestId('chat-session-status-rail')).toHaveAttribute('data-layer', 'overlay');
    fireEvent.click(screen.getByTestId('stub-activity-toggle'));
    expect(railElement()).not.toBeInTheDocument();
    expect(screen.getByTestId('chat-scroll-container')).toHaveAttribute('data-rail', 'collapsed');

    fireEvent.click(screen.getByTestId('stub-activity-toggle'));
    expect(screen.getByTestId('chat-session-status-rail')).toHaveAttribute('data-layer', 'overlay');
  });

  it('never insets the transcript for the workspace panel and the rail at once', async () => {
    artifactPanelState.open = true;

    render(<Chat />);

    await screen.findByTestId('artifact-panel');
    // The panel already owns the right-hand column: the passive layer yields...
    expect(railElement()).not.toBeInTheDocument();
    // ...but the way in stays, because the status card is what panel tabs open FROM.
    expect(screen.getByTestId('stub-activity-toggle')).toHaveAttribute('data-available', 'true');
  });

  it('does not bring back the recovery-assist rail', async () => {
    render(<Chat />);

    await screen.findByTestId('stub-activity-toggle');
    expect(screen.queryByTestId('chat-assistive-rail')).not.toBeInTheDocument();
    expect(screen.queryByTestId('chat-rollback-plan')).not.toBeInTheDocument();
  });
});
