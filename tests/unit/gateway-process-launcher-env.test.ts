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
  vi.unstubAllEnvs();
  Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
});

describe('gateway process launcher env', () => {
  it('pins execution resources to the host store while keeping source session isolation', async () => {
    vi.stubEnv('OPENCLAW_STATE_DIR', 'D:/tmp/host-owner');
    const { buildGatewayRuntimeEnv } = await import('@electron/gateway/process-launcher');
    const { resolveExecutionStatePath } = await import('../../openclaw_runtime/src/state/execution-state-db');
    const env = buildGatewayRuntimeEnv({ OPENCLAW_STATE_DIR: 'D:/tmp/source-sessions',
      OPENCLAW_CONFIG_PATH: 'D:/tmp/source-sessions/openclaw.json' });
    expect(env.OPENCLAW_STATE_DIR).toBe('D:/tmp/source-sessions');
    expect(env.CLAWX_EXECUTION_STATE_PATH).toBe(resolveExecutionStatePath());
  });
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
