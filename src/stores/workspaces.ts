import { create } from 'zustand';
import { hostApi } from '@/lib/host-api';
import type {
  WorkspacePermissionMode,
  WorkspaceProfile,
  WorkspaceSnapshot,
  WorkspaceUiState,
} from '@shared/types/workspace';

type WorkspaceCreateInput = {
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
  clearError: () => void;
};

function applySnapshot(snapshot: WorkspaceSnapshot | undefined) {
  return snapshot ? {
    profiles: snapshot.profiles ?? [],
    activeWorkspaceId: snapshot.activeWorkspaceId ?? null,
    activeWorkspace: snapshot.activeWorkspace ?? null,
  } : {};
}

function mergeWorkspaceUiState(current: WorkspaceUiState | undefined, patch: WorkspaceUiState | undefined): WorkspaceUiState {
  if (!patch) return current ?? {};
  return {
    ...(current ?? {}),
    ...patch,
    artifactPanel: patch.artifactPanel
      ? { ...(current?.artifactPanel ?? {}), ...patch.artifactPanel }
      : current?.artifactPanel,
    terminal: patch.terminal ? { ...(current?.terminal ?? {}), ...patch.terminal } : current?.terminal,
    webPreview: patch.webPreview ? { ...(current?.webPreview ?? {}), ...patch.webPreview } : current?.webPreview,
    chatFooter: patch.chatFooter ? { ...(current?.chatFooter ?? {}), ...patch.chatFooter } : current?.chatFooter,
    graphExpanded: patch.graphExpanded ? { ...(current?.graphExpanded ?? {}), ...patch.graphExpanded } : current?.graphExpanded,
    activeTopicId: Object.prototype.hasOwnProperty.call(patch, 'activeTopicId')
      ? patch.activeTopicId
      : current?.activeTopicId,
    draftInput: Object.prototype.hasOwnProperty.call(patch, 'draftInput')
      ? patch.draftInput
      : current?.draftInput,
    workMode: patch.workMode ?? current?.workMode,
    recentFiles: patch.recentFiles ?? current?.recentFiles,
  };
}

export const useWorkspacesStore = create<WorkspaceState>((set) => ({
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
      return snapshot.activeWorkspace ?? null;
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

  saveWorkspaceState: async (input) => {
    set({ error: null });
    try {
      await hostApi.workspaces.saveState(input);
      set((state) => {
        const nextProfiles = state.profiles.map((profile) => {
          if (profile.id !== input.id) return profile;
          const targetSessionKey = input.sessionKey ?? input.activeSessionKey ?? profile.activeSessionKey;
          const nextActiveSessionKey = input.activeSessionKey ?? profile.activeSessionKey;
          const nextSessionStates = input.state
            ? {
              ...(profile.sessionStates ?? {}),
              [targetSessionKey]: mergeWorkspaceUiState(
                profile.sessionStates?.[targetSessionKey],
                input.state,
              ),
            }
            : profile.sessionStates;
          return {
            ...profile,
            activeSessionKey: nextActiveSessionKey,
            state: nextSessionStates
              ? nextSessionStates[nextActiveSessionKey] ?? {}
              : input.state && targetSessionKey === nextActiveSessionKey
                ? mergeWorkspaceUiState(profile.state, input.state)
                : profile.state,
            sessionStates: nextSessionStates,
            updatedAt: Date.now(),
          };
        });
        const activeWorkspace = nextProfiles.find((profile) => profile.id === state.activeWorkspaceId) ?? null;
        return { profiles: nextProfiles, activeWorkspace };
      });
    } catch (error) {
      set({ error: String(error) });
    }
  },

  clearError: () => set({ error: null }),
}));
