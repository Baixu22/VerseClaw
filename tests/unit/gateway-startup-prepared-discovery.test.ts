// @vitest-environment node
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import type { OpenClawConfig } from '../../openclaw_runtime/src/config/types.openclaw';
import * as discovery from '../../openclaw_runtime/src/plugins/discovery';
import {
  createGatewayStartupMetadataPluginIdScope,
  loadGatewayStartupPluginPlan,
} from '../../openclaw_runtime/src/plugins/gateway-startup-plugin-ids';
import { loadPluginLookUpTable } from '../../openclaw_runtime/src/plugins/plugin-lookup-table';
import { loadPluginMetadataSnapshot } from '../../openclaw_runtime/src/plugins/plugin-metadata-snapshot';

const roots: string[] = [];
function makeFixture(id = 'g3-fixture') {
  const root = fs.mkdtempSync(path.join(tmpdir(), 'g3-prepared-discovery-'));
  roots.push(root);
  const bundled = path.join(root, 'bundled');
  const plugin = path.join(bundled, id);
  fs.mkdirSync(plugin, { recursive: true });
  fs.writeFileSync(path.join(plugin, 'package.json'), JSON.stringify({
    name: id, version: '0.0.1', type: 'module',
    openclaw: { extensions: ['./index.js'], channel: { id: 'slack' } },
  }));
  fs.writeFileSync(path.join(plugin, 'openclaw.plugin.json'), JSON.stringify({
    id, channels: ['slack'], configSchema: { type: 'object', properties: {} },
  }));
  fs.writeFileSync(path.join(plugin, 'index.js'), 'export default { register() {} };');
  const env: NodeJS.ProcessEnv = {
    VITEST: '1', HOME: root, USERPROFILE: root, APPDATA: root, OPENCLAW_HOME: root,
    OPENCLAW_STATE_DIR: path.join(root, 'state'),
    OPENCLAW_CONFIG_PATH: path.join(root, 'openclaw.json'),
    OPENCLAW_BUNDLED_PLUGINS_DIR: bundled,
    OPENCLAW_TEST_TRUST_BUNDLED_PLUGINS_DIR: '1',
    OPENCLAW_DISABLE_BUNDLED_SOURCE_OVERLAYS: '1',
  };
  const config: OpenClawConfig = {
    plugins: {
      allow: [id], entries: { [id]: { enabled: true } },
      slots: { memory: 'none', contextEngine: 'legacy' },
    },
    channels: { slack: { botToken: 'fixture' } },
  };
  const pluginIdScope = createGatewayStartupMetadataPluginIdScope({ config, env });
  const metadataSnapshot = loadPluginMetadataSnapshot({
    config, env, workspaceDir: root, preferPersisted: false, pluginIdScope,
  });
  expect(metadataSnapshot.discovery).toBeDefined();
  expect(metadataSnapshot.manifestRegistry.plugins.map(plugin => plugin.id)).toContain(id);
  return { root, env, config, metadataSnapshot };
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) {
    if (path.dirname(root) !== path.resolve(tmpdir())) throw new Error('Unexpected fixture root');
    fs.rmSync(root, { recursive: true, force: true });
  }
});

const loaders = [
  { name: 'startup plan', load: loadGatewayStartupPluginPlan },
  {
    name: 'lookup table',
    load: (params: Parameters<typeof loadGatewayStartupPluginPlan>[0]) =>
      loadPluginLookUpTable(params).startup,
  },
];

it.each(loaders)('$name reuses prepared discovery and returns the configured plugin', ({ load }) => {
  const fixture = makeFixture();
  const discover = vi.spyOn(discovery, 'discoverOpenClawPlugins');
  const plan = load({ ...fixture, workspaceDir: fixture.root });
  expect(plan.channelPluginIds).toContain('g3-fixture');
  expect(plan.pluginIds).toContain('g3-fixture');
  expect(discover).not.toHaveBeenCalled();
});

it.each(loaders)('$name discovers when the compatible snapshot lacks discovery', ({ load }) => {
  const fixture = makeFixture();
  const discover = vi.spyOn(discovery, 'discoverOpenClawPlugins');
  const plan = load({
    ...fixture, workspaceDir: fixture.root,
    metadataSnapshot: { ...fixture.metadataSnapshot, discovery: undefined },
  });
  expect(plan.pluginIds).toContain('g3-fixture');
  expect(discover).toHaveBeenCalled();
});

it.each(loaders)('$name uses new plugin roots when the snapshot no longer matches', ({ load }) => {
  const original = makeFixture('g3-old');
  const next = makeFixture('g3-new');
  const discover = vi.spyOn(discovery, 'discoverOpenClawPlugins');
  const plan = load({
    config: next.config, env: next.env, workspaceDir: next.root,
    metadataSnapshot: original.metadataSnapshot,
  });
  expect(plan.pluginIds).toContain('g3-new');
  expect(plan.pluginIds).not.toContain('g3-old');
  expect(discover).toHaveBeenCalled();
});
