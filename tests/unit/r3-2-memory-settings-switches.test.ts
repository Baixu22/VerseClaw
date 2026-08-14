// R3-2: memory settings switch group (opt-in cohort). Asserts runtime.memory.*
// flags are registered in the DCS catalog and writable specs with their
// negative-effect switches marked unavailable (R3-1 E-1 ruling + audit).
// R3-1 v3 task 3 adds the compass contextBlock switch (Assembler handler has no
// production inputs.compass caller; auto-reply compass uses the bypass path).
import { describe, expect, it } from 'vitest';
import { assertCatalogDefaultHonesty, DCS_PROD_FLAGS } from '../../shared/dcs/prod-flags-catalog';
import { DCS_WRITABLE_FLAG_SPECS, getWritableFlagSpec } from '../../shared/dcs/prod-flags-control';

const MEMORY_FLAG_IDS = [
  'runtime-memory-persist',
  'runtime-memory-inject-pilot',
  'compass-context-block',
  'role-memory',
] as const;

describe('R3-2: memory settings switches (opt-in cohort)', () => {
  it('registers runtime.memory.* flags in the catalog with default false', () => {
    for (const id of MEMORY_FLAG_IDS) {
      const entry = DCS_PROD_FLAGS.find((f) => f.id === id);
      expect(entry, id).toBeDefined();
      expect(entry?.defaultValue, id).toBe(false);
    }
    expect(assertCatalogDefaultHonesty()).toEqual({ ok: true });
  });

  it('marks negative-effect memory switches unavailable in the writable specs', () => {
    for (const id of MEMORY_FLAG_IDS) {
      const spec = getWritableFlagSpec(id);
      expect(spec, id).toBeDefined();
      expect(spec?.defaultEnabled, id).toBe(false);
      expect(spec?.unavailableReason, id).toBeDefined();
    }
    // Exactly these three are surfaced-but-disabled; no other spec is unavailable.
    expect(
      DCS_WRITABLE_FLAG_SPECS.filter((s) => s.unavailableReason !== undefined).map((s) => s.id),
    ).toEqual([...MEMORY_FLAG_IDS]);
  });
});
