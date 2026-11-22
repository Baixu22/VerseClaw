import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PluginManifestRecord, PluginManifestRegistry } from '../../openclaw_runtime/src/plugins/manifest-registry.js';

const mocks = vi.hoisted(() => ({
  directory: vi.fn<() => string | undefined>(),
  registry: vi.fn<() => PluginManifestRegistry>(),
  surface: vi.fn<(params: { dirName: string }) => Record<string, unknown>>(),
}));

vi.mock('../../openclaw_runtime/src/plugins/bundled-dir.js', () => ({ resolveBundledPluginsDir: mocks.directory }));
vi.mock('../../openclaw_runtime/src/plugins/manifest-registry.js', () => ({ loadPluginManifestRegistry: mocks.registry }));
vi.mock('../../openclaw_runtime/src/plugins/public-surface-loader.js', () => ({ loadBundledPluginPublicArtifactModuleSync: mocks.surface }));

const firstSurface = { resolveThinkingProfile: () => ({ levels: [{ id: 'off' }, { id: 'high' }], defaultLevel: 'high' }) };
const secondSurface = { resolveThinkingProfile: () => ({ levels: [{ id: 'off' }, { id: 'low' }], defaultLevel: 'low' }) };

function plugin(id: string, fields: Partial<PluginManifestRecord> = {}): PluginManifestRecord {
  return { id, channels: [], providers: ['fixture-provider'], cliBackends: [], skills: [], hooks: [],
    origin: 'bundled', rootDir: `/bundled/${id}`, source: `/bundled/${id}/index.ts`,
    manifestPath: `/bundled/${id}/openclaw.plugin.json`,
    providerAuthAliases: { 'fixture-alias': 'fixture-provider', 'unowned-alias': 'other-provider' }, ...fields };
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.directory.mockReturnValue('/bundled-a');
  mocks.registry.mockReturnValue({ plugins: [], diagnostics: [] });
  mocks.surface.mockImplementation(({ dirName }) => {
    if (dirName === 'owner-a') return firstSurface;
    if (dirName === 'owner-z') return secondSurface;
    throw new Error(`Unable to resolve bundled plugin public surface ${dirName}`);
  });
});

describe('bundled provider ownership for thinking metadata', () => {
  it('keeps repeated custom model thinking reads off without rediscovering plugins', async () => {
    const { listThinkingLevelOptions, resolveThinkingDefaultForModel } = await import('../../openclaw_runtime/src/auto-reply/thinking.js');
    const catalog = [{ provider: 'custom-probe', id: 'model-probe', reasoning: false }];
    for (let read = 0; read < 3; read += 1) {
      expect(listThinkingLevelOptions('custom-probe', 'model-probe', catalog).map(option => option.id)).toEqual(['off']);
      expect(resolveThinkingDefaultForModel({ provider: 'custom-probe', model: 'model-probe', catalog })).toBe('off');
    }
    expect(mocks.registry).toHaveBeenCalledTimes(1);
  });

  it('preserves declared alias ownership, bundled origin and deterministic owner selection', async () => {
    const { resolveBundledProviderPolicySurface } = await import('../../openclaw_runtime/src/plugins/provider-public-artifacts.js');
    const manifestRegistry = { plugins: [plugin('owner-z'), plugin('global-owner', { origin: 'global' }), plugin('owner-a')] };
    expect(resolveBundledProviderPolicySurface(' FIXTURE-ALIAS ', { manifestRegistry })).toBe(firstSurface);
    expect(resolveBundledProviderPolicySurface('unowned-alias', { manifestRegistry })).toBeNull();
    expect(resolveBundledProviderPolicySurface('external-alias', { manifestRegistry: {
      plugins: [plugin('global-owner', { origin: 'global', providerAuthAliases: { 'external-alias': 'fixture-provider' } })],
    } })).toBeNull();
    expect(mocks.registry).not.toHaveBeenCalled();
  });

  it('honors explicit registries and replaces the snapshot when the bundled root changes', async () => {
    const { resolveBundledProviderPolicySurface } = await import('../../openclaw_runtime/src/plugins/provider-public-artifacts.js');
    mocks.registry.mockReturnValue({ plugins: [plugin('owner-a')], diagnostics: [] });
    expect(resolveBundledProviderPolicySurface('fixture-alias')).toBe(firstSurface);
    expect(resolveBundledProviderPolicySurface('fixture-alias', { manifestRegistry: { plugins: [plugin('owner-z')] } })).toBe(secondSurface);
    expect(resolveBundledProviderPolicySurface('fixture-alias')).toBe(firstSurface);
    expect(mocks.registry).toHaveBeenCalledTimes(1);

    mocks.directory.mockReturnValue('/bundled-b');
    mocks.registry.mockReturnValue({ plugins: [plugin('owner-z')], diagnostics: [] });
    expect(resolveBundledProviderPolicySurface('fixture-alias')).toBe(secondSurface);
    expect(mocks.registry).toHaveBeenCalledTimes(2);

    mocks.directory.mockReturnValue('/bundled-a');
    mocks.registry.mockReturnValue({ plugins: [plugin('owner-a')], diagnostics: [] });
    expect(resolveBundledProviderPolicySurface('fixture-alias')).toBe(firstSurface);
    expect(mocks.registry).toHaveBeenCalledTimes(3);
  });
});
