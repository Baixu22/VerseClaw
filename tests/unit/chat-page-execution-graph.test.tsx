import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const hostApiFetchMock = vi.fn();

const { gatewayState, agentsState } = vi.hoisted(() => ({
  gatewayState: {
    status: { state: 'running', port: 18789 },
  },
  agentsState: {
    agents: [{ id: 'main', name: 'main' }] as Array<Record<string, unknown>>,
    fetchAgents: vi.fn(),
  },
}));

vi.mock('@/stores/gateway', () => ({
  useGatewayStore: (selector: (state: typeof gatewayState) => unknown) => selector(gatewayState),
}));

vi.mock('@/stores/agents', () => ({
  useAgentsStore: (selector: (state: typeof agentsState) => unknown) => selector(agentsState),
}));

vi.mock('@/stores/artifact-panel', () => {
  const state = {
    open: false,
    widthPct: 45,
    openChanges: vi.fn(),
    openPreview: vi.fn(),
    close: vi.fn(),
  };
  return {
    ARTIFACT_PANEL_MIN_WIDTH: 28,
    ARTIFACT_PANEL_MAX_WIDTH: 50,
    useArtifactPanel: (selector: (value: typeof state) => unknown) => selector(state),
  };
});

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: (...args: unknown[]) => hostApiFetchMock(...args),
  hostApi: {
    topics: {
      list: vi.fn(async () => ({ topics: [], activeTopicId: null })),
    },
    knowledge: {
      matchErrorExperience: vi.fn(async () => ({ success: true, matches: [] })),
    },
    files: {
      writeText: vi.fn(async () => ({ success: true })),
    },
    workspaces: {
      saveState: vi.fn(async () => ({ success: true })),
      update: vi.fn(async () => ({ success: true })),
    },
    shell: {
      openPath: vi.fn(async () => ({ success: true })),
    },
    dialog: {
      open: vi.fn(async () => ({ canceled: true, filePaths: [] })),
    },
    usage: {
      contextRange: vi.fn(async () => ({ usedTokens: 0, maxTokens: 0, percentage: 0 })),
      live: vi.fn(async () => ({ input: 0, output: 0, total: 0, costUsd: 0 })),
      promptCacheStatus: vi.fn(async () => ({ success: true, assessment: null })),
      recordPromptCacheRiskEvent: vi.fn(async () => ({ success: true, event: null })),
    },
    sessions: {
      history: vi.fn(async () => ({ messages: [], hasMore: false })),
      compactionStatus: vi.fn(async () => ({
        success: true,
        available: true,
        canCompact: false,
        inProgress: false,
        pressure: 'low',
        truncatedMessageCount: 0,
        warnings: [],
      })),
      longTaskControlStatus: vi.fn(async () => ({
        success: true,
        available: false,
        key: 'agent:main:main',
        queueCount: 0,
        warnings: [],
      })),
    },
    skills: {
      local: vi.fn(async () => ({ success: true, skills: [] })),
    },
    workProviders: {
      status: vi.fn(async () => ({ kitCapabilities: [] })),
    },
  },
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
      if (key === 'executionGraph.agentRun') {
        return `Main execution`;
      }
      if (key === 'executionGraph.title') {
        return 'Execution Graph';
      }
      if (key === 'executionGraph.collapseAction') {
        return 'Collapse';
      }
      if (key === 'executionGraph.thinkingLabel') {
        return 'Thinking';
      }
      if (key.startsWith('taskPanel.stepStatus.')) {
        return key.split('.').at(-1) ?? key;
      }
      return key;
    },
  }),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
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
  ChatInput: ({ sending }: { sending?: boolean }) => (
    <div data-testid="mock-chat-input" data-sending={sending ? 'true' : 'false'} />
  ),
}));

vi.mock('@/pages/Chat/ChatMessage', () => ({
  ChatMessage: ({
    message,
    textOverride,
    isStreaming,
    suppressAssistantText,
  }: {
    message: { content?: unknown };
    textOverride?: string;
    isStreaming?: boolean;
    suppressAssistantText?: boolean;
  }) => {
    const text = typeof textOverride === 'string'
      ? textOverride
      : typeof message?.content === 'string'
        ? message.content
        : Array.isArray(message?.content)
          ? message.content
            .filter((block): block is { type?: string; text?: string } => typeof block === 'object' && block !== null)
            .filter((block) => block.type === 'text' && typeof block.text === 'string')
            .map((block) => block.text)
            .join(' ')
          : '';
    return (
      <div data-testid={isStreaming ? 'mock-streaming-message' : 'mock-chat-message'}>
        {suppressAssistantText ? '' : text}
      </div>
    );
  },
}));

