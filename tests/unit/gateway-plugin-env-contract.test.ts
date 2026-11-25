// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getCurrentManifestModelIdNormalizationPolicies } from '@openclaw/model-catalog-core/provider-model-id-normalization';
import {
  captureCurrentPluginMetadataSnapshotState, clearCurrentPluginMetadataSnapshot,
  getCurrentPluginMetadataSnapshot, restoreCurrentPluginMetadataSnapshotState,
  setCurrentPluginMetadataSnapshot,
} from '../../openclaw_runtime/src/plugins/current-plugin-metadata-snapshot';
import * as installed from '../../openclaw_runtime/src/plugins/installed-plugin-index';
import type { InstalledPluginIndex } from '../../openclaw_runtime/src/plugins/installed-plugin-index-types';
import * as manifests from '../../openclaw_runtime/src/plugins/manifest-registry-installed';
import { loadPluginMetadataSnapshot } from '../../openclaw_runtime/src/plugins/plugin-metadata-snapshot';
import { loadPluginManifestRegistryForPluginRegistry } from '../../openclaw_runtime/src/plugins/plugin-registry-contributions';
import { loadPluginRegistrySnapshotWithMetadata } from '../../openclaw_runtime/src/plugins/plugin-registry-snapshot';

const root = mkdtempSync(join(tmpdir(), 'clawx-plugin-environment-'));
for (const name of ['bundled-a', 'bundled-b']) mkdirSync(join(root, name));
const config = {};
const env: NodeJS.ProcessEnv = {
  ...process.env, OPENCLAW_HOME: join(root, 'home-a'), OPENCLAW_STATE_DIR: undefined,
  OPENCLAW_CONFIG_PATH: undefined, OPENCLAW_BUNDLED_PLUGINS_DIR: join(root, 'bundled-a'),
  OPENCLAW_TEST_TRUST_BUNDLED_PLUGINS_DIR: '1', OPENCLAW_DISABLE_BUNDLED_PLUGINS: undefined,
  OPENCLAW_DISABLE_PERSISTED_PLUGIN_REGISTRY: undefined,
  OPENCLAW_DISABLE_BUNDLED_SOURCE_OVERLAYS: undefined, OPENCLAW_NIX_MODE: undefined,
  OPENCLAW_COMPATIBILITY_HOST_VERSION: undefined,
};
const index: InstalledPluginIndex = {
  version: 1, migrationVersion: 1, hostContractVersion: 'test', compatRegistryVersion: 'test',
  policyHash: installed.resolveInstalledPluginIndexPolicyHash(config), generatedAtMs: 0,
  installRecords: {}, plugins: [], diagnostics: [],
};
const snapshot = loadPluginMetadataSnapshot({ config, env, index });
beforeEach(() => setCurrentPluginMetadataSnapshot(snapshot, { config, env }));
afterEach(() => { clearCurrentPluginMetadataSnapshot(); vi.restoreAllMocks(); });
afterAll(() => {
  if (dirname(resolve(root)) !== resolve(tmpdir())) throw new Error('Unexpected temporary root');
  rmSync(root, { recursive: true, force: true });
});

it.each([
  ['OPENCLAW_BUNDLED_PLUGINS_DIR', 'bundled-b'],
  ['OPENCLAW_STATE_DIR', 'state-b'],
  ['OPENCLAW_HOME', 'home-b'],
])('rejects changed %s with the same config object or an omitted config', (key, value) => {
  const changed = { ...env, [key]: join(root, value) };
  expect(getCurrentPluginMetadataSnapshot({ config, env })).toBe(snapshot);
  expect(getCurrentPluginMetadataSnapshot({ config, env: changed })).toBeUndefined();
  expect(getCurrentPluginMetadataSnapshot({ env: changed })).toBeUndefined();
});

it('preserves the original environment binding across capture and restore', () => {
  const saved = captureCurrentPluginMetadataSnapshotState();
  clearCurrentPluginMetadataSnapshot();
  restoreCurrentPluginMetadataSnapshotState(saved);
  expect(getCurrentPluginMetadataSnapshot({ config, env })).toBe(snapshot);
  expect(getCurrentPluginMetadataSnapshot({ env: { ...env, OPENCLAW_HOME: join(root, 'home-b') } })).toBeUndefined();
});

it('requires the original custom load paths even for a compatible config identity', () => {
  const custom = { plugins: { load: { paths: [join(root, 'custom')] } } };
  const metadata = loadPluginMetadataSnapshot({ config: custom, env, index });
  setCurrentPluginMetadataSnapshot(metadata, { config: custom, compatibleConfigs: [config], env });
  expect(getCurrentPluginMetadataSnapshot({ config: custom, env })).toBe(metadata);
  expect(getCurrentPluginMetadataSnapshot({ config, env })).toBeUndefined();
  expect(getCurrentPluginMetadataSnapshot({ env })).toBeUndefined();
});

it.each([
  ['OPENCLAW_DISABLE_BUNDLED_SOURCE_OVERLAYS', '1'],
  ['OPENCLAW_NIX_MODE', '1'],
  ['OPENCLAW_COMPATIBILITY_HOST_VERSION', '2099.1.1'],
])('rejects changed %s even when plugin roots and config identity stay the same', (key, value) => {
  const changed = { ...env, [key]: value };
  expect(getCurrentPluginMetadataSnapshot({ config, env })).toBe(snapshot);
  expect(getCurrentPluginMetadataSnapshot({ config, env: changed })).toBeUndefined();
  expect(getCurrentPluginMetadataSnapshot({ env: changed })).toBeUndefined();
});

it('restores model normalization metadata with its captured discovery context', () => {
  const policies = getCurrentManifestModelIdNormalizationPolicies();
  expect(policies).toBeDefined();
  const saved = captureCurrentPluginMetadataSnapshotState();
  clearCurrentPluginMetadataSnapshot();
  expect(getCurrentManifestModelIdNormalizationPolicies()).toBeUndefined();
  restoreCurrentPluginMetadataSnapshotState(saved);
  expect(getCurrentManifestModelIdNormalizationPolicies()).toEqual(policies);
});

it('uses the derived path and disabled diagnostic when the environment disables persisted reads', () => {
  const derive = vi.spyOn(installed, 'loadInstalledPluginIndexWithDiscovery');
  const manifestRead = vi.spyOn(manifests, 'loadPluginManifestRegistryForInstalledIndex');
  const disabled = { ...env, OPENCLAW_DISABLE_PERSISTED_PLUGIN_REGISTRY: '1' };
  const result = loadPluginRegistrySnapshotWithMetadata({ config, env: disabled });
  expect(result.source).toBe('derived');
  expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'persisted-registry-disabled' })]);
  expect(derive).toHaveBeenCalled();
  loadPluginManifestRegistryForPluginRegistry({ config, env: disabled });
  expect(manifestRead).toHaveBeenCalled();
});

it.each(['0', 'false', 'no'])('keeps current metadata for the disabled-switch value %s', value => {
  const derive = vi.spyOn(installed, 'loadInstalledPluginIndexWithDiscovery');
  expect(loadPluginRegistrySnapshotWithMetadata({ config, env: { ...env, OPENCLAW_DISABLE_PERSISTED_PLUGIN_REGISTRY: value } }).snapshot).toBe(snapshot.index);
  expect(derive).not.toHaveBeenCalled();
});
