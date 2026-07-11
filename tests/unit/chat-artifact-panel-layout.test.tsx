import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Chat } from '@/pages/Chat';

vi.mock('react-router-dom', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-router-dom')>(),
  useNavigate: () => vi.fn(),
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
  widthPct: 34,
  openChanges: vi.fn(),
  openPreview: vi.fn(),
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
  useArtifactPanel: (selector: (state: typeof artifactPanelState) => unknown) => selector(artifactPanelState),
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

  it('stacks the chat page above the macOS main drag strip', async () => {
    window.electron.platform = 'darwin';

    render(<Chat />);

    const chatPage = await screen.findByTestId('chat-page');
    expect(chatPage).toHaveClass('z-20');
  });

  it('layers the right artifact panel above the macOS drag strip', async () => {
    window.electron.platform = 'darwin';

    render(<Chat />);

    const panel = await screen.findByTestId('artifact-panel');
    const aside = panel.closest('aside');

    expect(aside).toHaveClass('absolute');
    expect(aside).toHaveClass('z-30');
    expect(aside).toHaveClass('xl:relative');
    expect(aside).toHaveClass('xl:z-20');
    expect(aside).toHaveClass('no-drag');
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
