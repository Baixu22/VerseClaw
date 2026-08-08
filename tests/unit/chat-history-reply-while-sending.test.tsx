import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { gatewayState, agentsState } = vi.hoisted(() => ({
  gatewayState: { status: { state: 'running', port: 18789 } },
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
      status: vi.fn().mockResolvedValue({ success: true, status: null }),
    },
    sessionActivity: {
      snapshot: vi.fn().mockResolvedValue({ success: true, snapshot: null }),
    },
    skills: {
      local: vi.fn().mockResolvedValue({ success: true, skills: [] }),
    },
    workProviders: {
      status: vi.fn().mockResolvedValue({ success: true, providers: [], capabilities: [], kitCapabilities: [], summary: {} }),
    },
    usage: {
      contextRange: vi.fn().mockResolvedValue({ success: true }),
      live: vi.fn().mockResolvedValue({ success: true }),
      promptCacheStatus: vi.fn().mockResolvedValue({ success: true, assessment: null }),
      recordPromptCacheRiskEvent: vi.fn().mockResolvedValue({ success: true, event: null }),
    },
    sessions: {
      compactionStatus: vi.fn().mockResolvedValue({ success: true }),
      longTaskControlStatus: vi.fn().mockResolvedValue({ success: true }),
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

vi.mock('@/pages/Chat/ChatToolbar', () => ({ ChatToolbar: () => null }));
vi.mock('@/pages/Chat/ChatInput', () => ({ ChatInput: () => null }));

describe('Chat history reply while sending', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('shows assistant reply from history even when sending is still true', async () => {
    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      messages: [
        { role: 'user', id: 'u1', content: '你好' },
        { role: 'assistant', id: 'a1', content: [{ type: 'text', text: '你好，我在。' }] },
      ],
      loading: false,
      error: null,
      runError: null,
      sending: true,
      activeRunId: 'run-1',
      streamingText: '',
      streamingMessage: null,
      streamingTools: [],
      pendingFinal: false,
      lastUserMessageAt: Date.now(),
      currentSessionKey: 'agent:main:main',
      currentAgentId: 'main',
    });

    const { Chat } = await import('@/pages/Chat');
    render(<MemoryRouter><Chat /></MemoryRouter>);

    await waitFor(() => {
      expect(screen.getByText('你好，我在。')).toBeTruthy();
    });
    expect(screen.queryByText('Thinking')).toBeNull();
  }, 10_000);
});
