import { create } from 'zustand';
import type { CompletionActivity } from './completion-activity';

export type CompletionActivityNudge = {
  id: string;
  sessionKey: string;
  kind: 'completed' | 'error' | 'action-required';
  status: string;
  occurredAt: number;
};

type CompletionActivityState = {
  activities: CompletionActivity[];
  nudges: CompletionActivityNudge[];
  pendingNavigation: CompletionActivity | null;
  setActivities: (activities: CompletionActivity[]) => void;
  addNudge: (nudge: CompletionActivityNudge) => void;
  removeNudge: (id: string) => void;
  requestNavigation: (activity: CompletionActivity) => void;
  clearNavigation: () => void;
};

export const useCompletionActivityStore = create<CompletionActivityState>((set) => ({
  activities: [],
  nudges: [],
  pendingNavigation: null,
  setActivities: (activities) => set({ activities }),
  addNudge: (nudge) => set((state) => ({
    nudges: [nudge, ...state.nudges.filter((entry) => entry.id !== nudge.id)].slice(0, 50),
  })),
  removeNudge: (id) => set((state) => ({ nudges: state.nudges.filter((entry) => entry.id !== id) })),
  requestNavigation: (pendingNavigation) => set({ pendingNavigation }),
  clearNavigation: () => set({ pendingNavigation: null }),
}));
