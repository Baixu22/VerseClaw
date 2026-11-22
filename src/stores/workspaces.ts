import { create } from 'zustand';
import { hostApi } from '@/lib/host-api';
import type {
  WorkspacePermissionMode,
  WorkspaceProfile,
  WorkspaceSnapshot,
  WorkspaceUiState,
  SessionFolder,
} from '@shared/types/workspace';

const workspaceStateSaves = new Map<string, Promise<void>>();

type WorkspaceCreateInput = {
  activate?: boolean;
  name?: string;
  rootPath: string;
  agentId?: string;
  selectedAgentId?: string;
  activeSessionKey?: string;
  permissionMode?: WorkspacePermissionMode;
};

type WorkspaceUpdateInput = Partial<Omit<WorkspaceCreateInput, 'rootPath'>> & {
  rootPath?: string;
  state?: WorkspaceUiState;
  sessionKey?: string;
};

type WorkspaceState = {
  profiles: WorkspaceProfile[];
  activeWorkspaceId: string | null;
  activeWorkspace: WorkspaceProfile | null;
  loading: boolean;
  error: string | null;
  fetchWorkspaces: () => Promise<void>;
  createWorkspace: (input: WorkspaceCreateInput) => Promise<WorkspaceProfile | null>;
  updateWorkspace: (id: string, input: WorkspaceUpdateInput) => Promise<void>;
  deleteWorkspace: (id: string) => Promise<void>;
  switchWorkspace: (id: string) => Promise<WorkspaceProfile | null>;
  setPermissionMode: (id: string, permissionMode: WorkspacePermissionMode) => Promise<void>;
  saveWorkspaceState: (input: { id: string; activeSessionKey?: string; sessionKey?: string; state?: WorkspaceUiState }) => Promise<void>;
  createFolder: (
    workspaceId: string,
    name: string,
    parentId?: string | null,
    kind?: SessionFolder['kind'],
  ) => Promise<SessionFolder | null>;
  renameFolder: (workspaceId: string, folderId: string, name: string) => Promise<void>;
  deleteFolder: (workspaceId: string, folderId: string) => Promise<void>;
  moveSessionToFolder: (workspaceId: string, sessionKey: string, folderId: string | null) => Promise<void>;
  /**
   * Drag-and-drop auto-grouping: drop `sourceSessionKey` after
   * `targetSessionKey`. If the target is already filed in a workgroup the
   * source joins that group; otherwise a new root-level workgroup is created
   * and both sessions are filed into it. Groups never nest past level one.
   */
  groupSessions: (
    workspaceId: string,
    sourceSessionKey: string,
    targetSessionKey: string,
    autoGroupName: string,
  ) => Promise<void>;
  clearError: () => void;
};

function applySnapshot(snapshot: WorkspaceSnapshot | undefined) {
  return snapshot ? {
    profiles: snapshot.profiles ?? [],
    activeWorkspaceId: snapshot.activeWorkspaceId ?? null,
    activeWorkspace: snapshot.activeWorkspace ?? null,
  } : {};
}

function stripLegacyWorkspaceUiState(state: WorkspaceUiState | undefined): WorkspaceUiState {
  const { workMode: _legacyWorkMode, ...safeState } = state ?? {};
  return safeState;
}

function stripLegacySessionStates(
  sessionStates: WorkspaceProfile['sessionStates'] | undefined,
): WorkspaceProfile['sessionStates'] | undefined {
  if (!sessionStates) return undefined;
  return Object.fromEntries(
    Object.entries(sessionStates).map(([sessionKey, sessionState]) => [
      sessionKey,
      stripLegacyWorkspaceUiState(sessionState),
    ]),
  );
}

function workspaceClaimsSession(profile: WorkspaceProfile, sessionKey: string): boolean {
  return profile.activeSessionKey === sessionKey
    || Boolean(profile.sessionStates?.[sessionKey])
    || Object.hasOwn(profile.coordinatorBindings ?? {}, sessionKey)
    || Object.values(profile.agentBindings ?? {}).some((binding) => binding.sessionKey === sessionKey);
}

