import { create } from 'zustand';
import type { CompletionActivity } from './completion-activity';

type CompletionActivityState = {
  activities: CompletionActivity[];
  pendingNavigation: CompletionActivity | null;
  setActivities: (activities: CompletionActivity[]) => void;
  requestNavigation: (activity: CompletionActivity) => void;
  clearNavigation: () => void;
};

export const useCompletionActivityStore = create<CompletionActivityState>((set) => ({
  activities: [],
  pendingNavigation: null,
  setActivities: (activities) => set({ activities }),
  requestNavigation: (pendingNavigation) => set({ pendingNavigation }),
  clearNavigation: () => set({ pendingNavigation: null }),
}));
