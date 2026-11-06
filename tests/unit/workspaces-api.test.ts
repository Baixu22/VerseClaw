import { mkdir, rm } from 'fs/promises';
import { join, resolve } from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const storeState = vi.hoisted(() => ({
  activeWorkspaceId: 'legacy' as string | null,
  profiles: [] as unknown[],
  approvals: [] as unknown[],
  decisionEvents: [] as unknown[],
}));

const harnessTemplate = vi.hoisted(() => ({
  ensureVerseClawWorkspaceHarness: vi.fn(async () => ({
    workspaceDir: '',
    templateDir: '',
    targetDir: '',
    filesWritten: 0,
  })),
}));

const { testWorkspaceRoot } = vi.hoisted(() => ({
  testWorkspaceRoot: `${process.env.CLAWX_TEST_TMPDIR ?? `${process.cwd()}/.tmp/vitest`}/clawx-workspaces-api-${Math.random().toString(36).slice(2)}`,
}));

vi.mock('electron-store', () => {
  class MockStore {
    constructor(options?: { defaults?: { activeWorkspaceId?: string | null; profiles?: unknown[] } }) {
      if (storeState.profiles.length === 0 && options?.defaults?.profiles) {
        storeState.profiles = [...options.defaults.profiles];
        storeState.activeWorkspaceId = options.defaults.activeWorkspaceId ?? null;
      }
    }

    get(key: string) {
      if (key === 'profiles') return storeState.profiles;
      if (key === 'activeWorkspaceId') return storeState.activeWorkspaceId;
      if (key === 'approvals') return storeState.approvals;
      if (key === 'decisionEvents') return storeState.decisionEvents;
      return undefined;
    }

    set(key: string, value: unknown) {
      if (key === 'profiles') storeState.profiles = Array.isArray(value) ? [...value] : [];
      if (key === 'activeWorkspaceId') storeState.activeWorkspaceId = typeof value === 'string' ? value : null;
      if (key === 'approvals') storeState.approvals = Array.isArray(value) ? [...value] : [];
      if (key === 'decisionEvents') storeState.decisionEvents = Array.isArray(value) ? [...value] : [];
    }
  }

  return { default: MockStore };
});

vi.mock('@electron/services/workspace-runtime-sync', () => ({
  syncActiveWorkspacePermissionToRuntime: vi.fn(async () => undefined),
  syncActiveWorkspaceRootToRuntime: vi.fn(async () => undefined),
}));

vi.mock('@electron/utils/counted-child-process', () => ({ exec: vi.fn(async () => ({ stdout: '', stderr: '' })) }));

vi.mock('@electron/utils/paths', () => ({
  expandPath: (value: string) => value,
  getResourcesDir: () => resolve('resources'),
}));

vi.mock('@electron/utils/clawx-harness-template', () => harnessTemplate);
const resourceReclamation = vi.hoisted(() => ({
  reclaimBrowserSessionsForWorkspace: vi.fn(),
  reclaimManagedPortsForWorkspace: vi.fn(),
}));

vi.mock('@electron/services/long-session-resource-reclamation', () => resourceReclamation);

