import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { lstat, mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveMemoryWikiConfig } from '../openclaw_runtime/extensions/memory-wiki/src/config';
import { listMemoryWikiPagePaths } from '../openclaw_runtime/extensions/memory-wiki/src/query';
import { toWikiPageSummary } from '../openclaw_runtime/extensions/memory-wiki/src/markdown';
import { createMemoryWikiReadContext, readMemoryWikiOwnerSnapshot } from '../openclaw_runtime/extensions/memory-wiki/src/owner-read';
import type { OwnerReadSnapshotV1 } from '../openclaw_runtime/src/runtime-core/knowledge-owner-read';
import { jsonBytes, sha256, spanText } from './lib/project-rag-corpus.mjs';
import { RAG_QUERY_EVALUATOR_VERSION } from './lib/project-rag-query-grade.mjs';

type Origin = 'existing-owner' | 'agent-built-adaptation';
type CapturedSource = { id: string; path: string; snapshot: OwnerReadSnapshotV1; normalizedDigest: string;
  sourceType: string; sourcePath?: string; bytes: number; structure: Record<string, number>; languageSignals: string[];
  conflictCount: number };
export type KnowledgeCapture = { schema: 'KnowledgeAdaptationSnapshot/v1'; actor: string; driven_by: 'agent'; origin: Origin;
  status: 'complete' | 'partial' | 'empty' | 'unavailable'; observedAt: string; configDigest: string; workspaceDir: string;
  discovered: number; admitted: number; sources: CapturedSource[]; rejected: Array<{ sourceDigest: string; reason: string }>;
  issues: string[]; snapshotDigest: string };
const count = (text: string, pattern: RegExp) => [...text.matchAll(pattern)].length;
const captureDigest = (value: Omit<KnowledgeCapture, 'snapshotDigest'>) => sha256(jsonBytes(value));
const inside = (path: string, root: string) => {
  const rel = relative(root, path);
  return rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel);
};

