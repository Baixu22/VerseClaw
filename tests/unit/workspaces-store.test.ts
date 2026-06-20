import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceProfile } from '@shared/types/workspace';

const hostApiMocks = vi.hoisted(() => ({
  saveState: vi.fn(),
  switchWorkspace: vi.fn(),
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
  beforeEach(async () => {
    vi.resetModules();
    hostApiMocks.saveState.mockReset();
    hostApiMocks.saveState.mockResolvedValue({ success: true });
    hostApiMocks.switchWorkspace.mockReset();
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

  it('persists work mode per workspace session state', async () => {
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
    expect(active?.state.workMode).toBe('build');
    expect(active?.sessionStates?.['agent:main:main'].workMode).toBe('plan');
    expect(active?.sessionStates?.['agent:main:feature'].workMode).toBe('build');
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
