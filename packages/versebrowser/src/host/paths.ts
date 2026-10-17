/**
 * Path helpers for agent-browser standalone package.
 * Extracted from electron/utils/paths.ts getDataDir (source lines 109-114).
 * Adaptive: fall back when Electron `app` is unavailable (unit tests / Node hosts).
 */
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { tryElectron } from './electron-optional.ts';

/**
 * Get Verse Claw data directory
 */
export type DataDirProvider = () => string | undefined;

let dataDirProvider: DataDirProvider | null = null;

/** Host-injectable data directory; keeps Main state ownership outside the package. */
export function setDataDirProvider(provider: DataDirProvider | null): void {
  dataDirProvider = provider;
}

export function getDataDir(): string {
  const provided = dataDirProvider?.();
  if (provided) return provided;
  try {
    const app = tryElectron()?.app;
    if (app?.getPath) {
      return app.getPath('userData');
    }
  } catch {
    // Electron app not ready / not running under Electron.
  }
  return join(tmpdir(), 'agent-browser-data');
}