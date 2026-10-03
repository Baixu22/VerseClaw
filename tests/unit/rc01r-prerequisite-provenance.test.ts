import { describe, expect, it } from 'vitest';
import {
  APPROVED_ACCEPTED_BASE,
  FROZEN_ROOT_UNIT_EXPECTED_SKIPS,
  INTEGRATED_COMPARISON_BASE,
  PREREQUISITE_COMMIT,
  PREREQUISITE_DIFF_BASE,
  PREREQUISITE_PATHS,
  PREREQUISITE_SPEC_BLOB,
  PREREQUISITE_SPEC_PATH,
  verifyRc01rPrerequisiteProvenance,
} from '../../scripts/rc01r-prerequisite-provenance.mjs';
import {
  ROOT_UNIT_EXPECTED_SKIPS,
  ROOT_UNIT_SKIP_INVENTORY,
  ROOT_UNIT_SYMLINK_PRIVILEGE_SKIPS,
} from '../../scripts/lib/agent-engineering-acceptance.mjs';

describe('RC-01R prerequisite provenance', () => {
  it('keeps the historical prerequisite, comparison base and acceptedBase distinct', () => {
    expect(PREREQUISITE_PATHS).toHaveLength(38);
    expect(new Set(PREREQUISITE_PATHS).size).toBe(38);
    expect(PREREQUISITE_COMMIT).not.toBe(APPROVED_ACCEPTED_BASE);
    expect(INTEGRATED_COMPARISON_BASE).not.toBe(APPROVED_ACCEPTED_BASE);
    expect(INTEGRATED_COMPARISON_BASE).not.toBe(PREREQUISITE_COMMIT);
    expect(PREREQUISITE_DIFF_BASE).toBe('3b08a46667e9b961ff9eafda12da0a18848832c5');
    expect(PREREQUISITE_SPEC_PATH).toBe('harness/specs/tasks/rc01r-green-baseline.md');
    expect(PREREQUISITE_SPEC_BLOB).toBe('4bfc17d73c304fdea62c2debb4e213605a2ca227');
    expect(FROZEN_ROOT_UNIT_EXPECTED_SKIPS).toBe(53);
  });

  it('derives the live root skip budget from the identity inventory, not from the historical frozen number', () => {
    expect(ROOT_UNIT_EXPECTED_SKIPS).toBe(50);
    expect(ROOT_UNIT_SKIP_INVENTORY.reduce((sum, entry) => sum + entry.skips, 0)).toBe(ROOT_UNIT_EXPECTED_SKIPS);
    expect(new Set(ROOT_UNIT_SKIP_INVENTORY.map((entry) => entry.file)).size).toBe(ROOT_UNIT_SKIP_INVENTORY.length);
    for (const entry of ROOT_UNIT_SKIP_INVENTORY) {
      expect(entry.file).toMatch(/^tests\/unit\/.*\.test\.ts$/u);
      expect(Number.isInteger(entry.skips) && entry.skips > 0).toBe(true);
      expect(entry.gate.length).toBeGreaterThan(0);
    }
    expect(ROOT_UNIT_SKIP_INVENTORY.filter((entry) => entry.gate === 'DEEPSEEK_API_KEY withheld')
      .reduce((sum, entry) => sum + entry.skips, 0)).toBe(49);
    expect(ROOT_UNIT_SYMLINK_PRIVILEGE_SKIPS).toBe(3);
    expect(ROOT_UNIT_EXPECTED_SKIPS + ROOT_UNIT_SYMLINK_PRIVILEGE_SKIPS).toBe(FROZEN_ROOT_UNIT_EXPECTED_SKIPS);
  });

  it('verifies the live repository identities without re-signing acceptedBase', () => {
    const report = verifyRc01rPrerequisiteProvenance();
    expect(report.ok).toBe(true);
    expect(report.errors).toEqual([]);
    expect(report.prerequisite.commit).toBe(PREREQUISITE_COMMIT);
    expect(report.prerequisite.diffBase).toBe(PREREQUISITE_DIFF_BASE);
    expect(report.prerequisite.specBlob).toBe(PREREQUISITE_SPEC_BLOB);
    expect(report.prerequisite.pathCount).toBe(38);
    expect(report.approvedAcceptedBase).toBe(APPROVED_ACCEPTED_BASE);
    expect(report.integratedComparisonBase).toBe(INTEGRATED_COMPARISON_BASE);
    expect(report.frozenRootUnitExpectedSkips).toBe(53);
    expect(report.identities).toEqual({
      prerequisiteIsNotAcceptedBase: true,
      comparisonBaseIsNotAcceptedBase: true,
      comparisonBaseIsNotPrerequisite: true,
    });
  });
});
