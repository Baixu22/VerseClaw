// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultRetrievalPolicy, retrievalPolicyDigest } from '../../openclaw_runtime/src/knowledge/retrieval/policy';
import type { PluginStateKeyedStore } from '../../openclaw_runtime/src/plugin-state/plugin-state-store.types';
import type { RetrievalResultV2 } from '../../shared/knowledge/retrieval';

const state = vi.hoisted(() => ({ admitted: true, generation: 'session-1', verification: null as unknown, driftOnVerification: false }));
vi.mock('openclaw/plugin-sdk/knowledge-retrieval', async () => ({
  ...await import('../../openclaw_runtime/src/knowledge/retrieval/policy'),
  verifyOfflineRagPolicyPackage: async () => {
    if (state.driftOnVerification) state.generation = 'session-2';
    return state.verification;
  },
}));
vi.mock('openclaw/plugin-sdk/memory-host-core', () => ({ normalizeSourceRefV2: (value: unknown) => value }));
vi.mock('../../openclaw_runtime/extensions/memory-wiki/src/owner-read', () => ({
  memoryWikiNamespaceId: () => 'owner',
  createMemoryWikiReadContext: ({ identity }: { identity: { workspaceId: string } }) => ({
    principalId: 'operator', workspaceId: identity.workspaceId, workspaceRootDigest: identity.workspaceId,
    policyDigest: 'policy', sessionId: state.generation,
  }),
}));
vi.mock('../../openclaw_runtime/extensions/memory-wiki/src/query', () => ({
  getMemoryWikiPage: async () => state.admitted ? { status: 'admitted', ownerSnapshot: {} } : { status: 'denied' },
}));
import { createMemoryWikiObservabilityService } from '../../openclaw_runtime/extensions/memory-wiki/retrieval-observability-api';

const identity = { workspaceId: 'workspace-1', workspaceDir: 'D:/agent-fixture', sessionId: 'session-1', agentSessionKey: 'agent:test:session' };
const digest = 'sha256:' + 'a'.repeat(64);
function fixture() {
  const namespaces = new Map<string, Map<string, unknown>>();
  const openKeyedStore = <T,>({ namespace }: { namespace: string }): PluginStateKeyedStore<T> => {
    const rows = namespaces.get(namespace) ?? new Map(); namespaces.set(namespace, rows);
    return {
      register: async (key, value) => { rows.set(key, structuredClone(value)); },
      registerIfAbsent: async (key, value) => { if (rows.has(key)) return false; rows.set(key, structuredClone(value)); return true; },
      lookup: async key => structuredClone(rows.get(key) as T | undefined),
      consume: async key => { const value = rows.get(key) as T | undefined; rows.delete(key); return value; },
      delete: async key => rows.delete(key), clear: async () => { rows.clear(); },
      entries: async () => [...rows].map(([key, value]) => ({ key, value: structuredClone(value) as T, createdAt: 1 })),
      update: async (key, update) => { const value = update(structuredClone(rows.get(key)) as T | undefined); if (value !== undefined) rows.set(key, structuredClone(value)); return value !== undefined; },
    };
  };
  const service = createMemoryWikiObservabilityService({ config: { vault: { path: 'D:/agent-fixture' } } as never, openKeyedStore });
  const policy = defaultRetrievalPolicy('local');
  const result = { schema: 'RetrievalResult/v2', plan: { requestId: 'request-1', planId: 'plan-1',
    queries: [{ text: 'private prompt', family: 'root' }], profile: 'local', policyVersion: policy.version,
    policyDigest: retrievalPolicyDigest(policy), generations: [] }, status: 'complete',
    results: [{ sourceRef: { domain: 'wiki', authorityId: 'wiki', namespaceId: 'owner', subjectId: 'page.md',
      revision: '1', sourceDigest: digest, policyEpoch: '1', locator: { coordinateSpace: 'raw-source-utf8-v1',
        startByte: 0, endByteExclusive: 1, startLine: 1, endLine: 1 } }, data: { raw: 'private source bytes' } }],
    lanes: [], fallbackReasons: ['provider failed with secret payload'], snapshotStatus: 'current' } as unknown as RetrievalResultV2<unknown>;
  return { service, result, namespaces };
}
beforeEach(() => { state.admitted = true; state.generation = 'session-1'; state.verification = null; state.driftOnVerification = false; });

