import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    isPackaged: true,
    getPath: vi.fn(() => process.cwd()),
  },
  utilityProcess: {
    fork: vi.fn(),
  },
}));

const originalPlatform = process.platform;

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
});

describe('gateway process launcher env', () => {
  it('adds the managed OfficeCLI install dir to the Gateway runtime env', async () => {
    setPlatform('win32');
    const officeDir = 'C:\\Users\\me\\AppData\\Local\\OfficeCLI';
    const { buildGatewayRuntimeEnv } = await import('@electron/gateway/process-launcher');

    const env = buildGatewayRuntimeEnv(
      {
        Path: 'C:\\Windows\\System32',
        LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local',
      },
      {
        existsSync: (candidate) => candidate === `${officeDir}\\officecli.exe`,
      },
    );

    expect(env.Path).toBe(`${officeDir};C:\\Windows\\System32`);
    expect(env.PATH).toBeUndefined();
    expect(env.OPENCLAW_DISABLE_BONJOUR).toBe('1');
  });
});
