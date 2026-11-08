import { beforeEach, describe, expect, it, vi } from 'vitest';

const chatState = vi.hoisted(() => ({
  currentAgentId: 'reviewer',
  currentSessionKey: 'agent:reviewer:old',
  viewRevision: 1,
  newSession: vi.fn(),
  resetSessionView: vi.fn(),
  switchSession: vi.fn(),
  loadSessions: vi.fn(),
}));

const workspaceState = vi.hoisted(() => ({
  activeWorkspaceId: 'workspace-a',
  profiles: [] as unknown[],
  saveWorkspaceState: vi.fn(),
  switchWorkspace: vi.fn(),
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
    saveState: vi.fn(),
    getActive: vi.fn(),
    moveSessionToFolder: vi.fn(),
  },
  sessions: {
    createHandoff: vi.fn(),
    fork: vi.fn(),
    bindCoordinator: vi.fn(),
    coordinatorBinding: vi.fn(),
    delegateCoordinator: vi.fn(),
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
    chatState.viewRevision = 1;
    workspaceState.activeWorkspace = {
      ...baseWorkspace,
      id: 'workspace-a',
      selectedAgentId: 'reviewer',
      activeSessionKey: 'agent:reviewer:old',
    };
    workspaceState.activeWorkspaceId = 'workspace-a';
    workspaceState.profiles = [workspaceState.activeWorkspace];
    chatState.switchSession.mockImplementation((key: string) => { chatState.currentSessionKey = key; chatState.viewRevision += 1; });
    hostApiMock.workspaces.saveState.mockImplementation(async (payload: { sessionKey?: string; state?: Record<string, unknown> }) => {
      if (payload.sessionKey && payload.state) workspaceState.activeWorkspace.sessionStates = {
        ...workspaceState.activeWorkspace.sessionStates, [payload.sessionKey]: payload.state,
      };
      return { success: true };
    });
    workspaceState.saveWorkspaceState.mockImplementation(async (payload: { activeSessionKey?: string; sessionKey?: string; state?: Record<string, unknown> }) => {
      await hostApiMock.workspaces.saveState(payload);
      if (payload.activeSessionKey) workspaceState.activeWorkspace.activeSessionKey = payload.activeSessionKey;
    });
    workspaceState.fetchWorkspaces.mockImplementation(async () => {
      const pending = hostApiMock.sessions.createHandoff.mock.results.at(-1)?.value;
      if (pending && workspaceState.activeWorkspace) {
        const result = await pending;
        if (result?.sessionKey) workspaceState.activeWorkspace.sessionStates = {
          ...workspaceState.activeWorkspace.sessionStates, [result.sessionKey]: {},
        };
      }
      workspaceState.profiles = workspaceState.activeWorkspace ? [workspaceState.activeWorkspace] : [];
    });
    hostApiMock.files.writeText.mockResolvedValue({ success: true });
    hostApiMock.workspaces.update.mockResolvedValue({ success: true });
    hostApiMock.workspaces.moveSessionToFolder.mockResolvedValue({ success: true });
    hostApiMock.sessions.createHandoff.mockResolvedValue({ success: true, sessionKey: 'agent:reviewer:session-1711111111111-4fzyo8' });
    hostApiMock.sessions.bindCoordinator.mockResolvedValue({
      success: true,
      validation: 'current',
      binding: { revision: 1, state: 'active' },
    });
    hostApiMock.sessions.delegateCoordinator.mockResolvedValue({
      success: true,
      receipt: { state: 'accepted', acceptedIsNotCompletion: true },
    });
    hostApiMock.sessions.coordinatorBinding.mockResolvedValue({
      success: true,
      validation: 'current',
      binding: { revision: 1, state: 'active' },
    });
    hostApiMock.sessions.fork.mockResolvedValue({
      success: true,
      sessionKey: 'agent:reviewer:dashboard:fork',
      sourceSessionKey: 'agent:reviewer:old',
      forkedFromParent: true,
    });
    hostApiMock.taskLedger.linkSession.mockResolvedValue({ success: true, snapshot: {} });
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

  it.each(['fork', 'handoff'] as const)('does not activate a late %s after leaving and returning to the same source', async (kind) => {
    let finish!: (result: unknown) => void;
    const pending = new Promise((resolve) => { finish = resolve; });
    if (kind === 'fork') hostApiMock.sessions.fork.mockReturnValue(pending);
    else hostApiMock.sessions.createHandoff.mockReturnValue(pending);
    const helpers = await import('@/lib/workspace-session');
    const operation = kind === 'fork' ? helpers.createWorkspaceScopedForkSession(chatState.currentSessionKey)
      : helpers.createWorkspaceScopedHandoffSession('saved draft');
    await Promise.resolve();
    chatState.currentSessionKey = 'agent:reviewer:other'; chatState.viewRevision++;
    chatState.currentSessionKey = 'agent:reviewer:old'; chatState.viewRevision++;
    finish({ success: true, sessionKey: 'agent:reviewer:late-child' });
    expect(await operation).toBe('agent:reviewer:late-child');
    expect(chatState.switchSession).not.toHaveBeenCalled();
    expect(chatState.currentSessionKey).toBe('agent:reviewer:old');
  });

  it('does not activate a project after its route is disposed during the workspace switch', async () => {
    let finish!: () => void;
    const target = { ...baseWorkspace, id: 'workspace-b', activeSessionKey: 'agent:reviewer:target' };
    workspaceState.profiles = [workspaceState.activeWorkspace, target];
    workspaceState.switchWorkspace.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    const { activateWorkspaceScopedSession } = await import('@/lib/workspace-session');
    let current = true;
    const pending = activateWorkspaceScopedSession(target.id, target.activeSessionKey, () => current);
    await vi.waitFor(() => expect(workspaceState.switchWorkspace).toHaveBeenCalled());
    current = false; finish();
    expect(await pending).toBe(false);
    expect(chatState.switchSession).not.toHaveBeenCalled();
    expect(workspaceState.saveWorkspaceState).not.toHaveBeenCalled();
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
    expect(chatState.switchSession).toHaveBeenCalledWith('agent:reviewer:session-1711111111111-4fzyo8');
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
    expect(hostApiMock.workspaces.saveState).toHaveBeenCalledWith({
      id: 'workspace-a',
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
    expect(hostApiMock.taskLedger.linkSession).not.toHaveBeenCalled();
    expect(chatState.switchSession).toHaveBeenCalledWith('agent:reviewer:dashboard:fork');
    expect(hostApiMock.files.writeText).not.toHaveBeenCalled();
  });

  it('forwards an explicit fromLeafId when forking from a message (#180)', async () => {
    hostApiMock.sessions.bindCoordinator.mockResolvedValue({
      success: true,
      validation: 'current',
      binding: { revision: 1, state: 'active' },
    });
    hostApiMock.sessions.delegateCoordinator.mockResolvedValue({
      success: true,
      receipt: { state: 'accepted', acceptedIsNotCompletion: true },
    });
    hostApiMock.sessions.coordinatorBinding.mockResolvedValue({
      success: true,
      validation: 'current',
      binding: { revision: 1, state: 'active' },
    });
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
