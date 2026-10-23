import { beforeEach, describe, expect, it, vi } from 'vitest';

const chatState = vi.hoisted(() => ({
  currentAgentId: 'reviewer',
  currentSessionKey: 'agent:reviewer:old',
  newSession: vi.fn(),
  resetSessionView: vi.fn(),
}));

const workspaceState = vi.hoisted(() => ({
  activeWorkspace: {
    id: 'workspace-a',
    name: 'A',
    rootPath: 'C:/a',
    agentId: 'main',
    selectedAgentId: 'reviewer',
    activeSessionKey: 'agent:reviewer:old',
    agentBindings: {
      reviewer: {
        workspaceId: 'workspace-a',
        agentId: 'reviewer',
        sessionKey: 'agent:reviewer:old',
      },
    },
    permissionMode: 'acceptEdits',
    createdAt: 1,
    updatedAt: 1,
    lastOpenedAt: 1,
    state: {},
    sessionStates: {},
  },
  fetchWorkspaces: vi.fn(),
}));

const hostApiMock = vi.hoisted(() => ({
  files: {
    writeText: vi.fn(),
  },
  workspaces: {
    update: vi.fn(),
    getActive: vi.fn(),
    moveSessionToFolder: vi.fn(),
    bindCoordinator: vi.fn(),
    resolveCoordinator: vi.fn(),
  },
  sessions: {
    createHandoff: vi.fn(),
    fork: vi.fn(),
  },
  taskLedger: {
    linkSession: vi.fn(),
  },
}));

const baseWorkspace = vi.hoisted(() => ({
  id: 'workspace-a',
  name: 'A',
  rootPath: 'C:/a',
  agentId: 'main',
  selectedAgentId: 'reviewer',
  activeSessionKey: 'agent:reviewer:old',
  agentBindings: {
    reviewer: {
      workspaceId: 'workspace-a',
      agentId: 'reviewer',
      sessionKey: 'agent:reviewer:old',
    },
  },
  permissionMode: 'acceptEdits',
  createdAt: 1,
  updatedAt: 1,
  lastOpenedAt: 1,
  state: {},
  sessionStates: {},
}));

vi.mock('@/stores/chat', () => ({
  useChatStore: {
    getState: () => chatState,
  },
}));

vi.mock('@/stores/workspaces', () => ({
  useWorkspacesStore: {
    getState: () => workspaceState,
    setState: vi.fn(),
  },
}));

vi.mock('@/lib/host-api', () => ({
  hostApi: hostApiMock,
}));

