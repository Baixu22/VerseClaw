/**
 * Preload Script
 * Exposes safe APIs to the renderer process via contextBridge
 */
import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { HostRequest } from '@shared/host-api/types';
import { HOST_EVENT_CHANNELS } from '@shared/host-events/contract';

const validStaticEventChannels: Set<string> = new Set(
  Object.values(HOST_EVENT_CHANNELS).flatMap((moduleChannels) => Object.values(moduleChannels)),
);
// R0-5: on()/once() wrap callbacks to strip the IpcRendererEvent arg — off()
// must remove the WRAPPER, not the raw callback, or listeners leak forever.
// Keyed by callback (WeakMap) -> channel -> wrapper.
const eventWrapperByCallback = new WeakMap<
  (...args: unknown[]) => void,
  Map<string, (event: Electron.IpcRendererEvent, ...args: unknown[]) => void>
>();
const DYNAMIC_CHANNEL_EVENT_RE = /^channel:[a-z0-9_-]+-(?:qr|success|error)$/i;

function isValidEventChannel(channel: string): boolean {
  return validStaticEventChannels.has(channel)
    || DYNAMIC_CHANNEL_EVENT_RE.test(channel)
    || channel.startsWith('ext:');
}

/**
 * IPC renderer methods exposed to the renderer process
 */
const electronAPI = {
  /**
   * IPC invoke (request-response pattern)
   */
  ipcRenderer: {
    invoke: (channel: string, ...args: unknown[]) => {
      const validChannels = [
        // Dialog
        'dialog:open',
        'dialog:message',
        // App
        'app:version',
        'app:name',
        'app:platform',
        'app:request',
        // Window controls
        'window:minimize',
        'window:maximize',
        'window:close',
        'window:isMaximized',
        'window:syncTrafficLightPosition',
        // Env
        'env:getConfig',
        'env:setApiKey',
        'env:deleteApiKey',
      ];

      if (validChannels.includes(channel)) {
        return ipcRenderer.invoke(channel, ...args);
      }

      throw new Error(`Invalid IPC channel: ${channel}`);
    },

    /**
     * Listen for events from main process
     */
    on: (channel: string, callback: (...args: unknown[]) => void) => {
      if (isValidEventChannel(channel)) {
        const subscription = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => {
          callback(...args);
        };
        ipcRenderer.on(channel, subscription);
        let byChannel = eventWrapperByCallback.get(callback);
        if (!byChannel) {
          byChannel = new Map();
          eventWrapperByCallback.set(callback, byChannel);
        }
        byChannel.set(channel, subscription);

        // Return unsubscribe function
        return () => {
          ipcRenderer.removeListener(channel, subscription);
          byChannel?.delete(channel);
        };
      }

      throw new Error(`Invalid IPC channel: ${channel}`);
    },

    /**
     * Listen for a single event from main process
     */
    once: (channel: string, callback: (...args: unknown[]) => void) => {
      if (isValidEventChannel(channel)) {
        const subscription = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => {
          callback(...args);
        };
        ipcRenderer.once(channel, subscription);
        // R0-5: cancellable one-shot — the returned unsubscribe removes the
        // wrapper before it fires.
        return () => {
          ipcRenderer.removeListener(channel, subscription);
        };
      }

      throw new Error(`Invalid IPC channel: ${channel}`);
    },

    /**
     * Remove listeners for a channel
     */
    off: (channel: string, callback?: (...args: unknown[]) => void) => {
      if (callback) {
        const wrapper = eventWrapperByCallback.get(callback)?.get(channel);
        if (wrapper) {
          // Remove the registered wrapper (the raw callback was never added).
          ipcRenderer.removeListener(channel, wrapper);
          eventWrapperByCallback.get(callback)?.delete(channel);
        } else {
          // Fallback for listeners registered outside this bridge.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ipcRenderer.removeListener(channel, callback as any);
        }
      } else {
        ipcRenderer.removeAllListeners(channel);
      }
    },
  },

  /**
   * Resolve the on-disk path for a native drag/drop or <input type="file"> File.
   */
  getPathForFile: (file: File) => webUtils.getPathForFile(file),

  /**
   * Get current platform
   */
  platform: process.platform,

  /**
   * Check if running in development
   */
  isDev: process.env.NODE_ENV === 'development' || !!process.env.VITE_DEV_SERVER_URL,
};

const verseClawAPI = {
  hostInvoke: (request: HostRequest) => ipcRenderer.invoke('host:invoke', request),
};

// Expose the API to the renderer process
contextBridge.exposeInMainWorld('electron', electronAPI);
contextBridge.exposeInMainWorld('verseClaw', verseClawAPI);

// Type declarations for the renderer process
export type ElectronAPI = typeof electronAPI;
