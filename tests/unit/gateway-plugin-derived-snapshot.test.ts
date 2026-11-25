// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  code: 'persisted-registry-missing', useCurrent: true,
  index: { plugins: [{ pluginId: 'fixture', enabled: false }] },
  manifest: { plugins: [{ id: 'fixture' }], diagnostics: [] },
}));
vi.mock('../../openclaw_runtime/src/plugins/current-plugin-metadata-snapshot', () => ({
  getCurrentPluginMetadataSnapshot: () => state.useCurrent ? {
    registrySource: 'derived', index: state.index, manifestRegistry: state.manifest,
    registryDiagnostics: [{ code: state.code, level: 'info', message: 'Persisted input repaired by discovery' }],
  } : undefined,
}));

import * as persisted from '../../openclaw_runtime/src/plugins/installed-plugin-index-store';
import * as installed from '../../openclaw_runtime/src/plugins/manifest-registry-installed';
import { loadPluginRegistrySnapshotWithMetadata } from '../../openclaw_runtime/src/plugins/plugin-registry-snapshot';
import { loadPluginManifestRegistryForPluginRegistry } from '../../openclaw_runtime/src/plugins/plugin-registry-contributions';
const readPersisted = vi.spyOn(persisted, 'readPersistedInstalledPluginIndexSync').mockImplementation(() => {
  throw new Error('Unexpected persisted index reread');
});
const readManifest = vi.spyOn(installed, 'loadPluginManifestRegistryForInstalledIndex').mockImplementation(() => {
  throw new Error('Unexpected plugin manifest reread');
});
beforeEach(() => { state.useCurrent = true; vi.clearAllMocks(); });

it.each(['persisted-registry-missing', 'persisted-registry-stale-policy', 'persisted-registry-stale-source', 'persisted-registry-disabled'])(
  'reuses resolved current metadata after %s', code => {
    state.code = code;
    const result = loadPluginRegistrySnapshotWithMetadata();
    expect(result.snapshot).toBe(state.index);
    expect(result.diagnostics[0].code).toBe(code);
    expect(loadPluginManifestRegistryForPluginRegistry({ includeDisabled: true }).plugins).toEqual(state.manifest.plugins);
    expect(readPersisted).not.toHaveBeenCalled();
    expect(readManifest).not.toHaveBeenCalled();
  },
);

it('keeps the existing lookup path when the owner rejects the current context', () => {
  state.useCurrent = false;
  expect(loadPluginRegistrySnapshotWithMetadata).toThrow('Unexpected persisted index reread');
  expect(readPersisted).toHaveBeenCalled();
});
