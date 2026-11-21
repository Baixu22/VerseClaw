// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createResearchPlan, emptyResearchResult, recomputeResearchCoverage, runResearchPlan, validateResearchReview } from '../../openclaw_runtime/src/knowledge/retrieval/research';
import { createOwnerReadSnapshot, deriveReadAdmissionContext, digestOwnerReadContent } from '../../openclaw_runtime/src/runtime-core/knowledge-owner-read';
import type { ResearchBudget, ResearchEvidence, ResearchReview, ResearchResultV1 } from '../../shared/knowledge/research';
import type { RetainedEvidenceManifestV1 } from '../../shared/knowledge/packing';
import { createKnowledgeResearchApi } from '@electron/services/knowledge-research';
import { readKnowledgeResearch } from '@/lib/knowledge-research';
import { hostApi } from '@/lib/host-api';

vi.mock('@/lib/host-api', () => ({ hostApi: { knowledge: { researchStart: vi.fn(), researchStatus: vi.fn(), researchCancel: vi.fn() } } }));

const hostState = vi.hoisted(() => ({ changed: false, model: undefined as ((args: unknown[]) => unknown) | undefined }));
vi.mock('@electron/services/knowledge-read-scope', () => ({
  prepareKnowledgeReadScope: async (_gateway: unknown, input: { workspaceId?: string; sessionKey?: string }) => {
    if (input.workspaceId && input.workspaceId !== 'owner-project') throw new Error('Workspace is not the current owner');
    if (input.sessionKey && input.sessionKey !== 'agent:main:owner') throw new Error('Session is not the current owner');
    return { fingerprint: 'owner-generation-1', expectedSessionGeneration: 'generation-1',
      identity: { workspaceId: 'owner-project', agentSessionKey: 'agent:main:owner', sessionId: 'generation-1', egressProviderRefs: [] } };
  },
  assertKnowledgeReadScopeCurrent: async () => { if (hostState.changed) throw new Error('Workspace owner changed'); },
}));
vi.mock('@electron/services/knowledge-evidence-qa', () => ({
  selectKnowledgeModelSources: (sources: unknown[]) => ({ sources: sources.slice(0, 8), dropped: sources.slice(8) }),
  runKnowledgeModel: (...args: unknown[]) => Promise.resolve(hostState.model?.(args)),
}));

const scope = { fingerprint: 'owner-generation-1', workspaceId: 'owner-project', sessionKey: 'agent:main:owner', sessionId: 'generation-1', corpus: 'wiki' as const };
function evidence(id: string, content = 'Gateway port is 8080.', lookup = id + '.md'): ResearchEvidence {
  const context = deriveReadAdmissionContext({ principalId: 'operator', agentId: 'main', sessionId: scope.sessionId,
    sessionKey: scope.sessionKey, workspaceId: scope.workspaceId, workspaceRootDigest: digestOwnerReadContent('D:/owner-project'),
    ownerNamespaces: ['wiki-owner'], policyDigest: digestOwnerReadContent('owner-policy'), egressProviderRefs: [], expiresAt: new Date(Date.now() + 60000).toISOString() });
  const snapshot = createOwnerReadSnapshot({ raw: content, startChar: 0, endChar: content.length, title: id, context,
    source: { domain: 'wiki', authorityId: 'memory-wiki', namespaceId: 'wiki-owner', subjectId: lookup, revision: '1' },
    policy: { status: 'active', trust: 'confirmed', sensitivity: 'workspace', acl: { read: ['operator'] }, scope: { workspaceId: scope.workspaceId },
      retention: { policy: 'source-coupled' }, updatedAt: '2026-11-18T00:00:00Z' } });
  return { id, title: id, lookup, content, contentDigest: snapshot.contentDigest, sourceRef: snapshot.source, updatedAt: snapshot.policy.updatedAt };
}
function manifest(sources: ResearchEvidence[]): RetainedEvidenceManifestV1 {
  const units = sources.map((source, ordinal) => ({ schema: 'KnowledgeCandidatePacking/v2' as const,
    unitId: source.id, candidateId: source.id, ordinal, projectionDigest: source.contentDigest,
    retainedChars: source.content.length, retainedUtf8Bytes: Buffer.byteLength(source.content), estimatedTokens: Math.ceil(Buffer.byteLength(source.content) / 4),
    citations: [{ refId: source.id, sourceRef: source.sourceRef, sourceDigest: source.sourceRef.sourceDigest, chunkDigest: source.contentDigest,
      retainedBodyChars: source.content.length, retainedBodyUtf8Bytes: Buffer.byteLength(source.content) }] }));
  return { schema: 'RetainedEvidenceManifest/v1', turnId: 'test-turn', estimateMethod: 'utf8-bytes-div4', units,
    retainedChars: units.reduce((sum, unit) => sum + unit.retainedChars, 0), retainedUtf8Bytes: units.reduce((sum, unit) => sum + unit.retainedUtf8Bytes, 0),
    estimatedTokens: units.reduce((sum, unit) => sum + unit.estimatedTokens, 0) };
}
const review = (overrides: Partial<ResearchReview> = {}): ResearchReview => ({ queries: [], coverage: [], inferences: [], conflicts: [], gaps: [], ...overrides });
function run(input: {
  query?: string; budget?: Partial<ResearchBudget>; signal?: AbortSignal;
  retrieve?: Parameters<typeof runResearchPlan>[0]['retrieve'];
  verify?: Parameters<typeof runResearchPlan>[0]['verify'];
  planNext?: Parameters<typeof runResearchPlan>[0]['planNext'];
  assertScope?: Parameters<typeof runResearchPlan>[0]['assertScope'];
  onUpdate?: Parameters<typeof runResearchPlan>[0]['onUpdate'];
} = {}) {
  const plan = createResearchPlan({ requestId: 'research-fixture', query: input.query ?? 'Gateway port', scope, budget: input.budget });
  return runResearchPlan({ plan, signal: input.signal, assertScope: input.assertScope ?? (async () => {}), verify: input.verify ?? (async () => true),
    retrieve: input.retrieve ?? (async () => ({ evidence: [evidence('port')], partial: false })),
    planNext: input.planNext ?? (async ({ evidence: sources }) => ({ review: review(), retainedEvidence: manifest(sources), actualTokens: 100, actualCostUsd: 0.0001 })),
    onUpdate: input.onUpdate });
}

