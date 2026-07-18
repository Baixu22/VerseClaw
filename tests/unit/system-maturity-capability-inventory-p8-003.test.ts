import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  evaluateCapabilityInventory,
  runCapabilityInventoryAudit,
} from '../../scripts/lib/system-maturity-capability-inventory.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

describe('capability inventory (P8-003 / F-REL-004)', () => {
  it('fails when scenario mapping is missing', () => {
    const result = evaluateCapabilityInventory({
      inventory: {
        schemaVersion: 1,
        findingId: 'F-REL-004',
        capabilities: [{ id: 'x', implementations: ['a', 'b'], scenarioIds: ['NOPE'] }],
      },
      suite: { scenarios: [{ id: 'SM-SEC-P0-RENDERER-SENDER', findings: ['F-REL-004'] }] },
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/unknown scenarioIds|not covered/i);
  });

  it('repo inventory maps all F-REL-004 suite scenarios', () => {
    const report = runCapabilityInventoryAudit({ root });
    expect(report.ok).toBe(true);
    expect(report.result.rows.length).toBeGreaterThanOrEqual(4);
  });
});
