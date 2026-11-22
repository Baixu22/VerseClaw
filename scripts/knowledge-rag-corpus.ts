import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { freezeRagV1 } from './lib/project-rag-freeze.mjs';
import { jsonBytes, loadFrozenRagCorpus, sha256 } from './lib/project-rag-corpus.mjs';
import { createMemoryWikiReadContext, readMemoryWikiOwnerSnapshot, resolveMemoryWikiConfig } from '../openclaw_runtime/extensions/memory-wiki/runtime-api';
import { toWikiPageSummary } from '../openclaw_runtime/extensions/memory-wiki/src/markdown';
import { catalogue as v2Catalogue } from '../harness/specs/fixtures/project-rag/authoring/v2.catalog.mjs';
import { codeTasks } from '../harness/specs/fixtures/project-rag/authoring/v2.code-tasks.mjs';

const root = resolve(process.cwd());
const corpusRoot = resolve(root, 'harness/specs/fixtures/project-rag/v4');
const releaseFile = resolve(root, 'harness/specs/fixtures/project-rag/release-v4.json');

async function ownerSnapshot(raw: string, subjectId: string, vault: string) {
  const config = resolveMemoryWikiConfig({ vault: { path: vault }, search: { backend: 'local', corpus: 'wiki' } });
  const page = toWikiPageSummary({ raw, absolutePath: resolve(vault, subjectId), relativePath: subjectId });
  assert(page);
  const context = createMemoryWikiReadContext({ config, identity: { workspaceId: 'rag-corpus-workspace' } });
  const result = readMemoryWikiOwnerSnapshot({ page: { ...page, raw }, config, context, fromLine: 1, lineCount: raw.split('\n').length });
  assert.equal(result.status, 'admitted');
  if (result.status !== 'admitted') throw new Error('Owner refused corpus source');
  return result.snapshot;
}

async function main() {
const action = process.argv[2];
if (action === 'freeze-v4') {
  assert(!existsSync(releaseFile), 'release exists; use a new corpus version');
  const result = await freezeRagV1(root, corpusRoot, ownerSnapshot, { catalogue: v2Catalogue, codeTasks, corpusId: 'project-rag-v4' });
  writeFileSync(releaseFile, JSON.stringify({ schema: 'ProjectRagCorpusRelease/v1', id: 'project-rag-v4', freezeDigest: result.freezeDigest,
    sourceRevision: '1a4cc531ee050794b89dc8d7e49ac7c7a1c71ec0', actor: 'codex/project-rag', driven_by: 'agent', createdAt: new Date().toISOString() }, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify(result, null, 2));
} else if (action === 'verify') {
  const release = JSON.parse(readFileSync(releaseFile, 'utf8'));
  const bundle = loadFrozenRagCorpus(corpusRoot, release.freezeDigest);
  for (const source of bundle.corpus.sources) {
    const original = execFileSync('git', ['show', `${source.origin.commit}:${source.origin.path}`], { cwd: root, maxBuffer: 4 * 1024 * 1024 });
    assert.equal(sha256(original), source.origin.digest, 'pinned repository source digest changed');
    const blob = execFileSync('git', ['rev-parse', `${source.origin.commit}:${source.origin.path}`], { cwd: root, encoding: 'utf8' }).trim();
    assert.equal(blob, source.origin.gitBlob, 'pinned repository blob changed');
  }
  const countBy = (rows: Array<Record<string, unknown>>, key: string) => Object.fromEntries([...new Set(rows.map(r => String(r[key])))].sort().map(k => [k, rows.filter(r => String(r[key]) === k).length]));
  const result = { status: 'pass', corpusId: bundle.corpus.id, sourceFiles: bundle.corpus.sources.length,
    queries: bundle.queries.length, tasks: bundle.tasks.length, negativeCases: bundle.negatives.length, plannedSlots: bundle.plan.slots.length,
    queriesBySplit: countBy(bundle.queries, 'split'), queriesByLocale: countBy(bundle.queries, 'locale'), queriesByIntent: countBy(bundle.queries, 'intent'),
    tasksByKind: countBy(bundle.tasks, 'kind'), tasksByProfile: countBy(bundle.tasks, 'profile'), safetyByKind: countBy(bundle.negatives, 'kind'),
    pinnedSourceBlobsMatched: bundle.corpus.sources.length,
    executedSlots: 0, freezeDigest: release.freezeDigest, actor: 'codex/project-rag-corpus-verifier', driven_by: 'agent' };
  const output = process.argv[3];
  if (output) writeFileSync(resolve(output), jsonBytes(result));
  console.log(JSON.stringify(result, null, 2));
} else throw new Error('Use freeze-v4 or verify');
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
