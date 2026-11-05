// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  registry: vi.fn(),
  artifact: vi.fn(),
  load: vi.fn(),
  modulePath: vi.fn(),
  native: vi.fn(),
}));

// Exercise the built Gateway branch with tiny generated plugin roots.
vi.mock('node:url', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:url')>();
  const path = await import('node:path');
  mocks.modulePath.mockReturnValue(path.join('fixture', 'dist', 'contracts.js'));
  return { ...actual, default: actual, fileURLToPath: mocks.modulePath };
});
vi.mock('../../openclaw_runtime/src/plugins/plugin-registry.js', () => ({
  loadPluginManifestRegistryForPluginRegistry: mocks.registry,
}));
vi.mock('../../openclaw_runtime/src/plugins/public-surface-loader.js', () => ({
  resolveBundledPluginPublicArtifactPath: mocks.artifact,
}));
vi.mock('../../openclaw_runtime/src/plugins/plugin-module-loader-cache.js', () => ({
  createPluginModuleLoaderCache: () => new Map(),
  getCachedPluginModuleLoader: () => mocks.load,
}));
vi.mock('../../openclaw_runtime/src/plugins/native-module-require.js', () => ({
  tryNativeRequireJavaScriptModule: mocks.native,
}));

import { listPluginDoctorStateMigrationEntries } from '../../openclaw_runtime/src/plugins/doctor-contract-registry';

let fixture: string;

beforeEach(() => {
  vi.clearAllMocks();
  fixture = mkdtempSync(join(tmpdir(), 'gateway-doctor-contract-'));
  mocks.artifact.mockReturnValue(null);
  mocks.native.mockReturnValue({ ok: false });
  mocks.load.mockReturnValue({ stateMigrations: [{
    id: 'fixture-state', label: 'Fixture migration',
    detectLegacyState: () => null,
    migrateLegacyState: () => ({ changes: [], warnings: [] }),
  }] });
});
afterEach(() => rmSync(fixture, { recursive: true, force: true }));

function plugin(origin: 'bundled' | 'global') {
  const rootDir = join(fixture, 'example');
  mkdirSync(rootDir);
  writeFileSync(join(rootDir, 'doctor-contract-api.ts'), 'export const stateMigrations = [];');
  mocks.registry.mockReturnValue({ plugins: [{ id: 'example', rootDir, origin }], diagnostics: [] });
  return rootDir;
}

describe('Gateway startup doctor contract loading', () => {
  it('uses an existing compiled bundled doctor artifact and retains migration entries', () => {
    plugin('bundled');
    const built = join(fixture, 'dist', 'doctor-contract-api.js');
    mocks.artifact.mockReturnValue(built);
    expect(listPluginDoctorStateMigrationEntries()).toEqual([
      expect.objectContaining({ pluginId: 'example', migration: expect.objectContaining({ id: 'fixture-state' }) }),
    ]);
    expect(mocks.load).toHaveBeenCalledWith(built);
  });

  it('keeps a source doctor contract ahead of a generic built contract', () => {
    const rootDir = plugin('bundled');
    mocks.artifact.mockImplementation(({ artifactBasename }: { artifactBasename: string }) => (
      artifactBasename === 'contract-api.js' ? join(fixture, 'dist', 'contract-api.js') : null
    ));
    listPluginDoctorStateMigrationEntries();
    expect(mocks.load).toHaveBeenCalledWith(join(rootDir, 'doctor-contract-api.ts'));
  });

  it('retains source loading when the bundled artifact is unbuilt', () => {
    const rootDir = plugin('bundled');
    mocks.artifact.mockReturnValue(join(rootDir, 'doctor-contract-api.ts'));
    listPluginDoctorStateMigrationEntries();
    expect(mocks.load).toHaveBeenCalledWith(join(rootDir, 'doctor-contract-api.ts'));
  });

  it('loads an external plugin contract from its own root', () => {
    const rootDir = plugin('global');
    mocks.artifact.mockReturnValue(join(fixture, 'dist', 'doctor-contract-api.js'));
    listPluginDoctorStateMigrationEntries();
    expect(mocks.artifact).not.toHaveBeenCalled();
    expect(mocks.load).toHaveBeenCalledWith(join(rootDir, 'doctor-contract-api.ts'));
  });

  it('loads native compiled contracts without constructing the SDK alias loader', () => {
    plugin('bundled');
    const migration = { id: 'native', label: 'Native migration', detectLegacyState: () => null,
      migrateLegacyState: () => ({ changes: [], warnings: [] }) };
    mocks.artifact.mockReturnValue(join(fixture, 'dist', 'doctor-contract-api.js'));
    mocks.native.mockReturnValue({ ok: true, moduleExport: { stateMigrations: [migration] } });
    expect(listPluginDoctorStateMigrationEntries()[0]?.migration.id).toBe('native');
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it('keeps source contracts authoritative when running from source', async () => {
    const rootDir = plugin('bundled');
    writeFileSync(join(rootDir, 'doctor-contract-api.js'), 'export const stateMigrations = [];');
    mocks.artifact.mockReturnValue(join(fixture, 'dist', 'doctor-contract-api.js'));
    mocks.modulePath.mockReturnValue(join(fixture, 'src', 'doctor-contract-registry.ts'));
    vi.resetModules();
    const sourceRegistry = await import('../../openclaw_runtime/src/plugins/doctor-contract-registry');
    sourceRegistry.listPluginDoctorStateMigrationEntries();
    expect(mocks.artifact).not.toHaveBeenCalled();
    expect(mocks.load).toHaveBeenCalledWith(join(rootDir, 'doctor-contract-api.ts'));
  });
});