function mergeWorkspaceUiState(current: WorkspaceUiState | undefined, patch: WorkspaceUiState | undefined): WorkspaceUiState {
  const safeCurrent = stripLegacyWorkspaceUiState(current);
  if (!patch) return safeCurrent;
  const safePatch = stripLegacyWorkspaceUiState(patch);
  return {
    ...safeCurrent,
    ...safePatch,
    artifactPanel: safePatch.artifactPanel
      ? { ...(current?.artifactPanel ?? {}), ...safePatch.artifactPanel }
      : current?.artifactPanel,
    terminal: safePatch.terminal ? { ...(current?.terminal ?? {}), ...safePatch.terminal } : current?.terminal,
    webPreview: safePatch.webPreview ? { ...(current?.webPreview ?? {}), ...safePatch.webPreview } : current?.webPreview,
    chatFooter: safePatch.chatFooter ? { ...(current?.chatFooter ?? {}), ...safePatch.chatFooter } : current?.chatFooter,
    graphExpanded: safePatch.graphExpanded ? { ...(current?.graphExpanded ?? {}), ...safePatch.graphExpanded } : current?.graphExpanded,
    activeTopicId: Object.prototype.hasOwnProperty.call(safePatch, 'activeTopicId')
      ? safePatch.activeTopicId
      : current?.activeTopicId,
    draftInput: Object.prototype.hasOwnProperty.call(safePatch, 'draftInput')
      ? safePatch.draftInput
      : current?.draftInput,
    recentFiles: safePatch.recentFiles ?? current?.recentFiles,
  };
}

