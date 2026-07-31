import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  hydrateStartup: vi.fn(),
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

vi.mock('@/stores/artifact-panel', () => ({
  ARTIFACT_PANEL_MIN_WIDTH: 28,
  ARTIFACT_PANEL_MAX_WIDTH: 50,
  useArtifactPanel: (selector: (state: Record<string, unknown>) => unknown) => selector({
    open: false,
    widthPct: 45,
    tab: 'changes',
    openChanges: vi.fn(),
    openPreview: vi.fn(),
    openBrowser: vi.fn(),
    restoreSessionState: vi.fn(),
    close: vi.fn(),
  }),
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
      'toolbar.saveToKnowledge': 'Save to Knowledge',
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

describe('Chat Save to Knowledge', () => {
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

  it('opens an editable draft and creates a pending proposal only after confirmation', async () => {
    render(<MemoryRouter><Chat /></MemoryRouter>);

    fireEvent.pointerDown(await screen.findByTestId('chat-toolbar-more'), { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByTestId('chat-save-knowledge'));
    expect(await screen.findByTestId('knowledge-draft-dialog')).toBeInTheDocument();
    expect((screen.getByTestId('knowledge-draft-body') as HTMLTextAreaElement).value).toContain('Obsidian optional');

    fireEvent.click(screen.getByText('Cancel'));
    expect(hostApiMock.applyDraft).not.toHaveBeenCalled();
    expect(hostApiMock.createDraft).not.toHaveBeenCalled();
    expect(hostApiMock.proposeChange).not.toHaveBeenCalled();

    fireEvent.pointerDown(screen.getByTestId('chat-toolbar-more'), { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByTestId('chat-save-knowledge'));
    fireEvent.change(await screen.findByTestId('knowledge-draft-title'), { target: { value: 'Knowledge Hub decision' } });
    fireEvent.change(screen.getByTestId('knowledge-draft-body'), { target: { value: 'Keep Obsidian optional and use native wiki.' } });
    fireEvent.click(screen.getByTestId('knowledge-draft-apply'));

    await waitFor(() => expect(hostApiMock.createDraft).toHaveBeenCalledWith({
      title: 'Knowledge Hub decision',
      body: 'Keep Obsidian optional and use native wiki.',
      type: 'synthesis',
      sourceIds: ['agent:main:knowledge-session'],
      sourceRefs: [{
        id: 'agent:main:knowledge-session',
        kind: 'chat',
        label: 'Knowledge Hub decision',
      }],
      createdBy: 'user',
    }));
    expect(hostApiMock.applyDraft).not.toHaveBeenCalled();
    await waitFor(() => expect(hostApiMock.proposeChange).toHaveBeenCalledWith({
      operation: 'create',
      draftId: 'draft-1',
      reason: 'User requested this chat synthesis be saved as a pending Knowledge draft.',
      sources: [{
        id: 'agent:main:knowledge-session',
        kind: 'chat',
        label: 'Knowledge Hub decision',
      }],
    }));
  });
});
