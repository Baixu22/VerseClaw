import { afterEach, describe, expect, it, vi } from 'vitest';

const subagentRegistryMock = vi.hoisted(() => ({
  runs: [] as Array<Record<string, unknown>>,
}));

vi.mock('../../openclaw_runtime/src/agents/subagent-registry', () => ({
  listSubagentRunsForRequester: (requesterSessionKey: string) => (
    subagentRegistryMock.runs.filter((entry) => entry.requesterSessionKey === requesterSessionKey)
  ),
}));

import {
  advanceClawGraphRun,
  extractClawGraphHandoff,
  resetClawGraphRunsForTests,
  startClawGraphRun,
} from '../../openclaw_runtime/src/agents/clawgraph/runtime';
import type { ClawGraphIR } from '../../openclaw_runtime/src/agents/clawgraph/types';
import type { SpawnFn } from '../../openclaw_runtime/src/agents/role-spawn';

const BASE_IR: ClawGraphIR = {
  schemaVersion: 1,
  workflowId: 'test_flow',
  title: 'Test Flow',
  objective: 'Verify ClawGraph runtime',
  maxParallel: 2,
  policies: [{ on: 'node_failed', action: 'retry', maxAttempts: 1 }],
  termination: ['all_required_nodes_done'],
  nodes: [
    {
      id: 'work',
      type: 'agent',
      role: 'planner',
      runtimeRole: 'planner',
      modelRef: null,
      task: 'Do the work.',
      dependsOn: [],
      checks: ['schema_valid', 'trace_exists', 'evidence_refs_exist', 'files_inside_workspace'],
      required: true,
    },
  ],
};

afterEach(() => {
  resetClawGraphRunsForTests();
  subagentRegistryMock.runs = [];
});

describe('ClawGraph runtime', () => {
  it('extracts fenced clawgraph_handoff JSON', () => {
    const handoff = extractClawGraphHandoff(`
done

\`\`\`clawgraph_handoff
{
  "nodeId": "work",
  "status": "done",
  "summary": "Implemented the slice.",
  "evidenceRefs": [{ "type": "subagent", "ref": "run_child" }],
  "filesTouched": ["src/app.ts"],
  "testsRun": ["pnpm test"],
  "decisions": [],
  "deviations": [],
  "risks": [],
  "followupTasks": [],
  "confidence": 0.9
}
\`\`\`
`, 'work');

    expect(handoff).toMatchObject({
      nodeId: 'work',
      status: 'done',
      summary: 'Implemented the slice.',
      evidenceRefs: [{ type: 'subagent', ref: 'run_child' }],
      confidence: 0.9,
    });
  });

  it('starts an agent node and completes it after subagent handoff evidence appears', async () => {
    const spawn: SpawnFn = async () => ({
      status: 'accepted',
      runId: 'run_child',
      childSessionKey: 'agent:main:child',
    });

    const started = await startClawGraphRun({
      ir: BASE_IR,
      sessionKey: 'agent:main:parent',
      workspaceRoot: process.cwd(),
      deps: { spawn },
    });

    expect(started.status).toBe('running');
    expect(started.nodes[0]).toMatchObject({
      status: 'running',
      childRunId: 'run_child',
    });

    subagentRegistryMock.runs.push({
      runId: 'run_child',
      childSessionKey: 'agent:main:child',
      requesterSessionKey: 'agent:main:parent',
      requesterDisplayKey: 'parent',
      task: 'Do the work.',
      cleanup: 'keep',
      createdAt: Date.now(),
      endedAt: Date.now(),
      outcome: { status: 'ok' },
      completion: {
        required: true,
        resultText: `\`\`\`clawgraph_handoff
{
  "nodeId": "work",
  "status": "done",
  "summary": "Finished with evidence.",
  "evidenceRefs": [{ "type": "subagent", "ref": "run_child" }],
  "filesTouched": ["src/index.ts"],
  "testsRun": ["pnpm test"],
  "decisions": [],
  "deviations": [],
  "risks": [],
  "followupTasks": [],
  "confidence": 0.8
}
\`\`\``,
      },
    });

    const completed = await advanceClawGraphRun(started.runId, {
      sessionKey: 'agent:main:parent',
      workspaceRoot: process.cwd(),
      deps: { spawn },
    });

    expect(completed?.status).toBe('complete');
    expect(completed?.nodes[0]).toMatchObject({
      status: 'done',
      audit: { passed: true },
    });
  });

  it('requests review when completed worker output has no valid handoff', async () => {
    const spawn: SpawnFn = async () => ({
      status: 'accepted',
      runId: 'run_invalid',
      childSessionKey: 'agent:main:child-invalid',
    });

    const started = await startClawGraphRun({
      ir: BASE_IR,
      sessionKey: 'agent:main:parent',
      workspaceRoot: process.cwd(),
      deps: { spawn },
    });

    subagentRegistryMock.runs.push({
      runId: 'run_invalid',
      childSessionKey: 'agent:main:child-invalid',
      requesterSessionKey: 'agent:main:parent',
      requesterDisplayKey: 'parent',
      task: 'Do the work.',
      cleanup: 'keep',
      createdAt: Date.now(),
      endedAt: Date.now(),
      outcome: { status: 'ok' },
      completion: {
        required: true,
        resultText: 'Finished, but forgot structured output.',
      },
    });

    const reviewed = await advanceClawGraphRun(started.runId, {
      sessionKey: 'agent:main:parent',
      workspaceRoot: process.cwd(),
      deps: { spawn },
    });

    expect(reviewed?.status).toBe('review');
    expect(reviewed?.reviewItems[0]).toMatchObject({
      kind: 'handoff_invalid',
      status: 'open',
      nodeId: 'work',
    });
  });
});
