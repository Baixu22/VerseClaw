// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { OpenClawConfig } from '../../openclaw_runtime/src/config/types.openclaw';
import type { PluginLoadOptions } from '../../openclaw_runtime/src/plugins/loader';
import {
  clearRuntimeConfigSnapshot,
  setRuntimeConfigSnapshot,
} from '../../openclaw_runtime/src/config/runtime-snapshot';

const state = vi.hoisted(() => ({
  snapshot: {
    startup: { pluginIds: ['fixture-plugin'] },
    manifestRegistry: { plugins: [], diagnostics: [] },
    index: { installRecords: {} },
    discovery: { candidates: [], diagnostics: [] },
  } as {
    startup: { pluginIds: string[] };
    manifestRegistry: { plugins: unknown[]; diagnostics: unknown[] };
    index: { installRecords: Record<string, never> };
    discovery: { candidates: unknown[]; diagnostics: unknown[] };
  } | undefined,
  reasons: { 'fixture-plugin': ['configured provider'] },
  autoEnable: vi.fn(),
  ensure: vi.fn(),
}));
vi.mock('../../openclaw_runtime/src/plugins/current-plugin-metadata-snapshot', () => ({
  getCurrentPluginMetadataSnapshot: () => state.snapshot,
}));
vi.mock('../../openclaw_runtime/src/plugins/runtime/standalone-runtime-registry-loader', () => ({
  ensureStandaloneRuntimePluginRegistryLoaded: state.ensure,
}));
vi.mock('../../openclaw_runtime/src/plugins/runtime', () => ({
  getActivePluginRuntimeSubagentMode: () => 'gateway-bindable',
}));
vi.mock('../../openclaw_runtime/src/config/plugin-auto-enable', () => ({
  applyPluginAutoEnable: state.autoEnable,
}));
import { ensureRuntimePluginsLoaded } from '../../openclaw_runtime/src/agents/runtime-plugins';

const runtimeConfig: OpenClawConfig = {};
const sourceConfig: OpenClawConfig = { plugins: { entries: { 'fixture-plugin': {} } } };
beforeEach(() => {
  vi.clearAllMocks();
  setRuntimeConfigSnapshot(runtimeConfig, sourceConfig);
  state.snapshot = {
    startup: { pluginIds: ['fixture-plugin'] },
    manifestRegistry: { plugins: [], diagnostics: [] },
    index: { installRecords: {} },
    discovery: { candidates: [], diagnostics: [] },
  };
  state.autoEnable.mockImplementation(({ config }: { config: OpenClawConfig }) => ({
    config, changes: [], autoEnabledReasons: state.reasons,
  }));
  state.ensure.mockImplementation(() => undefined);
});
afterEach(() => clearRuntimeConfigSnapshot());

it('qualifies the prepared registry with source activation reasons and install records', () => {
  state.ensure.mockImplementation(({ loadOptions }: { loadOptions: PluginLoadOptions }) => {
    if (loadOptions.activationSourceConfig !== sourceConfig ||
        loadOptions.autoEnabledReasons !== state.reasons) {
      throw new Error('activation metadata mismatch would reload the startup registry');
    }
  });
  expect(() => ensureRuntimePluginsLoaded({
    config: runtimeConfig, workspaceDir: '.', allowGatewaySubagentBinding: true,
  })).not.toThrow();
  expect(state.autoEnable).toHaveBeenCalledWith(expect.objectContaining({
    config: sourceConfig, manifestRegistry: state.snapshot?.manifestRegistry,
    discovery: state.snapshot?.discovery,
  }));
  expect(state.ensure).toHaveBeenCalledWith(expect.objectContaining({
    requiredPluginIds: ['fixture-plugin'],
    loadOptions: expect.objectContaining({
      config: runtimeConfig, activationSourceConfig: sourceConfig,
      autoEnabledReasons: state.reasons, installRecords: {},
      manifestRegistry: state.snapshot?.manifestRegistry,
    }),
  }));
});

it('keeps standalone loading when no prepared startup scope exists', () => {
  state.snapshot = undefined;
  ensureRuntimePluginsLoaded({ config: runtimeConfig, workspaceDir: '.' });
  expect(state.autoEnable).not.toHaveBeenCalled();
  expect(state.ensure).toHaveBeenCalledWith(expect.objectContaining({
    requiredPluginIds: undefined,
    loadOptions: expect.not.objectContaining({ activationSourceConfig: sourceConfig }),
  }));
});

it('does not resolve activation when plugins are disabled', () => {
  ensureRuntimePluginsLoaded({ config: { plugins: { enabled: false } } });
  expect(state.autoEnable).not.toHaveBeenCalled();
  expect(state.ensure).not.toHaveBeenCalled();
});
