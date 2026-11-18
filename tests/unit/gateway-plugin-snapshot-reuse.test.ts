// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterAll, beforeEach, expect, it, vi } from 'vitest';
import type { PluginManifestRecord } from '../../openclaw_runtime/src/plugins/manifest-registry';

type FixturePlugin = Pick<PluginManifestRecord, 'id' | 'source' | 'rootDir' | 'origin' | 'providers' | 'modelCatalog'>;
const state = vi.hoisted(() => ({
  plugins: [] as FixturePlugin[], useCurrent: true,
  discover: vi.fn(() => { throw new Error('Repeated broad plugin discovery'); }),
  fallback: vi.fn(() => ({ plugins: [] })),
}));
vi.mock('../../openclaw_runtime/src/config/config', () => ({ getRuntimeConfig: () => ({}) }));
vi.mock('../../openclaw_runtime/src/plugins/manifest-registry', () => ({ loadPluginManifestRegistry: state.discover }));
vi.mock('../../openclaw_runtime/src/plugins/current-plugin-metadata-snapshot', () => ({
  getCurrentPluginMetadataSnapshot: () => state.useCurrent ? {
    registryDiagnostics: [],
    plugins: state.plugins,
    manifestRegistry: { plugins: state.plugins, diagnostics: [] },
    index: { plugins: state.plugins.map(plugin => ({ pluginId: plugin.id, enabled: false })) },
  } : undefined,
}));
vi.mock('../../openclaw_runtime/src/plugins/plugin-registry-snapshot', () => ({
  loadPluginRegistrySnapshot: state.fallback, canReuseCurrentPluginMetadataSnapshot: () => true,
}));
vi.mock('../../openclaw_runtime/src/plugins/manifest-registry-installed', () => ({
  loadPluginManifestRegistryForInstalledIndex: () => ({ plugins: state.plugins, diagnostics: [] }),
}));

import { bundledStaticCatalogProviderUsesRuntimeAugment, canonicalizeManifestModelCatalogProviderAlias, resolveBundledStaticCatalogModel } from '../../openclaw_runtime/src/agents/embedded-agent-runner/model.static-catalog';
import { resolvePluginRuntimeRecord, resolvePluginRuntimeRecordByEntryBaseNames } from '../../openclaw_runtime/src/plugins/runtime/runtime-plugin-boundary';

const root = mkdtempSync(join(tmpdir(), 'clawx-plugin-snapshot-'));
writeFileSync(join(root, 'runtime-api.js'), 'export const ready = true;');
function fixture(id: string, provider = 'fixture-provider'): FixturePlugin {
  return { id, source: join(root, id + '.js'), rootDir: root, origin: 'bundled', providers: [provider],
    modelCatalog: { aliases: { 'fixture-alias': { provider } }, runtimeAugment: true,
      discovery: { [provider]: 'static' },
      providers: { [provider]: { models: [{ id: 'fixture-model', contextWindow: 4096, maxTokens: 512 }] } } } };
}
beforeEach(() => {
  state.plugins = [fixture('fixture')]; state.useCurrent = true; vi.clearAllMocks();
});
afterAll(() => {
  if (dirname(resolve(root)) !== resolve(tmpdir())) throw new Error('Unexpected temporary root');
  rmSync(root, { recursive: true, force: true });
});

it('resolves runtime entries and aliases from the current snapshot including disabled metadata', () => {
  expect(resolvePluginRuntimeRecord('fixture')).toMatchObject({ source: join(root, 'fixture.js') });
  expect(resolvePluginRuntimeRecordByEntryBaseNames(['runtime-api'])).toMatchObject({ rootDir: root });
  expect(canonicalizeManifestModelCatalogProviderAlias({ provider: 'fixture-alias' })).toBe('fixture-provider');
  expect(resolveBundledStaticCatalogModel({ provider: 'fixture-provider', modelId: 'fixture-model' })).toMatchObject({ id: 'fixture-model', contextWindow: 4096, maxTokens: 512 });
  expect(bundledStaticCatalogProviderUsesRuntimeAugment({ provider: 'fixture-provider' })).toBe(true);
  expect(state.discover).not.toHaveBeenCalled();
  expect(state.fallback).not.toHaveBeenCalled();
});

it('uses the existing installed registry when no compatible current snapshot is available', () => {
  state.useCurrent = false;
  expect(resolvePluginRuntimeRecord('fixture')).toMatchObject({ source: join(root, 'fixture.js') });
  expect(canonicalizeManifestModelCatalogProviderAlias({ provider: 'fixture-alias' })).toBe('fixture-provider');
  expect(state.fallback).toHaveBeenCalled();
});

it('keeps missing and ambiguous plugin identities fenced', () => {
  state.plugins.push(fixture('other', 'other-provider'));
  expect(resolvePluginRuntimeRecord('missing')).toBeNull();
  expect(resolvePluginRuntimeRecordByEntryBaseNames.bind(null, ['runtime-api'])).toThrow('ambiguous');
  expect(canonicalizeManifestModelCatalogProviderAlias({ provider: 'fixture-alias' })).toBe('fixture-alias');
});

it('filters external catalogs and requires opt-in for runtime-discovery model rows', () => {
  const bundled = fixture('fixture');
  bundled.modelCatalog = { ...bundled.modelCatalog, discovery: { 'fixture-provider': 'runtime' } };
  state.plugins = [{ ...fixture('external', 'external-provider'), origin: 'global' }, bundled];
  expect(resolveBundledStaticCatalogModel({ provider: 'external-provider', modelId: 'fixture-model' })).toBeUndefined();
  expect(resolveBundledStaticCatalogModel({ provider: 'fixture-provider', modelId: 'fixture-model' })).toBeUndefined();
  expect(resolveBundledStaticCatalogModel({ provider: 'fixture-provider', modelId: 'fixture-model', includeRuntimeDiscovery: true })).toMatchObject({ id: 'fixture-model' });
});
