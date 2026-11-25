// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { listPotentialEnabledChannelIds } from '../../openclaw_runtime/src/channels/config-presence';
import {
  createConfigValidationMetadataPluginIdScope,
  createGatewayStartupMetadataPluginIdScope,
} from '../../openclaw_runtime/src/plugins/gateway-startup-plugin-ids';
import type { InstalledPluginIndex } from '../../openclaw_runtime/src/plugins/installed-plugin-index-types';

vi.mock('../../openclaw_runtime/src/channels/config-presence', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../openclaw_runtime/src/channels/config-presence')>();
  return { ...actual, listPotentialEnabledChannelIds: vi.fn(actual.listPotentialEnabledChannelIds) };
});

const index: InstalledPluginIndex = {
  version: 1, migrationVersion: 1, hostContractVersion: 'test', compatRegistryVersion: 'test',
  policyHash: 'test', generatedAtMs: 0, installRecords: {}, diagnostics: [],
  plugins: ['channel-a', 'channel-b'].map(pluginId => ({
    pluginId, rootDir: pluginId, manifestPath: `${pluginId}/openclaw.plugin.json`, manifestHash: 'test',
    origin: 'bundled', enabled: true, compat: [],
    startup: { sidecar: false, memory: false, deferConfiguredChannelFullLoadUntilAfterListen: false, agentHarnesses: [], configPaths: [] },
  })),
};

it.each([
  createConfigValidationMetadataPluginIdScope,
  createGatewayStartupMetadataPluginIdScope,
])('%p resolves from the channel signals captured in its lookup key', (createScope) => {
  const scan = vi.mocked(listPotentialEnabledChannelIds);
  scan.mockClear();
  scan.mockImplementation((_config, env) => env?.CHANNEL_TEST ? [env.CHANNEL_TEST] : []);
  const config = { plugins: { allow: ['channel-a'], slots: { memory: 'none' } } };
  const env = { CHANNEL_TEST: 'channel-a' };
  const scope = createScope({ config, env });
  expect(scope.resolve({ index })).toEqual(['channel-a']);
  env.CHANNEL_TEST = 'channel-b';
  expect(scope.resolve({ index })).toEqual(['channel-a']);
  expect(scan).toHaveBeenCalledTimes(1);

  const next = createScope({ config, env });
  expect(next.key).not.toBe(scope.key);
  expect(next.resolve({ index })).toContain('channel-b');
  expect(scan).toHaveBeenCalledTimes(2);
});
