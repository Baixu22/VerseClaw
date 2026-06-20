import { closeSync, mkdirSync, openSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import { acquireProcessInstanceFileLock } from './process-instance-lock';

export interface SingleInstanceLockResult {
  gotTheLock: boolean;
  gotElectronLock: boolean;
  release: () => void;
}

export interface SingleInstanceLockOptions {
  isE2EMode: boolean;
  userDataDir: string;
  lockName: string;
  requestElectronLock?: () => boolean;
  canCreateChromiumLockFile?: (userDataDir: string) => boolean;
}

export function canCreateChromiumLockFile(userDataDir: string): boolean {
  const probePath = join(userDataDir, '.clawx-electron-lock-probe');
  try {
    mkdirSync(userDataDir, { recursive: true });
    const fd = openSync(probePath, 'wx');
    closeSync(fd);
    rmSync(probePath, { force: true });
    return true;
  } catch {
    try {
      rmSync(probePath, { force: true });
    } catch {
      // best-effort cleanup
    }
    return false;
  }
}

export function acquireSingleInstanceLock(options: SingleInstanceLockOptions): SingleInstanceLockResult {
  const requestElectronLock = options.requestElectronLock ?? (() => app.requestSingleInstanceLock());
  const lockProbe = options.canCreateChromiumLockFile ?? canCreateChromiumLockFile;
  const shouldUseElectronLock = !options.isE2EMode && lockProbe(options.userDataDir);
  const gotElectronLock = options.isE2EMode || !shouldUseElectronLock || requestElectronLock();

  if (!gotElectronLock) {
    console.info('[ClawX] Another instance already holds the single-instance lock; exiting duplicate process');
    return {
      gotTheLock: false,
      gotElectronLock,
      release: () => {},
    };
  }

  let releaseProcessInstanceFileLock: () => void = () => {};
  let gotFileLock = true;
  if (!options.isE2EMode) {
    try {
      const fileLock = acquireProcessInstanceFileLock({
        userDataDir: options.userDataDir,
        lockName: options.lockName,
        force: shouldUseElectronLock,
      });
      gotFileLock = fileLock.acquired;
      releaseProcessInstanceFileLock = fileLock.release;
      if (!fileLock.acquired) {
        const ownerDescriptor = fileLock.ownerPid
          ? `${fileLock.ownerFormat ?? 'legacy'} pid=${fileLock.ownerPid}`
          : fileLock.ownerFormat === 'unknown'
            ? 'unknown lock format/content'
            : 'unknown owner';
        console.info(
          `[ClawX] Another instance already holds process lock (${fileLock.lockPath}, ${ownerDescriptor}); exiting duplicate process`,
        );
      }
    } catch (error) {
      gotFileLock = shouldUseElectronLock;
      console.warn('[ClawX] Failed to acquire process instance file lock; continuing with Electron single-instance lock only', error);
    }
  }

  if (!shouldUseElectronLock && !options.isE2EMode) {
    console.warn('[ClawX] Electron single-instance lock is unavailable for userData; using ClawX process lock only');
  }

  return {
    gotTheLock: gotElectronLock && gotFileLock,
    gotElectronLock,
    release: releaseProcessInstanceFileLock,
  };
}
