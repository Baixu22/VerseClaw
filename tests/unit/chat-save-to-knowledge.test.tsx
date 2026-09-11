import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Chat } from '@/pages/Chat';

const hostApiMock = vi.hoisted(() => ({
  applyDraft: vi.fn(),
  createDraft: vi.fn(),
  proposeChange: vi.fn(),
  saveWorkspaceState: vi.fn(),
}));

const chatState = vi.hoisted(() => ({
  hydrateStartup: vi.fn(async () => {}),
  messages: [
    { role: 'user', id: 'u1', content: 'We decided to keep Obsidian optional.' },
    { role: 'assistant', id: 'a1', content: 'Use the native Verse Claw-managed wiki for the MVP.' },
  ],
  currentSessionKey: 'agent:main:knowledge-session',
  currentAgentId: 'main',
  sessions: [{ key: 'agent:main:knowledge-session', label: 'Knowledge planning' }],
  sessionLabels: {},
  switchSession: vi.fn(),
  resetSessionView: vi.fn(),
  renameSession: vi.fn(),
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
  runtimeRuns: {},
  sendMessage: vi.fn(),
  abortRun: vi.fn(),
  clearError: vi.fn(),
  loadMoreHistory: vi.fn(),
  loadHistory: vi.fn(),
  refresh: vi.fn(),
  refreshTaskLedger: vi.fn(),
  cleanupEmptySession: vi.fn(),

  lastUserMessageAt: null,
  sessionLastActivity: {},
}));

vi.mock('@/stores/chat', () => ({
  useChatStore: (selector: (state: typeof chatState) => unknown) => selector(chatState),
}));

vi.mock('@/stores/gateway', () => ({
  useGatewayStore: (selector: (state: { status: Record<string, unknown> }) => unknown) => selector({
    status: { state: 'running', port: 18789, gatewayReady: true },
  }),
}));

vi.mock('@/stores/agents', () => ({
  useAgentsStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
    agents: [{ id: 'main', name: 'Main', workspace: 'C:/project' }],
    defaultModelRef: null,
    fetchAgents: vi.fn(),
  }),
}));

vi.mock('@/stores/providers', () => ({
  useProviderStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
    accounts: [],
    statuses: [],
    defaultAccountId: null,
  }),
}));

vi.mock('@/stores/workspaces', () => ({
  useWorkspacesStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
    profiles: [],
    activeWorkspace: {
      id: 'workspace-1',
      name: 'Project',
      rootPath: 'C:/project',
      activeSessionKey: 'agent:main:knowledge-session',
      sessionStates: {},
    },
    fetchWorkspaces: vi.fn(),
    switchWorkspace: vi.fn(),
    createWorkspace: vi.fn(),
    saveWorkspaceState: hostApiMock.saveWorkspaceState,
    setPermissionMode: vi.fn(),
  }),
}));

// Chat reads this store both as a hook and imperatively via `.getState()`
// (index.tsx:972, 1529, 1550). A selector-only mock made the component throw
// "useArtifactPanel.getState is not a function"; the `Object.assign` shape is
// what the sibling chat tests use.
const artifactPanelState = vi.hoisted(() => ({
  open: false,
  widthPct: 45,
  tab: 'changes',
  tabs: [],
  activeTabId: null,
  terminalPlacement: 'side',
  openChanges: vi.fn(),
  openPreview: vi.fn(),
  openBrowser: vi.fn(),
  restoreSessionState: vi.fn(),
  close: vi.fn(),
}));

vi.mock('@/stores/artifact-panel', () => ({
  ARTIFACT_PANEL_MIN_WIDTH: 28,
  ARTIFACT_PANEL_MAX_WIDTH: 50,
  useArtifactPanel: Object.assign(
    (selector: (state: typeof artifactPanelState) => unknown) => selector(artifactPanelState),
    { getState: () => artifactPanelState },
  ),
}));

