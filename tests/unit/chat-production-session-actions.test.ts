import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ archive: vi.fn(), restore: vi.fn(), remove: vi.fn(), list: vi.fn() }));
vi.mock('@/lib/host-api', () => ({ hostApi: { sessions: {
  archive: (input: unknown) => mocks.archive(input), restore: (input: unknown) => mocks.restore(input),
  permanentDelete: (input: unknown) => mocks.remove(input), listArchived: (input: unknown) => mocks.list(input),
} } }));

describe('production chat session actions', () => {
  beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); window.localStorage.clear(); });

  it('archives through the host service and switches the actual store to a retained session', async () => {
    mocks.archive.mockResolvedValue({ success: true });
    const { useChatStore } = await import('@/stores/chat');
    const history = vi.fn(); const archived = vi.fn();
    useChatStore.setState({ currentSessionKey: 'agent:main:a', sessions: [{ key: 'agent:main:a' }, { key: 'agent:main:b' }],
      messages: [], sessionLabels: { 'agent:main:a': 'A' }, sessionLastActivity: { 'agent:main:a': 1 },
      loadHistory: history, loadArchivedSessions: archived });
    await useChatStore.getState().archiveSession('agent:main:a', { workspaceId: 'workspace-a', folderId: 'folder-a' });
    expect(mocks.archive).toHaveBeenCalledWith({ id: 'agent:main:a', originalWorkspaceId: 'workspace-a', originalFolderId: 'folder-a' });
    expect(useChatStore.getState().currentSessionKey).toBe('agent:main:b');
    expect(useChatStore.getState().sessionLabels['agent:main:a']).toBeUndefined();
    expect(history).toHaveBeenCalledTimes(1);
    expect(archived).toHaveBeenCalledTimes(1);
  });

  it('preserves the sidebar on archive failure', async () => {
    mocks.archive.mockResolvedValue({ success: false, error: 'archive unavailable' });
    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({ currentSessionKey: 'agent:main:a', sessions: [{ key: 'agent:main:a' }], messages: [] });
    await expect(useChatStore.getState().archiveSession('agent:main:a')).rejects.toThrow('archive unavailable');
    expect(useChatStore.getState().sessions).toEqual([{ key: 'agent:main:a' }]);
  });

  it('restores only after a successful host result and refreshes actual session state', async () => {
    const { useChatStore } = await import('@/stores/chat');
    const refresh = vi.fn();
    useChatStore.setState({ archivedSessions: [{ sessionKey: 'agent:main:a' } as never], loadSessions: refresh });
    mocks.restore.mockResolvedValueOnce({ success: false }).mockResolvedValueOnce({ success: true });
    await useChatStore.getState().restoreSession('agent:main:a');
    expect(useChatStore.getState().archivedSessions).toHaveLength(1);
    expect(refresh).not.toHaveBeenCalled();
    await useChatStore.getState().restoreSession('agent:main:a');
    expect(useChatStore.getState().archivedSessions).toEqual([]);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('permanently removes only an acknowledged archive row and clears a failed archive listing', async () => {
    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({ archivedSessions: [{ sessionKey: 'agent:main:a' } as never] });
    mocks.remove.mockResolvedValueOnce({ success: false }).mockResolvedValueOnce({ success: true });
    await useChatStore.getState().permanentDeleteSession('agent:main:a');
    expect(useChatStore.getState().archivedSessions).toHaveLength(1);
    await useChatStore.getState().permanentDeleteSession('agent:main:a');
    expect(useChatStore.getState().archivedSessions).toEqual([]);
    mocks.list.mockRejectedValue(new Error('list unavailable'));
    await useChatStore.getState().loadArchivedSessions();
    expect(useChatStore.getState().archivedSessions).toEqual([]);
    expect(useChatStore.getState().archivedSessionsLoading).toBe(false);
  });
});
