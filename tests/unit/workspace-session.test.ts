import { beforeEach, describe, expect, it, vi } from 'vitest';

const chatState = vi.hoisted(() => ({
  currentAgentId: 'reviewer',
  currentSessionKey: 'agent:reviewer:old',
  viewRevision: 1,
  newSession: vi.fn(),
  resetSessionView: vi.fn(),
  switchSession: vi.fn(),
  loadSessions: vi.fn(),
  sessions: [] as Array<{ key: string; parentSessionKey?: string }>,
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
    chatState.sessions = [];
    workspaceState.activeWorkspace = {
      ...baseWorkspace,
      id: 'workspace-a',
      selectedAgentId: 'reviewer',
      activeSessionKey: 'agent:reviewer:old',
    };
    workspaceState.activeWorkspaceId = 'workspace-a';
    workspaceState.profiles = [workspaceState.activeWorkspace];
    workspaceState.switchWorkspace.mockImplementation(async (id: string) => {
      const target = workspaceState.profiles.find((profile) => (profile as { id: string }).id === id) as typeof workspaceState.activeWorkspace | undefined;
      if (!target) return null;
      workspaceState.activeWorkspaceId = id;
      workspaceState.activeWorkspace = target;
      return target;
    });
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

  it('keeps a newer navigation when new-session creation replies late', async () => {
    const { createWorkspaceScopedNewSession, activateWorkspaceScopedSession } = await import('@/lib/workspace-session');
    let release!: () => void;
    hostApiMock.workspaces.update.mockImplementationOnce(async () => {
      await new Promise<void>(resolve => { release = resolve; }); return { success: true };
    });
    const next = 'agent:reviewer:neighbour';
    workspaceState.activeWorkspace.sessionStates = { [next]: {} };
    const created = createWorkspaceScopedNewSession();
    await vi.waitFor(() => expect(hostApiMock.workspaces.update).toHaveBeenCalledTimes(1));
    const navigation = activateWorkspaceScopedSession('workspace-a', next);
    release();
    await expect(created).resolves.toBeNull();
    await expect(navigation).resolves.toBe(true);
    expect(chatState.currentSessionKey).toBe(next);
    expect(chatState.resetSessionView).not.toHaveBeenCalled();
  });

  it('preserves the source after rejected creation and can retry the same intent', async () => {
    const { createWorkspaceScopedNewSession } = await import('@/lib/workspace-session');
    hostApiMock.workspaces.update.mockRejectedValueOnce(new Error('NEW_SESSION_OWNER_REJECTED'));
    await expect(createWorkspaceScopedNewSession()).rejects.toThrow('NEW_SESSION_OWNER_REJECTED');
    expect(workspaceState.saveWorkspaceState).toHaveBeenCalledWith({ id: 'workspace-a', sessionKey: 'agent:reviewer:old', activeSessionKey: 'agent:reviewer:old' });
    expect(workspaceState.saveWorkspaceState.mock.invocationCallOrder[0]).toBeLessThan(hostApiMock.workspaces.update.mock.invocationCallOrder[0]);
    expect(chatState.currentSessionKey).toBe('agent:reviewer:old');
    expect(chatState.resetSessionView).not.toHaveBeenCalled();
    expect(workspaceState.fetchWorkspaces).not.toHaveBeenCalled();
    await expect(createWorkspaceScopedNewSession()).resolves.toMatch(/^agent:reviewer:session-/);
    expect(chatState.resetSessionView).toHaveBeenCalledTimes(1);
  });

  it('discards a replaced new-session intent before saving the old active session', async () => {
    const { createWorkspaceScopedNewSession } = await import('@/lib/workspace-session');
    const profile = workspaceState.activeWorkspace;
    workspaceState.activeWorkspace = null as never;
    let release!: () => void;
    workspaceState.fetchWorkspaces.mockImplementationOnce(async () => {
      await new Promise<void>(resolve => { release = resolve; });
      workspaceState.activeWorkspace = profile;
    });
    const created = createWorkspaceScopedNewSession();
    await vi.waitFor(() => expect(workspaceState.fetchWorkspaces).toHaveBeenCalledTimes(1));
    chatState.switchSession('agent:reviewer:neighbour');
    profile.activeSessionKey = 'agent:reviewer:neighbour';
    release();
    await expect(created).resolves.toBeNull();
    expect(workspaceState.saveWorkspaceState).not.toHaveBeenCalled();
    expect(hostApiMock.workspaces.update).not.toHaveBeenCalled();
    expect(profile.activeSessionKey).toBe('agent:reviewer:neighbour');
  });

  it('preserves the workspace owner when its selection changes before session hydration', async () => {
    const { createWorkspaceScopedNewSession } = await import('@/lib/workspace-session');
    const profile = workspaceState.activeWorkspace;
    workspaceState.activeWorkspace = null as never;
    let release!: () => void;
    workspaceState.fetchWorkspaces.mockImplementationOnce(async () => {
      await new Promise<void>(resolve => { release = resolve; });
      workspaceState.activeWorkspace = { ...profile, id: 'workspace-b', activeSessionKey: 'agent:reviewer:workspace-b' };
      workspaceState.activeWorkspaceId = 'workspace-b';
    });
    const created = createWorkspaceScopedNewSession();
    await vi.waitFor(() => expect(workspaceState.fetchWorkspaces).toHaveBeenCalledTimes(1));
    release();
    await expect(created).resolves.toBeNull();
    expect(workspaceState.saveWorkspaceState).not.toHaveBeenCalled();
    expect(hostApiMock.workspaces.update).not.toHaveBeenCalled();
    expect(workspaceState.activeWorkspace.activeSessionKey).toBe('agent:reviewer:workspace-b');
  });

  it('keeps a source revisit during the last new-session await', async () => {
    const { createWorkspaceScopedNewSession } = await import('@/lib/workspace-session');
    let release!: () => void;
    hostApiMock.files.writeText.mockImplementationOnce(async () => {
      await new Promise<void>(resolve => { release = resolve; }); return { success: true };
    });
    const created = createWorkspaceScopedNewSession();
    await vi.waitFor(() => expect(hostApiMock.files.writeText).toHaveBeenCalledTimes(1));
    chatState.switchSession('agent:reviewer:neighbour');
    chatState.switchSession('agent:reviewer:old');
    release();
    await expect(created).resolves.toBeNull();
    expect(chatState.currentSessionKey).toBe('agent:reviewer:old');
    expect(chatState.resetSessionView).not.toHaveBeenCalled();
  });

  it('activates the owning workspace before loading the selected transcript', async () => {
    const { activateWorkspaceSession } = await import('@/lib/workspace-session');
    const target = { ...baseWorkspace, id: 'workspace-b', activeSessionKey: 'agent:reviewer:recent', sessionStates: { 'agent:reviewer:selected': {} } };
    workspaceState.profiles = [target];
    await expect(activateWorkspaceSession('agent:reviewer:selected')).resolves.toBe(true);
    expect(workspaceState.switchWorkspace).toHaveBeenCalledWith('workspace-b');
    expect(hostApiMock.workspaces.saveState).toHaveBeenCalledWith({ id: 'workspace-b', activeSessionKey: 'agent:reviewer:selected', sessionKey: 'agent:reviewer:selected' });
    expect(chatState.switchSession).toHaveBeenCalledWith('agent:reviewer:selected');
    expect(workspaceState.switchWorkspace.mock.invocationCallOrder[0]).toBeLessThan(hostApiMock.workspaces.saveState.mock.invocationCallOrder[0]);
    expect(hostApiMock.workspaces.saveState.mock.invocationCallOrder[0]).toBeLessThan(chatState.switchSession.mock.invocationCallOrder[0]);
  });

  it('keeps the original transcript when workspace activation fails', async () => {
    const { activateWorkspaceSession } = await import('@/lib/workspace-session');
    workspaceState.profiles = [{ ...baseWorkspace, id: 'workspace-b', activeSessionKey: 'agent:reviewer:target' }];
    workspaceState.switchWorkspace.mockRejectedValueOnce(new Error('workspace offline'));
    await expect(activateWorkspaceSession('agent:reviewer:target')).rejects.toThrow('workspace offline');
    expect(chatState.switchSession).not.toHaveBeenCalled();
    expect(workspaceState.saveWorkspaceState).not.toHaveBeenCalled();
  });

  it('settles a rapid sequence on the newest requested conversation', async () => {
    const { activateWorkspaceSession } = await import('@/lib/workspace-session');
    workspaceState.profiles = [];
    expect(await Promise.all([activateWorkspaceSession('first'), activateWorkspaceSession('latest')])).toEqual([false, true]);
    expect(chatState.switchSession.mock.calls).toEqual([['latest']]);
  });

  it('associates an unfiled child with its recorded parent before opening it', async () => {
    const { activateWorkspaceSession } = await import('@/lib/workspace-session');
    workspaceState.activeWorkspace = { ...baseWorkspace, activeSessionKey: 'parent', sessionStates: { parent: { draftInput: 'parent draft' } } } as never;
    workspaceState.profiles = [workspaceState.activeWorkspace];
    chatState.sessions = [{ key: 'child', parentSessionKey: 'parent' }, { key: 'parent' }];
    await expect(activateWorkspaceSession('child')).resolves.toBe(true);
    expect(hostApiMock.workspaces.saveState).toHaveBeenCalledWith({ id: 'workspace-a', activeSessionKey: 'child', sessionKey: 'child', state: {} });
    expect(workspaceState.activeWorkspace).toMatchObject({ activeSessionKey: 'child', sessionStates: { parent: { draftInput: 'parent draft' }, child: {} } });
    expect(chatState.switchSession).toHaveBeenCalledWith('child');
  });

  it('keeps an explicitly filed child in its own worktree', async () => {
    const { activateWorkspaceSession } = await import('@/lib/workspace-session');
    workspaceState.profiles = [{ ...baseWorkspace, activeSessionKey: 'parent' }, { ...baseWorkspace, id: 'workspace-b', activeSessionKey: 'child' }];
    chatState.sessions = [{ key: 'child', parentSessionKey: 'parent' }];
    await expect(activateWorkspaceSession('child')).resolves.toBe(true);
    expect(workspaceState.switchWorkspace).toHaveBeenCalledExactlyOnceWith('workspace-b');
    expect(workspaceState.saveWorkspaceState).toHaveBeenCalledWith({ id: 'workspace-b', activeSessionKey: 'child', sessionKey: 'child' });
  });

  it.each(['legacy', 'scoped'] as const)('shares the newest intent when the first navigation uses the %s entry', async (firstEntry) => {
    const { activateWorkspaceSession, activateWorkspaceScopedSession } = await import('@/lib/workspace-session');
    const target = { ...baseWorkspace, id: 'workspace-b', activeSessionKey: 'agent:reviewer:target' };
    workspaceState.profiles = [workspaceState.activeWorkspace, target];
    const first = firstEntry === 'legacy' ? activateWorkspaceSession(target.activeSessionKey)
      : activateWorkspaceScopedSession(target.id, target.activeSessionKey);
    const latest = firstEntry === 'legacy' ? activateWorkspaceScopedSession('workspace-a', 'agent:reviewer:old')
      : activateWorkspaceSession('agent:reviewer:old');
    expect(await Promise.all([first, latest])).toEqual([false, true]);
    expect(workspaceState.switchWorkspace).not.toHaveBeenCalled();
    expect(chatState.switchSession.mock.calls).toEqual([['agent:reviewer:old']]);
  });

  it('prefers the saved active session when reopening the same agent in a worktree', async () => {
    const { getWorkspaceAgentSessionKey } = await import('@/lib/workspace-session');
    expect(getWorkspaceAgentSessionKey({ ...baseWorkspace, activeSessionKey: 'agent:reviewer:recent' } as never, 'reviewer'))
      .toEqual({ sessionKey: 'agent:reviewer:recent', isFresh: false });
  });

  it('resolves an explicit coordinator-only child before following its parent', async () => {
    const { activateWorkspaceSession, workspaceOwnsSession } = await import('@/lib/workspace-session');
    const target = { ...baseWorkspace, id: 'workspace-b', activeSessionKey: 'agent:reviewer:other', agentBindings: {},
      coordinatorBindings: { 'agent:reviewer:child': { workspaceId: 'workspace-b', agentId: 'reviewer', sessionKey: 'agent:reviewer:child' } } };
    workspaceState.profiles = [workspaceState.activeWorkspace, target];
    chatState.sessions = [{ key: 'agent:reviewer:child', parentSessionKey: 'agent:reviewer:old' }];
    expect(workspaceOwnsSession(target as never, 'agent:reviewer:child')).toBe(true);
    await expect(activateWorkspaceSession('agent:reviewer:child')).resolves.toBe(true);
    expect(workspaceState.switchWorkspace).toHaveBeenCalledExactlyOnceWith('workspace-b');
  });

  it.each(['cycle', 'missing'] as const)('does not infer workspace ownership from a %s parent chain', async (kind) => {
    const { activateWorkspaceSession } = await import('@/lib/workspace-session');
    chatState.sessions = kind === 'cycle' ? [{ key: 'child', parentSessionKey: 'parent' }, { key: 'parent', parentSessionKey: 'child' }]
      : [{ key: 'child', parentSessionKey: 'absent' }];
    await expect(activateWorkspaceSession('child')).resolves.toBe(true);
    expect(workspaceState.switchWorkspace).not.toHaveBeenCalled();
    expect(workspaceState.saveWorkspaceState).not.toHaveBeenCalled();
    expect(chatState.switchSession).toHaveBeenCalledWith('child');
  });

  it('keeps explicit scoped selection strict when only a parent belongs to the workspace', async () => {
    const { activateWorkspaceScopedSession } = await import('@/lib/workspace-session');
    chatState.sessions = [{ key: 'child', parentSessionKey: 'agent:reviewer:old' }];
    await expect(activateWorkspaceScopedSession('workspace-a', 'child')).rejects.toThrow('SESSION_WORKSPACE_ASSOCIATION_MISSING');
    expect(workspaceState.saveWorkspaceState).not.toHaveBeenCalled();
    expect(chatState.switchSession).not.toHaveBeenCalled();
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
