import { describe, expect, it, vi } from 'vitest';

import {
  buildPnpmMismatchMessage,
  parsePackageManagerSpec,
  resolvePinnedPnpm,
} from '../../scripts/run-with-pinned-pnpm.mjs';

type FakeSpawnResult = {
  status: number | null;
  stdout?: string;
  stderr?: string;
  error?: Error;
};

function fakeSpawn(results: Record<string, FakeSpawnResult>) {
  return vi.fn((command: string, args: readonly string[]) => {
    const key = [command, ...args].join(' ');
    return results[key] ?? { status: 1, stdout: '', stderr: `missing fake for ${key}` };
  });
}

describe('pinned pnpm runner', () => {
  it('parses the pinned pnpm version from packageManager', () => {
    expect(parsePackageManagerSpec('pnpm@10.33.4+sha512.abc123')).toEqual({
      name: 'pnpm',
      version: '10.33.4',
    });
  });

  it('uses PATH pnpm when it already matches the pinned version', () => {
    const spawnSync = fakeSpawn({
      'pnpm --version': { status: 0, stdout: '10.33.4\n' },
    });

    const resolved = resolvePinnedPnpm({
      packageManagerSpec: 'pnpm@10.33.4+sha512.abc123',
      env: {},
      spawnSync,
    });

    expect(resolved).toMatchObject({
      ok: true,
      command: 'pnpm',
      argsPrefix: [],
      version: '10.33.4',
    });
    expect(spawnSync).toHaveBeenCalledTimes(1);
  });

  it('falls back to corepack pnpm when PATH pnpm is the Codex runtime version', () => {
    const spawnSync = fakeSpawn({
      'pnpm --version': { status: 0, stdout: '11.7.0\n' },
      'corepack pnpm --version': { status: 0, stdout: '10.33.4\n' },
    });

    const resolved = resolvePinnedPnpm({
      packageManagerSpec: 'pnpm@10.33.4+sha512.abc123',
      env: {},
      spawnSync,
    });

    expect(resolved).toMatchObject({
      ok: true,
      command: 'corepack',
      argsPrefix: ['pnpm'],
      version: '10.33.4',
    });
  });

  it('falls back to the Windows user pnpm shim when corepack is unavailable', () => {
    const userShim = 'C:\\Users\\dev\\AppData\\Roaming\\npm\\pnpm.cmd';
    const spawnSync = fakeSpawn({
      'pnpm --version': { status: 0, stdout: '11.7.0\n' },
      'corepack pnpm --version': { status: 1, stdout: '', stderr: 'corepack missing' },
      [`${userShim} --version`]: { status: 0, stdout: '10.33.4\n' },
    });

    const resolved = resolvePinnedPnpm({
      packageManagerSpec: 'pnpm@10.33.4+sha512.abc123',
      env: { APPDATA: 'C:\\Users\\dev\\AppData\\Roaming' },
      spawnSync,
    });

    expect(resolved).toMatchObject({
      ok: true,
      command: userShim,
      argsPrefix: [],
      version: '10.33.4',
    });
  });

  it('reports a repair command when no pnpm candidate matches the pinned version', () => {
    const spawnSync = fakeSpawn({
      'pnpm --version': { status: 0, stdout: '11.7.0\n' },
      'corepack pnpm --version': { status: 1, stdout: '', stderr: 'corepack missing' },
    });

    const resolved = resolvePinnedPnpm({
      packageManagerSpec: 'pnpm@10.33.4+sha512.abc123',
      env: {},
      spawnSync,
    });

    expect(resolved.ok).toBe(false);
    const message = buildPnpmMismatchMessage(resolved);
    expect(message).toContain('Expected pnpm 10.33.4');
    expect(message).toContain('PATH pnpm: 11.7.0');
    expect(message).toContain("C:\\Users\\27933\\AppData\\Roaming\\npm");
  });
});
