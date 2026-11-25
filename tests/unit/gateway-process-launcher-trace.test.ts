// @vitest-environment node
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { isPackaged: true, getPath: () => 'D:/tmp' }, utilityProcess: { fork: vi.fn() } }));
vi.mock('@electron/utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@electron/gateway/supervisor', () => ({ observeOwnedGatewayProcess: vi.fn() }));

import { utilityProcess } from 'electron';
import { launchGatewayProcess } from '@electron/gateway/process-launcher';
import type { GatewayLaunchContext } from '@electron/gateway/config-sync';

beforeEach(() => vi.clearAllMocks());

it.each([false, true])('drains stdout and forwards complete startup phase lines only when enabled=%s', async enabled => {
  const child = Object.assign(new EventEmitter(), {
    pid: 1234, stdout: new PassThrough(), stderr: new PassThrough(),
  });
  vi.mocked(utilityProcess.fork).mockReturnValue(child as unknown as Electron.UtilityProcess);
  const onStderrLine = vi.fn();
  const launchContext: GatewayLaunchContext = {
    appSettings: {} as GatewayLaunchContext['appSettings'],
    openclawDir: 'D:/tmp', entryScript: 'D:/tmp/entry.js', entryScriptArgs: [],
    execArgv: [], gatewayArgs: ['gateway'], mode: 'packaged', runtimeMode: 'source',
    forkEnv: { OPENCLAW_GATEWAY_STARTUP_TRACE: enabled ? '1' : '0' },
    binPathExists: true, loadedProviderKeyCount: 0, proxySummary: 'none', channelStartupSummary: 'none',
  };
  const launched = launchGatewayProcess({
    port: 18789, launchContext, sanitizeSpawnArgs: args => args,
    getCurrentState: () => 'starting', getShouldReconnect: () => true,
    onStderrLine, onSpawn: vi.fn(), onExit: vi.fn(), onError: vi.fn(),
  });
  child.emit('spawn');
  await launched;
  child.stdout.write('[gateway] startup tra');
  child.stdout.write('ce: plugins.load 2ms\n');
  child.stdout.end('[agent] ordinary output\n');
  await new Promise<void>(resolve => setImmediate(resolve));
  expect(onStderrLine.mock.calls).toEqual(enabled ? [['[gateway] startup trace: plugins.load 2ms']] : []);
  child.stderr.end();
});