describe('bounded Project RAG Research controller', () => {
  it('freezes the total scope, deadline, token/cost/query/model/graph ceilings before work', () => {
    const owner = { ...scope }, budgets = { maxQueries: 7 };
    const plan = createResearchPlan({ requestId: 'frozen-owner', query: 'Gateway port and backup path', scope: owner, now: 123, budget: budgets });
    owner.workspaceId = 'changed'; budgets.maxQueries = 1;
    expect(plan.scope).toEqual(scope);
    expect(plan.budget).toMatchObject({ deadlineAtMs: 30123, maxRounds: 3, maxQueries: 7, maxPlanningModelCalls: 2,
      maxPlanningTokens: 16000, maxCostUsd: 0.05, maxEvidenceTokens: 5000, maxEvidenceChars: 15000, graphMaxHops: 2, graphMaxNodes: 32, graphMaxEdges: 128 });
    expect(plan.questions).toEqual(['Gateway port', 'backup path']);
    expect(Object.isFrozen(plan.scope) && Object.isFrozen(plan.budget) && Object.isFrozen(plan.questions)).toBe(true);
  });
  it.each([{ maxRounds: 4 }, { maxQueries: 9 }, { maxPlanningModelCalls: 3 }, { maxCostUsd: Infinity }, { maxEvidenceTokens: 5001 }, { graphMaxHops: 3 }])('rejects a larger or invalid ceiling %j', budget => {
    expect(() => createResearchPlan({ requestId: 'invalid-budget', query: 'Gateway port', scope, budget })).toThrow();
  });
  it('decomposes the root, follows a genuine evidence gap, and stops at quoted coverage', async () => {
    const calls: string[] = [], deadlines: number[] = [];
    const result = await run({ query: 'Gateway port and backup path', retrieve: async query => {
      calls.push(query); return { evidence: [query.includes('archive') ? evidence('backup', 'The backup path is /archive.') : evidence('port')], partial: false };
    }, planNext: async ({ plan, evidence: sources, round, maxTokens, maxCostUsd }) => {
      deadlines.push(plan.budget.deadlineAtMs); expect(maxTokens).toBeLessThanOrEqual(8000); expect(maxCostUsd).toBeLessThanOrEqual(0.025);
      return { review: review({ queries: round === 1 ? ['backup archive path'] : [], coverage: round === 1
        ? [{ question: 'Gateway port', sourceId: 'port', quote: 'port is 8080' }]
        : [{ question: 'backup path', sourceId: 'backup', quote: 'backup path is /archive' }], gaps: round === 1 ? ['Backup location is missing.'] : [],
        inferences: ['The sources describe separate runtime and backup settings.'] }), retainedEvidence: manifest(sources), actualTokens: 120, actualCostUsd: 0.0001 };
    } });
    expect(calls).toEqual(['Gateway port and backup path', 'Gateway port', 'backup path', 'backup archive path']);
    expect(new Set(deadlines).size).toBe(1);
    expect(result).toMatchObject({ status: 'complete', stopReason: 'covered', phase: 'finished', gaps: [],
      usage: { rounds: 2, queries: 4, planningModelCalls: 2, reservedPlanningTokens: 16000, reservedCostUsd: 0.05, actualPlanningTokens: 240, actualCostUsd: 0.0002 } });
    expect(result.evidence).toHaveLength(2); expect(result.inferences).toHaveLength(1);
  });
  it('stops repeated normalized queries without another retrieval or model call', async () => {
    const retrieve = vi.fn(async () => ({ evidence: [evidence('port')], partial: false }));
    const result = await run({ retrieve, planNext: async ({ evidence: sources }) => ({ review: review({ queries: ['  GATEWAY   PORT '] }),
      retainedEvidence: manifest(sources), actualTokens: 10, actualCostUsd: 0.0001 }) });
    expect(retrieve).toHaveBeenCalledTimes(1); expect(result.stopReason).toBe('repeated-query'); expect(result.status).toBe('partial');
  });
  it('stops no-new-evidence even when the planner suggested another query', async () => {
    const planNext = vi.fn(async ({ evidence: sources }) => ({ review: review({ queries: ['second query'] }), retainedEvidence: manifest(sources), actualTokens: 10, actualCostUsd: 0.0001 }));
    const result = await run({ planNext });
    expect(result.stopReason).toBe('no-new-evidence'); expect(result.usage.queries).toBe(2); expect(planNext).toHaveBeenCalledTimes(1);
  });
  it('shares eight distinct query slots across three rounds and limits planning to two calls', async () => {
    const queries: string[] = [];
    const result = await run({ query: 'Gateway port and backup path and retention', retrieve: async query => { queries.push(query); return { evidence: [evidence('s' + queries.length)], partial: false }; },
      planNext: async ({ evidence: sources, round }) => ({ review: review({ queries: Array.from({ length: 8 }, (_, i) => `round${round} gap${i}`) }),
        retainedEvidence: manifest(sources), actualTokens: 20, actualCostUsd: 0.0001 }) });
    expect(result.usage.rounds).toBe(3); expect(result.usage.queries).toBe(8);
    expect(result.usage.planningModelCalls).toBe(2); expect(new Set(queries).size).toBe(queries.length);
    expect(result.stopReason).toBe('query-budget');
  });
  it('honors a tighter shared query ceiling before a second round', async () => {
    const result = await run({ budget: { maxQueries: 1 }, planNext: async ({ evidence: sources }) => ({
      review: review({ queries: ['second query'] }), retainedEvidence: manifest(sources), actualTokens: 20, actualCostUsd: 0.0001 }) });
    expect(result.stopReason).toBe('query-budget'); expect(result.usage.queries).toBe(1);
  });
  it('retains an entire conflict group or drops the whole group at the evidence budget', async () => {
    const pair = [evidence('one', 'port=8080'), evidence('two', 'port=9090')].map(source => ({ ...source, conflictGroupId: 'port-conflict' }));
    const result = await run({ budget: { maxEvidenceChars: 10 }, retrieve: async () => ({ evidence: pair, partial: false }) });
    expect(result.evidence).toEqual([]); expect(result.stopReason).toBe('evidence-budget'); expect(result.usage.evidenceChars).toBe(0);
  });
  it('keeps conflicts visible and prevents a covered verdict from closing a conflict', async () => {
    const pair = [evidence('one', 'port=8080'), evidence('two', 'port=9090')];
    const result = await run({ retrieve: async () => ({ evidence: pair, partial: false }), planNext: async ({ evidence: sources, plan }) => ({
      review: review({ coverage: [{ question: plan.query, sourceId: 'one', quote: 'port=8080' }], conflicts: [{ description: 'The ports disagree.',
        citations: [{ sourceId: 'one', quote: '8080' }, { sourceId: 'two', quote: '9090' }] }] }), retainedEvidence: manifest(sources), actualTokens: 10, actualCostUsd: 0.0001 }) });
    expect(result.status).toBe('partial'); expect(result.conflicts).toHaveLength(1);
  });
  it('rejects forged quotations, source IDs and changed frozen questions', () => {
    const plan = createResearchPlan({ requestId: 'review-fixture', query: 'Gateway port', scope });
    for (const coverage of [
      { question: plan.query, sourceId: 'port', quote: '9090' },
      { question: plan.query, sourceId: 'foreign', quote: '8080' },
      { question: 'another workspace', sourceId: 'port', quote: '8080' },
    ]) expect(() => validateResearchReview(JSON.stringify(review({ coverage: [coverage] })), plan, [evidence('port')])).toThrow();
  });
  it('does not cover a question from a quote dropped by DCS', async () => {
    const result = await run({ planNext: async ({ plan }) => ({ review: review({ coverage: [{ question: plan.query, sourceId: 'port', quote: '8080' }] }),
      retainedEvidence: manifest([]), actualTokens: 10, actualCostUsd: 0.0001 }) });
    expect(result.coverage).toEqual([]); expect(result.status).toBe('partial'); expect(result.gaps.some(gap => gap.reason === 'planning-unavailable')).toBe(true);
  });
  it('recomputes final coverage and atomic conflict groups after a narrower DCS budget', () => {
    const plan = createResearchPlan({ requestId: 'dcs-fixture', query: 'Gateway port', scope });
    const first = evidence('one'), second = evidence('two', 'The port is 9090.');
    const result = emptyResearchResult(plan); result.status = 'complete'; result.evidence = [first, second]; result.inferences = ['An inference'];
    result.coverage = [{ question: plan.query, sourceId: 'two', quote: '9090' }];
    const projected = recomputeResearchCoverage(result, manifest([first]));
    expect(projected.evidence.map(source => source.id)).toEqual(['one']); expect(projected.coverage).toEqual([]); expect(projected.inferences).toEqual([]);
    expect(projected.status).toBe('partial'); expect(projected.gaps[0].reason).toBe('dcs-evidence-not-retained');
    result.gaps = [{ schema: 'EvidenceGap/v1', question: plan.query, reason: 'retrieval-partial' }];
    expect(recomputeResearchCoverage(result, manifest([first])).gaps.map(gap => gap.reason)).toEqual(['retrieval-partial', 'dcs-evidence-not-retained']);
    result.evidence = [first, second].map(source => ({ ...source, conflictGroupId: 'pair' }));
    expect(recomputeResearchCoverage(result, manifest([first])).evidence).toEqual([]);
  });
  it('publishes the production DCS projection and removes dropped source-dependent output', async () => {
    const sources = [evidence('port'), evidence('giant', 'Giant policy details.')];
    const result = await run({ retrieve: async () => ({ evidence: sources, partial: false }), planNext: async ({ plan }) => ({
      review: review({ coverage: [{ question: plan.query, sourceId: 'port', quote: '8080' }], inferences: ['Giant-derived inference'] }),
      retainedEvidence: manifest([sources[0]]), actualTokens: 20, actualCostUsd: 0.0001 }) });
    expect(result.evidence.map(source => source.id)).toEqual(['port']); expect(result.inferences).toEqual([]);
    expect(result.status).toBe('partial'); expect(result.usage.evidenceChars).toBe(sources[0].content.length);
    expect(result.gaps.some(gap => gap.reason === 'dcs-evidence-not-retained')).toBe(true);
  });
  it('invalidates an old owner pin and all dependent inference instead of mixing revisions', async () => {
    let changed = false;
    const result = await run({ verify: async () => !changed, planNext: async ({ evidence: sources, plan }) => {
      changed = true; return { review: review({ coverage: [{ question: plan.query, sourceId: 'port', quote: '8080' }], inferences: ['Old source inference'] }),
        retainedEvidence: manifest(sources), actualTokens: 10, actualCostUsd: 0.0001 };
    } });
    expect(result.evidence).toEqual([]); expect(result.inferences).toEqual([]); expect(result.coverage).toEqual([]);
    expect(result.steps).toEqual([]); expect(result.usage.evidenceChars).toBe(0);
    expect(result.gaps.some(gap => gap.reason === 'owner-evidence-changed')).toBe(true);
  });
  it('keeps owner denials sticky across later fallback queries', async () => {
    const port = evidence('port'); let count = 0;
    const result = await run({ query: 'Gateway port and backup path', retrieve: async () => {
      count++; return { evidence: [port], partial: false, ...(count === 1 ? { denied: [{ domain: 'wiki', namespaceId: port.sourceRef.namespaceId, subjectId: port.sourceRef.subjectId }] } : {}) };
    } });
    expect(result.evidence).toEqual([]); expect(result.usage.planningModelCalls).toBe(0);
  });
  it('clears source-derived output after an owner scope change', async () => {
    let reads = 0;
    const result = await run({ assertScope: async () => { if (++reads > 3) throw new Error('Workspace changed'); } });
    expect(result.stopReason).toBe('scope-changed'); expect(result.evidence).toEqual([]); expect(result.coverage).toEqual([]); expect(result.graph.edges).toEqual([]);
  });
  it('bounds owner links to two hops, ignores external and escaping paths, and returns graph truncation', async () => {
    const initial = evidence('root', Array.from({ length: 40 }, (_, index) => `[guide${index}](g${index}.md)`).join('\n') + '\n[external](https://example.org/x.md)\n[escape](../../x.md)');
    const result = await run({ budget: { maxPlanningModelCalls: 0 }, retrieve: async query => ({ evidence: [query === 'Gateway port' ? initial : evidence(query, '[next](next.md)')], partial: false }) });
    expect(result.graph.nodes.length).toBeLessThanOrEqual(32); expect(result.graph.edges.length).toBeLessThanOrEqual(128);
    expect(result.graph.edges.every(edge => edge.depth <= 2 && !edge.lookup.includes('https:') && !edge.lookup.startsWith('../'))).toBe(true);
    expect(result.graph.truncated).toBe(true); expect(result.status).toBe('partial');
  });
  it('charges both new link endpoints against a tighter graph-node budget', async () => {
    const result = await run({ budget: { graphMaxNodes: 1, maxPlanningModelCalls: 0 },
      retrieve: async () => ({ evidence: [evidence('root', '[child](child.md)')], partial: false }) });
    expect(result.graph.nodes.length).toBeLessThanOrEqual(1); expect(result.graph.edges).toEqual([]); expect(result.graph.truncated).toBe(true);
  });
  it.each(['concepts/b.md', '  CONCEPTS/B.MD  '])('preserves queued link depth when the planner repeats %s', async firstQuery => {
    const queries: string[] = [];
    const sources = new Map([
      ['Gateway port', evidence('a', '[next](b.md)', 'concepts/a.md')],
      ['concepts/b.md', evidence('b', '[next](c.md)', 'concepts/b.md')],
      ['concepts/c.md', evidence('c', '[next](d.md)', 'concepts/c.md')],
    ]);
    const result = await run({ retrieve: async query => {
      queries.push(query); return { evidence: [sources.get(query)!], partial: false };
    }, planNext: async ({ evidence: retained, round }) => ({
      review: review({ queries: [round === 1 ? firstQuery : 'concepts/c.md'] }),
      retainedEvidence: manifest(retained), actualTokens: 10, actualCostUsd: 0.0001,
    }) });
    expect(queries).toEqual(['Gateway port', 'concepts/b.md', 'concepts/c.md']);
    expect(result.graph.edges).toEqual([
      { sourceId: 'a', lookup: 'concepts/b.md', depth: 1 },
      { sourceId: 'b', lookup: 'concepts/c.md', depth: 2 },
    ]);
    expect(result.graph.nodes).not.toContain('concepts/d.md');
    expect(result.usage).toMatchObject({ queries: 3, rounds: 3, planningModelCalls: 2 });
  });
  it('cancels a non-cooperative owner wait and preserves already admitted partial evidence', async () => {
    const controller = new AbortController(); let phase = 0;
    const result = await run({ signal: controller.signal, retrieve: async () => {
      if (++phase === 1) return { evidence: [evidence('port')], partial: false };
      queueMicrotask(() => controller.abort()); return new Promise(() => {});
    }, planNext: async ({ evidence: sources }) => ({ review: review({ queries: ['follow-up'] }), retainedEvidence: manifest(sources), actualTokens: 10, actualCostUsd: 0.0001 }) });
    expect(result).toMatchObject({ status: 'cancelled', stopReason: 'cancelled', phase: 'finished' }); expect(result.evidence).toHaveLength(1);
    expect(result.usage).toMatchObject({ actualPlanningTokens: 10, actualCostUsd: 0.0001 });
  });
  it('stops at the original deadline without allowing an uncooperative owner to finish late', async () => {
    const start = Date.now();
    const result = await run({ budget: { deadlineAtMs: start + 30 }, retrieve: async () => new Promise(() => {}) });
    expect(Date.now() - start).toBeLessThan(1000); expect(result.stopReason).toBe('deadline'); expect(result.usage.queries).toBe(1);
    expect(result.usage).toMatchObject({ planningModelCalls: 0, actualPlanningTokens: 0, actualCostUsd: 0 });
  });
  it.each(['cancelled', 'deadline', 'scope-changed'] as const)('keeps pending planning usage unknown after %s and ignores late settlement', async reason => {
    vi.useFakeTimers();
    const controller = new AbortController(), updates: ResearchResultV1[] = [];
    let entered!: () => void, release = () => {};
    const planning = new Promise<void>(resolve => { entered = resolve; });
    const pending = run({ signal: controller.signal, onUpdate: row => updates.push(row),
      retrieve: async query => ({ evidence: [evidence(query)], partial: false }),
      planNext: async ({ evidence: sources, round }) => {
        const output = { review: review({ queries: ['follow-up'] }), retainedEvidence: manifest(sources), actualTokens: 10, actualCostUsd: 0.0001 };
        if (round === 1) return output;
        entered(); return new Promise<typeof output>(resolve => { release = () => resolve(output); });
      } });
    try {
      await planning;
      const usage = { planningModelCalls: 2, reservedPlanningTokens: 16000, reservedCostUsd: 0.05,
        actualPlanningTokens: null, actualCostUsd: null };
      expect(updates.at(-1)).toMatchObject({ phase: 'planning', usage });
      if (reason === 'deadline') await vi.advanceTimersByTimeAsync(30000);
      else controller.abort(reason === 'scope-changed' ? Object.assign(new Error('Owner changed'), { code: 'RESEARCH_OWNER_CHANGED' }) : undefined);
      const result = await pending;
      expect(result).toMatchObject({ phase: 'finished', stopReason: reason, usage });
      expect(result.evidence).toHaveLength(reason === 'scope-changed' ? 0 : 2);
      const terminal = structuredClone(result), published = updates.length;
      release(); await vi.advanceTimersByTimeAsync(0);
      expect(result).toEqual(terminal); expect(updates).toHaveLength(published);
    } finally {
      controller.abort(); release(); await pending; vi.useRealTimers();
    }
  });
  it('retains an unknown provider liability and reports partial even when coverage is sufficient', async () => {
    const result = await run({ planNext: async ({ plan, evidence: sources }) => ({ review: review({ coverage: [{ question: plan.query, sourceId: 'port', quote: '8080' }] }),
      retainedEvidence: manifest(sources), actualTokens: null, actualCostUsd: null }) });
    expect(result.status).toBe('partial'); expect(result.usage.reservedCostUsd).toBe(0.025); expect(result.usage.actualCostUsd).toBeNull();
    expect(result.gaps.some(gap => gap.reason === 'planning-usage-unknown')).toBe(true);
  });
  it.each(['tokens', 'cost', 'negative'])('stops after planning returns invalid %s usage and retains the reservation', async kind => {
    const retrieve = vi.fn(async () => ({ evidence: [evidence('port', 'Gateway port is 8080. [next](next.md)')], partial: false }));
    const planNext = vi.fn(async ({ evidence: sources, maxTokens, maxCostUsd }: Parameters<Parameters<typeof runResearchPlan>[0]['planNext']>[0]) => ({
      review: review(), retainedEvidence: manifest(sources),
      actualTokens: kind === 'tokens' ? maxTokens + 1 : kind === 'negative' ? -1 : maxTokens,
      actualCostUsd: kind === 'cost' ? maxCostUsd + 0.001 : maxCostUsd,
    }));
    const result = await run({ retrieve, planNext });
    expect(planNext).toHaveBeenCalledTimes(1); expect(retrieve).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ status: 'partial', stopReason: 'unavailable', phase: 'finished',
      usage: { planningModelCalls: 1, reservedPlanningTokens: 8000, reservedCostUsd: 0.025, actualPlanningTokens: null, actualCostUsd: null } });
    expect(result.evidence).toHaveLength(1); expect(result.gaps.some(gap => gap.reason === 'planning-unavailable')).toBe(true);
  });
  it('publishes independent progress snapshots rather than a mutable shared result', async () => {
    const updates: ResearchResultV1[] = [];
    const result = await run({ onUpdate: row => updates.push(row) });
    expect(updates.length).toBeGreaterThan(2); expect(updates[0].evidence).toEqual([]); expect(result.evidence).toHaveLength(1);
    expect(result).toMatchObject({ actor: 'knowledge-research', driven_by: 'agent', realHumanEvidence: false });
  });
});

