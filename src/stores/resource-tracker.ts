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
  observerCount: number;
  lastError: string | null;

  init: () => () => void;
  refresh: () => Promise<void>;
  stopResource: (resourceId: string) => Promise<boolean>;
  stopAll: () => Promise<number>;
  stop: () => void;
}

let stopPolling: (() => void) | null = null;
let generation = 0;
let refreshInFlight: Promise<void> | null = null;

export const useResourceStore = create<ResourceTrackerState>((set, get) => ({
  resources: [],
  healthyCount: 0,
  idleCount: 0,
  unreachableCount: 0,
  idleTimeoutMinutes: 10,
  isInitialized: false,
  observerCount: 0,
  lastError: null,

  init: () => {
    const first = get().observerCount === 0;
    if (first) generation += 1;
    const ownerGeneration = generation;
    set({ isInitialized: true, observerCount: get().observerCount + 1 });
    if (first) {
      if (typeof document === 'undefined' || document.visibilityState !== 'hidden') void get().refresh();
      stopPolling = createPollScheduler({
      intervalMs: POLL_INTERVAL_MS,
      priority: 'background',
      isShed: isResourceShed,
      task: () => get().refresh(),
      });
    }
    let released = false;
    return () => {
      if (released || ownerGeneration !== generation) return;
      released = true;
      set({ observerCount: get().observerCount - 1 });
      if (get().observerCount === 0) get().stop();
    };
  },

  refresh: () => {
    if (refreshInFlight) return refreshInFlight;
    if (get().observerCount === 0) return Promise.resolve();
    const ownerGeneration = generation;
    const pending = (async () => {
    try {
      const snapshot = await hostApi.resourceTracker.list();
      if (ownerGeneration !== generation) return;
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
      if (ownerGeneration !== generation) return;
      set({ lastError: err instanceof Error ? err.message : String(err) });
    }
    })().finally(() => { if (refreshInFlight === pending) refreshInFlight = null; });
    refreshInFlight = pending;
    return pending;
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
    generation += 1;
    stopPolling?.();
    stopPolling = null;
    refreshInFlight = null;
    set({ isInitialized: false, observerCount: 0 });
  },
}));
