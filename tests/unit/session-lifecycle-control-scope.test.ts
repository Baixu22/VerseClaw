import { beforeEach, describe, expect, it, vi } from 'vitest';
const remote = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('sonner', () => ({ toast: { warning: vi.fn(), error: vi.fn(), success: vi.fn(), info: vi.fn() } }));
vi.mock('@/stores/gateway', () => ({ useGatewayStore: { getState: () => ({ rpc: remote.rpc }) } }));
vi.mock('@/stores/agents', () => ({ useAgentsStore: { getState: () => ({ agents: [] }) } }));
vi.mock('@/lib/host-api', () => ({ hostApi: { gateway: { rpc: remote.rpc }, media: { thumbnails: async () => ({}) },
  sessions: { history: async () => ({ messages: [] }), summaries: async () => ({ success: true, summaries: [] }) } } }));
import { useChatStore } from '@/stores/chat';
import { useWorkspacesStore } from '@/stores/workspaces';
const originalSend = useChatStore.getState().sendMessage;

const source = 'agent:main:source';
beforeEach(() => {
  remote.rpc.mockReset();
  useChatStore.setState({ currentSessionKey: source, currentAgentId: 'main', activeRunId: 'run-a', sending: true,
    sessions: [{ key: source, sessionId: 'generation-a' }], messages: [], streamingText: 'Keep this partial output',
    error: null, pendingFinal: true, sessionLabels: {}, sessionLastActivity: {}, pendingMessages: [], sendMessage: originalSend });
  useWorkspacesStore.setState({ activeWorkspaceId: 'workspace-a' });
});
describe('session lifecycle result scope', () => {
  it('assigns a new renderer visit revision when a session view is reset', () => {
    const before = useChatStore.getState().viewRevision ?? 0;
    const load = useChatStore.getState().loadHistory;
    useChatStore.setState({ loadHistory: vi.fn(async () => undefined) });
    useChatStore.getState().resetSessionView(source);
    expect(useChatStore.getState().viewRevision).toBe(before + 1);
    useChatStore.setState({ loadHistory: load });
  });
  it('keeps queued messages attached to their original workspace, session and generation', async () => {
    useChatStore.getState().queuePendingMessage('Queued for A');
    const pending = useChatStore.getState().pendingMessages[0];
    expect(pending).toMatchObject({ targetSessionKey: source, opts: { workspaceId: 'workspace-a', targetSessionKey: source,
      expectedSessionGeneration: 'generation-a', idempotencyKey: expect.any(String) } });
    const send = vi.fn(async () => undefined);
    useChatStore.setState({ currentSessionKey: 'agent:main:other', sending: false, sendMessage: send });
    useWorkspacesStore.setState({ activeWorkspaceId: 'workspace-b' });
    useChatStore.getState().drainPendingMessages();
    expect(send).not.toHaveBeenCalled();
    expect(useChatStore.getState().pendingMessages).toHaveLength(1);
    useChatStore.setState({ currentSessionKey: source }); useWorkspacesStore.setState({ activeWorkspaceId: 'workspace-a' });
    useChatStore.getState().drainPendingMessages();
    await vi.waitFor(() => expect(send).toHaveBeenCalledWith('Queued for A', pending.opts));
  });
  it.each(['session', 'run', 'generation'] as const)('does not clear a new %s while the old abort response is pending', async (change) => {
    let finish!: (value: unknown) => void;
    remote.rpc.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const pending = useChatStore.getState().abortRun();
    expect(remote.rpc).toHaveBeenCalledWith('chat.abort', { sessionKey: source, runId: 'run-a' });
    expect(useChatStore.getState().sending).toBe(true);
    if (change === 'session') useChatStore.setState({ currentSessionKey: 'agent:main:other' });
    if (change === 'run') useChatStore.setState({ activeRunId: 'run-b' });
    if (change === 'generation') useChatStore.setState({ sessions: [{ key: source, sessionId: 'generation-b' }] });
    finish({ ok: true, aborted: true, runIds: ['run-a'] }); await pending;
    expect(useChatStore.getState().sending).toBe(true);
    expect(useChatStore.getState().streamingText).toBe('Keep this partial output');
  });
  it('clears the matching run only after owner confirmation', async () => {
    let finish!: (value: unknown) => void;
    remote.rpc.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const pending = useChatStore.getState().abortRun();
    expect(useChatStore.getState().sending).toBe(true);
    finish({ ok: true, aborted: true, runIds: ['run-a'] }); await pending;
    expect(useChatStore.getState().sending).toBe(false);
    expect(useChatStore.getState().activeRunId).toBeNull();
  });
  it('retains a still-active run when the abort receipt cannot confirm it', async () => {
    remote.rpc.mockImplementation(async (method: string) => method === 'chat.abort'
      ? { ok: true, aborted: false, runIds: [] } : { session: { sessionId: 'generation-a', hasActiveRun: true } });
    await useChatStore.getState().abortRun();
    expect(useChatStore.getState()).toMatchObject({ sending: true, activeRunId: 'run-a', streamingText: 'Keep this partial output' });
    expect(useChatStore.getState().error).toBeTruthy();
  });
  it('clears an old rejection on retry and accepts an owner-confirmed idle generation', async () => {
    useChatStore.setState({ error: 'earlier rejection' });
    remote.rpc.mockImplementation(async (method: string) => method === 'chat.abort'
      ? { ok: true, aborted: false, runIds: [] } : { session: { sessionId: 'generation-a', hasActiveRun: false } });
    await useChatStore.getState().abortRun();
    expect(useChatStore.getState()).toMatchObject({ sending: false, activeRunId: null, error: null });
  });
  it('preserves materialized empty sessions and only hides a local pending entry', () => {
    useChatStore.getState().cleanupEmptySession();
    expect(useChatStore.getState().sessions).toHaveLength(1);
    useChatStore.setState({ sessions: [{ key: source }] });
    useChatStore.getState().cleanupEmptySession();
    expect(useChatStore.getState().sessions).toHaveLength(0);
    expect(remote.rpc).not.toHaveBeenCalled();
  });
});
