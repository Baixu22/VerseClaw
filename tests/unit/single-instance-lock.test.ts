import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { acquireSingleInstanceLock } from '@electron/main/single-instance-lock';

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'verse-claw-single-instance-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) continue;
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('single instance lock', () => {
  it('uses Electron lock and force-cleans stale Verse Claw process lock when Chromium lock files are writable', () => {
    const userDataDir = createTempDir();
    const requestElectronLock = vi.fn(() => true);

    const lock = acquireSingleInstanceLock({
      isE2EMode: false,
      userDataDir,
      lockName: 'verse-claw',
      requestElectronLock,
      canCreateChromiumLockFile: () => true,
    });

    expect(lock.gotTheLock).toBe(true);
    expect(lock.gotElectronLock).toBe(true);
    expect(requestElectronLock).toHaveBeenCalledTimes(1);
    expect(existsSync(join(userDataDir, 'verse-claw.instance.lock'))).toBe(true);

    lock.release();
    expect(existsSync(join(userDataDir, 'verse-claw.instance.lock'))).toBe(false);
  });

  it('falls back to Verse Claw process lock when Chromium lock files are unavailable', () => {
    const userDataDir = createTempDir();
    const requestElectronLock = vi.fn(() => {
      throw new Error('should not request Electron lock');
    });

    const lock = acquireSingleInstanceLock({
      isE2EMode: false,
      userDataDir,
      lockName: 'verse-claw',
      requestElectronLock,
      canCreateChromiumLockFile: () => false,
    });

    expect(lock.gotTheLock).toBe(true);
    expect(lock.gotElectronLock).toBe(true);
    expect(requestElectronLock).not.toHaveBeenCalled();
    expect(existsSync(join(userDataDir, 'verse-claw.instance.lock'))).toBe(true);

    lock.release();
  });

  it('rejects duplicate fallback instances through the Verse Claw process lock', () => {
    const userDataDir = createTempDir();
    const first = acquireSingleInstanceLock({
      isE2EMode: false,
      userDataDir,
      lockName: 'verse-claw',
      canCreateChromiumLockFile: () => false,
    });
    const second = acquireSingleInstanceLock({
      isE2EMode: false,
      userDataDir,
      lockName: 'verse-claw',
      canCreateChromiumLockFile: () => false,
    });

    expect(first.gotTheLock).toBe(true);
    expect(second.gotTheLock).toBe(false);

    first.release();
  });

  it('exits when Electron reports another instance in normal lock mode', () => {
    const userDataDir = createTempDir();
    const lock = acquireSingleInstanceLock({
      isE2EMode: false,
      userDataDir,
      lockName: 'verse-claw',
      requestElectronLock: () => false,
      canCreateChromiumLockFile: () => true,
    });

    expect(lock.gotTheLock).toBe(false);
    expect(lock.gotElectronLock).toBe(false);
    expect(existsSync(join(userDataDir, 'verse-claw.instance.lock'))).toBe(false);
  });
});
