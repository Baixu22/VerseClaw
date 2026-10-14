import { describe, expect, it } from 'vitest';
import {
  assertCatalogDefaultHonesty,
  DCS_PROD_FLAGS,
  listEnhancementFlagsDefaultOff,
} from '../../shared/dcs/prod-flags-catalog';
import { DCS_WRITABLE_FLAG_SPECS } from '../../shared/dcs/prod-flags-control';

describe('shared dcs prod flags catalog', () => {
  it('is honest about opt-in defaults', () => {
    expect(assertCatalogDefaultHonesty()).toEqual({ ok: true });
    expect(DCS_PROD_FLAGS.length).toBeGreaterThanOrEqual(10);
    expect(listEnhancementFlagsDefaultOff().length).toBeGreaterThan(0);
  });

  it('records the RC-03 seal opt-in flag as a referencable, default-off catalog entry', () => {
    const entry = DCS_PROD_FLAGS.find((flag) => flag.id === 'rc03-seal');
    expect(entry).toBeDefined();
    expect(entry?.defaultValue).toBe(false);
    expect(entry?.risk).toBe('opt-in');
    expect(entry?.kind).toBe('config');
    expect(entry?.key).toBe('runtime.rc03.seal');
    expect(entry?.enable).toContain('OPENCLAW_RC03_SEAL');
    expect(entry?.rollback).toContain('OPENCLAW_RC03_SEAL');
  });

  it('marks silently ineffective leaves as API-only', () => {
    const ids = DCS_PROD_FLAGS.map((flag) => flag.id);
    expect(ids).toContain('worktree-backend');
    expect(ids).toContain('sekb-experience-shadow');

    for (const id of ['worktree-backend', 'sekb-experience-shadow']) {
      const entry = DCS_PROD_FLAGS.find((flag) => flag.id === id);
      expect(entry?.kind).toBe('api');
      expect(entry?.risk).toBe('api-only');
    }

    expect(DCS_PROD_FLAGS.find((flag) => flag.id === 'sekb-experience-shadow')?.enable).toContain(
      'sessionId',
    );

    const writableIds = DCS_WRITABLE_FLAG_SPECS.map((spec) => spec.id);
    expect(writableIds).not.toContain('worktree-backend');
    expect(writableIds).not.toContain('sekb-experience-shadow');
  });
});