export const useWorkspacesStore = create<WorkspaceState>((set, get) => ({
  profiles: [],
  activeWorkspaceId: null,
  activeWorkspace: null,
  loading: false,
  error: null,

  fetchWorkspaces: async () => {
    set({ loading: true, error: null });
    try {
      const snapshot = await hostApi.workspaces.list();
      if ((snapshot.profiles ?? []).length === 0) {
        const active = await hostApi.workspaces.getActive();
        set({
          profiles: active.activeWorkspace ? [active.activeWorkspace] : [],
          activeWorkspaceId: active.activeWorkspaceId ?? null,
          activeWorkspace: active.activeWorkspace ?? null,
          loading: false,
        });
        return;
      }
      set({
        ...applySnapshot(snapshot),
        loading: false,
      });
    } catch (error) {
      set({ loading: false, error: String(error) });
    }
  },

  createWorkspace: async (input) => {
    set({ error: null });
    try {
      const snapshot = await hostApi.workspaces.create(input);
      set(applySnapshot(snapshot));
      return snapshot.createdWorkspace;
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },

  updateWorkspace: async (id, input) => {
    set({ error: null });
    try {
      const snapshot = await hostApi.workspaces.update(id, input);
      set(applySnapshot(snapshot));
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },

  deleteWorkspace: async (id) => {
    set({ error: null });
    try {
      const snapshot = await hostApi.workspaces.delete(id);
      set(applySnapshot(snapshot));
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },

  switchWorkspace: async (id) => {
    set({ loading: true, error: null });
    try {
      const result = await hostApi.workspaces.switch(id);
      set((state) => {
        const activeWorkspaceId = result.activeWorkspaceId ?? null;
        const activeWorkspace = result.activeWorkspace ?? null;
        const profiles = activeWorkspace
          ? state.profiles.some((profile) => profile.id === activeWorkspace.id)
            ? state.profiles.map((profile) => profile.id === activeWorkspace.id ? activeWorkspace : profile)
            : [...state.profiles, activeWorkspace]
          : state.profiles;
        return {
          profiles,
          activeWorkspaceId,
          activeWorkspace,
          loading: false,
        };
      });
      return result.activeWorkspace ?? null;
    } catch (error) {
      set({ loading: false, error: String(error) });
      throw error;
    }
  },

  setPermissionMode: async (id, permissionMode) => {
    set({ error: null });
    try {
      const snapshot = await hostApi.workspaces.update(id, { permissionMode });
      set(applySnapshot(snapshot));
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },

  saveWorkspaceState: (input) => {
    const save = (workspaceStateSaves.get(input.id) ?? Promise.resolve()).catch(() => undefined).then(async () => {
      const profile = get().profiles.find((entry) => entry.id === input.id);
      const hasLegacyWorkMode = profile && (Object.hasOwn(profile.state ?? {}, 'workMode')
        || Object.values(profile.sessionStates ?? {}).some((state) => Object.hasOwn(state, 'workMode')));
      const targetAgent = input.activeSessionKey?.startsWith('agent:') ? input.activeSessionKey.split(':')[1] : undefined;
      const selectedAgent = targetAgent || profile?.selectedAgentId || profile?.agentId;
      const selectionConsistent = !input.activeSessionKey || !selectedAgent
        || (profile?.agentBindings?.[selectedAgent]?.sessionKey === input.activeSessionKey && (profile?.selectedAgentId || profile?.agentId) === selectedAgent);
      if (profile && !hasLegacyWorkMode && selectionConsistent && (!input.activeSessionKey || input.activeSessionKey === profile.activeSessionKey)) {
        const target = input.sessionKey ?? input.activeSessionKey ?? profile.activeSessionKey;
        const previous = profile.sessionStates?.[target];
        if (!input.state || (previous && JSON.stringify(mergeWorkspaceUiState(previous, input.state)) === JSON.stringify(stripLegacyWorkspaceUiState(previous)))) return;
      }
      set({ error: null });
      try {
        await hostApi.workspaces.saveState(input);
        set((state) => {
          const nextProfiles = state.profiles.map((profile) => {
            if (profile.id !== input.id) return profile;
            const targetSessionKey = input.sessionKey ?? input.activeSessionKey ?? profile.activeSessionKey;
            const nextActiveSessionKey = input.activeSessionKey ?? profile.activeSessionKey;
            const nextAgentId = targetAgent || profile.selectedAgentId || profile.agentId;
            const baseSessionStates = stripLegacySessionStates(profile.sessionStates);
            const nextSessionStates = input.state
              ? {
                ...(baseSessionStates ?? {}),
                [targetSessionKey]: mergeWorkspaceUiState(
                  baseSessionStates?.[targetSessionKey],
                  input.state,
                ),
              }
              : baseSessionStates;
            return {
              ...profile,
              activeSessionKey: nextActiveSessionKey,
              ...(input.activeSessionKey ? { selectedAgentId: nextAgentId, agentId: nextAgentId, agentBindings: { ...profile.agentBindings,
                [nextAgentId]: {
                  ...profile.agentBindings?.[nextAgentId], workspaceId: profile.id,
                  agentId: nextAgentId, sessionKey: nextActiveSessionKey,
                },
              } } : {}),
              state: nextSessionStates
                ? nextSessionStates[nextActiveSessionKey] ?? {}
                : input.state && targetSessionKey === nextActiveSessionKey
                  ? mergeWorkspaceUiState(profile.state, input.state)
                  : stripLegacyWorkspaceUiState(profile.state),
              sessionStates: nextSessionStates,
              updatedAt: Date.now(),
            };
          });
          const activeWorkspace = nextProfiles.find((profile) => profile.id === state.activeWorkspaceId) ?? null;
          return { profiles: nextProfiles, activeWorkspace };
        });
      } catch (error) {
        set({ error: String(error) });
        throw error;
      }
    });
    workspaceStateSaves.set(input.id, save);
    const clear = () => { if (workspaceStateSaves.get(input.id) === save) workspaceStateSaves.delete(input.id); };
    void save.then(clear, clear);
    return save;
  },

  createFolder: async (workspaceId, name, _parentId = null, kind = 'workgroup') => {
    set({ error: null });
    try {
      // Workgroups are scoped to a project and never nest. Keep accepting the
      // old argument at the store boundary so callers remain source-compatible,
      // but persist every new folder at the project root.
      const snapshot = await hostApi.workspaces.createFolder({ workspaceId, name, parentId: null, kind });
      set(applySnapshot(snapshot));
      const profile = (snapshot.profiles ?? []).find((p) => p.id === workspaceId);
      const folder = snapshot.folder
        ?? profile?.sessionFolders?.find((candidate) => candidate.name === name)
        ?? profile?.sessionFolders?.[profile.sessionFolders.length - 1]
        ?? null;
      return folder ?? null;
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },

  renameFolder: async (workspaceId, folderId, name) => {
    set({ error: null });
    try {
      const snapshot = await hostApi.workspaces.renameFolder({ workspaceId, folderId, name });
      set(applySnapshot(snapshot));
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },

  deleteFolder: async (workspaceId, folderId) => {
    set({ error: null });
    try {
      const snapshot = await hostApi.workspaces.deleteFolder({ workspaceId, folderId });
      set(applySnapshot(snapshot));
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },

  moveSessionToFolder: async (workspaceId, sessionKey, folderId) => {
    set({ error: null });
    try {
      const snapshot = await hostApi.workspaces.moveSessionToFolder({ workspaceId, sessionKey, folderId });
      set(applySnapshot(snapshot));
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },

  groupSessions: async (workspaceId, sourceSessionKey, targetSessionKey, autoGroupName) => {
    const sourceKey = sourceSessionKey.trim();
    const targetKey = targetSessionKey.trim();
    const groupName = autoGroupName.trim();
    if (!sourceKey || !targetKey || sourceKey === targetKey) return;
    if (!groupName) {
      const error = new Error('Workgroup name is required for auto-grouping');
      set({ error: String(error) });
      throw error;
    }

    set({ error: null });
    const profile = get().profiles.find((candidate) => candidate.id === workspaceId);
    if (!profile) {
      const error = new Error(`Workspace "${workspaceId}" not found`);
      set({ error: String(error) });
      throw error;
    }

    const foreignOwner = get().profiles.find((candidate) => (
      candidate.id !== workspaceId
      && (workspaceClaimsSession(candidate, sourceKey) || workspaceClaimsSession(candidate, targetKey))
    ));
    if (foreignOwner) {
      const error = new Error('Sessions can only be grouped inside the same project');
      set({ error: String(error) });
      throw error;
    }

    const folders = profile.sessionFolders ?? [];
    const assignments = profile.sessionFolderAssignments ?? {};
    const targetFolderId = typeof assignments[targetKey] === 'string'
      ? assignments[targetKey]
      : undefined;
    const targetFolderExists = targetFolderId != null
      && folders.some((folder) => folder.id === targetFolderId);

    // If the drop target is already filed, the dragged session simply joins
    // that group. Dropping onto a member of its own group is a no-op.
    if (targetFolderExists && targetFolderId != null) {
      if (assignments[sourceKey] === targetFolderId) return;
      await get().moveSessionToFolder(workspaceId, sourceKey, targetFolderId);
      return;
    }

    // Otherwise create ONE root-level workgroup and file both sessions into
    // it. The UI renders workgroups flat even for legacy nested data, so new
    // auto-created groups never introduce another nesting level.
    const folder = await get().createFolder(
      workspaceId,
      groupName,
      null,
      'workgroup',
    );
    if (!folder) {
      throw new Error('Failed to create workgroup for dropped session');
    }
    await get().moveSessionToFolder(workspaceId, targetKey, folder.id);
    await get().moveSessionToFolder(workspaceId, sourceKey, folder.id);
  },

  clearError: () => set({ error: null }),
}));
