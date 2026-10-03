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

  it('defaults OPENCLAW_FALLBACK_SKIP_TTL_MS to 60000 when unset', async () => {
    setPlatform('win32');
    const { buildGatewayRuntimeEnv } = await import('@electron/gateway/process-launcher');

    const env = buildGatewayRuntimeEnv({});

    expect(env.OPENCLAW_FALLBACK_SKIP_TTL_MS).toBe('60000');
  });

  it('treats a blank inherited OPENCLAW_FALLBACK_SKIP_TTL_MS as unset', async () => {
    setPlatform('win32');
    const { buildGatewayRuntimeEnv } = await import('@electron/gateway/process-launcher');

    const env = buildGatewayRuntimeEnv({ OPENCLAW_FALLBACK_SKIP_TTL_MS: '   ' });

    expect(env.OPENCLAW_FALLBACK_SKIP_TTL_MS).toBe('60000');
  });

  it('preserves an explicit OPENCLAW_FALLBACK_SKIP_TTL_MS override including 0', async () => {
    setPlatform('win32');
    const { buildGatewayRuntimeEnv } = await import('@electron/gateway/process-launcher');

    const disabled = buildGatewayRuntimeEnv({ OPENCLAW_FALLBACK_SKIP_TTL_MS: '0' });
    const custom = buildGatewayRuntimeEnv({ OPENCLAW_FALLBACK_SKIP_TTL_MS: '90000' });

    expect(disabled.OPENCLAW_FALLBACK_SKIP_TTL_MS).toBe('0');
    expect(custom.OPENCLAW_FALLBACK_SKIP_TTL_MS).toBe('90000');
  });
});
