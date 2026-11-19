// @vitest-environment node
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import type { OpenClawConfig } from '../../openclaw_runtime/src/config/types.openclaw';
import * as discovery from '../../openclaw_runtime/src/plugins/discovery';
import { clearCurrentPluginMetadataSnapshot, setCurrentPluginMetadataSnapshot } from '../../openclaw_runtime/src/plugins/current-plugin-metadata-snapshot';
import { loadPluginMetadataSnapshot } from '../../openclaw_runtime/src/plugins/plugin-metadata-snapshot';
import { listReadOnlyChannelPluginsForConfig } from '../../openclaw_runtime/src/channels/plugins/read-only';
import { resolveConfiguredChannelPresencePolicy } from '../../openclaw_runtime/src/plugins/channel-presence-policy';
import { listPotentialEnabledChannelIds } from '../../openclaw_runtime/src/channels/config-presence';

vi.mock('../../openclaw_runtime/src/channels/plugins/index', async original => ({
  ...await original<typeof import('../../openclaw_runtime/src/channels/plugins/index')>(),
  listChannelPlugins: () => [],
}));
const roots: string[] = [];
function fixture(name = 'prepared fixture', channel: Record<string, unknown> | undefined = { botToken: 'fixture' }) {
  const root = fs.mkdtempSync(path.join(tmpdir(), 'g3-readonly-discovery-'));
  roots.push(root);
  const bundled = path.join(root, 'bundled'), plugin = path.join(bundled, 'g3-fixture');
  fs.mkdirSync(plugin, { recursive: true });
  fs.mkdirSync(path.join(root, 'state'));
  fs.writeFileSync(path.join(plugin, 'package.json'), JSON.stringify({ name: 'g3-fixture', version: '0.0.1', type: 'module', openclaw: { extensions: ['./index.js'], channel: { id: 'slack', persistedAuthState: { specifier: './state.cjs', exportName: 'hasState' } } } }));
  fs.writeFileSync(path.join(plugin, 'openclaw.plugin.json'), JSON.stringify({ id: 'g3-fixture', name, channels: ['slack'], configSchema: { type: 'object', properties: {} } }));
  fs.writeFileSync(path.join(plugin, 'index.js'), 'throw new Error("Plugin runtime must stay lazy");');
  fs.writeFileSync(path.join(plugin, 'state.cjs'), 'exports.hasState = ({env}) => env.FIXTURE_AUTH === "yes";');
  const env: NodeJS.ProcessEnv = { VITEST: '1', HOME: root, USERPROFILE: root, APPDATA: root, OPENCLAW_HOME: root, OPENCLAW_STATE_DIR: path.join(root, 'state'), OPENCLAW_CONFIG_PATH: path.join(root, 'openclaw.json'), OPENCLAW_BUNDLED_PLUGINS_DIR: bundled, OPENCLAW_TEST_TRUST_BUNDLED_PLUGINS_DIR: '1', OPENCLAW_DISABLE_BUNDLED_SOURCE_OVERLAYS: '1' };
  const config: OpenClawConfig = { plugins: { allow: ['g3-fixture'], entries: { 'g3-fixture': { enabled: true } }, slots: { memory: 'none' } }, channels: channel === undefined ? {} : { slack: channel } };
  const snapshot = loadPluginMetadataSnapshot({ config, env, workspaceDir: root, preferPersisted: false });
  expect(snapshot.discovery).toBeDefined();
  expect(snapshot.plugins.map(plugin => plugin.id)).toContain('g3-fixture');
  const options = { env, workspaceDir: root };
  setCurrentPluginMetadataSnapshot(snapshot, { config, env, workspaceDir: root });
  return { root, config, env, snapshot, options };
}
afterEach(() => {
  clearCurrentPluginMetadataSnapshot();
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) {
    if (path.dirname(root) !== path.resolve(tmpdir())) throw new Error('Unexpected fixture root');
    fs.rmSync(root, { recursive: true, force: true });
  }
});

