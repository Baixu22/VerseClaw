import { describe, expect, it } from 'vitest';
import type { OrchestrationResultBundle } from '../../openclaw_runtime/src/agents/orchestration-result-bundle';
import {
  synthesizeOrchestrationResult,
  type BlackboardSynthesisSummary,
} from '../../openclaw_runtime/src/agents/orchestration-synthesizer';

const evidence = [
  { type: 'trace', ref: 'trace:worker-a', roleName: 'implementer', taskId: 'impl-1' },
  { type: 'test', ref: 'vitest:unit', roleName: 'tester', taskId: 'test-1' },
] satisfies OrchestrationResultBundle['evidenceRefs'];

function completionBundle(overrides: Partial<OrchestrationResultBundle> = {}): OrchestrationResultBundle {
  return {
    schemaVersion: 1,
    phase: 'completion',
    orchestrationRunId: 'orch_p4_synthesis',
    taskGraphId: 'graph_p4_synthesis',
    attempt: 1,
    status: 'verified',
    leadRole: 'planner',
    selectedRoles: ['implementer', 'tester'],
    roleOutcomes: [
      {
        roleName: 'implementer',
        task: 'Implement the change',
        phase: 'worker',
        taskId: 'impl-1',
        attempt: 1,
        status: 'completed',
        childRunId: 'run_impl',
        evidenceRefs: [evidence[0]],
        outputText: 'Implemented the runtime helper and added unit tests.',
      },
      {
        roleName: 'tester',
        task: 'Verify the change',
        phase: 'worker',
        taskId: 'test-1',
        attempt: 1,
        status: 'completed',
        childRunId: 'run_test',
        evidenceRefs: [evidence[1]],
        outputText: 'Unit tests passed for the focused P4 helpers.',
      },
    ],
    artifacts: [{ id: 'artifact-summary', type: 'report', ref: 'artifact:p4-summary', roleName: 'tester' }],
    evidenceRefs: evidence,
    permissionEvents: [],
    failures: [],
    verifierReport: {
      decision: 'pass',
      verifierRole: 'skeptic',
      reasons: [],
      evidenceRefs: [evidence[1]],
    },
    memoryProposals: [],
    traceIds: ['trace-runtime-p4'],
    ...overrides,
  };
}

const blackboardSummary: BlackboardSynthesisSummary = {
  entryCount: 5,
  unresolvedConflicts: 1,
  openQuestions: 1,
  openRisks: 1,
  memoryProposals: 1,
  evidenceRefs: ['bb:evidence:1'],
  trustBoundaries: ['role-output', 'tool-output'],
};

describe('orchestration synthesizer', () => {
  it('returns deterministic synthesis while preserving roles, evidence, artifacts, traces, and blackboard summary', () => {
    const input = {
      bundle: completionBundle(),
      blackboardSummary,
    };

    const first = synthesizeOrchestrationResult(input);
    const second = synthesizeOrchestrationResult(input);

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      schemaVersion: 1,
      orchestrationRunId: 'orch_p4_synthesis',
      taskGraphId: 'graph_p4_synthesis',
      status: 'verified',
      verifier: { decision: 'pass' },
      policy: {
        toolAccess: 'none',
        verifierAuthority: 'preserved',
        memoryWrite: 'none',
      },
      blackboardSummary,
    });
    expect(first.roleContributions).toEqual([
      expect.objectContaining({
        roleName: 'implementer',
        taskId: 'impl-1',
        status: 'completed',
        evidenceRefs: [evidence[0]],
        outputPreview: 'Implemented the runtime helper and added unit tests.',
      }),
      expect.objectContaining({
        roleName: 'tester',
        taskId: 'test-1',
        status: 'completed',
        evidenceRefs: [evidence[1]],
      }),
    ]);
    expect(first.artifactRefs).toEqual([{ id: 'artifact-summary', type: 'report', ref: 'artifact:p4-summary', roleName: 'tester' }]);
    expect(first.evidenceRefs).toEqual(evidence);
    expect(first.traceIds).toEqual(['trace-runtime-p4']);
  });

  it('preserves verifier failure instead of reporting success', () => {
    const failed = completionBundle({
      status: 'failed',
      verifierReport: {
        decision: 'fail',
        verifierRole: 'skeptic',
        evidenceRefs: [evidence[1]],
        reasons: [{
          code: 'missing_required_test',
          message: 'The verifier could not find the required regression test.',
          evidenceRefs: [evidence[1]],
        }],
      },
      failures: [{ roleName: 'tester', status: 'failed', error: 'regression test missing', taskId: 'test-1' }],
    });

    const synthesis = synthesizeOrchestrationResult({ bundle: failed });

    expect(synthesis.status).toBe('failed');
    expect(synthesis.verifier.decision).toBe('fail');
    expect(synthesis.summary).toContain('Verifier failed');
    expect(synthesis.visibleFailures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'missing_required_test',
          message: 'The verifier could not find the required regression test.',
        }),
        expect.objectContaining({
          roleName: 'tester',
          message: 'regression test missing',
        }),
      ]),
    );
  });

  it('keeps repair-required status visible without granting tools or memory writes', () => {
    const repairRequired = completionBundle({
      status: 'repair_required',
      verifierReport: {
        decision: 'repair_required',
        verifierRole: 'skeptic',
        evidenceRefs: [evidence[1]],
        reasons: [{
          code: 'repair_needed',
          message: 'One worker needs a bounded repair.',
          evidenceRefs: [evidence[1]],
        }],
      },
    });

    const synthesis = synthesizeOrchestrationResult({ bundle: repairRequired });

    expect(synthesis.status).toBe('repair_required');
    expect(synthesis.summary).toContain('Repair required');
    expect(synthesis.policy).toEqual({
      toolAccess: 'none',
      verifierAuthority: 'preserved',
      memoryWrite: 'none',
    });
  });
});
