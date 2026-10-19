#!/usr/bin/env node
/**
 * Phase 2 ACON-style guideline-refinement loop (TF-0074 v8 optimization).
 *
 * Round semantics:
 *   round 0 — compress optimization set with the latest ACCEPTED guideline,
 *             evaluate via the handoff benchmark -> loop baseline metrics.
 *   round N — analyze previous round's failures (LLM failure attribution) ->
 *             deterministic patch merge -> candidate guideline ->
 *             compress+evaluate optimization set with candidate ->
 *             acceptance check (hard thresholds) incl. regression-30 gate.
 *
 * Holdout discipline: this script never reads holdout manifests. The frozen
 * holdout is evaluated exactly once via --terminal-holdout with an explicit
 * confirmation flag, aggregate-only.
 *
 * Reference: ACON (arXiv 2510.00615) prompt_optimizer — regression-driven
 * failure analysis -> prompt patch -> re-run -> select best. Our fitness
 * function is the Phase 0 handoff benchmark, not a proxy.
 */
import { isMainEntrypoint } from './lib/entrypoint.mjs';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildRecoveryLedger, buildContinuationDirective } from './context-compression-recovery-ledger.mjs';
import { BudgetLedger, DiskCache, collapseWhitespace, fetchJson, providerConfig, sha256, stableJson } from './context-compression-llm-shared.mjs';
import { extractGroundedFacts, buildGroundedRecoverySummary, classifyStory } from './context-compression-grounded-extractor.mjs';
import { runBenchmark } from './context-compression-handoff-benchmark.mjs';

