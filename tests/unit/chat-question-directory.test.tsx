import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Chat } from '@/pages/Chat';
import { MemoryRouter } from 'react-router-dom';

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useNavigate: () => vi.fn(),
    useLocation: () => ({ pathname: '/', search: '', hash: '', state: null, key: 'default' }),
  };
});

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: vi.fn(),
  },
  useTranslation: () => ({
    t: (key: string, options?: string | Record<string, unknown>) => {
      if (typeof options === 'string') return options;
      if (key === 'questionDirectory.fallback') return `Question ${String(options?.number ?? '')}`;
      if (key === 'questionDirectory.moreHint') return `${String(options?.count ?? '')} more questions not shown`;
      if (key === 'toolbar.currentAgent') return `Talking to ${String(options?.agent ?? '')}`;
      return typeof options?.defaultValue === 'string' ? options.defaultValue : key;
    },
  }),
}));

vi.mock('@/stores/gateway', () => ({
  useGatewayStore: (selector: (state: { status: { state: string; gatewayReady: boolean } }) => unknown) => selector({
    status: { state: 'running', gatewayReady: true },
  }),
}));

const chatState = {
  sessions: [],
  hydrateStartup: vi.fn(async () => {}),
  messages: [
    { role: 'user', content: 'hello' },
    { role: 'assistant', content: 'reply 1' },
    { role: 'user', content: 'hello' },
    { role: 'assistant', content: 'reply 2' },
  ],
  currentSessionKey: 'agent:main:main',
  currentAgentId: 'main',
  sessionLabels: {},
  loading: false,
  startupPhase: 'ready',
  startupError: null,
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

vi.mock('@/stores/chat', () => ({
  useChatStore: (selector: (state: typeof chatState) => unknown) => selector(chatState),
}));

vi.mock('@/stores/agents', () => ({
  useAgentsStore: (selector: (state: { agents: Array<{ id: string; name: string; workspace: string }>; fetchAgents: () => void }) => unknown) => selector({
    agents: [{ id: 'main', name: 'main', workspace: '/workspace' }],
    fetchAgents: vi.fn(),
  }),
}));

const artifactPanelMocks = vi.hoisted(() => {
  const state = {
    open: false,
    expanded: false,
    widthPct: 34,
    openWorkspacePanel: vi.fn(),
    tabs: [],
    activeTabId: null,
    terminalPlacement: 'side',
    setTerminalPlacement: vi.fn(),
    restoreSessionState: vi.fn(),
    reviewView: 'changes',
    selectedPath: null,
  };
  const hook = (selector: (value: typeof state) => unknown) => selector(state);
  return { hook: Object.assign(hook, { getState: () => state }) };
});

vi.mock('@/stores/artifact-panel', () => ({
  ARTIFACT_PANEL_MIN_WIDTH: 28,
  ARTIFACT_PANEL_MAX_WIDTH: 50,
  useArtifactPanel: artifactPanelMocks.hook,
}));

vi.mock('@/hooks/use-stick-to-bottom-instant', () => ({
  useStickToBottomInstant: () => ({
    contentRef: { current: null },
    scrollRef: { current: null },
  }),
}));

vi.mock('@/hooks/use-min-loading', () => ({
  useMinLoading: () => false,
}));

vi.mock('@/pages/Chat/ChatInput', () => ({
  ChatInput: () => null,
}));

vi.mock('@/pages/Chat/ChatMessage', () => ({
  ChatMessage: ({ message }: { message: { content?: unknown } }) => <div>{typeof message.content === 'string' ? message.content : ''}</div>,
}));

vi.mock('@/components/file-preview/ArtifactPanel', () => ({
  ArtifactPanel: () => null,
}));

vi.mock('@/components/file-preview/PanelResizeDivider', () => ({
  PanelResizeDivider: () => null,
}));

vi.mock('@/pages/Chat/ExecutionGraphCard', () => ({
  ExecutionGraphCard: () => null,
}));

describe('Chat question directory', () => {
  /**
   * The toolbar-toggled question directory was removed together with the chat
   * side rail (see tests/e2e/chat-question-directory.spec.ts, which asserts the
   * surface STAYS removed). This unit test keeps the same guarantee cheap: even
   * with a transcript that contains repeated questions — the scenario that used
   * to justify the panel — the removed surface must not come back, and the
   * repeated prompts must remain separate, individually rendered entries in
   * the transcript itself (the `chat-message-nav-rail` is the only navigator).
   */
  it('stays removed and keeps real repeated questions as separate transcript entries', async () => {
    render(
      <MemoryRouter><TooltipProvider>
        <Chat />
      </TooltipProvider></MemoryRouter>,
    );

    expect(screen.queryByTestId('chat-question-directory-toggle')).toBeNull();
    expect(screen.queryByTestId('chat-question-directory')).toBeNull();
    expect(screen.queryByTestId('chat-assistive-rail')).toBeNull();

    // Both "hello" prompts render independently — no dedup, no collapse.
    expect(screen.getAllByText('hello')).toHaveLength(2);
  });
});
