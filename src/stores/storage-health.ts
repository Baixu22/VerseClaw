import { create } from 'zustand';
import i18n from 'i18next';
import { toast } from 'sonner';
import { hostApi } from '@/lib/host-api';
import type { SystemInfoResult } from '@shared/host-api/contract';

const RAM_LOW_THRESHOLD_BYTES = 512 * 1024 * 1024;
const DISK_LOW_RATIO = 0.1;
const POLL_INTERVAL_MS = 60_000;

interface StorageHealthState {
  info: SystemInfoResult | null;
  isInitialized: boolean;
  lastError: string | null;
  ramLow: boolean;
  diskLow: boolean;
  init: () => Promise<void>;
  refresh: () => Promise<void>;
  stop: () => void;
}

let storageHealthTimer: ReturnType<typeof setInterval> | null = null;
let prevRamLow = false;
let prevDiskLow = false;

function computeRamLow(info: SystemInfoResult | null): boolean {
  if (!info) return false;
  return info.ram.freeBytes < RAM_LOW_THRESHOLD_BYTES;
}

function computeDiskLow(info: SystemInfoResult | null): boolean {
  if (!info || info.disk.length === 0) return false;
  return info.disk.some((d) => {
    if (d.totalBytes <= 0) return false;
    return d.freeBytes / d.totalBytes < DISK_LOW_RATIO;
  });
}

export const useStorageHealthStore = create<StorageHealthState>((set, get) => ({
  info: null,
  isInitialized: false,
  lastError: null,
  ramLow: false,
  diskLow: false,

  init: async () => {
    if (get().isInitialized) return;
    set({ isInitialized: true });
    await get().refresh();
    if (storageHealthTimer) clearInterval(storageHealthTimer);
    storageHealthTimer = setInterval(() => {
      void get().refresh();
    }, POLL_INTERVAL_MS);
  },

  refresh: async () => {
    try {
      const info = await hostApi.system.info();
      const ramLow = computeRamLow(info);
      const diskLow = computeDiskLow(info);
      set({ info, ramLow, diskLow, lastError: null });

      if (ramLow && !prevRamLow) {
        toast.error(i18n.t('common:storageHealth.ramLow'));
      }
      if (diskLow && !prevDiskLow) {
        toast.error(i18n.t('common:storageHealth.diskLow'));
      }
      prevRamLow = ramLow;
      prevDiskLow = diskLow;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ lastError: msg });
    }
  },

  stop: () => {
    if (storageHealthTimer) {
      clearInterval(storageHealthTimer);
      storageHealthTimer = null;
    }
    set({ isInitialized: false });
  },
}));
