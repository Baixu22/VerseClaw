import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const output = process.argv[2];
assert(output, 'Pass an output receipt path');
const runtime = resolve('openclaw_runtime');
const manifest = JSON.parse(readFileSync(resolve(runtime, 'package.json'), 'utf8'));
const entries = JSON.parse(readFileSync(resolve(runtime, 'scripts/lib/plugin-sdk-entrypoints.json'), 'utf8'));
assert(entries.includes('knowledge-retrieval'));
assert.deepEqual(manifest.exports['./plugin-sdk/knowledge-retrieval'], {
  types: './src/plugin-sdk/knowledge-retrieval.ts', default: './src/plugin-sdk/knowledge-retrieval.ts',
});
const sdk = await import(pathToFileURL(resolve(runtime, 'dist/plugin-sdk/knowledge-retrieval.js')).href);
const owner = await import(pathToFileURL(resolve(runtime, 'dist/plugin-sdk/memory-host-core.js')).href);
const functions = ['normalizeKnowledgeSourceDocument', 'chunkKnowledgeDocument', 'citationLocatorForChunk', 'verifyKnowledgeCitation'];
for (const name of functions) assert.equal(typeof sdk[name], 'function', `Missing built SDK export ${name}`);
const context = owner.deriveReadAdmissionContext({ principalId: 'agent-probe', sessionId: 'built-probe', workspaceId: 'agent-fixture',
  ownerNamespaces: ['agent-fixture'], policyDigest: 'agent-fixture-policy', egressProviderRefs: [], expiresAt: '2099-01-01T00:00:00.000Z' });
const raw = '# Built SDK\r\n\r\nEnglish_identifier 中文 日本語 русский 😀.\r\n';
const snapshot = owner.createOwnerReadSnapshot({ raw, startChar: 0, endChar: raw.length, context,
  source: { domain: 'wiki', authorityId: 'agent-fixture', namespaceId: 'agent-fixture', subjectId: 'fixture.md', revision: '1' },
  policy: { status: 'active', trust: 'confirmed', sensitivity: 'workspace', acl: { read: ['agent-probe'] }, retention: { policy: 'source-coupled' } }, title: 'Built SDK' });
const tokenizer = { id: 'agent-fixture-codepoints/v1', digest: owner.digestOwnerReadContent('agent-fixture-codepoints/v1'), count: text => [...text].length };
const profile = { schema: 'ChunkerProfile/v1', version: 'markdown-structure-v2', targetTokens: 384, maxTokens: 768, maxChars: 2400, overlap: 0,
  tokenizerId: tokenizer.id, tokenizerDigest: tokenizer.digest };
const document = sdk.normalizeKnowledgeSourceDocument({ snapshot, context });
const chunks = sdk.chunkKnowledgeDocument(document, { context, profile, tokenizer });
assert(chunks.length >= 2); assert.equal(chunks.map(c => c.quote).join(''), raw);
for (const chunk of chunks) {
  const range = chunk.source.locator;
  const selected = owner.createOwnerReadSnapshot({ raw, context,
    startChar: Buffer.from(raw).subarray(0, range.startByte).toString('utf8').length,
    endChar: Buffer.from(raw).subarray(0, range.endByteExclusive).toString('utf8').length,
    source: { domain: 'wiki', authorityId: 'agent-fixture', namespaceId: 'agent-fixture', subjectId: 'fixture.md', revision: '1' },
    policy: snapshot.policy, title: snapshot.title });
  assert.deepEqual(sdk.verifyKnowledgeCitation({ locator: sdk.citationLocatorForChunk(chunk), snapshot: selected, context }), { status: 'exact-match', quote: chunk.quote });
}
const receipt = { schema: 'ProjectRagBuiltSdkProbe/v1', actor: 'codex/project-rag-built-probe', driven_by: 'agent',
  candidate: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  artifact: 'openclaw_runtime/dist/plugin-sdk/knowledge-retrieval.js',
  artifactDigest: 'sha256:' + createHash('sha256').update(readFileSync(resolve(runtime, 'dist/plugin-sdk/knowledge-retrieval.js'))).digest('hex'),
  fixtureOrigin: 'agent-authored-owner-snapshot', tokenizerMode: 'agent-fixture-codepoints',
  functions, chunks: chunks.length, roundTrips: chunks.length, status: 'pass' };
mkdirSync(dirname(resolve(output)), { recursive: true }); writeFileSync(resolve(output), JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify(receipt));
