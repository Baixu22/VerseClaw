import { create } from 'zustand';
import { hostApi } from '@/lib/host-api';
import { createPollScheduler } from '@/lib/poll-scheduler';
import { isResourceShed } from '@/lib/resource-shed';
import type { TrackedResource } from '@shared/types/resource-tracker';

const POLL_INTERVAL_MS = 10_000; // Poll more frequently than heartbeat (30s)

interface ResourceTrackerState {
  resources: TrackedResource[];
  healthyCount: number;
  idleCount: number;
  unreachableCount: number;
  idleTimeoutMinutes: number;
  isInitialized: boolean;
  lastError: string | null;

  init: () => void;
  refresh: () => Promise<void>;
  stopResource: (resourceId: string) => Promise<boolean>;
  stopAll: () => Promise<number>;
  stop: () => void;
}

let stopPolling: (() => void) | null = null;

export const useResourceStore = create<ResourceTrackerState>((set, get) => ({
  resources: [],
  healthyCount: 0,
  idleCount: 0,
  unreachableCount: 0,
  idleTimeoutMinutes: 10,
  isInitialized: false,
  lastError: null,

  init: () => {
    if (get().isInitialized) return;
    set({ isInitialized: true });
    void get().refresh();
    stopPolling?.();
    stopPolling = createPollScheduler({
      intervalMs: POLL_INTERVAL_MS,
      priority: 'background',
      isShed: isResourceShed,
      task: () => get().refresh(),
    });
  },

  refresh: async () => {
    try {
      const snapshot = await hostApi.resourceTracker.list();
      const resources = Array.isArray(snapshot?.resources) ? snapshot.resources : [];
      set({
        resources,
        healthyCount: Number.isFinite(snapshot?.healthyCount) ? snapshot.healthyCount : 0,
        idleCount: Number.isFinite(snapshot?.idleCount) ? snapshot.idleCount : 0,
        unreachableCount: Number.isFinite(snapshot?.unreachableCount) ? snapshot.unreachableCount : 0,
        idleTimeoutMinutes: Number.isFinite(snapshot?.idleTimeoutMinutes) ? snapshot.idleTimeoutMinutes : 10,
        lastError: null,
      });
    } catch (err) {
      set({ lastError: err instanceof Error ? err.message : String(err) });
    }
  },

  stopResource: async (resourceId: string) => {
    try {
      const result = await hostApi.resourceTracker.stop(resourceId);
      if (result.success) {
        await get().refresh();
        return true;
      }
      return false;
    } catch {
      return false;
    }
  },

  stopAll: async () => {
    try {
      const result = await hostApi.resourceTracker.stopAll();
      if (result.success) {
        await get().refresh();
        return result.stoppedCount;
      }
      return 0;
    } catch {
      return 0;
    }
  },

  stop: () => {
    stopPolling?.();
    stopPolling = null;
    set({ isInitialized: false });
  },
}));