describe('Research Main owner and Host contract', () => {
  beforeEach(() => { hostState.changed = false; hostState.model = undefined; });
  function setup(options: { modelReceipt?: boolean; body?: string } = {}) {
    const source = evidence('port', options.body ?? 'Gateway port is 8080.', 'port.md');
    const read = vi.fn(async () => {
      const context = deriveReadAdmissionContext({ principalId: 'operator', sessionId: scope.sessionId,
        sessionKey: scope.sessionKey, workspaceId: scope.workspaceId, ownerNamespaces: ['wiki-owner'],
        policyDigest: digestOwnerReadContent('owner-policy'), egressProviderRefs: [], expiresAt: new Date(Date.now() + 60000).toISOString() });
      const snapshot = createOwnerReadSnapshot({ raw: source.content, startChar: 0, endChar: source.content.length, title: source.title, context,
        source: { domain: 'wiki', authorityId: 'memory-wiki', namespaceId: 'wiki-owner', subjectId: source.lookup, revision: '1' },
        policy: { status: 'active', trust: 'confirmed', sensitivity: 'workspace', acl: { read: ['operator'] }, scope: { workspaceId: scope.workspaceId },
          retention: { policy: 'source-coupled' }, updatedAt: '2026-11-18T00:00:00Z' } });
      return { success: true, corpus: 'wiki', title: source.title, path: source.lookup, content: source.content, ownerSnapshot: snapshot };
    });
    const rpc = vi.fn(async (method: string, payload: Record<string, unknown>) => {
      if (method !== 'wiki.retrieve') throw new Error('Unexpected Research RPC ' + method);
      expect(payload).toMatchObject({ profile: 'research', mode: 'suggest', allowRemote: false,
        readIdentity: { workspaceId: scope.workspaceId, agentSessionKey: scope.sessionKey, sessionId: scope.sessionId } });
      return { status: 'complete', filters: [], results: [{ sourceRef: source.sourceRef, lookup: source.lookup, title: source.title }] };
    });
    const modelCalls: unknown[][] = [];
    hostState.model = args => {
      modelCalls.push(args);
      const input = args[4] as { references: Array<{ id: string; sourceRef: ResearchEvidence['sourceRef'] }> };
      const modelSources = input.references.map(ref => ({ ...source, id: ref.id, sourceRef: ref.sourceRef }));
      return { runId: 'planning-run', text: JSON.stringify(review({ coverage: [{ question: 'Gateway port', sourceId: input.references[0].id, quote: 'port is 8080' }] })),
        retainedEvidence: manifest(modelSources), ...(options.modelReceipt !== false ? { providerSpend: { calls: 1, reservedTokens: 8000,
          reservedCostUsd: 0.025, actualTokens: 100, actualCostUsd: 0.0001 } } : {}) };
    };
    const api = createKnowledgeResearchApi({ gatewayManager: { rpc } as never, read,
      rows: value => (value as { results: Array<Record<string, unknown>> }).results });
    const request = { requestId: 'main-research-fixture', query: 'Gateway port', workspaceId: scope.workspaceId, sessionKey: scope.sessionKey };
    const selected = { requestId: request.requestId, workspaceId: request.workspaceId, sessionKey: request.sessionKey };
    const terminal = async () => {
      for (let count = 0; count < 100; count++) {
        const response = await api.researchStatus(selected);
        if (!response.success || response.research?.phase === 'finished') return response;
        await new Promise(resolve => setImmediate(resolve));
      }
      throw new Error('Research did not finish');
    };
    return { api, request, selected, terminal, rpc, read, modelCalls };
  }
  it('uses the frozen owner selection for retrieval and DCS-bound budgeted planning', async () => {
    const fixture = setup();
    expect((await fixture.api.researchStart(fixture.request)).success).toBe(true);
    const response = await fixture.terminal();
    expect(response.research).toMatchObject({ status: 'complete', stopReason: 'covered', usage: { planningModelCalls: 1, actualPlanningTokens: 100 } });
    expect(fixture.rpc).toHaveBeenCalledTimes(1);
    expect(fixture.modelCalls[0][5]).toMatchObject({ budget: { maxInputTokens: 6976, maxOutputTokens: 1024, maxCostUsd: 0.025, maxCalls: 1 } });
    expect(fixture.modelCalls[0][1]).not.toContain('Gateway port is 8080.');
    expect((fixture.modelCalls[0][4] as { references: unknown[] }).references).toHaveLength(1);
    expect(fixture.read).toHaveBeenCalled();
  });
  it('rejects a caller-supplied scope, tool permission or budget before any retrieval', async () => {
    const fixture = setup();
    for (const field of ['scope', 'readIdentity', 'tools', 'budget']) expect((await fixture.api.researchStart({ ...fixture.request, [field]: {} } as never)).success).toBe(false);
    expect(fixture.rpc).not.toHaveBeenCalled();
  });
  it('does not restart a duplicate request ID or expose/cancel it to another selection', async () => {
    const fixture = setup();
    await fixture.api.researchStart(fixture.request);
    expect((await fixture.api.researchStart(fixture.request)).success).toBe(false);
    expect((await fixture.api.researchStatus({ ...fixture.selected, workspaceId: 'foreign-project' })).success).toBe(false);
    expect((await fixture.api.researchCancel({ ...fixture.selected, sessionKey: 'agent:main:foreign' })).success).toBe(false);
    expect((await fixture.terminal()).research?.status).toBe('complete'); expect(fixture.rpc).toHaveBeenCalledTimes(1);
  });
  it('requires a provider reservation receipt and keeps the admitted sources partial when it is missing', async () => {
    const fixture = setup({ modelReceipt: false }); await fixture.api.researchStart(fixture.request);
    const response = await fixture.terminal();
    expect(response.research?.status).toBe('partial'); expect(response.research?.evidence).toHaveLength(1);
    expect(response.research?.gaps.some(gap => gap.reason === 'planning-unavailable')).toBe(true);
  });
  it('rejects a stale owner snapshot on status delivery without returning its evidence', async () => {
    const fixture = setup(); await fixture.api.researchStart(fixture.request); await fixture.terminal();
    hostState.changed = true;
    const response = await fixture.api.researchStatus(fixture.selected);
    expect(response.success).toBe(false); expect(response.research).toBeUndefined(); expect(JSON.stringify(response)).not.toContain('8080');
  });
  it('rechecks the owner after reading bytes and keeps a revoked request empty', async () => {
    const fixture = setup(); await fixture.api.researchStart(fixture.request); await fixture.terminal();
    const read = fixture.read.getMockImplementation()!;
    fixture.read.mockImplementationOnce(async () => { const page = await read(); hostState.changed = true; return page; });
    const denied = await fixture.api.researchStatus(fixture.selected);
    expect(denied.success).toBe(false); expect(denied.research).toBeUndefined();
    hostState.changed = false;
    expect((await fixture.api.researchStatus(fixture.selected)).research).toMatchObject({ stopReason: 'scope-changed', evidence: [], retainedEvidence: [], steps: [] });
  });
  it('delivers the snapshot whose evidence was checked when planning finishes during a poll', async () => {
    const fixture = setup(), model = hostState.model!;
    let release!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    hostState.model = async args => { const output = model(args); await waiting; return output; };
    try {
      await fixture.api.researchStart(fixture.request);
      await vi.waitFor(() => expect(fixture.modelCalls).toHaveLength(1));
      const read = fixture.read.getMockImplementation()!;
      fixture.read.mockImplementationOnce(async () => {
        release();
        expect((await fixture.terminal()).research?.phase).toBe('finished');
        return read();
      });
      expect((await fixture.api.researchStatus(fixture.selected)).research).toMatchObject({ phase: 'planning',
        usage: { actualPlanningTokens: null, actualCostUsd: null } });
      expect((await fixture.terminal()).research).toMatchObject({ phase: 'finished',
        usage: { actualPlanningTokens: 100, actualCostUsd: 0.0001 } });
    } finally { release(); }
  });
});