describe('workspaces api compatibility migration', () => {
  beforeEach(async () => {
    storeState.activeWorkspaceId = 'legacy';
    storeState.profiles = [{
      id: 'legacy',
      name: 'Legacy Workspace',
      rootPath: 'C:/project',
      agentId: 'research',
      activeSessionKey: 'agent:research:main',
      permissionMode: 'acceptEdits',
      createdAt: 1,
      updatedAt: 1,
      lastOpenedAt: 1,
      state: {
        draftInput: 'legacy draft',
      },
    }];
    storeState.approvals = [];
    storeState.decisionEvents = [];
    harnessTemplate.ensureVerseClawWorkspaceHarness.mockClear();
    resourceReclamation.reclaimBrowserSessionsForWorkspace.mockReset().mockReturnValue({ attempted: 0, reclaimed: 0 });
    resourceReclamation.reclaimManagedPortsForWorkspace.mockReset().mockResolvedValue({ attempted: 0, reclaimed: 0, failed: 0 });
    await rm(testWorkspaceRoot, { recursive: true, force: true });
  });

  it('hydrates old agentId/session fields into selectedAgentId and agentBindings', async () => {
    const { createWorkspacesApi } = await import('@electron/services/workspaces-api');
    const api = createWorkspacesApi();

    await expect(api.list()).resolves.toMatchObject({
      success: true,
      activeWorkspaceId: 'legacy',
      profiles: [{
        id: 'legacy',
        agentId: 'research',
        selectedAgentId: 'research',
        activeSessionKey: 'agent:research:main',
        state: {
          draftInput: 'legacy draft',
        },
        agentBindings: {
          research: {
            workspaceId: 'legacy',
            agentId: 'research',
            sessionKey: 'agent:research:main',
          },
        },
        sessionStates: {
          'agent:research:main': {
            draftInput: 'legacy draft',
          },
        },
      }],
    });
  });

  it('normalizes legacy nested session folders and new parent input to one level', async () => {
    storeState.profiles[0] = {
      ...(storeState.profiles[0] as Record<string, unknown>),
      sessionFolders: [
        { id: 'root', name: 'Root', parentId: null, order: 0, createdAt: 1, updatedAt: 1 },
        { id: 'child', name: 'Child', parentId: 'root', order: 1, createdAt: 2, updatedAt: 2 },
      ],
      sessionFolderAssignments: { 'agent:research:main': 'child' },
    };
    const { createWorkspacesApi } = await import('@electron/services/workspaces-api');
    const api = createWorkspacesApi();

    const listed = await api.list();
    expect(listed.profiles?.[0]?.sessionFolders).toEqual([
      expect.objectContaining({ id: 'root', parentId: null }),
      expect.objectContaining({ id: 'child', parentId: null }),
    ]);

    const created = await api.createFolder({
      workspaceId: 'legacy',
      name: 'Always root',
      parentId: 'child',
    });
    expect(created.folder).toEqual(expect.objectContaining({ name: 'Always root', parentId: null }));
  });

  it('creates the default workspace from list when no workspace exists', async () => {
    storeState.activeWorkspaceId = null;
    storeState.profiles = [];
    const { createWorkspacesApi } = await import('@electron/services/workspaces-api');
    const api = createWorkspacesApi();

    await expect(api.list()).resolves.toMatchObject({
      success: true,
      activeWorkspaceId: 'default',
      activeWorkspace: {
        id: 'default',
        name: expect.any(String),
        agentId: 'main',
        selectedAgentId: 'main',
        activeSessionKey: 'agent:main:main',
      },
      profiles: [{
        id: 'default',
        name: expect.any(String),
        activeSessionKey: 'agent:main:main',
      }],
    });
  });

  it('falls back to the default workspace when the stored active id is missing', async () => {
    storeState.activeWorkspaceId = 'missing';
    storeState.profiles = [
      {
        id: 'other',
        name: 'Other',
        rootPath: 'C:/other',
        agentId: 'main',
        selectedAgentId: 'main',
        activeSessionKey: 'agent:main:other',
        permissionMode: 'acceptEdits',
        createdAt: 1,
        updatedAt: 1,
        lastOpenedAt: 1,
        state: { draftInput: 'other draft' },
        sessionStates: {
          'agent:main:other': { draftInput: 'other draft' },
        },
      },
      {
        id: 'default',
        name: expect.any(String),
        rootPath: 'C:/default',
        agentId: 'main',
        selectedAgentId: 'main',
        activeSessionKey: 'agent:main:main',
        permissionMode: 'acceptEdits',
        createdAt: 2,
        updatedAt: 2,
        lastOpenedAt: 2,
        state: {},
        sessionStates: {
          'agent:main:main': {},
        },
      },
    ];
    const { createWorkspacesApi } = await import('@electron/services/workspaces-api');
    const api = createWorkspacesApi();

    await expect(api.list()).resolves.toMatchObject({
      activeWorkspaceId: 'default',
      activeWorkspace: {
        id: 'default',
        activeSessionKey: 'agent:main:main',
      },
    });
    expect(storeState.activeWorkspaceId).toBe('default');
  });

  it('keeps independent UI state for each session inside a workspace', async () => {
    const { createWorkspacesApi } = await import('@electron/services/workspaces-api');
    const api = createWorkspacesApi();

    await api.saveState({
      id: 'legacy',
      sessionKey: 'agent:research:main',
      activeSessionKey: 'agent:research:main',
      state: {
        draftInput: 'main draft',
        terminal: { lastCommand: 'pnpm test' },
      },
    });
    await api.saveState({
      id: 'legacy',
      sessionKey: 'agent:research:feature',
      activeSessionKey: 'agent:research:feature',
      state: {
        draftInput: 'feature draft',
        webPreview: { targetPath: 'index.html' },
      },
    });

    await expect(api.list()).resolves.toMatchObject({
      profiles: [{
        id: 'legacy',
        activeSessionKey: 'agent:research:feature',
        state: {
          draftInput: 'feature draft',
          webPreview: { targetPath: 'index.html' },
        },
        sessionStates: {
          'agent:research:main': {
            draftInput: 'main draft',
            terminal: { lastCommand: 'pnpm test' },
          },
          'agent:research:feature': {
            draftInput: 'feature draft',
            webPreview: { targetPath: 'index.html' },
          },
        },
      }],
    });
  });

  it('does not copy the previous active session state into a newly selected empty session', async () => {
    const { createWorkspacesApi } = await import('@electron/services/workspaces-api');
    const api = createWorkspacesApi();

    await api.saveState({
      id: 'legacy',
      activeSessionKey: 'agent:research:main',
      sessionKey: 'agent:research:main',
      state: {
        draftInput: 'main draft',
        artifactPanel: { open: true, activeTab: 'browser' },
      },
    });

    await api.saveState({
      id: 'legacy',
      activeSessionKey: 'agent:research:empty',
    });

    await expect(api.list()).resolves.toMatchObject({
      profiles: [{
        id: 'legacy',
        activeSessionKey: 'agent:research:empty',
        state: {},
        sessionStates: {
          'agent:research:main': {
            draftInput: 'main draft',
            artifactPanel: { open: true, activeTab: 'browser' },
          },
          'agent:research:empty': {},
        },
      }],
    });
  });

  it('keeps each agent binding session independent within the same workspace', async () => {
    const { createWorkspacesApi } = await import('@electron/services/workspaces-api');
    const api = createWorkspacesApi();

    await api.update({
      id: 'legacy',
      agentId: 'research',
      activeSessionKey: 'agent:research:main',
      state: { draftInput: 'research draft' },
    });

    await api.update({
      id: 'legacy',
      agentId: 'reviewer',
      activeSessionKey: 'agent:reviewer:main',
      state: { draftInput: 'reviewer draft' },
    });

    await expect(api.list()).resolves.toMatchObject({
      profiles: [{
        id: 'legacy',
        selectedAgentId: 'reviewer',
        activeSessionKey: 'agent:reviewer:main',
        agentBindings: {
          research: {
            workspaceId: 'legacy',
            agentId: 'research',
            sessionKey: 'agent:research:main',
          },
          reviewer: {
            workspaceId: 'legacy',
            agentId: 'reviewer',
            sessionKey: 'agent:reviewer:main',
          },
        },
        sessionStates: {
          'agent:research:main': { draftInput: 'research draft' },
          'agent:reviewer:main': { draftInput: 'reviewer draft' },
        },
        state: { draftInput: 'reviewer draft' },
      }],
    });
  });

  it('does not inherit the previous agent state when switching to a new agent binding', async () => {
    const { createWorkspacesApi } = await import('@electron/services/workspaces-api');
    const api = createWorkspacesApi();

    await api.update({
      id: 'legacy',
      agentId: 'reviewer',
      activeSessionKey: 'agent:reviewer:main',
    });

    await expect(api.list()).resolves.toMatchObject({
      profiles: [{
        id: 'legacy',
        selectedAgentId: 'reviewer',
        activeSessionKey: 'agent:reviewer:main',
        state: {},
        sessionStates: {
          'agent:research:main': { draftInput: 'legacy draft' },
          'agent:reviewer:main': {},
        },
      }],
    });
  });

  it('seeds the Verse Claw harness when creating a workspace profile', async () => {
    const projectRoot = join(testWorkspaceRoot, 'project');
    await mkdir(projectRoot, { recursive: true });
    storeState.activeWorkspaceId = null;
    storeState.profiles = [];

    const { createWorkspacesApi } = await import('@electron/services/workspaces-api');
    const api = createWorkspacesApi();

    await expect(api.create({ rootPath: projectRoot, name: 'Project' })).resolves.toMatchObject({
      success: true,
      activeWorkspaceId: 'project',
      activeWorkspace: {
        rootPath: resolve(projectRoot),
      },
    });

    expect(harnessTemplate.ensureVerseClawWorkspaceHarness).toHaveBeenCalledWith(resolve(projectRoot));
  });

  it('switches workspaces without rewriting the target workspace session or state', async () => {
    storeState.activeWorkspaceId = 'workspace-a';
    storeState.profiles = [
      {
        id: 'workspace-a',
        name: 'Workspace A',
        rootPath: 'C:/a',
        agentId: 'research',
        selectedAgentId: 'research',
        activeSessionKey: 'agent:research:a-session',
        agentBindings: {
          research: {
            workspaceId: 'workspace-a',
            agentId: 'research',
            sessionKey: 'agent:research:a-session',
          },
        },
        permissionMode: 'acceptEdits',
        createdAt: 1,
        updatedAt: 1,
        lastOpenedAt: 1,
        state: { draftInput: 'a draft', activeTopicId: 'topic-a' },
        sessionStates: {
          'agent:research:a-session': { draftInput: 'a draft', activeTopicId: 'topic-a' },
        },
      },
      {
        id: 'workspace-b',
        name: 'Workspace B',
        rootPath: 'C:/b',
        agentId: 'research',
        selectedAgentId: 'research',
        activeSessionKey: 'agent:research:b-session',
        agentBindings: {
          research: {
            workspaceId: 'workspace-b',
            agentId: 'research',
            sessionKey: 'agent:research:b-session',
          },
        },
        permissionMode: 'readOnly',
        createdAt: 2,
        updatedAt: 2,
        lastOpenedAt: 2,
        state: { draftInput: 'b draft', activeTopicId: 'topic-b' },
        sessionStates: {
          'agent:research:b-session': { draftInput: 'b draft', activeTopicId: 'topic-b' },
        },
      },
    ];

    const { createWorkspacesApi } = await import('@electron/services/workspaces-api');
    const api = createWorkspacesApi();

    await expect(api.switch({ id: 'workspace-b' })).resolves.toMatchObject({
      success: true,
      activeWorkspaceId: 'workspace-b',
      activeWorkspace: {
        id: 'workspace-b',
        activeSessionKey: 'agent:research:b-session',
        state: { draftInput: 'b draft', activeTopicId: 'topic-b' },
        sessionStates: {
          'agent:research:b-session': { draftInput: 'b draft', activeTopicId: 'topic-b' },
        },
      },
    });

    expect(storeState.activeWorkspaceId).toBe('workspace-b');
    expect(storeState.profiles).toMatchObject([
      {
        id: 'workspace-a',
        activeSessionKey: 'agent:research:a-session',
        state: { draftInput: 'a draft', activeTopicId: 'topic-a' },
      },
      {
        id: 'workspace-b',
        activeSessionKey: 'agent:research:b-session',
        state: { draftInput: 'b draft', activeTopicId: 'topic-b' },
      },
    ]);
  });

  it('P2-001: creates new workspaces with readOnly permission mode by default', async () => {
    const projectRoot = join(testWorkspaceRoot, 'restricted-default');
    await mkdir(projectRoot, { recursive: true });
    storeState.activeWorkspaceId = null;
    storeState.profiles = [];

    const { createWorkspacesApi } = await import('@electron/services/workspaces-api');
    const api = createWorkspacesApi();
    const result = await api.create({ rootPath: projectRoot, name: 'Restricted Default' });
    expect(result).toMatchObject({
      success: true,
      activeWorkspace: {
        permissionMode: 'readOnly',
      },
    });
    expect(result.profiles?.[0]?.permissionMode).toBe('readOnly');
  });

  it('P2-001: preserves explicit acceptEdits and audits permission mode changes', async () => {
    const projectRoot = join(testWorkspaceRoot, 'mode-audit');
    await mkdir(projectRoot, { recursive: true });
    storeState.activeWorkspaceId = null;
    storeState.profiles = [];

    const { createWorkspacesApi } = await import('@electron/services/workspaces-api');
    const { listPermissionDecisionEvents } = await import('@electron/services/permissions-api');
    const api = createWorkspacesApi();

    const created = await api.create({
      rootPath: projectRoot,
      name: 'Mode Audit',
      permissionMode: 'acceptEdits',
    });
    expect(created.activeWorkspace?.permissionMode).toBe('acceptEdits');
    const workspaceId = created.activeWorkspaceId;
    if (!workspaceId) throw new Error('Expected created workspace id');

    const updated = await api.update({
      id: workspaceId,
      permissionMode: 'readOnly',
    });
    expect(updated.activeWorkspace?.permissionMode).toBe('readOnly');

    // allow async fire-and-forget audit write
    await new Promise((r) => setTimeout(r, 50));
    const events = await listPermissionDecisionEvents(20);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'permission-decision',
        tool: 'workspaces.updatePermissionMode',
        boundary: 'workspace-mode',
        workspaceMode: 'readOnly',
        decision: 'allow',
      }),
    ]));
  });

  it('P2-001: auto-default workspace is readOnly and invalid modes migrate to readOnly not acceptEdits', async () => {
    storeState.activeWorkspaceId = null;
    storeState.profiles = [];
    const { createWorkspacesApi } = await import('@electron/services/workspaces-api');
    const api = createWorkspacesApi();
    const listed = await api.list();
    expect(listed.activeWorkspace?.permissionMode).toBe('readOnly');

    storeState.profiles = [{
      id: 'legacy',
      name: 'Legacy',
      rootPath: 'C:/legacy',
      agentId: 'main',
      selectedAgentId: 'main',
      activeSessionKey: 'agent:main:main',
      permissionMode: 'not-a-mode' as never,
      createdAt: 1,
      updatedAt: 1,
      lastOpenedAt: 1,
      state: {},
      sessionStates: {},
    }];
    storeState.activeWorkspaceId = 'legacy';
    const again = await api.list();
    expect(again.activeWorkspace?.permissionMode).toBe('readOnly');
  });


  it('switches workspaces without closing the previous workspace resources', async () => {
    storeState.activeWorkspaceId = 'legacy';
    storeState.profiles.push({
      id: 'other',
      name: 'Other',
      rootPath: 'C:/other',
      agentId: 'main',
      selectedAgentId: 'main',
      activeSessionKey: 'agent:main:other',
      permissionMode: 'acceptEdits',
      createdAt: 2,
      updatedAt: 2,
      lastOpenedAt: 2,
      state: {},
    });
    const terminalManager = { registerWorkspace: vi.fn(), unregisterWorkspace: vi.fn() };
    const webPreviewManager = { registerWorkspace: vi.fn(), stopForWorkspace: vi.fn() };
    const { createWorkspacesApi } = await import('@electron/services/workspaces-api');
    const { syncActiveWorkspacePermissionToRuntime, syncActiveWorkspaceRootToRuntime } = await import('@electron/services/workspace-runtime-sync');
    const api = createWorkspacesApi({ terminalManager, webPreviewManager } as never);

    await expect(api.switch({ id: 'other' })).resolves.toMatchObject({
      success: true,
      activeWorkspaceId: 'other',
    });
    expect(terminalManager.unregisterWorkspace).not.toHaveBeenCalled();
    expect(webPreviewManager.stopForWorkspace).not.toHaveBeenCalled();
    expect(terminalManager.registerWorkspace).toHaveBeenCalledWith(expect.objectContaining({ id: 'other' }));
    const readForPermission = vi.mocked(syncActiveWorkspacePermissionToRuntime).mock.lastCall?.[0];
    const readForRoot = vi.mocked(syncActiveWorkspaceRootToRuntime).mock.lastCall?.[0];
    expect(readForPermission).toBeTypeOf('function');
    expect(readForRoot).toBe(readForPermission);
    expect(await readForPermission?.()).toMatchObject({ id: 'other', permissionMode: 'acceptEdits', rootPath: 'C:/other' });
  });

  it('workspace delete reclaims Main browser and managed-port owners', async () => {
    storeState.profiles.push({
      id: 'other',
      name: 'Other',
      rootPath: 'C:/other',
      agentId: 'main',
      selectedAgentId: 'main',
      activeSessionKey: 'agent:main:other',
      permissionMode: 'acceptEdits',
      createdAt: 2,
      updatedAt: 2,
      lastOpenedAt: 2,
      state: {},
    });
    resourceReclamation.reclaimBrowserSessionsForWorkspace.mockReturnValue({ attempted: 1, reclaimed: 1 });
    resourceReclamation.reclaimManagedPortsForWorkspace.mockResolvedValue({ attempted: 1, reclaimed: 1, failed: 0 });
    const { createWorkspacesApi } = await import('@electron/services/workspaces-api');
    const api = createWorkspacesApi({
      terminalManager: { unregisterWorkspace: vi.fn(), registerWorkspace: vi.fn() },
      webPreviewManager: { stopForWorkspace: vi.fn(), registerWorkspace: vi.fn() },
    } as never);

    await expect(api.delete({ id: 'other' })).resolves.toMatchObject({ success: true });
    expect(resourceReclamation.reclaimBrowserSessionsForWorkspace).toHaveBeenCalledWith('other');
    expect(resourceReclamation.reclaimManagedPortsForWorkspace).toHaveBeenCalledWith('other');
  });
});
