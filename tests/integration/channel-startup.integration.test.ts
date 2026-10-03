// @vitest-environment node
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { app } from 'electron';
import { startIrcServer } from '../../scripts/rc10/irc-server.mjs';
import { startGatewaySidecars } from '../../openclaw_runtime/src/gateway/server-startup-post-attach';
import { connectIrcClient, type IrcClient } from '../../openclaw_runtime/extensions/irc/src/client';
import { buildIrcConnectOptions } from '../../openclaw_runtime/extensions/irc/src/connect-options';
import { resolveIrcAccount } from '../../openclaw_runtime/extensions/irc/src/accounts';
import { prepareGatewayLaunchContext } from '@electron/gateway/config-sync';

const state = await vi.hoisted(async () => {
  const fs = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const temp = fs.mkdtempSync(join(tmpdir(), 'channel-startup-'));
  return { temp, configDir: join(temp, 'config'), runtimeDir: join(temp, 'runtime'), userData: join(temp, 'app') };
});
// The launch function, disk config merge, skip env, sidecar and IRC client are
// production code. The supplied startChannels callback bypasses the full plugin
// manager; complete plugin discovery/Electron startup still needs a live probe.
vi.mock('@electron/utils/paths', async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  getOpenClawConfigDir: () => state.configDir,
  getOpenClawRuntimeDir: () => state.runtimeDir,
  getOpenClawRuntimeEntryPath: () => join(state.runtimeDir, 'entry.js'),
  isOpenClawRuntimeEnabled: () => true,
}));
vi.mock('@electron/utils/store', () => ({ getAllSettings: async () => ({ gatewayToken: 'local-test-token' }) }));
vi.mock('@electron/utils/secure-storage', () => ({
  getAllProviders: async () => [], getDefaultProvider: async () => null,
  getProvider: async () => null, getApiKey: async () => null,
}));
vi.mock('@electron/services/providers/provider-runtime-sync', () => ({ syncDefaultProviderToRuntime: vi.fn(async () => ({ degraded: false })) }));
vi.mock('@electron/services/mcp-api', () => ({ resolveMcpServersForContext: async () => [] }));
vi.mock('@electron/services/workspaces-api', () => ({ getActiveWorkspaceProfile: async () => null }));
vi.mock('@electron/utils/uv-env', () => ({ getUvMirrorEnv: async () => ({}) }));
vi.mock('@electron/utils/verseshell-runtime-bundle', async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(), resolveVerseShellRuntimeForLaunch: async () => null,
}));
vi.mock('@electron/utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

let temp: string;
let peer: Awaited<ReturnType<typeof startIrcServer>> | undefined;
let client: IrcClient | undefined;
const writeConfig = (config: unknown) => writeFileSync(join(state.configDir, 'openclaw.json'), JSON.stringify(config));
const readIsolated = () => JSON.parse(readFileSync(join(state.userData, 'openclaw-source-state', 'openclaw.json'), 'utf8'));

beforeEach(() => {
  temp = state.temp;
  state.configDir = join(temp, 'config');
  state.runtimeDir = join(temp, 'runtime');
  state.userData = join(temp, 'app');
  for (const dir of Object.values(state)) mkdirSync(dir, { recursive: true });
  writeFileSync(join(state.runtimeDir, 'package.json'), '{}');
  writeFileSync(join(state.runtimeDir, 'entry.js'), '// launch entry existence only');
  vi.mocked(app.getPath).mockReturnValue(state.userData);
  vi.stubEnv('OPENCLAW_SKIP_CHANNELS', '');
  vi.stubEnv('OPENCLAW_SKIP_PROVIDERS', '');
  vi.stubEnv('OPENCLAW_SKIP_STARTUP_MODEL_PREWARM', '1');
});
afterEach(async () => {
  try {
    client?.close();
    await peer?.close();
  } finally {
    client = undefined;
    peer = undefined;
    vi.unstubAllEnvs();
    rmSync(temp, { recursive: true, force: true });
  }
});

it.each(['initial', 'sync'])('starts a configured channel through the %s desktop launch and real IRC transport', async (mode) => {
  peer = await startIrcServer();
  if (mode === 'sync') {
    writeConfig({});
    const emptyLaunch = await prepareGatewayLaunchContext(18789);
    expect(emptyLaunch.forkEnv.OPENCLAW_SKIP_CHANNELS).toBe('1');
    expect(readIsolated().plugins.enabled).toBe(false);
  }
  const channels = { irc: { enabled: true, host: '127.0.0.1', port: peer.port, tls: false, nick: 'rc10bot', channels: ['#rc10'] } };
  writeConfig({ channels });
  const launch = await prepareGatewayLaunchContext(18789);
  const cfg = readIsolated();
  expect(launch.runtimeMode).toBe('source');
  expect(launch.forkEnv.OPENCLAW_SKIP_CHANNELS).toBe('');
  expect(launch.forkEnv.CLAWDBOT_SKIP_CHANNELS).toBe('');
  expect(resolve(launch.forkEnv.OPENCLAW_CONFIG_PATH!)).toBe(resolve(join(state.userData, 'openclaw-source-state', 'openclaw.json')));
  expect(cfg.channels).toEqual(channels);
  expect(cfg.plugins.enabled).toBe(true);
  vi.stubEnv('OPENCLAW_SKIP_CHANNELS', launch.forkEnv.OPENCLAW_SKIP_CHANNELS);
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  await startGatewaySidecars({
    cfg, pluginRegistry: { plugins: [] } as never, defaultWorkspaceDir: temp,
    deps: {} as never, log, logHooks: log, logChannels: log,
    shouldStartPluginServices: () => false,
    startChannels: async () => {
      const account = resolveIrcAccount({ cfg });
      expect(account.configured).toBe(true);
      client = await connectIrcClient(buildIrcConnectOptions(account, { channels: account.config.channels, connectTimeoutMs: 2000 }));
    },
  });
  expect(log.error).not.toHaveBeenCalled();
  expect(client?.isReady()).toBe(true);
  await vi.waitFor(() => expect(peer!.events).toContainEqual(expect.objectContaining({ event: 'join', nick: 'rc10bot', channel: '#rc10' })), { timeout: 2000, interval: 10 });
  client!.sendPrivmsg('#rc10', 'startup-integration-message');
  await vi.waitFor(() => expect(peer!.events).toContainEqual(expect.objectContaining({ event: 'privmsg', from: 'rc10bot', text: 'startup-integration-message' })), { timeout: 2000, interval: 10 });
});

it.each([{}, { channels: { irc: { enabled: false, host: '127.0.0.1', nick: 'disabled' } } }])('keeps channel startup skipped for absent or disabled config: %j', async (config) => {
  writeConfig(config);
  const launch = await prepareGatewayLaunchContext(18789);
  expect(launch.forkEnv.OPENCLAW_SKIP_CHANNELS).toBe('1');
  expect(readIsolated().plugins.enabled).toBe(false);
});
