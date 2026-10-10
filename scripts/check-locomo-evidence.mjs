import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual, parseArgs } from 'node:util';
import { assertLocomoStageReportShape, assertLocomoQuestionResultShape } from '../tests/unit/helpers/runtime-memory-locomo-report-schema.ts';
import { buildStratifiedDevSlice, DEFAULT_SAMPLE_SEED, DEFAULT_SAMPLE_SIZES } from '../tests/unit/helpers/runtime-memory-dev-slice.ts';
import { computeContextRecall, computeAnswerTokenRecall } from '../tests/unit/helpers/runtime-memory-context-recall.ts';
import { FROZEN_JUDGE_CONFIG, buildFrozenJudgePrompt, parseFrozenJudgeVerdict } from '../tests/unit/helpers/runtime-memory-judge-freeze.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATASET = 'tests/fixtures/locomo/locomo10_raw.json';
const EVALUATOR = 'tests/unit/runtime-memory-locomo-full-500.test.ts';
const HEX = /^[a-f0-9]{64}$/;
const CATEGORIES = { 1: 'single_hop', 2: 'temporal', 3: 'multi_hop', 4: 'open_domain' };
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const same = (actual, expected, label) => { if (!isDeepStrictEqual(actual, expected)) throw new Error(label + ' mismatch'); };
const near = (actual, expected, label) => { if (typeof actual !== 'number' || !Number.isFinite(actual) || Math.abs(actual - expected) > 1e-10) throw new Error(label + ' mismatch'); };

