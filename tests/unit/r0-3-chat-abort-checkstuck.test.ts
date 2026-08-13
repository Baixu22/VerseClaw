// R0-3: abortRun must confirm the gateway abort BEFORE releasing UI state,
// and the checkStuck chain must be a per-run singleton (no parallel chains).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';

const { gatewayRpcMock, hostApiFetchMock, agentsState } = vi.hoisted(() => ({
  gatewayRpcMock: vi.fn(),
  hostApiFetchMock: vi.fn(),
  agentsState: {
    agents: [] as Array<Record<string, unknown>>,
  },
}));

vi.mock('sonner', () => ({
  toast: {
    warning: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
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
      sendWithMedia: async (input: unknown) => hostApiFetchMock('/api/chat/send-with-media', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    },
  },
}));

function seedStore() {
  return {
    currentSessionKey: 'agent:main:main',
    currentAgentId: 'main',
    sessions: [{ key: 'agent:main:main' }],
    messages: [] as Array<Record<string, unknown>>,
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
  };
}

describe('R0-3 chat abort/checkStuck reclamation', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-11T12:00:00Z'));
    window.localStorage.clear();

    agentsState.agents = [
      {
        id: 'main',
        name: 'Main',
        isDefault: true,
        modelDisplay: 'MiniMax',
        inheritedModel: true,
        workspace: '~/.openclaw/workspace',
        agentDir: '~/.openclaw/agents/main/agent',
        mainSessionKey: 'agent:main:main',
        channelTypes: [],
      },
    ];

    gatewayRpcMock.mockReset();
    gatewayRpcMock.mockImplementation(async (method: string) => {
      if (method === 'config.get') return { messages: [] };
      if (method === 'chat.history') return { messages: [] };
      if (method === 'chat.send') return { runId: 'run-r0-3' };
      if (method === 'chat.abort') return { ok: true };
      if (method === 'sessions.list') return { sessions: [] };
      throw new Error('Unexpected gateway RPC: ' + method);
    });

    hostApiFetchMock.mockReset();
    hostApiFetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/chat/history') return { success: true, result: { messages: [] } };
      if (url === '/api/chat/send') return { success: true, result: { runId: 'run-r0-3' } };
      if (url === '/api/chat/send-with-media') return { success: true, result: { runId: 'run-r0-3' } };
      return { success: true, result: {} };
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps the run state when chat.abort fails and warns the user', async () => {
    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      ...seedStore(),
      sending: true,
      activeRunId: 'run-r0-3',
      streamingText: 'partial stream',
      streamingTools: [{ id: 'tool-1' }],
      pendingToolImages: [],
      pendingFinal: true,
      lastUserMessageAt: Date.now(),
    });

    gatewayRpcMock.mockImplementation(async (method: string) => {
      if (method === 'chat.abort') throw new Error('gateway refused abort');
      throw new Error('unexpected: ' + method);
    });

    await useChatStore.getState().abortRun();

    const state = useChatStore.getState();
    expect(state.sending).toBe(true); // restored — the run is still going
    expect(state.activeRunId).toBe('run-r0-3');
    expect(state.streamingText).toBe('partial stream');
    expect(state.error).toContain('gateway refused abort');
    expect(vi.mocked(toast.warning)).toHaveBeenCalledTimes(1);
  });

  it('releases UI state only after a confirmed abort', async () => {
    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      ...seedStore(),
      sending: true,
      activeRunId: 'run-r0-3',
      streamingText: 'partial stream',
      streamingTools: [{ id: 'tool-1' }],
      pendingFinal: true,
      lastUserMessageAt: Date.now(),
    });

    await useChatStore.getState().abortRun();

    const state = useChatStore.getState();
    expect(state.sending).toBe(false);
    expect(state.activeRunId).toBeNull();
    expect(state.streamingText).toBe('');
    expect(state.streamingTools).toEqual([]);
    expect(gatewayRpcMock).toHaveBeenCalledWith('chat.abort', { sessionKey: 'agent:main:main' });
    expect(vi.mocked(toast.warning)).not.toHaveBeenCalled();
  });

  it('keeps exactly one pending checkStuck chain across consecutive sends', async () => {
    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState(seedStore());

    await useChatStore.getState().sendMessage('first message');
    const afterFirstSend = vi.getTimerCount();
    expect(afterFirstSend).toBe(2); // 1 turn-timeout + 1 checkStuck

    // Simulate the run draining, then send again: the old chain must be
    // cleared, leaving exactly one turn-timeout + one checkStuck timer.
    useChatStore.setState({ sending: false });
    await useChatStore.getState().sendMessage('second message');
    const afterSecondSend = vi.getTimerCount();
    expect(afterSecondSend).toBe(2);
  });
});
