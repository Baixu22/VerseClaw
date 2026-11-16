import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionFolder, WorkspaceProfile } from '@shared/types/workspace';

const hostApiMocks = vi.hoisted(() => ({
  saveState: vi.fn(),
  switchWorkspace: vi.fn(),
  createFolder: vi.fn(),
  moveSessionToFolder: vi.fn(),
}));

vi.mock('@/lib/host-api', () => ({
  hostApi: {
    workspaces: {
      list: vi.fn(),
      getActive: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      switch: hostApiMocks.switchWorkspace,
      saveState: hostApiMocks.saveState,
      createFolder: hostApiMocks.createFolder,
      moveSessionToFolder: hostApiMocks.moveSessionToFolder,
    },
  },
}));

function profile(overrides: Partial<WorkspaceProfile> = {}): WorkspaceProfile {
  return {
    id: 'workspace-1',
    name: 'Project',
    rootPath: 'C:/project',
    agentId: 'main',
    selectedAgentId: 'main',
    activeSessionKey: 'agent:main:main',
    agentBindings: {
      main: {
        workspaceId: 'workspace-1',
        agentId: 'main',
        sessionKey: 'agent:main:main',
      },
    },
    permissionMode: 'acceptEdits',
    createdAt: 1,
    updatedAt: 1,
    lastOpenedAt: 1,
    state: { draftInput: 'main draft' },
    sessionStates: {
      'agent:main:main': { draftInput: 'main draft' },
    },
    ...overrides,
  };
}

