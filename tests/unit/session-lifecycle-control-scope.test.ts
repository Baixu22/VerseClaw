import { beforeEach, describe, expect, it, vi } from 'vitest';
const remote = vi.hoisted(() => ({ rpc: vi.fn(), delete: vi.fn(), archive: vi.fn(), listArchived: vi.fn(), restore: vi.fn(), permanentDelete: vi.fn() }));
vi.mock('sonner', () => ({ toast: { warning: vi.fn(), error: vi.fn(), success: vi.fn(), info: vi.fn() } }));
vi.mock('@/stores/gateway', () => ({ useGatewayStore: { getState: () => ({ rpc: remote.rpc }) } }));
vi.mock('@/stores/agents', () => ({ useAgentsStore: { getState: () => ({ agents: [] }) } }));
vi.mock('@/lib/host-api', () => ({ hostApi: { gateway: { rpc: remote.rpc }, media: { thumbnails: async () => ({}) },
  sessions: { delete: remote.delete, archive: remote.archive, listArchived: remote.listArchived, restore: remote.restore, permanentDelete: remote.permanentDelete, history: async () => ({ messages: [] }), summaries: async () => ({ success: true, summaries: [] }) } } }));
import { useChatStore } from '@/stores/chat';
import { useWorkspacesStore } from '@/stores/workspaces';
const originalSend = useChatStore.getState().sendMessage;
const originalLoadArchived = useChatStore.getState().loadArchivedSessions;

const source = 'agent:main:source';
beforeEach(() => {
  remote.rpc.mockReset(); remote.delete.mockReset(); remote.archive.mockReset(); remote.listArchived.mockReset(); remote.restore.mockReset(); remote.permanentDelete.mockReset();
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
  it('removes an archived current session after its owner rotates the generation', async () => {
    let finish!: (value: unknown) => void;
    const readSessions = useChatStore.getState().loadSessions;
    const readArchived = useChatStore.getState().loadArchivedSessions;
    const refresh = vi.fn(async () => undefined);
    const refreshArchived = vi.fn(async () => {
      useChatStore.setState({ archivedSessions: [{ sessionKey: source } as never] });
    });
    remote.archive.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    useChatStore.setState({ loadSessions: refresh, loadArchivedSessions: refreshArchived, archivedSessions: [] });
    try {
      const pending = useChatStore.getState().archiveSession(source);
      useChatStore.setState({ sessions: [{ key: source, sessionId: 'generation-archived' }] });
      finish({ success: true });
      await pending;
      expect(useChatStore.getState().sessions).toEqual([]);
      expect(useChatStore.getState().currentSessionKey).not.toBe(source);
      expect(refreshArchived).toHaveBeenCalledTimes(1);
      expect(refresh).not.toHaveBeenCalled();
    } finally {
      useChatStore.setState({ loadSessions: readSessions, loadArchivedSessions: readArchived });
    }
  });  it.each(['deleteSession', 'archiveSession'] as const)('keeps a restored generation when an old %s success arrives', async (action) => {
    let finish!: (value: unknown) => void;
    const read = useChatStore.getState().loadSessions;
    const refresh = vi.fn(async () => undefined);
    remote[action === 'deleteSession' ? 'delete' : 'archive'].mockReturnValue(new Promise(resolve => { finish = resolve; }));
    useChatStore.setState({ loadSessions: refresh });
    try {
      const pending = useChatStore.getState()[action](source);
      useChatStore.setState({ viewRevision: (useChatStore.getState().viewRevision ?? 0) + 2,
        sessions: [{ key: source, sessionId: 'generation-restored' }], streamingText: 'new generation input',
        activeRunId: 'restored-run', sending: true });
      finish({ success: true }); await pending;
      expect(useChatStore.getState()).toMatchObject({ currentSessionKey: source,
        sessions: [{ key: source, sessionId: 'generation-restored' }], streamingText: 'new generation input', activeRunId: 'restored-run' });
      expect(refresh).toHaveBeenCalledTimes(1);
    } finally { useChatStore.setState({ loadSessions: read }); }
  });
  it('preserves the source run cache after switching away from an unconfirmed Stop', async () => {
    let finish!: (value: unknown) => void;
    remote.rpc.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const oldHistory = useChatStore.getState().loadHistory, oldLedger = useChatStore.getState().refreshTaskLedger;
    useChatStore.setState({ loadHistory: vi.fn(async () => undefined), refreshTaskLedger: vi.fn(async () => undefined),
      sessions: [{ key: source, sessionId: 'generation-a' }, { key: 'agent:main:other', sessionId: 'generation-b' }] });
    try {
      const pending = useChatStore.getState().abortRun();
      useChatStore.getState().switchSession('agent:main:other');
      finish({ ok: true, aborted: false, runIds: [] }); await pending;
      useChatStore.getState().switchSession(source);
      expect(useChatStore.getState()).toMatchObject({ sending: true, activeRunId: 'run-a', streamingText: 'Keep this partial output' });
    } finally { useChatStore.setState({ loadHistory: oldHistory, refreshTaskLedger: oldLedger }); }
  });
  it('rejects old-agent refreshes and ignores reads completing after an agent switch', async () => {
    let finish!: (value: unknown) => void;
    remote.listArchived.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const pending = originalLoadArchived('main');
    useChatStore.setState({ currentAgentId: 'reviewer', archivedSessions: [], pendingSessionMutations: [] });
    finish({ success: true, entries: [], pendingMutations: [{ operationId: 'old', agentId: 'main', sessionKey: source, operationKind: 'delete', createdAt: 1 }] });
    await pending;
    expect(useChatStore.getState().pendingSessionMutations).toEqual([]);
    await originalLoadArchived('main');
    expect(remote.listArchived).toHaveBeenCalledTimes(1);
  });
  it.each(['restoreSession', 'permanentDeleteSession'] as const)('keeps a later archive when an old %s response arrives', async (action) => {
    const previous = { sessionKey: source, agentId: 'main', transcriptPath: 'first', label: 'First', archivedAt: 1,
      originalWorkspaceId: null, originalFolderId: null, sessionsJsonSnapshot: { sessionId: 'old' } };
    const next = { ...previous, transcriptPath: 'second', archivedAt: 2, sessionsJsonSnapshot: { sessionId: 'new' } };
    let finish!: (value: unknown) => void;
    remote[action === 'restoreSession' ? 'restore' : 'permanentDelete'].mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const oldLoad = useChatStore.getState().loadSessions;
    useChatStore.setState({ archivedSessions: [previous], loadSessions: vi.fn(async () => undefined) });
    try {
      const pending = useChatStore.getState()[action](source);
      useChatStore.setState({ archivedSessions: [next] });
      finish({ success: true }); await pending;
      expect(useChatStore.getState().archivedSessions).toEqual([next]);
    } finally { useChatStore.setState({ loadSessions: oldLoad }); }
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
