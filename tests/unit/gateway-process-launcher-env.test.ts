import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { utilityProcess } from 'electron';
import type { GatewayLaunchContext } from '@electron/gateway/config-sync';

vi.mock('@electron/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

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

  it('lets child output exceed the pipe buffer without blocking the Gateway', async () => {
    const { launchGatewayProcess } = await import('@electron/gateway/process-launcher');
    const child = Object.assign(new EventEmitter(), {
      pid: 12345, stdout: new PassThrough({ highWaterMark: 1024 }), stderr: new PassThrough(),
      kill: vi.fn(),
    });
    vi.mocked(utilityProcess.fork).mockImplementationOnce(() => {
      queueMicrotask(() => child.emit('spawn'));
      return child as unknown as Electron.UtilityProcess;
    });
    const launchContext: GatewayLaunchContext = {
      appSettings: {} as GatewayLaunchContext['appSettings'], openclawDir: process.cwd(),
      entryScript: 'fixture-entry.js', entryScriptArgs: [], execArgv: [], gatewayArgs: ['gateway'], forkEnv: {},
      mode: 'dev', runtimeMode: 'source', binPathExists: false, loadedProviderKeyCount: 0,
      proxySummary: 'disabled', channelStartupSummary: 'none',
    };
    try {
      await launchGatewayProcess({
        port: 18789, launchContext, sanitizeSpawnArgs: args => args,
        getCurrentState: () => 'running', getShouldReconnect: () => false,
        onStderrLine: vi.fn(), onSpawn: vi.fn(), onExit: vi.fn(), onError: vi.fn(),
      });
      const writeComplete = vi.fn();
      child.stdout.write(Buffer.alloc(256 * 1024), writeComplete);
      await expect.poll(() => writeComplete.mock.calls.length, { timeout: 1000, interval: 20 }).toBe(1);
      expect(writeComplete.mock.calls[0][0]).toBeFalsy();
      expect(child.stdout.readableLength).toBe(0);
    } finally {
      child.stdout.destroy();
      child.stderr.destroy();
      child.removeAllListeners();
    }
  });
});
