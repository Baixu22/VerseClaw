import { afterEach, describe, expect, it } from 'vitest';

const originalPlatform = process.platform;

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
});

describe('officecli path helpers', () => {
  it('prepends the Windows managed install dir when officecli is not on PATH', async () => {
    setPlatform('win32');
    const { prependOfficeCliPathToEnv } = await import('@electron/utils/officecli-path');
    const officeDir = 'C:\\Users\\me\\AppData\\Local\\OfficeCLI';

    const result = prependOfficeCliPathToEnv(
      {
        Path: 'C:\\Windows\\System32',
        LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local',
      },
      {
        existsSync: (candidate) => candidate === `${officeDir}\\officecli.exe`,
      },
    );

    expect(result.changed).toBe(true);
    expect(result.dir).toBe(officeDir);
    expect(result.env.Path).toBe(`${officeDir};C:\\Windows\\System32`);
    expect(result.env.PATH).toBeUndefined();
  });

  it('does not mutate PATH when officecli already resolves from PATH', async () => {
    setPlatform('win32');
    const { prependOfficeCliPathToEnv } = await import('@electron/utils/officecli-path');

    const result = prependOfficeCliPathToEnv(
      {
        Path: 'C:\\Tools;C:\\Windows\\System32',
        LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local',
      },
      {
        existsSync: (candidate) => candidate === 'C:\\Tools\\officecli.exe',
      },
    );

    expect(result.changed).toBe(false);
    expect(result.env.Path).toBe('C:\\Tools;C:\\Windows\\System32');
  });

  it('prepends ~/.local/bin on Unix when GUI-launched PATH does not include it', async () => {
    setPlatform('linux');
    const { prependOfficeCliPathToEnv } = await import('@electron/utils/officecli-path');

    const result = prependOfficeCliPathToEnv(
      {
        PATH: '/usr/bin:/bin',
        HOME: '/home/me',
      },
      {
        existsSync: (candidate) => candidate === '/home/me/.local/bin/officecli',
      },
    );

    expect(result.changed).toBe(true);
    expect(result.dir).toBe('/home/me/.local/bin');
    expect(result.env.PATH).toBe('/home/me/.local/bin:/usr/bin:/bin');
  });

  it('preserves the Windows Path key while removing duplicate PATH casing', async () => {
    setPlatform('win32');
    const { prependOfficeCliPathToEnv } = await import('@electron/utils/officecli-path');
    const officeDir = 'C:\\Users\\me\\AppData\\Local\\OfficeCLI';

    const result = prependOfficeCliPathToEnv(
      {
        PATH: 'C:\\Old',
        Path: 'C:\\Windows',
        LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local',
      },
      {
        existsSync: (candidate) => candidate === `${officeDir}\\officecli.exe`,
      },
    );

    expect(result.changed).toBe(true);
    expect(result.env.Path).toBe(`${officeDir};C:\\Windows`);
    expect(result.env.PATH).toBeUndefined();
  });
});