describe('workspaces store session state', () => {
  it('saves a newer draft after an in-flight save even when it returns to the original text', async () => {
    const { useWorkspacesStore } = await import('@/stores/workspaces');
    const initial = profile();
    useWorkspacesStore.setState({ profiles: [initial], activeWorkspaceId: initial.id, activeWorkspace: initial });
    let finish!: () => void;
    hostApiMocks.saveState.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    const first = useWorkspacesStore.getState().saveWorkspaceState({ id: initial.id, sessionKey: initial.activeSessionKey, state: { draftInput: 'first edit' } });
    await vi.waitFor(() => expect(hostApiMocks.saveState).toHaveBeenCalledTimes(1));
    const latest = useWorkspacesStore.getState().saveWorkspaceState({ id: initial.id, sessionKey: initial.activeSessionKey, state: { draftInput: 'main draft' } });
    finish();
    await Promise.all([first, latest]);
    expect(hostApiMocks.saveState).toHaveBeenCalledTimes(2);
    expect(hostApiMocks.saveState).toHaveBeenLastCalledWith(expect.objectContaining({ state: { draftInput: 'main draft' } }));
    expect(useWorkspacesStore.getState().activeWorkspace?.state?.draftInput).toBe('main draft');
  });
  it('selects the destination agent without replacing another agent session binding', async () => {
    const { useWorkspacesStore } = await import('@/stores/workspaces');
    const initial = profile({ selectedAgentId: 'reviewer', activeSessionKey: 'agent:reviewer:review',
      agentBindings: { main: { workspaceId: 'workspace-1', agentId: 'main', sessionKey: 'agent:main:main' },
        reviewer: { workspaceId: 'workspace-1', agentId: 'reviewer', sessionKey: 'agent:reviewer:review' } } });
    useWorkspacesStore.setState({ profiles: [initial], activeWorkspaceId: initial.id, activeWorkspace: initial });
    await useWorkspacesStore.getState().saveWorkspaceState({ id: initial.id, activeSessionKey: 'agent:main:main' });
    const updated = useWorkspacesStore.getState().activeWorkspace!;
    expect(updated.selectedAgentId).toBe('main');
    expect(updated.agentBindings?.reviewer.sessionKey).toBe('agent:reviewer:review');
    expect(updated.agentBindings?.main.sessionKey).toBe('agent:main:main');
  });
  it('does not resubmit identical presentation state or replace the active profile reference', async () => {
    const { useWorkspacesStore } = await import('@/stores/workspaces');
    const initial = profile();
    useWorkspacesStore.setState({ profiles: [initial], activeWorkspaceId: initial.id, activeWorkspace: initial });
    await useWorkspacesStore.getState().saveWorkspaceState({ id: initial.id, sessionKey: initial.activeSessionKey, state: { draftInput: 'main draft' } });
    await useWorkspacesStore.getState().saveWorkspaceState({ id: initial.id, activeSessionKey: initial.activeSessionKey });
    expect(hostApiMocks.saveState).not.toHaveBeenCalled();
    expect(useWorkspacesStore.getState().activeWorkspace).toBe(initial);
    await useWorkspacesStore.getState().saveWorkspaceState({ id: initial.id, sessionKey: initial.activeSessionKey, state: { draftInput: 'changed' } });
    const saved = useWorkspacesStore.getState().activeWorkspace;
    await useWorkspacesStore.getState().saveWorkspaceState({ id: initial.id, sessionKey: initial.activeSessionKey, state: { draftInput: 'changed' } });
    expect(hostApiMocks.saveState).toHaveBeenCalledTimes(1);
    expect(useWorkspacesStore.getState().activeWorkspace).toBe(saved);
  });
  beforeEach(async () => {
    vi.resetModules();
    hostApiMocks.saveState.mockReset();
    hostApiMocks.saveState.mockResolvedValue({ success: true });
    hostApiMocks.switchWorkspace.mockReset();
    hostApiMocks.createFolder.mockReset();
    hostApiMocks.moveSessionToFolder.mockReset();
  });

  it('does not leak the previous session state when only activeSessionKey changes', async () => {
    const { useWorkspacesStore } = await import('@/stores/workspaces');
    useWorkspacesStore.setState({
      profiles: [profile()],
      activeWorkspaceId: 'workspace-1',
      activeWorkspace: profile(),
      loading: false,
      error: null,
    });

    await useWorkspacesStore.getState().saveWorkspaceState({
      id: 'workspace-1',
      activeSessionKey: 'agent:main:empty',
    });

    const active = useWorkspacesStore.getState().activeWorkspace;
    expect(active?.activeSessionKey).toBe('agent:main:empty');
    expect(active?.agentBindings?.main.sessionKey).toBe('agent:main:empty');
    expect(active?.state).toEqual({});
    expect(active?.sessionStates?.['agent:main:main']).toEqual({ draftInput: 'main draft' });
    expect(active?.sessionStates?.['agent:main:empty']).toBeUndefined();
  });

  it('merges patch state only into the addressed session', async () => {
    const { useWorkspacesStore } = await import('@/stores/workspaces');
    useWorkspacesStore.setState({
      profiles: [profile({
        activeSessionKey: 'agent:main:feature',
        state: { draftInput: 'feature draft' },
        sessionStates: {
          'agent:main:main': { draftInput: 'main draft' },
          'agent:main:feature': { draftInput: 'feature draft' },
        },
      })],
      activeWorkspaceId: 'workspace-1',
      activeWorkspace: profile({
        activeSessionKey: 'agent:main:feature',
        state: { draftInput: 'feature draft' },
        sessionStates: {
          'agent:main:main': { draftInput: 'main draft' },
          'agent:main:feature': { draftInput: 'feature draft' },
        },
      }),
      loading: false,
      error: null,
    });

    await useWorkspacesStore.getState().saveWorkspaceState({
      id: 'workspace-1',
      sessionKey: 'agent:main:main',
      state: {
        terminal: { lastCommand: 'pnpm test' },
      },
    });

    const active = useWorkspacesStore.getState().activeWorkspace;
    expect(active?.state).toEqual({ draftInput: 'feature draft' });
    expect(active?.sessionStates?.['agent:main:main']).toEqual({
      draftInput: 'main draft',
      terminal: { lastCommand: 'pnpm test' },
    });
    expect(active?.sessionStates?.['agent:main:feature']).toEqual({ draftInput: 'feature draft' });
  });

  it('persists work context visibility inside the addressed chat footer session state', async () => {
    const { useWorkspacesStore } = await import('@/stores/workspaces');
    useWorkspacesStore.setState({
      profiles: [profile({
        activeSessionKey: 'agent:main:feature',
        state: {
          draftInput: 'feature draft',
          chatFooter: { contextRangeVisible: true, tokenUsageVisible: true, workContextVisible: true },
        },
        sessionStates: {
          'agent:main:main': {
            draftInput: 'main draft',
            chatFooter: { contextRangeVisible: true, tokenUsageVisible: false, workContextVisible: true },
          },
          'agent:main:feature': {
            draftInput: 'feature draft',
            chatFooter: { contextRangeVisible: true, tokenUsageVisible: true, workContextVisible: true },
          },
        },
      })],
      activeWorkspaceId: 'workspace-1',
      activeWorkspace: profile({
        activeSessionKey: 'agent:main:feature',
        state: {
          draftInput: 'feature draft',
          chatFooter: { contextRangeVisible: true, tokenUsageVisible: true, workContextVisible: true },
        },
        sessionStates: {
          'agent:main:main': {
            draftInput: 'main draft',
            chatFooter: { contextRangeVisible: true, tokenUsageVisible: false, workContextVisible: true },
          },
          'agent:main:feature': {
            draftInput: 'feature draft',
            chatFooter: { contextRangeVisible: true, tokenUsageVisible: true, workContextVisible: true },
          },
        },
      }),
      loading: false,
      error: null,
    });

    await useWorkspacesStore.getState().saveWorkspaceState({
      id: 'workspace-1',
      sessionKey: 'agent:main:main',
      state: {
        chatFooter: { workContextVisible: false },
      },
    });

    const active = useWorkspacesStore.getState().activeWorkspace;
    expect(active?.state.chatFooter).toEqual({
      contextRangeVisible: true,
      tokenUsageVisible: true,
      workContextVisible: true,
    });
    expect(active?.sessionStates?.['agent:main:main']).toEqual({
      draftInput: 'main draft',
      chatFooter: { contextRangeVisible: true, tokenUsageVisible: false, workContextVisible: false },
    });
    expect(active?.sessionStates?.['agent:main:feature']?.chatFooter).toEqual({
      contextRangeVisible: true,
      tokenUsageVisible: true,
      workContextVisible: true,
    });
  });

  it('drops legacy work mode from workspace session state', async () => {
    const { useWorkspacesStore } = await import('@/stores/workspaces');
    useWorkspacesStore.setState({
      profiles: [profile({
        activeSessionKey: 'agent:main:feature',
        state: { draftInput: 'feature draft', workMode: 'build' },
        sessionStates: {
          'agent:main:main': { draftInput: 'main draft', workMode: 'review' },
          'agent:main:feature': { draftInput: 'feature draft', workMode: 'build' },
        },
      })],
      activeWorkspaceId: 'workspace-1',
      activeWorkspace: profile({
        activeSessionKey: 'agent:main:feature',
        state: { draftInput: 'feature draft', workMode: 'build' },
        sessionStates: {
          'agent:main:main': { draftInput: 'main draft', workMode: 'review' },
          'agent:main:feature': { draftInput: 'feature draft', workMode: 'build' },
        },
      }),
      loading: false,
      error: null,
    });

    await useWorkspacesStore.getState().saveWorkspaceState({
      id: 'workspace-1',
      sessionKey: 'agent:main:main',
      state: { workMode: 'plan' },
    });

    const active = useWorkspacesStore.getState().activeWorkspace;
    expect(active?.state).toEqual({ draftInput: 'feature draft' });
    expect(active?.sessionStates?.['agent:main:main']).toEqual({ draftInput: 'main draft' });
    expect(active?.sessionStates?.['agent:main:feature']).toEqual({ draftInput: 'feature draft' });
  });

  it('switches active workspace to the target profile without mutating the previous workspace session state', async () => {
    const workspaceA = profile({
      id: 'workspace-a',
      name: 'A',
      rootPath: 'C:/a',
      activeSessionKey: 'agent:main:a-session',
      state: { draftInput: 'a draft', activeTopicId: 'topic-a' },
      sessionStates: {
        'agent:main:a-session': { draftInput: 'a draft', activeTopicId: 'topic-a' },
      },
    });
    const workspaceB = profile({
      id: 'workspace-b',
      name: 'B',
      rootPath: 'C:/b',
      activeSessionKey: 'agent:main:b-session',
      state: { draftInput: 'b draft', activeTopicId: 'topic-b' },
      sessionStates: {
        'agent:main:b-session': { draftInput: 'b draft', activeTopicId: 'topic-b' },
      },
    });
    hostApiMocks.switchWorkspace.mockResolvedValue({
      success: true,
      activeWorkspaceId: 'workspace-b',
      activeWorkspace: workspaceB,
    });

    const { useWorkspacesStore } = await import('@/stores/workspaces');
    useWorkspacesStore.setState({
      profiles: [workspaceA, workspaceB],
      activeWorkspaceId: 'workspace-a',
      activeWorkspace: workspaceA,
      loading: false,
      error: null,
    });

    await useWorkspacesStore.getState().switchWorkspace('workspace-b');

    const state = useWorkspacesStore.getState();
    expect(state.activeWorkspaceId).toBe('workspace-b');
    expect(state.activeWorkspace).toMatchObject({
      id: 'workspace-b',
      activeSessionKey: 'agent:main:b-session',
      state: { draftInput: 'b draft', activeTopicId: 'topic-b' },
      sessionStates: {
        'agent:main:b-session': { draftInput: 'b draft', activeTopicId: 'topic-b' },
      },
    });
    expect(state.profiles.find((entry) => entry.id === 'workspace-a')).toMatchObject({
      activeSessionKey: 'agent:main:a-session',
      state: { draftInput: 'a draft', activeTopicId: 'topic-a' },
    });
    expect(state.profiles.find((entry) => entry.id === 'workspace-b')).toMatchObject({
      activeSessionKey: 'agent:main:b-session',
      state: { draftInput: 'b draft', activeTopicId: 'topic-b' },
    });
  });

  it('adds the returned active workspace when the local profile list is stale', async () => {
    const workspaceB = profile({
      id: 'workspace-b',
      name: 'B',
      rootPath: 'C:/b',
      activeSessionKey: 'agent:main:b-session',
    });
    hostApiMocks.switchWorkspace.mockResolvedValue({
      success: true,
      activeWorkspaceId: 'workspace-b',
      activeWorkspace: workspaceB,
    });

    const { useWorkspacesStore } = await import('@/stores/workspaces');
    useWorkspacesStore.setState({
      profiles: [profile({ id: 'workspace-a', name: 'A', rootPath: 'C:/a' })],
      activeWorkspaceId: 'workspace-a',
      activeWorkspace: profile({ id: 'workspace-a', name: 'A', rootPath: 'C:/a' }),
      loading: false,
      error: null,
    });

    await useWorkspacesStore.getState().switchWorkspace('workspace-b');

    expect(useWorkspacesStore.getState().profiles.map((entry) => entry.id)).toEqual([
      'workspace-a',
      'workspace-b',
    ]);
  });
});
describe('workspaces store drag-and-drop grouping', () => {
  const SOURCE = 'agent:main:source';
  const TARGET = 'agent:main:target';

  function groupFolder(overrides: Partial<SessionFolder> = {}): SessionFolder {
    return {
      id: 'group-1',
      name: 'Target group',
      parentId: null,
      order: 0,
      kind: 'workgroup',
      createdAt: 2,
      updatedAt: 2,
      ...overrides,
    };
  }

  function snapshotWith(workspace: WorkspaceProfile, folder?: SessionFolder) {
    return {
      success: true,
      profiles: [workspace],
      activeWorkspaceId: workspace.id,
      activeWorkspace: workspace,
      folder,
    };
  }

  it('moves the source into an existing target workgroup without creating a folder', async () => {
    const folder = groupFolder();
    const workspace = profile({
      sessionFolders: [folder],
      sessionFolderAssignments: { [TARGET]: folder.id },
    });
    hostApiMocks.moveSessionToFolder.mockResolvedValue(snapshotWith(workspace, folder));

    const { useWorkspacesStore } = await import('@/stores/workspaces');
    useWorkspacesStore.setState({
      profiles: [workspace],
      activeWorkspaceId: workspace.id,
      activeWorkspace: workspace,
      loading: false,
      error: null,
    });

    await useWorkspacesStore.getState().groupSessions(workspace.id, SOURCE, TARGET, 'Ignored');

    expect(hostApiMocks.createFolder).not.toHaveBeenCalled();
    expect(hostApiMocks.moveSessionToFolder).toHaveBeenCalledTimes(1);
    expect(hostApiMocks.moveSessionToFolder).toHaveBeenCalledWith({
      workspaceId: workspace.id,
      sessionKey: SOURCE,
      folderId: folder.id,
    });
  });

  it('creates one root workgroup and files both sessions into it when the target is unfiled', async () => {
    const workspace = profile({ sessionFolders: [], sessionFolderAssignments: {} });
    const folder = groupFolder({ name: 'Target group' });
    hostApiMocks.createFolder.mockResolvedValue(snapshotWith(workspace, folder));
    hostApiMocks.moveSessionToFolder.mockResolvedValue(snapshotWith(workspace, folder));

    const { useWorkspacesStore } = await import('@/stores/workspaces');
    useWorkspacesStore.setState({
      profiles: [workspace],
      activeWorkspaceId: workspace.id,
      activeWorkspace: workspace,
      loading: false,
      error: null,
    });

    await useWorkspacesStore.getState().groupSessions(workspace.id, SOURCE, TARGET, 'Target group');

    expect(hostApiMocks.createFolder).toHaveBeenCalledWith({
      workspaceId: workspace.id,
      name: 'Target group',
      parentId: null,
      kind: 'workgroup',
    });
    expect(hostApiMocks.moveSessionToFolder).toHaveBeenNthCalledWith(1, {
      workspaceId: workspace.id,
      sessionKey: TARGET,
      folderId: folder.id,
    });
    expect(hostApiMocks.moveSessionToFolder).toHaveBeenNthCalledWith(2, {
      workspaceId: workspace.id,
      sessionKey: SOURCE,
      folderId: folder.id,
    });
  });

  it('does nothing when the source and target are the same session', async () => {
    const workspace = profile({ sessionFolders: [], sessionFolderAssignments: {} });

    const { useWorkspacesStore } = await import('@/stores/workspaces');
    useWorkspacesStore.setState({
      profiles: [workspace],
      activeWorkspaceId: workspace.id,
      activeWorkspace: workspace,
      loading: false,
      error: null,
    });

    await useWorkspacesStore.getState().groupSessions(workspace.id, TARGET, TARGET, 'Ignored');

    expect(hostApiMocks.createFolder).not.toHaveBeenCalled();
    expect(hostApiMocks.moveSessionToFolder).not.toHaveBeenCalled();
  });

  it('is a no-op when the source is already in the target workgroup', async () => {
    const folder = groupFolder();
    const workspace = profile({
      sessionFolders: [folder],
      sessionFolderAssignments: { [SOURCE]: folder.id, [TARGET]: folder.id },
    });

    const { useWorkspacesStore } = await import('@/stores/workspaces');
    useWorkspacesStore.setState({
      profiles: [workspace],
      activeWorkspaceId: workspace.id,
      activeWorkspace: workspace,
      loading: false,
      error: null,
    });

    await useWorkspacesStore.getState().groupSessions(workspace.id, SOURCE, TARGET, 'Ignored');

    expect(hostApiMocks.createFolder).not.toHaveBeenCalled();
    expect(hostApiMocks.moveSessionToFolder).not.toHaveBeenCalled();
  });

  it('rejects grouping sessions claimed by different projects', async () => {
    const workspaceA = profile({
      id: 'workspace-a',
      activeSessionKey: SOURCE,
      sessionStates: { [SOURCE]: {} },
    });
    const workspaceB = profile({
      id: 'workspace-b',
      activeSessionKey: TARGET,
      sessionStates: { [TARGET]: {} },
    });

    const { useWorkspacesStore } = await import('@/stores/workspaces');
    useWorkspacesStore.setState({
      profiles: [workspaceA, workspaceB],
      activeWorkspaceId: workspaceA.id,
      activeWorkspace: workspaceA,
      loading: false,
      error: null,
    });

    await expect(useWorkspacesStore.getState().groupSessions(
      workspaceA.id,
      SOURCE,
      TARGET,
      'Cross-project group',
    )).rejects.toThrow('Sessions can only be grouped inside the same project');
    expect(hostApiMocks.createFolder).not.toHaveBeenCalled();
    expect(hostApiMocks.moveSessionToFolder).not.toHaveBeenCalled();
  });
});
