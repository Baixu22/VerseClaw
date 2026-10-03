import { beforeEach, describe, expect, it, vi } from 'vitest';

const { gatewayRpcMock, runtimeStatus, transcriptHistoryMock, summariesMock } = vi.hoisted(() => ({
  gatewayRpcMock: vi.fn(),
  runtimeStatus: {
    state: 'running',
    gatewayReady: true as boolean | undefined,
    port: 18789,
    pid: 42,
    connectedAt: 1,
  },
  transcriptHistoryMock: vi.fn(async () => ({ messages: [] })),
  summariesMock: vi.fn(async () => ({ success: true, summaries: [] })),
}));

vi.mock('@/stores/gateway', () => ({
  useGatewayStore: {
    getState: () => ({
      status: runtimeStatus,
      rpc: gatewayRpcMock,
    }),
  },
}));

vi.mock('@/stores/agents', () => ({
  useAgentsStore: {
    getState: () => ({ agents: [] }),
  },
}));

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: summariesMock as never,
  hostApi: {
    media: {
      thumbnails: vi.fn(async () => ({})),
    },
    sessions: {
      history: transcriptHistoryMock as never,
      summaries: summariesMock as never,
    },
  },
}));

describe('chat startup hydration', () => {
  beforeEach(() => {
    vi.resetModules();
    gatewayRpcMock.mockReset();
    transcriptHistoryMock.mockReset().mockResolvedValue({ messages: [] });
    summariesMock.mockReset().mockResolvedValue({ success: true, summaries: [] });
    runtimeStatus.state = 'running';
    runtimeStatus.gatewayReady = true;
    runtimeStatus.connectedAt += 1;
  });

  it('waits without showing an empty ready state before the gateway is ready', async () => {
    runtimeStatus.gatewayReady = false;
    const { useChatStore } = await import('@/stores/chat');

    await useChatStore.getState().hydrateStartup();

    expect(useChatStore.getState().startupPhase).toBe('waiting-for-gateway');
    expect(gatewayRpcMock).not.toHaveBeenCalled();
  });

  it('clears a stale connection error while the gateway is starting', async () => {
    runtimeStatus.state = 'starting';
    runtimeStatus.gatewayReady = false;
    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      messages: [],
      startupPhase: 'loading-history',
      startupError: null,
      error: 'Gateway not connected',
      loading: true,
      historyRefreshing: true,
    });

    await useChatStore.getState().hydrateStartup();

    expect(useChatStore.getState()).toMatchObject({
      startupPhase: 'waiting-for-gateway',
      startupError: null,
      error: null,
      loading: false,
      historyRefreshing: false,
    });
    expect(gatewayRpcMock).not.toHaveBeenCalled();
  });

  it('loads sessions before history and confirms an empty conversation', async () => {
    gatewayRpcMock.mockImplementation(async (method: string) => {
      if (method === 'sessions.list') return { sessions: [{ key: 'agent:main:main' }] };
      if (method === 'chat.history') return { messages: [] };
      throw new Error(`Unexpected gateway RPC: ${method}`);
    });
    const { useChatStore } = await import('@/stores/chat');

    await useChatStore.getState().hydrateStartup();

    expect(gatewayRpcMock.mock.calls.map(([method]) => method)).toEqual([
      'sessions.list',
      'chat.history',
    ]);
    expect(useChatStore.getState().startupPhase).toBe('ready');
    expect(useChatStore.getState().messages).toEqual([]);
  });

  it('keeps cached messages ready while refreshing in the background', async () => {
    let releaseSessions!: () => void;
    const sessionsPending = new Promise<void>((resolve) => {
      releaseSessions = resolve;
    });
    gatewayRpcMock.mockImplementation(async (method: string) => {
      if (method === 'sessions.list') {
        await sessionsPending;
        return { sessions: [{ key: 'agent:main:main' }] };
      }
      if (method === 'chat.history') {
        return { messages: [{ role: 'assistant', content: 'fresh' }] };
      }
      throw new Error(`Unexpected gateway RPC: ${method}`);
    });
    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      messages: [{ role: 'assistant', content: 'cached' }],
      startupPhase: 'waiting-for-gateway',
    });

    const hydration = useChatStore.getState().hydrateStartup();
    expect(useChatStore.getState().startupPhase).toBe('ready');
    expect(useChatStore.getState().messages[0]?.content).toBe('cached');

    releaseSessions();
    await hydration;
    expect(useChatStore.getState().startupPhase).toBe('ready');
    expect(useChatStore.getState().messages[0]?.content).toBe('fresh');
  });

  it('exposes a retryable startup error when no history source succeeds', async () => {
    gatewayRpcMock.mockImplementation(async (method: string) => {
      if (method === 'sessions.list') return { sessions: [{ key: 'agent:main:main' }] };
      if (method === 'chat.history') throw new Error('history unavailable');
      throw new Error(`Unexpected gateway RPC: ${method}`);
    });
    const { useChatStore } = await import('@/stores/chat');

    await useChatStore.getState().hydrateStartup();

    expect(useChatStore.getState().startupPhase).toBe('error');
    expect(useChatStore.getState().startupError).toContain('history unavailable');
  });

  it('keeps an exhausted startup timeout in error when the transcript fallback is empty', async () => {
    gatewayRpcMock.mockImplementation(async (method: string) => {
      if (method === 'sessions.list') return { sessions: [{ key: 'agent:main:main' }] };
      if (method === 'chat.history') throw new Error('RPC timeout: chat.history');
      throw new Error(`Unexpected gateway RPC: ${method}`);
    });
    const { useChatStore } = await import('@/stores/chat');

    await useChatStore.getState().hydrateStartup();

    expect(useChatStore.getState().startupPhase).toBe('error');
    expect(useChatStore.getState().startupError).toContain('RPC timeout: chat.history');
    expect(useChatStore.getState().messages).toEqual([]);
  });

  it('clears a startup error after switching to a session whose history loads successfully', async () => {
    let startupShouldFail = true;
    gatewayRpcMock.mockImplementation(async (method: string, params?: { sessionKey?: string }) => {
      if (method === 'sessions.list') {
        return {
          sessions: [
            { key: 'agent:main:main' },
            { key: 'agent:main:recovered' },
          ],
        };
      }
      if (method === 'chat.history') {
        if (startupShouldFail) throw new Error('history unavailable');
        return {
          messages: [{ role: 'assistant', content: `history for ${params?.sessionKey}` }],
        };
      }
      throw new Error(`Unexpected gateway RPC: ${method}`);
    });
    const { useChatStore } = await import('@/stores/chat');

    await useChatStore.getState().hydrateStartup();
    expect(useChatStore.getState().startupPhase).toBe('error');

    startupShouldFail = false;
    useChatStore.getState().switchSession('agent:main:recovered');

    await vi.waitFor(() => {
      expect(useChatStore.getState().startupPhase).toBe('ready');
      expect(useChatStore.getState().messages[0]?.content).toBe('history for agent:main:recovered');
    });
    expect(useChatStore.getState().startupError).toBeNull();
    expect(useChatStore.getState().error).toBeNull();
  });

  it('makes a new empty session ready after a startup error', async () => {
    gatewayRpcMock.mockImplementation(async (method: string) => {
      if (method === 'sessions.list') return { sessions: [{ key: 'agent:main:main' }] };
      if (method === 'chat.history') throw new Error('history unavailable');
      throw new Error(`Unexpected gateway RPC: ${method}`);
    });
    const { useChatStore } = await import('@/stores/chat');

    await useChatStore.getState().hydrateStartup();
    expect(useChatStore.getState().startupPhase).toBe('error');

    useChatStore.getState().newSession();

    expect(useChatStore.getState().currentSessionKey).toMatch(/^agent:main:session-/);
    expect(useChatStore.getState().startupPhase).toBe('ready');
    expect(useChatStore.getState().startupError).toBeNull();
    expect(useChatStore.getState().error).toBeNull();
    expect(useChatStore.getState().messages).toEqual([]);
  });

  it('hydrates the new gateway runtime after an older runtime changes while pending', async () => {
    let releaseFirstSessions!: () => void;
    const firstSessionsPending = new Promise<void>((resolve) => {
      releaseFirstSessions = resolve;
    });
    let sessionsCalls = 0;
    const historyRuntimeKeys: number[] = [];
    gatewayRpcMock.mockImplementation(async (method: string) => {
      if (method === 'sessions.list') {
        sessionsCalls += 1;
        if (sessionsCalls === 1) await firstSessionsPending;
        return { sessions: [{ key: 'agent:main:main' }] };
      }
      if (method === 'chat.history') {
        historyRuntimeKeys.push(runtimeStatus.connectedAt);
        return { messages: [{ role: 'assistant', content: 'new runtime history' }] };
      }
      throw new Error(`Unexpected gateway RPC: ${method}`);
    });
    const { useChatStore } = await import('@/stores/chat');

    const firstRuntimeKey = runtimeStatus.connectedAt;
    const firstHydration = useChatStore.getState().hydrateStartup();
    await vi.waitFor(() => expect(sessionsCalls).toBe(1));

    runtimeStatus.connectedAt = firstRuntimeKey + 1;
    const secondHydration = useChatStore.getState().hydrateStartup();
    releaseFirstSessions();
    await Promise.all([firstHydration, secondHydration]);

    expect(historyRuntimeKeys).toEqual([runtimeStatus.connectedAt]);
    expect(useChatStore.getState().startupPhase).toBe('ready');
    expect(useChatStore.getState().messages[0]?.content).toBe('new runtime history');
  });
});
