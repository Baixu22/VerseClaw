import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readPhaseTopology } from '../../scripts/lib/system-maturity-phases.mjs';
import { PHASE_DIRS } from '../../scripts/lib/system-maturity-quarterly-audit.mjs';

describe('system maturity phase order guard', () => {
  it('keeps the frozen quarterly audit order aligned with phases.json', () => {
    const topology = readPhaseTopology(process.cwd());
    expect(PHASE_DIRS).toEqual(topology.phases.map((phase: { id: string }) => phase.id));
  });

  it('keeps every declared phase wave represented in EXECUTION-ORDER.md', () => {
    const topology = readPhaseTopology(process.cwd());
    const executionOrder = readFileSync('plans/system-maturity/EXECUTION-ORDER.md', 'utf8');
    for (const phase of topology.phases) {
      const phaseNumber = phase.id.match(/^phase(\d+)-/u)?.[1];
      expect(phaseNumber).toBeDefined();
      expect(executionOrder).toContain(`### Wave ${phaseNumber} -`);
    }
  });
});
