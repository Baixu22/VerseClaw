import { create } from 'zustand';
import { hostApi } from '@/lib/host-api';
import type { SystemPortfolio, SystemProjectSnapshot } from '@shared/types/system-portfolio';

export type SystemProjectEntry = {
  profile: SystemPortfolio['profiles'][number];
  ownerKey: string;
  loading: boolean;
  unavailable: boolean;
  snapshot?: SystemProjectSnapshot;
};
type PortfolioState = {
  entries: Record<string, SystemProjectEntry>;
  loading: boolean;
  unavailable: boolean;
  refresh: () => Promise<void>;
};
let refreshSequence = 0;

export const useSystemPortfolioStore = create<PortfolioState>((set, get) => ({
  entries: {}, loading: false, unavailable: false,
  refresh: async () => {
    const sequence = ++refreshSequence;
    set({ loading: true, unavailable: false });
    try {
      const manifest = await hostApi.workspaces.portfolio();
      if (manifest.scope !== 'system') throw new Error('SYSTEM_SCOPE_REQUIRED');
      if (sequence !== refreshSequence) return;
      const previous = get().entries;
      const entries = Object.fromEntries(manifest.profiles.map(profile => {
        const ownerKey = profile.ownerKey;
        return [profile.id, { profile, ownerKey, loading: true, unavailable: false,
          snapshot: previous[profile.id]?.ownerKey === ownerKey ? previous[profile.id].snapshot : undefined }];
      }));
      set({ entries, loading: false });
      await Promise.allSettled(Object.values(entries).map(async entry => {
        const id = entry.profile.id;
        const publish = (patch: Partial<SystemProjectEntry>) => {
          if (sequence !== refreshSequence || get().entries[id]?.ownerKey !== entry.ownerKey) return;
          set(state => ({ entries: { ...state.entries, [id]: { ...state.entries[id], ...patch, loading: false } } }));
        };
        try {
          const snapshot = await hostApi.workspaces.projectSummary({ workspaceId: id, expectedOwnerKey: entry.ownerKey });
          if (snapshot.workspaceId !== id || snapshot.ownerKey !== entry.ownerKey || snapshot.scope !== 'project') throw new Error('SYSTEM_PROJECT_CHANGED');
          publish({ snapshot, unavailable: false });
        } catch { publish({ unavailable: true }); }
      }));
    } catch {
      if (sequence === refreshSequence) set({ loading: false, unavailable: true });
    }
  },
}));