const ANALYZER_PROMPT_VERSION = 'failure-analyzer-v1';
const MAX_GUIDELINE_LINES = 12;

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function argFlag(name) {
  return process.argv.includes(name);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path, value) {
  mkdirSync(resolve(path, '..'), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function guidelinesDir() {
  return resolve(argValue('--guidelines-dir', 'reports/context-compression/guidelines'));
}

function listGuidelines() {
  const dir = guidelinesDir();
  return readdirSync(dir)
    .filter((name) => /^guideline-.+\.json$/u.test(name))
    .map((name) => ({ name, guideline: readJson(resolve(dir, name)) }));
}

function latestGuideline(status = 'accepted') {
  const entries = listGuidelines().filter((entry) => entry.guideline.status === status);
  if (!entries.length) throw new Error(`no guideline with status=${status}`);
  entries.sort((a, b) => String(b.guideline.createdAt).localeCompare(String(a.guideline.createdAt)));
  return entries[0].guideline;
}

/** Acceptance baseline = the most recent ACCEPTED round (fallback round 0).
 * Candidates are always compared against the last accepted state, never
 * against a rejected sibling round. */
function latestAcceptedRoundDir(roundsRoot) {
  let best = { round: 0, dir: resolve(roundsRoot, 'round-0') };
  for (const dirName of readdirSync(roundsRoot)) {
    if (!/^round-\d+$/u.test(dirName)) continue;
    const reportPath = resolve(roundsRoot, dirName, 'round-report.json');
    if (!existsSync(reportPath)) continue;
    const report = readJson(reportPath);
    const roundNumber = Number(dirName.replace('round-', ''));
    if (report.verdict?.accepted === true && roundNumber > best.round) {
      best = { round: roundNumber, dir: resolve(roundsRoot, dirName) };
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Scoped guideline rows
// ---------------------------------------------------------------------------

/** Rows are plain strings (scope=always) or {line, scope} with scope one of
 * always|completed|pending|blocked. Scoping exists because round 2 proved a
 * globally-applied completion-marking patch gains +24pp in-distribution while
 * damaging pending/blocked regression samples (-8.3pp). */
export const GUIDELINE_SCOPES = ['always', 'completed', 'pending', 'blocked'];

export function activeRows(section, story) {
  const rows = [];
  for (const row of section ?? []) {
    if (typeof row === 'string') { rows.push(row); continue; }
    if (row && typeof row.line === 'string' && (row.scope === 'always' || row.scope === story)) rows.push(row.line);
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Compress a corpus with a guideline
// ---------------------------------------------------------------------------

async function compressCorpus({ manifestPath, metaPath, guideline, outDir, budget, cache, extractorModel, transport, label }) {
  const manifest = readJson(manifestPath);
  const meta = readJson(metaPath);
  const metaById = new Map((meta.entries ?? []).map((entry) => [entry.sampleId, entry]));
  const provider = providerConfig();
  const rows = [];
  const accounting = [];
  for (const sample of manifest.samples ?? []) {
    if (!guideline.sampleFilter || guideline.sampleFilter.includes(sample.id)) {
      const metaEntry = metaById.get(sample.id);
      if (!metaEntry?.file) throw new Error(`${sample.id}: missing meta entry`);
      const ordinalIndex = Number(/^[A-Z](\d+)$/u.exec(String(sample.id))?.[1] ?? 1) - 1;
      const ledger = buildRecoveryLedger(metaEntry.file, sample.id, { windowSize: Number(sample.cohort?.turn ?? 200), ordinalIndex });
      const story = classifyStory(ledger);
      const focusLines = activeRows(guideline.extractorFocus, story);
      const directiveRows = activeRows(guideline.generationDirectives, story);
      const extraction = await extractGroundedFacts({
        ledger,
        model: extractorModel,
        provider,
        cache,
        budget,
        sampleId: sample.id,
        focusLines,
      });
      const derivedLedger = { ...ledger, expected: extraction.mergedFacts };
      const directive = buildContinuationDirective(derivedLedger);
      const guidedNotes = directiveRows.length
        ? `\n\n## Guided Handoff Notes (optimization guideline ${guideline.id}, story=${story})\n${directiveRows.map((line) => `- ${line}`).join('\n')}`
        : '';
      const summary = `${buildGroundedRecoverySummary(ledger, extraction)}${guidedNotes}\n\n${directive.text}`.trim();
      rows.push({ sampleId: sample.id, compressedSummary: summary });
      accounting.push({ sampleId: sample.id, verified: extraction.verifiedCount, rejected: extraction.provenanceRejectCount, llmOnly: extraction.llmOnlyCount, conflicts: extraction.conflicts.length });
      console.error(`[loop:${label}] ${sample.id}: verified=${extraction.verifiedCount} llmOnly=${extraction.llmOnlyCount} conflicts=${extraction.conflicts.length}`);
    }
  }
  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, 'would-retry-summaries.jsonl'), `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');
  writeJson(resolve(outDir, 'compression-accounting.json'), { schema: 'loop-compression/v1', guidelineId: guideline.id, generatedAt: new Date().toISOString(), samples: accounting });
  return resolve(outDir, 'would-retry-summaries.jsonl');
}

// ---------------------------------------------------------------------------
// Failure analysis (LLM) -> structured patches
// ---------------------------------------------------------------------------

function buildAnalyzerPrompt({ failures, regressions, guideline }) {
  return [
    'You analyze failures of a context-compression system measured by a handoff benchmark.',
    'A handoff agent received ONLY the compressed summary and failed one or more metrics.',
    'Propose at most 3 concrete guideline patches that would help the compressor prevent these failures.',
    '',
    'Return strict JSON only: {"patches": [{"target": "extractorFocus|generationDirectives", "op": "add", "line": string, "scope": "always|completed|pending|blocked", "rationale": string}]}',
    '',
    'Rules for patches:',
    '- target=extractorFocus: an extraction rule telling the extractor what to capture verbatim (facts, states, limitations).',
    '- target=generationDirectives: a summary-writing rule shaping how the handoff summary presents state and next actions.',
    '- scope restricts where a row applies, by sample story type: completed (verified outcome), pending (objective investigated but not executed), blocked (unresolved failure), always. Prefer the narrowest scope that fixes the failures: a rule that helps completed samples but could mislead pending/blocked samples MUST be scoped accordingly. The previous candidate was rejected because a global rule helped in-distribution samples while damaging regression samples (listed below as REGRESSIONS).',
    '- Each line must be ONE imperative sentence <= 200 chars, actionable, and grounded in the failures shown.',
    '- Do not propose anything that requires information not present in the transcripts.',
    '',
    '## Current guideline',
    `extractorFocus: ${JSON.stringify(guideline.extractorFocus ?? [])}`,
    `generationDirectives: ${JSON.stringify(guideline.generationDirectives ?? [])}`,
    '',
    '## Failures (optimization set, current round)',
    ...failures.map((failure) => `- ${failure.sampleId} [success=${failure.success} repeat=${failure.repeat} contradiction=${failure.contradiction} state=${failure.stateAccuracy.toFixed(2)}] GT-next=${JSON.stringify(failure.gtNext).slice(0, 300)} handoff-next=${JSON.stringify(failure.handoffNext).slice(0, 300)} handoff-pending=${JSON.stringify(failure.handoffPending).slice(0, 200)}`),
    '',
    '## REGRESSIONS (regression set damage caused by the previous candidate — the next patches MUST NOT repeat these)',
    ...(regressions?.length ? regressions.map((reg) => `- ${reg.sampleId} [story=${reg.story}] ${reg.kind}: baseline=${JSON.stringify(reg.baseline).slice(0, 140)} damaged=${JSON.stringify(reg.damaged).slice(0, 220)} GT-next=${JSON.stringify(reg.gtNext).slice(0, 260)} damaged-handoff-next=${JSON.stringify(reg.handoffNext).slice(0, 260)}`) : ['- none recorded']),
  ].join('\n');
}

/** Samples damaged on the regression set by a candidate vs the accepted baseline. */
export function regressionFlips(baselineResults, candidateResults) {
  const baseById = new Map((baselineResults?.results ?? []).map((item) => [item.sampleId, item]));
  const flips = [];
  for (const cand of candidateResults?.results ?? []) {
    const base = baseById.get(cand.sampleId);
    if (!base) continue;
    const lostSuccess = base.success === true && cand.success === false;
    const newRepeat = base.repeat === false && cand.repeat === true;
    const newContradiction = base.contradiction === false && cand.contradiction === true;
    if (!lostSuccess && !newRepeat && !newContradiction) continue;
    flips.push({
      sampleId: cand.sampleId,
      kind: [lostSuccess ? 'success-lost' : null, newRepeat ? 'repeat-gained' : null, newContradiction ? 'contradiction-gained' : null].filter(Boolean).join('+'),
      baseline: { success: base.success, repeat: base.repeat, contradiction: base.contradiction },
      damaged: { success: cand.success, repeat: cand.repeat, contradiction: cand.contradiction },
    });
  }
  return flips;
}

async function analyzeFailures({ resultsPath, gtPath, guideline, analyzerModel, budget, cache, transport, outDir, regressionResultsPath, baselineRegressionResultsPath }) {
  const results = readJson(resultsPath);
  const gt = readJson(gtPath);
  const failures = [];
  for (const result of results.results ?? []) {
    if (result.success && !result.repeat && !result.contradiction) continue;
    const sampleDir = resolve(resultsPath, '..', `sample-${result.sampleId}.json`);
    const handoff = existsSync(sampleDir) ? readJson(sampleDir).handoffOutput : {};
    failures.push({
      sampleId: result.sampleId,
      success: result.success,
      repeat: result.repeat,
      contradiction: result.contradiction,
      stateAccuracy: result.stateAccuracy ?? 0,
      gtNext: gt.samples?.[result.sampleId]?.correctNextAction ?? null,
      handoffNext: handoff.nextAction ?? null,
      handoffPending: handoff.stateAssessment?.pending ?? [],
    });
  }
  // Regression-aware attribution: damage caused by the previous candidate on
  // the regression set (ACON regression-report mechanism).
  let regressions = [];
  if (regressionResultsPath && baselineRegressionResultsPath && existsSync(regressionResultsPath) && existsSync(baselineRegressionResultsPath)) {
    const candidateRegression = readJson(regressionResultsPath);
    const baselineRegression = readJson(baselineRegressionResultsPath);
    regressions = regressionFlips(baselineRegression, candidateRegression).map((flip) => ({
      ...flip,
      story: gt.samples?.[flip.sampleId]?.story ?? 'unspecified',
      gtNext: gt.samples?.[flip.sampleId]?.correctNextAction ?? null,
      handoffNext: (() => {
        const sampleDir = resolve(regressionResultsPath, '..', `sample-${flip.sampleId}.json`);
        return existsSync(sampleDir) ? readJson(sampleDir).handoffOutput?.nextAction ?? null : null;
      })(),
    }));
  }
  if (!failures.length && !regressions.length) {
    writeJson(resolve(outDir, 'failure-analysis.json'), { failures: [], regressions: [], patches: [], note: 'no failures to analyze' });
    return [];
  }
  const provider = providerConfig();
  const cacheKey = sha256(stableJson({ v: ANALYZER_PROMPT_VERSION, scoring: 'regression-aware-v1', model: analyzerModel, failuresHash: sha256(stableJson(failures)), regressionsHash: sha256(stableJson(regressions)), guidelineId: guideline.id }));
  let patches = cache?.read(cacheKey)?.patches;
  if (!patches) {
    const data = await fetchJson({
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey ?? 'test-key',
      model: analyzerModel,
      system: 'You are a meticulous failure analyst for agent context compression. You answer with strict JSON only.',
      user: buildAnalyzerPrompt({ failures, regressions, guideline }),
      purpose: 'analyze',
      sampleId: 'failure-analysis',
      transport,
    });
    budget.record(analyzerModel, data.usage);
    const rawText = data?.choices?.[0]?.message?.content ?? '{}';
    let parsed = {};
    try { parsed = JSON.parse(rawText); } catch { try { parsed = JSON.parse(rawText.slice(rawText.indexOf('{'), rawText.lastIndexOf('}') + 1)); } catch { parsed = {}; } }
    patches = Array.isArray(parsed.patches) ? parsed.patches.slice(0, 3) : [];
    cache?.write(cacheKey, { patches });
  }
  writeJson(resolve(outDir, 'failure-analysis.json'), { schema: 'loop-failure-analysis/v2', generatedAt: new Date().toISOString(), failures, regressions, patches });
  return patches;
}
// ---------------------------------------------------------------------------
// Deterministic patch merge -> candidate guideline
// ---------------------------------------------------------------------------

const rowLine = (row) => (typeof row === 'string' ? row : row?.line ?? '');
const rowScope = (row) => (typeof row === 'string' ? 'always' : (row?.scope ?? 'always'));

export function applyPatches({ baseGuideline, patches, round }) {
  const next = {
    schema: 'compact-guideline/v2',
    id: `v${round}`,
    parent: baseGuideline.id,
    status: 'candidate',
    createdAt: new Date().toISOString(),
    evidence: `optimization round ${round} failure analysis`,
    extractorFocus: [...(baseGuideline.extractorFocus ?? [])],
    generationDirectives: [...(baseGuideline.generationDirectives ?? [])],
    patchLog: [],
  };
  for (const patch of patches ?? []) {
    const target = patch.target === 'extractorFocus' ? 'extractorFocus' : patch.target === 'generationDirectives' ? 'generationDirectives' : undefined;
    const line = collapseWhitespace(patch.line ?? '');
    const scope = patch.scope === undefined ? 'always' : patch.scope;
    if (!target || !line || line.length > 240 || patch.op !== 'add' || !GUIDELINE_SCOPES.includes(scope)) {
      next.patchLog.push({ patch, applied: false, reason: 'invalid_patch_shape' });
      continue;
    }
    const section = next[target];
    if (section.some((existing) => collapseWhitespace(rowLine(existing)) === line && rowScope(existing) === scope)) {
      next.patchLog.push({ patch, applied: false, reason: 'duplicate_line' });
      continue;
    }
    if (section.length >= MAX_GUIDELINE_LINES) {
      next.patchLog.push({ patch, applied: false, reason: 'section_full' });
      continue;
    }
    section.push({ line, scope });
    next.patchLog.push({ patch, applied: true, reason: `added (scope=${scope})` });
  }
  return next;
}

// ---------------------------------------------------------------------------
// Acceptance thresholds (hard, from the v8 plan)
// ---------------------------------------------------------------------------

const ACCEPTANCE = Object.freeze({
  successGainPoints: 0.05,   // optimization handoff-success must gain >= 5pp
  regressionTolerancePoints: 0.02, // regression-30 handoff-success may drop at most 2pp
});

function acceptanceVerdict({ prevMetrics, nextMetrics, regressionPrev, regressionNext }) {
  const checks = [];
  const gain = (nextMetrics.handoffSuccessRate ?? 0) - (prevMetrics.handoffSuccessRate ?? 0);
  checks.push({ name: 'optimization_success_gain>=5pp', value: gain, ok: gain >= ACCEPTANCE.successGainPoints });
  checks.push({ name: 'optimization_repeat_not_increased', value: nextMetrics.repeatWorkRate, ok: (nextMetrics.repeatWorkRate ?? 0) <= (prevMetrics.repeatWorkRate ?? 0) + 1e-9 });
  checks.push({ name: 'optimization_contradiction_not_increased', value: nextMetrics.contradictionRate, ok: (nextMetrics.contradictionRate ?? 0) <= (prevMetrics.contradictionRate ?? 0) + 1e-9 });
  if (regressionPrev && regressionNext) {
    const drop = (regressionPrev.handoffSuccessRate ?? 0) - (regressionNext.handoffSuccessRate ?? 0);
    checks.push({ name: 'regression_success_drop<=2pp', value: drop, ok: drop <= ACCEPTANCE.regressionTolerancePoints });
  } else {
    checks.push({ name: 'regression_success_drop<=2pp', value: null, ok: false, note: 'regression gate not run' });
  }
  return { accepted: checks.every((check) => check.ok), checks };
}

// ---------------------------------------------------------------------------
// Round orchestration
// ---------------------------------------------------------------------------

function paths() {
  return {
    optimizationManifest: resolve(argValue('--optimization-manifest', 'reports/context-compression/optimization-manifest.json')),
    optimizationMeta: resolve(argValue('--optimization-meta', 'reports/context-compression/optimization-meta.json')),
    optimizationGt: resolve(argValue('--optimization-gt', 'reports/context-compression/handoff-benchmark-optimization/ground-truth.json')),
    regressionManifest: resolve(argValue('--regression-manifest', 'reports/context-compression/production-manifest-30.json')),
    regressionMeta: resolve(argValue('--regression-meta', 'reports/context-compression/production-summaries-30-generated.meta.json')),
    regressionGt: resolve(argValue('--regression-gt', 'reports/context-compression/handoff-benchmark-v1/ground-truth.json')),
    roundsRoot: resolve(argValue('--rounds-root', 'artifacts/optimization-rounds')),
  };
}

async function runRound({ round, steps, transport }) {
  const config = paths();
  const roundDir = resolve(config.roundsRoot, `round-${round}`);
  const budget = new BudgetLedger(Number(argValue('--round-budget-cny', '10')));
  const cache = new DiskCache(resolve(roundDir, 'cache'));
  const extractorModel = argValue('--extractor-model', 'qwen-flash');
  const handoffModel = argValue('--handoff-model', 'qwen-flash');
  const judgeModel = argValue('--judge-model', 'qwen-plus-latest');
  const analyzerModel = argValue('--analyzer-model', 'qwen-plus-latest');

  // Determine the guideline this round evaluates.
  let guideline;
  let prevMetrics;
  let baselineRound = 0;
  const prevRoundDir = resolve(config.roundsRoot, `round-${round - 1}`);
  const prevEvalPath = resolve(prevRoundDir, 'evaluation', 'results.json');
  if (round === 0) {
    guideline = latestGuideline('accepted');
  } else {
    const candidatePath = resolve(roundDir, 'candidate-guideline.json');
    if (existsSync(candidatePath)) {
      guideline = readJson(candidatePath);
    } else if (steps.includes('analyze') && existsSync(prevEvalPath)) {
      const prevGuideline = latestGuideline('accepted');
      const acceptedBaseDir = latestAcceptedRoundDir(config.roundsRoot).dir;
      const patches = await analyzeFailures({
        resultsPath: prevEvalPath,
        gtPath: config.optimizationGt,
        guideline: prevGuideline,
        analyzerModel,
        budget,
        cache,
        transport,
        outDir: roundDir,
        regressionResultsPath: resolve(prevRoundDir, 'regression-check', 'evaluation', 'results.json'),
        baselineRegressionResultsPath: resolve(acceptedBaseDir, 'regression-check', 'evaluation', 'results.json'),
      });
      guideline = applyPatches({ baseGuideline: prevGuideline, patches, round });
      writeJson(candidatePath, guideline);
      if (argFlag('--analyze-only')) {
        console.log(JSON.stringify({ round, candidatePath, patchLog: guideline.patchLog, analyzeOnly: true }, null, 2));
        return { round, guidelineId: guideline.id, analyzeOnly: true };
      }
    } else {
      throw new Error(`round ${round}: no candidate guideline and analyze step not requested (or previous evaluation missing)`);
    }
    const acceptedBase = latestAcceptedRoundDir(config.roundsRoot);
    const acceptedEvalPath = resolve(acceptedBase.dir, 'evaluation', 'results.json');
    prevMetrics = existsSync(acceptedEvalPath) ? readJson(acceptedEvalPath).metrics : (existsSync(prevEvalPath) ? readJson(prevEvalPath).metrics : undefined);
    baselineRound = acceptedBase.round;
  }
  console.error(`[loop] round ${round} guideline=${guideline.id} (status=${guideline.status}, parent=${guideline.parent ?? '-'})`);

  // Compress + evaluate the optimization set.
  const summariesPath = await compressCorpus({
    manifestPath: config.optimizationManifest,
    metaPath: config.optimizationMeta,
    guideline,
    outDir: resolve(roundDir, 'compressed'),
    budget,
    cache,
    extractorModel,
    transport,
    label: `r${round}`,
  });
  const evaluation = await runBenchmark({
    summariesPath,
    gtPath: config.optimizationGt,
    outDir: resolve(roundDir, 'evaluation'),
    handoffModel,
    judgeModel,
    maxSamples: 100,
    allowUnlocked: true,
    transport,
  });
  console.error(`[loop] round ${round} optimization metrics: ${JSON.stringify(evaluation.metrics)}`);

  // Regression gate: round 0 establishes the baseline; candidate rounds compare against it.
  let regressionMetrics;
  if (round >= 0) {
    const regressionSummaries = await compressCorpus({
      manifestPath: config.regressionManifest,
      metaPath: config.regressionMeta,
      guideline,
      outDir: resolve(roundDir, 'regression-check', 'compressed'),
      budget,
      cache,
      extractorModel,
      transport,
      label: `r${round}-reg`,
    });
    const regressionEval = await runBenchmark({
      summariesPath: regressionSummaries,
      gtPath: config.regressionGt,
      outDir: resolve(roundDir, 'regression-check', 'evaluation'),
      handoffModel,
      judgeModel,
      maxSamples: 30,
      allowUnlocked: true,
      transport,
    });
    regressionMetrics = regressionEval.metrics;
    console.error(`[loop] round ${round} regression metrics: ${JSON.stringify(regressionMetrics)}`);
  }

  // Acceptance verdict.
  let verdict;
  if (round === 0) {
    verdict = { accepted: null, note: 'baseline round — metrics recorded, nothing to accept' };
  } else {
    const prevRegressionPath = resolve(prevRoundDir, 'regression-check', 'evaluation', 'results.json');
    const baselineRegressionPath = resolve(config.roundsRoot, 'round-0', 'regression-check', 'evaluation', 'results.json');
    const acceptedBaseDir = latestAcceptedRoundDir(config.roundsRoot).dir;
    const acceptedRegressionPath = resolve(acceptedBaseDir, 'regression-check', 'evaluation', 'results.json');
    let regressionPrev;
    if (existsSync(acceptedRegressionPath)) regressionPrev = readJson(acceptedRegressionPath).metrics;
    else if (existsSync(baselineRegressionPath)) regressionPrev = readJson(baselineRegressionPath).metrics;
    verdict = acceptanceVerdict({ prevMetrics, nextMetrics: evaluation.metrics, regressionPrev, regressionNext: regressionMetrics });
    verdict.comparedAgainstRound = baselineRound;
    // Persist candidate status.
    const candidatePath = resolve(roundDir, 'candidate-guideline.json');
    if (existsSync(candidatePath)) {
      const candidate = readJson(candidatePath);
      candidate.status = verdict.accepted ? 'accepted' : 'rejected';
      candidate.evidence = `round-${round} verdict: ${JSON.stringify(verdict.checks)}`;
      writeJson(candidatePath, candidate);
      writeJson(resolve(guidelinesDir(), `guideline-${candidate.id}.json`), candidate);
      if (verdict.accepted && prevMetrics) {
        writeJson(resolve(roundDir, 'ACCEPTED.json'), { round, guidelineId: candidate.id, metrics: evaluation.metrics, prevMetrics, verdict });
      }
    }
  }

  const report = {
    schema: 'optimization-round/v1',
    round,
    generatedAt: new Date().toISOString(),
    guideline: { id: guideline.id, parent: guideline.parent, status: guideline.status, extractorFocus: guideline.extractorFocus, generationDirectives: guideline.generationDirectives, patchLog: guideline.patchLog ?? [] },
    optimizationMetrics: evaluation.metrics,
    previousMetrics: prevMetrics ?? null,
    regressionMetrics: regressionMetrics ?? null,
    verdict,
    budget: { estSpentCny: budget.spentCny, calls: budget.calls, byModel: budget.byModel, capCny: budget.maxCostCny },
    holdoutTouched: false,
  };
  writeJson(resolve(roundDir, 'round-report.json'), report);
  writeFileSync(resolve(roundDir, 'optimization-round-report.md'), `${renderRoundReport(report)}\n`, 'utf8');
  return report;
}

function renderRoundReport(report) {
  return [
    `# Optimization Round ${report.round} (${report.generatedAt})`,
    '',
    `- guideline: ${report.guideline.id} (parent ${report.guideline.parent ?? '-'}, status ${report.guideline.status})`,
    `- optimization metrics: ${JSON.stringify(report.optimizationMetrics)}`,
    `- previous metrics: ${JSON.stringify(report.previousMetrics)}`,
    `- regression-30 metrics: ${JSON.stringify(report.regressionMetrics)}`,
    `- verdict: ${JSON.stringify(report.verdict)}`,
    `- estimated spend: ¥${report.budget.estSpentCny.toFixed(4)} (cap ¥${report.budget.capCny})`,
    '- holdout: NOT TOUCHED (frozen for terminal evaluation)',
    '',
    '## Patch log',
    ...(report.guideline.patchLog ?? []).map((entry) => `- ${entry.applied ? 'APPLIED' : `SKIPPED (${entry.reason})`}: ${JSON.stringify(entry.patch).slice(0, 220)}`),
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Terminal holdout (one-shot, aggregate-only, explicit confirmation)
// ---------------------------------------------------------------------------

async function runTerminalHoldout({ transport }) {
  if (!argFlag('--i-confirm-terminal-holdout')) {
    throw new Error('terminal holdout requires --i-confirm-terminal-holdout (frozen set; one-shot; aggregate-only)');
  }
  const config = paths();
  const holdoutManifest = resolve(argValue('--holdout-manifest', 'reports/context-compression/holdout-manifest.json'));
  const holdoutMeta = resolve(argValue('--holdout-meta', 'reports/context-compression/holdout-meta.json'));
  const holdoutGt = resolve(argValue('--holdout-gt', 'reports/context-compression/handoff-benchmark-holdout/ground-truth.json'));
  const guidelineId = argValue('--guideline-id', latestGuideline('accepted').id);
  const guideline = listGuidelines().find((entry) => entry.guideline.id === guidelineId)?.guideline;
  if (!guideline) throw new Error(`guideline not found: ${guidelineId}`);
  const outDir = resolve(config.roundsRoot, `terminal-holdout-${guidelineId}-${new Date().toISOString().slice(0, 10)}`);
  const budget = new BudgetLedger(Number(argValue('--round-budget-cny', '10')));
  const cache = new DiskCache(resolve(outDir, 'cache'));
  const summariesPath = await compressCorpus({
    manifestPath: holdoutManifest,
    metaPath: holdoutMeta,
    guideline,
    outDir: resolve(outDir, 'compressed'),
    budget,
    cache,
    extractorModel: argValue('--extractor-model', 'qwen-flash'),
    transport,
    label: 'holdout',
  });
  const evaluation = await runBenchmark({
    summariesPath,
    gtPath: holdoutGt,
    outDir: resolve(outDir, 'evaluation'),
    handoffModel: argValue('--handoff-model', 'qwen-flash'),
    judgeModel: argValue('--judge-model', 'qwen-plus-latest'),
    maxSamples: 100,
    allowUnlocked: true,
    transport,
  });
  // Aggregate-only artifact: per-sample traces stay sealed in the out dir.
  writeJson(resolve(outDir, 'TERMINAL-AGGREGATE.json'), {
    schema: 'terminal-holdout/v1',
    guidelineId,
    generatedAt: new Date().toISOString(),
    metrics: evaluation.metrics,
    sampleCount: evaluation.sampleCount,
    budget: { estSpentCny: budget.spentCny, calls: budget.calls },
    note: 'FROZEN holdout; run once per guideline; per-sample inspection forbidden before the final report',
  });
  console.log(JSON.stringify({ outDir, metrics: evaluation.metrics }, null, 2));
}

async function main() {
  if (argFlag('--terminal-holdout')) {
    await runTerminalHoldout({});
    return;
  }
  const round = Number(argValue('--round', '0'));
  const steps = argValue('--steps', 'analyze,compress,evaluate,finalize').split(',');
  const report = await runRound({ round, steps, transport: undefined });
  if (report?.analyzeOnly) return;
  console.log(JSON.stringify({
    round,
    guideline: report.guideline.id,
    optimization: report.optimizationMetrics,
    regression: report.regressionMetrics,
    verdict: report.verdict,
    spendCny: report.budget.estSpentCny,
  }, null, 2));
}

if (isMainEntrypoint(import.meta.url)) {
  main().catch((error) => {
    console.error(`[optimization-loop] FATAL: ${error.stack ?? error}`);
    process.exit(1);
  });
}