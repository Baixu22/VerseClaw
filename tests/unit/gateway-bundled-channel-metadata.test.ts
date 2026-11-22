// @vitest-environment node
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { beforeEach, expect, it, vi } from 'vitest';
import type { BundledChannelPluginMetadata } from '../../openclaw_runtime/src/plugins/bundled-channel-runtime';

const mocks = vi.hoisted(() => ({
  root: '',
  metadata: vi.fn(),
  module: vi.fn(),
  detector: vi.fn(() => []),
  surface: { normalizeTarget: (target: string) => target },
}));

vi.mock('../../openclaw_runtime/src/channels/plugins/bundled-root.js', () => ({
  resolveBundledChannelRootScope: () => ({
    packageRoot: mocks.root,
    pluginsDir: join(mocks.root, 'extensions'),
    cacheKey: mocks.root,
  }),
}));
vi.mock('../../openclaw_runtime/src/plugins/bundled-channel-runtime.js', () => ({
  listBundledChannelPluginMetadata: mocks.metadata,
  resolveBundledChannelGeneratedPath: (_root: string, entry: { source: string }) => entry.source,
}));
vi.mock('../../openclaw_runtime/src/channels/plugins/module-loader.js', () => ({
  loadChannelPluginModule: mocks.module,
}));
vi.mock('../../openclaw_runtime/src/logging/subsystem.js', () => ({
  createSubsystemLogger: () => ({ warn: vi.fn() }),
}));

import * as bundled from '../../openclaw_runtime/src/channels/plugins/bundled';
import { clearPluginMetadataLifecycleCaches } from '../../openclaw_runtime/src/plugins/plugin-metadata-lifecycle';

let scope = 0;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.root = join(tmpdir(), `gateway-bundled-metadata-${++scope}`);
  mocks.module.mockImplementation(({ modulePath }: { modulePath: string }) => {
    const id = basename(dirname(modulePath));
    const plugin = {
      id,
      meta: { id, label: id, selectionLabel: id, docsPath: id },
      lifecycle: { detectLegacyStateMigrations: mocks.detector },
      messaging: mocks.surface,
    };
    return basename(modulePath).startsWith('setup')
      ? {
          kind: 'bundled-channel-setup-entry',
          loadSetupPlugin: () => plugin,
          features: { legacyStateMigrations: true, legacySessionSurfaces: true },
          loadLegacyStateMigrationDetector: () => mocks.detector,
          loadLegacySessionSurface: () => mocks.surface,
        }
      : {
          kind: 'bundled-channel-entry',
          id,
          name: id,
          description: id,
          register: () => undefined,
          loadChannelPlugin: () => plugin,
        };
  });
  mocks.metadata.mockReturnValue([metadata('example')]);
});

function metadata(
  id: string,
  channels: string[] = [id],
  hinted = true
): BundledChannelPluginMetadata {
  const rootDir = join(mocks.root, 'extensions', id);
  return {
    dirName: id,
    rootDir,
    manifest: { id, channels },
    source: { source: join(rootDir, 'entry.js'), built: join(rootDir, 'entry.js') },
    setupSource: { source: join(rootDir, 'setup.js'), built: join(rootDir, 'setup.js') },
    ...(hinted
      ? {
          packageManifest: {
            setupFeatures: {
              legacyStateMigrations: true,
              legacySessionSurfaces: true,
            },
          },
        }
      : {}),
  };
}

it('shares one metadata enumeration between migration listing and alias loading', () => {
  mocks.metadata.mockReturnValue([metadata('example', ['example', 'example-alias'])]);
  expect(bundled.listBundledChannelLegacyStateMigrationDetectors()).toEqual([mocks.detector]);
  expect(bundled.getBundledChannelSetupPlugin('example-alias')?.id).toBe('example');
  expect(bundled.listBundledChannelLegacySessionSurfaces()).toEqual([mocks.surface]);
  expect(bundled.listBundledChannelPluginIds()).toEqual(['example']);
  expect(mocks.metadata).toHaveBeenCalledTimes(1);
});

it('reapplies channel and plugin disablement to the shared metadata', () => {
  expect(bundled.listBundledChannelLegacyStateMigrationDetectors()).toHaveLength(1);
  expect(
    bundled.listBundledChannelLegacyStateMigrationDetectors({
      config: { channels: { example: { enabled: false } } },
    })
  ).toEqual([]);
  expect(
    bundled.listBundledChannelLegacySessionSurfaces({
      config: { plugins: { enabled: false } },
    })
  ).toEqual([]);
  expect(bundled.listBundledChannelLegacyStateMigrationDetectors()).toHaveLength(1);
  expect(mocks.metadata).toHaveBeenCalledTimes(1);
});

