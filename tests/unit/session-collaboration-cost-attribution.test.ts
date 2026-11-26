// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { projectTaskTraceCosts, type TaskModelCall, type TaskModelUsage, type TaskTraceEvent } from '../../shared/task-system/trace';
import { normalizeRunScope } from '../../shared/types/identity-scope';
import { summarizeCollaborationUsage } from '../../shared/types/session-collaboration-usage';
import { readCollaborationTranscriptUsage } from '../../openclaw_runtime/src/infra/session-cost-usage';

it('deduplicates task calls and separates late settlement, missing price and conflicting receipts', () => {
  const run = normalizeRunScope({ runId: 'run', scope: { workspaceId: 'workspace-a', sessionKey: 'agent:main:writer' } });
  const credential = { taskNodeId: 'task', sessionKey: 'agent:main:writer', generation: 'generation-a', epoch: 1 } as TaskModelCall['credential'];
  const call: TaskModelCall = { callId: 'primary', runId: run.runId, credential, provider: 'fixture', model: 'fixture',
    taskRevision: 1, sourceDigest: 'a'.repeat(64), startedAt: 10, actorRole: 'assigned', attemptIndex: 0, provenance: { run } };
  const receipt: TaskModelUsage = { terminal: 'done', usage: { input: 10, output: 5, cacheRead: 3, cacheWrite: 2, total: 20 },
    costUsd: 0.001, priceVersion: 'price-v1', toolCallIdHashes: [], endedAt: 20 };
  const usageEvents: TaskTraceEvent[] = [];
  const event = (kind: string, payload: unknown) => usageEvents.push({ seq: usageEvents.length + 1, at: 20, kind, payload });
  const settle = (callId: string, usage: TaskModelUsage, source = 'runtime-model-call-observer') =>
    event('model_usage', { callId, usage, source });
  event('model_call_started', call);
  event('model_call_started', call);
  event('model_call_started', { ...call, callId: 'fallback', attemptIndex: 1, category: 'coordination' });
  event('model_call_started', { ...call, callId: 'forged' });
  event('model_call_started', { ...call, callId: 'conflict' });
  const read = () => projectTaskTraceCosts({ runEvents: [], usageEvents });
  expect(read().records[0]).toMatchObject({ run, state: 'unknown' });
  settle('primary', receipt);
  settle('primary', receipt);
  settle('fallback', { ...receipt, costUsd: null, priceVersion: null });
  settle('forged', receipt, 'tool-output');
  settle('conflict', receipt);
  settle('conflict', { ...receipt, terminal: 'conflicting' });
  const result = read();
  expect(result.duplicateObservations).toBe(2);
  expect(result.records.map(record => record.state)).toEqual(['known', 'known', 'unknown', 'conflict']);
  expect(result.records[1].call).toMatchObject({ attemptIndex: 1, category: 'coordination' });
  const totals = summarizeCollaborationUsage(result.records.map(record => ({
    tokens: record.usage?.usage ?? null, costUsd: record.usage?.costUsd ?? null,
    priceVersion: record.usage?.priceVersion ?? null, state: record.state,
  })));
  expect(totals).toMatchObject({ calls: 4, knownTokens: { total: 40, cacheRead: 6, cacheWrite: 4 }, totalTokens: null,
    knownSubtotalUsd: 0.001, totalUsd: null, unknownUsageCalls: 2, unknownPriceCalls: 3, conflicts: 1, priceVersions: ['price-v1'] });
});

it('reads native assistant records in the exact transcript generation after the original fork leaf', async () => {
  const root = mkdtempSync(join(tmpdir(), 'collaboration-usage-'));
  const target = 'agent:main:child', filePath = join(root, 'child.jsonl');
  const message = { role: 'assistant', provider: 'fixture', model: 'fixture', stopReason: 'stop',
    usage: { input: 8, output: 4, cacheRead: 2, cacheWrite: 1, totalTokens: 15, cost: { total: 0 } } };
  try {
    const call = { sessionKey: target, runId: 'run', attemptIndex: 0, modelCallIndex: 1 };
    const rows = [
      { type: 'session', id: 'child-generation', parentSession: 'source.jsonl' },
      { type: 'message', id: 'fork-leaf', message },
      { type: 'message', id: 'fake-tool', message: { ...message, role: 'toolResult' } },
      { type: 'message', id: 'mirror', message: { ...message, provider: 'gateway-injected' } },
      { type: 'message', id: 'first', message, modelCall: call },
      { type: 'message', id: 'replay', message, modelCall: call },
      { type: 'message', id: 'fallback', message, modelCall: { ...call, attemptIndex: 1 } },
    ];
    writeFileSync(filePath, rows.map(row => JSON.stringify(row)).join('\n') + '\n');
    const input = { filePath, sessionKey: target, sessionGeneration: 'child-generation', forkedFromLeafId: 'fork-leaf' };
    await expect(readCollaborationTranscriptUsage(input)).resolves.toMatchObject({ calls: 2, totalTokens: 30,
      knownTokens: { cacheRead: 4, cacheWrite: 2 }, totalUsd: null, unknownPriceCalls: 2 });
    await expect(readCollaborationTranscriptUsage({ ...input, sessionGeneration: 'old-generation' })).rejects.toThrow('TRANSCRIPT_STALE');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