it.each([false, true])('borrows prepared discovery with a distinct activation source: %s', distinct => {
  const f = fixture();
  const discover = vi.spyOn(discovery, 'discoverOpenClawPlugins');
  const plugins = listReadOnlyChannelPluginsForConfig(f.config, { ...f.options, activationSourceConfig: distinct ? { ...f.config } : f.config });
  expect(plugins.map(plugin => plugin.id)).toContain('slack');
  expect(discover).not.toHaveBeenCalled();
});
it('falls back when the compatible current snapshot has no discovery', () => {
  const f = fixture();
  setCurrentPluginMetadataSnapshot({ ...f.snapshot, discovery: undefined }, { config: f.config, env: f.env, workspaceDir: f.root });
  const discover = vi.spyOn(discovery, 'discoverOpenClawPlugins');
  expect(listReadOnlyChannelPluginsForConfig(f.config, f.options).map(plugin => plugin.id)).toContain('slack');
  expect(discover).toHaveBeenCalled();
});
it('loads the new roots when current metadata belongs to another request', () => {
  const original = fixture('original fixture');
  const next = fixture('next fixture');
  setCurrentPluginMetadataSnapshot(original.snapshot, { config: original.config, env: original.env, workspaceDir: original.root });
  const discover = vi.spyOn(discovery, 'discoverOpenClawPlugins');
  const plugins = listReadOnlyChannelPluginsForConfig(next.config, next.options);
  expect(plugins.find(plugin => plugin.id === 'slack')?.meta.label).toBe('next fixture');
  expect(discover).toHaveBeenCalled();
});
it('keeps explicit channel disablement', () => {
  const f = fixture('disabled fixture', { enabled: false, botToken: 'fixture' });
  expect(listReadOnlyChannelPluginsForConfig(f.config, f.options)).toEqual([]);
});
it('keeps plugin denylist reasons when using prepared channel signals', () => {
  const f = fixture();
  const config: OpenClawConfig = { ...f.config, plugins: { ...f.config.plugins, deny: ['g3-fixture'] } };
  const rows = resolveConfiguredChannelPresencePolicy({ config, env: f.env, workspaceDir: f.root, manifestRecords: f.snapshot.plugins, discovery: f.snapshot.discovery });
  expect(rows).toEqual([{ channelId: 'slack', sources: ['explicit-config'], effective: false, pluginIds: [], blockedReasons: ['blocked-by-denylist'] }]);
  expect(listReadOnlyChannelPluginsForConfig(config, f.options)).toEqual([]);
});
it('keeps stored auth detection and its explicit exclusion', () => {
  const f = fixture('stored auth fixture');
  f.config.channels = {};
  f.env.FIXTURE_AUTH = 'yes';
  const snapshot = loadPluginMetadataSnapshot({ config: f.config, env: f.env, workspaceDir: f.root, preferPersisted: false });
  setCurrentPluginMetadataSnapshot(snapshot, { config: f.config, env: f.env, workspaceDir: f.root });
  const discover = vi.spyOn(discovery, 'discoverOpenClawPlugins');
  expect(listReadOnlyChannelPluginsForConfig(f.config, f.options).map(plugin => plugin.id)).toContain('slack');
  expect(listReadOnlyChannelPluginsForConfig(f.config, { ...f.options, includePersistedAuthState: false })).toEqual([]);
  expect(discover).not.toHaveBeenCalled();
});

it('keeps bundled auth when a configured load path overlaps its source directory', () => {
  const f = fixture('overlapping fixture');
  f.config.channels = {};
  f.config.plugins!.load = { paths: [path.join(f.root, 'bundled', 'g3-fixture')] };
  f.env.FIXTURE_AUTH = 'yes';
  const snapshot = loadPluginMetadataSnapshot({ config: f.config, env: f.env, workspaceDir: f.root, preferPersisted: false });
  expect(snapshot.discovery?.candidates.map(candidate => candidate.origin)).toEqual(['config']);
  setCurrentPluginMetadataSnapshot(snapshot, { config: f.config, env: f.env, workspaceDir: f.root });
  expect(listReadOnlyChannelPluginsForConfig(f.config, f.options).map(plugin => plugin.id)).toContain('slack');
});

it('keeps startup env signals when a configured load path shadows bundled origin', () => {
  const f = fixture('overlapping env fixture');
  f.config.channels = {};
  f.config.plugins!.load = { paths: [path.join(f.root, 'bundled', 'g3-fixture')] };
  f.env.SLACK_BOT_TOKEN = 'fixture';
  const snapshot = loadPluginMetadataSnapshot({ config: f.config, env: f.env, workspaceDir: f.root, preferPersisted: false });
  expect(snapshot.discovery?.candidates.map(candidate => candidate.origin)).toEqual(['config']);
  expect(listPotentialEnabledChannelIds(f.config, f.env, snapshot.discovery)).toEqual(['slack']);
});
