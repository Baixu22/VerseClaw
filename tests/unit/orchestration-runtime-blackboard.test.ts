import { describe, expect, it } from 'vitest';
import { buildRuntimeBlackboard } from '../../openclaw_runtime/src/agents/orchestration-runtime-blackboard';
import type { OrchestrationResultBundle } from '../../openclaw_runtime/src/agents/orchestration-result-bundle';

function bundle(): OrchestrationResultBundle {
  return {
    schemaVersion: 1,
    phase: 'spawn',
    orchestrationRunId: 'orch_runtime_bb',
    taskGraphId: 'graph_runtime_bb',
    attempt: 1,
    status: 'partial',
    leadRole: 'planner',
    selectedRoles: ['implementer', 'tester'],
    roleOutcomes: [
      {
        roleName: 'implementer',
        task: 'Implement bounded blackboard',
        phase: 'worker',
        taskId: 'impl-1',
        attempt: 1,
        status: 'completed',
        childRunId: 'run_impl',
        evidenceRefs: [{ type: 'trace', ref: 'trace:impl', roleName: 'implementer', taskId: 'impl-1' }],
        outputText: 'Implemented blackboard projection.',
      },
    ],
    artifacts: [],
    evidenceRefs: [{ type: 'trace', ref: 'trace:impl', roleName: 'implementer', taskId: 'impl-1' }],
    permissionEvents: [],
    failures: [{ roleName: 'tester', status: 'forbidden', error: 'max children reached' }],
    memoryProposals: [],
    traceIds: ['trace_runtime_bb'],
  };
}

describe('runtime orchestration blackboard projection', () => {
  it('derives typed entries, summary, and replayable trace events without granting authority', () => {
    const result = buildRuntimeBlackboard({
      resultBundle: bundle(),
      failures: [{ roleName: 'tester', status: 'forbidden', error: 'max children reached' }],
      knownRoleNames: ['planner', 'implementer', 'tester'],
      now: '2026-07-08T00:00:00.000Z',
    });

    expect(result.state.entries.map((entry) => entry.type)).toEqual(['claim', 'risk']);
    expect(result.summary).toMatchObject({
      entryCount: 2,
      openRisks: 1,
      unresolvedConflicts: 0,
      trustBoundaries: ['role-output'],
    });
    expect(result.traceEvents).toHaveLength(2);
    expect(result.state.entries.every((entry) => entry.trustBoundary === 'role-output')).toBe(true);
    expect(JSON.stringify(result.state.entries)).not.toContain('"tools"');
    expect(JSON.stringify(result.state.entries)).not.toContain('"permissions"');
    expect(JSON.stringify(result.state.entries)).not.toContain('"memoryWrite"');
  });
});
