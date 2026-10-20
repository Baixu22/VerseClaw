// @vitest-environment node
// R0-5.7: officecli resolved as a .CMD/.BAT on Windows must route through
// COMSPEC — direct spawn hits EINVAL on the CVE-2024-27980 patched Node.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(() => ({ stdout: null, stderr: null, on: vi.fn() })),
}));

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
  exec: vi.fn(),
  execFile: vi.fn(),
  execFileSync: vi.fn(),
  execSync: vi.fn(),
  fork: vi.fn(),
  spawnSync: vi.fn(),
}));

const originalPlatform = process.platform;
const originalComspec = process.env.COMSPEC;

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

describe('R0-5 officecli windows spawn guard', () => {
  beforeEach(() => {
    vi.resetModules();
    spawnMock.mockReset();
    spawnMock.mockReturnValue({ stdout: null, stderr: null, on: vi.fn() });
    process.env.COMSPEC = 'C:\\Windows\\System32\\cmd.exe';
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    process.env.COMSPEC = originalComspec;
  });

  it('routes .CMD binaries through COMSPEC on Windows', async () => {
    setPlatform('win32');
    const { spawnOfficeCli } = await import('@electron/services/office-tools-api');

    spawnOfficeCli('C:\\officecli.CMD', ['watch', 'a.docx', '--port', '9'], { windowsHide: true });

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [command, args] = spawnMock.mock.calls[0] as unknown as [string, string[]];
    expect(command).toBe('C:\\Windows\\System32\\cmd.exe');
    expect(args.slice(0, 4)).toEqual(['/d', '/s', '/c', 'C:\\officecli.CMD']);
    expect(args.slice(4)).toEqual(['watch', 'a.docx', '--port', '9']);
  });

  it('spawns .exe binaries directly on Windows', async () => {
    setPlatform('win32');
    const { spawnOfficeCli } = await import('@electron/services/office-tools-api');

    spawnOfficeCli('C:\\officecli.EXE', ['watch'], {});

    const [command, args] = spawnMock.mock.calls[0] as unknown as [string, string[]];
    expect(command).toBe('C:\\officecli.EXE');
    expect(args).toEqual(['watch']);
  });

  it('leaves non-Windows platforms untouched', async () => {
    setPlatform('linux');
    const { spawnOfficeCli } = await import('@electron/services/office-tools-api');

    spawnOfficeCli('/usr/bin/officecli.cmd', ['watch'], {});

    const [command] = spawnMock.mock.calls[0] as unknown as [string];
    expect(command).toBe('/usr/bin/officecli.cmd');
  });
});