vi.mock('@/lib/host-api', () => ({
  hostApi: {
    topics: { list: vi.fn(async () => ({ topics: [], activeTopicId: null })) },
    files: { writeText: vi.fn(async () => ({ success: true })) },
    workspaces: { saveState: hostApiMock.saveWorkspaceState, update: vi.fn(async () => ({ success: true })) },
    skills: { local: vi.fn(async () => ({ success: true, skills: [] })) },
    workProviders: { status: vi.fn(async () => ({ kitCapabilities: [] })) },
    usage: {
      contextRange: vi.fn(async () => ({ range: null })),
      live: vi.fn(async () => ({ usage: null })),
      promptCacheStatus: vi.fn(async () => ({ success: true, assessment: null })),
      recordPromptCacheRiskEvent: vi.fn(async () => ({ success: true, event: null })),
    },
    knowledge: {
      applyDraft: hostApiMock.applyDraft,
      createDraft: hostApiMock.createDraft,
      proposeChange: hostApiMock.proposeChange,
    },
    sessions: {
      compactionStatus: vi.fn(async () => ({ success: true, status: null })),
      compactionHistory: vi.fn(async () => ({ success: true, entries: [] })),
      compact: vi.fn(async () => ({ success: true })),
      history: vi.fn(async () => ({ success: true, messages: [] })),
      longTaskControlStatus: vi.fn(async () => ({
        success: true,
        available: false,
        key: 'agent:main:knowledge-session',
        queueCount: 0,
        warnings: [],
      })),
      prepareHandoff: vi.fn(async () => ({ success: true, draft: '', sources: [], warnings: [] })),
      queueDrain: vi.fn(async () => ({ success: true, drained: false })),
    },
    taskLedger: {
      linkSession: vi.fn(async () => ({ success: true })),
    },
    git: {
      status: vi.fn(async () => ({ success: true, status: null })),
    },
    sessionActivity: {
      snapshot: vi.fn(async () => ({ success: true, snapshot: null })),
    },
  },
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: vi.fn(),
  },
  useTranslation: () => ({
    t: (key: string) => ({
      'toolbar.slashCommands': 'Slash commands',
      'toolbar.workspace': 'Workspace',
      'toolbar.refresh': 'Refresh',
      'toolbar.moreActions': 'More actions',
      'questionDirectory.title': 'Question directory',
      'knowledgeDraft.title': 'Save to Knowledge',
      'knowledgeDraft.description': 'Review and edit before creating a draft.',
      'knowledgeDraft.titleLabel': 'Title',
      'knowledgeDraft.bodyLabel': 'Draft',
      'knowledgeDraft.apply': 'Create review draft',
      'knowledgeDraft.empty': 'No content',
      'knowledgeDraft.invalid': 'Invalid draft',
      'knowledgeDraft.applied': 'Saved',
      'knowledgeDraft.applyFailed': 'Failed',
      'knowledgeDraft.proposalReason': 'User requested this chat synthesis be saved as a pending Knowledge draft.',
      'common:actions.cancel': 'Cancel',
    })[key] ?? key,
  }),
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
  useMinLoading: () => false,
}));

vi.mock('@/pages/Chat/ChatInput', () => ({
  ChatInput: () => <div data-testid="chat-input" />,
}));

vi.mock('@/pages/Chat/ChatMessage', () => ({
  ChatMessage: ({ message }: { message: { content?: unknown } }) => (
    <div data-testid="chat-message">{typeof message.content === 'string' ? message.content : ''}</div>
  ),
}));

describe('Chat toolbar slash entry', () => {
  beforeEach(() => {
    hostApiMock.applyDraft.mockReset();
    hostApiMock.applyDraft.mockResolvedValue({ success: true });
    hostApiMock.createDraft.mockReset();
    hostApiMock.createDraft.mockResolvedValue({
      success: true,
      draft: { id: 'draft-1' },
    });
    hostApiMock.proposeChange.mockReset();
    hostApiMock.proposeChange.mockResolvedValue({
      success: true,
      proposal: { id: 'proposal-1' },
    });
    hostApiMock.saveWorkspaceState.mockReset();
    window.electron.platform = 'win32';
  });

  it('keeps the toolbar free of the obsolete more-actions menu', async () => {
    render(<MemoryRouter><Chat /></MemoryRouter>);

    await screen.findByTestId('chat-toolbar-refresh');
    expect(screen.queryByTestId('chat-toolbar-more')).not.toBeInTheDocument();
    expect(screen.queryByTestId('chat-toolbar-slash')).not.toBeInTheDocument();
    expect(screen.queryByTestId('chat-save-knowledge')).not.toBeInTheDocument();
  });
});