it('never republishes cached evidence when cancellation readback loses the owner', async () => {
  const controller = new AbortController();
  const plan = createResearchPlan({ requestId: 'cancel-readback', query: 'Gateway port', scope });
  const running = { ...emptyResearchResult(plan), evidence: [evidence('port')] };
  vi.mocked(hostApi.knowledge.researchStart).mockResolvedValue({ success: true, research: running });
  vi.mocked(hostApi.knowledge.researchStatus).mockResolvedValue({ success: false, error: 'owner changed' });
  vi.mocked(hostApi.knowledge.researchCancel).mockResolvedValue({ success: true });
  const updates = vi.fn(() => controller.abort());
  await expect(readKnowledgeResearch({ query: plan.query }, controller.signal, updates, 'research failed')).rejects.toThrow('owner changed');
  expect(updates).toHaveBeenCalledTimes(1);
});

it('returns cancellation without cached evidence when the owner has no final snapshot', async () => {
  const controller = new AbortController();
  const plan = createResearchPlan({ requestId: 'empty-readback', query: 'Gateway port', scope });
  vi.mocked(hostApi.knowledge.researchStart).mockResolvedValue({ success: true, research: { ...emptyResearchResult(plan), evidence: [evidence('port')] } });
  vi.mocked(hostApi.knowledge.researchStatus).mockResolvedValue({ success: true });
  vi.mocked(hostApi.knowledge.researchCancel).mockResolvedValue({ success: true });
  const updates = vi.fn(() => controller.abort());
  expect(await readKnowledgeResearch({ query: plan.query }, controller.signal, updates, 'research failed')).toEqual({ reason: 'cancelled' });
  expect(updates).toHaveBeenCalledTimes(1);
});
