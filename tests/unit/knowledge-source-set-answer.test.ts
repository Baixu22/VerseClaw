import { describe, expect, it, vi } from 'vitest';
import { retrieveSelectedSourceSetEvidence } from '@electron/services/knowledge-source-set-answer';
import { digestSourceSetContent } from '../../openclaw_runtime/src/context-engine/source-set';

const ref = { id: 'notes/decision.md', kind: 'wiki' as const, path: 'notes/decision.md' };
const content = '  Review before applying.\nKeep the original read bytes.\n';
const page = {
  corpus: 'wiki', path: ref.path, title: 'Decision', content,
  revision: 19, status: 'active', updatedAt: '2026-11-04T08:00:00.000Z',
  fromLine: 1, lineCount: 80, totalLines: 3, truncated: false,
};
const read = (patch: Record<string, unknown> = {}) => vi.fn(async () => ({ ...page, ...patch }));

describe('selected Source Set owner admission', () => {
  it('retains owner revision, freshness, exact read bytes and advisory trust', async () => {
    const result = await retrieveSelectedSourceSetEvidence({ question: 'Review?', sourceRefs: [ref], readPage: read() });
    expect(result.sourceSet.retrieved[0]).toMatchObject({
      content, indexedAt: page.updatedAt,
      ref: { revision: '19', trust: 'advisory', contentDigest: digestSourceSetContent(content) },
    });
    expect(result.sources[0]).toMatchObject({
      citation: { owner: 'memory-wiki', subjectId: ref.path, revision: '19', contentDigest: digestSourceSetContent(content) },
      updatedAt: page.updatedAt, readRange: { fromLine: 1, toLine: 3, totalLines: 3, truncated: false },
    });
    expect(result.groundingStatus).toBe('partial');
    expect(result.sources[0]).not.toHaveProperty('content');
  });

  it.each(['archived', 'revoked', 'deleted', 'denied', 'stale', 'unexpected-state'])('rejects owner status %s', async (status) => {
    const result = await retrieveSelectedSourceSetEvidence({ question: 'Review?', sourceRefs: [ref], readPage: read({ status }) });
    expect(result.sources).toEqual([]);
    expect(result.groundingStatus).toBe('missing_sources');
    expect(result.sourceSet.rejections).toEqual([expect.objectContaining({ reason: status === 'unexpected-state' ? 'denied' : status })]);
    expect(result.unknowns.join(' ')).not.toContain('Keep the original read bytes.');
  });

  it.each(['sensitive', 'secret-adjacent', 'secret', 'personal', 'unknown-tier', '__proto__', 'constructor', null])('rejects restricted or unknown privacy tier %s', async (privacyTier) => {
    const result = await retrieveSelectedSourceSetEvidence({ question: 'Review?', sourceRefs: [ref], readPage: read({ privacyTier }) });
    expect(result.sources).toEqual([]);
    expect(result.sourceSet.rejections).toEqual([expect.objectContaining({ reason: 'sensitivity' })]);
  });

  it.each([{ read: ['another-operator'] }, null, { read: 'operator' }])('cannot replace an owner ACL with operator access: %j', async (acl) => {
    const result = await retrieveSelectedSourceSetEvidence({ question: 'Review?', sourceRefs: [ref], readPage: read({ acl }) });
    expect(result.sources).toEqual([]);
    expect(result.sourceSet.rejections).toEqual([expect.objectContaining({ reason: acl && Array.isArray(acl.read) ? 'acl_denied' : 'denied' })]);
  });

  it('enforces a supplied workspace filter against the owner scope', async () => {
    const result = await retrieveSelectedSourceSetEvidence({
      question: 'Review?', sourceRefs: [ref], workspaceId: 'workspace-a',
      readPage: read({ scope: { workspaceId: 'workspace-b' } }),
    });
    expect(result.sources).toEqual([]);
    expect(result.sourceSet.rejections[0].reason).toBe('scope_mismatch');
  });

  it.each([null, {}, { title: 'An empty source' }, { content: '   ', title: 'No source body' }, { content: '', body: 'Stale fallback body' }, { corpus: 'memory', content }])('does not turn an empty or wrong-owner result into title evidence: %j', async (value) => {
    const result = await retrieveSelectedSourceSetEvidence({ question: 'Review?', sourceRefs: [ref], readPage: async () => value });
    expect(result.sources).toEqual([]);
    expect(result.sourceSet.rejections[0].reason).toBe('not_found');
  });

  it('discloses a truncated range without pretending it read the complete page', async () => {
    const result = await retrieveSelectedSourceSetEvidence({
      question: 'Review?', sourceRefs: [ref], readPage: read({ fromLine: 81, totalLines: 120, truncated: true }),
    });
    expect(result.sources[0].readRange).toEqual({ fromLine: 81, toLine: 83, totalLines: 120, truncated: true });
    expect(result.unknowns.join(' ')).toContain('truncated to lines 81-83 of 120');
    expect(result.groundingStatus).toBe('partial');
  });

  it.each([{ scope: null }, { scope: { workspaceId: 42 } }, { workspaceId: 0 }])('rejects malformed owner scope metadata: %j', async (patch) => {
    const result = await retrieveSelectedSourceSetEvidence({ question: 'Review?', sourceRefs: [ref], readPage: read(patch) });
    expect(result.sources).toEqual([]);
    expect(result.sourceSet.rejections[0]).toMatchObject({ reason: 'denied', visibleReason: expect.stringContaining('invalid owner scope') });
  });

  it.each([{ fromLine: 0 }, { totalLines: 2 }, { truncated: 'false' }])('rejects an invalid supplied read range: %j', async (patch) => {
    const result = await retrieveSelectedSourceSetEvidence({ question: 'Review?', sourceRefs: [ref], readPage: read(patch) });
    expect(result.sources).toEqual([]);
    expect(result.sourceSet.rejections[0]).toMatchObject({ reason: 'denied', visibleReason: expect.stringContaining('invalid owner read range') });
  });

  it('does not invent an indexing timestamp for a legacy owner result', async () => {
    const result = await retrieveSelectedSourceSetEvidence({ question: 'Review?', sourceRefs: [ref], readPage: read({ updatedAt: undefined, revision: undefined }) });
    expect(result.sourceSet.retrieved[0].indexedAt).toBe('1970-01-01T00:00:00.000Z');
    expect(result.sources[0].updatedAt).toBeUndefined();
    expect(result.sources[0].citation?.revision).toBe(digestSourceSetContent(content));
    expect(result.unknowns.join(' ')).toContain('no known freshness timestamp');
  });

  it.each([
    { revision: '18' }, { contentDigest: digestSourceSetContent('another read') },
  ])('does not relax an explicit version pin after a mismatch: %j', async (pin) => {
    const result = await retrieveSelectedSourceSetEvidence({ question: 'Review?', sourceRefs: [{ ...ref, ...pin }], readPage: read() });
    expect(result.sources).toEqual([]);
    expect(result.sourceSet.rejections[0].reason).toBe(pin.revision ? 'revision_mismatch' : 'digest_mismatch');
  });

  it('rejects a supplied owner content digest that does not match the read bytes', async () => {
    const result = await retrieveSelectedSourceSetEvidence({ question: 'Review?', sourceRefs: [ref], readPage: read({ contentDigest: digestSourceSetContent('altered') }) });
    expect(result.sources).toEqual([]);
    expect(result.sourceSet.rejections[0].reason).toBe('digest_mismatch');
  });

  it('passes only admitted content into the optional embedding provider', async () => {
    const embedBatch = vi.fn(async (texts: string[]) => texts.map(() => [1, 0]));
    const provider = { id: 'agent-test', dimension: 2, embedQuery: vi.fn(async () => [1, 0]), embedBatch };
    const result = await retrieveSelectedSourceSetEvidence({
      question: 'Review?', sourceRefs: [ref, { id: 'notes/secret.md', kind: 'wiki', path: 'notes/secret.md' }],
      readPage: async (selected) => selected.id === ref.id ? page : { ...page, path: selected.path, content: 'SECRET_READ_BODY', privacyTier: 'secret' },
      embeddingProvider: provider,
    });
    expect(embedBatch).toHaveBeenCalledWith([content]);
    expect(result.sources.map((source) => source.lookup)).toEqual([ref.path]);
    expect(JSON.stringify(result.sources)).not.toContain('SECRET_READ_BODY');
  });

  it('semantic errors retain the admitted set rather than refilling rejected text', async () => {
    const provider = { id: 'agent-error', dimension: 2, embedQuery: vi.fn(async () => { throw new Error('embedding unavailable'); }), embedBatch: vi.fn(async () => []) };
    const result = await retrieveSelectedSourceSetEvidence({
      question: 'Review?', sourceRefs: [ref], readPage: read({ status: 'archived' }), embeddingProvider: provider,
    });
    expect(result.sourceSet.semanticLane.status).toBe('error');
    expect(result.sources).toEqual([]);
    expect(result.groundingStatus).toBe('missing_sources');
  });

  it('preserves structured owner claim conflicts and their version-bound citations', async () => {
    const refs = [ref, { ...ref, id: 'notes/other.md', path: 'notes/other.md' }];
    const result = await retrieveSelectedSourceSetEvidence({
      question: 'Which port?', sourceRefs: refs,
      readPage: async (selected) => ({
        ...page, path: selected.path, revision: selected.id === ref.id ? 19 : 20,
        content: selected.id === ref.id ? 'Port 8080' : 'Port 9090',
        claims: [{ claimId: 'deployment-port', statement: selected.id === ref.id ? 'Port 8080' : 'Port 9090', stance: selected.id === ref.id ? '8080' : '9090' }],
      }),
    });
    expect(result.sourceSet.conflictSet).toEqual([expect.objectContaining({
      key: 'claim:deployment-port', stances: ['8080', '9090'],
      citations: [expect.objectContaining({ revision: '19' }), expect.objectContaining({ revision: '20' })],
    })]);
    expect(result.unknowns.join(' ')).toContain('Conflicting stances');
    expect(result.groundingStatus).toBe('partial');
  });

  it('deduplicates canonical aliases without duplicating the evidence', async () => {
    const result = await retrieveSelectedSourceSetEvidence({ question: 'Review?', sourceRefs: [ref, { ...ref, id: 'decision-alias', path: 'decision-alias' }], readPage: read() });
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0].citation?.subjectId).toBe(ref.path);
  });

  it('does not let an active alias hide a later archived read of the same owner', async () => {
    const result = await retrieveSelectedSourceSetEvidence({
      question: 'Review?', sourceRefs: [ref, { ...ref, id: 'decision-alias', path: 'decision-alias' }],
      readPage: async (selected) => ({ ...page, status: selected.id === ref.id ? 'active' : 'archived' }),
    });
    expect(result.sources).toEqual([]);
    expect(result.sourceSet.rejections[0]).toMatchObject({ reason: 'denied', visibleReason: expect.stringContaining('inconsistent owner reads') });
  });
});
