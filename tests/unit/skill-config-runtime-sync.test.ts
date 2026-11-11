import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  root: '', config: {} as Record<string, unknown>,
  legacy: {} as Record<string, unknown>, migrated: false,
  read: vi.fn(), write: vi.fn(),
}));
vi.mock('@electron/utils/paths', () => ({
  getDataDir: () => state.root,
  getOpenClawSkillsDir: () => join(state.root, 'verse-claw-skills'),
  getOpenClawDir: () => join(state.root, 'runtime'),
  getOpenClawResolvedDir: () => join(state.root, 'runtime'),
  getOpenClawConfigPath: () => join(state.root, 'openclaw.json'),
  getResourcesDir: () => '',
}));
vi.mock('@electron/utils/channel-config', () => ({
  readOpenClawConfig: () => state.read(),
  writeOpenClawConfig: (value: unknown) => state.write(value),
}));
vi.mock('electron-store', () => ({ default: class {
  get(key: string) { return key === 'entries' ? structuredClone(state.legacy) : state.migrated; }
  set(key: string, value: unknown) { if (key === 'runtimeMigrated') state.migrated = value === true; }
} }));

async function api() { return import('@electron/utils/skill-config'); }
function runtimeEntries() {
  return (state.config.skills as { entries: Record<string, Record<string, unknown>> }).entries;
}

describe('runtime-owned skill configuration', () => {
  beforeEach(() => {
    vi.resetModules(); vi.clearAllMocks();
    state.root = mkdtempSync(join(tmpdir(), 'skill-canonical-'));
    state.config = {}; state.legacy = {}; state.migrated = false;
    state.read.mockImplementation(async () => structuredClone(state.config));
    state.write.mockImplementation(async (config: Record<string, unknown>) => { state.config = structuredClone(config); });
  });
  afterEach(() => { rmSync(state.root, { recursive: true, force: true }); });

  it('migrates once, preserves explicit runtime values, and never resurrects removed entries', async () => {
    state.legacy = { pdf: { enabled: false, env: { FORMAT: 'pdf' } }, legacy: { enabled: true } };
    state.config = { skills: { entries: { pdf: { enabled: true, config: { custom: 1 } } }, limits: { maxSkillsInPrompt: 20 } }, agents: { list: [] } };
    const first = await api();
    expect(await first.getSkillConfig('pdf')).toMatchObject({ enabled: true, env: { FORMAT: 'pdf' }, config: { custom: 1 } });
    expect(state.migrated).toBe(true);
    expect(await first.removeSkillConfigs(['legacy', 'legacy'])).toEqual({ success: true, removed: 1 });
    vi.resetModules();
    const restarted = await api();
    expect(await restarted.getSkillConfig('legacy')).toBeUndefined();
    expect(state.config).toMatchObject({ skills: { limits: { maxSkillsInPrompt: 20 } }, agents: { list: [] } });
  });

  it('updates the canonical entries and discovers only the existing managed root', async () => {
    mkdirSync(join(state.root, 'verse-claw-skills'));
    state.config = { skills: { entries: { pdf: { enabled: true, config: { keep: true } } }, load: { extraDirs: ['/existing'], watch: false } } };
    const service = await api();
    expect(await service.updateSkillConfigs([{ skillKey: 'pdf', enabled: false }])).toEqual({ success: true });
    expect(runtimeEntries().pdf).toEqual({ enabled: false, config: { keep: true } });
    expect(state.config).toMatchObject({ skills: { load: { extraDirs: ['/existing', join(state.root, 'verse-claw-skills')], watch: false } } });
    state.write.mockClear();
    await service.syncSkillsToRuntimeConfig();
    expect(state.write).not.toHaveBeenCalled();
    await service.updateSkillConfig('pdf', { enabled: true });
    expect((await service.getAllSkillConfigs()).pdf.enabled).toBe(true);
  });

  it('preserves runtime-only fields when credentials are cleared', async () => {
    state.config = { skills: { entries: { pdf: { apiKey: 'test-only', env: { A: 'B' }, config: { keep: true } } } } };
    const service = await api();
    await service.updateSkillConfig('pdf', { apiKey: '', env: {} });
    expect(runtimeEntries().pdf).toEqual({ config: { keep: true } });
  });

  it('serializes independent updates without losing either entry', async () => {
    const service = await api();
    await Promise.all([service.updateSkillConfig('pdf', { enabled: false }), service.updateSkillConfig('xlsx', { enabled: true })]);
    expect(runtimeEntries()).toEqual({ pdf: { enabled: false }, xlsx: { enabled: true } });
  });

  it('does not acknowledge a failed write or mark migration complete', async () => {
    state.legacy = { pdf: { enabled: true } };
    state.write.mockRejectedValue(new Error('disk unavailable'));
    const service = await api();
    expect(await service.updateSkillConfig('pdf', { enabled: false })).toMatchObject({ success: false, error: expect.stringContaining('disk unavailable') });
    expect(state.config).toEqual({}); expect(state.migrated).toBe(false);
  });

  it('fails closed on unreadable or malformed runtime config', async () => {
    state.read.mockRejectedValueOnce(new Error('corrupt config'));
    const service = await api();
    expect((await service.updateSkillConfig('pdf', { enabled: false })).success).toBe(false);
    state.config = { skills: { entries: ['bad'] } };
    expect((await service.updateSkillConfig('pdf', { enabled: false })).success).toBe(false);
    expect(state.write).not.toHaveBeenCalled();
  });
});