describe('Chat execution graph lifecycle', () => {
  beforeEach(async () => {
    vi.resetModules();
    hostApiFetchMock.mockReset();
    hostApiFetchMock.mockResolvedValue({ success: true, messages: [] });
    agentsState.fetchAgents.mockReset();

    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      messages: [
        {
          role: 'user',
          content: 'Check semiconductor chatter',
        },
        {
          role: 'assistant',
          id: 'tool-turn',
          content: [
            { type: 'text', text: 'Checked X.' },
            { type: 'tool_use', id: 'browser-search', name: 'browser', input: { action: 'search', query: 'semiconductor' } },
          ],
        },
      ],
      loading: false,
      error: null,
      runError: null,
      sending: true,
      activeRunId: 'run-live',
      streamingText: '',
      streamingMessage: {
        role: 'assistant',
        id: 'final-stream',
        content: [
          { type: 'text', text: 'Checked X.' },
          { type: 'text', text: 'Checked X. Here is the summary.' },
        ],
      },
      streamingTools: [
        {
          toolCallId: 'browser-search',
          name: 'browser',
          status: 'completed',
          updatedAt: Date.now(),
        },
      ],
      pendingFinal: true,
      lastUserMessageAt: Date.now(),
      pendingToolImages: [],
      sessions: [{ key: 'agent:main:main' }],
      currentSessionKey: 'agent:main:main',
      currentAgentId: 'main',
      sessionLabels: {},
      sessionLastActivity: {},
      thinkingLevel: null,
    });
  });

  it('keeps the execution graph expanded while the reply is still streaming and shows only the reply suffix in the bubble', async () => {
    const { Chat } = await import('@/pages/Chat/index');

    render(<Chat />);

    await waitFor(() => {
      expect(screen.getByTestId('chat-execution-graph')).toHaveAttribute('data-collapsed', 'false');
    });

    expect(screen.queryByTestId('chat-turn-summary-card')).not.toBeInTheDocument();
    expect(screen.getByText('Here is the summary.')).toBeInTheDocument();
    expect(screen.queryByText('Checked X. Here is the summary.')).not.toBeInTheDocument();
  });

  it('collapses completed long task work into a deterministic summary card by default', async () => {
    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      messages: [
        { role: 'user', content: 'Inspect and summarize the workspace' },
        {
          role: 'assistant',
          id: 'read-step',
          content: [{ type: 'tool_use', id: 'read-1', name: 'read_file', input: { path: '/tmp/a.ts' } }],
        },
        {
          role: 'assistant',
          id: 'grep-step',
          content: [{ type: 'tool_use', id: 'grep-1', name: 'search', input: { pattern: 'TODO' } }],
        },
        {
          role: 'assistant',
          id: 'test-step',
          content: [{ type: 'tool_use', id: 'test-1', name: 'run_tests', input: { command: 'pnpm test' } }],
        },
        {
          role: 'assistant',
          id: 'final-summary',
          content: [{ type: 'text', text: 'Workspace summary is ready.' }],
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
      runtimeRuns: {},
      sessions: [{ key: 'agent:main:main' }],
      currentSessionKey: 'agent:main:main',
      currentAgentId: 'main',
      sessionLabels: {},
      sessionLastActivity: {},
      thinkingLevel: null,
    });

    const { Chat } = await import('@/pages/Chat/index');
    render(<Chat />);

    await waitFor(() => {
      expect(screen.getByTestId('chat-turn-summary-card')).toBeInTheDocument();
    });
    expect(screen.getByTestId('chat-turn-summary-toggle')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('chat-execution-graph')).not.toBeInTheDocument();
    expect(screen.getAllByText('Workspace summary is ready.').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByTestId('chat-turn-summary-toggle'));
    expect(screen.getByTestId('chat-turn-summary-details')).toBeInTheDocument();
    expect(screen.getByTestId('chat-execution-graph')).toBeInTheDocument();
  });

  it('keeps short conversations as normal messages without a turn summary card', async () => {
    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      messages: [
        { role: 'user', content: 'What is two plus two?' },
        { role: 'assistant', content: [{ type: 'text', text: 'Four.' }] },
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
      lastUserMessageAt: null,
      pendingToolImages: [],
      runtimeRuns: {},
      sessions: [{ key: 'agent:main:main' }],
      currentSessionKey: 'agent:main:main',
      currentAgentId: 'main',
      sessionLabels: {},
      sessionLastActivity: {},
      thinkingLevel: null,
    });

    const { Chat } = await import('@/pages/Chat/index');
    render(<Chat />);

    await waitFor(() => {
      expect(screen.getByText('Four.')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('chat-turn-summary-card')).not.toBeInTheDocument();
  });

  it('renders a team orchestration card for team_orchestrate task graph results', async () => {
    const orchestrationResult = {
      status: 'running',
      orchestrationRunId: 'orch-ui-1',
      graphStatus: 'running',
      taskGraph: {
        graphRunId: 'orch-ui-1',
        mode: 'staged',
        status: 'running',
        nodes: [
          {
            taskNodeId: 'implementer-1',
            roleName: 'implementer',
            phase: 'implementation',
            task: 'Apply the focused change.',
            status: 'ready',
            dependsOn: [],
          },
          {
            taskNodeId: 'tester-1',
            roleName: 'tester',
            phase: 'verification',
            task: 'Run the focused validation.',
            status: 'planned',
            dependsOn: ['implementer-1'],
          },
          {
            taskNodeId: 'reviewer-1',
            roleName: 'reviewer',
            phase: 'verifier',
            task: 'Review the worker evidence.',
            status: 'planned',
            dependsOn: ['tester-1'],
            isVerifier: true,
          },
        ],
        edges: [],
      },
      executionWaves: [
        { wave: 1, taskNodeIds: ['implementer-1'], roles: ['implementer'] },
        { wave: 2, taskNodeIds: ['tester-1'], roles: ['tester'] },
        { wave: 3, taskNodeIds: ['reviewer-1'], roles: ['reviewer'] },
      ],
      routeDiagnostics: {
        reasons: ['Template quick-development selected staged graph.'],
      },
    };
    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      messages: [
        {
          role: 'user',
          content: 'Coordinate the implementation safely',
        },
        {
          role: 'assistant',
          id: 'team-tool-turn',
          content: [
            {
              type: 'tool_use',
              id: 'team-1',
              name: 'team_orchestrate',
              input: { task: 'Coordinate the implementation safely', graphMode: 'staged' },
            },
          ],
        },
        {
          role: 'toolresult',
          toolCallId: 'team-1',
          content: JSON.stringify(orchestrationResult),
        },
      ],
      loading: false,
      error: null,
      runError: null,
      sending: false,
      activeRunId: null,
      pendingFinal: false,
      lastUserMessageAt: null,
      streamingText: '',
      streamingMessage: null,
      streamingTools: [],
      pendingToolImages: [],
      runtimeRuns: {},
      sessions: [{ key: 'agent:main:main' }],
      currentSessionKey: 'agent:main:main',
      currentAgentId: 'main',
      sessionLabels: { 'agent:main:main': 'Coordinate the implementation safely' },
      sessionLastActivity: {},
      thinkingLevel: null,
    });

    const { Chat } = await import('@/pages/Chat/index');
    render(<Chat />);

    await waitFor(() => {
      expect(screen.getByTestId('chat-turn-summary-card')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('chat-execution-graph')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('chat-turn-summary-toggle'));
    expect(screen.getAllByTestId('chat-team-orchestration-card').length).toBeGreaterThan(0);
    expect(screen.getAllByText('implementer').length).toBeGreaterThan(0);
    expect(screen.getAllByText('tester').length).toBeGreaterThan(0);
    expect(screen.getAllByText('reviewer').length).toBeGreaterThan(0);
    expect(screen.getByText('Template quick-development selected staged graph.')).toBeInTheDocument();
  });

  it('renders ordinary orchestration diagnostics without Task Loop repair wording', async () => {
    const orchestrationResult = {
      status: 'partial',
      orchestrationRunId: 'orch-diagnostics-1',
      graphStatus: 'partial',
      taskGraph: {
        graphRunId: 'orch-diagnostics-1',
        mode: 'staged',
        status: 'partial',
        nodes: [
          {
            taskNodeId: 'reviewer-1',
            roleName: 'reviewer',
            phase: 'review',
            task: 'Review the worker output.',
            status: 'failed',
            dependsOn: [],
          },
        ],
        edges: [],
      },
      failures: [{ roleName: 'reviewer', status: 'forbidden', error: 'max children reached' }],
      orchestrationDiagnostics: {
        kind: 'ordinary-orchestration-diagnostics',
        boundary: 'diagnostics-only',
        status: 'needs_attention',
        summary: '1 worker did not start. Ordinary orchestration is showing diagnostics only.',
        failedWorkerCount: 1,
        taskLoopUpgradeAvailable: true,
        recommendations: [{
          code: 'worker-spawn-failed',
          roleName: 'reviewer',
          message: 'Worker failed before acceptance: max children reached',
          recommendedAction: 'Review worker limits or permissions before retrying ordinary orchestration.',
        }],
        nextSteps: ['Review failed worker details', 'Explicitly start Task Loop only if a governed long-run retry is needed'],
      },
    };
    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      messages: [
        { role: 'user', content: 'Coordinate the implementation safely' },
        {
          role: 'assistant',
          id: 'team-tool-turn',
          content: [{
            type: 'tool_use',
            id: 'team-1',
            name: 'team_orchestrate',
            input: { task: 'Coordinate the implementation safely', graphMode: 'staged' },
          }],
        },
        {
          role: 'toolresult',
          toolCallId: 'team-1',
          content: JSON.stringify(orchestrationResult),
        },
      ],
      loading: false,
      error: null,
      runError: null,
      sending: false,
      activeRunId: null,
      pendingFinal: false,
      lastUserMessageAt: null,
      streamingText: '',
      streamingMessage: null,
      streamingTools: [],
      pendingToolImages: [],
      runtimeRuns: {},
      sessions: [{ key: 'agent:main:main' }],
      currentSessionKey: 'agent:main:main',
      currentAgentId: 'main',
      sessionLabels: { 'agent:main:main': 'Coordinate the implementation safely' },
      sessionLastActivity: {},
      thinkingLevel: null,
    });

    const { Chat } = await import('@/pages/Chat/index');
    render(<Chat />);

    await waitFor(() => {
      expect(screen.getByTestId('chat-turn-summary-card')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('chat-turn-summary-toggle'));
    expect(screen.getByText('Worker failed before acceptance: max children reached')).toBeInTheDocument();
    expect(screen.getByText('Review worker limits or permissions before retrying ordinary orchestration.')).toBeInTheDocument();
    expect(screen.getByText('Explicitly start Task Loop only if a governed long-run retry is needed')).toBeInTheDocument();
    expect(screen.queryByText(/checkpoint/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/blocked/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/repair/i)).not.toBeInTheDocument();
  });

  it('keeps runtime tool status inside the execution graph while a tool is running', async () => {
    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      messages: [
        {
          role: 'user',
          content: 'Read the file and summarize it',
        },
      ],
      loading: false,
      error: null,
      runError: null,
      sending: true,
      activeRunId: 'run-tool-stream',
      streamingText: '',
      streamingMessage: {
        role: 'assistant',
        id: 'tool-narration-stream',
        content: [{ type: 'text', text: 'I will read the file first.' }],
      },
      streamingTools: [],
      runtimeRuns: {
        'run-tool-stream': {
          runId: 'run-tool-stream',
          sessionKey: 'agent:main:main',
          status: 'running',
          assistantText: '',
          thinkingText: '',
          events: [
            {
              type: 'tool.started',
              runId: 'run-tool-stream',
              sessionKey: 'agent:main:main',
              toolCallId: 'read-1',
              name: 'read',
              args: { path: '/tmp/demo.md' },
            },
          ],
        },
      },
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

    const { Chat } = await import('@/pages/Chat/index');

    render(<Chat />);

    await waitFor(() => {
      expect(screen.getByTestId('chat-execution-graph')).toHaveAttribute('data-collapsed', 'false');
      expect(screen.getAllByText('read').length).toBeGreaterThan(0);
    });

    expect(screen.queryByTestId('chat-streaming-tool-status-bar')).not.toBeInTheDocument();
  });

  it('renders the execution graph immediately for an active run before any stream content arrives', async () => {
    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      messages: [
        {
          role: 'user',
          content: 'Check semiconductor chatter',
        },
      ],
      loading: false,
      error: null,
      runError: null,
      sending: true,
      activeRunId: 'run-starting',
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

    const { Chat } = await import('@/pages/Chat/index');

    render(<Chat />);

    await waitFor(() => {
      expect(screen.getByTestId('chat-execution-graph')).toHaveAttribute('data-collapsed', 'false');
    });

    expect(screen.getByTestId('chat-execution-step-thinking-trailing')).toBeInTheDocument();
    expect(screen.getAllByText('Thinking').length).toBeGreaterThan(0);
  });

  it('renders generated file cards with line stats for edit tools', async () => {
    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      messages: [
        {
          role: 'user',
          content: 'Patch the workspace file',
        },
        {
          role: 'assistant',
          id: 'edit-turn',
          content: [
            {
              type: 'tool_use',
              id: 'edit-1',
              name: 'Edit',
              input: {
                file_path: '/workspace/demo.ts',
                old_string: 'const value = 1\n',
                new_string: 'const value = 2\n',
              },
            },
          ],
        },
        {
          role: 'assistant',
          id: 'reply-turn',
          content: [{ type: 'text', text: 'Updated the file.' }],
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

    const { Chat } = await import('@/pages/Chat/index');

    render(<Chat />);

    await waitFor(() => {
      expect(screen.getByText('demo.ts')).toBeInTheDocument();
    });

    expect(screen.getByTestId('chat-turn-summary-card')).toBeInTheDocument();
    expect(screen.queryByText('+1')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('chat-turn-summary-toggle'));
    expect(screen.getByText('+1')).toBeInTheDocument();
    expect(screen.getByText('-1')).toBeInTheDocument();
  });

  it('shows a scroll-to-latest button when the chat is scrolled away from the bottom', async () => {
    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      messages: Array.from({ length: 24 }, (_, idx) => ({
        role: idx % 2 === 0 ? 'user' : 'assistant',
        content: `Message ${idx + 1}`,
        timestamp: Date.now() + idx,
      })),
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

    const { useStickToBottomInstant } = await import('@/hooks/use-stick-to-bottom-instant');
    vi.mocked(useStickToBottomInstant).mockReturnValue({
      contentRef: { current: null },
      scrollRef: { current: null },
      scrollToBottom: vi.fn(),
      isAtBottom: false,
    } as ReturnType<typeof useStickToBottomInstant>);

    const { Chat } = await import('@/pages/Chat/index');

    render(<Chat />);

    expect(await screen.findByTestId('chat-scroll-to-latest')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'scrollToLatest' })).toBeInTheDocument();
  });

  it('stops showing trailing thinking and renders run error callout after terminal model error', async () => {
    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      messages: [
        {
          role: 'user',
          content: 'Check semiconductor chatter',
        },
        {
          role: 'assistant',
          id: 'tool-turn',
          content: [
            { type: 'text', text: 'Checked X.' },
            { type: 'tool_use', id: 'browser-search', name: 'browser', input: { action: 'search', query: 'semiconductor' } },
          ],
        },
      ],
      loading: false,
      error: '404 Resource not found',
      runError: '404 Resource not found',
      sending: false,
      activeRunId: null,
      streamingText: '',
      streamingMessage: null,
      streamingTools: [],
      pendingFinal: false,
      lastUserMessageAt: null,
      pendingToolImages: [],
      sessions: [{ key: 'agent:main:main' }],
      currentSessionKey: 'agent:main:main',
      currentAgentId: 'main',
      sessionLabels: {},
      sessionLastActivity: {},
      thinkingLevel: null,
    });

    const { Chat } = await import('@/pages/Chat/index');

    render(<Chat />);

    await waitFor(() => {
      expect(screen.getByTestId('chat-execution-graph')).toBeInTheDocument();
    });

    expect(screen.queryByTestId('chat-execution-step-thinking-trailing')).not.toBeInTheDocument();
    expect(screen.getAllByText('404 Resource not found').length).toBeGreaterThan(0);
  });

  it('keeps history final reply folded while matching streamed text is still active', async () => {
    const finalText = 'History final answer is already recorded.';
    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      messages: [
        {
          role: 'user',
          content: 'Summarize the run',
        },
        {
          role: 'assistant',
          id: 'tool-turn',
          content: [
            { type: 'text', text: 'Reading the source data.' },
            { type: 'tool_use', id: 'read-1', name: 'read_file', input: { path: '/tmp/source.txt' } },
          ],
        },
        {
          role: 'assistant',
          id: 'final-turn',
          content: [{ type: 'text', text: finalText }],
        },
      ],
      loading: false,
      error: null,
      runError: null,
      sending: true,
      activeRunId: 'run-history-stream-race',
      streamingText: '',
      streamingMessage: {
        role: 'assistant',
        content: [{ type: 'text', text: finalText }],
      },
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

    const { Chat } = await import('@/pages/Chat/index');

    render(<Chat />);

    await waitFor(() => {
      expect(screen.getByTestId('chat-execution-graph')).toHaveAttribute('data-collapsed', 'false');
    });

    expect(screen.getByTestId('mock-streaming-message')).toHaveTextContent(finalText);
    expect(
      screen.getAllByTestId('mock-chat-message')
        .filter((element) => element.textContent === finalText),
    ).toHaveLength(0);
  });

  it('stops trailing thinking when history already contains the final reply but sending is stuck', async () => {
    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      messages: [
        {
          role: 'user',
          content: '执行一下github1',
        },
        {
          role: 'assistant',
          id: 'tool-turn',
          content: [
            { type: 'text', text: 'Fetching GitHub trending data.' },
            { type: 'tool_use', id: 'fetch-1', name: 'web_fetch', input: { url: 'https://example.com' } },
          ],
        },
        {
          role: 'assistant',
          id: 'final-turn',
          content: [{ type: 'text', text: '执行完成 ✅ 今天的 github1 已写入飞书文档。' }],
        },
      ],
      loading: false,
      error: null,
      runError: null,
      sending: true,
      activeRunId: 'run-stuck',
      streamingText: '',
      streamingMessage: null,
      streamingTools: [],
      pendingFinal: false,
      lastUserMessageAt: Date.now() - 60 * 60 * 1000,
      pendingToolImages: [],
      sessions: [{ key: 'agent:main:main' }],
      currentSessionKey: 'agent:main:main',
      currentAgentId: 'main',
      sessionLabels: {},
      sessionLastActivity: {},
      thinkingLevel: null,
    });

    const { Chat } = await import('@/pages/Chat/index');

    render(<Chat />);

    await waitFor(() => {
      expect(screen.getByTestId('chat-turn-summary-card')).toBeInTheDocument();
    });

    expect(screen.queryByTestId('chat-execution-step-thinking-trailing')).not.toBeInTheDocument();
    expect(screen.getAllByText('执行完成 ✅ 今天的 github1 已写入飞书文档。').length).toBeGreaterThan(0);
    expect(screen.queryByTestId('chat-typing-indicator')).not.toBeInTheDocument();
    expect(screen.queryByTestId('chat-activity-indicator')).not.toBeInTheDocument();
  });

  it('settles composer when generated image media arrives without transcript tool calls', async () => {
    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      messages: [
        {
          role: 'user',
          content: '生成独角鲸图片',
        },
        {
          role: 'assistant',
          id: 'generated-image-only',
          content: [{
            type: 'image',
            url: '/api/chat/media/outgoing/agent%3Amain%3As-1/image-1/full',
            mimeType: 'image/png',
            alt: 'narwhal.png',
          }],
          _attachedFiles: [{
            fileName: 'narwhal.png',
            mimeType: 'image/png',
            fileSize: 42,
            preview: 'data:image/png;base64,ok',
            gatewayUrl: '/api/chat/media/outgoing/agent%3Amain%3As-1/image-1/full',
            source: 'gateway-media',
          }],
        },
      ],
      loading: false,
      error: null,
      runError: null,
      sending: true,
      activeRunId: 'run-image-runtime-only',
      runtimeRuns: {
        'run-image-runtime-only': {
          runId: 'run-image-runtime-only',
          sessionKey: 'agent:main:main',
          status: 'running',
          assistantText: '',
          thinkingText: '',
          events: [
            {
              type: 'tool.completed',
              runId: 'run-image-runtime-only',
              sessionKey: 'agent:main:main',
              toolCallId: 'image-1',
              name: 'image_generate',
              result: { summary: 'done' },
              isError: false,
            },
          ],
        },
      },
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

    const { Chat } = await import('@/pages/Chat/index');

    render(<Chat />);

    await waitFor(() => {
      expect(screen.getByTestId('mock-chat-input')).toHaveAttribute('data-sending', 'false');
    });

    expect(screen.queryByTestId('chat-execution-step-thinking-trailing')).not.toBeInTheDocument();
    expect(screen.queryByTestId('chat-typing-indicator')).not.toBeInTheDocument();
    expect(screen.queryByTestId('chat-activity-indicator')).not.toBeInTheDocument();
  });

  it('stops trailing thinking when generated image media arrives but session wake is missed', async () => {
    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      messages: [
        {
          role: 'user',
          content: '生成一个小麦',
        },
        {
          role: 'assistant',
          id: 'image-tool-turn',
          content: [
            {
              type: 'toolCall',
              id: 'image-1',
              name: 'image_generate',
              arguments: { prompt: 'golden wheat' },
            },
          ],
        },
        {
          role: 'assistant',
          id: 'message-tool-turn',
          content: [
            {
              type: 'toolCall',
              id: 'message-1',
              name: 'message',
              arguments: {
                action: 'send',
                attachments: [{ path: '/tmp/wheat.png' }],
              },
            },
          ],
        },
        {
          role: 'assistant',
          id: 'generated-image',
          content: [{
            type: 'image',
            url: '/api/chat/media/outgoing/agent%3Amain%3As-1/image-1/full',
            mimeType: 'image/png',
            alt: 'wheat.png',
          }],
          _attachedFiles: [{
            fileName: 'wheat.png',
            mimeType: 'image/png',
            fileSize: 42,
            preview: 'data:image/png;base64,ok',
            gatewayUrl: '/api/chat/media/outgoing/agent%3Amain%3As-1/image-1/full',
            source: 'gateway-media',
          }],
        },
      ],
      loading: false,
      error: null,
      runError: null,
      sending: true,
      activeRunId: 'run-stuck-image',
      streamingText: '',
      streamingMessage: {
        role: 'assistant',
        content: [{ type: 'thinking', thinking: '等待图片生成完成。' }],
      },
      streamingTools: [{
        toolCallId: 'image-1',
        name: 'image_generate',
        status: 'running',
        updatedAt: Date.now(),
      }],
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

    const { Chat } = await import('@/pages/Chat/index');

    render(<Chat />);

    await waitFor(() => {
      expect(screen.getByTestId('chat-execution-graph')).toBeInTheDocument();
    });

    expect(screen.queryByTestId('chat-execution-step-thinking-trailing')).not.toBeInTheDocument();
    expect(screen.queryByTestId('chat-typing-indicator')).not.toBeInTheDocument();
    expect(screen.queryByTestId('chat-activity-indicator')).not.toBeInTheDocument();
  });

  it('shows trailing thinking together with a running tool status', async () => {
    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      messages: [
        {
          role: 'user',
          content: 'Search the web and summarize',
        },
      ],
      loading: false,
      error: null,
      runError: null,
      sending: true,
      activeRunId: 'run-tool-active',
      streamingText: '',
      streamingMessage: null,
      streamingTools: [
        {
          toolCallId: 'browser-search',
          name: 'browser',
          status: 'running',
          updatedAt: Date.now(),
        },
      ],
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

    const { Chat } = await import('@/pages/Chat/index');

    render(<Chat />);

    await waitFor(() => {
      expect(screen.getAllByText('browser').length).toBeGreaterThan(0);
      expect(screen.getByTestId('chat-execution-step-thinking-trailing')).toBeInTheDocument();
    });
  });

  it('keeps trailing thinking visible while waiting for final history after completed tool status', async () => {
    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      messages: [
        {
          role: 'user',
          content: 'Summarize after checking the page',
        },
        {
          role: 'assistant',
          id: 'tool-turn',
          content: [
            { type: 'tool_use', id: 'browser-search', name: 'browser', input: { action: 'search', query: 'semiconductor' } },
          ],
        },
      ],
      loading: false,
      error: null,
      runError: null,
      sending: true,
      activeRunId: 'run-waiting-final-history',
      streamingText: '',
      streamingMessage: null,
      streamingTools: [
        {
          toolCallId: 'browser-search',
          name: 'browser',
          status: 'completed',
          updatedAt: Date.now(),
        },
      ],
      pendingFinal: true,
      lastUserMessageAt: Date.now(),
      pendingToolImages: [],
      sessions: [{ key: 'agent:main:main' }],
      currentSessionKey: 'agent:main:main',
      currentAgentId: 'main',
      sessionLabels: {},
      sessionLastActivity: {},
      thinkingLevel: null,
    });

    const { Chat } = await import('@/pages/Chat/index');

    render(<Chat />);

    await waitFor(() => {
      expect(screen.getByTestId('chat-execution-step-thinking-trailing')).toBeInTheDocument();
    });
  });

  it('settles image generation runs after message tool delivers generated media', async () => {
    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      messages: [
        {
          role: 'user',
          content: 'Generate a tomato image',
        },
        {
          role: 'assistant',
          id: 'image-tool-turn',
          content: [{ type: 'tool_use', id: 'image-call', name: 'image_generate', input: { prompt: 'tomato' } }],
        },
        {
          role: 'toolresult',
          toolCallId: 'image-call',
          toolName: 'image_generate',
          timestamp: Date.now() / 1000,
          content: [{
            type: 'text',
            text: 'Background task started for image generation (27443fdb-6cca-48e6-a3a7-ee34b0491aee).',
          }],
        },
        {
          role: 'user',
          content: '[Inter-session message] sourceSession=image_generate:27443fdb-6cca-48e6-a3a7-ee34b0491aee sourceTool=image_generate',
        },
        {
          role: 'toolresult',
          toolName: 'message',
          content: [{ type: 'text', text: '{ "status": "ok" }' }],
          details: {
            status: 'ok',
            mediaUrl: '/Users/me/.openclaw/media/tool-image-generation/tomato.png',
            sourceReply: {
              mediaUrls: ['/Users/me/.openclaw/media/tool-image-generation/tomato.png'],
            },
          },
        } as RawMessage,
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

    const { Chat } = await import('@/pages/Chat/index');

    render(<Chat />);

    await waitFor(() => {
      expect(screen.queryByTestId('chat-execution-step-thinking-trailing')).not.toBeInTheDocument();
    });
    expect(screen.getByTestId('mock-chat-input')).toHaveAttribute('data-sending', 'false');
  });

  it('keeps image generation runs active after async task status narration', async () => {
    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      messages: [
        {
          role: 'user',
          content: 'Generate a cherry image',
        },
        {
          role: 'assistant',
          id: 'image-tool-turn',
          content: [{ type: 'tool_use', id: 'image-call', name: 'image_generate', input: { prompt: 'cherry' } }],
        },
        {
          role: 'toolresult',
          toolCallId: 'image-call',
          toolName: 'image_generate',
          timestamp: Date.now() / 1000,
          content: [{
            type: 'text',
            text: 'Background task started for image generation (27443fdb-6cca-48e6-a3a7-ee34b0491aee).',
          }],
        },
        {
          role: 'assistant',
          id: 'image-status-turn',
          content: [{ type: 'text', text: '图已经开始生成啦 🍒 完成后会直接发到这里。' }],
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

    const { Chat } = await import('@/pages/Chat/index');

    render(<Chat />);

    await waitFor(() => {
      expect(screen.getByTestId('chat-execution-step-thinking-trailing')).toBeInTheDocument();
    });
    expect(screen.getByTestId('mock-chat-input')).toHaveAttribute('data-sending', 'true');
  });

  it('keeps the run active when narration landed in history before tools finished', async () => {
    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      messages: [
        {
          role: 'user',
          content: 'Check semiconductor chatter',
        },
        {
          role: 'assistant',
          id: 'narration-turn',
          content: [{ type: 'text', text: 'Let me search for that first.' }],
        },
        {
          role: 'assistant',
          id: 'tool-turn',
          content: [
            { type: 'tool_use', id: 'browser-search', name: 'browser', input: { action: 'search', query: 'semiconductor' } },
          ],
        },
      ],
      loading: false,
      error: null,
      runError: null,
      sending: true,
      activeRunId: 'run-narration',
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

    const { Chat } = await import('@/pages/Chat/index');

    render(<Chat />);

    await waitFor(() => {
      expect(screen.getByTestId('chat-execution-step-thinking-trailing')).toBeInTheDocument();
    });
  });
});
