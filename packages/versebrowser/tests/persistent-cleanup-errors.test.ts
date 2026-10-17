import { afterEach, expect, it, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSessionRecord, removeSession, saveSessionRecord, sessionDir } from '../src/engine/persistent-sessions.ts';
import { setWorkspaceRoot } from '../src/host/workspace-paths.ts';

vi.mock('node:fs/promises', { spy: true });
afterEach(() => { vi.restoreAllMocks(); setWorkspaceRoot(undefined); });

it('exhausted profile cleanup reports failure and restores a partially removed record for retry', async () => {
  const original = await vi.importActual<typeof fs>('node:fs/promises');
  const root = await fs.mkdtemp(join(tmpdir(), 'vb-cleanup-error-'));
  setWorkspaceRoot(root);
  const record = { schemaVersion: 1 as const, id: 'cleanup', pid: 0, endpoint: 'http://127.0.0.1:9222', port: 9222, mode: 'headless' as const, createdAt: '2026-10-03T00:00:00Z', profileDir: join(sessionDir('cleanup'), 'profile') };
  await saveSessionRecord(record);
  const dir = sessionDir(record.id);
  await fs.mkdir(record.profileDir);
  await fs.writeFile(join(record.profileDir, 'locked'), 'sentinel');
  vi.mocked(fs.rm).mockImplementation(async path => {
    expect(String(path)).toBe(dir);
    await original.rm(join(dir, 'session.json'), { force: true });
    throw Object.assign(new Error('EBUSY: profile locked'), { code: 'EBUSY' });
  });
  try {
    await expect(removeSession(record.id)).rejects.toThrow('EBUSY');
    expect(await loadSessionRecord(record.id)).toEqual(record);
    expect(await fs.readFile(join(record.profileDir, 'locked'), 'utf8')).toBe('sentinel');
    vi.mocked(fs.rm).mockRestore();
    await removeSession(record.id);
    expect(await loadSessionRecord(record.id)).toBeNull();
  } finally {
    vi.mocked(fs.rm).mockRestore();
    await original.rm(root, { recursive: true, force: true });
  }
});

it.runIf(process.platform === 'win32')('waits for a transient Windows profile lock before removing the session', async () => {
  const original = await vi.importActual<typeof fs>('node:fs/promises');
  const root = await fs.mkdtemp(join(tmpdir(), 'vb-cleanup-lock-'));
  setWorkspaceRoot(root);
  const record = { schemaVersion: 1 as const, id: 'locked', pid: 0, endpoint: 'http://127.0.0.1:9222', port: 9222, mode: 'headless' as const, createdAt: '2026-10-04T00:00:00Z', profileDir: join(sessionDir('locked'), 'profile') };
  await saveSessionRecord(record);
  await fs.mkdir(record.profileDir);
  const lockfile = join(record.profileDir, 'lockfile');
  await fs.writeFile(lockfile, 'sentinel');
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    '$lock = [System.IO.File]::Open($env:VB_TEST_LOCK_FILE, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::None); [Console]::WriteLine("locked"); [Console]::Out.Flush(); Start-Sleep -Milliseconds 2200; $lock.Dispose();',
  ], { env: { ...process.env, VB_TEST_LOCK_FILE: lockfile }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = once(child, 'exit');
  try {
    const [output] = await once(child.stdout!, 'data', { signal: AbortSignal.timeout(5000) });
    expect(String(output).trim()).toBe('locked');
    await expect(removeSession(record.id)).resolves.toBeUndefined();
    expect(await loadSessionRecord(record.id)).toBeNull();
    expect(await original.stat(sessionDir(record.id)).catch(() => null)).toBeNull();
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await exited;
    await original.rm(root, { recursive: true, force: true });
  }
});
