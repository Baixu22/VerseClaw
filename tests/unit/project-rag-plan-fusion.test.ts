// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createRetrievalPlan, fuseRetrievalLanes, runRetrievalPlan,
  type RetrievalHit, type RetrievalLaneResult,
} from '../../openclaw_runtime/src/knowledge/retrieval/plan';
import { digestSourceSetContent, retrieveSourceSet, type SourceSetCandidate } from '../../openclaw_runtime/src/context-engine/source-set';
import type { SourceRefV2 } from '../../shared/knowledge/owner-read-contract';

const source = (parent = 'page.md', namespaceId = 'wiki-fixture'): SourceRefV2 => ({
  schema: 'SourceRef/v2', domain: 'wiki', authorityId: 'memory-wiki', namespaceId,
  subjectId: parent, revision: '1', sourceDigest: `sha256:${'a'.repeat(64)}`, policyEpoch: `sha256:${'b'.repeat(64)}`,
});
const hit = (id: string, parent = `${id}.md`, rawScore = 1, namespaceId = 'wiki-fixture'): RetrievalHit<string> => ({
  id, sourceRef: source(parent, namespaceId), rawScore, scoreKind: 'fixture-score', data: id,
});
const available = (hits: RetrievalHit<string>[]): RetrievalLaneResult<string> => ({ status: 'available', hits });
const plan = (input: Partial<Parameters<typeof createRetrievalPlan>[0]> = {}) => createRetrievalPlan({ query: 'gateway configuration', namespaceIds: ['wiki-fixture'], ...input });

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('Project RAG rank fusion', () => {
  it('uses ranks while preserving incompatible raw score kinds', () => {
    const fused = fuseRetrievalLanes([
      { lane: 'lexical', namespaceId: 'wiki-fixture', queryFamily: 'root', hits: [hit('a', 'a.md', -10000), hit('b', 'b.md', 99999)] },
      { lane: 'dense', namespaceId: 'wiki-fixture', queryFamily: 'root', hits: [hit('b', 'b.md', -99999), hit('c', 'c.md', 10000)] },
    ]);
    expect(fused.hits.map(row => row.id)).toEqual(['b', 'a', 'c']);
    expect(fused.hits[0].rankSignals.fusionScore).toBeCloseTo(1 / 62 + 1 / 61);
    expect(fused.hits[0].rankSignals.lanes.map(lane => lane.rawScore)).toEqual([99999, -99999]);
    expect(fused.hits[0]).not.toHaveProperty('confidence');
  });

  it('deduplicates rewritten queries in the same family and lane', () => {
    const batch = { lane: 'lexical' as const, namespaceId: 'wiki-fixture', queryFamily: 'root', hits: [hit('a')] };
    const fused = fuseRetrievalLanes([batch, batch, { ...batch, hits: [hit('b'), hit('a')] }]);
    expect(fused.hits.find(row => row.id === 'a')?.rankSignals.lanes).toHaveLength(1);
    expect(fused.hits.find(row => row.id === 'a')?.rankSignals.fusionScore).toBeCloseTo(1 / 61);
  });

  it('retains one independent contribution for a distinct query family', () => {
    const batch = { lane: 'dense' as const, namespaceId: 'wiki-fixture', queryFamily: 'root', hits: [hit('a')] };
    const fused = fuseRetrievalLanes([batch, { ...batch, queryFamily: 'relationship' }]);
    expect(fused.hits[0].rankSignals.lanes).toHaveLength(2);
    expect(fused.hits[0].rankSignals.fusionScore).toBeCloseTo(2 / 61);
  });

  it('assigns lane ranks after removing duplicate rows', () => {
    const fused = fuseRetrievalLanes([{ lane: 'lexical', namespaceId: 'wiki-fixture', queryFamily: 'root', hits: [hit('a'), hit('a'), hit('b')] }]);
    expect(fused.hits[1].rankSignals.lanes[0].rank).toBe(2);
  });

  it('keeps identical local IDs in different owner namespaces separate', () => {
    const fused = fuseRetrievalLanes(['wiki-fixture', 'other-owner'].map(namespaceId => ({ lane: 'exact' as const, namespaceId, queryFamily: 'root', hits: [hit('same', 'page.md', 1, namespaceId)] })));
    expect(fused.hits).toHaveLength(2);
  });

  it('deduplicates different projection IDs for the same exact owner range', () => {
    const first = hit('page-result', 'same.md'), second = { ...first, id: 'chunk-result' };
    const fused = fuseRetrievalLanes([
      { lane: 'exact', namespaceId: 'wiki-fixture', queryFamily: 'root', hits: [first] },
      { lane: 'lexical', namespaceId: 'wiki-fixture', queryFamily: 'root', hits: [second] },
    ]);
    expect(fused.hits).toHaveLength(1);
    expect(fused.hits[0].rankSignals.lanes.map(lane => lane.lane)).toEqual(['exact', 'lexical']);
  });

  it('rejects mixed source versions even when they have different projection IDs', () => {
    const first = hit('old-id', 'same.md'), second = { ...first, id: 'new-id', sourceRef: { ...first.sourceRef, revision: '2' } };
    const fused = fuseRetrievalLanes([
      { lane: 'lexical', namespaceId: 'wiki-fixture', queryFamily: 'root', hits: [first] },
      { lane: 'dense', namespaceId: 'wiki-fixture', queryFamily: 'root', hits: [second] },
    ]);
    expect(fused.hits).toEqual([]);
    expect(fused.filters[0].reason).toBe('inconsistent-source-pin');
  });

  it.each([false, true])('denies inconsistent pins even when repeated in one lane (%s)', sameLane => {
    const a = hit('a', 'page.md'), changed = { ...a, sourceRef: { ...a.sourceRef, revision: '2' } };
    const batch = { lane: 'lexical' as const, namespaceId: 'wiki-fixture', queryFamily: 'root', hits: [a] };
    const fused = fuseRetrievalLanes(sameLane ? [{ ...batch, hits: [a, changed] }] : [batch, { ...batch, lane: 'dense', hits: [changed] }]);
    expect(fused.hits).toEqual([]);
    expect(fused.filters).toContainEqual({ namespaceId: 'wiki-fixture', subjectId: 'page.md', reason: 'inconsistent-source-pin' });
  });

  it('does not revive a denied parent through another lane or version', () => {
    const fused = fuseRetrievalLanes([{ lane: 'dense', namespaceId: 'wiki-fixture', queryFamily: 'root', hits: [hit('new-version', 'denied.md', 1000), hit('allowed')] }],
      [{ namespaceId: 'wiki-fixture', subjectId: 'denied.md', reason: 'acl_denied' }]);
    expect(fused.hits.map(row => row.id)).toEqual(['allowed']);
  });
});

