import { describe, expect, it } from 'vitest';
import {
  normalizeWorkModeKits,
  normalizeWorkModeToolBundles,
  normalizeWorkModeId,
  resolveWorkModeKitCapabilities,
  resolveDefaultWorkMode,
  resolveWorkModePreset,
  summarizeWorkModeCapabilities,
  WORK_MODE_PRESETS,
} from '@shared/types/work-mode';

describe('work mode presets', () => {
  it('normalizes known work mode ids and rejects unknown values', () => {
    expect(normalizeWorkModeId('plan')).toBe('plan');
    expect(normalizeWorkModeId('docsData')).toBe('docsData');
    expect(normalizeWorkModeId('daily')).toBeUndefined();
    expect(normalizeWorkModeId(null)).toBeUndefined();
  });

  it('defaults plan permission to plan mode and other permissions to build mode', () => {
    expect(resolveDefaultWorkMode('plan')).toBe('plan');
    expect(resolveDefaultWorkMode('readOnly')).toBe('build');
    expect(resolveDefaultWorkMode('acceptEdits')).toBe('build');
    expect(resolveDefaultWorkMode(undefined)).toBe('build');
  });

  it('resolves invalid ids through permission-aware defaults', () => {
    expect(resolveWorkModePreset('review').id).toBe('review');
    expect(resolveWorkModePreset('unknown', 'plan').id).toBe('plan');
    expect(resolveWorkModePreset(undefined, 'acceptEdits').id).toBe('build');
  });

  it('normalizes customized tool bundle overrides without granting unknown labels', () => {
    expect(normalizeWorkModeToolBundles(['docs', 'docs', 'browser', 'shell'], ['code'])).toEqual(['docs', 'browser']);
    expect(normalizeWorkModeToolBundles('docs', ['code'])).toEqual(['code']);
    expect(resolveWorkModePreset('build', undefined, { build: ['code', 'pdf'] }).toolBundles).toEqual(['code', 'pdf']);
    expect(resolveWorkModePreset('docsData', undefined, { docsData: ['docs', 'pdf'] }).kits).toEqual(['reports', 'slides', 'pdf']);
  });

  it('normalizes work kit overrides without granting unknown kits', () => {
    expect(normalizeWorkModeKits(['reports', 'reports', 'sheets', 'shell'], ['ops'])).toEqual(['reports', 'sheets']);
    expect(normalizeWorkModeKits('reports', ['ops'])).toEqual(['ops']);
    expect(resolveWorkModePreset('docsData', undefined, null, { docsData: ['reports', 'pdf'] }).kits).toEqual(['reports', 'pdf']);
  });

  it('summarizes work kit capability status from local skills and runtime state', () => {
    const capabilities = resolveWorkModeKitCapabilities(
      ['reports', 'sheets', 'slides', 'pdf', 'research'],
      [
        { id: 'docx', slug: 'docx', enabled: true },
        { id: 'xlsx', slug: 'xlsx', enabled: false },
        { id: 'pdf', slug: 'pdf', enabled: true },
      ],
      true,
    );

    expect(capabilities.map((capability) => [capability.kit, capability.status])).toEqual([
      ['reports', 'ready'],
      ['sheets', 'disabled'],
      ['slides', 'missingSkill'],
      ['pdf', 'ready'],
      ['research', 'optionalExternal'],
    ]);
    expect(summarizeWorkModeCapabilities(capabilities)).toMatchObject({
      ready: 2,
      disabled: 1,
      missingSkill: 1,
      optionalExternal: 1,
    });
    expect(resolveWorkModeKitCapabilities(['reports'], [{ id: 'docx', enabled: true }], false)[0]?.status).toBe('runtimeUnavailable');
  });

  it('keeps MVP modes tied to their intended permission and knowledge defaults', () => {
    expect(WORK_MODE_PRESETS.plan).toMatchObject({
      recommendedPermissionMode: 'plan',
      defaultKnowledgeScope: 'all',
      responseStyle: 'plan-first',
    });
    expect(WORK_MODE_PRESETS.review).toMatchObject({
      recommendedPermissionMode: 'readOnly',
      defaultKnowledgeScope: 'wiki',
      responseStyle: 'findings-first',
    });
    expect(WORK_MODE_PRESETS.docsData.toolBundles).toEqual(['docs', 'sheets', 'pdf', 'memory']);
    expect(WORK_MODE_PRESETS.docsData.kits).toEqual(['reports', 'sheets', 'slides', 'pdf']);
  });
});
