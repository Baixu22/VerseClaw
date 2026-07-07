import { describe, expect, it } from 'vitest';
import {
  buildCompletionPhaseResultBundle,
  buildSpawnPhaseResultBundle,
  renderOrchestrationResultBundleForPrompt,
} from '../../openclaw_runtime/src/agents/orchestration-result-bundle';

describe('orchestration result bundle', () => {
  it('builds a spawn-phase bundle with task graph, outcomes, failures, and trace refs', () => {
    const bundle = buildSpawnPhaseResultBundle({
      orchestrationRunId: 'orch_p0',
      taskGraphId: 'graph_p0',
      leadRole: 'planner',
      selectedRoles: ['tester', 'reviewer'],
      traceIds: ['trace_p0'],
      outcomes: [{
        roleName: 'tester',
        task: 'verify feature',
        phase: 'worker',
        attempt: 1,
        status: 'accepted',
        childRunId: 'run_worker',
        childSessionKey: 'child_worker',
        taskId: 'tester-1',
        evidenceRefs: [{ type: 'run', ref: 'run_worker', roleName: 'tester', taskId: 'tester-1' }],
      }],
      failures: [{ roleName: 'reviewer', status: 'forbidden', error: 'max children reached' }],
    });

    expect(bundle).toMatchObject({
      schemaVersion: 1,
      phase: 'spawn',
      orchestrationRunId: 'orch_p0',
      taskGraphId: 'graph_p0',
      leadRole: 'planner',
      selectedRoles: ['tester', 'reviewer'],
      traceIds: ['trace_p0'],
    });
    expect(bundle.roleOutcomes).toHaveLength(1);
    expect(bundle.failures[0]).toMatchObject({ roleName: 'reviewer', status: 'forbidden' });
  });

  it('builds a completion-phase bundle with worker evidence, verifier report, and memory proposals', () => {
    const bundle = buildCompletionPhaseResultBundle({
      orchestrationRunId: 'orch_done',
      taskGraphId: 'graph_done',
      leadRole: 'planner',
      selectedRoles: ['tester', 'reviewer'],
      roleOutcomes: [
        {
          roleName: 'tester',
          task: 'verify tests',
          phase: 'worker',
          attempt: 1,
          status: 'completed',
          childRunId: 'run_worker',
          childSessionKey: 'child_worker',
          taskId: 'tester-1',
          evidenceRefs: [{ type: 'test', ref: 'tests/unit/example.test.ts', roleName: 'tester' }],
          outputText: 'Verified tests/unit/example.test.ts passed.',
        },
      ],
      verifierReport: {
        decision: 'pass',
        verifierRole: 'reviewer',
        childRunId: 'run_verifier',
        reasons: [],
        evidenceRefs: [{ type: 'run', ref: 'run_verifier', roleName: 'reviewer' }],
      },
      memoryProposals: [{
        roleName: 'tester',
        scopeKey: 'orch_done',
        content: 'Testing role should cite exact test files.',
        evidenceRefs: [{ type: 'run', ref: 'run_worker', roleName: 'tester' }],
      }],
    });

    expect(bundle.phase).toBe('completion');
    expect(bundle.status).toBe('verified');
    expect(bundle.verifierReport?.decision).toBe('pass');
    expect(bundle.memoryProposals[0]?.content).toContain('cite exact test files');
  });

  it('renders prompt text from structured bundle fields', () => {
    const text = renderOrchestrationResultBundleForPrompt({
      schemaVersion: 1,
      phase: 'completion',
      orchestrationRunId: 'orch_render',
      taskGraphId: 'graph_render',
      attempt: 1,
      status: 'verified',
      leadRole: 'planner',
      selectedRoles: ['tester'],
      roleOutcomes: [],
      artifacts: [],
      evidenceRefs: [],
      permissionEvents: [],
      failures: [],
      verifierReport: { decision: 'pass', reasons: [], evidenceRefs: [] },
      memoryProposals: [],
      traceIds: [],
    });

    expect(text).toContain('OrchestrationResultBundle');
    expect(text).toContain('orchestrationRunId: orch_render');
    expect(text).toContain('verifierDecision: pass');
  });
});
