// @vitest-environment node
/**
 * context-folding-rlm / TF-0693: pure fold preparation/parsing and the real
 * sessions_spawn-backed context_fold tool.
 *
 * driven_by: agent; actor: codex/context-folding-rlm
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { WorkspaceId } from '../../shared/types/identity-scope';
import {
  CONTEXT_FOLDING_LIMITS,
  ContextFoldingValidationError,
  createContextFoldRequest,
  createContextHandle,
  type ContextFoldRequest,
  type ContextHandle,
  type ContextRequesterIdentity,
} from '../../shared/types/context-folding';
import {
  bindContextFoldChildHandles,
  contextFoldDeliveryId,
  parseContextFoldChildOutput,
  prepareContextFold,
} from '../../openclaw_runtime/src/context-engine/context-folding/fold';
import { createContextFoldTool } from '../../openclaw_runtime/src/agents/tools/context-fold-tool';
import type { SubagentRunRecord } from '../../openclaw_runtime/src/agents/subagent-registry.types';

const hash = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const WS = 'ws-fold' as WorkspaceId;
const NOW = '2026-11-03T00:00:00.000Z';
const PARENT_SESSION = 'sess-parent';
const CHILD_SESSION = 'agent:main:subagent:child-1';
const CHILD_RUN = 'run-child-1';

function parentHandle(): ContextHandle {
  return createContextHandle({
    owner: 'workspace-file',
    scope: { workspaceId: WS, sessionId: PARENT_SESSION },
    resourceId: 'src/taskboard.py',
    selector: { kind: 'lines', startLine: 20, endLine: 40 },
    content: 'def complete(self):\n    self.revision += 1\n',
    revision: 'rev-1',
  }, { hash, now: NOW });
}

const parent: ContextRequesterIdentity = { workspaceId: WS, sessionId: PARENT_SESSION, actor: 'parent', depth: 0 };

function requestInput() {
  return {
    objective: 'Find the idempotency defect and run the focused test.',
    taskScope: { workspaceId: WS, workspaceRoot: 'D:/tmp/cf-fold' },
    inputRefs: [parentHandle()],
    allowedTools: ['context_expand', 'exec'],
    outputSchema: { kind: 'json-object' as const, required: ['defectLocation'] },
    maxResultChars: 4_000,
    tokenBudget: 20_000,
    timeoutMs: 60_000,
    parentRunIdentity: { workspaceId: WS, sessionId: PARENT_SESSION, depth: 0 as const },
  };
}

function request(): ContextFoldRequest {
  return createContextFoldRequest(requestInput(), { hash });
}

function childResult(overrides: Record<string, unknown> = {}, childHandles?: readonly ContextHandle[]): Record<string, unknown> {
  const req = request();
  const childHandle = childHandles?.[0] ?? bindContextFoldChildHandles({ request: req, childSessionId: CHILD_SESSION, childSessionKey: CHILD_SESSION, hash })[0]!;
  const base = {
    schemaVersion: 'ContextFoldResult/v1',
    foldId: req.foldId,
    childSessionKey: CHILD_SESSION,
    childRunId: CHILD_RUN,
    status: 'completed',
    summary: 'complete() increments revision on every call; guard already-completed tasks.',
    structuredOutput: { defectLocation: 'src/taskboard.py:L22' },
    evidenceRefs: [{
      handleId: childHandle.handleId,
      resourceId: childHandle.resourceId,
      selector: 'L21-L22',
      checksum: childHandle.checksum,
      kind: 'excerpt',
    }],
    unresolvedClaims: [],
    blockers: [],
    failedAttempts: [],
    inputRefs: [childHandle.handleId],
    usage: { inputTokens: 1000, outputTokens: 200, totalTokens: 1200, latencyMs: 25 },
    diagnostics: [],
    rawChildTranscriptChars: 0,
    recursionDepth: 1,
    deliveryId: 'delivery-1',
    drivenBy: 'agent',
    actor: 'child-worker',
    ...overrides,
  };
  return base;
}

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof ContextFoldingValidationError) return error.issues[0]!.code;
    throw error;
  }
  throw new Error('expected ContextFoldingValidationError');
}

function spawnResult(childSessionKey = 'agent:main:subagent:generated', runId = CHILD_RUN) {
  return { content: [{ type: 'text' as const, text: '{}' }], details: { status: 'accepted', childSessionKey, runId } };
}

function toolResult(result: unknown): Record<string, unknown> {
  return (result as { details: Record<string, unknown> }).details;
}

describe('context_fold pure preparation', () => {
  it('re-scopes every input handle for the child and never sends the parent handle bytes', () => {
    const req = request();
    const prepared = prepareContextFold({ request: req, parent, hash });
    expect(prepared.request.foldId).toBe(req.foldId);
    expect(prepared.childHandles).toHaveLength(1);
    expect(prepared.childHandles[0]!.handleId).not.toBe(req.inputRefs[0]!.handleId);
    expect(prepared.childHandles[0]!.derivedFrom).toBe(req.inputRefs[0]!.handleId);
    expect(prepared.childHandles[0]!.checksum).toBe(req.inputRefs[0]!.checksum);
    expect(prepared.childTask).toContain(prepared.childHandles[0]!.handleId);
    expect(prepared.childTask).not.toContain(req.inputRefs[0]!.handleId);
    expect(prepared.childTask.length).toBeLessThan(CONTEXT_FOLDING_LIMITS.foldResultMaxChars);
    expect(prepared.childTask).toContain('Do not write Task Ledger');
    expect(prepared.childTask).toContain('ContextFoldResult/v1');
  });

  it('rejects a foreign parent, wrong run id, depth 1 and an impossible result budget', () => {
    const req = request();
    expect(codeOf(() => prepareContextFold({ request: req, parent: { ...parent, sessionId: 'sess-other' }, hash }))).toBe('invalid_request');
    expect(codeOf(() => prepareContextFold({ request: req, parent: { ...parent, depth: 1 as never }, hash }))).toBe('recursion_depth_exceeded');
    expect(codeOf(() => prepareContextFold({ request: { ...req, parentRunIdentity: { ...req.parentRunIdentity, runId: 'run-declared' as never } }, parent, parentRunId: 'run-other', hash }))).toBe('invalid_request');
    expect(codeOf(() => prepareContextFold({ request: { ...req, tokenBudget: 1 }, parent, hash }))).toBe('invalid_request');
  });

  it('builds a child task with the exact objective, tools, handle scope and output contract', () => {
    const req = request();
    const prepared = prepareContextFold({ request: req, parent, hash });
    expect(prepared.childTask).toContain(req.objective);
    expect(prepared.childTask).toContain('context_expand, exec');
    expect(prepared.childTask).toContain('D:/tmp/cf-fold');
    expect(prepared.childTask).toContain('Maximum returned output: 4000 characters');
    expect(prepared.childTask).toContain('Input handles');
  });

  it('parses a complete child result and projects it to the parent budget', () => {
    const req = request();
    const childHandles = bindContextFoldChildHandles({ request: req, childSessionId: CHILD_SESSION, childSessionKey: CHILD_SESSION, hash });
    const parsed = parseContextFoldChildOutput({ request: req, child: { childRunId: CHILD_RUN, childSessionKey: CHILD_SESSION }, childHandles, output: JSON.stringify(childResult({}, childHandles)), deliveryId: 'delivery-1', latencyMs: 30 });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.result.childRunId).toBe(CHILD_RUN);
    expect(parsed.result.childSessionKey).toBe(CHILD_SESSION);
    expect(parsed.result.rawChildTranscriptChars).toBe(0);
    expect(parsed.result.recursionDepth).toBe(1);
  });

  it('rejects malformed, over-budget, transcript-shaped and wrongly-identified results', () => {
    const req = request();
    const childHandles = bindContextFoldChildHandles({ request: req, childSessionId: CHILD_SESSION, childSessionKey: CHILD_SESSION, hash });
    const input = { request: req, child: { childRunId: CHILD_RUN, childSessionKey: CHILD_SESSION }, childHandles, deliveryId: 'delivery-1', latencyMs: 30 };
    expect(parseContextFoldChildOutput({ ...input, output: 'not json' })).toMatchObject({ ok: false, diagnostic: { code: 'invalid_result' } });
    expect(parseContextFoldChildOutput({ ...input, output: 'x'.repeat(CONTEXT_FOLDING_LIMITS.rawChildTranscriptMaxChars + 1) })).toMatchObject({ ok: false, diagnostic: { code: 'raw_transcript_rejected' } });
    expect(parseContextFoldChildOutput({ ...input, output: JSON.stringify(childResult({ childRunId: 'run-other' }, childHandles)) })).toMatchObject({ ok: false, diagnostic: { code: 'child_identity_mismatch' } });
    expect(parseContextFoldChildOutput({ ...input, output: JSON.stringify(childResult({ transcript: 'raw' }, childHandles)) })).toMatchObject({ ok: false, diagnostic: { code: 'raw_transcript_rejected' } });
    expect(parseContextFoldChildOutput({ ...input, output: JSON.stringify(childResult({ foldId: 'cff_00000000000000000000000000000000' }, childHandles)) })).toMatchObject({ ok: false, diagnostic: { code: 'unknown_delivery' } });
  });

  it('accepts a fenced JSON response but never a second/unknown delivery identity', () => {
    const req = request();
    const childHandles = bindContextFoldChildHandles({ request: req, childSessionId: CHILD_SESSION, childSessionKey: CHILD_SESSION, hash });
    const input = { request: req, child: { childRunId: CHILD_RUN, childSessionKey: CHILD_SESSION }, childHandles, deliveryId: 'delivery-1', latencyMs: 30 };
    const parsed = parseContextFoldChildOutput({ ...input, output: '```json\n' + JSON.stringify(childResult({}, childHandles)) + '\n```' });
    expect(parsed.ok).toBe(true);
    expect(contextFoldDeliveryId({ foldId: req.foldId, childRunId: CHILD_RUN, hash })).toMatch(/^cfd_[0-9a-f]{32}$/);
  });
});

describe('context_fold tool', () => {
  it('requires the feature flag and returns a fold acknowledgement with the child identity', async () => {
    const calls: unknown[] = [];
    const tool = createContextFoldTool({
      sessionId: PARENT_SESSION,
      workspaceRoot: WS,
      contextFoldingEnabled: true,
      contextFoldingNow: () => NOW,
      spawnTool: { execute: async () => spawnResult() as never },
      tagRun: () => true,
      onSpawn: (input) => calls.push(input),
    });
    expect(tool?.name).toBe('context_fold');
    const result = toolResult(await tool!.execute('call-1', {
      request: request(),
      label: 'fold-1',
    }));
    expect(result.childSessionKey).toBe('agent:main:subagent:generated');
    expect(result.deliveryId).toMatch(/^cfd_/);
    expect(calls).toHaveLength(1);
    expect(String((calls[0] as { task: string }).task)).toContain('ContextFoldResult/v1');
    expect(createContextFoldTool({ sessionId: PARENT_SESSION, contextFoldingEnabled: false })).toBeNull();
  });

  it('fails closed when spawn is forbidden or returns no child identity', async () => {
    const base = { sessionId: PARENT_SESSION, workspaceRoot: WS, contextFoldingEnabled: true };
    const forbidden = createContextFoldTool({ ...base, spawnTool: { execute: async () => ({ details: { status: 'forbidden', error: 'no spawn' } }) as never }, tagRun: () => true })!;
    expect(toolResult(await forbidden.execute('call-1', { request: requestInput(), label: 'fold-2' }))).toMatchObject({ ok: false });
    const missing = createContextFoldTool({ ...base, spawnTool: { execute: async () => ({ details: { status: 'accepted' } }) as never }, tagRun: () => true })!;
    expect(toolResult(await missing.execute('call-2', { request: requestInput(), label: 'fold-3' }))).toMatchObject({ ok: false });
  });
});

describe('context folding steering projection', () => {
  it('renders only the validated ContextFoldResult for a tagged child delivery', async () => {
    const req = request();
    const childHandles = bindContextFoldChildHandles({ request: req, childSessionId: CHILD_SESSION, childSessionKey: CHILD_SESSION, hash });
    const deliveryId = contextFoldDeliveryId({ foldId: req.foldId, childRunId: CHILD_RUN, hash });
    const payload = childResult({ deliveryId }, childHandles);
    const contextFold = { foldId: req.foldId, deliveryId, maxResultChars: 4000, childHandles: [] };
    const runs = new Map<string, SubagentRunRecord>([[CHILD_RUN, {
      runId: CHILD_RUN,
      childSessionKey: CHILD_SESSION,
      requesterSessionKey: PARENT_SESSION,
      requesterDisplayKey: PARENT_SESSION,
      task: 'folded child',
      cleanup: 'keep',
      createdAt: 1,
      endedAt: 2,
      outcome: { status: 'ok' },
      contextFold,
      delivery: {
        status: 'pending',
        payload: {
          requesterSessionKey: PARENT_SESSION,
          requesterDisplayKey: PARENT_SESSION,
          childSessionKey: CHILD_SESSION,
          childRunId: CHILD_RUN,
          task: 'folded child',
          endedAt: 2,
          outcome: { status: 'ok' },
          frozenResultText: JSON.stringify(payload),
          contextFold,
        },
      },
    }]]);
    const { leasePendingAgentSteeringItemsFromSubagentRuns } = await import('../../openclaw_runtime/src/agents/agent-steering-queue');
    const leased = leasePendingAgentSteeringItemsFromSubagentRuns({ runs, requesterSessionKey: PARENT_SESSION, leaseId: 'lease-1', now: 3 });
    expect(leased).toBeDefined();
    expect(leased!.prompt).toContain('ContextFoldResult');
    expect(leased!.prompt).toContain('complete() increments revision');
    expect(leased!.prompt).not.toContain('raw child transcript');
    expect(leased!.prompt).toContain('not task completion authority');
  });

  it('rejects malformed and duplicate tagged deliveries without injecting raw text', async () => {
    const req = request();
    const childHandles = bindContextFoldChildHandles({ request: req, childSessionId: CHILD_SESSION, childSessionKey: CHILD_SESSION, hash });
    const deliveryId = contextFoldDeliveryId({ foldId: req.foldId, childRunId: CHILD_RUN, hash });
    const contextFold = { foldId: req.foldId, deliveryId, maxResultChars: 4000, childHandles: [] };
    const basePayload = {
      requesterSessionKey: PARENT_SESSION,
      requesterDisplayKey: PARENT_SESSION,
      childSessionKey: CHILD_SESSION,
      childRunId: CHILD_RUN,
      task: 'folded child',
      endedAt: 2,
      outcome: { status: 'ok' },
      contextFold,
    };
    const makeRun = (frozenResultText: string, outcome: SubagentRunRecord['outcome'] = { status: 'ok' }) => new Map<string, SubagentRunRecord>([[CHILD_RUN, {
      runId: CHILD_RUN,
      childSessionKey: CHILD_SESSION,
      requesterSessionKey: PARENT_SESSION,
      requesterDisplayKey: PARENT_SESSION,
      task: 'folded child',
      cleanup: 'keep',
      createdAt: 1,
      endedAt: 2,
      outcome,
      contextFold,
      delivery: { status: 'pending', payload: { ...basePayload, frozenResultText, outcome } },
    }]]);
    const { leasePendingAgentSteeringItemsFromSubagentRuns } = await import('../../openclaw_runtime/src/agents/agent-steering-queue');
    const malformed = leasePendingAgentSteeringItemsFromSubagentRuns({ runs: makeRun('raw child transcript'), requesterSessionKey: PARENT_SESSION, leaseId: 'lease-2', now: 3 });
    expect(malformed?.prompt).toContain('ContextFoldResult rejected');
    expect(malformed?.prompt).not.toContain('raw child transcript');
    const duplicate = leasePendingAgentSteeringItemsFromSubagentRuns({ runs: makeRun(JSON.stringify(childResult({ deliveryId: 'cfd_duplicate' }, childHandles))), requesterSessionKey: PARENT_SESSION, leaseId: 'lease-3', now: 4 });
    expect(duplicate?.prompt).toContain('duplicate_delivery');
    const timedOut = leasePendingAgentSteeringItemsFromSubagentRuns({ runs: makeRun(JSON.stringify(childResult({ deliveryId }, childHandles)), { status: 'timeout' }), requesterSessionKey: PARENT_SESSION, leaseId: 'lease-4', now: 5 });
    expect(timedOut?.prompt).toContain('ContextFoldResult rejected');
    expect(timedOut?.prompt).toContain('timeout');
  });
});
