/**
 * Electron API Type Declarations
 * Types for the APIs exposed via contextBridge
 */

import type { HostResponse, HostRequest } from '../lib/host-api-types';

export interface IpcRenderer {
  on(channel: string, callback: (...args: unknown[]) => void): (() => void) | void;
  once(channel: string, callback: (...args: unknown[]) => void): void;
  off(channel: string, callback?: (...args: unknown[]) => void): void;
}

export interface ElectronAPI {
  ipcRenderer: IpcRenderer;
  getPathForFile: (file: File) => string;
  platform: NodeJS.Platform;
  isDev: boolean;
}

export type HostInvokeErrorCode = 'VALIDATION' | 'UNSUPPORTED' | 'INTERNAL';
export type HostInvokeRequest = HostRequest;
export type HostInvokeResponse<T = unknown> = HostResponse<T>;

declare global {
  interface Window {
    electron: ElectronAPI;
    verseClaw?: {
      hostInvoke: <T = unknown>(request: HostInvokeRequest) => Promise<HostInvokeResponse<T>>;
    };
  }
}

export {};