// Static relative-import closure, plus dependency/runner inputs. No private cache or credential scan.
export function collectLocomoSources(root = ROOT) {
  const pending = [EVALUATOR, 'scripts/check-locomo-evidence.mjs', 'scripts/run-locomo-full-evaluation.mjs', 'package.json', 'pnpm-lock.yaml'];
  const sources = {};
  while (pending.length) {
    const name = pending.pop().replaceAll('\\', '/');
    if (Object.hasOwn(sources, name)) continue;
    const full = resolve(root, name);
    if (relative(root, full).startsWith('..')) throw new Error('Source outside repository: ' + name);
    const bytes = readFileSync(full);
    sources[name] = sha256(bytes);
    if (!/\.[cm]?[jt]sx?$/.test(extname(name))) continue;
    for (const match of bytes.toString('utf8').matchAll(/(?:from\s*|import\s*\(\s*|import\s+|require\s*\(\s*)(["'])(\.[^"']+)\1/g)) {
      const target = resolve(dirname(full), match[2]);
      const candidates = [target, target.replace(/\.js$/, '.ts'), target.replace(/\.mjs$/, '.mts'), target + '.ts', target + '.tsx', target + '.mjs', target + '.js', join(target, 'index.ts')];
      const found = candidates.find((file) => existsSync(file) && statSync(file).isFile());
      if (!found) throw new Error('Unresolved local source import: ' + name + ' -> ' + match[2]);
      pending.push(relative(root, found));
    }
  }
  return Object.fromEntries(Object.entries(sources).sort(([a], [b]) => a.localeCompare(b)));
}

export function expectedLocomoQuestions(root = ROOT) {
  const raw = JSON.parse(readFileSync(join(root, DATASET), 'utf8'));
  const questions = raw.flatMap((sample) => sample.qa.flatMap((qa, qaIndex) => CATEGORIES[qa.category] ? [{ qa, qaIndex, conversationId: sample.sample_id, category: CATEGORIES[qa.category] }] : []));
  return buildStratifiedDevSlice(questions, { sampleSizes: DEFAULT_SAMPLE_SIZES, seed: DEFAULT_SAMPLE_SEED }).map((item) => ({
    questionId: item.conversationId + '_q' + item.qaIndex,
    conversationId: item.conversationId, category: item.category, question: item.qa.question,
    groundTruth: String(item.qa.answer), goldEvidence: item.qa.evidence ?? [],
  }));
}

export function createLocomoProvenance(provider, root = ROOT) {
  return {
    driven_by: 'agent', actor: 'codex-locomo-evaluator', runId: randomUUID(), startedAt: new Date().toISOString(),
    sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim(),
    sourceMethod: 'static-relative-import-closure-v1', sources: collectLocomoSources(root),
    dataset: { path: DATASET, sha256: sha256(readFileSync(join(root, DATASET))) },
    provider: { ...provider },
    // Explicit non-secret controls only; never serialize process.env or credentials.
    evaluationEnvironment: {
      ...Object.fromEntries(['FULL_EVAL', 'SMOKE', 'DISABLE_BUFFERED_EXTRACTION', 'DISABLE_CONSOLIDATION', 'DISABLE_OBSERVATION_CONSOLIDATION', 'DISABLE_ENTITY_STORE', 'DISABLE_CROSS_ENCODER', 'DISABLE_EPISODIC_MEMORY', 'DISABLE_EPISODIC', 'DISABLE_WEIGHTED_GRAPH', 'ENABLE_WEIGHTED_GRAPH', 'DISABLE_CHAINED_RETRIEVAL', 'ENABLE_REFLECT_AGENT', 'ENABLE_AGENT_RETRIEVAL'].map((name) => [name, process.env[name] === '1'])),
      P3_MULTIHOP: ['sequential-self-ask', 'self-ask', 'none'].includes(process.env.P3_MULTIHOP) ? process.env.P3_MULTIHOP : (process.env.P3_MULTIHOP ? 'other' : 'default'),
      P3_RERANKER: process.env.P3_RERANKER === 'none' ? 'none' : 'cross-encoder',
    },
  };
}

export function writeLocomoReport(report, file) {
  mkdirSync(dirname(file), { recursive: true });
  const bytes = JSON.stringify(report, null, 2) + '\n';
  // Never overwrite an earlier failed or accepted run. The full runner supplies a fresh directory.
  writeFileSync(file, bytes, { encoding: 'utf8', flag: 'wx' });
  writeFileSync(file + '.sha256', sha256(bytes) + '  ' + basename(file) + '\n', { encoding: 'utf8', flag: 'wx' });
}

export function assertVerifiedLocomoReport(report, options) {
  if (report?.schemaVersion !== 2 || report?.evidenceClass !== 'real-model-evaluation') throw new Error('Not a measured LoCoMo run: historical/synthetic fixtures are not baselines');
  same(report.provenance?.evaluationEnvironment?.FULL_EVAL, true, 'explicit full-evaluation mode');
  same(report.provenance?.evaluationEnvironment?.SMOKE, false, 'non-smoke mode');
  return { ...assertLocomoReportConsistency(report, options), verified: true };
}

// Consistency can be tested with explicitly synthetic fixtures; it is not proof that a model run occurred.
export function assertLocomoReportConsistency(report, { root = ROOT, now = Date.now(), maxAgeMs = 30 * 86400000 } = {}) {
  if (report?.schemaVersion !== 2) throw new Error('Unsupported LoCoMo schema version');
  assertLocomoStageReportShape(report);
  same(report.totalQuestions, 500, 'full question count');
  same(report.sampleSeed, DEFAULT_SAMPLE_SEED, 'sample seed');
  same(report.sampleSizes, DEFAULT_SAMPLE_SIZES, 'sample sizes');
  const proof = report.provenance;
  if (proof?.driven_by !== 'agent' || typeof proof.actor !== 'string' || !proof.actor || typeof proof.runId !== 'string' || !proof.runId) throw new Error('Missing agent run provenance');
  const started = Date.parse(proof.startedAt);
  const finished = Date.parse(report.generatedAt);
  if (!Number.isFinite(started) || !Number.isFinite(finished) || finished < started || finished > now + 300000 || now - finished > maxAgeMs) throw new Error('Stale or invalid run timestamps');
  same(proof.sources, collectLocomoSources(root), 'source freshness');
  same(proof.dataset, { path: DATASET, sha256: sha256(readFileSync(join(root, DATASET))) }, 'dataset provenance');
  if (!proof.provider?.endpoint || proof.provider.model !== report.judgeConfig.model) throw new Error('Missing or inconsistent model identity');
  const endpoint = new URL(proof.provider.endpoint);
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash || (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname)))) throw new Error('Unsafe or credential-bearing model URL is not evidence');
  same(report.escalation.maxEscalations, 125, 'full-run L1 budget');
  same(report.escalation.maxFullConversationEscalations, 75, 'full-run L2 budget');
  if (report.escalation.level1 + report.escalation.level2 > 125 || report.escalation.level2 > 75) throw new Error('Escalation exceeds frozen budgets');
  same(report.judgeConfig, { ...FROZEN_JUDGE_CONFIG, model: proof.provider.model }, 'frozen judge');
  const rows = report.questionResults;
  if (!Array.isArray(rows) || rows.length !== 500) throw new Error('Every sampled question must have a retained result');
  const expected = new Map(expectedLocomoQuestions(root).map((row) => [row.questionId, row]));
  const raw = JSON.parse(readFileSync(join(root, DATASET), 'utf8'));
  const turns = new Map(raw.map((sample) => [sample.sample_id, new Map(Object.entries(sample.conversation).filter(([name, value]) => /^session_\d+$/.test(name) && Array.isArray(value)).flatMap(([, value]) => value.map((turn) => [turn.dia_id, turn.text])))]));
  const seen = new Set();
  const categoryRows = new Map();
  for (const row of rows) {
    assertLocomoQuestionResultShape(row, 'question result');
    if (seen.has(row.questionId) || !expected.has(row.questionId)) throw new Error('Duplicate or non-sampled question: ' + row.questionId);
    seen.add(row.questionId);
    for (const field of ['conversationId', 'category', 'question', 'groundTruth', 'goldEvidence']) same(row[field], expected.get(row.questionId)[field], 'dataset question ' + field);
    if (row.predictedAnswer === '[ERROR]' || ![0, 1].includes(row.judgeScore) || ![0, 1, 2].includes(row.escalationLevel)) throw new Error('Failed/incomplete question is not accepted evidence');
    if (!Array.isArray(row.retrievedFactSummaries) || row.retrievedFactSummaries.some((text) => typeof text !== 'string')) throw new Error('Missing retained retrieval inputs');
    near(row.recall5, computeAnswerTokenRecall(row.groundTruth, row.retrievedFactSummaries), 'retrieval proxy');
    near(row.contextRecall, computeContextRecall(row.assembledContext, row.goldEvidence, turns.get(row.conversationId)), 'resolved context recall');
    const group = categoryRows.get(row.category) ?? [];
    group.push(row); categoryRows.set(row.category, group);
  }
  const average = (items, key) => items.reduce((sum, row) => sum + row[key], 0) / items.length;
  const checkMetrics = (items, metrics, label) => {
    near(metrics.j_score, average(items, 'judgeScore'), label + '.j_score');
    near(metrics.recall_at_5, average(items, 'recall5'), label + '.recall_at_5');
    near(metrics.context_recall, average(items, 'contextRecall'), label + '.context_recall');
  };
  checkMetrics(rows, report.metrics.overall, 'overall');
  same(Object.keys(report.metrics.byCategory).sort(), Object.keys(DEFAULT_SAMPLE_SIZES).sort(), 'category set');
  for (const [category, items] of categoryRows) { same(report.metrics.byCategory[category].count, items.length, 'category count'); checkMetrics(items, report.metrics.byCategory[category], category); }
  for (const level of [0, 1, 2]) {
    const group = rows.filter((row) => row.escalationLevel === level);
    const slice = report.metrics.by_escalation_level['level' + level];
    same(slice.count, group.length, 'level count');
    if (group.length) { near(slice.j_score, average(group, 'judgeScore'), 'level score'); near(slice.recall_at_5, average(group, 'recall5'), 'level recall'); }
  }
  const receipts = report.modelReceipts;
  if (!Array.isArray(receipts) || receipts.length < 500) throw new Error('Missing actual model request receipts');
  const responseIds = new Set();
  const receiptsById = new Map();
  for (const receipt of receipts) {
    if (receipt.status !== 200 || receipt.endpoint !== proof.provider.endpoint || receipt.requestedModel !== receipt.returnedModel || receipt.returnedModel !== proof.provider.model || !receipt.returnedModel
      || !receipt.responseId || responseIds.has(receipt.responseId) || !HEX.test(receipt.requestSha256) || !HEX.test(receipt.responseSha256)) throw new Error('Invalid/duplicated model receipt');
    responseIds.add(receipt.responseId);
    receiptsById.set(receipt.responseId, receipt);
    const when = Date.parse(receipt.completedAt);
    if (!Number.isFinite(when) || when < started || when > finished) throw new Error('Receipt outside this run');
    for (const field of ['prompt_tokens', 'completion_tokens', 'total_tokens']) if (!Number.isInteger(receipt.usage?.[field]) || receipt.usage[field] < 0) throw new Error('Invalid model usage');
    same(receipt.usage.total_tokens, receipt.usage.prompt_tokens + receipt.usage.completion_tokens, 'token accounting');
    if (receipt.judgeEvidence) {
      const { temperature, maxTokens, content } = receipt.judgeEvidence;
      if (temperature !== report.judgeConfig.temperature || !Number.isInteger(maxTokens) || maxTokens < 8 || typeof content !== 'string' || !content.trim()) throw new Error('Invalid retained judge evidence');
    }
  }
  same(report.cacheUsage?.cachedRetrieval, false, 'full run retrieval');
  if (!Number.isInteger(report.cacheUsage?.judgeCacheHits) || !Number.isInteger(report.cacheUsage?.judgeCacheMisses)) throw new Error('Missing judge cache disclosure');
  same(report.cacheUsage.judgeCacheHits, 0, 'fresh full-run judge cache');
  same(report.cacheUsage.judgeCacheMisses, 500, 'judge coverage');
  const usedJudgeIds = new Set();
  for (const row of rows) {
    const receipt = receiptsById.get(row.judgeResponseId);
    if (!receipt?.judgeEvidence || usedJudgeIds.has(row.judgeResponseId)) throw new Error('Missing/duplicate question judge receipt: ' + row.questionId);
    usedJudgeIds.add(row.judgeResponseId);
    const prompt = buildFrozenJudgePrompt(row.question, row.groundTruth, row.predictedAnswer);
    const request = JSON.stringify({ model: proof.provider.model, messages: [{ role: 'system', content: prompt.system }, { role: 'user', content: prompt.user }], temperature: report.judgeConfig.temperature, max_tokens: receipt.judgeEvidence.maxTokens, stream: false });
    same(receipt.requestSha256, sha256(request), 'question judge receipt ' + row.questionId);
    same(parseFrozenJudgeVerdict(receipt.judgeEvidence.content), row.judgeScore, 'question judge verdict ' + row.questionId);
  }
  if (receipts.length < 500 + report.cacheUsage.judgeCacheMisses) throw new Error('Insufficient generation/judge request receipts');
  return { consistent: true, runId: proof.runId, totalQuestions: rows.length, model: proof.provider.model, sourceFileCount: Object.keys(proof.sources).length, modelCalls: receipts.length };
}

export function verifyLocomoEvidenceFile(file, options) {
  const bytes = readFileSync(file);
  const report = JSON.parse(bytes.toString('utf8'));
  if (report?.schemaVersion !== 2 || report?.evidenceClass !== 'real-model-evaluation') throw new Error('Not a measured LoCoMo run: historical/synthetic fixtures are not baselines');
  const checksum = readFileSync(file + '.sha256', 'utf8').trim().split(/\s+/)[0];
  if (checksum !== sha256(bytes)) throw new Error('Report SHA256 mismatch');
  return { ...assertVerifiedLocomoReport(report, options), report: file, sha256: checksum };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const { values } = parseArgs({ options: { report: { type: 'string' } } });
    const file = resolve(values.report ?? join(ROOT, 'tests/fixtures/runtime-memory-eval/locomo-full-500-measured-report.json'));
    console.log(JSON.stringify(verifyLocomoEvidenceFile(file), null, 2));
  } catch (error) {
    console.error('LoCoMo evidence NOT VERIFIED: ' + (error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
  }
}
