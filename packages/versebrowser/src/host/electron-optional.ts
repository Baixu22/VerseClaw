/**
 * Optional Electron access for npm installs without the peer dependency.
 * Hosts that run inside Electron get the real module; plain Node consumers do not.
 */
import { createRequire } from 'node:module';

type ElectronModule = typeof import('electron');

const require = createRequire(import.meta.url);

let cached: ElectronModule | null | undefined;

export function tryElectron(): ElectronModule | null {
  if (cached !== undefined) return cached;
  try {
    cached = require('electron') as ElectronModule;
  } catch {
    cached = null;
  }
  return cached;
}

export function requireElectron(): ElectronModule {
  const mod = tryElectron();
  if (!mod) {
    throw new Error(
      'electron is required for this API. Install the optional peer dependency (electron >= 44) or run inside an Electron host.',
    );
  }
  return mod;
}

export function electronApp(): ElectronModule['app'] {
  return requireElectron().app;
}

export function electronBrowserWindow(): ElectronModule['BrowserWindow'] {
  return requireElectron().BrowserWindow;
}

export function electronSafeStorage(): ElectronModule['safeStorage'] {
  return requireElectron().safeStorage;
}
