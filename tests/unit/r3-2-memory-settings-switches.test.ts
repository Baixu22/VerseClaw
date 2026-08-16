// R3-2: memory settings switch group (opt-in cohort). Asserts runtime.memory.*
// flags are registered in the DCS catalog. Runtime-memory persistence remains
// unavailable until Settings can select its slot owner; the injection and
// context-block switches are now wired production surfaces.
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

  it('keeps only the unconstrained persistence switch unavailable', () => {
    for (const id of MEMORY_FLAG_IDS) {
      const spec = getWritableFlagSpec(id);
      expect(spec, id).toBeDefined();
      expect(spec?.defaultEnabled, id).toBe(false);
    }
    expect(getWritableFlagSpec('runtime-memory-persist')?.unavailableReason).toBeDefined();
    expect(getWritableFlagSpec('runtime-memory-inject-pilot')?.unavailableReason).toBeUndefined();
    expect(getWritableFlagSpec('compass-context-block')?.unavailableReason).toBeUndefined();
    expect(getWritableFlagSpec('role-memory')?.unavailableReason).toBeUndefined();
    expect(
      DCS_WRITABLE_FLAG_SPECS.filter((s) => s.unavailableReason !== undefined).map((s) => s.id),
    ).toEqual(['runtime-memory-persist']);
  });
});
