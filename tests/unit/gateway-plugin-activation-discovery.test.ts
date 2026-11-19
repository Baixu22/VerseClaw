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
import { resolvePluginActivationSnapshot } from '../../openclaw_runtime/src/plugins/activation-context';
import { resolvePluginProviders } from '../../openclaw_runtime/src/plugins/providers.runtime';

const rediscover = vi.spyOn(discovery, 'discoverOpenClawPlugins');
const activate = (providedDiscovery?: PluginDiscoveryResult) => resolvePluginActivationSnapshot({
  rawConfig: {}, env: {}, applyAutoEnable: true, discovery: providedDiscovery,
});
beforeEach(() => {
  state.scope = 'current';
  vi.clearAllMocks();
  rediscover.mockReturnValue({ candidates: [], diagnostics: [] });
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

it('carries provider lookup discovery when the current snapshot has a different scope', () => {
  state.scope = 'none';
  const index = {
    version: 1, hostContractVersion: 'fixture', compatRegistryVersion: 'fixture',
    migrationVersion: 1, policyHash: 'fixture', generatedAtMs: 0,
    installRecords: {}, plugins: [], diagnostics: [],
  } satisfies InstalledPluginIndex;
  const snapshot = { index, ...state.snapshot };
  expect(resolvePluginProviders({ config: {}, env: {}, pluginMetadataSnapshot: snapshot })).toEqual([]);
  expect(rediscover).not.toHaveBeenCalled();
});
