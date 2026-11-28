// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { projectTaskTraceCosts, projectTaskTracePhases, type TaskModelCall, type TaskModelUsage, type TaskTraceEvent } from '../../shared/task-system/trace';
import { normalizeRunScope } from '../../shared/types/identity-scope';
import { summarizeCollaborationUsage } from '../../shared/types/session-collaboration-usage';
import { MODEL_CALL_CORRELATION_ENTRY_TYPE } from '../../openclaw_runtime/src/agents/model-call-observations';
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
  const sessionGeneration = 'child-generation', filePath = join(root, 'child.jsonl');
  const message = { role: 'assistant', provider: 'fixture', model: 'fixture', stopReason: 'stop',
    usage: { input: 8, output: 4, cacheRead: 2, cacheWrite: 1, totalTokens: 15, cost: { total: 0 } } };
  try {
    const call = { sessionKey: sessionGeneration, runId: 'run', attemptIndex: 0, modelCallIndex: 1 };
    const rows = [
      { type: 'session', id: sessionGeneration, parentSession: 'source.jsonl' },
      { type: 'message', id: 'fork-leaf', message },
      { type: 'message', id: 'fake-tool', message: { ...message, role: 'toolResult' } },
      { type: 'message', id: 'mirror', message: { ...message, provider: 'gateway-injected' } },
      { type: 'message', id: 'previous-generation', message, modelCall: { ...call, sessionKey: 'old-generation' } },
      { type: 'message', id: 'first', message, modelCall: call },
      { type: 'message', id: 'replay', message, modelCall: call },
      { type: 'message', id: 'fallback', message, modelCall: { ...call, attemptIndex: 1 } },
    ];
    writeFileSync(filePath, rows.map(row => JSON.stringify(row)).join('\n') + '\n');
    const input = { filePath, sessionGeneration, forkedFromLeafId: 'fork-leaf' };
    await expect(readCollaborationTranscriptUsage(input)).resolves.toMatchObject({ calls: 2, totalTokens: 30,
      knownTokens: { cacheRead: 4, cacheWrite: 2 }, totalUsd: null, unknownPriceCalls: 2 });
    await expect(readCollaborationTranscriptUsage({ ...input, sessionGeneration: 'old-generation' })).rejects.toThrow('TRANSCRIPT_STALE');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it('retains explicitly owned child usage when a fork label was rewritten', async () => {
  const root = mkdtempSync(join(tmpdir(), 'collaboration-fork-label-'));
  const filePath = join(root, 'child.jsonl'), sessionGeneration = 'child-generation';
  const message = { role: 'assistant', provider: 'fixture', model: 'fixture', stopReason: 'stop',
    usage: { input: 10, output: 5, totalTokens: 15, cacheRead: 0, cacheWrite: 0 } };
  try {
    writeFileSync(filePath, [
      { type: 'session', id: sessionGeneration, parentSession: 'parent.jsonl' },
      { type: 'message', id: 'inherited', message },
      { type: 'label', id: 'rewritten-label', targetId: 'inherited', label: 'fork point' },
      { type: 'message', id: 'child', message, modelCall: { sessionKey: sessionGeneration, runId: 'child-run', attemptIndex: 0, modelCallIndex: 1 } },
    ].map(row => JSON.stringify(row)).join('\n') + '\n');
    await expect(readCollaborationTranscriptUsage({ filePath, sessionGeneration, forkedFromLeafId: 'original-label' }))
      .resolves.toMatchObject({ knownTokens: { total: 15 }, unknownUsageCalls: 1 });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it('counts native calls without produced entries once and retains known usage for the same call', async () => {
  const root = mkdtempSync(join(tmpdir(), 'collaboration-usage-unmapped-'));
  const sessionGeneration = 'generation-current';
  const filePath = join(root, 'session.jsonl');
  const call = { sessionKey: sessionGeneration, runId: 'run', attemptIndex: 0, modelCallIndex: 1 };
  const correlation = { type: 'custom', customType: MODEL_CALL_CORRELATION_ENTRY_TYPE,
    data: { ...call, producedEntryId: null } };
  const rows = [
    { type: 'session', id: sessionGeneration },
    { ...correlation, id: 'unmapped' },
    { ...correlation, id: 'replay' },
    { ...correlation, id: 'old', data: { ...correlation.data, sessionKey: 'old-generation' } },
  ];
  const read = async (entries: unknown[]) => {
    writeFileSync(filePath, entries.map(row => JSON.stringify(row)).join('\n') + '\n');
    return readCollaborationTranscriptUsage({ filePath, sessionGeneration });
  };

  try {
    await expect(read(rows)).resolves.toMatchObject({
      calls: 1, knownTokens: null, totalTokens: null, unknownUsageCalls: 1, conflicts: 0,
    });
    const message = { role: 'assistant', provider: 'fixture', model: 'fixture', stopReason: 'stop',
      usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15 } };
    const assistant = { type: 'message', id: 'assistant', message, modelCall: call };
    const secondWireAttempt = { ...correlation, id: 'retry', data: { ...correlation.data, wireAttemptIndex: 1 } };
    await expect(read([...rows, assistant, secondWireAttempt])).resolves.toMatchObject({
      calls: 2, knownTokens: { total: 15 }, totalTokens: null, unknownUsageCalls: 1, conflicts: 0,
    });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it.each(['stop', 'toolUse', 'length'])('keeps all-zero adapter placeholders unknown after %s', async stopReason => {
  const root = mkdtempSync(join(tmpdir(), 'collaboration-usage-placeholder-'));
  const filePath = join(root, 'session.jsonl'), sessionGeneration = 'placeholder-generation';
  const message = { role: 'assistant', provider: 'fixture', model: 'fixture', stopReason,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { total: 0 } } };
  try {
    writeFileSync(filePath, [
      { type: 'session', id: sessionGeneration },
      { type: 'message', id: 'missing-usage', message },
      { type: 'message', id: 'known-usage', message: { ...message,
        usage: { ...message.usage, input: 10, output: 5, totalTokens: 15 } } },
    ].map(row => JSON.stringify(row)).join('\n') + '\n');
    await expect(readCollaborationTranscriptUsage({ filePath, sessionGeneration })).resolves.toMatchObject({
      calls: 2, knownTokens: { total: 15 }, totalTokens: null, unknownUsageCalls: 1, totalUsd: null,
    });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it('reports completed task phase boundaries and keeps unfinished recovery unknown', () => {
  const events: TaskTraceEvent[] = [
    { seq: 1, kind: 'created', at: 1, payload: { updatedAt: 1 } },
    { seq: 2, kind: 'claimed', at: 4, payload: {} },
    { seq: 3, kind: 'submitted', at: 10, payload: {} },
    { seq: 4, kind: 'accepted', at: 15, payload: {} },
    { seq: 5, kind: 'recovery_required', at: 18, payload: {} },
    { seq: 6, kind: 'context_rehydrated', at: 20, payload: {} },
    { seq: 7, kind: 'recovery_required', at: 25, payload: {} },
  ];
  const phases = projectTaskTracePhases(events);
  expect(phases.queue.durationMs).toBe(3);
  expect(phases.verification.durationMs).toBe(5);
  expect(phases.recovery).toEqual({ durationMs: null, intervals: [{ start: 18, end: 20, from: 'recovery_required', to: 'context_rehydrated' }] });
});
