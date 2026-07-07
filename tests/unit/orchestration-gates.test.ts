import { describe, expect, it } from 'vitest';
import type { OrchestrationResultBundle } from '../../openclaw_runtime/src/agents/orchestration-result-bundle';
import {
  resolveMaxOneRepair,
  runSchemaComplianceGate,
  runVerifierGate,
} from '../../openclaw_runtime/src/agents/orchestration-gates';

function baseBundle(overrides: Partial<OrchestrationResultBundle> = {}): OrchestrationResultBundle {
  return {
    schemaVersion: 1,
    phase: 'completion',
    orchestrationRunId: 'orch_gate',
    taskGraphId: 'graph_gate',
    attempt: 1,
    status: 'verified',
    leadRole: 'planner',
    selectedRoles: ['tester'],
    roleOutcomes: [{
      roleName: 'tester',
      task: 'verify tests',
      phase: 'worker',
      attempt: 1,
      status: 'completed',
      childRunId: 'run_worker',
      evidenceRefs: [{ type: 'test', ref: 'tests/unit/example.test.ts', roleName: 'tester' }],
    }],
    artifacts: [],
    evidenceRefs: [{ type: 'test', ref: 'tests/unit/example.test.ts', roleName: 'tester' }],
    permissionEvents: [],
    failures: [],
    verifierReport: { decision: 'pass', reasons: [], evidenceRefs: [] },
    memoryProposals: [],
    traceIds: ['trace_gate'],
    ...overrides,
  };
}

describe('orchestration gates', () => {
  it('passes a well-formed verified bundle', () => {
    expect(runSchemaComplianceGate(baseBundle()).decision).toBe('pass');
    expect(runVerifierGate(baseBundle()).decision).toBe('pass');
  });

  it('fails a successful worker outcome without evidence', () => {
    const bundle = baseBundle({
      roleOutcomes: [{
        roleName: 'tester',
        task: 'verify tests',
        phase: 'worker',
        attempt: 1,
        status: 'completed',
        childRunId: 'run_worker',
        evidenceRefs: [],
      }],
      evidenceRefs: [],
    });
    const gate = runSchemaComplianceGate(bundle);
    expect(gate.decision).toBe('fail');
    expect(gate.reasons.map((reason) => reason.code)).toContain('missing_evidence');
  });

  it('fails a bundle without required ids', () => {
    const gate = runSchemaComplianceGate(baseBundle({ orchestrationRunId: '', taskGraphId: '' }));
    expect(gate.decision).toBe('fail');
    expect(gate.reasons.map((reason) => reason.code)).toEqual(
      expect.arrayContaining(['missing_orchestration_run_id', 'missing_task_graph_id']),
    );
  });

  it('normalizes verifier fail decisions', () => {
    const bundle = baseBundle({
      status: 'failed',
      verifierReport: {
        decision: 'fail',
        verifierRole: 'reviewer',
        reasons: [{ code: 'refuted', message: 'Verifier refuted worker evidence', evidenceRefs: [] }],
        evidenceRefs: [],
      },
    });
    const gate = runVerifierGate(bundle);
    expect(gate.decision).toBe('fail');
    expect(gate.reasons.map((reason) => reason.code)).toContain('verifier_failed');
  });

  it('normalizes verifier repair_required and allows only attempt 1 repair', () => {
    const bundle = baseBundle({
      status: 'repair_required',
      verifierReport: {
        decision: 'repair_required',
        verifierRole: 'reviewer',
        reasons: [{ code: 'missing_test', message: 'Need one focused test', evidenceRefs: [] }],
        evidenceRefs: [],
      },
    });
    const schemaGate = runSchemaComplianceGate(bundle);
    const verifierGate = runVerifierGate(bundle);
    const repair = resolveMaxOneRepair({ bundle, schemaGate, verifierGate });
    expect(verifierGate.decision).toBe('repair_required');
    expect(repair).toMatchObject({ allowed: true, action: 'repair', attempt: 2, maxAttempts: 1 });
  });

  it('blocks a second automatic repair decision', () => {
    const bundle = baseBundle({
      attempt: 2,
      status: 'repair_required',
      verifierReport: {
        decision: 'repair_required',
        reasons: [{ code: 'still_missing', message: 'Still missing evidence', evidenceRefs: [] }],
        evidenceRefs: [],
      },
    });
    const schemaGate = runSchemaComplianceGate(bundle);
    const verifierGate = runVerifierGate(bundle);
    const repair = resolveMaxOneRepair({ bundle, schemaGate, verifierGate });
    expect(repair).toMatchObject({ allowed: false, action: 'none', attempted: true, attempt: 2 });
    expect(repair.reason).toContain('repair attempt exhausted');
  });

  it('keeps first repair allowed and second repair exhausted under the P0 cap', () => {
    const firstAttemptBundle = baseBundle({
      attempt: 1,
      status: 'repair_required',
      verifierReport: {
        decision: 'repair_required',
        reasons: [{ code: 'missing_evidence', message: 'Need one evidence-backed repair.', evidenceRefs: [] }],
        evidenceRefs: [],
      },
    });
    const firstSchemaGate = runSchemaComplianceGate(firstAttemptBundle);
    const firstVerifierGate = runVerifierGate(firstAttemptBundle);
    const firstRepair = resolveMaxOneRepair({
      bundle: firstAttemptBundle,
      schemaGate: firstSchemaGate,
      verifierGate: firstVerifierGate,
    });
    expect(firstRepair.allowed).toBe(true);
    expect(firstRepair.attempt).toBe(2);

    const secondAttemptBundle = baseBundle({
      attempt: 2,
      status: 'repair_required',
      verifierReport: {
        decision: 'repair_required',
        reasons: [{ code: 'still_missing', message: 'Still missing evidence.', evidenceRefs: [] }],
        evidenceRefs: [],
      },
    });
    const secondSchemaGate = runSchemaComplianceGate(secondAttemptBundle);
    const secondVerifierGate = runVerifierGate(secondAttemptBundle);
    const secondRepair = resolveMaxOneRepair({
      bundle: secondAttemptBundle,
      schemaGate: secondSchemaGate,
      verifierGate: secondVerifierGate,
    });
    expect(secondRepair.allowed).toBe(false);
    expect(secondRepair.reason).toContain('repair attempt exhausted');
  });
});
