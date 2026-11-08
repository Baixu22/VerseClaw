import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Chat } from '@/pages/Chat';

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: '/', search: '', hash: '', state: null }),
}));

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: vi.fn(),
  },
  useTranslation: () => ({
    t: (_key: string, defaultValue?: string) => defaultValue ?? '',
  }),
}));

vi.mock('@/stores/gateway', () => ({
  useGatewayStore: (selector: (state: { status: { state: string; gatewayReady: boolean } }) => unknown) => selector({
    status: { state: 'running', gatewayReady: true },
  }),
}));

const chatState = {
  hydrateStartup: vi.fn(async () => {}),
  messages: [],
  currentSessionKey: 'main:test',
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
  open: true,
  expanded: false,
  widthPct: 34,
  openWorkspacePanel: vi.fn(),
  tabs: [{ id: 'files-1', kind: 'files' }],
  activeTabId: 'files-1',
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

vi.mock('@/hooks/use-min-loading', () => ({
  useMinLoading: (value: boolean) => value,
}));

vi.mock('@/pages/Chat/ChatInput', () => ({
  ChatInput: () => <div data-testid="chat-input" />,
}));

vi.mock('@/pages/Chat/ChatToolbar', () => ({
  ChatToolbar: () => <div data-testid="chat-toolbar" />,
}));

describe('Chat artifact panel layout', () => {
  beforeEach(() => {
    Element.prototype.scrollTo = vi.fn();
    artifactPanelState.open = true;
  });

  it('keeps the chat toolbar background draggable while actions remain clickable', async () => {
    window.electron.platform = 'darwin';

    render(<Chat />);

    const dragRegion = await screen.findByTestId('chat-toolbar-drag-region');
    const actions = await screen.findByTestId('chat-toolbar-actions');

    expect(dragRegion).toHaveClass('drag-region');
    expect(actions).toHaveClass('no-drag');
  });

  it('keeps the chat page as the positioned workspace surface on macOS', async () => {
    window.electron.platform = 'darwin';

    render(<Chat />);

    const chatPage = await screen.findByTestId('chat-page');
    expect(chatPage).toHaveClass('relative', 'overflow-hidden');
  });

  it('renders the right artifact panel as a flex sibling that squeezes the chat', async () => {
    window.electron.platform = 'darwin';

    render(<Chat />);

    const panel = await screen.findByTestId('artifact-panel');
    const aside = panel.closest('aside');

    expect(aside).toHaveClass('relative');
    expect(aside).toHaveClass('no-drag');
    expect(aside).not.toHaveClass('absolute');
  });

  it('gives the side panel no surface of its own, so it stays co-planar with the chat', async () => {
    window.electron.platform = 'darwin';

    render(<Chat />);

    const aside = (await screen.findByTestId('artifact-panel')).closest('aside');

    // The panel shares the conversation surface; the hairline marks the seam.
    expect(aside).not.toHaveClass('bg-surface-modal');
    expect(aside).toHaveClass('border-l');
  });

  it('keeps the conversation canvas plain without grid decoration', async () => {
    window.electron.platform = 'win32';

    render(<Chat />);

    const page = await screen.findByTestId('chat-page');
    const canvas = screen.queryByTestId('chat-welcome-bg');
    const conversation = await screen.findByTestId('chat-conversation-column');

    expect(canvas).toBeNull();
    expect(page).toHaveClass('bg-background');
    expect(conversation).toBeInTheDocument();
  });

  it('hides the chat assistive rail while the artifact panel is open', async () => {
    window.electron.platform = 'win32';

    render(<Chat />);

    expect(await screen.findByTestId('artifact-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-assistive-rail')).not.toBeInTheDocument();
    expect(screen.queryByTestId('work-mode-summary-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('task-ledger-summary')).not.toBeInTheDocument();
  });

  it('does not show the chat assistive rail before work starts', async () => {
    window.electron.platform = 'win32';
    artifactPanelState.open = false;

    render(<Chat />);

    expect(await screen.findByTestId('chat-page')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-assistive-rail')).not.toBeInTheDocument();
    expect(screen.queryByTestId('work-mode-summary-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('task-ledger-summary')).not.toBeInTheDocument();
  });
});
