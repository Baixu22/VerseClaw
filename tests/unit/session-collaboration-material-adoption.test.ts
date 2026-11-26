// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { materialToolResult, withMaterialPromptUse } from '../../openclaw_runtime/src/agents/session-collaboration-material-prompt';
import type { StreamFn } from '../../openclaw_runtime/src/agents/runtime/index';
import { resolveTaskDomain } from '../../shared/task-system/identity';
import { TaskSystemStore } from '../../shared/task-system/store';
import type { TaskMaterialObservation } from '../../shared/task-system/trace';
import { normalizeRunScope, type AutonomySessionScope } from '../../shared/types/identity-scope';
import { materialReference, emptyMaterialPage, type SessionCollaborationMaterial } from '../../shared/types/session-collaboration-material';

const scope = { workspaceId: 'workspace-a', projectId: 'workspace-a',
  sessionKey: 'agent:main:consumer', sessionGeneration: 'generation' } as AutonomySessionScope;
const source = { ...scope, sessionKey: 'agent:main:source' as AutonomySessionScope['sessionKey'] };
const runId = 'actual-reading-run';
const material: SessionCollaborationMaterial = {
  id: 'finding', version: 1, authorityId: 'original-task-owner', taskNodeId: 'source-task' as SessionCollaborationMaterial['taskNodeId'],
  taskRevision: 1, taskDigest: 'a'.repeat(64), contentDigest: 'b'.repeat(64), sourceGeneration: source.sessionGeneration,
  sourceRun: normalizeRunScope({ scope: source, runId: 'publish-run' }), kind: 'claim', state: 'claim',
  summary: 'Only the final qualified request gets these bytes.', sensitivity: 'internal', evidenceRefs: [], createdAt: 1,
};

it('hydrates an intact current tool result and records only bytes delivered with a successful response', async () => {
  const reader = { ...emptyMaterialPage({ requester: scope }, 'ready'), scanned: 1, detail: { material, state: 'claim' as const } };
  const detail = vi.fn().mockResolvedValue(reader.detail);
  const record = vi.fn();
  const message = { role: 'assistant', content: [{ type: 'text', text: 'Result' }], stopReason: 'stop' } as
    Awaited<ReturnType<Awaited<ReturnType<StreamFn>>['result']>>;
  let outbound: unknown;
  const provider: StreamFn = async (model, context, options) => {
    const payload = { messages: context.messages };
    outbound = await options?.onPayload?.(payload, model) ?? payload;
    return {
      async *[Symbol.asyncIterator]() { yield { type: 'done' as const, reason: 'stop' as const, message }; },
      async result() { return message; },
    };
  };
  const stream = withMaterialPromptUse(provider, { runId, modelCallId: 'provider-call-1', read: detail, record });
  const payload = await materialToolResult(reader, 'tool-1', { runId });
  const text = JSON.stringify(payload, null, 2);
  expect(text).not.toContain(material.summary);
  const context: Parameters<StreamFn>[1] = { messages: [{ role: 'toolResult', toolName: 'sessions_list', toolCallId: 'tool-1',
    timestamp: 1, isError: false, content: [{ type: 'text', text }] }] };
  const model = {} as Parameters<StreamFn>[0];
  const first = await stream(model, context);
  expect(JSON.stringify(outbound)).toContain(material.summary);
  for await (const event of first) expect(event.type).toBe('done');
  await first.result();
  expect(record).toHaveBeenCalledTimes(1);
  expect(record.mock.calls[0][0]).toMatchObject([{ phase: 'prompt-used', modelCallId: 'provider-call-1' },
    { phase: 'outcome', responseDigest: expect.stringMatching(/^[a-f0-9]{64}$/) }]);
  expect(JSON.stringify(context)).not.toContain(material.summary);

  detail.mockResolvedValueOnce({ ...reader.detail, state: 'revoked' });
  await (await stream(model, context)).result();
  expect(JSON.stringify(outbound)).not.toContain(material.summary);
  await (await stream(model, context, { onPayload: () => ({ messages: [] }) })).result();
  expect(record).toHaveBeenCalledTimes(1);
  const old = withMaterialPromptUse(provider, { runId: 'later-run', modelCallId: 'different-call', read: detail, record });
  await (await old(model, context)).result();
  expect(JSON.stringify(outbound)).not.toContain(material.summary);
  expect(record).toHaveBeenCalledTimes(1);
});

it('records presentation and model observations in the original consumer task without a writer change', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'collaboration-material-observation-'));
  const store = new TaskSystemStore(resolveTaskDomain(workspace));
  try {
    const { task } = store.create({ objective: 'Reuse one result', target: 'result.txt', constraints: [],
      acceptance: [{ id: 'result', description: 'Check result', verification: { kind: 'owner-receipt', owner: 'fixture' } }],
    }, 'create');
    const claim = store.claim(task.contract.taskNodeId, scope.sessionKey, scope.sessionGeneration, 'claim').claim!;
    const observation: TaskMaterialObservation = { id: 'display-1', phase: 'presented', run: null, ref: materialReference(material), reader: scope, source };
    store.recordMaterialObservations([observation, observation]);
    const run = normalizeRunScope({ scope, runId });
    store.recordMaterialObservations([{ ...observation, id: 'tool-1', run, phase: 'candidate' }]);
    expect(store.traceSnapshot(claim.taskNodeId).events.filter(event => event.kind === 'material_observation')
      .map(event => event.payload)).toEqual([observation, { ...observation, id: 'tool-1', run, phase: 'candidate' }]);
    expect(store.get(claim.taskNodeId).claim).toEqual(claim);
  } finally {
    store.close();
    rmSync(workspace, { recursive: true, force: true });
  }
});