/** Capture existing Wiki bytes through its read-policy owner without initializing a vault. */
export async function captureKnowledgeAdaptation(input: { configFile: string; output: string; workspaceDir: string;
  origin: Origin; actor: string; maxSources?: number; maxBytes?: number }): Promise<KnowledgeCapture> {
  assert(['existing-owner', 'agent-built-adaptation'].includes(input.origin) && input.actor.trim(), 'Explicit corpus origin and actor required');
  const maxSources = input.maxSources ?? 1000, maxBytes = input.maxBytes ?? 32 * 1024 * 1024;
  assert(Number.isSafeInteger(maxSources) && maxSources > 0 && maxSources <= 10000
    && Number.isSafeInteger(maxBytes) && maxBytes > 0 && maxBytes <= 128 * 1024 * 1024, 'Invalid snapshot budget');
  const output = join(await realpath(dirname(resolve(input.output))), basename(input.output));
  const configFile = await realpath(input.configFile);
  const configBytes = await readFile(configFile);
  assert(configBytes.length <= 4 * 1024 * 1024, 'Configuration exceeds read budget');
  const appConfig = JSON.parse(configBytes.toString('utf8'));
  const entry = appConfig.plugins?.entries?.['memory-wiki'];
  const config = resolveMemoryWikiConfig(entry?.config ?? {});
  const vault = resolve(config.vault.path), workspaceDir = await realpath(input.workspaceDir);
  assert(!inside(output, vault) && !inside(vault, output), 'Snapshot output must be separate from the source vault');
  const sources: CapturedSource[] = [], rejected: KnowledgeCapture['rejected'] = [], issues: string[] = [];
  const originals = new Map<string, Buffer>();
  let discovered = 0, totalBytes = 0;
  const enabled = entry?.enabled === true && appConfig.plugins?.enabled !== false;
  let status: KnowledgeCapture['status'] = 'unavailable';
  if (!enabled) issues.push('wiki-owner-not-enabled');
  else {
    const vaultExists = await stat(vault).then(value => value.isDirectory()).catch(error => {
      if (error.code === 'ENOENT') return false;
      throw error;
    });
    if (!vaultExists) issues.push('wiki-vault-not-found');
    else {
      const root = await realpath(vault);
      assert(!inside(output, root) && !inside(root, output), 'Snapshot output must be separate from the canonical source vault');
      const paths = await listMemoryWikiPagePaths(root);
      discovered = paths.length;
      if (paths.length > maxSources) issues.push('source-count-budget');
      for (const lookup of paths.slice(0, maxSources)) {
        try {
          const filename = join(root, lookup), canonical = await realpath(filename);
          assert(inside(canonical, root) && !(await lstat(filename)).isSymbolicLink(), 'source-path-escaped');
          const size = (await stat(canonical)).size;
          assert(size <= 2 * 1024 * 1024, 'source-read-budget');
          if (totalBytes + size > maxBytes) { issues.push('snapshot-byte-budget'); break; }
          const bytes = await readFile(canonical);
          assert(bytes.length <= 2 * 1024 * 1024 && totalBytes + bytes.length <= maxBytes, 'source-read-budget');
          const raw = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
          const summary = toWikiPageSummary({ absolutePath: canonical, relativePath: lookup, raw });
          assert(summary, 'owner-page-unavailable');
          const context = createMemoryWikiReadContext({ config, identity: { workspaceDir } });
          const read = readMemoryWikiOwnerSnapshot({ config, context, page: { ...summary, raw }, fromLine: 1, lineCount: Number.MAX_SAFE_INTEGER });
          if (read.status === 'denied') { rejected.push({ sourceDigest: sha256(lookup), reason: read.reason }); continue; }
          assert(!read.snapshot.truncated && read.snapshot.content.trim(), 'incomplete-owner-snapshot');
          assert(sha256(await readFile(canonical)) === read.snapshot.source.sourceDigest, 'owner-source-changed');
          const body = read.snapshot.content, id = sha256(JSON.stringify(read.snapshot.source)).slice(7);
          originals.set(id, bytes); totalBytes += bytes.length;
          sources.push({ id, path: `sources/${id}.md`, snapshot: read.snapshot,
            normalizedDigest: sha256(body.normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim()),
            sourceType: summary.sourceType ?? 'wiki', ...(summary.sourcePath ? { sourcePath: summary.sourcePath } : {}), bytes: bytes.length,
            conflictCount: summary.contradictions.length,
            structure: { headings: count(body, /^#{1,6}\s/gm), codeFences: count(body, /^\s*(?:```|~~~)/gm),
              tableRows: count(body, /^\s*\|.*\|\s*$/gm), listItems: count(body, /^\s*(?:[-*+] |\d+[.)] )/gm) },
            languageSignals: [['han', /\p{Script=Han}/u], ['kana', /[\p{Script=Hiragana}\p{Script=Katakana}]/u],
              ['cyrillic', /\p{Script=Cyrillic}/u], ['latin', /\p{Script=Latin}/u]].flatMap(([name, pattern]) => (pattern as RegExp).test(body) ? [name as string] : []) });
        } catch (error) {
          issues.push('owner-source-read-failed');
          rejected.push({ sourceDigest: sha256(lookup), reason: error instanceof Error ? error.message : 'read-failed' });
        }
      }
      if (JSON.stringify(await listMemoryWikiPagePaths(root)) !== JSON.stringify(paths)) issues.push('owner-source-list-changed');
      // Recheck all accepted pins after enumeration so a changed page cannot
      // silently become part of the frozen snapshot.
      for (let index = sources.length - 1; index >= 0; index--) {
        const source = sources[index], filename = join(root, source.snapshot.source.subjectId);
        const canonical = await realpath(filename).catch(() => null);
        const bytes = canonical && inside(canonical, root) && !(await lstat(filename)).isSymbolicLink()
          ? await readFile(canonical).catch(() => null) : null;
        if (!bytes || sha256(bytes) !== source.snapshot.source.sourceDigest) {
          issues.push('owner-source-changed');
          rejected.push({ sourceDigest: sha256(source.snapshot.source.subjectId), reason: 'owner-source-changed' });
          originals.delete(source.id); sources.splice(index, 1);
        }
      }
      status = issues.length ? 'partial' : sources.length ? 'complete' : 'empty';
    }
  }
  assert(sha256(await readFile(configFile)) === sha256(configBytes), 'Owner configuration changed during capture');
  const value: Omit<KnowledgeCapture, 'snapshotDigest'> = { schema: 'KnowledgeAdaptationSnapshot/v1', actor: input.actor,
    driven_by: 'agent', origin: input.origin, status, observedAt: new Date().toISOString(), configDigest: sha256(configBytes),
    workspaceDir, discovered, admitted: sources.length, sources, rejected, issues: [...new Set(issues)] };
  const result: KnowledgeCapture = { ...value, snapshotDigest: captureDigest(value) };
  await mkdir(output, { recursive: false });
  await mkdir(join(output, 'sources'));
  for (const source of sources) await writeFile(join(output, source.path), originals.get(source.id)!, { flag: 'wx' });
  await writeFile(join(output, 'snapshot.json'), jsonBytes(result), { flag: 'wx' });
  return result;
}

