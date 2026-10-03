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
