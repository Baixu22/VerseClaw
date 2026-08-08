import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { gatewayRpcMock, hostApiFetchMock, agentsState } = vi.hoisted(() => ({
  gatewayRpcMock: vi.fn(),
  hostApiFetchMock: vi.fn(),
  agentsState: {
    agents: [] as Array<Record<string, unknown>>,
  },
}));

vi.mock('@/stores/gateway', () => ({
  useGatewayStore: {
    getState: () => ({
      rpc: gatewayRpcMock,
    }),
  },
}));

vi.mock('@/stores/agents', () => ({
  useAgentsStore: {
    getState: () => agentsState,
  },
}));

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: (...args: unknown[]) => hostApiFetchMock(...args),
  hostApi: {
    gateway: {
      rpc: (...args: unknown[]) => gatewayRpcMock(...args),
    },
    media: {
      thumbnails: vi.fn(async () => ({})),
    },
    sessions: {
      history: vi.fn(async () => ({ messages: [] })),
      summaries: vi.fn(async () => ({ success: true, summaries: [] })),
      delete: vi.fn(async () => ({ success: true })),
      rename: vi.fn(async () => ({ success: true })),
    },
    chat: {
      sendWithMedia: async (input: unknown) =>
        hostApiFetchMock('/api/chat/send-with-media', {
          method: 'POST',
          body: JSON.stringify(input),
        }),
    },
  },
}));

/**
 * P0-2: a second message sent while a run is active must be queued (not silently
 * dropped), then auto-sent when the run drains. Regression guard for the old
 * `if (sending && !inputMode) return;` silent-drop path in sendMessage.
 */
describe('chat pending message queue', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-11T12:00:00Z'));
    window.localStorage.clear();
    gatewayRpcMock.mockClear();
    hostApiFetchMock.mockClear();

    agentsState.agents = [
      { id: 'main', name: 'Main' },
      { id: 'research', name: 'Research' },
    ];
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('queues a message sent while a run is active instead of dropping it', async () => {
    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      messages: [],
      sending: true,
      activeRunId: 'run-1',
      currentSessionKey: 'agent:main:main',
      currentAgentId: 'main',
    });

    await useChatStore.getState().sendMessage('second message', { targetAgentId: 'main' });

    const state = useChatStore.getState();
    expect(state.pendingMessages).toHaveLength(1);
    expect(state.pendingMessages[0]!.text).toBe('second message');
    // The active run's message list must not gain the queued message yet.
    expect(hostApiFetchMock).not.toHaveBeenCalled();
  });

  it('drains queued messages and sends them after the run ends', async () => {
    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      messages: [],
      sending: false,
      activeRunId: null,
      currentSessionKey: 'agent:main:main',
      currentAgentId: 'main',
      pendingMessages: [
        {
          id: 'queued-1',
          text: 'queued while running',
          targetAgentId: 'main',
          targetSessionKey: 'agent:main:main',
          opts: {},
        },
      ],
    });

    hostApiFetchMock.mockResolvedValue({ ok: true });
    useChatStore.getState().drainPendingMessages();
    await vi.runAllTimersAsync();

    expect(useChatStore.getState().pendingMessages).toHaveLength(0);
    expect(hostApiFetchMock).toHaveBeenCalled();
  });

  it('does not queue long-task interventions (inputMode passes through)', async () => {
    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      messages: [],
      sending: true,
      activeRunId: 'run-1',
      currentSessionKey: 'agent:main:main',
      currentAgentId: 'main',
    });

    // With inputMode set, the old guard is bypassed and the message is sent
    // directly (not queued). The store must not queue it.
    await useChatStore.getState().sendMessage('intervention', {
      targetAgentId: 'main',
      inputMode: 'guide',
    });

    expect(useChatStore.getState().pendingMessages).toHaveLength(0);
  });
});
