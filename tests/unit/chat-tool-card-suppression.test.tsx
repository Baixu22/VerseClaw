import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Chat } from '@/pages/Chat/index';
import { useChatStore } from '@/stores/chat';

const { gatewayState, agentsState } = vi.hoisted(() => ({
  gatewayState: {
    status: { state: 'running', port: 18789 },
  },
  agentsState: {
    agents: [{ id: 'main', name: 'main' }] as Array<Record<string, unknown>>,
    fetchAgents: vi.fn(),
  },
}));

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useNavigate: () => vi.fn(),
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

vi.mock('@/lib/host-api', () => ({
  hostApi: {
    git: {
      status: vi.fn().mockResolvedValue({ success: true, status: { isRepository: false } }),
    },
    sessionActivity: {
      snapshot: vi.fn().mockResolvedValue({ success: true, snapshot: null }),
    },
    permissions: {
      approvals: vi.fn().mockResolvedValue({ ok: true, approvals: [] }),
      decideApproval: vi.fn().mockResolvedValue({ ok: true, success: true }),
    },
    topics: {
      list: vi.fn().mockResolvedValue({ topics: [], activeTopicId: null }),
    },
    knowledge: {
      matchErrorExperience: vi.fn().mockResolvedValue({ success: true, matches: [] }),
    },
    files: {
      writeText: vi.fn().mockResolvedValue({ success: true }),
    },
    workspaces: {
      saveState: vi.fn().mockResolvedValue({ success: true }),
      update: vi.fn().mockResolvedValue({ success: true }),
    },
    shell: {
      openPath: vi.fn().mockResolvedValue({ success: true }),
    },
    dialog: {
      open: vi.fn().mockResolvedValue({ canceled: true, filePaths: [] }),
    },
    skills: {
      local: vi.fn().mockResolvedValue({ success: true, skills: [] }),
    },
    workProviders: {
      status: vi.fn().mockResolvedValue({ success: true, providers: [], capabilities: [], kitCapabilities: [], summary: {} }),
    },
    usage: {
      contextRange: vi.fn().mockResolvedValue({ usedTokens: 0, maxTokens: 0, percentage: 0 }),
      live: vi.fn().mockResolvedValue({ input: 0, output: 0, total: 0, costUsd: 0 }),
      promptCacheStatus: vi.fn().mockResolvedValue({ success: true, assessment: null }),
      recordPromptCacheRiskEvent: vi.fn().mockResolvedValue({ success: true, event: null }),
    },
    sessions: {
      history: vi.fn().mockResolvedValue({ messages: [], hasMore: false }),
      compactionStatus: vi.fn().mockResolvedValue({
        success: true,
        available: true,
        canCompact: false,
        inProgress: false,
        pressure: 'low',
        truncatedMessageCount: 0,
        warnings: [],
      }),
      longTaskControlStatus: vi.fn().mockResolvedValue({
        success: true,
        available: false,
        key: 'agent:main:main',
        queueCount: 0,
        warnings: [],
      }),
    },
  },
  hostApiFetch: vi.fn().mockResolvedValue({ success: true, messages: [] }),
}));

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: vi.fn(),
  },
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown> | string) => {
      if (typeof params === 'string') return params;
      if (key === 'executionGraph.collapsedSummary') {
        return `collapsed ${String(params?.toolCount ?? '')} ${String(params?.processCount ?? '')}`.trim();
      }
      if (key === 'executionGraph.agentRun') return 'Main execution';
      if (key === 'executionGraph.title') return 'Execution Graph';
      if (key === 'executionGraph.collapseAction') return 'Collapse';
      if (key === 'executionGraph.thinkingLabel') return 'Thinking';
      if (key.startsWith('taskPanel.stepStatus.')) return key.split('.').at(-1) ?? key;
      return key;
    },
  }),
}));

vi.mock('@/hooks/use-stick-to-bottom-instant', () => ({
  useStickToBottomInstant: vi.fn(() => ({
    contentRef: { current: null },
    scrollRef: { current: null },
    scrollToBottom: vi.fn(),
    isAtBottom: true,
  })),
}));

vi.mock('@/hooks/use-min-loading', () => ({
  useMinLoading: () => false,
}));

vi.mock('@/pages/Chat/ChatToolbar', () => ({
  ChatToolbar: () => null,
}));

vi.mock('@/pages/Chat/ChatInput', () => ({
  ChatInput: () => null,
}));

describe('Chat tool card suppression', () => {
  it('does not render standalone tool cards for messages inside a user run segment', async () => {
    useChatStore.setState({
      messages: [
        { role: 'user', content: 'Generate assets' },
        {
          role: 'assistant',
          id: 'tool-exec',
          content: [{ type: 'tool_use', id: 'exec-1', name: 'exec', input: { command: 'ls' } }],
        },
        {
          role: 'assistant',
          id: 'tool-image',
          content: [{ type: 'tool_use', id: 'image-1', name: 'image', input: { path: '/tmp/a.png' } }],
        },
        {
          role: 'assistant',
          id: 'tool-process',
          content: [{ type: 'tool_use', id: 'process-1', name: 'process', input: { action: 'list' } }],
        },
        {
          role: 'assistant',
          id: 'reply',
          content: [{ type: 'text', text: 'All done.' }],
        },
      ],
      loading: false,
      error: null,
      runError: null,
      sending: false,
      activeRunId: null,
      streamingText: '',
      streamingMessage: null,
      streamingTools: [],
      pendingFinal: false,
      lastUserMessageAt: Date.now(),
      pendingToolImages: [],
      sessions: [{ key: 'agent:main:main' }],
      currentSessionKey: 'agent:main:main',
      currentAgentId: 'main',
      sessionLabels: {},
      sessionLastActivity: {},
      thinkingLevel: null,
    });

    render(<MemoryRouter><Chat /></MemoryRouter>);

    await waitFor(() => {
      expect(screen.getByTestId('chat-turn-summary-card')).toBeInTheDocument();
    });

    expect(screen.queryByTestId('assistant-tool-fallback')).not.toBeInTheDocument();
    expect(screen.getAllByText('All done.').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByTestId('chat-turn-summary-toggle'));
    expect(screen.getByTestId('chat-execution-graph')).toBeInTheDocument();
    expect(screen.queryByTestId('assistant-tool-fallback')).not.toBeInTheDocument();
  }, 10_000);
});