describe('Project RAG plans and bounded execution', () => {
  it.each(['off', 'manual'] as const)('does not call an owner lane in %s without explicit refs', async mode => {
    const retrieve = vi.fn();
    const result = await runRetrievalPlan({ plan: plan({ mode }), retrieve, verify: async () => undefined });
    expect(result.status).toBe('disabled');
    expect(retrieve).not.toHaveBeenCalled();
  });

  it('uses only the exact lane for explicit manual references', async () => {
    const retrieve = vi.fn(async (_input: { lane: string }) => available([hit('a')]));
    const result = await runRetrievalPlan({ plan: plan({ mode: 'manual', explicitRefs: [source('a.md')] }), retrieve, verify: async () => undefined });
    expect(retrieve).toHaveBeenCalledTimes(1);
    expect(retrieve.mock.calls[0][0].lane).toBe('exact');
    expect(result.results.map(row => row.id)).toEqual(['a']);
  });

  it.each(['local', 'quality', 'research'] as const)('freezes the %s profile budget and a shorter caller deadline', profile => {
    const current = plan({ profile, now: 1000, deadlineAtMs: 1100 });
    expect(current.budget.deadlineAtMs).toBe(1100);
    expect(Object.isFrozen(current.budget)).toBe(true);
    expect(current.profile).toBe(profile);
  });

  it('rejects unknown policies, widened owner refs and excess query budgets', () => {
    expect(() => plan({ profile: 'toString' as never })).toThrow('Invalid retrieval policy');
    expect(() => plan({ explicitRefs: [source('a.md', 'other-owner')] })).toThrow('outside the owner scope');
    expect(() => plan({ queries: [{ text: 'a', family: 'root' }, { text: 'b', family: 'root' }] })).toThrow('query budget');
    expect(() => plan({ deadlineAtMs: Infinity })).toThrow('Invalid retrieval deadline');
    expect(() => plan({ query: 'x'.repeat(4001) })).toThrow('4000');
  });

  it('filters out-of-scope lane hits before the final owner read', async () => {
    const verify = vi.fn(async () => undefined);
    const result = await runRetrievalPlan({ plan: plan(), retrieve: async () => available([hit('private', 'private.md', 1, 'other-owner')]), verify });
    expect(result.results).toEqual([]);
    expect(verify).not.toHaveBeenCalled();
    expect(result.filters.some(filter => filter.reason === 'owner-scope-mismatch')).toBe(true);
  });

  it('enforces parent quotas after fusion and refills with other parents', async () => {
    const chunk = (id: string, parent: string, start: number) => {
      const row = hit(id, parent);
      row.sourceRef.locator = { coordinateSpace: 'raw-source-utf8-v1', startByte: start, endByteExclusive: start + 1, startLine: start + 1, endLine: start + 1 };
      return row;
    };
    const result = await runRetrievalPlan({ plan: plan(), retrieve: async ({ lane }) => lane === 'lexical'
      ? available([chunk('a1', 'a.md', 0), chunk('a2', 'a.md', 1), chunk('a3', 'a.md', 2), hit('b1', 'b.md'), hit('c1', 'c.md')]) : available([]), verify: async () => undefined });
    expect(result.results.map(row => row.id)).toEqual(['a1', 'a2', 'b1', 'c1']);
    expect(result.filters).toContainEqual({ namespaceId: 'wiki-fixture', subjectId: 'a.md', reason: 'parent-quota' });
  });

  it('removes previously verified siblings if a later read denies their parent', async () => {
    const second = hit('a2', 'a.md');
    second.sourceRef.locator = { coordinateSpace: 'raw-source-utf8-v1', startByte: 2, endByteExclusive: 3, startLine: 2, endLine: 2 };
    const result = await runRetrievalPlan({ plan: plan(), retrieve: async ({ lane }) => lane === 'lexical'
      ? available([hit('a1', 'a.md'), second, hit('b', 'b.md')]) : available([]), verify: async row => row.id === 'a2' ? 'policy_changed' : undefined });
    expect(result.results.map(row => row.id)).toEqual(['b']);
    expect(result.filters).toContainEqual({ namespaceId: 'wiki-fixture', subjectId: 'a.md', reason: 'policy_changed' });
  });

  it('keeps lexical fallback within the original deadline when a provider ignores cancellation', async () => {
    vi.useFakeTimers();
    const current = plan();
    const execution = runRetrievalPlan({ plan: current, retrieve: async ({ lane }) => lane === 'dense'
      ? new Promise<RetrievalLaneResult<string>>(() => {}) : available(lane === 'lexical' ? [hit('fallback')] : []), verify: async () => undefined });
    await vi.advanceTimersByTimeAsync(700);
    const result = await execution;
    expect(result.results.map(row => row.id)).toEqual(['fallback']);
    expect(result.status).toBe('partial');
    expect(result.plan.budget.deadlineAtMs).toBe(current.budget.deadlineAtMs);
    expect(Date.now()).toBeLessThan(current.budget.deadlineAtMs);
    expect(result.fallbackReasons.some(reason => reason.startsWith('dense:'))).toBe(true);
  });

  it('discards late values after caller cancellation', async () => {
    const controller = new AbortController();
    let deliver!: (value: RetrievalLaneResult<string>) => void;
    const pending = new Promise<RetrievalLaneResult<string>>(resolve => { deliver = resolve; });
    const execution = runRetrievalPlan({ plan: plan(), signal: controller.signal, retrieve: () => pending, verify: async () => undefined });
    controller.abort(new Error('caller cancelled'));
    const result = await execution;
    deliver(available([hit('late')]));
    await Promise.resolve();
    expect(result.status).toBe('cancelled');
    expect(result.results).toEqual([]);
  });

  it('reports incomplete quality capability without claiming reranking', async () => {
    const result = await runRetrievalPlan({ plan: plan({ profile: 'quality' }), retrieve: async ({ lane }) => available(lane === 'dense' ? [hit('a')] : []), verify: async () => undefined });
    expect(result.effectiveProfile).toBe('hybrid');
    expect(result.status).toBe('partial');
    expect(result.fallbackReasons).toContain('rerank-unavailable');
  });
});

