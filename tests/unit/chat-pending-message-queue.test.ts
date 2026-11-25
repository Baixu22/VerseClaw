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

  it('delivers a displayed question response immediately without long-task inputMode', async () => {
    const { useChatStore } = await import('@/stores/chat');
    hostApiFetchMock.mockResolvedValue({ success: true, result: { runId: 'answer-1' } });
    useChatStore.setState({ messages: [], pendingMessages: [], sending: true, activeRunId: 'run-1',
      currentSessionKey: 'agent:main:main', currentAgentId: 'main' });
    await useChatStore.getState().sendMessage('Tool UI response:\n{"type":"question-flow","id":"q-1"}', { respondToInteraction: true });
    expect(useChatStore.getState().pendingMessages).toHaveLength(0);
    const payload = JSON.parse(hostApiFetchMock.mock.calls[0][1].body);
    expect(payload.sessionKey).toBe('agent:main:main');
    expect(payload.inputMode).toBeUndefined();
    expect(payload.respondToInteraction).toBeUndefined();
  });

  it('does not report a model outage while the current runtime is waiting for permission', async () => {
    const { useChatStore } = await import('@/stores/chat');
    hostApiFetchMock.mockResolvedValue({ success: true, result: { runId: 'waiting-1' } });
    useChatStore.setState({ messages: [], pendingMessages: [], runtimeRuns: {}, sending: false, activeRunId: null,
      error: null, runError: null, currentSessionKey: 'agent:main:main', currentAgentId: 'main' });
    await useChatStore.getState().sendMessage('Verify the build');
    useChatStore.getState().handleRuntimeEvent({ type: 'run.started', runId: 'waiting-1', sessionKey: 'agent:main:main', startedAt: Date.now() });
    useChatStore.getState().handleRuntimeEvent({ type: 'approval.updated', runId: 'waiting-1', sessionKey: 'agent:main:main', itemId: 'permission-1', phase: 'pending' });
    await vi.advanceTimersByTimeAsync(150_000);
    expect(useChatStore.getState().runError).toBeNull();
    expect(useChatStore.getState().error).toBeNull();
    expect(useChatStore.getState().sending).toBe(true);
    useChatStore.getState().handleRuntimeEvent({ type: 'run.ended', runId: 'waiting-1', sessionKey: 'agent:main:main', status: 'completed', endedAt: Date.now() });
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
  it.each([true, false])('keeps a send to B in B during history loading (target cached: %s)', async (cached) => {
    const { useChatStore } = await import('@/stores/chat');
    const { useWorkspacesStore } = await import('@/stores/workspaces');
    useWorkspacesStore.setState({ activeWorkspaceId: 'workspace-a' });
    let finishHistory!: () => void;
    const history = new Promise<void>(resolve => { finishHistory = resolve; });
    const originalHistory = useChatStore.getState().loadHistory;
    useChatStore.setState({ currentSessionKey: 'agent:main:a', currentAgentId: 'main', messages: [], sending: false,
      activeRunId: null, error: null, sessions: [{ key: 'agent:main:a', sessionId: 'a' }, ...(cached ? [{ key: 'agent:main:b', sessionId: 'b' }] : []),
        { key: 'agent:main:c', sessionId: 'c' }], loadHistory: vi.fn(() => history) });
    hostApiFetchMock.mockResolvedValue({ success: true, result: { runId: 'run-b' } });
    const flight = useChatStore.getState().sendMessage('Message for B', { workspaceId: 'workspace-a', targetSessionKey: 'agent:main:b', expectedSessionGeneration: 'b' });
    useChatStore.setState({ currentSessionKey: 'agent:main:c', messages: [{ id: 'c-message', role: 'user', content: 'C history' }],
      sending: false, activeRunId: null, error: 'C error' });
    finishHistory();
    await flight;
    expect(useChatStore.getState()).toMatchObject({ currentSessionKey: 'agent:main:c', sending: false, activeRunId: null, error: 'C error' });
    expect(useChatStore.getState().messages.map(message => message.content)).toEqual(['C history']);
    expect(JSON.parse(hostApiFetchMock.mock.calls[0][1].body).sessionKey).toBe('agent:main:b');
    useChatStore.getState().switchSession('agent:main:b');
    expect(useChatStore.getState().messages.map(message => message.content)).toContain('Message for B');
    expect(useChatStore.getState().activeRunId).toBe('run-b');
    useChatStore.setState({ loadHistory: originalHistory });
  });
  it('keeps a late resource denial out of the selected session', async () => {
    const { useChatStore } = await import('@/stores/chat');
    const { useWorkspacesStore } = await import('@/stores/workspaces');
    useWorkspacesStore.setState({ activeWorkspaceId: 'workspace-a' });
    let finishHistory!: () => void;
    const history = new Promise<void>(resolve => { finishHistory = resolve; });
    const originalHistory = useChatStore.getState().loadHistory;
    useChatStore.setState({ currentSessionKey: 'agent:main:a', currentAgentId: 'main', messages: [], sending: false,
      activeRunId: null, sessions: [{ key: 'agent:main:a', sessionId: 'a' }, { key: 'agent:main:b', sessionId: 'b' },
        { key: 'agent:main:c', sessionId: 'c' }], loadHistory: vi.fn(() => history) });
    hostApiFetchMock.mockResolvedValue({ success: false, denial: { code: 'global_concurrent_runs', used: 1, limit: 1 } });
    const flight = useChatStore.getState().sendMessage('Rejected B message', { workspaceId: 'workspace-a', targetSessionKey: 'agent:main:b', expectedSessionGeneration: 'b' });
    useChatStore.setState({ currentSessionKey: 'agent:main:c', messages: [{ id: 'c-message', role: 'user', content: 'C history' }],
      sending: true, activeRunId: 'run-c', error: 'C error' });
    finishHistory();
    await flight;
    expect(useChatStore.getState()).toMatchObject({ currentSessionKey: 'agent:main:c', sending: true, activeRunId: 'run-c', error: 'C error' });
    expect(useChatStore.getState().messages.map(message => message.content)).toEqual(['C history']);
    useChatStore.getState().switchSession('agent:main:b');
    expect(useChatStore.getState().messages.map(message => message.content)).not.toContain('Rejected B message');
    expect(useChatStore.getState().sending).toBe(false);
    useChatStore.setState({ loadHistory: originalHistory });
  });
  it('does not write a delayed send into a reused session in another workspace', async () => {
    const { useChatStore } = await import('@/stores/chat');
    const { useWorkspacesStore } = await import('@/stores/workspaces');
    useWorkspacesStore.setState({ activeWorkspaceId: 'workspace-a' });
    let finishHistory!: () => void;
    const history = new Promise<void>(resolve => { finishHistory = resolve; });
    const originalHistory = useChatStore.getState().loadHistory;
    useChatStore.setState({ currentSessionKey: 'agent:main:a', currentAgentId: 'main', messages: [], sending: false,
      activeRunId: null, sessions: [{ key: 'agent:main:a', sessionId: 'a' }, { key: 'agent:main:b', sessionId: 'b' }, { key: 'agent:main:c', sessionId: 'c' }],
      loadHistory: vi.fn(() => history) });
    hostApiFetchMock.mockResolvedValue({ success: true, result: { runId: 'old-workspace-run' } });
    const flight = useChatStore.getState().sendMessage('Old workspace message', { workspaceId: 'workspace-a', targetSessionKey: 'agent:main:b', expectedSessionGeneration: 'b' });
    useWorkspacesStore.setState({ activeWorkspaceId: 'workspace-b' });
    useChatStore.setState({ currentSessionKey: 'agent:main:b', messages: [{ role: 'user', content: 'New workspace history' }],
      sending: false, activeRunId: null, runError: 'New workspace error' });
    finishHistory();
    await flight;
    expect(useChatStore.getState().messages.map(message => message.content)).toEqual(['New workspace history']);
    expect(useChatStore.getState().runError).toBe('New workspace error');
    expect(useChatStore.getState().activeRunId).toBeNull();
    useChatStore.getState().switchSession('agent:main:c');
    useChatStore.getState().switchSession('agent:main:b');
    expect(useChatStore.getState().messages.map(message => message.content)).not.toContain('Old workspace message');
    expect(useChatStore.getState().runError).toBe('New workspace error');
    useChatStore.setState({ loadHistory: originalHistory });
  });
  it('discards a successful reply after the target generation changed', async () => {
    const { useChatStore } = await import('@/stores/chat');
    const { useWorkspacesStore } = await import('@/stores/workspaces');
    useWorkspacesStore.setState({ activeWorkspaceId: 'workspace-a' });
    let finish!: (reply: unknown) => void;
    hostApiFetchMock.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    useChatStore.setState({ currentSessionKey: 'agent:main:b', currentAgentId: 'main', messages: [], sending: false,
      activeRunId: null, sessions: [{ key: 'agent:main:b', sessionId: 'old' }] });
    const flight = useChatStore.getState().sendMessage('Old generation', { workspaceId: 'workspace-a', expectedSessionGeneration: 'old' });
    useChatStore.setState({ sessions: [{ key: 'agent:main:b', sessionId: 'new' }], messages: [{ role: 'user', content: 'New generation history' }],
      sending: false, activeRunId: null, runError: null });
    finish({ success: true, result: { runId: 'old-run' } });
    await flight;
    expect(useChatStore.getState().messages.map(message => message.content)).toEqual(['New generation history']);
    expect(useChatStore.getState().activeRunId).toBeNull();
  });
  it('settles the original cached send when its workspace was changed before failure', async () => {
    const { useChatStore } = await import('@/stores/chat');
    const { useWorkspacesStore } = await import('@/stores/workspaces');
    useWorkspacesStore.setState({ activeWorkspaceId: 'workspace-a' });
    let finish!: (reply: unknown) => void;
    hostApiFetchMock.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const originalHistory = useChatStore.getState().loadHistory;
    useChatStore.setState({ currentSessionKey: 'agent:main:b', currentAgentId: 'main', messages: [], sending: false,
      activeRunId: null, sessions: [{ key: 'agent:main:b', sessionId: 'b' }, { key: 'agent:main:c', sessionId: 'c' }], loadHistory: vi.fn(async () => undefined) });
    const flight = useChatStore.getState().sendMessage('Unconfirmed old send', { workspaceId: 'workspace-a' });
    useChatStore.getState().switchSession('agent:main:c');
    useWorkspacesStore.setState({ activeWorkspaceId: 'workspace-b' });
    finish({ success: false, error: 'Original owner refused' });
    await flight;
    useWorkspacesStore.setState({ activeWorkspaceId: 'workspace-a' });
    useChatStore.getState().switchSession('agent:main:b');
    expect(useChatStore.getState().sending).toBe(false);
    expect(useChatStore.getState().messages.map(message => message.content)).not.toContain('Unconfirmed old send');
    useChatStore.setState({ loadHistory: originalHistory });
  });
  it('cleans an old cached send after generation refresh without reviving its message', async () => {
    const { useChatStore } = await import('@/stores/chat');
    const { useWorkspacesStore } = await import('@/stores/workspaces');
    useWorkspacesStore.setState({ activeWorkspaceId: 'workspace-a' });
    let finish!: (reply: unknown) => void;
    hostApiFetchMock.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const originalHistory = useChatStore.getState().loadHistory;
    useChatStore.setState({ currentSessionKey: 'agent:main:b', currentAgentId: 'main', messages: [], sending: false,
      activeRunId: null, sessions: [{ key: 'agent:main:b', sessionId: 'old' }, { key: 'agent:main:c', sessionId: 'c' }],
      loadHistory: vi.fn(async () => undefined) });
    const flight = useChatStore.getState().sendMessage('Old cached generation', { workspaceId: 'workspace-a', expectedSessionGeneration: 'old' });
    useChatStore.getState().switchSession('agent:main:c');
    useChatStore.setState({ sessions: [{ key: 'agent:main:b', sessionId: 'new' }, { key: 'agent:main:c', sessionId: 'c' }] });
    finish({ success: true, result: { runId: 'old-cached-run' } });
    await flight;
    useChatStore.getState().switchSession('agent:main:b');
    expect(useChatStore.getState().sending).toBe(false);
    expect(useChatStore.getState().messages.map(message => message.content)).not.toContain('Old cached generation');
    useChatStore.setState({ loadHistory: originalHistory });
  });
});
