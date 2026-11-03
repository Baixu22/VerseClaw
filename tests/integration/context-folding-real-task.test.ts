// @vitest-environment node
/**
 * context-folding-rlm / TF-0693: integration-level fold protocol through the
 * real context_fold tool adapter and the real steering-queue projection.
 *
 * This test deliberately uses a controlled spawn adapter so it cannot claim a
 * live child-model run. The actual real-workspace, real-child execution is the
 * separate TF-0695 eval run.
 *
 * driven_by: agent; actor: codex/context-folding-rlm
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { WorkspaceId } from '../../shared/types/identity-scope';
import {
  createContextFoldRequest,
  createContextHandle,
  type ContextHandle,
} from '../../shared/types/context-folding';
import { bindContextFoldChildHandles, contextFoldDeliveryId } from '../../openclaw_runtime/src/context-engine/context-folding/fold';
import { createContextFoldTool } from '../../openclaw_runtime/src/agents/tools/context-fold-tool';
import type { SubagentRunRecord } from '../../openclaw_runtime/src/agents/subagent-registry.types';

const hash = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const WS = 'ws-integration' as WorkspaceId;
const NOW = '2026-11-03T00:00:00.000Z';
const PARENT = 'sess-integration-parent';
const CHILD_SESSION = 'agent:main:subagent:integration-child';
const CHILD_RUN = 'run-integration-child';

function handle(): ContextHandle {
  return createContextHandle({
    owner: 'workspace-file',
    scope: { workspaceId: WS, sessionId: PARENT },
    resourceId: 'src/taskboard.py',
    selector: { kind: 'lines', startLine: 20, endLine: 40 },
    content: 'def complete(self):\n    self.revision += 1\n',
    revision: 'rev-1',
  }, { hash, now: NOW });
}

function request() {
  return createContextFoldRequest({
    objective: 'Find the defect and run the focused test.',
    taskScope: { workspaceId: WS, workspaceRoot: 'D:/tmp/integration-fold' },
    inputRefs: [handle()],
    allowedTools: ['context_expand', 'read'],
    outputSchema: { kind: 'json-object', required: ['defectLocation'] },
    maxResultChars: 4_000,
    tokenBudget: 20_000,
    timeoutMs: 60_000,
    parentRunIdentity: { workspaceId: WS, sessionId: PARENT, depth: 0 },
  }, { hash });
}

function result(req: ReturnType<typeof request>, childHandles: ContextHandle[], overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 'ContextFoldResult/v1',
    foldId: req.foldId,
    childSessionKey: CHILD_SESSION,
    childRunId: CHILD_RUN,
    status: 'completed',
    summary: 'The completion path increments revision even when the task is already done.',
    structuredOutput: { defectLocation: 'src/taskboard.py:L22' },
    evidenceRefs: [{
      handleId: childHandles[0]!.handleId,
      resourceId: 'src/taskboard.py',
      selector: 'L21-L22',
      checksum: childHandles[0]!.checksum,
      kind: 'excerpt',
    }],
    unresolvedClaims: [],
    blockers: [],
    failedAttempts: [],
    inputRefs: [childHandles[0]!.handleId],
    usage: { totalTokens: 1200, latencyMs: 25 },
    diagnostics: [],
    rawChildTranscriptChars: 0,
    recursionDepth: 1,
    deliveryId: 'delivery-integration',
    drivenBy: 'agent',
    actor: 'child-worker',
    ...overrides,
  };
}

describe('context folding real adapter integration', () => {
  it('returns only a validated folded projection after a tool-using child completes', async () => {
    const req = request();
    let spawnedTask = '';
    let taggedDelivery = '';
    const tool = createContextFoldTool({
      sessionId: PARENT,
      workspaceRoot: WS,
      contextFoldingEnabled: true,
      contextFoldingNow: () => NOW,
      spawnTool: {
        execute: async (_call, args) => {
          spawnedTask = String((args as Record<string, unknown>).task);
          return { details: { status: 'accepted', childSessionKey: CHILD_SESSION, runId: CHILD_RUN } } as never;
        },
      },
      tagRun: (_runId, metadata) => {
        taggedDelivery = metadata.deliveryId;
        return true;
      },
    });
    expect(tool).not.toBeNull();
    const ack = (await tool!.execute('fold', { request: req, label: 'integration' })).details as Record<string, unknown>;
    expect(ack.ok).toBe(true);
    expect(taggedDelivery).toBe(contextFoldDeliveryId({ foldId: req.foldId, childRunId: CHILD_RUN, hash }));
    expect(spawnedTask).toContain('ContextFoldResult/v1');
    expect(spawnedTask).not.toContain(req.inputRefs[0]!.handleId);

    const childHandles = bindContextFoldChildHandles({ request: req, childSessionId: CHILD_SESSION, childSessionKey: CHILD_SESSION, hash });
    const deliveryId = contextFoldDeliveryId({ foldId: req.foldId, childRunId: CHILD_RUN, hash });
    const contextFold = { foldId: req.foldId, deliveryId, maxResultChars: 4000, childHandles: [] };
    const runs = new Map<string, SubagentRunRecord>([[CHILD_RUN, {
      runId: CHILD_RUN,
      childSessionKey: CHILD_SESSION,
      requesterSessionKey: PARENT,
      requesterDisplayKey: PARENT,
      task: spawnedTask,
      cleanup: 'keep',
      createdAt: 1,
      endedAt: 2,
      outcome: { status: 'ok' },
      contextFold,
      delivery: {
        status: 'pending',
        payload: {
          requesterSessionKey: PARENT,
          requesterDisplayKey: PARENT,
          childSessionKey: CHILD_SESSION,
          childRunId: CHILD_RUN,
          task: spawnedTask,
          endedAt: 2,
          outcome: { status: 'ok' },
          frozenResultText: JSON.stringify(result(req, childHandles, { deliveryId })),
          contextFold,
        },
      },
    }]]);
    const { leasePendingAgentSteeringItemsFromSubagentRuns } = await import('../../openclaw_runtime/src/agents/agent-steering-queue');
    const leased = leasePendingAgentSteeringItemsFromSubagentRuns({ runs, requesterSessionKey: PARENT, leaseId: 'lease-integration', now: 3 });
    expect(leased?.prompt).toContain('ContextFoldResult');
    expect(leased?.prompt).toContain('defectLocation');
    expect(leased?.prompt).toContain('not task completion authority');
    expect(leased?.prompt).not.toContain(req.inputRefs[0]!.handleId);
  });
});