function evaluatedPolicy() {
  const previous = defaultRetrievalPolicy('quality'), candidate = { ...previous, version: 'agent-policy/v3', rrfK: 50 };
  return { candidate, expectedPolicyDigest: retrievalPolicyDigest(previous), evaluation: {
    schema: 'OfflineRetrievalEvaluation/v1', candidateDigest: retrievalPolicyDigest(candidate),
    baselineDigest: retrievalPolicyDigest(previous), corpusDigest: digest, reportDigest: digest, calibrationDigest: digest,
    candidateCommit: 'b'.repeat(40), profile: 'quality', queryCount: 240, taskCount: 60, taskSlots: 540,
    repeats: 3, arms: ['off', 'page', 'full'], missingSlots: 0, unknownUsageSlots: 0, safetyViolations: 0,
    ndcg5Gain: 0.1, ndcg5Ci95: [0.05, 0.15], recallAt20Delta: 0, exactRefPrecision: 1,
    successGain: 0.1, successCi95: [0.05, 0.15], relativeCostIncrease: 0.05,
    absoluteCostIncreaseUsd: 0.01, baselineCostUsd: 0.2, sealedAt: Date.now(), driven_by: 'agent' } };
}
describe('retrieval diagnostics owner and atomic transition behavior', () => {
  it('persists references without raw text and preserves unknown usage', async () => {
    const { service, result } = fixture(); await service.record(identity, result, Date.now());
    const view = await service.snapshot(identity);
    expect(view.receipts).toHaveLength(1);
    expect(view.receipts[0].usage.costUsd).toBeNull();
    expect(JSON.stringify(view)).not.toMatch(/private prompt|private source bytes|secret payload/);
    expect((await service.snapshot({ ...identity, workspaceId: 'different' })).receipts).toEqual([]);
  });
  it('deduplicates weak feedback, rejects conflicting operations and leaves rank policy alone', async () => {
    const { service, result } = fixture(), receiptId = await service.record(identity, result, Date.now());
    const before = await service.policy(identity, 'local');
    const input = { operationId: 'feedback-1', receiptId, action: 'attach' as const };
    await service.feedback(identity, input); await service.feedback(identity, input);
    expect((await service.snapshot(identity)).receipts[0].feedback).toEqual({ attach: 1, dismiss: 0 });
    await expect(service.feedback(identity, { ...input, action: 'dismiss' })).rejects.toThrow('Conflicting');
    expect(await service.policy(identity, 'local')).toEqual(before);
  });
  it('records per-query spend, real stages and unsupported answers without retaining raw text', async () => {
    const { service, result } = fixture();
    result.effectiveProfile = 'lexical';
    result.stages = [{ stage: 'fusion', elapsedMs: 2, status: 'complete', candidateCount: 3 }];
    result.remoteSpend = { calls: 1, reservedTokens: 100, reservedCostUsd: 0.001, actualTokens: 7, actualCostUsd: 0.00007 };
    await service.record(identity, result, Date.now());
    await service.correlate(identity, { requestId: result.plan.requestId, runId: 'support-run', purpose: 'support', elapsedMs: 123,
      retainedEvidence: { schema: 'RetainedEvidenceManifest/v1', turnId: 'support-run', units: [] },
      support: { answerability: 'insufficient', supported: 0, unsupported: 1, uncertain: 0 } });
    const row = (await service.snapshot(identity)).receipts[0];
    expect(row).toMatchObject({ effectiveProfile: 'lexical', stages: result.stages,
      usage: { inputTokens: 7, costUsd: 0.00007 }, dcs: { retainedSourceDigests: [] },
      modelRuns: [{ purpose: 'support', elapsedMs: 123, support: { unsupported: 1 } }] });
    expect(JSON.stringify(row)).not.toMatch(/private prompt|private source bytes/);
  });
  it('removes revoked sources and their feedback and rejects stale session generations', async () => {
    const { service, result } = fixture(), receiptId = await service.record(identity, result, Date.now());
    await service.feedback(identity, { operationId: 'feedback-1', receiptId, action: 'dismiss' });
    state.admitted = false;
    expect((await service.snapshot(identity)).receipts).toEqual([]);
    await expect(service.feedback(identity, { operationId: 'feedback-2', receiptId, action: 'attach' })).rejects.toThrow();
    state.generation = 'session-2';
    await expect(service.policy(identity, 'local')).rejects.toThrow('generation');
  });
  it('links only actual matching retained pins and shows measured model usage separately', async () => {
    const { service, result } = fixture(); await service.record(identity, result, Date.now());
    const input = { requestId: 'request-1', runId: 'run-1', retainedEvidence: { schema: 'RetainedEvidenceManifest/v1',
      turnId: 'turn-1', units: [{ citations: [{ sourceRef: result.results[0].sourceRef }] }] },
      providerSpend: { actualTokens: 21, actualCostUsd: 0.01, modelRefs: ['provider/model'] } };
    await service.correlate(identity, input); await service.correlate(identity, input);
    const row = (await service.snapshot(identity)).receipts[0];
    expect(row.modelRuns).toHaveLength(1);
    expect(row.usage).toMatchObject({ totalModelTokens: 21, modelCostUsd: 0.01, costUsd: null });
    expect(row.dcs?.runId).toBe('run-1');
    await expect(service.correlate(identity, { ...input, providerSpend: { ...input.providerSpend, actualTokens: 22 } }))
      .rejects.toThrow('Conflicting retained evidence run');
  });
  it('requires original offline evidence even for direct owner promotion calls', async () => {
    const { service } = fixture();
    await expect(service.promote(identity, { operationId: 'promotion-1', candidate: defaultRetrievalPolicy('local'),
      expectedPolicyDigest: digest, evaluation: {} } as never)).rejects.toThrow('Pinned original evaluation package');
  });
  it('atomically publishes verifier results, rejects stale baselines and restores the previous policy', async () => {
    const { service } = fixture(), verified = evaluatedPolicy(); state.verification = verified;
    const input = { operationId: 'promotion-1', evidenceRoot: 'D:/agent-fixture', evidenceManifestName: 'quality-policy.json', evidenceManifestDigest: digest };
    expect((await service.promote(identity, input)).decision).toBe('promoted');
    expect((await service.promote(identity, input)).decision).toBe('promoted');
    expect(await service.policy(identity, 'quality')).toEqual(verified.candidate);
    await expect(service.promote(identity, { ...input, operationId: 'promotion-2' })).rejects.toThrow('changed before promotion');
    await service.rollback(identity, { operationId: 'rollback-1', profile: 'quality', expectedPolicyDigest: retrievalPolicyDigest(verified.candidate) });
    expect(await service.policy(identity, 'quality')).toEqual(defaultRetrievalPolicy('quality'));
  });
  it('revalidates the owner generation after asynchronous verification before publishing', async () => {
    const { service } = fixture(); state.verification = evaluatedPolicy(); state.driftOnVerification = true;
    await expect(service.promote(identity, { operationId: 'promotion-1', evidenceRoot: 'D:/agent-fixture',
      evidenceManifestName: 'quality-policy.json', evidenceManifestDigest: digest })).rejects.toThrow('generation');
    expect(await service.policy({ ...identity, sessionId: 'session-2' }, 'quality')).toEqual(defaultRetrievalPolicy('quality'));
  });
});
