#!/usr/bin/env node
/**
 * TF-0698 aggregate multi-round evaluator.
 * Each round starts from the frozen fixture in D:/tmp, executes the existing
 * real-task evaluator, runs the oracle, and applies every-round positive-benefit gates.
 *
 * driven_by: agent; actor: codex/context-folding-rlm
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const REPO = process.cwd();
const ROUNDS = Number(process.env.CF_MULTI_ROUNDS || '5');
const PROFILE = process.env.CF_MULTI_PROFILE || 'uniform';
const ROUND_RUNNER_MODULE = join(REPO, 'scripts/context-folding-real-task-eval.mjs');
const RUN_ID = process.env.CF_MULTI_RUN_ID || 'cfr-multiround-20261103';
const EVIDENCE_BASE = join(REPO, 'harness/specs/fixtures/context-folding-rlm/eval');
const OUT = join(EVIDENCE_BASE, process.env.CF_MULTI_OUTPUT_DIR || 'multiround');
const RAW_ROOT = join('D:/tmp', RUN_ID);
const FIXTURE = join(REPO, 'harness/specs/fixtures/context-folding-rlm/real-workspace');
const PERTURBATION = process.env.CF_MULTI_PERTURBATION || 'none';
const PERTURBATION_CHARS = Number(process.env.CF_MULTI_PERTURBATION_CHARS || '0');
function profileVariantForRound(i) { return PROFILE === 'varied' ? [4000, 8000, 12000, 16000, 24000][i - 1] : PERTURBATION_CHARS; }
const ORACLE = join(REPO, 'harness/specs/fixtures/context-folding-rlm/oracle/verify.py');
const PYTHON = process.platform === 'win32' ? 'python' : 'python3';
const hash = (value) => createHash('sha256').update(value, 'utf8').digest('hex');

if (process.argv.length > 2) {
  console.error('multi-round eval takes no positional arguments');
  process.exit(2);
}
if (!Number.isInteger(ROUNDS) || ROUNDS < 5) {
  console.error('CF_MULTI_ROUNDS must be an integer >= 5');
  process.exit(2);
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
function quantile(values, q) {
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const low = Math.floor(pos), high = Math.ceil(pos);
  return low === high ? sorted[low] : sorted[low] + (sorted[high] - sorted[low]) * (pos - low);
}
function mean(values) { return values.reduce((a, b) => a + b, 0) / values.length; }
function round(n) { return Math.round(n * 1e6) / 1e6; }
function readdirFiles(root) {
  const out = [];
  const walk = (dir, prefix = '') => {
    const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.name === '.git' || entry.name === '__pycache__') continue;
      const rel = prefix ? prefix + '/' + entry.name : entry.name;
      if (entry.isDirectory()) walk(join(dir, entry.name), rel); else out.push(rel);
    }
  };
  walk(root);
  return out;
}
function treeDigest(root) {
  return hash(readdirFiles(root).map((p) => p + '\0' + hash(readFileSync(join(root, p)))).join('\n'));
}
function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: REPO, encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024, ...options,
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with ${result.status}\n${result.stdout ?? ''}\n${result.stderr ?? ''}`);
  }
  return result;
}
function manifestFromStdout(stdout) {
  const start = stdout.indexOf('{');
  const end = stdout.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error(`no JSON manifest in round stdout: ${stdout.slice(0, 500)}`);
  return JSON.parse(stdout.slice(start, end + 1));
}
function checkRound(manifest, roundId) {
  const b = manifest.modes.baseline;
  const e = manifest.modes['expand-only'];
  const f = manifest.modes['folded-child'];
  const testsOk = (mode) => mode.tests.exitCode === 0 && mode.tests.ran === 4 && mode.tests.passed === 4 && mode.tests.failed === 0 && mode.tests.skipped === 0;
  const checks = {
    schema: manifest.schemaVersion === 'ContextFoldingEvalResult/v1',
    agent: manifest.driven_by === 'agent' && Boolean(manifest.actor),
    fixtureUnchanged: manifest.fixture.sourceUnchanged === true,
    allModeTests: testsOk(b) && testsOk(e) && testsOk(f),
    qualityParity: b.tests.passed === e.tests.passed && b.tests.passed === f.tests.passed,
    evidence: f.evidenceRefsResolution === 1 && f.requiredEvidenceRefs === f.foldedResults[0].evidenceRefs.length,
    scope: f.scopeViolations === 0 && f.staleReferences === 0,
    transcript: f.rawChildTranscriptChars === 0 && f.rawTranscriptInjected === false,
    depth: f.maxRecursiveDepth <= 1,
    mainContextPositive: (1 - f.metrics.mainContextChars / b.metrics.mainContextChars) >= 0.30,
    totalTokensPositive: f.metrics.totalTokens < b.metrics.totalTokens,
    latencyBounded: f.metrics.latencyMs / b.metrics.latencyMs <= 2.5,
    unfold: manifest.offModeParity.passed === true && manifest.disableOnlyRollback.passed === true,
  };
  const failed = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
  return {
    roundId,
    baselineTests: b.tests, expandOnlyTests: e.tests, foldedChildTests: f.tests,
    baseline: { mainContextChars: b.metrics.mainContextChars, totalTokens: b.metrics.totalTokens, latencyMs: b.metrics.latencyMs },
    folded: { mainContextChars: f.metrics.mainContextChars, totalTokens: f.metrics.totalTokens, latencyMs: f.metrics.latencyMs },
    ratios: {
      mainContextReduction: 1 - f.metrics.mainContextChars / b.metrics.mainContextChars,
      totalTokenMultiplier: f.metrics.totalTokens / b.metrics.totalTokens,
      latencyMultiplier: f.metrics.latencyMs / b.metrics.latencyMs,
    },
    evidenceRefsResolution: f.evidenceRefsResolution,
    scopeViolations: f.scopeViolations, staleReferences: f.staleReferences,
    rawChildTranscriptChars: f.rawChildTranscriptChars, rawTranscriptInjected: f.rawTranscriptInjected,
    maxRecursiveDepth: f.maxRecursiveDepth, checks, failedChecks: failed, pass: failed.length === 0,
  };
}

mkdirSync(OUT, { recursive: true });
if (existsSync(RAW_ROOT)) rmSync(RAW_ROOT, { recursive: true, force: true });
mkdirSync(RAW_ROOT, { recursive: true });
cpSync('D:/tmp/cf-multiround-gate-v1.json', join(RAW_ROOT, 'gate.json'));
const sourceTreeDigest = treeDigest(FIXTURE);
const roundSummaries = [];
const { runPairedEval } = await import(pathToFileURL(ROUND_RUNNER_MODULE).href);
for (let i = 1; i <= ROUNDS; i += 1) {
  const roundId = `round-${String(i).padStart(2, '0')}`;
  const roundDir = join(RAW_ROOT, roundId);
  const roundFixture = join(RAW_ROOT, `${roundId}.fixture`);
  cpSync(FIXTURE, roundFixture, { recursive: true });
  if (PERTURBATION !== 'none') {
    const perturbChars = profileVariantForRound(i);
    if (!Number.isInteger(perturbChars) || perturbChars < 1) throw new Error('CF_MULTI_PERTURBATION_CHARS must be a positive integer');
    const target = join(roundFixture, 'data/taskboard-audit.txt');
    const marker = `\n— distractor round ${roundId} ${'x'.repeat(perturbChars)}\n`;
    writeFileSync(target, readFileSync(target, 'utf8') + marker, 'utf8');
  }
  const manifestPath = join(roundDir, 'manifest.json');
  const oracleLogPath = join(roundDir, 'oracle.log');
  const { manifest } = await runPairedEval({
    evidenceRoot: roundDir,
    resultPath: manifestPath,
    redLogPath: join(roundDir, 'baseline-red.log'),
    baselineLogPath: join(roundDir, 'baseline-tests.log'),
    expandLogPath: join(roundDir, 'expand-only-tests.log'),
    foldedLogPath: join(roundDir, 'folded-child-tests.log'),
    fixtureRoot: roundFixture,
    fixtureLabel: PERTURBATION === 'none' ? 'frozen:0' : `${PERTURBATION}:${profileVariantForRound(i)}`,
    runId: `${RUN_ID}-${roundId}`,
  });
  await new Promise((resolve) => setTimeout(resolve, 25));
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  const oracle = run(PYTHON, ['-B', ORACLE, '--workspace', manifest.workspace, '--result', manifestPath], {
    env: { ...process.env, TEMP: 'D:/tmp', TMP: 'D:/tmp' },
  });
  writeFileSync(oracleLogPath, (oracle.stdout ?? '').replace(/\r?\n/g, '\n'), 'utf8');
  roundSummaries.push(checkRound(manifest, roundId));
}

const tokenRatios = roundSummaries.map((r) => r.ratios.totalTokenMultiplier);
const reductions = roundSummaries.map((r) => r.ratios.mainContextReduction);
const latencyRatios = roundSummaries.map((r) => r.ratios.latencyMultiplier);
const gates = {
  rounds: roundSummaries.length >= 5,
  everyRoundPass: roundSummaries.every((r) => r.pass),
  everyRoundContext: roundSummaries.every((r) => r.ratios.mainContextReduction >= 0.30),
  everyRoundTokenPositive: roundSummaries.every((r) => r.ratios.totalTokenMultiplier < 1.0),
  everyRoundLatency: roundSummaries.every((r) => r.ratios.latencyMultiplier <= 2.5),
  medianTokenPositive: median(tokenRatios) < 1.0,
  upper95TokenPositive: quantile(tokenRatios, 0.95) < 1.0,
  medianContext: median(reductions) >= 0.30,
  allQuality: roundSummaries.every((r) => r.checks.allModeTests && r.checks.qualityParity),
  allEvidence: roundSummaries.every((r) => r.checks.evidence),
  allSafety: roundSummaries.every((r) => r.checks.scope && r.checks.transcript && r.checks.depth),
  allOracle: roundSummaries.every((r) => r.failedChecks.length === 0),
};
const pass = Object.values(gates).every(Boolean);
const aggregate = {
  schemaVersion: 'ContextFoldingMultiRoundEvalResult/v1', runId: RUN_ID,
  status: pass ? 'pass' : 'fail', driven_by: 'agent', actor: 'codex/context-folding-rlm',
  generatedAt: new Date().toISOString(), rounds: ROUNDS,
  sourceTreeDigest, sourceUnchanged: treeDigest(FIXTURE) === sourceTreeDigest,
  perturbation: { kind: PERTURBATION, profile: PROFILE, extraCharsPerRound: PROFILE === 'varied' ? [4000, 8000, 12000, 16000, 24000] : PERTURBATION_CHARS, appliedTo: PERTURBATION === 'none' ? [] : ['data/taskboard-audit.txt'] },
  roundSummaries,
  stats: {
    tokenMultiplier: { values: tokenRatios, mean: round(mean(tokenRatios)), median: round(median(tokenRatios)), p95: round(quantile(tokenRatios, 0.95)), max: round(Math.max(...tokenRatios)) },
    mainContextReduction: { values: reductions, mean: round(mean(reductions)), median: round(median(reductions)), p05: round(quantile(reductions, 0.05)), min: round(Math.min(...reductions)) },
    latencyMultiplier: { values: latencyRatios, mean: round(mean(latencyRatios)), median: round(median(latencyRatios)), p95: round(quantile(latencyRatios, 0.95)), max: round(Math.max(...latencyRatios)) },
  },
  gates,
  notes: [
    'Each round uses a fresh D:/tmp copy and independent real unittest + oracle execution.',
    'A failed or negative round makes the whole aggregate fail; no averaging escape hatch.',
    'Token values are local ceil(chars/4) estimates, not live-provider billing.',
  ],
  unresolvedClaims: ['No live model provider was used; provider-measured token/cost/latency and live semantic quality are outside this eval.'],
};
writeFileSync(join(OUT, 'aggregate.json'), JSON.stringify(aggregate, null, 2) + '\n', 'utf8');
for (const entry of readdirSync(RAW_ROOT, { withFileTypes: true })) {
  if (entry.isDirectory() && entry.name.endsWith('.fixture')) continue;
  cpSync(join(RAW_ROOT, entry.name), join(OUT, 'raw', entry.name), { recursive: true });
}
console.log(JSON.stringify({ status: aggregate.status, rounds: aggregate.rounds, gates: aggregate.gates, stats: aggregate.stats }, null, 2));
if (!pass) process.exitCode = 1;