describe('workspace session helpers', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    chatState.currentAgentId = 'reviewer';
    chatState.currentSessionKey = 'agent:reviewer:old';
    workspaceState.activeWorkspace = {
      ...baseWorkspace,
      id: 'workspace-a',
      selectedAgentId: 'reviewer',
      activeSessionKey: 'agent:reviewer:old',
    };
    workspaceState.fetchWorkspaces.mockResolvedValue(undefined);
    hostApiMock.files.writeText.mockResolvedValue({ success: true });
    hostApiMock.workspaces.update.mockResolvedValue({ success: true });
    hostApiMock.workspaces.moveSessionToFolder.mockResolvedValue({ success: true });
    hostApiMock.workspaces.bindCoordinator.mockResolvedValue({ success: true, binding: null, recovery: { state: 'missing', reason: null, bindingRevision: null } });
    hostApiMock.workspaces.resolveCoordinator.mockResolvedValue({ success: true, binding: null, recovery: { state: 'missing', reason: null, bindingRevision: null } });
    hostApiMock.sessions.createHandoff.mockResolvedValue({ success: true, sessionKey: 'agent:reviewer:session-1711111111111-4fzyo8' });
    hostApiMock.sessions.fork.mockResolvedValue({
      success: true,
      sessionKey: 'agent:reviewer:dashboard:fork',
      sourceSessionKey: 'agent:reviewer:old',
      forkedFromParent: true,
    });
    hostApiMock.taskLedger.linkSession.mockResolvedValue({ success: true, snapshot: {} });
  });

  it('exposes only the coordinator binding that matches the active Workspace, Assistant and SessionKey', async () => {
    const binding = {
      schemaVersion: 1 as const,
      workspaceId: 'workspace-a',
      agentId: 'reviewer',
      sessionKey: 'agent:reviewer:old',
      sessionGeneration: 'generation-1',
      taskLedgerReferences: [{ direction: 'workboard-to-task-ledger' as const, taskLedgerNodeId: 'TF-1', source: 'runtime' as const }],
      environment: { kind: 'local' as const, canonicalRoot: 'C:/a', backend: 'git' as const, branch: 'main', detachedHead: false, setupProfile: null },
      archiveRestorePolicy: 'restore' as const,
      state: 'active' as const,
      bindingRevision: 1,
      invalidationReason: null,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    };
    workspaceState.activeWorkspace = {
      ...baseWorkspace,
      coordinatorBindings: { [binding.sessionKey]: binding },
    } as never;
    const {
      bindWorkspaceCoordinator,
      getWorkspaceCoordinatorBinding,
      resolveWorkspaceCoordinatorBinding,
    } = await import('@/lib/workspace-session');

    expect(getWorkspaceCoordinatorBinding(workspaceState.activeWorkspace as never, 'reviewer', 'agent:reviewer:old')).toEqual(binding);
    expect(getWorkspaceCoordinatorBinding(workspaceState.activeWorkspace as never, 'main', 'agent:reviewer:old')).toBeNull();
    await resolveWorkspaceCoordinatorBinding(workspaceState.activeWorkspace as never, 'reviewer', 'agent:reviewer:old');
    expect(hostApiMock.workspaces.resolveCoordinator).toHaveBeenCalledWith({
      workspaceId: 'workspace-a',
      agentId: 'reviewer',
      sessionKey: 'agent:reviewer:old',
    });
    const input = {
      workspaceId: 'workspace-a', agentId: 'reviewer', sessionKey: 'agent:reviewer:old', expectedRevision: 1,
      taskLedgerNodeIds: ['TF-1'], environment: { kind: 'local' as const, rootPath: 'C:/a' }, archiveRestorePolicy: 'restore' as const,
    };
    await bindWorkspaceCoordinator(input);
    expect(hostApiMock.workspaces.bindCoordinator).toHaveBeenCalledWith(input);
  });

  it('creates new sessions inside the active workspace and current agent binding', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1711111111111);
    vi.spyOn(Math, 'random').mockReturnValue(0.123456);
    const { createWorkspaceScopedNewSession } = await import('@/lib/workspace-session');

    await expect(createWorkspaceScopedNewSession()).resolves.toBe('agent:reviewer:session-1711111111111-4fzyo8');

    expect(hostApiMock.workspaces.update).toHaveBeenCalledWith('workspace-a', {
      agentId: 'reviewer',
      activeSessionKey: 'agent:reviewer:session-1711111111111-4fzyo8',
      sessionKey: 'agent:reviewer:session-1711111111111-4fzyo8',
      state: { activeTopicId: null },
    });
    expect(workspaceState.fetchWorkspaces).toHaveBeenCalledTimes(1);
    expect(chatState.resetSessionView).toHaveBeenCalledWith('agent:reviewer:session-1711111111111-4fzyo8', { deferSessionEntry: true });
    expect(hostApiMock.files.writeText).toHaveBeenCalledExactlyOnceWith('C:/a/.clawx-active-topic', '');
    expect(chatState.newSession).not.toHaveBeenCalled();
  });

  it('restores the default workspace before creating a workspace-scoped new session', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1711111111111);
    vi.spyOn(Math, 'random').mockReturnValue(0.123456);
    workspaceState.activeWorkspace = null as never;
    workspaceState.fetchWorkspaces.mockImplementation(async () => {
      workspaceState.activeWorkspace = {
        ...baseWorkspace,
        id: 'default',
        selectedAgentId: 'reviewer',
        activeSessionKey: 'agent:reviewer:main',
      };
    });
    const { createWorkspaceScopedNewSession } = await import('@/lib/workspace-session');

    await createWorkspaceScopedNewSession();

    expect(workspaceState.fetchWorkspaces).toHaveBeenCalled();
    expect(hostApiMock.workspaces.update).toHaveBeenCalledWith('default', expect.objectContaining({
      agentId: 'reviewer',
      activeSessionKey: 'agent:reviewer:session-1711111111111-4fzyo8',
    }));
  });

  it('creates handoff sessions with the edited draft persisted in workspace state', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1711111111111);
    vi.spyOn(Math, 'random').mockReturnValue(0.123456);
    const { createWorkspaceScopedHandoffSession } = await import('@/lib/workspace-session');

    await expect(createWorkspaceScopedHandoffSession('Continue from checkpoint A.'))
      .resolves.toBe('agent:reviewer:session-1711111111111-4fzyo8');
    expect(hostApiMock.files.writeText).toHaveBeenCalledExactlyOnceWith('C:/a/.clawx-active-topic', '');

    expect(hostApiMock.sessions.createHandoff).toHaveBeenCalledWith({
      sessionKey: 'agent:reviewer:old', agentId: 'reviewer', workspaceId: 'workspace-a', draftInput: 'Continue from checkpoint A.',
    });
    expect(hostApiMock.workspaces.update).not.toHaveBeenCalled();
    expect(workspaceState.fetchWorkspaces).toHaveBeenCalledTimes(1);
    expect(chatState.resetSessionView).toHaveBeenCalledWith('agent:reviewer:session-1711111111111-4fzyo8');
    expect(chatState.newSession).not.toHaveBeenCalled();
  });

  it('keeps a newly created session in the current workgroup', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1711111111111);
    vi.spyOn(Math, 'random').mockReturnValue(0.123456);
    workspaceState.activeWorkspace = {
      ...baseWorkspace,
      sessionFolders: [{
        id: 'current-workgroup',
        name: 'Current workgroup',
        parentId: null,
        order: 0,
        kind: 'workgroup',
        createdAt: 1,
        updatedAt: 1,
      }],
      sessionFolderAssignments: {
        'agent:reviewer:old': 'current-workgroup',
      },
    } as never;
    const { createWorkspaceScopedNewSession } = await import('@/lib/workspace-session');

    await expect(createWorkspaceScopedNewSession()).resolves.toBe('agent:reviewer:session-1711111111111-4fzyo8');

    expect(hostApiMock.workspaces.moveSessionToFolder).toHaveBeenCalledWith({
      workspaceId: 'workspace-a',
      sessionKey: 'agent:reviewer:session-1711111111111-4fzyo8',
      folderId: 'current-workgroup',
    });
  });

  it('forks sessions through Host API and preserves non-running workspace state', async () => {
    workspaceState.activeWorkspace = {
      ...baseWorkspace,
      state: {
        draftInput: 'unsent thought',
        activeTopicId: 'topic-a',
        workMode: 'build',
        knowledgeScope: 'wiki',
        artifactPanel: { open: true, workspaceView: 'files' },
        recentFiles: ['src/App.tsx'],
        terminal: { open: true, status: 'running' },
      },
      sessionStates: {
        'agent:reviewer:old': {
          draftInput: 'session draft',
          activeTopicId: 'topic-b',
          workMode: 'review',
          selectedModelRef: 'openai:gpt-test',
          knowledgeScope: 'memory',
          recentFiles: ['src/main.ts'],
        },
      },
    } as never;
    const { createWorkspaceScopedForkSession } = await import('@/lib/workspace-session');

    await expect(createWorkspaceScopedForkSession('agent:reviewer:old'))
      .resolves.toBe('agent:reviewer:dashboard:fork');

    expect(hostApiMock.sessions.fork).toHaveBeenCalledWith({
      sessionKey: 'agent:reviewer:old',
      agentId: 'reviewer',
      workspaceId: 'workspace-a',
    });
    expect(hostApiMock.workspaces.update).toHaveBeenCalledWith('workspace-a', {
      agentId: 'reviewer',
      activeSessionKey: 'agent:reviewer:dashboard:fork',
      sessionKey: 'agent:reviewer:dashboard:fork',
      state: {
        draftInput: 'session draft',
        selectedModelRef: 'openai:gpt-test',
        activeTopicId: 'topic-b',
        knowledgeScope: 'memory',
        artifactPanel: undefined,
        recentFiles: ['src/main.ts'],
      },
    });
    expect(hostApiMock.taskLedger.linkSession).toHaveBeenCalledWith(expect.objectContaining({
      sessionKey: 'agent:reviewer:dashboard:fork',
      relation: 'forked_from',
    }));
    expect(chatState.resetSessionView).toHaveBeenCalledWith('agent:reviewer:dashboard:fork');
    expect(hostApiMock.files.writeText).not.toHaveBeenCalled();
  });

  it('forwards an explicit fromLeafId when forking from a message (#180)', async () => {
    hostApiMock.sessions.fork.mockResolvedValue({
      success: true,
      sessionKey: 'agent:reviewer:dashboard:fork',
    });
    const { createWorkspaceScopedForkSession } = await import('@/lib/workspace-session');

    await createWorkspaceScopedForkSession('agent:reviewer:old', { fromLeafId: 'entry-42' });

    expect(hostApiMock.sessions.fork).toHaveBeenCalledWith(
      expect.objectContaining({ fromLeafId: 'entry-42' }),
    );
  });
  it('keeps the current view when Main refuses handoff creation', async () => {
    hostApiMock.sessions.createHandoff.mockResolvedValueOnce({ success: false, error: 'Handoff depth 4 exceeds the configured maximum of 3.' });
    const { createWorkspaceScopedHandoffSession } = await import('@/lib/workspace-session');
    await expect(createWorkspaceScopedHandoffSession('continue')).rejects.toThrow('Handoff depth 4');
    expect(chatState.resetSessionView).not.toHaveBeenCalled();
    expect(hostApiMock.workspaces.update).not.toHaveBeenCalled();
  });


});
