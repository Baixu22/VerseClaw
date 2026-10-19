import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runtimeStatus = {
  state: 'running',
  port: 18789,
  connectedAt: 0,
};

const { gatewayRpcMock, hostApiFetchMock } = vi.hoisted(() => ({
  gatewayRpcMock: vi.fn(),
  hostApiFetchMock: vi.fn(),
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
  hostApiFetch: (...args: unknown[]) => hostApiFetchMock(...args),
  hostApi: {
    media: {
      thumbnails: vi.fn(async () => ({})),
    },
    sessions: {
      summaries: (input: unknown) => hostApiFetchMock('/api/sessions/summaries', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
      history: vi.fn(async () => ({ messages: [] })),
      delete: vi.fn(async () => ({ success: true })),
      rename: vi.fn(async () => ({ success: true })),
    },
    chat: {
      sendWithMedia: vi.fn(async () => ({ success: true, result: { runId: 'run-media' } })),
    },
  },
}));

describe('chat session label hydration budget', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-19T00:00:00Z'));
    runtimeStatus.connectedAt = Date.now();
    window.localStorage.clear();
    gatewayRpcMock.mockReset();
    hostApiFetchMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('scans only the newest 40 sessions once and honors the 30-second sweep cooldown', async () => {
    const sessions = Array.from({ length: 333 }, (_, index) => ({
      key: `agent:main:s${index.toString().padStart(3, '0')}`,
      updatedAt: index + 1,
    }));
    sessions.push({ key: 'agent:main:main', updatedAt: 10_000 });
    gatewayRpcMock.mockImplementation(async (method: string) => {
      if (method === 'sessions.list') return { sessions };
      if (method === 'chat.history') {
        return { messages: [{ role: 'user', content: 'current session', timestamp: Date.now() }] };
      }
      throw new Error(`Unexpected gateway RPC: ${method}`);
    });
    hostApiFetchMock.mockImplementation(async (path: string, init?: { body?: string }) => {
      if (path !== '/api/sessions/summaries') return { success: true, summaries: [] };
      const payload = JSON.parse(init?.body ?? '{}') as { sessionKeys?: string[] };
      return {
        success: true,
        summaries: (payload.sessionKeys ?? []).map((sessionKey) => ({
          sessionKey,
          firstUserText: `label ${sessionKey}`,
          lastTimestamp: Date.now(),
        })),
      };
    });

    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      currentSessionKey: 'agent:main:s331',
      currentAgentId: 'main',
      sessions: [],
      messages: [],
      sessionLabels: {},
      sessionLastActivity: {},
      sending: false,
      activeRunId: null,
      streamingText: '',
      streamingMessage: null,
      streamingTools: [],
      pendingFinal: false,
      lastUserMessageAt: null,
      pendingToolImages: [],
      error: null,
      loading: false,
      thinkingLevel: null,
      runError: null,
    });

    await useChatStore.getState().loadSessions();
    await vi.waitFor(() => {
      expect(hostApiFetchMock).toHaveBeenCalledTimes(1);
    });

    const firstPayload = JSON.parse(hostApiFetchMock.mock.calls[0]![1].body) as { sessionKeys: string[] };
    expect(firstPayload.sessionKeys).toHaveLength(40);
    expect(firstPayload.sessionKeys).toContain('agent:main:s293');
    expect(firstPayload.sessionKeys).toContain('agent:main:s332');
    expect(firstPayload.sessionKeys).not.toContain('agent:main:s292');
    expect(firstPayload.sessionKeys).not.toContain('agent:main:main');

    vi.advanceTimersByTime(2_000);
    await useChatStore.getState().loadHistory(false);
    await Promise.resolve();
    await Promise.resolve();
    expect(hostApiFetchMock).toHaveBeenCalledTimes(1);
  });
});