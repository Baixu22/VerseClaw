import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chatHistoryRpcParams } from './gateway-rpc-test-utils';

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
      sendWithMedia: async (input: unknown) => hostApiFetchMock('/api/chat/send-with-media', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    },
  },
}));

describe('chat target routing', () => {
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
      {
        id: 'research',
        name: 'Research',
        isDefault: false,
        modelDisplay: 'Claude',
        inheritedModel: false,
        workspace: '~/.openclaw/workspace-research',
        agentDir: '~/.openclaw/agents/research/agent',
        mainSessionKey: 'agent:research:desk',
        channelTypes: [],
      },
    ];

    gatewayRpcMock.mockReset();
    gatewayRpcMock.mockImplementation(async (method: string) => {
      if (method === 'config.get') {
        return { messages: [] };
      }
      if (method === 'chat.history') {
        return { messages: [] };
      }
      if (method === 'chat.send') {
        return { runId: 'run-text' };
      }
      if (method === 'chat.abort') {
        return { ok: true };
      }
      if (method === 'sessions.list') {
        return { sessions: [] };
      }
      throw new Error(`Unexpected gateway RPC: ${method}`);
    });

    hostApiFetchMock.mockReset();
    hostApiFetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/chat/history') {
        return { success: true, result: { messages: [] } };
      }
      if (url === '/api/chat/send') {
        return { success: true, result: { runId: 'run-text' } };
      }
      if (url === '/api/chat/send-with-media') {
        return { success: true, result: { runId: 'run-media' } };
      }
      return { success: true, result: {} };
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('switches to the selected agent main session before sending text', async () => {
    const { useChatStore } = await import('@/stores/chat');

    useChatStore.setState({
      currentSessionKey: 'agent:main:main',
      currentAgentId: 'main',
      sessions: [{ key: 'agent:main:main' }],
      messages: [{ role: 'assistant', content: 'Existing main history' }],
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
    });

    await useChatStore.getState().sendMessage('Hello direct agent', { targetAgentId: 'research' });

    const state = useChatStore.getState();
    expect(state.currentSessionKey).toBe('agent:research:desk');
    expect(state.currentAgentId).toBe('research');
    expect(state.sessions.some((session) => session.key === 'agent:research:desk')).toBe(true);
    expect(state.messages.at(-1)?.content).toBe('Hello direct agent');

    const historyCall = gatewayRpcMock.mock.calls.find(([method]) => method === 'chat.history');
    expect(historyCall?.[1]).toEqual(
      chatHistoryRpcParams('agent:research:desk', 200),
    );

    const sendCall = hostApiFetchMock.mock.calls.find(([url]) => url === '/api/chat/send-with-media');
    const sendPayload = JSON.parse((sendCall?.[1] as { body: string }).body) as Record<string, unknown>;
    expect(sendPayload).toMatchObject({
      sessionKey: 'agent:research:desk',
      message: 'Hello direct agent',
      deliver: false,
    });
    expect(sendPayload).not.toHaveProperty('knowledgeScope');
    expect(typeof (sendPayload as { idempotencyKey?: unknown }).idempotencyKey).toBe('string');
  });

  it('uses the selected agent main session for attachment sends', async () => {
    const { useChatStore } = await import('@/stores/chat');

    useChatStore.setState({
      currentSessionKey: 'agent:main:main',
      currentAgentId: 'main',
      sessions: [{ key: 'agent:main:main' }],
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
    });

    await useChatStore.getState().sendMessage(
      '',
      {
        attachments: [
          {
            fileName: 'design.png',
            mimeType: 'image/png',
            fileSize: 128,
            stagedPath: '/tmp/design.png',
            preview: 'data:image/png;base64,abc',
          },
        ],
        targetAgentId: 'research',
      },
    );

    expect(useChatStore.getState().currentSessionKey).toBe('agent:research:desk');

    expect(hostApiFetchMock).toHaveBeenCalledWith(
      '/api/chat/send-with-media',
      expect.objectContaining({
        method: 'POST',
        body: expect.any(String),
      }),
    );

    const mediaSendCall = hostApiFetchMock.mock.calls.find(([url]) => url === '/api/chat/send-with-media');
    const payload = JSON.parse(
      (mediaSendCall?.[1] as { body: string }).body,
    ) as {
      sessionKey: string;
      message: string;
      media: Array<{ filePath: string }>;
    };

    expect(payload.sessionKey).toBe('agent:research:desk');
    expect(payload.message).toBe('Process the attached file(s).');
    expect(payload.media[0]?.filePath).toBe('/tmp/design.png');
  });

  it('passes the selected knowledge scope through host chat send', async () => {
    const { useChatStore } = await import('@/stores/chat');

    useChatStore.setState({
      currentSessionKey: 'agent:main:main',
      currentAgentId: 'main',
      sessions: [{ key: 'agent:main:main' }],
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
    });

    await useChatStore.getState().sendMessage('Use wiki context', { knowledgeScope: 'wiki' });

    const sendCall = hostApiFetchMock.mock.calls.find(([url]) => url === '/api/chat/send-with-media');
    const payload = JSON.parse((sendCall?.[1] as { body: string }).body) as Record<string, unknown>;
    expect(payload).toMatchObject({
      sessionKey: 'agent:main:main',
      message: 'Use wiki context',
      knowledgeScope: 'wiki',
    });
  });

  it('forwards turn-scoped modelRefOverride to host chat send (Area 2 §3.2)', async () => {
    const { useChatStore } = await import('@/stores/chat');

    useChatStore.setState({
      currentSessionKey: 'agent:main:main',
      currentAgentId: 'main',
      sessions: [{ key: 'agent:main:main' }],
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
    });

    await useChatStore.getState().sendMessage('Turn override test', {
      modelRefOverride: 'provider/cheap-model',
    });

    const sendCall = hostApiFetchMock.mock.calls.find(([url]) => url === '/api/chat/send-with-media');
    const payload = JSON.parse((sendCall?.[1] as { body: string }).body) as Record<string, unknown>;
    expect(payload).toMatchObject({
      sessionKey: 'agent:main:main',
      message: 'Turn override test',
      modelRef: 'provider/cheap-model',
    });
  });

  it('omits modelRef when no turn override is set (default path parity, Area 2 §6)', async () => {
    const { useChatStore } = await import('@/stores/chat');

    useChatStore.setState({
      currentSessionKey: 'agent:main:main',
      currentAgentId: 'main',
      sessions: [{ key: 'agent:main:main' }],
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
    });

    await useChatStore.getState().sendMessage('No override');

    const sendCall = hostApiFetchMock.mock.calls.find(([url]) => url === '/api/chat/send-with-media');
    const payload = JSON.parse((sendCall?.[1] as { body: string }).body) as Record<string, unknown>;
    expect(payload).not.toHaveProperty('modelRef');
  });
});
