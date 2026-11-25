// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { resolve } from 'node:path';
import type { InstalledPluginIndex } from '../../openclaw_runtime/src/plugins/installed-plugin-index-types';
import { resolveInstalledPluginIndexPolicyHash } from '../../openclaw_runtime/src/plugins/installed-plugin-index-policy';
import { loadPluginMetadataSnapshot } from '../../openclaw_runtime/src/plugins/plugin-metadata-snapshot';
import { clearCurrentPluginMetadataSnapshot, setCurrentPluginMetadataSnapshot } from '../../openclaw_runtime/src/plugins/current-plugin-metadata-snapshot';

const state = vi.hoisted(() => ({ ensure: vi.fn() }));
vi.mock('../../openclaw_runtime/src/plugins/runtime/standalone-runtime-registry-loader', () => ({
  ensureStandaloneRuntimePluginRegistryLoaded: state.ensure,
}));
import { ensureRuntimePluginsLoaded } from '../../openclaw_runtime/src/agents/runtime-plugins';

const config = {};
const workspaceDir = resolve('.');
const index = {
  version: 1, migrationVersion: 1, hostContractVersion: 'fixture', compatRegistryVersion: 'fixture',
  policyHash: resolveInstalledPluginIndexPolicyHash(config), generatedAtMs: 0,
  installRecords: {}, plugins: [], diagnostics: [],
} satisfies InstalledPluginIndex;
const base = loadPluginMetadataSnapshot({ config, index, workspaceDir, pluginIds: [] });
beforeEach(() => {
  vi.clearAllMocks();
  state.ensure.mockImplementation(() => undefined);
  const snapshot = { ...base, startup: { pluginIds: [] } };
  setCurrentPluginMetadataSnapshot(snapshot, { config, workspaceDir });
});
afterEach(() => clearCurrentPluginMetadataSnapshot());

it.each([
  { pluginIds: [] },
  { pluginIds: ['fixture-a', 'fixture-b'] },
])('carries the complete compatible Gateway startup scope $pluginIds', ({ pluginIds }) => {
  const snapshot = { ...base, pluginIds, startup: { pluginIds } };
  setCurrentPluginMetadataSnapshot(snapshot, { config, workspaceDir });
  state.ensure.mockImplementation((params: { requiredPluginIds?: string[] }) => {
    if (params.requiredPluginIds === undefined) throw new Error('Unexpected unscoped plugin reload');
  });
  ensureRuntimePluginsLoaded({ config, workspaceDir, allowGatewaySubagentBinding: true });
  expect(state.ensure).toHaveBeenCalledWith(expect.objectContaining({
    requiredPluginIds: pluginIds, loadOptions: expect.objectContaining({ onlyPluginIds: pluginIds }),
  }));
});

it('retains standalone resolution when the workspace differs', () => {
  ensureRuntimePluginsLoaded({ config, workspaceDir: resolve(workspaceDir, 'other'), allowGatewaySubagentBinding: true });
  expect(state.ensure).toHaveBeenCalledWith(expect.objectContaining({ requiredPluginIds: undefined }));
});

it('retains standalone resolution when current metadata has no startup plan', () => {
  setCurrentPluginMetadataSnapshot(base, { config, workspaceDir });
  ensureRuntimePluginsLoaded({ config, workspaceDir, allowGatewaySubagentBinding: true });
  expect(state.ensure).toHaveBeenCalledWith(expect.objectContaining({ requiredPluginIds: undefined }));
});
