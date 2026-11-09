// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createMemoryWikiReadContext, getMemoryWikiPage, resolveMemoryWikiConfig,
} from '../../openclaw_runtime/extensions/memory-wiki/runtime-api';
import {
  boundOwnerReadSnapshot, digestOwnerReadContent, evaluateOwnerReadSnapshot,
  matchOwnerReadPin, type OwnerReadSnapshotV1,
} from '../../openclaw_runtime/src/runtime-core/knowledge-owner-read';
import { retrieveSourceSet, type SourceSetCandidate } from '../../openclaw_runtime/src/context-engine/source-set';

describe('Project RAG owner read contract', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'project-rag-owner-'));
    await mkdir(join(root, 'concepts'), { recursive: true });
  });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });
  const config = () => resolveMemoryWikiConfig({ vault: { path: root }, search: { backend: 'local', corpus: 'wiki' } });
  const raw = (extra = '', body = 'Owner read contract: 中文 日本語 русский 😀.\n') => `---\ntitle: Owner read contract\n${/^revision:/m.test(extra) ? '' : 'revision: 1\n'}trust: confirmed\n${extra}---\n${body}`;
  const save = async (value: string) => writeFile(join(root, 'concepts', 'owner.md'), value, 'utf8');
  const get = (pin?: OwnerReadSnapshotV1['source']) => getMemoryWikiPage({
    config: config(), lookup: 'concepts/owner.md', lineCount: 80,
    ...(pin ? { sourceRef: pin } : {}),
  });
  async function admitted(): Promise<OwnerReadSnapshotV1> {
    const value = await get();
    expect(value?.status).not.toBe('denied');
    expect(value?.ownerSnapshot).toBeDefined();
    return value!.ownerSnapshot!;
  }
  const candidate = (snapshot: OwnerReadSnapshotV1): SourceSetCandidate => ({
    ref: {
      refId: `memory-wiki:${snapshot.source.subjectId}`, owner: 'memory-wiki', subjectKind: 'wiki-page',
      subjectId: snapshot.source.subjectId, revision: snapshot.source.revision,
      contentDigest: snapshot.contentDigest, sourceRef: snapshot.source, ownerSnapshot: snapshot,
      trust: snapshot.policy.trust, sensitivity: snapshot.policy.sensitivity,
      acl: snapshot.policy.acl, scope: snapshot.policy.scope, retention: snapshot.policy.retention,
    },
    content: snapshot.content, status: snapshot.policy.status, indexedAt: snapshot.readAt,
  });

  it('binds the complete raw bytes, owner policy, namespace and raw locator', async () => {
    const content = '\uFEFF' + raw('privacyTier: internal\nretention:\n  policy: source-coupled\n',
      Array.from({ length: 100 }, (_, i) => `第${i + 1}行 😀`).join('\n')).replace(/\n/g, '\r\n');
    await save(content);
    const snapshot = await admitted();
    const bytes = await readFile(join(root, 'concepts', 'owner.md'));
    expect(snapshot.source.sourceDigest).toBe(digestOwnerReadContent(bytes));
    expect(snapshot.source.revision).toBe('1');
    expect(snapshot.source.namespaceId).toContain('memory-wiki:');
    expect(snapshot.policy).toMatchObject({ trust: 'confirmed', sensitivity: 'workspace', retention: { policy: 'source-coupled' } });
    const range = snapshot.source.locator!;
    expect(bytes.subarray(range.startByte, range.endByteExclusive).toString('utf8')).toBe(snapshot.content);
    expect(range.startLine).toBeGreaterThan(1);
    expect(snapshot.content).toContain('第80行');
    expect(snapshot.content).not.toContain('第81行');
    expect((await get(snapshot.source))?.ownerSnapshot?.content).toBe(snapshot.content);
  });

  it.each([
    ['revoked', 'status: revoked\n'], ['archived', 'status: archived\n'],
    ['deleted', 'status: deleted\n'], ['stale', 'status: stale\n'], ['denied', 'status: denied\n'],
    ['sensitive', 'privacyTier: private\n'], ['sensitive', 'privacyTier: secret\n'],
    ['acl_denied', 'acl:\n  read: [another-principal]\n'], ['acl_denied', 'acl:\n  read: []\n'],
    ['scope_mismatch', 'scope:\n  workspaceId: another-workspace\n'],
    ['scope_mismatch', 'scope:\n  agentId: another-agent\n'],
    ['scope_mismatch', 'scope:\n  sessionKey: another-session\n'],
    ['expired', 'retention:\n  expiresAt: "2000-01-01T00:00:00Z"\n'],
    ['expired', 'retention:\n  expiresAt: invalid-date\n'],
    ['denied', 'status: unknown-owner-status\n'], ['denied', 'acl: invalid\n'],
    ['denied', 'status: null\n'], ['denied', 'status: [active]\n'],
    ['denied', 'scope:\n  workspaceId: null\n'], ['denied', 'retention: null\n'],
    ['denied', 'retention:\n  expiresAt: null\n'], ['denied', 'revision: 0\n'],
    ['sensitive', 'privacyTier: null\n'],
  ])('returns no source bytes for %s (%s)', async (reason, metadata) => {
    await save(raw(metadata));
    const value = await get();
    expect(value).toMatchObject({ status: 'denied', reason, content: '' });
    expect(value?.ownerSnapshot).toBeUndefined();
  });

  it('rejects edits below the 80-line window instead of serving the newer version as a pin', async () => {
    const body = Array.from({ length: 100 }, (_, i) => `Owner line ${i}`).join('\n');
    await save(raw('', body));
    const first = await admitted();
    await save(raw('', body + '\nChanged tail outside the read range'));
    expect(await get(first.source)).toMatchObject({ status: 'denied', reason: 'digest_mismatch', content: '' });
    expect((await admitted()).source.sourceDigest).not.toBe(first.source.sourceDigest);
  });

  it('checks current permissions before reopening a formerly valid citation', async () => {
    await save(raw());
    const first = await admitted();
    await save(raw('acl:\n  read: [another-principal]\n'));
    expect(await get(first.source)).toMatchObject({ status: 'denied', reason: 'acl_denied', content: '' });
  });

  it('does not resurrect a deleted source from a retained pin', async () => {
    await save(raw());
    const first = await admitted();
    await rm(join(root, 'concepts', 'owner.md'));
    expect(await get(first.source)).toMatchObject({ status: 'denied', reason: 'not_found', content: '' });
  });

  it('keeps full source identity when bounding the exact prompt excerpt', async () => {
    await save(raw('', '中文😀'.repeat(600)));
    const first = await admitted();
    const bounded = boundOwnerReadSnapshot(first, 1200);
    expect(bounded.content.length).toBeLessThanOrEqual(1200);
    expect(bounded.source.sourceDigest).toBe(first.source.sourceDigest);
    expect(bounded.contentDigest).not.toBe(first.contentDigest);
    expect(evaluateOwnerReadSnapshot(bounded, first.context)).toBeUndefined();
    expect((await get(bounded.source))?.content).toBe(bounded.content);
  });

  it('reopens a range pin with matching body-line and truncation metadata', async () => {
    await save(raw('', Array.from({ length: 100 }, (_, i) => `Line ${i + 1}`).join('\n')));
    const first = await getMemoryWikiPage({ config: config(), lookup: 'concepts/owner.md', fromLine: 81, lineCount: 5 });
    const reopened = await get(first!.sourceRef!);
    expect(reopened).toMatchObject({ content: first!.content, fromLine: 81, lineCount: 5, truncated: true });
    const bounded = boundOwnerReadSnapshot(first!.ownerSnapshot!, 12);
    const shortened = await get(bounded.source);
    expect(shortened).toMatchObject({ content: bounded.content, fromLine: 81, truncated: true });
    expect(shortened!.lineCount).toBe(bounded.source.locator!.endLine - bounded.source.locator!.startLine + 1);
  });

  it('rejects replacement candidate bytes before calling the embedding provider', async () => {
    await save(raw());
    const original = candidate(await admitted());
    const substituted = { ...original, content: 'Substituted text', ref: { ...original.ref, contentDigest: digestOwnerReadContent('Substituted text') } };
    const provider = { id: 'agent-fixture', dimension: 2, embedQuery: vi.fn(async () => [1, 0]), embedBatch: vi.fn(async () => [[1, 0]]) };
    const result = await retrieveSourceSet({ sources: [substituted], query: { text: 'Substituted', aclSubjects: ['operator'] }, embeddingProvider: provider });
    expect(result.retrieved).toEqual([]);
    expect(result.rejections[0].reason).toBe('digest_mismatch');
    expect(provider.embedQuery).not.toHaveBeenCalled();
    expect(provider.embedBatch).not.toHaveBeenCalled();
  });

  it('requires a raw locator on a resolved SourceSet candidate', async () => {
    await save(raw());
    const original = candidate(await admitted());
    const { locator: _locator, ...withoutRange } = original.ref.sourceRef!;
    const result = await retrieveSourceSet({
      sources: [{ ...original, ref: { ...original.ref, sourceRef: withoutRange } }],
      query: { text: 'Owner', aclSubjects: ['operator'] },
    });
    expect(result.retrieved).toEqual([]);
    expect(result.rejections[0].reason).toBe('invalid_range');
  });

  it('returns an explicit denial for a pin that ends inside a UTF-8 code point', async () => {
    await save(raw('', 'A😀B'));
    const first = await admitted();
    const startByte = first.source.locator!.startByte + 1;
    const pin = { ...first.source, locator: { ...first.source.locator!, startByte, endByteExclusive: startByte + 3 } };
    expect(await get(pin)).toMatchObject({ status: 'denied', reason: 'invalid_range', content: '' });
  });

  it('does not turn a corpus selector into a different permission policy', async () => {
    await save(raw());
    const first = await admitted();
    const changed = createMemoryWikiReadContext({ config: { ...config(), search: { backend: 'shared', corpus: 'all' } } });
    expect(changed.policyDigest).toBe(first.context.policyDigest);
    expect(changed.ownerNamespaces).toEqual(first.context.ownerNamespaces);
    expect(evaluateOwnerReadSnapshot(first, changed)).toBeUndefined();
  });

  it('records a late revoked pin as partial while retaining the other valid pin', async () => {
    await save(raw());
    const first = candidate(await admitted());
    await writeFile(join(root, 'concepts', 'other.md'), raw('', 'Other owner evidence'), 'utf8');
    const secondPage = await getMemoryWikiPage({ config: config(), lookup: 'concepts/other.md' });
    const second = candidate(secondPage!.ownerSnapshot!);
    await save(raw('status: revoked\n'));
    const result = await retrieveSourceSet({
      sources: [first, second], query: { text: 'Owner', aclSubjects: ['operator'], pinnedRefs: [first, second].map(value => ({ owner: value.ref.owner, subjectId: value.ref.subjectId })) },
      verifyOwnerRead: async value => {
        const current = await getMemoryWikiPage({ config: config(), lookup: value.ref.subjectId, sourceRef: value.ref.sourceRef });
        return current?.status === 'denied' ? current.reason as 'revoked' : undefined;
      },
    });
    expect(result.retrieved.map(value => value.ref.subjectId)).toEqual(['concepts/other.md']);
    expect(result.evidenceStatus).toBe('partial');
    expect(result.unresolvedPinnedRefs).toEqual([expect.objectContaining({ reason: 'revoked', subjectId: first.ref.subjectId })]);
  });

  it('rejects namespace, revision, digest and range drift', async () => {
    await save(raw());
    const first = await admitted();
    expect(matchOwnerReadPin(first, { ...first.source, namespaceId: 'other' })).toBe('namespace_mismatch');
    expect(matchOwnerReadPin(first, { ...first.source, revision: '2' })).toBe('revision_mismatch');
    expect(matchOwnerReadPin(first, { ...first.source, sourceDigest: digestOwnerReadContent('other') })).toBe('digest_mismatch');
    expect(matchOwnerReadPin(first, { ...first.source, locator: { ...first.source.locator!, startByte: 1 } })).toBe('invalid_range');
    const reordered = { endLine: first.source.locator!.endLine, ...first.source.locator! };
    expect(matchOwnerReadPin(first, { ...first.source, locator: reordered })).toBeUndefined();
  });

  it('rejects context changes, expiration, cancellation and unapproved egress at every use gate', async () => {
    await save(raw());
    const first = await admitted();
    const changed = createMemoryWikiReadContext({ config: config(), identity: { workspaceId: 'another-workspace' } });
    expect(evaluateOwnerReadSnapshot(first, changed)).toBe('invalid_context');
    expect(evaluateOwnerReadSnapshot(first, { ...first.context, expiresAt: '2000-01-01' })).toBe('expired');
    const controller = new AbortController(); controller.abort();
    for (const stage of ['snippet', 'embedding', 'rerank', 'prompt'] as const) {
      expect(evaluateOwnerReadSnapshot(first, first.context, { stage, signal: controller.signal })).toBe('cancelled');
      expect(evaluateOwnerReadSnapshot(first, first.context, { stage, providerRef: 'unconfigured-provider' })).toBe('egress_denied');
    }
  });
});
