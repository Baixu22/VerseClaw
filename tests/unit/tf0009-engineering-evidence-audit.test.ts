// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  evaluateTf0009L3Readiness,
  hasSafeTf0009HardBounds,
  hasValidTf0009Day1Gates,
} from '../../scripts/lib/tf0009-canary-readiness.mjs';

type Audit = {
  authority: string;
  taskForestState: {
    status: string;
    progress: number;
    canMarkDone: boolean;
    canReleaseTF0011: boolean;
    recommendation: string;
  };
  qualifyingEvidenceRule: Record<string, boolean>;
  profiles: Array<{
    id: string;
    requiredQualifyingRuns: number;
    observedQualifyingRuns: number;
    status: string;
  }>;
  acceptanceCriteria: Array<{ id: string; status: string }>;
  frozenBoundaries: Record<string, unknown>;
};

const root = process.cwd();

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(join(root, relativePath), 'utf8')) as T;
}

function completeProfiles() {
  const profile = (id: string) => ({
    id,
    owner: 'named-owner',
    cohort: 'one named operator on one bounded workspace',
    budget: 'three tasks and thirty minutes',
    privacy: 'no source body or credentials retained',
    metrics: ['latency', 'tokens', 'errors'],
    kill: 'disable profile and restart runtime',
    rollback: 'restore baseline and verify parity',
    stopConditions: ['unauthorized write', 'privacy leak'],
  });
  return {
    hardBounds: {
      defaultsUnchanged: true,
      liveReady: false,
      productApproved: false,
      jointSystemGa: 'NO-GO',
      sekbAutoWriteback: false,
      cutoverAllowed: false,
    },
    roles: { owner: 'named-owner', operator: 'named-operator', safety: 'named-safety' },
    profiles: ['dcs-coding', 'sekb-assisted', 'browser-supervised'].map(profile),
  };
}

function completeDay1Gates() {
  return readJson<Record<string, unknown>>('artifacts/dcs-deep-test-week1/day1-gates.json');
}

describe('TF-0009 engineering evidence audit', () => {
  const audit = readJson<Audit>('artifacts/first-product-preview/TF-0009/evidence-audit.json');

  it('keeps missing human evidence blocked while separating explicit engineering release', () => {
    const nodes = readJson<Record<string, { status: string; progress: number; acceptance_criteria: string[] }>>(
      '.agent-workbench/task-forest/graph/nodes.json',
    );
    const forest = readJson<{
      edges: Record<string, { from: string; to: string; type: string; blocking: boolean }>;
    }>('.agent-workbench/task-forest/graph/forest.json');
    // Live graph: review confirmed the remaining work needs human evidence, so R7 requires blocked.
    expect(nodes['TF-0009']).toMatchObject({ status: 'blocked', progress: 50 });
    expect(nodes['TF-0011']).toMatchObject({ status: 'done', progress: 100 });
    expect(nodes['TF-0009'].acceptance_criteria).toHaveLength(4);
    expect(Object.values(forest.edges)).toContainEqual(
      expect.objectContaining({
        from: 'TF-0011',
        to: 'TF-0009',
        type: 'derived_from',
        blocking: false,
      }),
    );
    // Frozen July audit keeps its original status; only the live graph tracks the current workflow.
    expect(audit.taskForestState).toEqual({
      status: 'review_needed',
      progress: 50,
      canMarkDone: false,
      canReleaseTF0011: false,
      recommendation: 'degraded-agent-complete',
    });
  });

  it('records zero qualifying runs for every profile', () => {
    expect(audit.authority).toBe('engineering-readiness-only');
    expect(audit.profiles.map(({ id }) => id).sort()).toEqual([
      'browser-supervised',
      'dcs-coding',
      'sekb-assisted',
    ]);
    for (const profile of audit.profiles) {
      expect(profile.requiredQualifyingRuns).toBe(10);
      expect(profile.observedQualifyingRuns).toBe(0);
      expect(profile.status).toBe('missing-real-canary');
    }
    expect(audit.qualifyingEvidenceRule).toMatchObject({
      requiresRealInternalTask: true,
      requiresNamedHumanOperator: true,
      fixtureCounts: false,
      syntheticCounts: false,
      unitOrE2eCounts: false,
      harnessGreenCounts: false,
    });
  });

  it('does not promote mechanism evidence into completed acceptance', () => {
    expect(audit.acceptanceCriteria).toEqual([
      expect.objectContaining({ id: 'profile-run-count', status: 'not-met' }),
      expect.objectContaining({ id: 'zero-unauthorized-write-or-leak', status: 'not-evaluable' }),
      expect.objectContaining({
        id: 'kill-switch-success',
        status: 'mechanism-proven-canary-missing',
      }),
      expect.objectContaining({ id: 'owner-decision', status: 'not-met' }),
    ]);
    expect(audit.frozenBoundaries).toMatchObject({
      liveReady: false,
      productApproved: false,
      defaultOn: false,
      c1ReductionFactor: 4.5,
      c1MeetsGate: false,
      c1Recommendation: 'keep-off',
      tf0006: 'blocked',
      runtimeMemory: 'diagnostics-only',
    });
  });

  it('blocks L3 when governance or day-one gates are missing', () => {
    const result = evaluateTf0009L3Readiness({
      profilesMissing: true,
      runbookPresent: true,
      day1GatesPresent: false,
    });
    expect(result.ready).toBe(false);
    expect(result.blockers.map(({ id }: { id: string }) => id)).toEqual([
      'day1-gates-missing',
      'profiles-missing',
    ]);
  });

  it('accepts only a field-complete, fail-closed three-profile governance object', () => {
    const profiles = completeProfiles();
    expect(hasSafeTf0009HardBounds(profiles)).toBe(true);
    expect(
      evaluateTf0009L3Readiness({
        profiles,
        runbookPresent: true,
        day1GatesPresent: true,
        day1Gates: completeDay1Gates(),
      }),
    ).toEqual({ ready: true, blockers: [] });

    profiles.roles.owner = '[FIXTURE-owner]';
    const blocked = evaluateTf0009L3Readiness({
      profiles,
      runbookPresent: true,
      day1GatesPresent: true,
      day1Gates: completeDay1Gates(),
    });
    expect(blocked.ready).toBe(false);
    expect(blocked.blockers).toContainEqual(expect.objectContaining({ id: 'role-owner-missing' }));
  });

  it('requires substantive Day-1 evidence instead of file presence', () => {
    const day1Gates = completeDay1Gates();
    expect(hasValidTf0009Day1Gates(day1Gates)).toBe(true);

    const invalid = structuredClone(day1Gates) as {
      steps: Array<{ name: string; ok: boolean; exitCode: number }>;
    };
    invalid.steps = invalid.steps.filter(({ name }) => name !== 'electron-critical-final');
    const blocked = evaluateTf0009L3Readiness({
      profiles: completeProfiles(),
      runbookPresent: true,
      day1GatesPresent: true,
      day1Gates: invalid,
    });
    expect(blocked.ready).toBe(false);
    expect(blocked.blockers).toContainEqual(expect.objectContaining({ id: 'day1-gates-invalid' }));
  });

  it('labels the historical overnight continue decision as non-authoritative', () => {
    const brief = readFileSync(join(root, 'docs/dev/handoffs/OVERNIGHT-HARVEST-BRIEF.md'), 'utf8');
    expect(brief).toContain('Authority correction');
    expect(brief).toContain('not the TF-0009 exit decision');
    expect(brief).toContain('0/10');
  });
});
