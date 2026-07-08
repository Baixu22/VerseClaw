import { describe, expect, it } from 'vitest';
import {
  appendBlackboardEntry,
  createBlackboardState,
} from '../../openclaw_runtime/src/agents/orchestration-blackboard';
import { runSchemaComplianceGate, runVerifierGate } from '../../openclaw_runtime/src/agents/orchestration-gates';
import type { OrchestrationResultBundle } from '../../openclaw_runtime/src/agents/orchestration-result-bundle';
import { readBlackboardVerifierEvidence } from '../../openclaw_runtime/src/agents/orchestration-blackboard-verifier';
import { buildRuntimeBlackboard } from '../../openclaw_runtime/src/agents/orchestration-runtime-blackboard';

const knownRoles = ['planner', 'implementer', 'tester', 'reviewer'];

function bundleWithoutWorkerEvidence(): OrchestrationResultBundle {
  return {
    schemaVersion: 1,
    phase: 'completion',
    orchestrationRunId: 'orch_blackboard_verifier',
    taskGraphId: 'graph_blackboard_verifier',
    attempt: 1,
    status: 'verified',
    leadRole: 'planner',
    selectedRoles: ['tester'],
    roleOutcomes: [{
      roleName: 'tester',
      task: 'verify blackboard evidence',
      phase: 'worker',
      attempt: 1,
      status: 'completed',
      childRunId: 'run_worker',
      evidenceRefs: [],
    }],
    artifacts: [],
    evidenceRefs: [],
    permissionEvents: [],
    failures: [],
    verifierReport: { decision: 'pass', reasons: [], evidenceRefs: [] },
    memoryProposals: [],
    traceIds: ['trace_blackboard_verifier'],
  };
}

describe('orchestration blackboard verifier evidence projection', () => {
  it('returns read-only verifier-visible evidence summaries', () => {
    const first = appendBlackboardEntry(
      createBlackboardState(),
      {
        id: 'bb_fact_visible_1',
        type: 'fact',
        authorRole: 'tester',
        taskId: 'task-verifier-1',
        content: { text: 'Regression suite passed.' },
        confidence: 0.84,
        evidenceRefs: ['trace:regression'],
        visibility: 'verifier',
        status: 'open',
        trustBoundary: 'role-output',
      },
      knownRoles,
      '2026-07-07T04:00:00.000Z',
    );
    const second = appendBlackboardEntry(
      first.state,
      {
        id: 'bb_claim_hidden_1',
        type: 'claim',
        authorRole: 'implementer',
        taskId: 'task-verifier-2',
        content: { subject: 'hidden', conclusion: 'role-only' },
        confidence: 0.5,
        evidenceRefs: ['trace:hidden'],
        visibility: 'role',
        status: 'open',
        trustBoundary: 'role-output',
      },
      knownRoles,
      '2026-07-07T04:01:00.000Z',
    );
    const third = appendBlackboardEntry(
      second.state,
      {
        id: 'bb_risk_superseded_1',
        type: 'risk',
        authorRole: 'reviewer',
        taskId: 'task-verifier-3',
        content: { text: 'Old risk.' },
        confidence: 0.41,
        evidenceRefs: [],
        visibility: 'run',
        status: 'superseded',
        trustBoundary: 'role-output',
      },
      knownRoles,
      '2026-07-07T04:02:00.000Z',
    );

    const evidence = readBlackboardVerifierEvidence(third.state);

    expect(evidence).toEqual([{
      id: 'bb_fact_visible_1',
      type: 'fact',
      evidenceRefs: ['trace:regression'],
      confidence: 0.84,
      trustBoundary: 'role-output',
      status: 'open',
      verified: false,
    }]);
  });

  it('does not let blackboard evidence bypass P0 schema or verifier gates', () => {
    const state = appendBlackboardEntry(
      createBlackboardState(),
      {
        id: 'bb_fact_gate_1',
        type: 'fact',
        authorRole: 'tester',
        taskId: 'task-verifier-gate',
        content: { text: 'Evidence exists on the blackboard.' },
        confidence: 0.9,
        evidenceRefs: ['trace:blackboard-only'],
        visibility: 'verifier',
        status: 'open',
        trustBoundary: 'role-output',
      },
      knownRoles,
    ).state;

    expect(readBlackboardVerifierEvidence(state)).toHaveLength(1);
    expect(runSchemaComplianceGate(bundleWithoutWorkerEvidence()).decision).toBe('fail');
    expect(runVerifierGate(bundleWithoutWorkerEvidence()).decision).toBe('fail');
  });

  it('projects runtime blackboard evidence for verifier but still marks it unverified', () => {
    const projection = buildRuntimeBlackboard({
      resultBundle: {
        schemaVersion: 1,
        phase: 'spawn',
        orchestrationRunId: 'orch_blackboard_gate',
        taskGraphId: 'graph_blackboard_gate',
        attempt: 1,
        status: 'verified',
        leadRole: 'planner',
        selectedRoles: ['implementer'],
        roleOutcomes: [{
          roleName: 'implementer',
          task: 'Implement without evidence',
          phase: 'worker',
          taskId: 'impl-no-evidence',
          attempt: 1,
          status: 'completed',
          evidenceRefs: [],
        }],
        artifacts: [],
        evidenceRefs: [],
        permissionEvents: [],
        failures: [],
        memoryProposals: [],
        traceIds: ['trace_blackboard_gate'],
      },
      failures: [],
      knownRoleNames: ['planner', 'implementer'],
      now: '2026-07-08T00:00:00.000Z',
    });

    const verifierEvidence = readBlackboardVerifierEvidence(projection.state);

    expect(verifierEvidence).toHaveLength(1);
    expect(verifierEvidence[0]).toMatchObject({ verified: false, trustBoundary: 'role-output' });
    expect(runSchemaComplianceGate({
      ...bundleWithoutWorkerEvidence(),
      orchestrationRunId: 'orch_blackboard_gate',
      taskGraphId: 'graph_blackboard_gate',
      leadRole: 'planner',
      selectedRoles: ['implementer'],
      roleOutcomes: [{
        roleName: 'implementer',
        task: 'Implement without evidence',
        phase: 'worker',
        taskId: 'impl-no-evidence',
        attempt: 1,
        status: 'completed',
        evidenceRefs: [],
      }],
      traceIds: ['trace_blackboard_gate'],
    }).decision).toBe('fail');
  });
});