type Question = { id: string; question: string; locale: string; intent: string; split: 'calibration' | 'validation' | 'held-out';
  familyId: string; sourceIds: string[]; answerability: 'answerable' | 'absent' | 'conflicting';
  support: Array<{ sourceId: string; startByte: number; endByteExclusive: number; quote: string }> };
type AuthoredQuestions = { actor: string; driven_by: 'agent'; snapshotDigest: string; questions: Question[];
  families: Array<{ id: string; sourceIds: string[] }>;
  review: { actor: string; driven_by: 'agent'; snapshotDigest: string; datasetDigest: string; acceptedQuestionIds: string[] } };

/** Freeze reviewed questions separately from their byte-level oracle. */
export async function freezeKnowledgeQuestions(captureDirectory: string, input: AuthoredQuestions) {
  const root = await realpath(captureDirectory);
  const snapshot = JSON.parse(await readFile(join(root, 'snapshot.json'), 'utf8')) as KnowledgeCapture;
  const { snapshotDigest, ...value } = snapshot;
  assert.equal(captureDigest(value), snapshotDigest, 'Knowledge snapshot changed');
  assert(snapshot.status === 'complete' && snapshot.sources.length > 0, 'A complete nonempty knowledge snapshot is required');
  assert(input.snapshotDigest === snapshotDigest && input.driven_by === 'agent' && input.actor.trim(), 'Authored snapshot mismatch');
  assert(input.review.driven_by === 'agent' && input.review.actor.trim() && input.review.actor.trim() !== input.actor.trim()
    && input.review.snapshotDigest === snapshotDigest && input.review.datasetDigest === sha256(jsonBytes({ families: input.families, questions: input.questions })), 'Independent question review binding required');
  const sources = new Map(snapshot.sources.map(source => [source.id, source])), familyBySource = new Map<string, string>();
  const families = new Set<string>(), familySplit = new Map<string, string>(), questionIds = new Set<string>();
  for (const family of input.families) {
    assert(family.id.trim() && !families.has(family.id) && family.sourceIds.length, 'Invalid or duplicate source family');
    families.add(family.id);
    for (const id of family.sourceIds) {
      assert(sources.has(id) && !familyBySource.has(id), 'Unknown or repeated source family member');
      familyBySource.set(id, family.id);
    }
  }
  assert.equal(familyBySource.size, sources.size, 'Every captured source needs a reviewed family');
  const duplicateFamilies = new Map<string, string>();
  const originFamilies = new Map<string, string>();
  const shingles = new Map<string, Set<string>>();
  for (const source of sources.values()) {
    const family = familyBySource.get(source.id)!;
    assert(!duplicateFamilies.has(source.normalizedDigest) || duplicateFamilies.get(source.normalizedDigest) === family, 'Duplicate content crosses source families');
    duplicateFamilies.set(source.normalizedDigest, family);
    if (source.sourcePath) {
      const origin = JSON.stringify([source.sourceType, source.sourcePath]);
      assert(!originFamilies.has(origin) || originFamilies.get(origin) === family, 'Same original source crosses families');
      originFamilies.set(origin, family);
    }
    const words = source.snapshot.content.normalize('NFKC').toLowerCase().match(/\p{Script=Han}|[\p{L}\p{N}_]+/gu) ?? [];
    // The bounded authoring snapshot is compared before model execution. The
    // bottom 128 hashes keep near-duplicate checks independent of document size.
    const width = Math.min(5, words.length);
    const hashes = new Set([...new Set(words.slice(0, words.length - width + 1).map((_, i) => sha256(words.slice(i, i + width).join(' '))))].sort().slice(0, 128));
    for (const [other, signature] of shingles) {
      const union = new Set([...hashes, ...signature]);
      const overlap = [...hashes].filter(hash => signature.has(hash)).length;
      assert(!union.size || overlap / union.size < 0.8 || familyBySource.get(other) === family, 'Near-duplicate content crosses source families');
    }
    shingles.set(source.id, hashes);
  }
  const raw = new Map<string, Buffer>();
  for (const source of sources.values()) {
    const file = await realpath(join(root, source.path));
    assert(inside(file, root), 'Archived source escaped snapshot');
    const bytes = await readFile(file);
    assert.equal(sha256(bytes), source.snapshot.source.sourceDigest, 'Archived owner source changed');
    raw.set(source.id, bytes);
  }
  const gold = [];
  for (const question of input.questions) {
    assert(question.id.trim() && !questionIds.has(question.id) && question.question.trim(), 'Invalid or duplicate question');
    questionIds.add(question.id);
    assert(['calibration', 'validation', 'held-out'].includes(question.split) && families.has(question.familyId), 'Invalid question split/family');
    assert(!familySplit.has(question.familyId) || familySplit.get(question.familyId) === question.split, 'Source family crosses evaluation splits');
    familySplit.set(question.familyId, question.split);
    assert(question.sourceIds.length > 0 && new Set(question.sourceIds).size === question.sourceIds.length
      && question.sourceIds.every(id => familyBySource.get(id) === question.familyId), 'Question source family mismatch');
    assert(['answerable', 'absent', 'conflicting'].includes(question.answerability), 'Invalid answerability');
    assert(question.answerability === 'absent' ? question.support.length === 0 : question.support.length > 0, 'Support disagrees with answerability');
    const facts = question.support.map(support => {
      const source = sources.get(support.sourceId), bytes = raw.get(support.sourceId);
      assert(source && bytes && question.sourceIds.includes(support.sourceId), 'Gold source is outside the question scope');
      const ownerRange = source.snapshot.source.locator!;
      assert(support.startByte >= ownerRange.startByte && support.endByteExclusive <= ownerRange.endByteExclusive, 'Gold is outside owner body');
      const locator = { ...ownerRange, startByte: support.startByte, endByteExclusive: support.endByteExclusive,
        startLine: 1 + bytes.subarray(0, support.startByte).filter(byte => byte === 10).length,
        endLine: 1 + bytes.subarray(0, support.endByteExclusive - 1).filter(byte => byte === 10).length };
      assert.equal(spanText(bytes, locator), support.quote, 'Gold quote is not exact owner evidence');
      return { sourceId: source.id, sourceRef: { ...source.snapshot.source, locator }, quote: support.quote };
    });
    assert(new Set(facts.map(fact => JSON.stringify([fact.sourceId, fact.sourceRef.locator]))).size === facts.length, 'Duplicate gold support');
    if (question.answerability === 'conflicting') assert(new Set(facts.map(fact => fact.sourceId)).size >= 2, 'Conflict requires multiple sources');
    gold.push({ queryId: question.id, answerability: question.answerability, facts });
  }
  assert(input.questions.length > 0 && questionIds.size === input.review.acceptedQuestionIds.length
    && new Set(input.review.acceptedQuestionIds).size === questionIds.size
    && input.review.acceptedQuestionIds.every(id => questionIds.has(id)), 'Independent review must cover each question exactly once');
  assert(new Set(input.questions.map(question => question.split)).size === 3, 'Calibration, validation and held-out splits are required');
  return { schema: 'KnowledgeAdaptationEvaluation/v1', evaluatorVersion: RAG_QUERY_EVALUATOR_VERSION,
    snapshotDigest, actor: input.actor, driven_by: 'agent', origin: snapshot.origin, visibility: 'evaluator-only',
    families: input.families, queries: input.questions.map(({ support: _support, answerability: _answerability, ...question }) => question),
    gold, review: input.review };
}

async function main() {
  const [command, inputFile, output] = process.argv.slice(2);
  assert(inputFile && output, 'Usage: knowledge-rag-adaptation <capture|freeze> <plan.json> <new-output>');
  const plan = JSON.parse(await readFile(resolve(inputFile), 'utf8'));
  if (command === 'capture') {
    const result = await captureKnowledgeAdaptation({ ...plan, output });
    console.log(JSON.stringify({ status: result.status, admitted: result.admitted, discovered: result.discovered, snapshotDigest: result.snapshotDigest }));
    if (result.status !== 'complete') process.exitCode = 2;
  } else if (command === 'freeze') {
    const result = await freezeKnowledgeQuestions(plan.captureDirectory, plan.authored);
    const candidate = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    assert(!execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim(), 'Freeze requires a clean source candidate');
    await writeFile(resolve(output), jsonBytes({ ...result, candidate }), { flag: 'wx' });
  } else throw new Error('Unknown adaptation command');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
