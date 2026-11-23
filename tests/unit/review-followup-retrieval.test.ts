// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { createOwnerReadSnapshot, deriveReadAdmissionContext } from '../../openclaw_runtime/src/runtime-core/knowledge-owner-read';
import { retrieveMemoryWiki, resolveMemoryWikiConfig } from '../../openclaw_runtime/extensions/memory-wiki/runtime-api';

const fixture = vi.hoisted(() => ({ context: undefined as unknown, snapshot: undefined as unknown }));
vi.mock('../../openclaw_runtime/extensions/memory-wiki/src/owner-read', () => ({
  createMemoryWikiReadContext: () => fixture.context,
  memoryWikiNamespaceId: () => 'wiki-fixture',
}));
vi.mock('../../openclaw_runtime/extensions/memory-wiki/src/query', () => ({
  getMemoryWikiPage: async () => ({ path: 'fixture.md', title: 'Local source', pageType: 'concept', ownerSnapshot: fixture.snapshot }),
}));

it.each(['local', 'exact', 'unavailable'] as const)('keeps local results when remote reranking is configured but unused: %s', async (mode) => {
  const identity = { workspaceId: 'workspace-fixture', workspaceDir: 'fixture-root', agentSessionKey: 'agent:main:fixture', sessionId: 'session-fixture', egressProviderRefs: [] };
  const context = deriveReadAdmissionContext({ principalId: 'operator', sessionId: identity.sessionId, sessionKey: identity.agentSessionKey,
    agentId: 'main', workspaceId: identity.workspaceId, workspaceRootDigest: 'root-digest', ownerNamespaces: ['wiki-fixture'],
    policyDigest: 'policy-fixture', egressProviderRefs: [], expiresAt: new Date(Date.now() + 30_000).toISOString() });
  const content = 'A valid local knowledge answer.';
  const snapshot = createOwnerReadSnapshot({ raw: content, startChar: 0, endChar: content.length,
    source: { domain: 'wiki', authorityId: 'memory-wiki', namespaceId: 'wiki-fixture', subjectId: 'fixture.md', revision: '1' },
    context, policy: { status: 'active', trust: 'confirmed', sensitivity: 'public', acl: { read: ['operator'] }, retention: { policy: 'source-coupled' }, updatedAt: new Date().toISOString() }, title: 'Local source' });
  fixture.context = context; fixture.snapshot = snapshot;
  const projection = { status: () => ({ sources: [{ eligible: true, activeGeneration: 'fixture-generation' }] }),
    search: async () => ({ status: 'available', candidates: [{ chunkId: 'chunk-fixture', sourceRef: snapshot.source, lexicalRank: 1, quote: content }] }) };
  const rerank = { status: () => ({ mode: 'remote', providerRef: 'remote-fixture' }), provider: vi.fn(async () => { throw Error('provider unavailable'); }) };
  const result = await retrieveMemoryWiki({ config: resolveMemoryWikiConfig({ vault: { path: 'fixture-root' } }), identity,
    query: 'local answer', profile: mode === 'local' ? 'local' : 'quality',
    ...(mode === 'exact' ? { explicitRefs: [snapshot.source] } : {}), projection: projection as never, rerank: rerank as never });
  expect(result.results).toHaveLength(1);
  expect(result.filters.some(filter => filter.reason === 'egress_denied')).toBe(false);
  if (mode !== 'unavailable') expect(rerank.provider).not.toHaveBeenCalled();
});
