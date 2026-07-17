import { describe, expect, it } from 'vitest';
import {
  assertCatalogDefaultHonesty,
  DCS_PROD_FLAGS,
  listEnhancementFlagsDefaultOff,
} from '../../shared/dcs/prod-flags-catalog';

describe('shared dcs prod flags catalog', () => {
  it('is honest about opt-in defaults', () => {
    expect(assertCatalogDefaultHonesty()).toEqual({ ok: true });
    expect(DCS_PROD_FLAGS.length).toBeGreaterThanOrEqual(10);
    expect(listEnhancementFlagsDefaultOff().length).toBeGreaterThan(0);
  });
});