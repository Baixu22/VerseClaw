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
    }
  },

  clearError: () => set({ error: null }),
}));
