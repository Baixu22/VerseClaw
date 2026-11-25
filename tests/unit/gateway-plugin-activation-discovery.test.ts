// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import type { PluginDiscoveryResult } from '../../openclaw_runtime/src/plugins/discovery';
import type { InstalledPluginIndex } from '../../openclaw_runtime/src/plugins/installed-plugin-index-types';

const state = vi.hoisted(() => ({
  scope: 'current' as 'current' | 'default' | 'none',
  snapshot: {
    discovery: { candidates: [], diagnostics: [] } satisfies PluginDiscoveryResult,
    manifestRegistry: { plugins: [], diagnostics: [] },
  },
}));
vi.mock('../../openclaw_runtime/src/plugins/current-plugin-metadata-snapshot', () => ({
  getCurrentPluginMetadataSnapshot: (params: { requireDefaultDiscoveryContext?: boolean }) => {
    const scope = params.requireDefaultDiscoveryContext ? 'default' : 'current';
    return state.scope === scope ? state.snapshot : undefined;
  },
}));

import * as discovery from '../../openclaw_runtime/src/plugins/discovery';
import * as metadata from '../../openclaw_runtime/src/plugins/plugin-metadata-snapshot';
import { resolvePluginActivationSnapshot } from '../../openclaw_runtime/src/plugins/activation-context';
import { resolvePluginProviders } from '../../openclaw_runtime/src/plugins/providers.runtime';

const rediscover = vi.spyOn(discovery, 'discoverOpenClawPlugins');
const reloadMetadata = vi.spyOn(metadata, 'loadPluginMetadataSnapshot');
const activate = (providedDiscovery?: PluginDiscoveryResult) => resolvePluginActivationSnapshot({
  rawConfig: {}, env: {}, applyAutoEnable: true, discovery: providedDiscovery,
});
beforeEach(() => {
  state.scope = 'current';
  vi.clearAllMocks();
  rediscover.mockReturnValue({ candidates: [], diagnostics: [] });
  reloadMetadata.mockImplementation(() => { throw new Error('Unexpected plugin metadata reload'); });
});

it.each(['current', 'default'] as const)('reuses %s snapshot discovery for repeated plugin activation', scope => {
  state.scope = scope;
  expect(activate().config).toEqual({});
  expect(activate().config).toEqual({});
  expect(rediscover).not.toHaveBeenCalled();
});

it('uses fresh discovery when the snapshot owner rejects the requested context', () => {
  state.scope = 'none';
  expect(activate().config).toEqual({});
  expect(rediscover).toHaveBeenCalled();
});

it('uses explicitly supplied discovery without requiring a current snapshot', () => {
  state.scope = 'none';
  expect(activate({ candidates: [], diagnostics: [] }).config).toEqual({});
  expect(rediscover).not.toHaveBeenCalled();
});

it.each([
  ['with discovery', true],
  ['without discovery', false],
] as const)('reuses provider-prepared metadata %s after a current-snapshot scope mismatch', (_name, hasDiscovery) => {
  state.scope = 'none';
  const index = {
    version: 1, hostContractVersion: 'fixture', compatRegistryVersion: 'fixture',
    migrationVersion: 1, policyHash: 'fixture', generatedAtMs: 0,
    installRecords: {}, plugins: [], diagnostics: [],
  } satisfies InstalledPluginIndex;
  const snapshot = {
    index, manifestRegistry: state.snapshot.manifestRegistry,
    discovery: hasDiscovery ? state.snapshot.discovery : undefined,
  };
  const config = { agents: { defaults: { model: { primary: 'fixture-provider/fixture-model' } } } };
  expect(resolvePluginProviders({ config, env: {}, pluginMetadataSnapshot: snapshot })).toEqual([]);
  if (hasDiscovery) expect(rediscover).not.toHaveBeenCalled();
  else expect(rediscover).toHaveBeenCalled();
  expect(reloadMetadata).not.toHaveBeenCalled();
});