it('keeps unhinted setup fallback without enumerating the scope again', () => {
  mocks.metadata.mockReturnValue([metadata('example', ['example'], false)]);
  expect(bundled.listBundledChannelLegacyStateMigrationDetectors()).toEqual([mocks.detector]);
  expect(mocks.module).toHaveBeenCalledTimes(1);
  expect(mocks.metadata).toHaveBeenCalledTimes(1);
});

it('retains hinted selection and sorted plugin identities with colliding channel aliases', () => {
  mocks.metadata.mockReturnValue([
    metadata('zulu', ['zulu', 'shared'], false),
    metadata('alpha', ['alpha', 'shared']),
  ]);
  expect(bundled.listBundledChannelLegacyStateMigrationDetectors()).toEqual([mocks.detector]);
  expect(bundled.getBundledChannelSetupPlugin('shared')?.id).toBe('alpha');
  expect(bundled.listBundledChannelPluginIds()).toEqual(['alpha', 'zulu']);
  expect(mocks.metadata).toHaveBeenCalledTimes(1);
});

it('keeps separate root snapshots and reuses the selected root on return', () => {
  const firstRoot = mocks.root;
  expect(bundled.listBundledChannelPluginIds()).toEqual(['example']);
  mocks.root = join(tmpdir(), `${firstRoot.split(/[/\\]/).at(-1)}-second`);
  mocks.metadata.mockReturnValue([metadata('other')]);
  expect(bundled.listBundledChannelPluginIds()).toEqual(['other']);
  expect(bundled.getBundledChannelSetupPlugin('other')?.id).toBe('other');
  mocks.root = firstRoot;
  expect(bundled.listBundledChannelPluginIds()).toEqual(['example']);
  expect(mocks.metadata).toHaveBeenCalledTimes(2);
});

it('does not add a cached missing alias to the plugin listing', () => {
  expect(bundled.getBundledChannelSetupPlugin('missing')).toBeUndefined();
  expect(bundled.getBundledChannelSetupPlugin('missing')).toBeUndefined();
  expect(bundled.listBundledChannelPluginIds()).toEqual(['example']);
  expect(mocks.metadata).toHaveBeenCalledTimes(1);
});

it('retries a failed enumeration and retains a successful empty snapshot', () => {
  const failure = new Error('metadata read failed');
  mocks.metadata
    .mockImplementationOnce(() => {
      throw failure;
    })
    .mockReturnValue([]);
  expect(() => bundled.listBundledChannelPluginIds()).toThrow(failure);
  expect(bundled.listBundledChannelPluginIds()).toEqual([]);
  expect(bundled.getBundledChannelSetupPlugin('missing')).toBeUndefined();
  expect(bundled.listBundledChannelPluginIds()).toEqual([]);
  expect(mocks.metadata).toHaveBeenCalledTimes(2);
});

it('refreshes metadata when the existing 32-root cache evicts a scope', () => {
  const firstRoot = mocks.root;
  expect(bundled.listBundledChannelPluginIds()).toEqual(['example']);
  for (let index = 0; index < 32; index++) {
    mocks.root = join(tmpdir(), `gateway-bundled-eviction-${scope}-${index}`);
    bundled.listBundledChannelPluginIds();
  }
  mocks.root = firstRoot;
  mocks.metadata.mockReturnValue([metadata('refreshed')]);
  expect(bundled.listBundledChannelPluginIds()).toEqual(['refreshed']);
  expect(bundled.getBundledChannelSetupPlugin('refreshed')?.id).toBe('refreshed');
  expect(mocks.metadata).toHaveBeenCalledTimes(34);
});

it('refreshes root metadata and loaded entries after an owner lifecycle reset', () => {
  expect(bundled.listBundledChannelPluginIds()).toEqual(['example']);
  expect(bundled.getBundledChannelSetupPlugin('example')?.id).toBe('example');
  mocks.metadata.mockReturnValue([metadata('replacement')]);
  clearPluginMetadataLifecycleCaches();
  expect(bundled.listBundledChannelPluginIds()).toEqual(['replacement']);
  expect(bundled.getBundledChannelSetupPlugin('replacement')?.id).toBe('replacement');
  expect(bundled.getBundledChannelSetupPlugin('example')).toBeUndefined();
  expect(mocks.metadata).toHaveBeenCalledTimes(2);
});
