import { create } from 'zustand';
import { hostApi } from '@/lib/host-api';
import { useSkillsStore } from '@/stores/skills';
import type { SkillPackId, SkillPackSummary } from '@shared/host-api/contract';

interface SkillPacksState {
  packs: SkillPackSummary[];
  loading: boolean;
  busy: Record<string, boolean>;
  error: string | null;
  fetchPacks: () => Promise<void>;
  installPack: (packId: SkillPackId) => Promise<void>;
  syncPack: (packId: SkillPackId) => Promise<void>;
  setPackEnabled: (packId: SkillPackId, enabled: boolean) => Promise<void>;
  readSkill: (packId: SkillPackId, skillId: string) => Promise<string>;
}

function busyKey(packId: SkillPackId, action: string): string {
  return `${packId}:${action}`;
}

export const useSkillPacksStore = create<SkillPacksState>((set, get) => ({
  packs: [],
  loading: false,
  busy: {},
  error: null,

  fetchPacks: async () => {
    set({ loading: true, error: null });
    try {
      const result = await hostApi.skillPacks.list();
      if (!result.success) {
        throw new Error(result.error || 'Failed to fetch skill packs');
      }
      set({ packs: result.packs || [], loading: false, error: null });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set({ loading: false, error: message });
      throw error;
    }
  },

  installPack: async (packId) => {
    const key = busyKey(packId, 'install');
    set((state) => ({ busy: { ...state.busy, [key]: true }, error: null }));
    try {
      const result = await hostApi.skillPacks.install(packId);
      if (!result.success) {
        throw new Error(result.error || 'Failed to install skill pack');
      }
      await get().fetchPacks();
      await useSkillsStore.getState().fetchSkills();
    } finally {
      set((state) => {
        const busy = { ...state.busy };
        delete busy[key];
        return { busy };
      });
    }
  },

  syncPack: async (packId) => {
    const key = busyKey(packId, 'sync');
    set((state) => ({ busy: { ...state.busy, [key]: true }, error: null }));
    try {
      const result = await hostApi.skillPacks.sync(packId);
      if (!result.success) {
        throw new Error(result.error || 'Failed to sync skill pack');
      }
      await get().fetchPacks();
      await useSkillsStore.getState().fetchSkills();
    } finally {
      set((state) => {
        const busy = { ...state.busy };
        delete busy[key];
        return { busy };
      });
    }
  },

  setPackEnabled: async (packId, enabled) => {
    const key = busyKey(packId, 'enabled');
    set((state) => ({ busy: { ...state.busy, [key]: true }, error: null }));
    try {
      const result = await hostApi.skillPacks.setEnabled(packId, enabled);
      if (!result.success) {
        throw new Error(result.error || 'Failed to update skill pack');
      }
      await get().fetchPacks();
      await useSkillsStore.getState().fetchSkills();
    } finally {
      set((state) => {
        const busy = { ...state.busy };
        delete busy[key];
        return { busy };
      });
    }
  },

  readSkill: async (packId, skillId) => {
    const result = await hostApi.skillPacks.readSkill(packId, skillId);
    if (!result.success) {
      throw new Error(result.error || 'Failed to read skill');
    }
    return result.content || '';
  },
}));
