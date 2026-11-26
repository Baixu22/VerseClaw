import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { verifyRetrievalArtifactManifest, planRetrievalUpgrade, availableArtifactBytes } from './lib/project-rag-package.mjs';

async function probe(runtime: string, output: string) {
  const manifest = verifyRetrievalArtifactManifest(runtime, { target: `${process.platform}-${process.arch}` });
  await mkdir(output, { recursive: true });
  const temporary = await mkdtemp(join(output, 'native-'));
  const receipt: Record<string, unknown> = { schema: 'RetrievalPlatformMatrix/v1', actor: 'codex/project-rag-native-probe',
    driven_by: 'agent', candidate: manifest.candidate, target: manifest.target, manifestDigest: manifest.manifestDigest,
    node: process.version, status: 'running', network: 'none', modelExecution: 'not-run',
    capacityMeasured: false, sqlite: false, fts: false, sdk: false, portable: false, ann: 'unavailable' };
  try {
    const database = new DatabaseSync(join(temporary, 'probe.sqlite'));
    database.exec('CREATE VIRTUAL TABLE retrieval_fts USING fts5(value)');
    database.prepare('INSERT INTO retrieval_fts(value) VALUES (?)').run('portable retrieval');
    if (database.prepare('SELECT value FROM retrieval_fts WHERE retrieval_fts MATCH ?').get('retrieval')?.value !== 'portable retrieval')
      throw new Error('FTS roundtrip failed');
    database.close(); receipt.sqlite = true; receipt.fts = true;
    const sdk = await import(pathToFileURL(join(runtime, 'dist/plugin-sdk/knowledge-retrieval.js')).href);
    if (typeof sdk.VectorStore !== 'function' || typeof sdk.createPortableVectorSearch !== 'function') throw new Error('Packaged SDK exports unavailable');
    receipt.sdk = true;
    const store = new sdk.VectorStore({ path: join(temporary, 'vector.sqlite') });
    const space = sdk.createEmbeddingSpace({ providerRef: 'agent-native-probe', model: 'deterministic-two-dimension',
      modelRevision: 'v1', dimensions: 2, maxInputTokens: 16, tokenizerId: 'agent-fixture',
      tokenizerDigest: 'sha256:' + createHash('sha256').update('agent-fixture').digest('hex'),
      inputFormat: { id: 'agent-fixture', query: '{text}', document: '{text}' }, normalization: 'l2' });
    const generation = store.begin('agent-probe', 'agent-workspace', space, 'sqlite-flat');
    const digest = 'sha256:' + 'a'.repeat(64);
    store.write(generation, space, [{ schema: 'VectorProjection/v1', id: 'probe-row', generationId: generation.generationId,
      workspaceId: 'agent-workspace', namespaceId: 'agent-probe', spaceId: space.spaceId, chunkId: 'probe',
      chunkDigest: digest, sourceGeneration: '1', vector: [1, 0], source: { schema: 'SourceRef/v2', domain: 'wiki',
        authorityId: 'agent-probe', namespaceId: 'agent-probe', subjectId: 'probe.md', revision: '1',
        sourceDigest: digest, policyEpoch: '1', locator: { coordinateSpace: 'raw-source-utf8-v1', startByte: 0,
          endByteExclusive: 1, startLine: 1, endLine: 1 } } }]);
    if (!store.publish(generation, 1)) throw new Error('Portable generation publication failed');
    const worker = sdk.createPortableVectorSearch(store.database);
    try {
      const hits = await worker.search({ namespaceId: 'agent-probe', workspaceId: 'agent-workspace',
        generationId: generation.generationId, space, vector: [1, 0], limit: 1, eligibleIds: ['probe-row'] });
      if (hits[0]?.id !== 'probe-row') throw new Error('Portable vector roundtrip failed');
      receipt.portable = true;
    } finally { await worker.close(); }
    try {
      const require = createRequire(join(runtime, 'extensions/memory-wiki/package.json'));
      const native = require('@lancedb/lancedb');
      const connection = await native.connect(join(temporary, 'ann'));
      const table = await connection.createTable('probe', [{ id: 'probe-row', vector: [1, 0] }]);
      try { const rows = await table.vectorSearch([1, 0]).limit(1).toArray({ timeoutMs: 30000 });
        if (rows[0]?.id !== 'probe-row') throw new Error('ANN roundtrip failed'); receipt.ann = 'available';
      } finally { table.close(); await connection.dropTable('probe'); connection.close(); }
    } catch { receipt.ann = 'unavailable'; }
    receipt.effectiveBackend = receipt.ann === 'available' ? 'lancedb-ann' : 'sqlite-flat';
    receipt.status = 'passed';
  } catch (error) { receipt.status = 'failed'; receipt.error = error instanceof Error ? error.message : String(error); }
  await writeFile(join(output, 'report.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
  if (receipt.status !== 'passed') throw new Error(String(receipt.error));
}

async function main() {
  const [mode, first, second, third, fourth, installationTarget] = process.argv.slice(2);
  if (process.platform === 'win32') { process.env.TEMP = 'D:/tmp'; process.env.TMP = 'D:/tmp'; }
  if (mode === 'probe' && first && second) { await probe(resolve(first), resolve(second)); return; }
  if (mode === 'upgrade-check' && first && second && third && fourth && installationTarget) {
    const previous = verifyRetrievalArtifactManifest(resolve(first));
    const next = verifyRetrievalArtifactManifest(resolve(second));
    const database = new DatabaseSync(resolve(third), { readOnly: true });
    let version: number;
    try { version = Number(database.prepare('PRAGMA user_version').get()?.user_version); } finally { database.close(); }
    const receipt = planRetrievalUpgrade(previous, next, { databaseUserVersion: version,
      freeBytes: availableArtifactBytes(resolve(installationTarget)) });
    await writeFile(resolve(fourth), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
    if (receipt.status !== 'ready') throw new Error(receipt.reasons.join(', '));
    return;
  }
  throw new Error('Usage: knowledge-rag-package probe <runtime> <output> | upgrade-check <previous> <next> <owner.sqlite> <receipt.json> <installation-directory>');
}
void main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