describe('SourceSet consumes the trusted retrieval order', () => {
  const candidate = (id: string, content: string): SourceSetCandidate => ({
    ref: { refId: id, owner: 'memory-wiki', subjectKind: 'wiki-page', subjectId: `${id}.md`, revision: '1', contentDigest: digestSourceSetContent(content), trust: 'confirmed', sensitivity: 'public', acl: { read: ['operator'] } },
    content, status: 'active', indexedAt: '2026-11-12T00:00:00Z',
  });
  it('preserves RRF order even when the second source has a higher legacy score', async () => {
    const sources = [candidate('a', 'unrelated source'), candidate('b', 'gateway configuration gateway configuration')];
    const query = { text: 'gateway configuration', aclSubjects: ['operator'], pinnedRefs: sources.map(row => ({ owner: row.ref.owner, subjectId: row.ref.subjectId })), limit: 2 };
    const legacy = await retrieveSourceSet({ query, sources });
    expect(legacy.retrieved.map(row => row.ref.refId)).toEqual(['b', 'a']);
    const preserved = await retrieveSourceSet({ query, sources, preserveOrder: true });
    expect(preserved.retrieved.map(row => row.ref.refId)).toEqual(['a', 'b']);
  });
  it('keeps owner rejection active when preserving the supplied order', async () => {
    const sources = [candidate('denied', 'gateway'), candidate('allowed', 'gateway')];
    const result = await retrieveSourceSet({ sources, preserveOrder: true, query: { text: 'gateway', aclSubjects: ['operator'] }, verifyOwnerRead: async row => row.ref.refId === 'denied' ? 'acl_denied' : undefined });
    expect(result.retrieved.map(row => row.ref.refId)).toEqual(['allowed']);
    expect(result.rejections.some(row => row.reason === 'acl_denied')).toBe(true);
  });
});
