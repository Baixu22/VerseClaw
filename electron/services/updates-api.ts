import { app } from 'electron';
import { autoUpdater } from 'electron-updater';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';

export function createUpdatesApi(): CompleteHostServiceRegistry['updates'] {
  return {
    check: async () => {
      if (!app.isPackaged) {
        return { success: true, status: { status: 'not-available' } };
      }
      try {
        const result = await autoUpdater.checkForUpdates();
        const version = result?.updateInfo.version;
        return {
          success: true,
          status: version && version !== app.getVersion()
            ? { status: 'available', version }
            : { status: 'not-available' },
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
          status: { status: 'error' },
        };
      }
    },
    download: async () => {
      try {
        await autoUpdater.downloadUpdate();
        return { success: true, status: { status: 'downloaded' } };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
          status: { status: 'error' },
        };
      }
    },
    install: () => {
      autoUpdater.quitAndInstall();
      return { success: true };
    },
  };
}
