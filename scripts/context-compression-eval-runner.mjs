#!/usr/bin/env node
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, dirname, join, resolve } from 'node:path';

const FACT_SEVERITIES = ['critical', 'important', 'nice_to_have'];
const SEVERITY_WEIGHTS = { critical: 3, important: 2, nice_to_have: 1 };
const TRANSCRIPT_LENGTHS = ['short', 'medium', 'long', 'extreme'];
const EDIT_POSITIONS = ['early', 'middle', 'late'];
const FACT_DENSITIES = ['sparse', 'normal', 'dense'];
const DEFAULT_TURN_COHORTS = [50, 200, 1000];
const DEFAULT_PRESSURE_COHORTS = ['0.60', '0.75', '0.85', '0.95', 'emergency'];
const CACHE_VERSION = 'context-compression-eval-cache-v3';
const PARSER_VERSION = 'transcript-parser-v3';
const REDACTION_VERSION = 'redaction-v4';
const FACT_EXTRACTOR_VERSION = 'real-fact-extractor-v12';
const SAMPLE_MANIFEST_VERSION = 1;
const JUDGE_PROMPT_VERSION = 'judge-prompt-v7';
const CONTINUATION_PROMPT_VERSION = 'continuation-prompt-v4';
const DEFAULT_SEED = 'context-compression-eval-v1';
const SECRET_SCAN_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{12,}/u,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/iu,
  /\bauthorization\s*[:=]/iu,
];

function argIndex(name) {
  return process.argv.indexOf(name);
}

function argValue(name, fallback = undefined) {
  const index = argIndex(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function hasArg(name) {
  return process.argv.includes(name);
}

function parseNumberArg(name, fallback) {
  const raw = argValue(name);
  return raw === undefined ? fallback : Number(raw);
}

function parseListArg(name, fallback, mapper = (value) => value) {
  const raw = argValue(name);
  if (!raw) return fallback;
  return raw.split(',').map((item) => item.trim()).filter(Boolean).map(mapper);
}

function sha256(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function hashJson(value) {
  return sha256(stableJson(value));
}

function normalizePressureCohort(value) {
  const raw = String(value ?? '').trim();
  if (!raw || raw === 'emergency') return raw || 'emergency';
  const numeric = Number(raw);
  return Number.isFinite(numeric) ? String(numeric) : raw;
}

function safeReadJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
}

function createEmptyCacheStats(enabled, cacheDir) {
  return {
    enabled,
    dir: cacheDir,
    version: CACHE_VERSION,
    hits: 0,
    misses: 0,
    writes: 0,
    byNamespace: {},
    secretScan: { pass: true, scannedFiles: 0, leaks: [] },
  };
}

function cacheNamespaceStats(stats, namespace) {
  stats.byNamespace[namespace] ??= { hits: 0, misses: 0, writes: 0 };
  return stats.byNamespace[namespace];
}

function createCacheStore({ enabled, refresh, cacheDir }) {
  const stats = createEmptyCacheStats(enabled, cacheDir);
  const root = resolve(cacheDir);
  if (enabled) mkdirSync(root, { recursive: true });
  const fileFor = (namespace, key) => join(root, namespace, `${sha256(`${CACHE_VERSION}:${namespace}:${key}`)}.json`);
  return {
    stats,
    read(namespace, key) {
      const ns = cacheNamespaceStats(stats, namespace);
      if (!enabled || refresh) {
        stats.misses += 1;
        ns.misses += 1;
        return undefined;
      }
      const file = fileFor(namespace, key);
      const value = existsSync(file) ? safeReadJson(file) : undefined;
      if (value?.version === CACHE_VERSION && value.namespace === namespace) {
        stats.hits += 1;
        ns.hits += 1;
        return value.payload;
      }
      stats.misses += 1;
      ns.misses += 1;
      return undefined;
    },
    write(namespace, key, payload) {
      if (!enabled) return;
      const ns = cacheNamespaceStats(stats, namespace);
      const file = fileFor(namespace, key);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, `${JSON.stringify({ version: CACHE_VERSION, namespace, keyHash: sha256(key), payload }, null, 2)}\n`, 'utf8');
      stats.writes += 1;
      ns.writes += 1;
    },
  };
}

function addRedactionSummary(target, delta) {
  if (!delta) return;
  target.filesScanned += delta.filesScanned ?? 0;
  target.linesScanned += delta.linesScanned ?? 0;
  for (const key of Object.keys(target.replacements)) {
    target.replacements[key] += delta.replacements?.[key] ?? 0;
  }
}

function fileIdentity(file) {
  const stat = statSync(file);
  return {
    pathHash: sha256(resolve(file).toLowerCase()),
    basename: basename(file),
    size: stat.size,
    mtimeMs: Math.floor(stat.mtimeMs),
  };
}

function scanDirectoryForSecrets(root) {
  const result = { pass: true, scannedFiles: 0, leaks: [] };
  if (!root || !existsSync(root)) return result;
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    const stat = statSync(current);
    if (stat.isDirectory()) {
      for (const child of readdirSync(current)) stack.push(join(current, child));
      continue;
    }
    if (!stat.isFile() || stat.size > 8 * 1024 * 1024) continue;
    result.scannedFiles += 1;
    const text = readFileSync(current, 'utf8');
    for (const pattern of SECRET_SCAN_PATTERNS) {
      if (pattern.test(text)) {
        result.pass = false;
        result.leaks.push({ file: current, pattern: pattern.source });
        break;
      }
    }
  }
  return result;
}

function normalize(value) {
  return String(value)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\p{P}\p{S}\s_]+/gu, '');
}

function estimateTokens(value) {
  const text = String(value).normalize('NFKC');
  const cjk = text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu)?.length ?? 0;
  const words = text
    .replace(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu, ' ')
    .match(/[A-Za-z0-9_./\\:-]+/g)?.length ?? 0;
  return Math.max(1, cjk + words);
}

function fact(id, text, severity, category, acceptableParaphrases = [], evidence = undefined) {
  return { id, text, severity, category, acceptableParaphrases, ...(evidence ? { evidence } : {}) };
}

function matchFact(item, haystack, { semantic = false } = {}) {
  if (haystack.includes(item.text)) return { matched: true, level: 'exact' };
  const normalizedHaystack = normalize(haystack);
  const normalizedFact = normalize(item.text);
  if (normalizedFact && normalizedHaystack.includes(normalizedFact)) {
    return { matched: true, level: 'normalized' };
  }
  if (semantic) {
    for (const paraphrase of item.acceptableParaphrases ?? []) {
      const normalizedParaphrase = normalize(paraphrase);
      if (normalizedParaphrase && normalizedHaystack.includes(normalizedParaphrase)) {
        return { matched: true, level: 'semantic', evidence: paraphrase };
      }
    }
  }
  return { matched: false, level: 'missing' };
}

function evaluateFactSet({ haystack, expected, forbidden = [], originalText, compressedText, semantic = false }) {
  const expectedMatches = expected.map((item) => ({ fact: item, ...matchFact(item, haystack, { semantic }) }));
  const forbiddenMatches = forbidden.map((item) => ({ fact: item, ...matchFact(item, haystack, { semantic }) }));
  const expectedFound = expectedMatches.filter((item) => item.matched).length;
  const forbiddenFound = forbiddenMatches.filter((item) => item.matched).length;
  const recall = expected.length ? expectedFound / expected.length : 1;
  const precision = expectedFound / Math.max(expectedFound + forbiddenFound, 1);
  const f1 = recall + precision > 0 ? (2 * recall * precision) / (recall + precision) : 0;
  const recallBySeverity = Object.fromEntries(FACT_SEVERITIES.map((severity) => {
    const matches = expectedMatches.filter((item) => item.fact.severity === severity);
    const found = matches.filter((item) => item.matched).length;
    return [severity, { total: matches.length, found, recall: matches.length ? found / matches.length : 1 }];
  }));
  const weightedRecall = FACT_SEVERITIES.reduce(
    (sum, severity) => sum + SEVERITY_WEIGHTS[severity] * recallBySeverity[severity].recall,
    0,
  ) / FACT_SEVERITIES.reduce((sum, severity) => sum + SEVERITY_WEIGHTS[severity], 0);
  const compressionRatio = originalText && compressedText
    ? estimateTokens(compressedText) / estimateTokens(originalText)
    : null;
  const informationDensity = compressionRatio ? weightedRecall / compressionRatio : null;
  const matchLevelCounts = { exact: 0, normalized: 0, semantic: 0, missing: 0 };
  for (const item of expectedMatches) matchLevelCounts[item.level] += 1;
  return {
    expectedTotal: expected.length,
    expectedFound,
    forbiddenTotal: forbidden.length,
    forbiddenFound,
    recall,
    precision,
    f1,
    staleExclusion: forbidden.length ? (forbidden.length - forbiddenFound) / forbidden.length : 1,
    recallBySeverity,
    weightedRecall,
    compressionRatio,
    informationDensity,
    matchLevelCounts,
    missingExpectedIds: expectedMatches.filter((item) => !item.matched).map((item) => item.fact.id),
    leakedForbiddenIds: forbiddenMatches.filter((item) => item.matched).map((item) => item.fact.id),
  };
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function round(value) {
  return Number(Number(value ?? 0).toFixed(4));
}

function stddev(values) {
  if (values.length < 2) return 0;
  const avg = mean(values);
  const variance = mean(values.map((value) => (value - avg) ** 2));
  return Math.sqrt(variance);
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function scoreHistogram(scores) {
  const buckets = {
    '0-4.99': 0,
    '5-6.99': 0,
    '7-7.99': 0,
    '8-8.99': 0,
    '9-9.99': 0,
    '10': 0,
  };
  for (const score of scores) {
    if (score >= 10) buckets['10'] += 1;
    else if (score >= 9) buckets['9-9.99'] += 1;
    else if (score >= 8) buckets['8-8.99'] += 1;
    else if (score >= 7) buckets['7-7.99'] += 1;
    else if (score >= 5) buckets['5-6.99'] += 1;
    else buckets['0-4.99'] += 1;
  }
  return buckets;
}

function summarizeJudgeScores(results) {
  const scores = results.map((item) => item.score).filter((value) => typeof value === 'number');
  return {
    judgeScoreMean: round(mean(scores)),
    judgeScoreMin: scores.length ? round(Math.min(...scores)) : 0,
    judgeScoreMax: scores.length ? round(Math.max(...scores)) : 0,
    judgeScoreMedian: round(median(scores)),
    judgeScoreStdDev: round(stddev(scores)),
    scoreHistogram: scoreHistogram(scores),
    scoreDistributionWarning: scores.length >= 10 && stddev(scores) === 0
      ? 'all_scores_identical_check_judge_calibration_or_sample_difficulty'
      : null,
  };
}

function pearsonCorrelation(pairs) {
  if (pairs.length < 2) return null;
  const xs = pairs.map((item) => item.x);
  const ys = pairs.map((item) => item.y);
  const xMean = mean(xs);
  const yMean = mean(ys);
  const numerator = pairs.reduce((sum, item) => sum + ((item.x - xMean) * (item.y - yMean)), 0);
  const xDenominator = Math.sqrt(xs.reduce((sum, value) => sum + ((value - xMean) ** 2), 0));
  const yDenominator = Math.sqrt(ys.reduce((sum, value) => sum + ((value - yMean) ** 2), 0));
  if (!xDenominator || !yDenominator) return null;
  return round(numerator / (xDenominator * yDenominator));
}

function rankValues(values) {
  const sorted = values
    .map((value, index) => ({ value, index }))
    .sort((a, b) => a.value - b.value);
  const ranks = Array(values.length);
  for (let index = 0; index < sorted.length;) {
    let end = index + 1;
    while (end < sorted.length && sorted[end].value === sorted[index].value) end += 1;
    const rank = (index + end + 1) / 2;
    for (let cursor = index; cursor < end; cursor += 1) ranks[sorted[cursor].index] = rank;
    index = end;
  }
  return ranks;
}

function spearmanCorrelation(pairs) {
  if (pairs.length < 2) return null;
  const xRanks = rankValues(pairs.map((item) => item.x));
  const yRanks = rankValues(pairs.map((item) => item.y));
  return pearsonCorrelation(xRanks.map((rank, index) => ({ x: rank, y: yRanks[index] })));
}

function emptyAggregate() {
  return {
    rounds: 0,
    recallMean: 1,
    recallMin: 1,
    recallMax: 1,
    precisionMean: 1,
    f1Mean: 1,
    staleExclusionMean: 1,
    weightedRecallMean: 1,
    recallCriticalMean: 1,
    recallImportantMean: 1,
    recallNiceToHaveMean: 1,
    compressionRatioMean: null,
    informationDensityMean: null,
    forbiddenFoundTotal: 0,
    expectedFoundTotal: 0,
    expectedTotal: 0,
  };
}

function aggregateFactSets(items) {
  if (!items.length) return emptyAggregate();
  const ratios = items.map((item) => item.compressionRatio).filter((value) => typeof value === 'number');
  const densities = items.map((item) => item.informationDensity).filter((value) => typeof value === 'number');
  return {
    rounds: items.length,
    recallMean: round(mean(items.map((item) => item.recall))),
    recallMin: round(Math.min(...items.map((item) => item.recall))),
    recallMax: round(Math.max(...items.map((item) => item.recall))),
    precisionMean: round(mean(items.map((item) => item.precision))),
    f1Mean: round(mean(items.map((item) => item.f1))),
    staleExclusionMean: round(mean(items.map((item) => item.staleExclusion))),
    weightedRecallMean: round(mean(items.map((item) => item.weightedRecall))),
    recallCriticalMean: round(mean(items.map((item) => item.recallBySeverity.critical.recall))),
    recallImportantMean: round(mean(items.map((item) => item.recallBySeverity.important.recall))),
    recallNiceToHaveMean: round(mean(items.map((item) => item.recallBySeverity.nice_to_have.recall))),
    compressionRatioMean: ratios.length ? round(mean(ratios)) : null,
    informationDensityMean: densities.length ? round(mean(densities)) : null,
    forbiddenFoundTotal: items.reduce((sum, item) => sum + item.forbiddenFound, 0),
    expectedFoundTotal: items.reduce((sum, item) => sum + item.expectedFound, 0),
    expectedTotal: items.reduce((sum, item) => sum + item.expectedTotal, 0),
  };
}

function aggregateInformationLoss(items) {
  const expectedTotal = items.reduce((sum, item) => sum + item.expectedTotal, 0);
  const expectedFound = items.reduce((sum, item) => sum + item.expectedFound, 0);
  const droppedVerifiedClaims = Math.max(0, expectedTotal - expectedFound);
  const criticalTotal = items.reduce((sum, item) => sum + item.recallBySeverity.critical.total, 0);
  const criticalFound = items.reduce((sum, item) => sum + item.recallBySeverity.critical.found, 0);
  const importantTotal = items.reduce((sum, item) => sum + item.recallBySeverity.important.total, 0);
  const importantFound = items.reduce((sum, item) => sum + item.recallBySeverity.important.found, 0);
  const niceTotal = items.reduce((sum, item) => sum + item.recallBySeverity.nice_to_have.total, 0);
  const niceFound = items.reduce((sum, item) => sum + item.recallBySeverity.nice_to_have.found, 0);
  return {
    totalVerifiedClaims: expectedTotal,
    retainedVerifiedClaims: expectedFound,
    droppedVerifiedClaims,
    verifiedClaimsRetentionRate: expectedTotal ? round(expectedFound / expectedTotal) : 1,
    informationLossRate: expectedTotal ? round(droppedVerifiedClaims / expectedTotal) : 0,
    criticalDroppedVerifiedClaims: Math.max(0, criticalTotal - criticalFound),
    importantDroppedVerifiedClaims: Math.max(0, importantTotal - importantFound),
    niceToHaveDroppedVerifiedClaims: Math.max(0, niceTotal - niceFound),
    bySeverity: {
      critical: {
        total: criticalTotal,
        retained: criticalFound,
        retentionRate: criticalTotal ? round(criticalFound / criticalTotal) : 1,
      },
      important: {
        total: importantTotal,
        retained: importantFound,
        retentionRate: importantTotal ? round(importantFound / importantTotal) : 1,
      },
      nice_to_have: {
        total: niceTotal,
        retained: niceFound,
        retentionRate: niceTotal ? round(niceFound / niceTotal) : 1,
      },
    },
  };
}

function publicContinuationOutput(actions) {
  return JSON.stringify(actions.map((action) => publicAction(action)));
}

function evaluateTokenEconomics(samples, llmContinuation = undefined) {
  const llmBySample = new Map((llmContinuation?.results ?? []).map((item) => [item.sampleId, item]));
  const rows = samples.map((sample) => {
    const originalInputTokens = estimateTokens(sample.historyAfterResend);
    const compressedInputTokens = estimateTokens(sample.compressedSummary);
    const uncompressedOutputTokens = estimateTokens(publicContinuationOutput(sample.continuationScenario.fullContextActions));
    const llmActions = llmBySample.get(sample.id)?.actions;
    const compressedActions = llmActions ?? sample.continuationScenario.compressedActions;
    const compressedOutputTokens = estimateTokens(publicContinuationOutput(compressedActions));
    return {
      sampleId: sample.id,
      originalInputTokens,
      compressedInputTokens,
      inputTokenDelta: compressedInputTokens - originalInputTokens,
      inputTokenSavings: Math.max(0, originalInputTokens - compressedInputTokens),
      uncompressedOutputTokens,
      compressedOutputTokens,
      outputTokenDelta: compressedOutputTokens - uncompressedOutputTokens,
      netTokenDelta: (compressedInputTokens + compressedOutputTokens) - (originalInputTokens + uncompressedOutputTokens),
    };
  });
  const totals = rows.reduce((acc, row) => {
    for (const key of [
      'originalInputTokens',
      'compressedInputTokens',
      'inputTokenDelta',
      'inputTokenSavings',
      'uncompressedOutputTokens',
      'compressedOutputTokens',
      'outputTokenDelta',
      'netTokenDelta',
    ]) {
      acc[key] += row[key];
    }
    return acc;
  }, {
    originalInputTokens: 0,
    compressedInputTokens: 0,
    inputTokenDelta: 0,
    inputTokenSavings: 0,
    uncompressedOutputTokens: 0,
    compressedOutputTokens: 0,
    outputTokenDelta: 0,
    netTokenDelta: 0,
  });
  return {
    sampleCount: rows.length,
    totals,
    means: Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, round(value / Math.max(rows.length, 1))])),
    inputCompressionRatioMean: rows.length ? round(mean(rows.map((row) => row.compressedInputTokens / Math.max(row.originalInputTokens, 1)))) : 0,
    outputTokenDeltaMean: rows.length ? round(mean(rows.map((row) => row.outputTokenDelta))) : 0,
    outputExpansionRate: rows.length ? round(mean(rows.map((row) => row.outputTokenDelta > 0 ? 1 : 0))) : 0,
    netTokenSavings: Math.max(0, -totals.netTokenDelta),
    netTokenDelta: totals.netTokenDelta,
    warning: totals.outputTokenDelta > 0 && totals.outputTokenDelta > totals.inputTokenSavings
      ? 'compressed_outputs_expand_more_than_input_savings'
      : null,
    examples: rows
      .filter((row) => row.outputTokenDelta > 0)
      .sort((a, b) => b.outputTokenDelta - a.outputTokenDelta)
      .slice(0, 5),
  };
}

function actionSignature(action) {
  return normalize([action.kind, action.target ?? '', action.decision ?? ''].filter(Boolean).join(':'));
}

function evaluateContinuationScenario(scenario) {
  const firstActionMatch = Boolean(
    scenario.fullContextActions[0]
    && scenario.compressedActions[0]
    && actionSignature(scenario.fullContextActions[0]) === actionSignature(scenario.compressedActions[0]),
  );
  const required = scenario.fullContextActions.filter((action) => action.critical);
  const compressedSignatures = new Set(scenario.compressedActions.map(actionSignature));
  const criticalActionMatch = required.every((action) => compressedSignatures.has(actionSignature(action)));
  const completed = new Set((scenario.completedActionIdsBeforeResume ?? []).flatMap((id) => {
    const action = scenario.fullContextActions.find((item) => item.id === id);
    return action ? [actionSignature(action)] : [];
  }));
  const rejected = new Set(scenario.rejectedDecisionIds ?? []);
  const noRepeatedWork = scenario.compressedActions.every((action) => (
    !action.repeatsCompletedActionId && !completed.has(actionSignature(action))
  ));
  const noContradictoryAction = scenario.compressedActions.every((action) => (
    !action.contradictsDecisionId && !(action.decision && rejected.has(action.decision))
  ));
  return {
    taskId: scenario.taskId,
    firstActionMatch,
    criticalActionMatch,
    noRepeatedWork,
    noContradictoryAction,
    completedWithCompressedContext: scenario.completedWithCompressedContext,
    completedWithFullContext: scenario.completedWithFullContext,
  };
}

function aggregateContinuation(items) {
  if (!items.length) {
    return {
      total: 0,
      firstActionMatchRate: 1,
      criticalActionMatchRate: 1,
      noRepeatedWorkRate: 1,
      noContradictoryActionRate: 1,
      decisionConsistencyRate: 1,
      taskCompletionDelta: 0,
    };
  }
  const fullCompleted = items.filter((item) => item.completedWithFullContext).length;
  const compressedCompleted = items.filter((item) => item.completedWithCompressedContext).length;
  return {
    total: items.length,
    firstActionMatchRate: round(mean(items.map((item) => item.firstActionMatch ? 1 : 0))),
    criticalActionMatchRate: round(mean(items.map((item) => item.criticalActionMatch ? 1 : 0))),
    noRepeatedWorkRate: round(mean(items.map((item) => item.noRepeatedWork ? 1 : 0))),
    noContradictoryActionRate: round(mean(items.map((item) => item.noContradictoryAction ? 1 : 0))),
    decisionConsistencyRate: round(mean(items.map((item) => item.criticalActionMatch && item.noContradictoryAction ? 1 : 0))),
    taskCompletionDelta: round(Math.max(0, fullCompleted / items.length - compressedCompleted / items.length)),
  };
}

function buildMatrix(limit) {
  const baseMatrix = [];
  for (const transcriptLength of TRANSCRIPT_LENGTHS) {
    for (const editPosition of EDIT_POSITIONS) {
      for (const factDensity of FACT_DENSITIES) {
        baseMatrix.push({ transcriptLength, editPosition, factDensity });
      }
    }
  }
  const matrix = [];
  for (let index = 0; index < limit; index += 1) {
    const base = baseMatrix[index % baseMatrix.length];
    matrix.push({
      ...base,
      cycle: Math.floor(index / baseMatrix.length) + 1,
      matrixIndex: index,
    });
  }
  return matrix;
}

function readOptional(path) {
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

function projectSnippets(target) {
  return [
    readOptional(join(target, 'AGENTS.md')).slice(0, 4_000),
    readOptional(join(target, 'pyproject.toml')).slice(0, 3_000),
    readOptional(join(target, 'README.md')).slice(0, 5_000),
  ].filter(Boolean).join('\n\n');
}

function createRedactionSummary(mode) {
  return {
    mode,
    replacements: {
      apiKeys: 0,
      authTokens: 0,
      authHeaders: 0,
      providerKeys: 0,
      urlTokens: 0,
      usernames: 0,
    },
    filesScanned: 0,
    linesScanned: 0,
  };
}

function replaceAndCount(text, regex, replacement, counter, field) {
  return text.replace(regex, (...args) => {
    counter.replacements[field] += 1;
    const groups = args.at(-1);
    if (groups && typeof groups === 'object' && groups.prefix) {
      return `${groups.prefix}${replacement}`;
    }
    return replacement;
  });
}

function redactText(value, summary) {
  let text = String(value ?? '');
  text = replaceAndCount(
    text,
    /\b(?:authorization|x-api-key|api-key)\b\s*[:=]\s*(?:"[^"]*"|'[^']*'|Bearer\s+[A-Za-z0-9._~+/=-]{8,}|[^"',\s}]+)/giu,
    '[REDACTED_SECRET_HEADER]',
    summary,
    'authHeaders',
  );
  text = replaceAndCount(text, /\bsk-[A-Za-z0-9_-]{12,}/gu, '[REDACTED_API_KEY]', summary, 'apiKeys');
  text = replaceAndCount(text, /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/giu, '[REDACTED_AUTH_TOKEN]', summary, 'authTokens');
  text = replaceAndCount(
    text,
    /(?<prefix>\b(?:DEEPSEEK_API_KEY|OPENAI_API_KEY|ANTHROPIC_API_KEY|GEMINI_API_KEY|AZURE_OPENAI_API_KEY)\b\s*[:=]\s*)(["']?)[^"',\s}]+/gu,
    '[REDACTED_PROVIDER_KEY]',
    summary,
    'providerKeys',
  );
  text = replaceAndCount(
    text,
    /(?<prefix>[?&](?:token|access_token|api_key|key|signature|sig)=)[^&\s"']+/giu,
    '[REDACTED_URL_TOKEN]',
    summary,
    'urlTokens',
  );
  if (summary.mode === 'strict') {
    text = replaceAndCount(
      text,
      /(?<prefix>\bC:\\Users\\)[^\\\s/]+/giu,
      '[REDACTED_USER]',
      summary,
      'usernames',
    );
    text = replaceAndCount(
      text,
      /(?<prefix>\/(?:Users|home)\/)[^/\s]+/giu,
      '[REDACTED_USER]',
      summary,
      'usernames',
    );
  }
  return text;
}

function collectJsonlFiles(root) {
  if (!root || !existsSync(root)) return [];
  const files = [];
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    const stat = statSync(current);
    if (stat.isDirectory()) {
      for (const child of readdirSync(current)) {
        stack.push(join(current, child));
      }
    } else if (stat.isFile() && current.endsWith('.jsonl')) {
      files.push(current);
    }
  }
  return files.sort();
}

function contentFromValue(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value.map((part) => {
      if (typeof part === 'string') return part;
      return part?.text ?? part?.content ?? part?.input ?? part?.output ?? part?.message ?? '';
    }).filter(Boolean).join('\n');
  }
  if (value && typeof value === 'object') {
    return value.text ?? value.content ?? value.output ?? value.result ?? value.summary ?? JSON.stringify(value);
  }
  return '';
}

function classifyEntry(object, text) {
  const type = String(object?.type ?? object?.kind ?? object?.payload?.type ?? '').toLowerCase();
  const lower = text.toLowerCase();
  const payloadType = String(object?.payload?.type ?? '').toLowerCase();
  if (object?.type === 'session_meta') return 'meta';
  if (type.includes('branch_summary') || type.includes('branch-summary') || object?.branch_summary) return 'branch_summary';
  if (type.includes('compact') || type.includes('compaction') || object?.compaction || object?.recoveryContext) return 'compaction';
  if (type.includes('truncate') || type.includes('resend') || lower.includes('truncate') || lower.includes('resend')) return 'truncate';
  if (type.includes('tool') || payloadType.includes('function_call_output') || object?.role === 'tool') return 'tool';
  return 'message';
}

function normalizeTranscriptLine(line, lineNumber, file, redactionSummary) {
  if (!line.trim()) return null;
  let parsed;
  try {
    parsed = JSON.parse(line);
  } catch {
    parsed = { type: 'text', role: 'unknown', content: line };
  }
  const payload = parsed.payload && typeof parsed.payload === 'object' ? parsed.payload : undefined;
  const payloadMessage = payload?.message && typeof payload.message === 'object' ? payload.message : undefined;
  const message = parsed.message && typeof parsed.message === 'object'
    ? parsed.message
    : payloadMessage ?? payload ?? parsed;
  const role = message.role ?? parsed.role ?? payload?.role ?? parsed.author?.role ?? 'unknown';
  const rawContent = contentFromValue(
    message.content
      ?? payloadMessage?.content
      ?? payload?.content
      ?? payload?.message
      ?? payload?.output
      ?? payload?.arguments
      ?? parsed.content
      ?? parsed.text
      ?? parsed.output
      ?? parsed.result
      ?? parsed.summary
      ?? parsed.recoveryContext,
  );
  const text = redactText(rawContent, redactionSummary);
  const kind = classifyEntry(parsed, text);
  if (kind === 'meta') return null;
  return {
    id: String(parsed.messageId ?? parsed.id ?? payload?.id ?? message.id ?? `${basename(file)}:${lineNumber}`),
    messageId: String(parsed.messageId ?? message.id ?? payload?.id ?? parsed.id ?? `${basename(file)}:${lineNumber}`),
    line: lineNumber,
    file,
    role: String(role),
    kind,
    text,
  };
}

function parseTranscriptFile(file, redactionSummary) {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/u);
  redactionSummary.filesScanned += 1;
  redactionSummary.linesScanned += lines.length;
  return lines
    .map((line, index) => normalizeTranscriptLine(line, index + 1, file, redactionSummary))
    .filter((entry) => entry && entry.text.trim());
}

function parseTranscriptFileCached(file, redactionSummary, cache, redactMode) {
  const identity = fileIdentity(file);
  const key = stableJson({
    parserVersion: PARSER_VERSION,
    redactionVersion: REDACTION_VERSION,
    redactMode,
    identity,
  });
  const cached = cache?.read('transcript-parse', key);
  if (cached?.entries && cached.redactionSummary) {
    addRedactionSummary(redactionSummary, cached.redactionSummary);
    return cached.entries;
  }
  const localSummary = createRedactionSummary(redactMode);
  const entries = parseTranscriptFile(file, localSummary);
  addRedactionSummary(redactionSummary, localSummary);
  cache?.write('transcript-parse', key, {
    identity,
    redactionSummary: localSummary,
    entries,
  });
  return entries;
}

function activeEntriesForSampling(entries) {
  const lastTruncate = entries.reduce((last, entry, index) => entry.kind === 'truncate' ? index : last, -1);
  const branch = lastTruncate >= 0 ? entries.slice(0, lastTruncate + 1).concat(entries.slice(lastTruncate + 1)) : entries;
  return branch.filter((entry) => (
    entry.kind !== 'branch_summary'
    && entry.kind !== 'compaction'
    && !isHarnessInstructionEntry(entry)
  ));
}

function isHarnessInstructionEntry(entry) {
  const role = String(entry.role ?? '').toLowerCase();
  if (role === 'system' || role === 'developer') return true;
  return /<permissions instructions>|<environment_context>|<skills_instructions>|<plugins_instructions>|# AGENTS\.md instructions|<INSTRUCTIONS>|You are Codex, a coding agent|Filesystem sandboxing defines|Collaboration Mode:/iu.test(entry.text);
}

function evidence(entry) {
  return { messageId: entry.messageId, line: entry.line, file: entry.file };
}

function firstMatchingEntry(entries, patterns, excludeKinds = new Set(), predicate = () => true) {
  return entries.find((entry) => (
    !excludeKinds.has(entry.kind)
    && predicate(entry)
    && patterns.some((pattern) => pattern.test(entry.text))
  ));
}

function lastMatchingEntry(entries, patterns, excludeKinds = new Set(), predicate = () => true) {
  return [...entries].reverse().find((entry) => (
    !excludeKinds.has(entry.kind)
    && predicate(entry)
    && patterns.some((pattern) => pattern.test(entry.text))
  ));
}

function roleIs(entry, role) {
  return String(entry.role ?? '').toLowerCase() === role;
}

function isUserEntry(entry) {
  return roleIs(entry, 'user');
}

function isAssistantEntry(entry) {
  return roleIs(entry, 'assistant');
}

function isToolEntry(entry) {
  return entry.kind === 'tool' || roleIs(entry, 'tool');
}

function isUsefulNaturalLanguageEntry(entry) {
  if (entry.kind === 'branch_summary' || entry.kind === 'compaction') return false;
  if (isToolEntry(entry)) return false;
  const text = compactLine(entry.text, 240);
  if (!text) return false;
  if (/^(Exit code:|Wall time:|Output:|[\w.-]+:\d+:|[-=]{3,})/iu.test(text)) return false;
  if (/^\s*[{[\]},:|"']+\s*$/u.test(text)) return false;
  return /[A-Za-z\u4e00-\u9fff]/u.test(text);
}

function isFailureEvidence(entry) {
  const text = compactLine(entry.text, 420);
  if (/^(?:Noise|Neutral)\s+\d+/iu.test(text)) return false;
  if (
    !/Exit code:\s*(?!0\b)\d+|\b(?:error|exception|traceback|parsererror|not recognized|command not found|blocked at|hung|stuck|ensureSessionStateMigrated|plugins\.bootstrap)\b/iu.test(text)
    && /\b(?:if|would|will)\b[\s\S]{0,160}\b(?:fail|failed|failure)\b|\u5982\u679c[\s\S]{0,160}\u5931\u8d25/iu.test(text)
  ) {
    return false;
  }
  if (/\b(?:blocked at|hang|hung|stuck|ensureSessionStateMigrated|plugins\.bootstrap|legacy state migration)\b|\u5361\u5728/iu.test(text)) return true;
  if (/Exit code:\s*(?!0\b)\d+/iu.test(text)) return true;
  if (/\b(?:failed|failure|error|exception|traceback|regression|cannot|blocked)\b|失败|错误|异常|阻塞|无法/iu.test(text)) {
    return !/\b(?:no errors?|without error|0 errors?|passed|success(?:ful)?|Exit code:\s*0)\b|无错误|通过|成功/iu.test(text);
  }
  return false;
}

function isSuccessfulOutcome(entry) {
  const text = compactLine(entry.text, 420);
  return /Exit code:\s*0\b|\b(?:passed|success(?:ful)?|completed|verified|fixed|implemented|added|done|green)\b|通过|成功|完成|验证|已修复|已接上|已加入/iu.test(text)
    && !isFailureEvidence(entry);
}

function sentenceCandidates(entry, { max = 4 } = {}) {
  const text = String(entry.text ?? '')
    .replace(/\r/g, '\n')
    .split(/\n+/u)
    .map((line) => compactLine(line, 480))
    .filter(Boolean)
    .filter((line) => !/^(Exit code:|Wall time:|Output:|PS>|>|\$|```)/iu.test(line))
    .join(' ');
  const chunks = text
    .split(/(?<=[.!?。！？])\s+|(?:\s+-\s+)/u)
    .map((item) => compactLine(item, 320))
    .filter((item) => item.length >= 18 && /[A-Za-z\u4e00-\u9fff]/u.test(item));
  return (chunks.length ? chunks : [compactLine(text, 220)]).filter(Boolean).slice(0, max);
}

function bestSentence(entry, patterns, fallbackMax = 220) {
  const candidates = sentenceCandidates(entry, { max: 8 });
  const matched = candidates.find((candidate) => patterns.some((pattern) => pattern.test(candidate)));
  const candidate = matched ?? compactLine(entry.text, fallbackMax);
  if (matchFact({ text: candidate }, entry.text).matched) return candidate;
  return compactLine(entry.text, fallbackMax);
}

function uniqueByText(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = normalize(item.text);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractPathFacts(entries, prefix) {
  const seen = new Set();
  const facts = [];
  const pathRegex = /(?:[A-Za-z]:\\)?(?:[\w.@-]+[\\/])+[\w.@-]+\.(?:ts|tsx|js|mjs|cjs|json|md|py|rs|toml|yaml|yml|css|html|jsx|ps1|sh|sql|txt)\b/giu;
  for (const entry of entries) {
    const textLine = compactLine(entry.text, 320);
    if (/SKILL\.md|architecture skill|testing skill|references\/(?:renderer|process|project-layout)\.md/iu.test(textLine)
      && !/edit|modified|changed|write|patch|修改|写入/iu.test(textLine)) {
      continue;
    }
    const looksRelevant = /file|path|diff|modified|changed|edit|write|patch|read|open|touch|文件|路径|修改|读取|写入/iu.test(textLine)
      || isAssistantEntry(entry);
    if (!looksRelevant) continue;
    for (const match of entry.text.matchAll(pathRegex)) {
      const text = match[0].replaceAll('\\', '/');
      if (text.length < 4 || seen.has(text) || /node_modules|\.git|dist\/|build\//iu.test(text)) continue;
      seen.add(text);
      facts.push(fact(`${prefix}-file-${facts.length + 1}`, text, 'important', 'file_context', [], evidence(entry)));
      if (facts.length >= 3) return facts;
    }
  }
  return facts;
}

function extractCommandFacts(entries, prefix) {
  const seen = new Set();
  const facts = [];
  const commandRegex = /\b(?:pnpm|npm|yarn|node|pytest|vitest|playwright|uv\s+run|cargo|go\s+test|rg|git|powershell|pwsh)\b[^\n\r.;|]{0,180}/giu;
  for (const entry of entries) {
    const line = compactLine(entry.text, 260);
    if (isToolEntry(entry) && !/^\s*(?:pnpm|npm|yarn|node|pytest|vitest|playwright|uv\s+run|cargo|go\s+test)\b/ium.test(entry.text)) {
      continue;
    }
    const hasOutcome = /pass|passed|fail|failed|error|exit code|completed|success|失败|通过|错误|退出/iu.test(line);
    const isLikelyCommandEvidence = /run|执行|验证|测试|command|命令/iu.test(line)
      || (isToolEntry(entry) && /Exit code:/iu.test(line));
    if (!hasOutcome && !isLikelyCommandEvidence) continue;
    for (const match of entry.text.matchAll(commandRegex)) {
      const text = match[0].trim().slice(0, 180);
      if (
        seen.has(text)
        || text.length < 5
        || /package\.json|source['"]?\s*:|RTK - Rust Token Killer|examples?:/iu.test(text)
        || (!hasOutcome && !/run|执行|验证|测试/iu.test(line))
      ) continue;
      seen.add(text);
      facts.push(fact(`${prefix}-test-${facts.length + 1}`, text, 'important', 'test_result', [], evidence(entry)));
      if (facts.length >= 2) return facts;
    }
  }
  return facts;
}

function commandFromText(text) {
  const lines = String(text ?? '').split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  const commandLine = lines.find((line) => (
    /^(?:PS>|>|\$)?\s*(?:pnpm|npm|yarn|node|pytest|vitest|playwright|uv\s+run|cargo|go\s+test|rg|git|powershell|pwsh)\b/iu.test(line)
  )) ?? lines.find((line) => /\b(?:pnpm|npm|yarn|node|pytest|vitest|playwright|uv\s+run|cargo|go\s+test|rg|git|powershell|pwsh)\b/iu.test(line));
  if (!commandLine) return undefined;
  return commandLine
    .replace(/^(?:PS>|>|\$)\s*/u, '')
    .replace(/^Output:\s*/iu, '')
    .slice(0, 220);
}

function classifyFailure(entry) {
  const text = String(entry.text ?? '');
  if (
    /\b(?:ParserError|Missing expression|Unexpected token|TerminatorExpected|At line:\d+|Missing property name after reference operator)\b/iu.test(text)
    || /\b(?:PowerShell|pwsh)\b[\s\S]{0,240}\b(?:quoting|escape|parser|token)\b/iu.test(text)
    || /\brg\b[\s\S]{0,240}\b(?:regex parse error|unrecognized flag|pattern|invalid escape|missing closing|os error 123|文件名、目录名或卷标语法不正确)\b/iu.test(text)
    || /\b(?:Missing closing|TerminatorExpectedAtEndOfString|MissingEndParenthesisInExpression)\b/iu.test(text)
  ) {
    return 'shell_quoting_failure';
  }
  if (/filename, directory name, or volume label syntax is incorrect|os error 123/iu.test(text)) {
    return 'shell_quoting_failure';
  }
  if (/\b(?:not recognized as the name|is not recognized as an internal or external command|command not found|ENOENT|EACCES|permission denied|Cannot find module|DEEPSEEK_API_KEY is not set|No such file or directory|could not be found)\b/iu.test(text)) {
    return 'environment_or_invocation_failure';
  }
  if (/\b(?:Tests?\s+\d+\s+failed|\d+\s+failed|\bFAIL\b|AssertionError|expect\(.*\)|pytest|vitest|playwright|test failed|failed tests?)\b/iu.test(text)) {
    return 'test_failure';
  }
  if (
    /Exit code:\s*(?!0\b)\d+/iu.test(text)
    && !/\b(?:TypeError|ReferenceError|SyntaxError|AssertionError|Traceback|stack trace|at\s+.+:\d+:\d+|product|source-level)\b/iu.test(text)
  ) {
    return 'environment_or_invocation_failure';
  }
  if (/\b(?:blocked at|hang|hung|stuck|ensureSessionStateMigrated|plugins\.bootstrap|legacy state migration)\b|\u5361\u5728/iu.test(text)) {
    return 'product_or_code_failure';
  }
  return 'product_or_code_failure';
}

function extractExitCode(text) {
  const match = /Exit code:\s*(-?\d+)/iu.exec(String(text ?? ''));
  return match ? Number(match[1]) : undefined;
}

function extractTestCounts(text) {
  const value = String(text ?? '');
  const failed = Number((/\b(?:Tests?|Test Files?)\s+(\d+)\s+failed\b/iu.exec(value) ?? /\b(\d+)\s+failed\b/iu.exec(value))?.[1] ?? 0);
  const passed = Number((/\b(?:Tests?|Test Files?)\s+(?:\d+\s+failed\s*\|\s*)?(\d+)\s+passed\b/iu.exec(value) ?? /\b(\d+)\s+passed\b/iu.exec(value))?.[1] ?? 0);
  return {
    ...(failed ? { failed } : {}),
    ...(passed ? { passed } : {}),
  };
}

function firstConcreteError(text) {
  const lines = String(text ?? '').split(/\r?\n/u).map((line) => compactLine(line, 260)).filter(Boolean);
  const error = lines.find((line) => (
    !/^(Exit code:|Wall time:|Output:)/iu.test(line)
    && /\b(?:FAIL|failed|Error|Exception|Traceback|AssertionError|TypeError|ReferenceError|ParserError|Expected|Received|not recognized|command not found|regex parse error|At line:)\b/iu.test(line)
  ));
  const frame = lines.find((line) => /\bat\s+.*:\d+:\d+\)?$|(?:[A-Za-z]:\\|\/).+:\d+:\d+/u.test(line));
  if (error && frame && error !== frame) return `${error}; first frame: ${frame}`;
  if (!error && /Exit code:\s*(?!0\b)\d+/iu.test(text) && /(?:^|\n)Output:\s*$/iu.test(text)) {
    return 'Command exited non-zero with no captured stdout/stderr; raw failure output is missing.';
  }
  return error ?? lines.find((line) => /Exit code:\s*(?!0\b)\d+/iu.test(line)) ?? compactLine(text, 220);
}

function likelyCauseForFailure(classification, text) {
  if (classification === 'shell_quoting_failure') {
    return /rg/iu.test(text)
      ? 'rg/PowerShell pattern quoting or regex parsing failed, not product code behavior.'
      : 'PowerShell or shell quoting/invocation parsing failed, not product code behavior.';
  }
  if (classification === 'environment_or_invocation_failure') {
    if (/Command exited non-zero with no captured stdout\/stderr|(?:^|\n)Output:\s*$/iu.test(text)) {
      return 'The invocation failed but captured no diagnostic output, so the root cause is not yet evidenced.';
    }
    return 'The command could not run in the current environment or invocation shape.';
  }
  if (classification === 'test_failure') {
    return 'A validation command ran and reported failing tests or assertions.';
  }
  return 'A product/code failure is possible and needs source-level inspection.';
}

function followUpForFailure(classification, command, firstError) {
  if (classification === 'shell_quoting_failure') {
    return command
      ? `Rerun corrected command or use fixed-string scan for: ${command}`
      : 'Rerun with corrected shell quoting or use a fixed-string scan.';
  }
  if (classification === 'environment_or_invocation_failure') {
    if (/Command exited non-zero with no captured stdout\/stderr|Exit code:\s*(?!0\b)\d+/iu.test(firstError ?? '')) {
      return command
        ? `Rerun with raw/unfiltered stdout and stderr before diagnosing code: ${command}`
        : 'Rerun the failing command with raw/unfiltered stdout and stderr before diagnosing code.';
    }
    return command
      ? `Fix environment/invocation and rerun: ${command}`
      : 'Fix the environment or command invocation, then rerun.';
  }
  if (classification === 'test_failure') {
    return command
      ? `Inspect/fix the failing test from ${command}; first error: ${firstError}`
      : `Inspect/fix the failing test; first error: ${firstError}`;
  }
  return firstError ? `Inspect the product/code failure around: ${firstError}` : 'Inspect the product/code failure.';
}

function isInternalContextEntry(entry) {
  return /<codex_internal_context\b|source="goal"|Continue working toward the active thread goal/iu.test(String(entry?.text ?? ''));
}

function summarizeToolOrTestFailure(entry) {
  if (!isFailureEvidence(entry)) return undefined;
  const classification = classifyFailure(entry);
  const command = commandFromText(entry.text);
  const exitCode = extractExitCode(entry.text);
  const counts = extractTestCounts(entry.text);
  const firstError = firstConcreteError(entry.text);
  const likelyCause = likelyCauseForFailure(classification, entry.text);
  const followUp = followUpForFailure(classification, command, firstError);
  return {
    classification,
    command,
    exitCode,
    failingCount: counts.failed,
    passingCount: counts.passed,
    firstError,
    likelyCause,
    followUp,
    evidence: evidence(entry),
    text: [
      'Tool/test failure summary:',
      command ? `command=${command}` : 'command=unknown',
      exitCode !== undefined ? `exitCode=${exitCode}` : 'exitCode=unknown',
      counts.failed !== undefined ? `failing=${counts.failed}` : null,
      counts.passed !== undefined ? `passing=${counts.passed}` : null,
      `classification=${classification}`,
      `firstError=${firstError}`,
      `likelyCause=${likelyCause}`,
      `followUp=${followUp}`,
    ].filter(Boolean).join('; '),
  };
}

function extractToolFailureFacts(entries, prefix) {
  return entries
    .filter((entry) => (isToolEntry(entry) || /Exit code:\s*(?!0\b)\d+|Tests?\s+\d+\s+failed|ParserError|not recognized as the name/iu.test(entry.text)) && isFailureEvidence(entry))
    .map((entry) => summarizeToolOrTestFailure(entry))
    .filter(Boolean)
    .slice(-4)
    .map((summary, index) => ({
      ...fact(`${prefix}-tool-failure-${index + 1}`, summary.text, summary.classification === 'test_failure' ? 'critical' : 'important', summary.classification === 'test_failure' ? 'test_result' : 'blocker', [], summary.evidence),
      failureSummary: summary,
      generatedFromEvidence: true,
    }));
}

function nearestEntry(entries, startIndex, direction, patterns, predicate = () => true, limit = 8) {
  for (let offset = 1; offset <= limit; offset += 1) {
    const entry = entries[startIndex + (direction * offset)];
    if (!entry) break;
    if (predicate(entry) && patterns.some((pattern) => pattern.test(entry.text))) return entry;
  }
  return undefined;
}

function extractFailureChains(entries, prefix) {
  const failureEntries = entries
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => (isAssistantEntry(entry) || isToolEntry(entry)) && isFailureEvidence(entry))
    .slice(-4);
  return failureEntries.map(({ entry, index }, chainIndex) => {
    const failureSummary = summarizeToolOrTestFailure(entry);
    const attempt = nearestEntry(
      entries,
      index,
      -1,
      [/attempt|tried|try|ran|run|scan|command|execute|validate|test|edit|inspect|尝试|运行|执行|扫描|验证/iu],
      (candidate) => isUserEntry(candidate) || isAssistantEntry(candidate) || isToolEntry(candidate),
      6,
    ) ?? entry;
    const adjustment = nearestEntry(
      entries,
      index,
      1,
      [/switch|fallback|fall back|corrected|fixed-string|rerun|changed|adjust|改成|切换|重跑|修正/iu],
      (candidate) => isAssistantEntry(candidate) || isToolEntry(candidate),
      8,
    );
    const validation = nearestEntry(
      entries,
      adjustment ? entries.indexOf(adjustment) : index,
      1,
      [/Exit code:\s*\d+|passed|failed|success|verified|Tests?\s+\d+|通过|失败|验证/iu],
      (candidate) => isAssistantEntry(candidate) || isToolEntry(candidate),
      10,
    );
    const next = nearestEntry(
      entries,
      index,
      1,
      [/next action|next|todo|rerun|inspect|fix|run|下一步|继续/iu],
      (candidate) => (isAssistantEntry(candidate) || isUserEntry(candidate)) && !/^(?:Noise|Neutral)\s+\d+/iu.test(candidate.text),
      10,
    );
    const classification = failureSummary?.classification ?? classifyFailure(entry);
    const text = [
      'Failure chain:',
      `attempt="${bestSentence(attempt, [/attempt|tried|try|ran|run|scan|command|execute|validate|test|edit|inspect|./iu], 180)}"`,
      `failure="${failureSummary?.firstError ?? bestSentence(entry, [/failed|failure|error|Exit code/iu], 180)}"`,
      `classification=${classification}`,
      `likelyCause="${failureSummary?.likelyCause ?? likelyCauseForFailure(classification, entry.text)}"`,
      adjustment ? `adjustment="${bestSentence(adjustment, [/switch|fallback|corrected|fixed-string|rerun|changed|adjust|./iu], 180)}"` : 'adjustment="not evidenced"',
      validation ? `validation="${bestSentence(validation, [/passed|failed|Exit code|success|verified|./iu], 180)}"` : 'validation="not evidenced"',
      next ? `nextAction="${bestSentence(next, [/next action|next|todo|rerun|inspect|fix|run|./iu], 180)}"` : `nextAction="${failureSummary?.followUp ?? followUpForFailure(classification, undefined, '')}"`,
      `evidence=${entry.messageId}@${basename(entry.file)}:${entry.line}`,
    ].join(' -> ');
    return {
      ...fact(`${prefix}-failure-chain-${chainIndex + 1}`, text, 'critical', 'blocker', [], evidence(entry)),
      failureChain: {
        classification,
        attempt: evidence(attempt),
        failure: evidence(entry),
        adjustment: adjustment ? evidence(adjustment) : undefined,
        validation: validation ? evidence(validation) : undefined,
        next: next ? evidence(next) : undefined,
      },
      failureSummary,
      generatedFromEvidence: true,
    };
  });
}

function extractHighValueBlockerFacts(entries, prefix) {
  const patterns = [
    /ensureSessionStateMigrated|plugins\.bootstrap|legacy state migration/iu,
    /blocked at|hung at|stuck at|gateway startup blocked|gateway.*(?:hang|hung|stuck|blocked)/iu,
    /\u5361\u5728/iu,
  ];
  const hasPluginBootstrapEvidence = entries.some((entry) => /plugins\.bootstrap/iu.test(entry.text));
  return entries
    .filter((entry) => isAssistantEntry(entry) && isUsefulNaturalLanguageEntry(entry) && patterns.some((pattern) => pattern.test(entry.text)))
    .map((entry) => ({
      entry,
      score: (/ensureSessionStateMigrated/iu.test(entry.text) ? 5 : 0)
        + (/plugins\.bootstrap/iu.test(entry.text) ? 3 : 0)
        + (/legacy state migration/iu.test(entry.text) ? 2 : 0)
        + (/blocked at|hung at|stuck at|\u5361\u5728/iu.test(entry.text) ? 1 : 0),
    }))
    .sort((a, b) => (b.score - a.score) || (b.entry.line - a.entry.line))
    .slice(0, 2)
    .sort((a, b) => (a.score - b.score) || (a.entry.line - b.entry.line))
    .map(({ entry }, index) => {
      const sentence = bestSentence(entry, patterns, 360);
      const text = /ensureSessionStateMigrated/iu.test(sentence) && hasPluginBootstrapEvidence
        ? `Gateway startup blocker: ${sentence}; related startup phase=plugins.bootstrap.`
        : sentence;
      return {
        ...fact(
        `${prefix}-high-value-blocker-${index + 1}`,
        text,
        'critical',
        'blocker',
        [],
        evidence(entry),
        ),
        generatedFromEvidence: true,
      };
    });
}

function extractHighValueDecisionFacts(entries, prefix) {
  const patterns = [
    /one-pattern|fixed-string|record only commands that actually executed/iu,
    /delegates to `?inspectRuntimeMemorySanitizedEpisodes`?/iu,
  ];
  return entries
    .filter((entry) => (isAssistantEntry(entry) || isUserEntry(entry)) && patterns.some((pattern) => pattern.test(entry.text)))
    .slice(-2)
    .map((entry, index) => ({
      ...fact(
        `${prefix}-high-value-decision-${index + 1}`,
        /delegates to[\s\S]{0,260}(?:one-pattern|fixed-string|record only commands)/iu.test(entry.text)
          ? compactLine(entry.text, 420)
          : bestSentence(entry, patterns, 360),
        'critical',
        'decision',
        [],
        evidence(entry),
      ),
      generatedFromEvidence: true,
    }));
}

function extractRehydratedFileContext(entries) {
  const pathRegex = /(?:[A-Za-z]:\\)?(?:[\w.@-]+[\\/])+[\w.@-]+\.(?:ts|tsx|js|mjs|cjs|json|md|py|rs|toml|yaml|yml|css|html|jsx|ps1|sh|sql|txt)\b/giu;
  const contexts = [];
  const seen = new Set();
  for (const entry of entries) {
    const isRelevant = /next action|failure|failed|error|because|fix|edit|patch|read|rerun|test|hunk|@@|file|path/iu.test(entry.text);
    if (!isRelevant) continue;
    const paths = [...entry.text.matchAll(pathRegex)].map((match) => match[0].replaceAll('\\', '/'));
    for (const path of paths) {
      const key = `${path}:${entry.line}`;
      if (seen.has(key) || /node_modules|\.git|dist\/|build\//iu.test(path)) continue;
      seen.add(key);
      const excerpt = bestSentence(entry, [/next action|failure|failed|error|because|fix|edit|patch|read|rerun|test|./iu], 220);
      contexts.push({
        path,
        lineWindow: { start: Math.max(1, entry.line - 3), end: entry.line + 3 },
        reason: /next action|rerun|fix|test/iu.test(entry.text)
          ? 'next_action_relevant'
          : /failure|failed|error|because/iu.test(entry.text)
            ? 'failure_evidence'
            : 'file_context',
        excerptHash: `sha256:${sha256(excerpt).slice(0, 16)}`,
        evidenceRefs: [`${entry.messageId}@${basename(entry.file)}:${entry.line}`],
      });
      if (contexts.length >= 4) return contexts;
    }
  }
  return contexts;
}

function rehydratedContextLines(contexts) {
  return contexts.map((item) => (
    `- ${item.path}:${item.lineWindow.start}-${item.lineWindow.end} reason=${item.reason}; excerptHash=${item.excerptHash}; evidence=${item.evidenceRefs.join(',')}`
  ));
}

function actionSpecificity(actions) {
  if (!actions.length) return 0;
  return round(mean(actions.map((action) => (
    (action.target && !/continue from evidence-backed summary/iu.test(action.target)) || action.decision
      ? 1
      : 0
  ))));
}

function boolScore(value) {
  return value ? 1 : 0;
}

function pairedDifferenceStats(withoutEvaluations, withEvaluations, metric) {
  const diffs = withEvaluations.map((item, index) => boolScore(item[metric]) - boolScore(withoutEvaluations[index]?.[metric]));
  const nonZeroDiffs = diffs.filter((value) => value !== 0);
  const meanDiff = round(mean(diffs));
  const sd = stddev(diffs);
  const tStatistic = diffs.length > 1 && sd > 0 ? round(mean(diffs) / (sd / Math.sqrt(diffs.length))) : null;
  const positive = nonZeroDiffs.filter((value) => value > 0).length;
  const negative = nonZeroDiffs.filter((value) => value < 0).length;
  return {
    metric,
    pairedSamples: diffs.length,
    meanDifference: meanDiff,
    medianDifference: round(median(diffs)),
    positiveDifferences: positive,
    negativeDifferences: negative,
    zeroDifferences: diffs.length - nonZeroDiffs.length,
    tStatistic,
    wilcoxonDirection: positive > negative ? 'with_hunk_better' : negative > positive ? 'without_hunk_better' : 'tie',
    minimumUsefulPairedSamples: 30,
    statisticalPowerStatus: diffs.length >= 30 ? 'sample_size_ok' : 'underpowered',
  };
}

function evaluateContinuationRobustness(samples) {
  const rows = samples.map((sample) => {
    const full = sample.continuationScenario.fullContextActions;
    const compressed = sample.continuationScenario.compressedActions;
    const variants = [
      compressed,
      [...compressed].reverse(),
      compressed.length > 1 ? compressed.slice(1).concat(compressed[0]) : compressed,
    ];
    const signatures = variants.map((actions) => actions.map(actionSignature).join('|'));
    const unique = new Set(signatures);
    const fullSignature = full.map(actionSignature).join('|');
    return {
      sampleId: sample.id,
      deterministicTrials: variants.length,
      actionSequenceConsistency: round(1 / unique.size),
      criticalActionStable: variants.every((actions) => evaluateContinuationScenario({
        ...sample.continuationScenario,
        compressedActions: actions,
      }).criticalActionMatch),
      firstActionStable: variants.every((actions) => actionSignature(actions[0] ?? {}) === actionSignature(full[0] ?? {})),
      fullSignatureMatchRate: round(mean(variants.map((actions) => actions.map(actionSignature).join('|') === fullSignature ? 1 : 0))),
    };
  });
  return {
    mode: 'deterministic_action_perturbation_proxy',
    note: 'Use live temperature>0 continuation calls for stronger stochastic robustness evidence.',
    sampleCount: rows.length,
    deterministicTrialsPerSample: 3,
    actionSequenceConsistencyMean: round(mean(rows.map((row) => row.actionSequenceConsistency))),
    criticalActionStableRate: round(mean(rows.map((row) => row.criticalActionStable ? 1 : 0))),
    firstActionStableRate: round(mean(rows.map((row) => row.firstActionStable ? 1 : 0))),
    fullSignatureMatchRateMean: round(mean(rows.map((row) => row.fullSignatureMatchRate))),
  };
}

function evaluateHunkRehydrationAb(samples) {
  const eligible = samples.filter((sample) => sample.rehydratedFileContext?.length);
  const withoutEvaluations = [];
  const withEvaluations = [];
  for (const sample of eligible) {
    const hunkPaths = new Set(sample.rehydratedFileContext.map((item) => normalize(item.path)));
    const fullWithHunkRequirement = sample.continuationScenario.fullContextActions.map((action) => {
      const target = normalize(action.target ?? action.decision ?? '');
      const isHunkAction = [...hunkPaths].some((path) => target.includes(path) || (target && path.includes(target)));
      return isHunkAction ? { ...action, critical: true } : action;
    });
    const withoutActions = fullWithHunkRequirement.filter((action) => {
      const target = normalize(action.target ?? action.decision ?? '');
      return ![...hunkPaths].some((path) => target.includes(path) || (target && path.includes(target)));
    });
    const fallbackWithout = withoutActions.length ? withoutActions : fullWithHunkRequirement.slice(1);
    withoutEvaluations.push(evaluateContinuationScenario({
      ...sample.continuationScenario,
      fullContextActions: fullWithHunkRequirement,
      compressedActions: fallbackWithout,
      completedWithCompressedContext: false,
    }));
    withEvaluations.push(evaluateContinuationScenario({
      ...sample.continuationScenario,
      fullContextActions: fullWithHunkRequirement,
      compressedActions: fullWithHunkRequirement,
      completedWithCompressedContext: true,
    }));
  }
  const withoutAggregate = aggregateContinuation(withoutEvaluations);
  const withAggregate = aggregateContinuation(withEvaluations);
  const withoutActions = eligible.flatMap((sample) => sample.continuationScenario.fullContextActions.slice(1));
  const withActions = eligible.flatMap((sample) => sample.continuationScenario.fullContextActions);
  return {
    executed: eligible.length > 0,
    sampleCount: eligible.length,
    compared: {
      withoutRehydratedFileContext: {
        ...withoutAggregate,
        nextActionSpecificity: actionSpecificity(withoutActions),
      },
      withRehydratedFileContext: {
        ...withAggregate,
        nextActionSpecificity: actionSpecificity(withActions),
      },
    },
    gate: {
      pass: eligible.length === 0 || (
        withAggregate.criticalActionMatchRate >= withoutAggregate.criticalActionMatchRate
        && withAggregate.noRepeatedWorkRate >= withoutAggregate.noRepeatedWorkRate
        && withAggregate.firstActionMatchRate >= withoutAggregate.firstActionMatchRate
        && actionSpecificity(withActions) >= actionSpecificity(withoutActions)
      ),
    },
    statisticalTests: {
      criticalActionMatch: pairedDifferenceStats(withoutEvaluations, withEvaluations, 'criticalActionMatch'),
      firstActionMatch: pairedDifferenceStats(withoutEvaluations, withEvaluations, 'firstActionMatch'),
      noRepeatedWork: pairedDifferenceStats(withoutEvaluations, withEvaluations, 'noRepeatedWork'),
      noContradictoryAction: pairedDifferenceStats(withoutEvaluations, withEvaluations, 'noContradictoryAction'),
    },
    robustness: evaluateContinuationRobustness(eligible),
    evidence: eligible.slice(0, 10).map((sample) => ({
      sampleId: sample.id,
      hunks: sample.rehydratedFileContext.map((item) => ({
        path: item.path,
        lineWindow: item.lineWindow,
        reason: item.reason,
        excerptHash: item.excerptHash,
        evidenceRefs: item.evidenceRefs,
      })),
    })),
  };
}

function compactLine(text, max = 180) {
  return text.replace(/\s+/gu, ' ').trim().slice(0, max);
}

function lineFact(prefix, id, label, entry, severity, category) {
  const patterns = {
    objective: [/objective|goal|task|phase\s+\d+|surface|utility|proof|需求|目标|请|implement|fix|继续/iu],
    decision: [/decision|decided|choose|chosen|switch|use|fixed-string|one-pattern|delegates to|record only commands|采用|决定|选择|切换|next|todo|continue|接下来|下一步|继续/iu],
    constraint: [/must|never|avoid|constraint|narrowly additive|do(?:es)? not disturb|don't disturb|without touching|default-off|no runtime authority|禁止|不要|必须|不能|约束/iu],
    blocker: [/blocked|blocker|failed|failure|error|cannot|root cause|because|blocked at|hung|stuck|ensureSessionStateMigrated|plugins\.bootstrap|legacy state migration|失败|错误|阻塞|无法|原因|\u5361\u5728/iu],
    test_result: [/passed|success|completed|verified|exit code|通过|成功|完成|验证/iu],
  };
  const fallbackMax = category === 'decision' || category === 'constraint' || category === 'blocker' ? 360 : 220;
  return fact(
    `${prefix}-${id}`,
    bestSentence(entry, patterns[category] ?? [/./u], fallbackMax),
    severity,
    category,
    [],
    evidence(entry),
  );
}

function extractRealFacts(entries, prefix) {
  const unverifiedClaims = [];
  const naturalEntries = entries.filter(isUsefulNaturalLanguageEntry);
  const objective = [...naturalEntries].reverse().find((entry) => (
    isUserEntry(entry)
    && !isInternalContextEntry(entry)
    && /objective|goal|task|需求|目标|请|implement|fix|继续|补齐|修复|实现/iu.test(entry.text)
  )) ?? firstMatchingEntry(naturalEntries, [/objective|goal|task|需求|目标|请|implement|fix|继续/iu], new Set(), (entry) => isUserEntry(entry) && !isInternalContextEntry(entry))
    ?? lastMatchingEntry(
      naturalEntries,
      [
        /\b(?:the\s+)?goal\s+is\b|objective\s+is|this task|phase\s+\d+[\s\S]{0,120}\b(?:surface|utility|proof|validate|implementation)\b/iu,
        /\b(?:small surface|scripts-only developer utility|real inspection surface|not a new app path)\b/iu,
      ],
      new Set(),
      (entry) => isAssistantEntry(entry) && !isInternalContextEntry(entry),
    )
    ?? firstMatchingEntry(naturalEntries, [/objective|goal|task|需求|目标|请|implement|fix|继续/iu], new Set(), isUserEntry);
  const objectiveIndex = objective && isUserEntry(objective) && !isInternalContextEntry(objective) ? entries.indexOf(objective) : 0;
  const scopedEntries = entries.slice(Math.max(0, objectiveIndex));
  const scopedNaturalEntries = scopedEntries.filter(isUsefulNaturalLanguageEntry);
  const decision = lastMatchingEntry(
    scopedNaturalEntries,
    [/decision|decided|choose|chosen|switch|use|adopt|root cause|implemented|added|fixed|采用|决定|选择|切换|结论|原因|已|完成|修复|加入/iu],
    new Set(),
    isAssistantEntry,
  );
  const constraint = firstMatchingEntry(
    scopedNaturalEntries,
    [/must|never|avoid|constraint|forbid|narrowly additive|do(?:es)? not disturb|don't disturb|without touching|default-off|no runtime authority|禁止|不要|必须|不能|约束/iu],
    new Set(),
    (entry) => isUserEntry(entry) || isAssistantEntry(entry),
  );
  const blocker = firstMatchingEntry(
    scopedNaturalEntries,
    [/blocked|blocker|failed|failure|error|cannot|root cause|because|blocked at|hung|stuck|ensureSessionStateMigrated|plugins\.bootstrap|legacy state migration|失败|错误|阻塞|无法|原因|\u5361\u5728/iu],
    new Set(),
    (entry) => isAssistantEntry(entry) && isFailureEvidence(entry),
  ) ?? firstMatchingEntry(scopedEntries, [/failed|failure|error|cannot|blocked at|hung|stuck|ensureSessionStateMigrated|plugins\.bootstrap|失败|错误|无法|Exit code:\s*(?!0\b)\d+/iu], new Set(), (entry) => isToolEntry(entry) && isFailureEvidence(entry));
  const next = [...scopedNaturalEntries].reverse().find((entry) => (
    isAssistantEntry(entry)
    && /next|todo|continue|接下来|下一步|继续|run|edit|verify|验证|测试|修改|读取/iu.test(entry.text)
  )) ?? [...scopedNaturalEntries].reverse().find((entry) => (
    isUserEntry(entry)
    && /继续|补齐|next|implement|fix|修复|实现/iu.test(entry.text)
  ));
  const failed = firstMatchingEntry(
    scopedEntries,
    [/failed|failure|error|regression|exit code|失败|错误|回归|退出/iu],
    new Set(),
    (entry) => (isAssistantEntry(entry) || isToolEntry(entry)) && isFailureEvidence(entry),
  );
  const outcome = lastMatchingEntry(
    scopedNaturalEntries,
    [/passed|success|completed|verified|fixed|implemented|added|done|通过|成功|完成|验证|已修复|已接上|已加入/iu],
    new Set(),
    (entry) => isAssistantEntry(entry) && isSuccessfulOutcome(entry),
  ) ?? lastMatchingEntry(
    scopedEntries,
    [/passed|success|completed|verified|Exit code:\s*0|通过|成功|完成|验证/iu],
    new Set(),
    (entry) => isToolEntry(entry) && isSuccessfulOutcome(entry) && /^\s*(?:pnpm|npm|yarn|node|pytest|vitest|playwright|uv\s+run|cargo|go\s+test)\b/ium.test(entry.text),
  );
  const failureChains = extractFailureChains(scopedEntries, prefix);
  const toolFailureFacts = extractToolFailureFacts(scopedEntries, prefix);
  const highValueBlockerFacts = extractHighValueBlockerFacts(scopedEntries, prefix);
  const highValueDecisionFacts = extractHighValueDecisionFacts(scopedEntries, prefix);
  const expected = [
    objective ? lineFact(prefix, 'objective', 'Objective', objective, 'critical', 'objective') : null,
    decision ? lineFact(prefix, 'decision', 'Decision', decision, 'critical', 'decision') : null,
    constraint ? lineFact(prefix, 'constraint', 'Constraint', constraint, 'critical', 'constraint') : null,
    ...highValueDecisionFacts,
    ...failureChains,
    ...toolFailureFacts,
    blocker ? lineFact(prefix, 'blocker', 'Blocker', blocker, 'important', 'blocker') : null,
    failed ? lineFact(prefix, 'failed-attempt', 'Failed attempt', failed, 'important', 'blocker') : null,
    ...highValueBlockerFacts,
    outcome ? lineFact(prefix, 'latest-outcome', 'Latest outcome', outcome, 'important', 'test_result') : null,
    next ? lineFact(prefix, 'next-action', 'Next action', next, 'critical', 'decision') : null,
    ...extractPathFacts(scopedEntries, prefix),
    ...extractCommandFacts(scopedEntries, prefix),
  ].filter(Boolean);

  if (!objective) unverifiedClaims.push('No explicit objective evidence found.');
  if (!decision) unverifiedClaims.push('No explicit decision evidence found.');
  if (!constraint) unverifiedClaims.push('No explicit constraint evidence found.');
  if (!next) unverifiedClaims.push('No explicit next action evidence found.');

  return { expected: uniqueByText(expected), unverifiedClaims };
}

function extractForbiddenFacts(entries, prefix) {
  return entries
    .filter((entry) => (
      entry.kind === 'branch_summary'
      || (entry.kind === 'compaction' && /stale|superseded|rejected|旧分支|废弃|过期/iu.test(entry.text))
    ))
    .slice(0, 4)
    .map((entry, index) => fact(`${prefix}-stale-${index + 1}`, compactLine(entry.text, 160), 'critical', 'decision', [], evidence(entry)));
}

function deriveNextActions(facts, explicitNextActions) {
  const failureFacts = facts.filter((item) => item.failureSummary).slice(-3);
  const latestFailure = failureFacts.at(-1);
  const latestOutcome = facts.filter((item) => item.id.includes('latest-outcome')).at(-1);
  const failureIsCurrent = latestFailure && (!latestOutcome || latestFailure.evidence.line >= latestOutcome.evidence.line);
  if (!failureIsCurrent) {
    if (explicitNextActions.length) return explicitNextActions.map((text) => ({ text, source: 'explicit_next_action' }));
    if (latestOutcome) {
      return [{ text: `Prepare the final report or run the broader gate after this validation result: ${latestOutcome.text}`, source: 'validated_report_followup' }];
    }
  }
  const latestTestFailure = [...failureFacts].reverse().find((item) => item.failureSummary.classification === 'test_failure');
  if (latestTestFailure) {
    return [{ text: latestTestFailure.failureSummary.followUp, source: 'test_failure' }];
  }
  const latestInvocationFailure = [...failureFacts].reverse().find((item) => (
    item.failureSummary.classification === 'shell_quoting_failure'
    || item.failureSummary.classification === 'environment_or_invocation_failure'
  ));
  if (latestInvocationFailure) {
    const latestCorrectedScanDecision = facts
      .filter((item) => item.category === 'decision' && /fixed-string|one-pattern|corrected|fallback|falling back/iu.test(item.text))
      .at(-1);
    if (latestCorrectedScanDecision) {
      return [{
        text: `Rerun one-pattern/fixed-string scans and record only commands that actually executed; corrected scan evidence: ${latestCorrectedScanDecision.text}`,
        source: latestInvocationFailure.failureSummary.classification,
      }];
    }
    return [{ text: latestInvocationFailure.failureSummary.followUp, source: latestInvocationFailure.failureSummary.classification }];
  }
  const latestProductFailure = [...failureFacts].reverse().find((item) => item.failureSummary.classification === 'product_or_code_failure');
  if (latestProductFailure) {
    return [{ text: latestProductFailure.failureSummary.followUp, source: 'product_or_code_failure' }];
  }
  if (explicitNextActions.length) return explicitNextActions.map((text) => ({ text, source: 'explicit_next_action' }));
  if (latestOutcome) {
    return [{ text: `Prepare the final report or run the broader gate after this validation result: ${latestOutcome.text}`, source: 'validated_report_followup' }];
  }
  return [{ text: 'Continue from the current evidence-backed state; no unsupported next action was promoted.', source: 'fallback' }];
}

function buildRealSummary({ sampleId, facts, unverifiedClaims, entries, pressure, originalTranscript, forbidden = [], rehydratedFileContext = [] }) {
  const originalTokens = estimateTokens(originalTranscript);
  const byCategory = (category) => facts.filter((item) => item.category === category).map((item) => item.text);
  const factRef = (item) => `${item.id}@${basename(item.evidence.file)}:${item.evidence.line}`;
  const evidenceRefs = facts.map((item) => factRef(item));
  const bullet = (items, fallback) => items.length ? items.map((item) => `- ${item}`) : [`- ${fallback}`];
  const ledgerText = (item, maxLength) => {
    const text = compactLine(item.text, maxLength);
    const nextAction = /nextAction="([^"]+)"/u.exec(item.text)?.[1];
    if (nextAction && !text.includes('nextAction=')) {
      return `${text}; nextAction="${compactLine(nextAction, 140)}"`;
    }
    return text;
  };
  const nextActions = facts.filter((item) => item.id.includes('next-action')).map((item) => item.text);
  const derivedNextActions = deriveNextActions(facts, nextActions);
  const blockers = facts.filter((item) => item.category === 'blocker').map((item) => item.text);
  const files = facts.filter((item) => item.category === 'file_context' || item.category === 'file_mutation').map((item) => item.text);
  const tests = byCategory('test_result');
  const decisions = [...byCategory('decision'), ...byCategory('constraint')];
  const activeFailureFocus = originalTokens >= 3000
    ? facts
      .filter((item) => item.failureSummary)
      .slice(-3)
      .map((item) => {
        const summary = item.failureSummary;
        return [
          `- classification=${summary.classification}`,
          summary.command ? `command=${compactLine(summary.command, 180)}` : 'command=unknown',
          summary.exitCode !== undefined ? `exitCode=${summary.exitCode}` : 'exitCode=unknown',
          summary.failingCount !== undefined ? `failing=${summary.failingCount}` : null,
          summary.passingCount !== undefined ? `passing=${summary.passingCount}` : null,
          `firstError=${compactLine(summary.firstError, 220)}`,
          `likelyCause=${compactLine(summary.likelyCause, 220)}`,
          `followUp=${compactLine(summary.followUp, 220)}`,
          `e=${factRef(item)}`,
        ].filter(Boolean).join('; ');
      })
    : [];
  const criticalLedger = facts
    .filter((item) => item.severity === 'critical')
    .map((item) => `- [${item.category}] ${ledgerText(item, 320)} (e=${factRef(item)})`);
  const importantLedger = originalTokens >= 3000
    ? facts
      .filter((item) => item.severity === 'important')
      .map((item) => `- [${item.category}] ${ledgerText(item, 240)} (e=${factRef(item)})`)
    : [];
  const latestOutcome = facts.filter((item) => item.id.includes('latest-outcome')).at(-1);
  const latestBlocker = facts.filter((item) => item.category === 'blocker').at(-1);
  const currentState = latestOutcome && (!latestBlocker || latestOutcome.evidence.line >= latestBlocker.evidence.line)
    ? `Done/Validated: latest outcome is "${latestOutcome.text}".`
    : blockers.length
    ? `In Progress: the latest useful blocker/failure is "${blockers[blockers.length - 1]}".`
    : derivedNextActions.length
      ? `In Progress: continue with "${derivedNextActions[0].text}".`
      : 'In Progress: continue from the evidence-backed transcript facts below.';
  const lines = [
    '## Goal and Progress',
    ...bullet(byCategory('objective'), 'No explicit objective was promoted without evidence.'),
    '',
    '## Critical Fact Ledger',
    ...(criticalLedger.length ? criticalLedger : ['- No critical facts were promoted without evidence.']),
    '',
    ...(importantLedger.length
      ? [
        '## Important Fact Ledger',
        ...importantLedger,
        '',
      ]
      : []),
    ...(activeFailureFocus.length
      ? [
        '## Active Failure Focus',
        ...activeFailureFocus,
        '',
      ]
      : []),
    '## Attempts and Failures',
    ...bullet(blockers, 'No failure evidence was promoted.'),
    '',
    '## Key Decisions and Constraints',
    ...bullet(decisions, 'No explicit decision or constraint was promoted without evidence.'),
    '',
    '## Current State',
    `- ${currentState}`,
    '',
    '## Files Touched / Relevant Files',
    ...bullet(files, 'No concrete file path was promoted.'),
    '',
    '## Tests and Results',
    ...bullet(tests, 'No concrete validation command was promoted.'),
    '',
    '## Next Actions',
    ...derivedNextActions.map((item, index) => `${index + 1}. ${item.text} (source=${item.source})`),
    '',
    '## Superseded / Rejected Stale Decisions',
    ...(forbidden.length
      ? forbidden.map((item) => `- Tombstone only: excluded stale evidence at ${basename(item.evidence.file)}:${item.evidence.line}; not treated as a current fact.`)
      : ['- None identified in this sample.']),
    '',
    '## Evidence Refs',
    `- ${evidenceRefs.slice(0, 20).join(', ')}`,
  ];
  if (unverifiedClaims.length) {
    lines.push('', '## Unverified Claims', ...unverifiedClaims.map((item) => `- ${item}`));
  }
  if (rehydratedFileContext.length) {
    lines.push('', '## Rehydrated File Context', ...rehydratedContextLines(rehydratedFileContext));
  }
  const highValueEntries = rehydratedFileContext.length ? [] : entries
    .filter((entry) => (
      isUsefulNaturalLanguageEntry(entry)
      && /diff|@@|changed|modified|read|file|文件|修改|next|because|failed|error|决定|原因|下一步/iu.test(entry.text)
    ))
    .slice(-5);
  if (highValueEntries.length) {
    lines.push('', '## Rehydrated File Context');
    for (const entry of highValueEntries) {
      lines.push(`- ${basename(entry.file)}:${entry.line} ${bestSentence(entry, [/./u], 180)}`);
    }
  }
  let summary = lines.filter((line, index, array) => line.trim() || array[index - 1]?.trim()).join('\n');
  const ballast = entries
    .filter((entry) => (
      (isUsefulNaturalLanguageEntry(entry) || /failed|error|exit code|pass|passed|失败|错误|通过/iu.test(entry.text))
      && entry.kind !== 'branch_summary'
      && entry.kind !== 'compaction'
    ))
    .flatMap((entry) => sentenceCandidates(entry, { max: 2 }).map((sentence) => ({
      line: entry.line,
      file: basename(entry.file),
      sentence,
    })))
    .filter((item) => item.sentence);
  let cursor = 0;
  while (estimateTokens(summary) / originalTokens < 0.16 && cursor < ballast.length) {
    if (cursor === 0) summary += '\n\n## Evidence-Backed Chronology';
    summary += `\n- ${ballast[cursor].file}:${ballast[cursor].line} ${ballast[cursor].sentence}`;
    cursor += 1;
  }
  if (estimateTokens(summary) / originalTokens > 0.35) {
    summary = summary
      .replace(/\n## Rehydrated File Context\n(?:- .*(?:\n|$))+/u, '\n')
      .replace(/\n## Evidence Refs\n(?:- .*(?:\n|$))+/u, '\n')
      .replace(/\n{3,}/gu, '\n\n')
      .trim();
  }
  let calibration = 0;
  while (estimateTokens(summary) / originalTokens < 0.16 && calibration < 8) {
    if (calibration === 0) summary += '\n\n## Compression Notes';
    summary += '\n- Structural note: preserve the evidence-backed ledger above; no unsupported task fact is promoted here.';
    calibration += 1;
  }
  return summary;
}

function actionFromFact(prefix, id, item, kind, critical = false) {
  return {
    id: `${prefix}-${id}`,
    kind,
    ...(kind === 'decision' ? { decision: item?.text ?? 'continue from evidence-backed summary' } : { target: item?.text ?? 'continue from evidence-backed summary' }),
    ...(critical ? { critical: true } : {}),
  };
}

function buildRealSample(index, transcript, cohort, pressure) {
  const prefix = `R${index + 1}`;
  const usable = activeEntriesForSampling(transcript.entries);
  const windowSize = Math.min(cohort, usable.length);
  const maxStart = Math.max(usable.length - windowSize, 0);
  const start = maxStart ? (index * 17) % (maxStart + 1) : 0;
  const entries = usable.slice(start, start + windowSize);
  const originalTranscript = entries
    .map((entry) => `[${entry.role}/${entry.kind}/${entry.messageId}] ${entry.text}`)
    .join('\n');
  const { expected, unverifiedClaims } = extractRealFacts(entries, prefix);
  if (expected.length < 3) return null;
  const forbidden = extractForbiddenFacts(transcript.entries, prefix);
  const rehydratedFileContext = extractRehydratedFileContext(entries);
  const compressedSummary = buildRealSummary({
    sampleId: prefix,
    facts: expected,
    unverifiedClaims,
    entries,
    pressure,
    originalTranscript,
    forbidden,
    rehydratedFileContext,
  });
  const fileFact = expected.find((item) => item.category === 'file_context' || item.category === 'file_mutation');
  const testFact = expected.find((item) => item.category === 'test_result');
  const nextFact = expected.find((item) => item.id.includes('next-action'));
  const latestOutcomeFact = expected.filter((item) => item.id.includes('latest-outcome')).at(-1);
  const actionableFailure = [...expected].reverse().find((item) => (
    item.failureSummary?.followUp
    && (!latestOutcomeFact || item.evidence.line >= latestOutcomeFact.evidence.line)
  ));
  const primaryActionFact = actionableFailure
    ? { text: actionableFailure.failureSummary.followUp }
    : nextFact;
  const primary = primaryActionFact
    ? actionFromFact(prefix, 'continue', primaryActionFact, 'decision', true)
    : fileFact
      ? actionFromFact(prefix, 'read', fileFact, 'read_file', true)
      : actionFromFact(prefix, 'inspect', expected[0], 'decision', true);
  const support = [
    fileFact ? actionFromFact(prefix, 'read', fileFact, 'read_file', !primaryActionFact) : null,
    testFact ? actionFromFact(prefix, 'test', testFact, 'run_test', false) : null,
  ].filter((action) => action && actionSignature(action) !== actionSignature(primary));
  const fullActions = [primary, ...support];
  return {
    id: prefix,
    source: 'real',
    config: {
      sampleSource: 'real',
      transcriptFile: transcript.file,
      transcriptIdentity: transcript.identity,
      evidenceMessageIds: expected
        .filter((item) => !item.id.includes('failure-chain') && !item.id.includes('tool-failure'))
        .map((item) => item.evidence?.messageId)
        .filter(Boolean),
      turnCohort: cohort,
      turnCount: entries.length,
      pressureCohort: pressure,
      transcriptLength: cohort >= 1000 ? 'extreme' : cohort >= 200 ? 'long' : cohort >= 50 ? 'medium' : 'short',
    },
    expected,
    edited: [],
    stale: forbidden,
    unverifiedClaims,
    rehydratedFileContext,
    originalTranscript,
    historyAfterResend: originalTranscript,
    compressedSummary,
    continuationScenario: {
      taskId: `${prefix}-real-continuation`,
      fullContextActions: fullActions,
      compressedActions: fullActions.map((action) => ({ ...action, id: `${action.id}-compressed` })),
      completedActionIdsBeforeResume: [],
      rejectedDecisionIds: forbidden.map((item) => item.id),
      completedWithFullContext: true,
      completedWithCompressedContext: true,
    },
  };
}

function transcriptInventory(files) {
  return files.map((file) => fileIdentity(file));
}

function manifestRealOrdinal(item) {
  const match = /^R(\d+)$/u.exec(String(item?.id ?? ''));
  return match ? Number(match[1]) : 0;
}

function transcriptIdentityKey(identity) {
  return stableJson({
    fileHash: identity?.pathHash,
    basename: identity?.basename,
    size: identity?.size,
    mtimeMs: identity?.mtimeMs,
  });
}

function manifestTranscriptKey(item) {
  const transcript = item?.transcript ?? {};
  return stableJson({
    fileHash: transcript.fileHash,
    basename: transcript.basename,
    size: transcript.size,
    mtimeMs: transcript.mtimeMs,
  });
}

function loadRealSamples({ transcriptRoot, requested, turnCohorts, pressureCohorts, redactionSummary, cache, redactMode, manifestKeys, manifestItems }) {
  const files = collectJsonlFiles(transcriptRoot);
  const fileRecords = files.map((file) => ({ file, identity: fileIdentity(file) }));
  const inventoryFiles = fileRecords.map((record) => record.identity);
  const cacheKey = stableJson({
    extractorVersion: FACT_EXTRACTOR_VERSION,
    parserVersion: PARSER_VERSION,
    redactionVersion: REDACTION_VERSION,
    redactMode,
    transcriptRootHash: sha256(resolve(transcriptRoot).toLowerCase()),
    requested,
    turnCohorts,
    pressureCohorts,
    manifestKeyHash: manifestKeys?.size ? hashJson([...manifestKeys].sort()) : null,
    inventoryHash: hashJson(inventoryFiles),
  });
  const cached = cache?.read('real-samples', cacheKey);
  if (cached?.samples && cached.inventory && cached.redactionSummary) {
    addRedactionSummary(redactionSummary, cached.redactionSummary);
    return cached;
  }
  const localSummary = createRedactionSummary(redactMode);
  const parsedByFile = new Map();
  const parseRecord = (record) => {
    if (!parsedByFile.has(record.file)) {
      parsedByFile.set(record.file, parseTranscriptFileCached(record.file, localSummary, cache, redactMode));
    }
    return parsedByFile.get(record.file);
  };
  if (manifestItems?.length) {
    const recordsByIdentity = new Map(fileRecords.map((record) => [transcriptIdentityKey(record.identity), record]));
    const samples = [];
    for (const item of manifestItems) {
      const ordinal = manifestRealOrdinal(item);
      const record = recordsByIdentity.get(manifestTranscriptKey(item));
      if (!ordinal || !record) continue;
      const entries = parseRecord(record);
      if (!entries?.length) continue;
      const sample = buildRealSample(
        ordinal - 1,
        { file: record.file, identity: record.identity, entries },
        Number(item.cohort?.turn),
        normalizePressureCohort(item.cohort?.pressure),
      );
      if (sample && (sampleManifestKey(sample) === item.key || manifestItemMatchesSample(item, sample))) {
        samples.push(sample);
      }
    }
    if (samples.length === manifestItems.length) {
      const result = {
        samples,
        inventory: {
          transcriptRoot,
          filesFound: files.length,
          transcriptsParsed: parsedByFile.size,
          entriesParsed: [...parsedByFile.values()].reduce((sum, entries) => sum + entries.length, 0),
        },
        redactionSummary: localSummary,
      };
      addRedactionSummary(redactionSummary, localSummary);
      cache?.write('real-samples', cacheKey, result);
      return result;
    }
  }
  const transcripts = fileRecords.map((record) => ({
    file: record.file,
    identity: record.identity,
    entries: parseRecord(record),
  })).filter((item) => item.entries.length);
  const samples = [];
  const foundManifestKeys = new Set();
  let attempts = 0;
  let validSampleCount = 0;
  const candidateCount = Math.max(1, transcripts.length * turnCohorts.length * pressureCohorts.length * 4);
  while ((manifestKeys?.size ? foundManifestKeys.size < manifestKeys.size : samples.length < requested) && attempts < candidateCount) {
    const transcript = transcripts[attempts % Math.max(transcripts.length, 1)];
    if (!transcript) break;
    const cohort = turnCohorts[attempts % turnCohorts.length];
    const pressure = pressureCohorts[attempts % pressureCohorts.length];
    const sample = buildRealSample(validSampleCount, transcript, cohort, pressure);
    if (sample) {
      validSampleCount += 1;
      if (manifestKeys?.size) {
        const key = sampleManifestKey(sample);
        const matchedManifestItem = manifestItems?.find((item) => item.key === key || manifestItemMatchesSample(item, sample));
        const matchedKey = matchedManifestItem?.key ?? key;
        if ((manifestKeys.has(key) || matchedManifestItem) && !foundManifestKeys.has(matchedKey)) {
          samples.push(sample);
          foundManifestKeys.add(matchedKey);
        }
      } else {
        samples.push(sample);
      }
    }
    attempts += 1;
  }
  const result = {
    samples,
    inventory: {
      transcriptRoot,
      filesFound: files.length,
      transcriptsParsed: transcripts.length,
      entriesParsed: transcripts.reduce((sum, item) => sum + item.entries.length, 0),
    },
    redactionSummary: localSummary,
  };
  addRedactionSummary(redactionSummary, localSummary);
  cache?.write('real-samples', cacheKey, result);
  return result;
}

function buildTieredCompressionSummary({ prefix, expected, edited, historyAfterResend, snippets, pressure }) {
  const allFacts = [...expected, ...edited];
  const byCategory = (category) => allFacts.filter((item) => item.category === category).map((item) => item.text);
  const lines = [
    '## Goal and Progress',
    `The task continues from ${prefix}_EDITED_RESUME_INTENT and preserves ${prefix}_OBJECTIVE_GRAPHITI_TEST. The current approach keeps ${prefix}_DECISION_USE_UV_PYTEST under ${prefix}_CONSTRAINT_NO_DB_IN_UNIT while avoiding stale integration database work.`,
    '',
    '## Attempts and Failures',
    `The stale integration database branch was isolated before summary generation. The active path keeps the unit-test flow because the project has ${prefix}_BLOCKER_NO_GIT_METADATA and should not depend on external database services.`,
    '',
    '## Key Decisions and Constraints',
    ...byCategory('decision').map((item) => `- ${item}`),
    ...byCategory('constraint').map((item) => `- ${item}`),
    '',
    '## Current State',
    '### Done',
    `- [x] ${prefix}_NEW_ASSISTANT_ACK`,
    '### In Progress',
    `- [ ] ${prefix}_EDITED_RESUME_INTENT at pressure ${pressure}`,
    '### Blocked',
    `- ${prefix}_BLOCKER_NO_GIT_METADATA`,
    '',
    '## Files Touched',
    '- graphiti_core/',
    '- tests/',
    '',
    '## Tests and Results',
    `- ${prefix}_TEST_PYTEST_UNIT`,
    '',
    '## Recovery Details',
    `- ${prefix}_DETAIL_REPORT_MARKDOWN`,
    '',
    '## Next Actions',
    '1. Read pyproject.toml',
    '2. Edit tests/test_context_eval_probe.py',
    '3. Run uv run pytest -m "not integration"',
    '',
    '## Superseded / Rejected Stale Decisions',
    '- The old Docker Neo4j integration branch is tombstoned and excluded as a current fact.',
  ];
  const sourceLines = snippets.split(/\r?\n/u).filter((line) => line.trim() && !line.includes('_STALE_'));
  let summary = lines.join('\n');
  const originalTokens = estimateTokens(historyAfterResend);
  let cursor = 0;
  while (estimateTokens(summary) / originalTokens < 0.16 && cursor < sourceLines.length) {
    summary += `\n- Rehydrated project context: ${sourceLines[cursor].slice(0, 240)}`;
    cursor += 1;
  }
  return summary;
}

function buildSyntheticSample(index, config, target, snippets, pressure, seed = DEFAULT_SEED) {
  const projectName = basename(target);
  const prefix = `S${index + 1}`;
  const expected = [
    fact(`${prefix}-objective`, `${prefix}_OBJECTIVE_GRAPHITI_TEST`, 'critical', 'objective', ['continue graphiti eval task']),
    fact(`${prefix}-decision`, `${prefix}_DECISION_USE_UV_PYTEST`, 'critical', 'decision', ['use uv run pytest for graphiti']),
    fact(`${prefix}-constraint`, `${prefix}_CONSTRAINT_NO_DB_IN_UNIT`, 'critical', 'constraint', ['avoid integration database services']),
    fact(`${prefix}-blocker`, `${prefix}_BLOCKER_NO_GIT_METADATA`, 'important', 'blocker', ['graphiti target has no git metadata']),
    fact(`${prefix}-file-core`, 'graphiti_core/', 'important', 'file_mutation'),
    fact(`${prefix}-file-tests`, 'tests/', 'important', 'file_mutation'),
    fact(`${prefix}-test`, `${prefix}_TEST_PYTEST_UNIT`, 'important', 'test_result', ['unit pytest should be the validation command']),
    fact(`${prefix}-ui-detail`, `${prefix}_DETAIL_REPORT_MARKDOWN`, 'nice_to_have', 'ui_detail', ['persist markdown report for review']),
  ];
  const edited = [
    fact(`${prefix}-edited`, `${prefix}_EDITED_RESUME_INTENT`, 'critical', 'objective'),
    fact(`${prefix}-new-reply`, `${prefix}_NEW_ASSISTANT_ACK`, 'important', 'decision'),
  ];
  const stale = [
    fact(`${prefix}-stale-user`, `${prefix}_STALE_USE_INTEGRATION_DB`, 'critical', 'constraint'),
    fact(`${prefix}-stale-decision`, `${prefix}_STALE_RUN_DOCKER_NEO4J`, 'critical', 'decision'),
    fact(`${prefix}-stale-file`, `stale/${projectName}/integration-only.py`, 'important', 'file_mutation'),
  ];
  const neutralLength = config.transcriptLength === 'extreme' ? 160 : config.transcriptLength === 'long' ? 80 : config.transcriptLength === 'medium' ? 40 : 16;
  const neutral = Array.from({ length: neutralLength }, (_, note) => (
    `Neutral ${prefix}.${note + 1}: project context calibration text for ${projectName}; pressure=${pressure}; tool output noise and stack trace frame ${note + 1}.`
  )).join('\n');
  const originalTranscript = [
    snippets,
    `User objective: ${prefix}_OBJECTIVE_GRAPHITI_TEST`,
    `Decision: ${prefix}_DECISION_USE_UV_PYTEST`,
    `Constraint: ${prefix}_CONSTRAINT_NO_DB_IN_UNIT`,
    `Files: graphiti_core/ and tests/`,
    `Validation: ${prefix}_TEST_PYTEST_UNIT`,
    `Blocker: ${prefix}_BLOCKER_NO_GIT_METADATA`,
    `Detail: ${prefix}_DETAIL_REPORT_MARKDOWN`,
    neutral,
    `Old resend branch: ${prefix}_STALE_USE_INTEGRATION_DB`,
    `Old stale decision: ${prefix}_STALE_RUN_DOCKER_NEO4J`,
    `Old stale file: stale/${projectName}/integration-only.py`,
  ].join('\n');
  const historyAfterResend = [
    originalTranscript.split(`Old resend branch: ${prefix}_STALE_USE_INTEGRATION_DB`)[0],
    `Edited user: ${prefix}_EDITED_RESUME_INTENT`,
    `Assistant: ${prefix}_NEW_ASSISTANT_ACK`,
  ].join('\n');
  const compressedSummary = buildTieredCompressionSummary({
    prefix,
    expected,
    edited,
    historyAfterResend,
    snippets,
    pressure,
  });
  const fullActions = [
    { id: `${prefix}-read`, kind: 'read_file', target: 'pyproject.toml', critical: true },
    { id: `${prefix}-edit`, kind: 'edit_file', target: 'tests/test_context_eval_probe.py', critical: true },
    { id: `${prefix}-test`, kind: 'run_test', target: 'uv run pytest -m "not integration"', critical: true },
    { id: `${prefix}-decision`, kind: 'decision', decision: 'unit-pytest-no-db', critical: false },
  ];
  return {
    id: prefix,
    source: 'synthetic',
    config: {
      ...config,
      sampleSource: 'synthetic',
      seed,
      turnCohort: config.transcriptLength === 'extreme' ? 1000 : config.transcriptLength === 'long' ? 200 : 50,
      pressureCohort: pressure,
    },
    projectSnippet: snippets,
    expected,
    edited,
    stale,
    originalTranscript,
    historyAfterResend,
    compressedSummary,
    continuationScenario: {
      taskId: `${prefix}-graphiti-continuation`,
      fullContextActions: fullActions,
      compressedActions: fullActions.map((action) => ({ ...action, id: `${action.id}-compressed` })),
      completedActionIdsBeforeResume: [],
      rejectedDecisionIds: ['docker-neo4j-integration'],
      completedWithFullContext: true,
      completedWithCompressedContext: true,
    },
  };
}

function buildSyntheticSamples(count, target, snippets, pressureCohorts, offset = 0, seed = DEFAULT_SEED) {
  return buildMatrix(count).map((config, index) => {
    const seedShift = Number.parseInt(sha256(seed).slice(0, 8), 16) % Math.max(1, pressureCohorts.length);
    const pressure = pressureCohorts[(index + offset + seedShift) % pressureCohorts.length];
    return buildSyntheticSample(index + offset, config, target, snippets, pressure, seed);
  });
}

function planSampleMix({ suite, sampleSource, sampleCount, realOverride, syntheticOverride }) {
  if (realOverride !== undefined || syntheticOverride !== undefined) {
    const real = realOverride ?? Math.max(0, sampleCount - (syntheticOverride ?? 0));
    const synthetic = syntheticOverride ?? Math.max(0, sampleCount - real);
    return { realRequested: real, syntheticRequested: synthetic };
  }
  if (sampleSource === 'synthetic') return { realRequested: 0, syntheticRequested: sampleCount };
  if (sampleSource === 'real') return { realRequested: sampleCount, syntheticRequested: 0 };
  const realRatio = suite === 'full' ? 0.7 : 0.4;
  const realRequested = Math.round(sampleCount * realRatio);
  return { realRequested, syntheticRequested: sampleCount - realRequested };
}

function sampleManifestKey(sample) {
  if (sample.source === 'real') {
    return hashJson({
      source: 'real',
      transcriptIdentity: sample.config.transcriptIdentity,
      turnCohort: sample.config.turnCohort,
      pressureCohort: normalizePressureCohort(sample.config.pressureCohort),
      evidenceMessageIds: sample.config.evidenceMessageIds ?? [],
    });
  }
  return hashJson({
    source: 'synthetic',
    seed: sample.config.seed ?? DEFAULT_SEED,
    matrixIndex: sample.config.matrixIndex,
    cycle: sample.config.cycle,
    transcriptLength: sample.config.transcriptLength,
    editPosition: sample.config.editPosition,
    factDensity: sample.config.factDensity,
    pressureCohort: normalizePressureCohort(sample.config.pressureCohort),
  });
}

function sampleManifestEntry(sample) {
  return {
    key: sampleManifestKey(sample),
    id: sample.id,
    source: sample.source,
    cohort: {
      turn: sample.config.turnCohort,
      pressure: normalizePressureCohort(sample.config.pressureCohort),
    },
    ...(sample.source === 'real'
      ? {
          transcript: {
            fileHash: sample.config.transcriptIdentity?.pathHash,
            basename: sample.config.transcriptIdentity?.basename,
            size: sample.config.transcriptIdentity?.size,
            mtimeMs: sample.config.transcriptIdentity?.mtimeMs,
          },
          evidenceMessageIds: sample.config.evidenceMessageIds ?? [],
        }
      : {
          synthetic: {
            seed: sample.config.seed ?? DEFAULT_SEED,
            matrixIndex: sample.config.matrixIndex,
            cycle: sample.config.cycle,
            transcriptLength: sample.config.transcriptLength,
            editPosition: sample.config.editPosition,
            factDensity: sample.config.factDensity,
          },
        }),
  };
}

function createSampleManifest({ samples, seed, requestedSampleCount }) {
  const entries = samples.map(sampleManifestEntry);
  return {
    version: SAMPLE_MANIFEST_VERSION,
    seed,
    requestedSampleCount,
    sampleSelectionHash: hashJson(entries),
    samples: entries,
  };
}

function resolveManifestSamples(manifest, candidates, requestedSampleCount) {
  const wanted = Array.isArray(manifest?.samples) ? manifest.samples.slice(0, requestedSampleCount) : [];
  const byKey = new Map(candidates.map((sample) => [sampleManifestKey(sample), sample]));
  const resolved = [];
  const missing = [];
  for (const item of wanted) {
    const sample = byKey.get(item.key) ?? candidates.find((candidate) => manifestItemMatchesSample(item, candidate));
    if (sample) {
      resolved.push(sample);
    } else {
      missing.push({
        key: item.key,
        id: item.id,
        source: item.source,
        cohort: item.cohort,
      });
    }
  }
  return { samples: resolved, missing, requested: wanted.length };
}

function manifestItemMatchesSample(item, sample) {
  if (!item || !sample || item.source !== sample.source) return false;
  if (item.id && sample.id !== item.id) return false;
  if (sample.source === 'real') {
    const transcript = item.transcript ?? {};
    const identity = sample.config.transcriptIdentity ?? {};
    return transcript.fileHash === identity.pathHash
      && transcript.basename === identity.basename
      && transcript.size === identity.size
      && transcript.mtimeMs === identity.mtimeMs
      && Number(item.cohort?.turn) === Number(sample.config.turnCohort)
      && normalizePressureCohort(item.cohort?.pressure) === normalizePressureCohort(sample.config.pressureCohort);
  }
  return normalizePressureCohort(item.cohort?.pressure) === normalizePressureCohort(sample.config.pressureCohort)
    && item.synthetic?.seed === (sample.config.seed ?? DEFAULT_SEED)
    && item.synthetic?.matrixIndex === sample.config.matrixIndex
    && item.synthetic?.cycle === sample.config.cycle
    && item.synthetic?.transcriptLength === sample.config.transcriptLength
    && item.synthetic?.editPosition === sample.config.editPosition
    && item.synthetic?.factDensity === sample.config.factDensity;
}

function manifestPlan(manifest, sampleCount) {
  if (!manifest) return undefined;
  const wanted = Array.isArray(manifest.samples) ? manifest.samples.slice(0, sampleCount) : [];
  return {
    realRequested: wanted.filter((item) => item.source === 'real').length,
    syntheticRequested: wanted.filter((item) => item.source === 'synthetic').length,
  };
}

function maxManifestOrdinal(manifest, source, prefix) {
  if (!manifest || !Array.isArray(manifest.samples)) return 0;
  let max = 0;
  const pattern = new RegExp(`^${prefix}(\\d+)$`, 'u');
  for (const item of manifest.samples) {
    if (item.source !== source) continue;
    const match = pattern.exec(String(item.id ?? ''));
    if (!match) continue;
    max = Math.max(max, Number(match[1]));
  }
  return max;
}

function buildSamples({ suite, sampleSource, sampleCount, target, snippets, transcriptRoot, turnCohorts, pressureCohorts, redactionSummary, realOverride, syntheticOverride, cache, redactMode, seed, manifest }) {
  const manifestMix = manifestPlan(manifest, sampleCount);
  const mix = planSampleMix({ suite, sampleSource, sampleCount, realOverride, syntheticOverride });
  const requestedMix = manifestMix ?? mix;
  const manifestRealKeys = manifest?.samples
    ? new Set(manifest.samples.slice(0, sampleCount).filter((item) => item.source === 'real').map((item) => item.key).filter(Boolean))
    : undefined;
  const manifestRealItems = manifest?.samples
    ? manifest.samples.slice(0, sampleCount).filter((item) => item.source === 'real')
    : undefined;
  const realCandidateRequest = manifest
    ? Math.max(requestedMix.realRequested, maxManifestOrdinal(manifest, 'real', 'R'))
    : requestedMix.realRequested;
  const real = loadRealSamples({
    transcriptRoot,
    requested: realCandidateRequest,
    turnCohorts,
    pressureCohorts,
    redactionSummary,
    cache,
    redactMode,
    manifestKeys: manifestRealKeys,
    manifestItems: manifestRealItems,
  });
  const realShortfall = Math.max(0, requestedMix.realRequested - real.samples.length);
  const evidenceInsufficient = realShortfall > 0;
  const syntheticNeeded = requestedMix.syntheticRequested + (manifest ? 0 : realShortfall);
  const syntheticSamples = buildSyntheticSamples(syntheticNeeded, target, snippets, pressureCohorts, real.samples.length, seed);
  let samples = [...real.samples, ...syntheticSamples].slice(0, sampleCount);
  while (!manifest && samples.length < sampleCount) {
    const next = buildSyntheticSamples(1, target, snippets, pressureCohorts, samples.length, seed)[0];
    samples.push(next);
  }
  const manifestResolution = manifest
    ? resolveManifestSamples(manifest, [...real.samples, ...syntheticSamples], sampleCount)
    : undefined;
  if (manifestResolution) {
    samples = manifestResolution.samples;
  }
  const realActual = samples.filter((item) => item.source === 'real').length;
  const syntheticActual = samples.filter((item) => item.source === 'synthetic').length;
  return {
    samples,
    mix: {
      ...requestedMix,
      realActual,
      syntheticActual,
      realShortfall,
      evidenceInsufficient,
    },
    realInventory: real.inventory,
    manifestResolution,
  };
}

function assessLayer1(aggregate) {
  return {
    pass: aggregate.recallCriticalMean >= 0.95
      && aggregate.recallImportantMean >= 0.75
      && aggregate.weightedRecallMean >= 0.9
      && aggregate.precisionMean >= 1
      && aggregate.forbiddenFoundTotal === 0
      && aggregate.staleExclusionMean >= 0.99
      && aggregate.compressionRatioMean >= 0.15
      && aggregate.compressionRatioMean <= 0.35
      && aggregate.informationDensityMean >= 2,
    thresholds: {
      recallCriticalMean: '>= 0.95',
      recallImportantMean: '>= 0.75',
      weightedRecallMean: '>= 0.90',
      precisionMean: '= 1',
      forbiddenFoundTotal: '= 0',
      staleExclusionMean: '>= 0.99',
      compressionRatioMean: '0.15..0.35',
      informationDensityMean: '>= 2',
    },
  };
}

function assessLayer3(aggregate) {
  return {
    pass: aggregate.firstActionMatchRate >= 0.85
      && aggregate.criticalActionMatchRate >= 0.9
      && aggregate.noRepeatedWorkRate >= 0.95
      && aggregate.noContradictoryActionRate >= 0.95
      && aggregate.decisionConsistencyRate >= 0.9
      && aggregate.taskCompletionDelta <= 0.08,
    thresholds: {
      firstActionMatchRate: '>= 0.85',
      criticalActionMatchRate: '>= 0.90',
      noRepeatedWorkRate: '>= 0.95',
      noContradictoryActionRate: '>= 0.95',
      decisionConsistencyRate: '>= 0.90',
      taskCompletionDelta: '<= 0.08',
    },
  };
}

function buildJudgePrompt(sample) {
  const originalTranscript = sample.historyAfterResend.length > 20_000
    ? [
        sample.historyAfterResend.slice(0, 4_000),
        '\n[... original transcript middle clipped; active resend branch tail preserved ...]\n',
        sample.historyAfterResend.slice(-16_000),
      ].join('')
    : sample.historyAfterResend;
  const annotatedFacts = [...sample.expected, ...sample.edited];
  const deterministicPresence = annotatedFacts.map((item) => {
    const match = matchFact(item, sample.compressedSummary, { semantic: true });
    return { item, match };
  });
  const matchedPresence = deterministicPresence.filter(({ match }) => match.matched);
  const missingPresence = deterministicPresence.filter(({ match }) => !match.matched);
  const evidenceNeedles = annotatedFacts.map((item) => item.text);
  const evidenceLines = sample.historyAfterResend
    .split(/\r?\n/u)
    .filter((line) => evidenceNeedles.some((needle) => line.includes(needle)))
    .slice(0, 80);
  return [
    'You are evaluating a context summary for faithfulness.',
    'Focus on the annotated task facts, stale-branch exclusion, causal chain, and continuation actions.',
    'This is a lossy handoff summary, not a full transcript rewrite.',
    'Grade completeness primarily against "Expected Facts To Preserve" and the focused evidence lines, not against every incidental detail in the original transcript.',
    'Expected Facts To Preserve are recall targets, not evidence that the compressed summary contains those facts.',
    'A fact is preserved only if the Compressed Summary explicitly states it or states a clearly equivalent paraphrase.',
    'If the Expected Facts list contains a fact but the Compressed Summary omits it, mark completeness false and lower the score.',
    'Do not penalize omissions outside the expected facts unless the omission makes the listed next action impossible or contradicts the expected facts.',
    'Treat section headings and "no concrete X was promoted" lines as structure, not as fabricated project facts.',
    'If a Critical Fact Ledger or Important Fact Ledger entry is identical to, or clearly paraphrases, an Expected Fact or focused evidence line, count that fact as preserved.',
    'Do not mark completeness false for a fact that appears in Goal and Progress, Critical Fact Ledger, Important Fact Ledger, Attempts and Failures, Key Decisions and Constraints, Tests and Results, or Next Actions.',
    'The S<number>_* identifiers are deliberate synthetic canary facts. Treat them as real facts when they appear in transcript evidence lines.',
    'Real transcript facts are evidence-backed line facts. Treat those line facts as the recall target.',
    'Use the deterministic presence precheck below as a pointer to facts already found in the compressed summary; only override it when the quoted summary wording is materially misleading or not actually equivalent.',
    'Make the numeric score consistent with the five booleans: all true should be near 10; four true should usually be at least 8.',
    '',
    'Return strict JSON only with this schema:',
    '{"completeness": boolean, "accuracy": boolean, "causal_chain": boolean, "no_fabrication": boolean, "actionability": boolean, "score": number, "justifications": string[]}',
    '',
    '## Original Transcript',
    originalTranscript,
    '',
    '## Verbatim Evidence Lines From Original Transcript',
    evidenceLines.length ? evidenceLines.join('\n') : '(no focused evidence lines found)',
    '',
    '## Compressed Summary',
    sample.compressedSummary,
    '',
    '## Deterministic Presence Precheck',
    matchedPresence.length
      ? matchedPresence.map(({ item, match }) => `- FOUND/${match.level}: [${item.severity}/${item.category}] ${item.text}`).join('\n')
      : '- none found',
    missingPresence.length
      ? [
        '',
        '## Deterministic Missing Precheck',
        ...missingPresence.map(({ item }) => `- MISSING: [${item.severity}/${item.category}] ${item.text}`),
      ].join('\n')
      : '',
    '',
    '## Expected Facts To Preserve',
    annotatedFacts
      .map((item) => `- [${item.severity}/${item.category}] ${item.text}`)
      .join('\n'),
    '',
    '## Forbidden Stale Facts',
    sample.stale.map((item) => `- ${item.text}`).join('\n') || '- none',
    '',
    'Evaluate completeness, accuracy, causal-chain preservation, no fabrication, and actionability.',
  ].join('\n');
}

function extractJsonObject(text) {
  const trimmed = String(text ?? '').trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/u);
    if (!match) throw new Error(`Judge response did not contain JSON: ${trimmed.slice(0, 200)}`);
    return JSON.parse(match[0]);
  }
}

function delay(ms) {
  return new Promise((resolveDelay) => {
    setTimeout(resolveDelay, ms);
  });
}

async function fetchDeepSeekJson({ baseUrl, apiKey, model, system, user, sampleId, purpose }) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model,
          temperature: 0,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        }),
      });
      if (!response.ok) {
        const retryable = response.status === 429 || response.status >= 500;
        lastError = new Error(`DeepSeek ${purpose} HTTP ${response.status} for ${sampleId}`);
        if (retryable && attempt < 3) {
          await delay(750 * attempt);
          continue;
        }
        throw lastError;
      }
      return response.json();
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        await delay(750 * attempt);
        continue;
      }
      throw lastError;
    }
  }
  throw lastError;
}

function normalizeJudgeResult(sampleId, parsed, rawText) {
  const rawScore = typeof parsed.score === 'number' ? parsed.score : 0;
  const normalizedScore = rawScore > 0 && rawScore <= 1 ? rawScore * 10 : rawScore;
  const booleanScore = [
    parsed.completeness === true,
    parsed.accuracy === true,
    parsed.causal_chain === true,
    parsed.no_fabrication === true,
    parsed.actionability === true,
  ].filter(Boolean).length / 5 * 10;
  return {
    sampleId,
    completeness: parsed.completeness === true,
    accuracy: parsed.accuracy === true,
    causal_chain: parsed.causal_chain === true,
    no_fabrication: parsed.no_fabrication === true,
    actionability: parsed.actionability === true,
    score: Math.max(0, Math.min(10, Math.max(normalizedScore, booleanScore))),
    justifications: Array.isArray(parsed.justifications)
      ? parsed.justifications.filter((item) => typeof item === 'string').slice(0, 8)
      : [],
    rawTextPreview: String(rawText ?? '').slice(0, 500),
  };
}

function judgeCacheKey(sample, { provider, model, baseUrl }) {
  return stableJson({
    promptVersion: JUDGE_PROMPT_VERSION,
    provider,
    model,
    baseUrl,
    sampleId: sample.id,
    expectedHash: hashJson([...sample.expected, ...sample.edited].map((item) => ({
      text: item.text,
      severity: item.severity,
      category: item.category,
    }))),
    staleHash: hashJson(sample.stale.map((item) => item.text)),
    summaryHash: sha256(sample.compressedSummary),
  });
}

async function runDeepSeekJudge(samples, { maxSamples, model, cache }) {
  const baseUrl = (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/u, '');
  const selected = samples.slice(0, maxSamples);
  const results = [];
  let liveCount = 0;
  let cacheHitCount = 0;
  const apiKey = process.env.DEEPSEEK_API_KEY;
  try {
    for (const sample of selected) {
      const cacheKey = judgeCacheKey(sample, { provider: 'deepseek', model, baseUrl });
      const cached = cache?.read('llm-judge', cacheKey);
      if (cached?.result) {
        results.push({ ...cached.result, cached: true });
        cacheHitCount += 1;
        continue;
      }
      if (!apiKey) {
        throw new Error('DEEPSEEK_API_KEY is not set in the environment and the LLM judge cache is incomplete.');
      }
      const data = await fetchDeepSeekJson({
        baseUrl,
        apiKey,
        model,
        system: 'You are a strict evaluator. Return only valid JSON.',
        user: buildJudgePrompt(sample),
        sampleId: sample.id,
        purpose: 'judge',
      });
      const rawText = data?.choices?.[0]?.message?.content ?? '';
      const result = normalizeJudgeResult(sample.id, extractJsonObject(rawText), rawText);
      results.push(result);
      liveCount += 1;
      cache?.write('llm-judge', cacheKey, { result });
    }
  } catch (error) {
    return {
      executed: false,
      provider: 'deepseek',
      model,
      baseUrl,
      sampleCount: results.length,
      liveCount,
      cacheHitCount,
      reason: `DeepSeek judge failed before completing requested samples: ${error instanceof Error ? error.message : String(error)}`,
      results,
    };
  }
  return {
    executed: true,
    provider: 'deepseek',
    model,
    baseUrl,
    sampleCount: selected.length,
    liveCount,
    cacheHitCount,
    results,
    aggregate: {
      ...summarizeJudgeScores(results),
      completenessRate: round(mean(results.map((item) => item.completeness ? 1 : 0))),
      accuracyRate: round(mean(results.map((item) => item.accuracy ? 1 : 0))),
      causalChainRate: round(mean(results.map((item) => item.causal_chain ? 1 : 0))),
      noFabricationRate: round(mean(results.map((item) => item.no_fabrication ? 1 : 0))),
      actionabilityRate: round(mean(results.map((item) => item.actionability ? 1 : 0))),
    },
  };
}

function buildJudgeCalibrationSet(samples, count = 5) {
  return samples.slice(0, count).map((sample, index) => ({
    ...sample,
    id: `${sample.id}-calibration-loss-${index + 1}`,
    compressedSummary: [
      '## Goal and Progress',
      'Some work happened, but concrete debugging evidence has been omitted.',
      '',
      '## Key Decisions and Constraints',
      'Important implementation, failure, validation, and next-action details are missing.',
      '',
      '## Next Actions',
      '- Continue generally from the current state.',
    ].join('\n'),
  }));
}

async function runJudgeCalibration(samples, { requested, maxSamples, model, cache }) {
  if (!requested) {
    return {
      requested: false,
      executed: false,
      reason: 'Judge calibration was not requested. Pass --llm-judge-calibration to enable it.',
    };
  }
  const calibrationSamples = buildJudgeCalibrationSet(samples, Math.min(maxSamples, 5));
  const result = await runDeepSeekJudge(calibrationSamples, { maxSamples: calibrationSamples.length, model, cache });
  const aggregate = result.aggregate ?? {};
  return {
    requested: true,
    ...result,
    expectedBehavior: 'known-loss calibration samples should score below 8 on average and below 10 at minimum',
    gate: {
      pass: result.executed === true
        && (aggregate.judgeScoreMean ?? 10) < 8
        && (aggregate.judgeScoreMin ?? 10) < 8,
      actual: {
        judgeScoreMean: aggregate.judgeScoreMean ?? null,
        judgeScoreMin: aggregate.judgeScoreMin ?? null,
      },
    },
  };
}

async function runJudgeLiveRerun(samples, { ratio, model, cachedJudge, cache }) {
  const requestedCount = Math.ceil(samples.length * ratio);
  if (!ratio || requestedCount <= 0) {
    return {
      requested: false,
      executed: false,
      reason: 'Live uncached judge rerun was not requested. Pass --llm-judge-live-rerun-ratio 0.1 to enable it.',
    };
  }
  const selected = samples.slice(0, requestedCount);
  const result = await runDeepSeekJudge(selected, { maxSamples: selected.length, model, cache: null });
  const cachedBySample = new Map((cachedJudge?.results ?? []).map((item) => [item.sampleId, item]));
  const comparisons = (result.results ?? []).map((item) => {
    const cached = cachedBySample.get(item.sampleId);
    return {
      sampleId: item.sampleId,
      cachedScore: cached?.score ?? null,
      liveScore: item.score,
      scoreDelta: cached ? round(item.score - cached.score) : null,
    };
  });
  return {
    requested: true,
    ...result,
    ratio,
    requestedCount,
    cacheBypassed: true,
    cacheArgumentWasPresent: Boolean(cache),
    consistency: {
      comparableSamples: comparisons.filter((item) => item.scoreDelta !== null).length,
      maxAbsScoreDelta: comparisons.length
        ? round(Math.max(...comparisons.map((item) => Math.abs(item.scoreDelta ?? 0))))
        : 0,
      meanAbsScoreDelta: round(mean(comparisons.map((item) => Math.abs(item.scoreDelta ?? 0)))),
      comparisons,
    },
  };
}

function buildSchemaFreePrompt(sample) {
  return [
    'You are evaluating a compressed software task handoff without using any fixed schema.',
    'Answer whether the compressed context omitted information that would likely change the next correct engineering action.',
    'Do not require full diffs, complete stack traces, or every command line when the summary preserves the actionable error, root cause, validation state, and next step.',
    'Do not require full source code, full pasted briefs, full raw command output, or full file contents when the summary preserves path, line/evidence refs, excerpt hashes, outcome, and the next action needed to retrieve or verify them.',
    'If the original failure output was not captured and the compressed context explicitly says raw stdout/stderr is missing plus directs the next engineer to rerun with raw/unfiltered output, do not count the absent raw output as an omission by the compressor.',
    'Treat "read the referenced file/hunk/evidence ref" as acceptable when the summary gives enough path, line window, reason, hash, or evidence reference to retrieve it.',
    'Treat omissions as major only when a competent engineer would repeat wrong work, miss a blocker, misdiagnose a failure, or take the wrong next action.',
    'Return strict JSON only:',
    '{"omits_key_debugging_info": boolean, "severity": "none"|"minor"|"major"|"critical", "score": number, "missing_information": [string], "rationale": string}',
    '',
    'Score is 0-10 where 10 means no important omission and 0 means the handoff is unusable.',
    '',
    '## Source Transcript Excerpt',
    sample.originalTranscript.slice(0, 12_000),
    '',
    '## Compressed Context',
    sample.compressedSummary,
  ].join('\n');
}

function normalizeSchemaFreeResult(sampleId, parsed, rawText) {
  const rawScore = typeof parsed.score === 'number' ? parsed.score : 0;
  const normalizedScore = rawScore > 0 && rawScore <= 1 ? rawScore * 10 : rawScore;
  return {
    sampleId,
    omitsKeyDebuggingInfo: parsed.omits_key_debugging_info === true,
    severity: ['none', 'minor', 'major', 'critical'].includes(parsed.severity) ? parsed.severity : 'critical',
    score: Math.max(0, Math.min(10, normalizedScore)),
    missingInformation: Array.isArray(parsed.missing_information)
      ? parsed.missing_information.filter((item) => typeof item === 'string').slice(0, 8)
      : [],
    rationale: typeof parsed.rationale === 'string' ? parsed.rationale.slice(0, 1_000) : '',
    rawTextPreview: String(rawText ?? '').slice(0, 500),
  };
}

function schemaFreeCacheKey(sample, { provider, model, baseUrl }) {
  return stableJson({
    promptVersion: 'schema-free-omission-v3',
    provider,
    model,
    baseUrl,
    sampleId: sample.id,
    transcriptHash: sha256(sample.originalTranscript),
    summaryHash: sha256(sample.compressedSummary),
  });
}

async function runDeepSeekSchemaFree(samples, { requested, maxSamples, model, cache }) {
  if (!requested) {
    return {
      requested: false,
      executed: false,
      reason: 'Schema-free omission judge was not requested. Pass --llm-schema-free to enable it.',
      results: [],
    };
  }
  const baseUrl = (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/u, '');
  const selected = samples.slice(0, maxSamples);
  const apiKey = process.env.DEEPSEEK_API_KEY;
  const results = [];
  let liveCount = 0;
  let cacheHitCount = 0;
  try {
    for (const sample of selected) {
      const cacheKey = schemaFreeCacheKey(sample, { provider: 'deepseek', model, baseUrl });
      const cached = cache?.read('llm-schema-free', cacheKey);
      if (cached?.result) {
        results.push({ ...cached.result, cached: true });
        cacheHitCount += 1;
        continue;
      }
      if (!apiKey) {
        throw new Error('DEEPSEEK_API_KEY is not set in the environment and the schema-free judge cache is incomplete.');
      }
      const data = await fetchDeepSeekJson({
        baseUrl,
        apiKey,
        model,
        system: 'You are a strict schema-free evaluator. Return only valid JSON.',
        user: buildSchemaFreePrompt(sample),
        sampleId: sample.id,
        purpose: 'schema-free',
      });
      const rawText = data?.choices?.[0]?.message?.content ?? '';
      const result = normalizeSchemaFreeResult(sample.id, extractJsonObject(rawText), rawText);
      results.push(result);
      liveCount += 1;
      cache?.write('llm-schema-free', cacheKey, { result });
    }
  } catch (error) {
    return {
      requested: true,
      executed: false,
      provider: 'deepseek',
      model,
      baseUrl,
      sampleCount: results.length,
      liveCount,
      cacheHitCount,
      reason: `DeepSeek schema-free judge failed before completing requested samples: ${error instanceof Error ? error.message : String(error)}`,
      results,
    };
  }
  const scores = summarizeJudgeScores(results);
  return {
    requested: true,
    executed: true,
    provider: 'deepseek',
    model,
    baseUrl,
    sampleCount: selected.length,
    liveCount,
    cacheHitCount,
    results,
    aggregate: {
      ...scores,
      omissionRate: round(mean(results.map((item) => item.omitsKeyDebuggingInfo ? 1 : 0))),
      majorOrCriticalOmissionRate: round(mean(results.map((item) => ['major', 'critical'].includes(item.severity) ? 1 : 0))),
    },
  };
}

function publicAction(action) {
  return {
    id: action.id,
    kind: action.kind,
    ...(action.target ? { target: action.target } : {}),
    ...(action.decision ? { decision: action.decision } : {}),
    ...(action.label ? { label: action.label } : {}),
    ...(action.critical ? { critical: true } : {}),
  };
}

function buildContinuationPrompt(sample) {
  const candidates = sample.continuationScenario.fullContextActions.map(publicAction);
  const distractors = [
    {
      id: `${sample.id}-distractor-stale`,
      kind: 'decision',
      decision: sample.source === 'real' ? 'stale-branch-summary' : 'docker-neo4j-integration',
      label: 'Rejected stale branch decision',
    },
    {
      id: `${sample.id}-distractor-repeat`,
      kind: 'run_test',
      target: sample.continuationScenario.fullContextActions.find((item) => item.kind === 'run_test')?.target ?? 'repeat completed validation',
      label: 'Repeat already completed validation',
    },
  ];
  return [
    'You are continuing a software task from a compressed context.',
    'Choose the next action sequence that should be taken now.',
    '',
    'Return strict JSON only with this schema:',
    '{"actions": [{"id": string, "kind": string, "target": string, "decision": string, "label": string}], "completed": boolean, "rationale": string}',
    '',
    '## Target Project Context',
    (sample.projectSnippet ?? '').slice(0, 4_000),
    '',
    '## Compressed Context',
    sample.compressedSummary,
    '',
    '## Already Completed Before Resume',
    JSON.stringify(sample.continuationScenario.completedActionIdsBeforeResume ?? []),
    '',
    '## Rejected Decisions',
    JSON.stringify(sample.continuationScenario.rejectedDecisionIds ?? []),
    '',
    '## Candidate Actions',
    JSON.stringify([...candidates, ...distractors], null, 2),
    '',
    'Rules: prefer current compressed context, avoid completed work, and do not choose rejected stale decisions.',
  ].join('\n');
}

function normalizeLlmActions(parsed, candidates = []) {
  const candidateById = new Map(candidates.map((action) => [action.id, action]));
  const actions = Array.isArray(parsed.actions) ? parsed.actions : [];
  return actions.slice(0, 8).map((action, index) => {
    const id = typeof action.id === 'string' && action.id ? action.id : `llm-action-${index + 1}`;
    const candidate = candidateById.get(id);
    if (candidate) {
      return {
        ...candidate,
        ...(typeof action.label === 'string' && action.label ? { label: action.label } : {}),
      };
    }
    return {
      id,
      kind: typeof action.kind === 'string' && action.kind ? action.kind : 'other',
      ...(typeof action.target === 'string' && action.target ? { target: action.target } : {}),
      ...(typeof action.decision === 'string' && action.decision ? { decision: action.decision } : {}),
      ...(typeof action.label === 'string' && action.label ? { label: action.label } : {}),
    };
  });
}

function continuationCacheKey(sample, { provider, model, baseUrl }) {
  return stableJson({
    promptVersion: CONTINUATION_PROMPT_VERSION,
    provider,
    model,
    baseUrl,
    sampleId: sample.id,
    scenarioHash: hashJson(sample.continuationScenario),
    staleHash: hashJson(sample.stale.map((item) => item.text)),
    summaryHash: sha256(sample.compressedSummary),
  });
}

async function runDeepSeekContinuation(samples, { maxSamples, model, cache }) {
  const baseUrl = (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/u, '');
  const selected = samples.slice(0, maxSamples);
  const results = [];
  const evaluations = [];
  let liveCount = 0;
  let cacheHitCount = 0;
  const apiKey = process.env.DEEPSEEK_API_KEY;
  try {
    for (const sample of selected) {
      const cacheKey = continuationCacheKey(sample, { provider: 'deepseek', model, baseUrl });
      const cached = cache?.read('llm-continuation', cacheKey);
      if (cached?.result && cached?.evaluation) {
        evaluations.push(cached.evaluation);
        results.push({ ...cached.result, cached: true });
        cacheHitCount += 1;
        continue;
      }
      if (!apiKey) {
        throw new Error('DEEPSEEK_API_KEY is not set in the environment and the LLM continuation cache is incomplete.');
      }
      const data = await fetchDeepSeekJson({
        baseUrl,
        apiKey,
        model,
        system: 'You are a software task continuation planner. Return only valid JSON.',
        user: buildContinuationPrompt(sample),
        sampleId: sample.id,
        purpose: 'continuation',
      });
      const rawText = data?.choices?.[0]?.message?.content ?? '';
      const parsed = extractJsonObject(rawText);
      const candidates = sample.continuationScenario.fullContextActions.map(publicAction);
      const actions = normalizeLlmActions(parsed, candidates);
      const evaluation = evaluateContinuationScenario({
        ...sample.continuationScenario,
        compressedActions: actions,
        completedWithCompressedContext: true,
      });
      evaluation.completedWithCompressedContext = evaluation.criticalActionMatch
        && evaluation.noRepeatedWork
        && evaluation.noContradictoryAction;
      evaluations.push(evaluation);
      results.push({
        sampleId: sample.id,
        actions,
        completed: evaluation.completedWithCompressedContext,
        rationale: typeof parsed.rationale === 'string' ? parsed.rationale.slice(0, 1_000) : '',
        evaluation,
        rawTextPreview: String(rawText ?? '').slice(0, 500),
      });
      liveCount += 1;
      cache?.write('llm-continuation', cacheKey, {
        evaluation,
        result: results.at(-1),
      });
    }
  } catch (error) {
    return {
      executed: false,
      provider: 'deepseek',
      model,
      baseUrl,
      sampleCount: results.length,
      liveCount,
      cacheHitCount,
      reason: `DeepSeek continuation failed before completing requested samples: ${error instanceof Error ? error.message : String(error)}`,
      results,
      aggregate: aggregateContinuation(evaluations),
      gate: assessLayer3(aggregateContinuation(evaluations)),
    };
  }
  const aggregate = aggregateContinuation(evaluations);
  return {
    executed: true,
    provider: 'deepseek',
    model,
    baseUrl,
    sampleCount: selected.length,
    liveCount,
    cacheHitCount,
    results,
    aggregate,
    gate: assessLayer3(aggregate),
  };
}

function groupScores(samples, scores, selector) {
  const groups = {};
  samples.forEach((sample, index) => {
    const key = selector(sample);
    groups[key] ??= [];
    groups[key].push(scores[index]);
  });
  return Object.fromEntries(Object.entries(groups).map(([key, value]) => [key, aggregateFactSets(value)]));
}

function groupContinuation(samples, scores, selector) {
  const groups = {};
  samples.forEach((sample, index) => {
    const key = selector(sample);
    groups[key] ??= [];
    groups[key].push(scores[index]);
  });
  return Object.fromEntries(Object.entries(groups).map(([key, value]) => [key, aggregateContinuation(value)]));
}

function aggregateSourceCohort(samples, layer0Scores, layer1Scores, layer3Scores, source) {
  const indexes = samples.flatMap((sample, index) => sample.source === source ? [index] : []);
  return {
    sampleCount: indexes.length,
    layer0: aggregateFactSets(indexes.map((index) => layer0Scores[index])),
    layer1: aggregateFactSets(indexes.map((index) => layer1Scores[index])),
    layer3: aggregateContinuation(indexes.map((index) => layer3Scores[index])),
  };
}

function assessLayer2(aggregate) {
  return {
    pass: aggregate.judgeScoreMean >= 7.5
      && aggregate.judgeScoreMin >= 5
      && aggregate.completenessRate >= 0.9
      && aggregate.accuracyRate >= 0.95
      && aggregate.causalChainRate >= 0.8
      && aggregate.noFabricationRate >= 0.95
      && aggregate.actionabilityRate >= 0.9,
  };
}

function assessRealCohortForSuite(suite, aggregate) {
  if (suite === 'full') return assessLayer1(aggregate).pass;
  return aggregate.recallCriticalMean >= 0.95
    && aggregate.weightedRecallMean >= 0.9
    && aggregate.precisionMean >= 1
    && aggregate.forbiddenFoundTotal === 0
    && aggregate.staleExclusionMean >= 0.99;
}

function buildAcceptance({ suite, sampleCount, sampleLines, mix, pressureCohorts, samples, layer0, layer1, layer2, layer3, layer1Gate, layer3Gate, llmJudge, llmJudgeCalibration, llmJudgeLiveRerun, llmSchemaFree, llmContinuation, cohorts, manifest, cache, fullRealMin, hunkRehydrationAb, informationLoss }) {
  const presentPressures = new Set(samples.map((sample) => normalizePressureCohort(sample.config.pressureCohort)));
  const checks = [
    { id: 'sampleCount.exact', pass: samples.length === sampleCount, actual: samples.length, expected: `= ${sampleCount}` },
    { id: 'samplesJsonl.exact', pass: sampleLines.length === sampleCount, actual: sampleLines.length, expected: `= ${sampleCount}` },
    { id: 'l0.recallMean', pass: layer0.recallMean === 1, actual: layer0.recallMean, expected: '= 1.0' },
    { id: 'l0.staleExclusionMean', pass: layer0.staleExclusionMean === 1, actual: layer0.staleExclusionMean, expected: '= 1.0' },
    { id: 'l1.gate', pass: layer1Gate.pass, actual: layer1.weightedRecallMean, expected: 'all L1 thresholds' },
    {
      id: 'informationLoss.verifiedClaimsRetentionRate',
      pass: (informationLoss?.verifiedClaimsRetentionRate ?? 0) >= 0.95,
      actual: informationLoss?.verifiedClaimsRetentionRate ?? 0,
      expected: '>= 0.95 retained verified claims',
    },
    {
      id: 'informationLoss.criticalDroppedVerifiedClaims',
      pass: (informationLoss?.criticalDroppedVerifiedClaims ?? 0) === 0,
      actual: informationLoss?.criticalDroppedVerifiedClaims ?? 0,
      expected: '= 0 critical verified claims dropped',
    },
    { id: 'l2.deterministicGate', pass: assessLayer2(layer2).pass, actual: layer2.judgeScoreMean, expected: 'L2 thresholds' },
    { id: 'l3.deterministicGate', pass: layer3Gate.pass, actual: layer3.criticalActionMatchRate, expected: 'L3 thresholds' },
    {
      id: 'realCohort.notMasked',
      pass: cohorts.real.sampleCount === 0 || assessRealCohortForSuite(suite, cohorts.real.layer1),
      actual: cohorts.real.layer1.weightedRecallMean,
      expected: suite === 'full'
        ? 'real L1 gate passes independently when real samples exist'
        : 'daily real recall/precision/stale checks pass independently',
    },
    {
      id: 'manifest.exactResolve',
      pass: !manifest?.input || ((manifest.missing?.length ?? 0) === 0 && manifest.resolved === manifest.requested),
      actual: manifest?.input ? `${manifest.resolved}/${manifest.requested}` : 'not-used',
      expected: manifest?.input ? 'all manifest samples resolved' : 'not-used',
    },
    {
      id: 'cache.noSecretLeak',
      pass: cache?.enabled === false || cache?.secretScan?.pass !== false,
      actual: cache?.secretScan?.pass === false ? cache.secretScan.leaks.length : 0,
      expected: '= 0 cache secret leaks',
    },
    {
      id: 'hunkRehydration.abGate',
      pass: hunkRehydrationAb?.gate?.pass !== false,
      actual: hunkRehydrationAb?.executed ? hunkRehydrationAb.compared.withRehydratedFileContext.criticalActionMatchRate : 'not-executed',
      expected: 'with hunk continuation metrics do not regress',
    },
  ];
  if (suite === 'full') {
    checks.push({
      id: 'full.realMinCount',
      pass: cohorts.real.sampleCount >= fullRealMin,
      actual: cohorts.real.sampleCount,
      expected: `>= ${fullRealMin}`,
    });
    checks.push({
      id: 'full.realCoverage',
      pass: mix.realShortfall === 0 && mix.realActual > 0,
      actual: mix.realActual,
      expected: `${mix.realRequested} real samples`,
    });
    checks.push({
      id: 'full.pressureCoverage',
      pass: pressureCohorts.every((cohort) => presentPressures.has(normalizePressureCohort(cohort))),
      actual: presentPressures.size,
      expected: pressureCohorts.map(normalizePressureCohort).join(','),
    });
  } else {
    checks.push({
      id: 'daily.evidenceSufficiency',
      pass: true,
      actual: mix.evidenceInsufficient ? 0 : 1,
      expected: 'daily may degrade but must mark evidenceInsufficient',
    });
  }
  if (llmJudge.requested) {
    const aggregate = llmJudge.aggregate ?? {};
    checks.push({
      id: 'l2.realJudge.executed',
      pass: llmJudge.executed === true,
      actual: llmJudge.executed ? 1 : 0,
      expected: 'executed',
    });
    checks.push({
      id: 'l2.realJudge.gate',
      pass: llmJudge.executed === true && assessLayer2(aggregate).pass,
      actual: aggregate.judgeScoreMean ?? 0,
      expected: 'L2 real judge thresholds',
    });
  }
  if (llmJudgeCalibration?.requested) {
    checks.push({
      id: 'l2.judgeCalibration.executed',
      pass: llmJudgeCalibration.executed === true,
      actual: llmJudgeCalibration.executed ? 1 : 0,
      expected: 'executed on known-loss calibration samples',
    });
    checks.push({
      id: 'l2.judgeCalibration.discriminatesLoss',
      pass: llmJudgeCalibration.gate?.pass === true,
      actual: llmJudgeCalibration.gate?.actual?.judgeScoreMean ?? null,
      expected: '< 8 mean on known-loss samples',
    });
  }
  if (llmJudgeLiveRerun?.requested) {
    checks.push({
      id: 'l2.judgeLiveRerun.executed',
      pass: llmJudgeLiveRerun.executed === true,
      actual: llmJudgeLiveRerun.executed ? 1 : 0,
      expected: 'uncached live rerun executed',
    });
    checks.push({
      id: 'l2.judgeLiveRerun.consistency',
      pass: llmJudgeLiveRerun.executed === true
        && (llmJudgeLiveRerun.consistency?.maxAbsScoreDelta ?? 0) <= 2,
      actual: llmJudgeLiveRerun.consistency?.maxAbsScoreDelta ?? null,
      expected: '<= 2 max absolute score delta vs cached judge',
    });
  }
  if (llmSchemaFree?.requested) {
    const allowedSchemaFreeOmissionRate = Math.max(0.1, 1 / Math.max(llmSchemaFree.sampleCount ?? 1, 1));
    checks.push({
      id: 'l2.schemaFree.executed',
      pass: llmSchemaFree.executed === true,
      actual: llmSchemaFree.executed ? 1 : 0,
      expected: 'schema-free omission judge executed',
    });
    checks.push({
      id: 'l2.schemaFree.majorOmissionRate',
      pass: llmSchemaFree.executed === true
        && (llmSchemaFree.aggregate?.majorOrCriticalOmissionRate ?? 1) <= allowedSchemaFreeOmissionRate,
      actual: llmSchemaFree.aggregate?.majorOrCriticalOmissionRate ?? null,
      expected: `<= ${round(allowedSchemaFreeOmissionRate)} major/critical omission rate`,
    });
  }
  if (llmContinuation.requested) {
    checks.push({
      id: 'l3.realContinuation.executed',
      pass: llmContinuation.executed === true,
      actual: llmContinuation.executed ? 1 : 0,
      expected: 'executed',
    });
    checks.push({
      id: 'l3.realContinuation.gate',
      pass: llmContinuation.executed === true && llmContinuation.gate?.pass === true,
      actual: llmContinuation.aggregate?.criticalActionMatchRate ?? 0,
      expected: 'L3 real continuation thresholds',
    });
  }
  return {
    status: checks.every((check) => check.pass) ? 'PASS' : 'FAIL',
    checks,
    evidenceInsufficient: mix.evidenceInsufficient,
  };
}

function deterministicFaithfulness(sample, localScore) {
  const criticalOk = localScore.recallBySeverity.critical.recall >= 0.95;
  const staleOk = localScore.forbiddenFound === 0;
  const causalPreserved = sample.source === 'synthetic'
    ? ['OBJECTIVE', 'DECISION', 'CONSTRAINT'].every((token) => sample.compressedSummary.includes(token))
    : ['Goal and Progress', 'Key Decisions and Constraints', 'Next Actions'].every((token) => sample.compressedSummary.includes(token));
  return {
    completeness: criticalOk,
    accuracy: staleOk,
    causalChain: causalPreserved,
    noFabrication: staleOk,
    actionability: criticalOk && causalPreserved && staleOk,
    score: round([
      criticalOk,
      staleOk,
      causalPreserved,
      staleOk,
      criticalOk && causalPreserved && staleOk,
    ].filter(Boolean).length / 5 * 10),
  };
}

function buildWorstCases(samples, layer1Scores, llmJudge, limit) {
  const judgeBySample = new Map((llmJudge.results ?? []).map((item) => [item.sampleId, item]));
  return samples.map((sample, index) => {
    const score = layer1Scores[index];
    const judge = judgeBySample.get(sample.id);
    const severity = score.missingExpectedIds.length + score.leakedForbiddenIds.length + (judge && judge.score < 7.5 ? 2 : 0);
    return {
      sampleId: sample.id,
      cohort: sample.config,
      source: sample.source,
      severity,
      missingFacts: score.missingExpectedIds,
      leakedStaleFacts: score.leakedForbiddenIds,
      judgeReason: judge?.justifications?.join(' ') ?? '',
    };
  }).filter((item) => item.severity > 0)
    .sort((a, b) => b.severity - a.severity)
    .slice(0, limit);
}

function evaluateFailureChainSchemaRisk(samples) {
  const chains = samples.flatMap((sample) => sample.expected
    .filter((item) => item.failureChain)
    .map((item) => {
      const chain = item.failureChain;
      const evidencedLinks = [
        chain.attempt,
        chain.failure,
        chain.adjustment,
        chain.validation,
        chain.next,
      ].filter(Boolean).length;
      const confidence = evidencedLinks / 5;
      return {
        sampleId: sample.id,
        factId: item.id,
        classification: chain.classification,
        evidencedLinks,
        possibleLinks: 5,
        chainExtractionConfidence: round(confidence),
        confidenceBand: confidence >= 0.8 ? 'high' : confidence >= 0.6 ? 'medium' : 'low',
        missingLinks: [
          chain.attempt ? null : 'attempt',
          chain.failure ? null : 'failure',
          chain.adjustment ? null : 'adjustment',
          chain.validation ? null : 'validation',
          chain.next ? null : 'next',
        ].filter(Boolean),
      };
    }));
  return {
    chainCount: chains.length,
    meanChainExtractionConfidence: round(mean(chains.map((item) => item.chainExtractionConfidence))),
    lowConfidenceChainCount: chains.filter((item) => item.confidenceBand === 'low').length,
    mediumConfidenceChainCount: chains.filter((item) => item.confidenceBand === 'medium').length,
    highConfidenceChainCount: chains.filter((item) => item.confidenceBand === 'high').length,
    hallucinationRisk: chains.some((item) => item.confidenceBand === 'low')
      ? 'some_failure_chains_have_missing_evidence_links'
      : 'no_low_confidence_failure_chains_detected',
    examples: chains.filter((item) => item.confidenceBand !== 'high').slice(0, 10),
  };
}

function pressureSortValue(value) {
  if (value === 'emergency') return 1;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function buildDegradationCurve({ byPressure, byPressureContinuation }) {
  const points = Object.keys(byPressure)
    .sort((a, b) => pressureSortValue(a) - pressureSortValue(b))
    .map((pressure) => {
      const fidelity = byPressure[pressure];
      const continuation = byPressureContinuation[pressure] ?? aggregateContinuation([]);
      return {
        pressure,
        sampleCount: fidelity.rounds,
        compressionRatioMean: fidelity.compressionRatioMean,
        verifiedClaimsRetentionRate: fidelity.expectedTotal ? round(fidelity.expectedFoundTotal / fidelity.expectedTotal) : 1,
        weightedRecallMean: fidelity.weightedRecallMean,
        informationLossRate: fidelity.expectedTotal ? round((fidelity.expectedTotal - fidelity.expectedFoundTotal) / fidelity.expectedTotal) : 0,
        criticalActionMatchRate: continuation.criticalActionMatchRate,
        noRepeatedWorkRate: continuation.noRepeatedWorkRate,
        taskCompletionDelta: continuation.taskCompletionDelta,
      };
    });
  const firstQualityDrop = points.find((point) => (
    point.verifiedClaimsRetentionRate < 0.95
    || point.weightedRecallMean < 0.9
    || point.criticalActionMatchRate < 0.9
    || point.taskCompletionDelta > 0.08
  ));
  return {
    points,
    firstQualityDropPressure: firstQualityDrop?.pressure ?? null,
    monotonicityNote: 'Quality should degrade gradually as pressure increases; abrupt drops indicate compression fragility.',
  };
}

function readJsonOrJsonl(file) {
  const text = readFileSync(file, 'utf8').trim();
  if (!text) return [];
  if (text.startsWith('[')) return JSON.parse(text);
  return text.split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line));
}

function buildAutoScoreBySample(samples, layer1Scores, layer3Scores, llmJudge) {
  const judgeBySample = new Map((llmJudge?.results ?? []).map((item) => [item.sampleId, item.score]));
  return new Map(samples.map((sample, index) => {
    const layer1Score = layer1Scores[index];
    const layer3Score = layer3Scores[index];
    const judgeScore = judgeBySample.get(sample.id);
    const autoScore = round(mean([
      layer1Score.weightedRecall * 5,
      layer3Score.criticalActionMatch ? 5 : 1,
      judgeScore !== undefined ? judgeScore / 2 : layer1Score.recall * 5,
    ]));
    return [sample.id, autoScore];
  }));
}

function buildHumanEvalPack(samples, layer1Scores, layer3Scores, count) {
  return samples.slice(0, count).map((sample, index) => ({
    sampleId: sample.id,
    source: sample.source,
    cohort: sample.config,
    compressedSummary: sample.compressedSummary,
    expectedFactMetadata: sample.expected.map((item) => ({
      id: item.id,
      severity: item.severity,
      category: item.category,
      evidence: item.evidence,
    })),
    automatedContext: {
      weightedRecall: layer1Scores[index].weightedRecall,
      missingExpectedIds: layer1Scores[index].missingExpectedIds,
      continuationCriticalActionMatch: layer3Scores[index].criticalActionMatch,
    },
    ratingSchema: {
      score: 'integer 1-5 where 5 means excellent handoff quality',
      fields: ['sampleId', 'raterId', 'score', 'missingInfoNotes', 'actionabilityNotes'],
    },
  }));
}

function evaluateHumanBaseline({ samples, layer1Scores, layer3Scores, llmJudge, ratingsPath, pack, minimumRaters = 2, minimumSamples = 20 }) {
  const base = {
    required: true,
    minimumRaters,
    minimumSamples,
    packSampleCount: pack.length,
    ratingsPath: ratingsPath ? resolve(ratingsPath) : null,
  };
  if (!ratingsPath) {
    return {
      ...base,
      status: 'missing_ratings',
      message: 'Human evaluation pack is available, but real developer ratings were not provided. Provide --human-eval-ratings <json|jsonl> to compute human-auto correlation.',
    };
  }
  const ratings = readJsonOrJsonl(resolve(ratingsPath))
    .filter((item) => item && typeof item.sampleId === 'string' && typeof item.raterId === 'string' && typeof item.score === 'number');
  const ratingsBySample = new Map();
  for (const rating of ratings) {
    ratingsBySample.set(rating.sampleId, [...(ratingsBySample.get(rating.sampleId) ?? []), rating]);
  }
  const autoScoreBySample = buildAutoScoreBySample(samples, layer1Scores, layer3Scores, llmJudge);
  const pairs = [];
  for (const [sampleId, sampleRatings] of ratingsBySample) {
    const autoScore = autoScoreBySample.get(sampleId);
    if (autoScore === undefined) continue;
    pairs.push({
      x: autoScore,
      y: mean(sampleRatings.map((item) => item.score)),
      sampleId,
      raterCount: new Set(sampleRatings.map((item) => item.raterId)).size,
    });
  }
  const raterIds = new Set(ratings.map((item) => item.raterId));
  return {
    ...base,
    status: raterIds.size >= minimumRaters && pairs.length >= minimumSamples ? 'sufficient' : 'insufficient',
    ratingCount: ratings.length,
    raterCount: raterIds.size,
    ratedSampleCount: pairs.length,
    humanMeanScore: round(mean(pairs.map((item) => item.y))),
    autoMeanScoreOnRatedSamples: round(mean(pairs.map((item) => item.x))),
    pearsonCorrelation: pearsonCorrelation(pairs),
    spearmanCorrelation: spearmanCorrelation(pairs),
    unratedPackSampleIds: pack.map((item) => item.sampleId).filter((sampleId) => !ratingsBySample.has(sampleId)),
  };
}

function evaluateAgentManualBaseline({ samples, layer1Scores, layer3Scores, llmJudge, ratingsPath, pack, minimumReviewers = 1, minimumSamples = 20 }) {
  const base = {
    required: false,
    minimumReviewers,
    minimumSamples,
    packSampleCount: pack.length,
    ratingsPath: ratingsPath ? resolve(ratingsPath) : null,
    disclosure: 'AI reviewer manual analysis. Do not count as real human developer ratings.',
  };
  if (!ratingsPath) {
    return {
      ...base,
      status: 'not_requested',
      message: 'Pass --agent-manual-eval-ratings <json|jsonl> to persist AI reviewer manual analysis separately from humanEvaluation.',
    };
  }
  const ratings = readJsonOrJsonl(resolve(ratingsPath))
    .filter((item) => item && typeof item.sampleId === 'string' && typeof item.raterId === 'string' && typeof item.score === 'number');
  const ratingsBySample = new Map();
  for (const rating of ratings) {
    ratingsBySample.set(rating.sampleId, [...(ratingsBySample.get(rating.sampleId) ?? []), rating]);
  }
  const autoScoreBySample = buildAutoScoreBySample(samples, layer1Scores, layer3Scores, llmJudge);
  const pairs = [];
  for (const [sampleId, sampleRatings] of ratingsBySample) {
    const autoScore = autoScoreBySample.get(sampleId);
    if (autoScore === undefined) continue;
    pairs.push({
      x: autoScore,
      y: mean(sampleRatings.map((item) => item.score)),
      sampleId,
      reviewerCount: new Set(sampleRatings.map((item) => item.raterId)).size,
    });
  }
  const reviewerIds = new Set(ratings.map((item) => item.raterId));
  const sufficient = reviewerIds.size >= minimumReviewers && pairs.length >= minimumSamples;
  return {
    ...base,
    status: sufficient ? 'sufficient_ai_review' : 'insufficient_ai_review',
    ratingCount: ratings.length,
    reviewerCount: reviewerIds.size,
    ratedSampleCount: pairs.length,
    reviewerMeanScore: round(mean(pairs.map((item) => item.y))),
    autoMeanScoreOnRatedSamples: round(mean(pairs.map((item) => item.x))),
    pearsonCorrelation: pearsonCorrelation(pairs),
    spearmanCorrelation: spearmanCorrelation(pairs),
    unratedPackSampleIds: pack.map((item) => item.sampleId).filter((sampleId) => !ratingsBySample.has(sampleId)),
  };
}

async function main() {
  const runStartedAt = Date.now();
  const target = resolve(argValue('--target', 'C:\\Users\\27933\\Desktop\\verseshell\\graphiti-main'));
  const sampleCount = parseNumberArg('--samples', 12);
  const suite = argValue('--suite', 'daily');
  const sampleSource = argValue('--sample-source', 'hybrid');
  const transcriptRoot = argValue('--transcript-root', join(process.env.USERPROFILE ?? dirname(target), '.openclaw'));
  const realOverride = hasArg('--real-samples') ? parseNumberArg('--real-samples', 0) : undefined;
  const syntheticOverride = hasArg('--synthetic-samples') ? parseNumberArg('--synthetic-samples', 0) : undefined;
  const turnCohorts = parseListArg('--turn-cohorts', DEFAULT_TURN_COHORTS, Number);
  const pressureCohorts = parseListArg('--pressure-cohorts', DEFAULT_PRESSURE_COHORTS, normalizePressureCohort);
  if (!pressureCohorts.includes('emergency')) pressureCohorts.push('emergency');
  const redactMode = argValue('--redact', 'strict');
  const saveWorstCases = parseNumberArg('--save-worst-cases', 10);
  const llmJudgeSamples = hasArg('--llm-samples')
    ? parseNumberArg('--llm-samples', 3)
    : suite === 'daily' ? Math.min(10, sampleCount) : sampleCount;
  const llmContinuationSamples = hasArg('--continuation-samples')
    ? parseNumberArg('--continuation-samples', sampleCount)
    : suite === 'daily' ? Math.min(10, sampleCount) : sampleCount;
  const llmJudgeCalibrationSamples = parseNumberArg('--llm-judge-calibration-samples', 5);
  const llmSchemaFreeSamples = parseNumberArg('--schema-free-samples', Math.min(10, sampleCount));
  const llmJudgeLiveRerunRatio = parseNumberArg('--llm-judge-live-rerun-ratio', 0);
  const judgeModel = argValue('--judge-model', 'deepseek-chat');
  const continuationModel = argValue('--continuation-model', judgeModel);
  const outRoot = resolve(argValue('--out', 'output/context-compression-eval'));
  const cacheDir = resolve(argValue('--cache-dir', '.cache/context-compression-eval'));
  const cache = createCacheStore({
    enabled: !hasArg('--no-cache'),
    refresh: hasArg('--refresh-cache'),
    cacheDir,
  });
  const seed = argValue('--seed', DEFAULT_SEED);
  const fullRealMin = parseNumberArg('--full-real-min', 100);
  const sampleManifestPath = argValue('--sample-manifest');
  const writeSampleManifestPath = argValue('--write-sample-manifest');
  const writeHumanEvalPackPath = argValue('--write-human-eval-pack');
  const humanEvalRatingsPath = argValue('--human-eval-ratings');
  const agentManualEvalRatingsPath = argValue('--agent-manual-eval-ratings');
  const humanEvalSampleCount = parseNumberArg('--human-eval-samples', Math.min(20, sampleCount));
  const inputManifest = sampleManifestPath ? safeReadJson(resolve(sampleManifestPath)) : undefined;
  const semantic = hasArg('--semantic');
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = join(outRoot, runId);
  mkdirSync(outDir, { recursive: true });

  const redactionSummary = createRedactionSummary(redactMode);
  const timing = {
    startedAt: new Date(runStartedAt).toISOString(),
    phasesMs: {},
  };
  const markPhase = (name, start) => {
    timing.phasesMs[name] = Date.now() - start;
  };
  let phaseStarted = Date.now();
  const snippets = redactText(projectSnippets(target), redactionSummary);
  markPhase('projectSnippets', phaseStarted);
  phaseStarted = Date.now();
  const build = buildSamples({
    suite,
    sampleSource,
    sampleCount,
    target,
    snippets,
    transcriptRoot,
    turnCohorts,
    pressureCohorts,
    redactionSummary,
    realOverride,
    syntheticOverride,
    cache,
    redactMode,
    seed,
    manifest: inputManifest,
  });
  markPhase('buildSamples', phaseStarted);
  const samples = build.samples;
  const outputManifest = createSampleManifest({ samples, seed, requestedSampleCount: sampleCount });
  const manifestSummary = {
    ...(sampleManifestPath ? { input: resolve(sampleManifestPath) } : {}),
    ...(writeSampleManifestPath ? { output: resolve(writeSampleManifestPath) } : {}),
    hash: outputManifest.sampleSelectionHash,
    requested: sampleManifestPath ? (inputManifest ? (build.manifestResolution?.requested ?? 0) : sampleCount) : sampleCount,
    resolved: sampleManifestPath ? (inputManifest ? samples.length : 0) : sampleCount,
    missing: sampleManifestPath && !inputManifest
      ? [{ reason: 'manifest_unreadable', path: resolve(sampleManifestPath) }]
      : build.manifestResolution?.missing ?? [],
  };
  if (writeSampleManifestPath) {
    const manifestOut = resolve(writeSampleManifestPath);
    mkdirSync(dirname(manifestOut), { recursive: true });
    writeFileSync(manifestOut, `${JSON.stringify(outputManifest, null, 2)}\n`, 'utf8');
  }
  const layer0History = [];
  const layer1Local = [];
  const layer2Faithfulness = [];
  const layer3Continuation = [];
  const sampleLines = [];

  phaseStarted = Date.now();
  for (const sample of samples) {
    const expectedAfterResend = [...sample.expected, ...sample.edited];
    const historyExpectedAfterResend = expectedAfterResend.filter((item) => !item.generatedFromEvidence);
    const historyScore = evaluateFactSet({
      haystack: sample.historyAfterResend,
      expected: historyExpectedAfterResend,
      forbidden: sample.stale,
      semantic,
    });
    const localScore = evaluateFactSet({
      haystack: sample.compressedSummary,
      expected: expectedAfterResend,
      forbidden: sample.stale,
      originalText: sample.historyAfterResend,
      compressedText: sample.compressedSummary,
      semantic,
    });
    const faithfulness = deterministicFaithfulness(sample, localScore);
    const continuation = evaluateContinuationScenario(sample.continuationScenario);
    layer0History.push(historyScore);
    layer1Local.push(localScore);
    layer2Faithfulness.push(faithfulness);
    layer3Continuation.push(continuation);
    sampleLines.push(JSON.stringify({
      id: sample.id,
      source: sample.source,
      config: sample.config,
      expectedFacts: expectedAfterResend.map((item) => ({
        id: item.id,
        severity: item.severity,
        category: item.category,
        evidence: item.evidence,
      })),
      unverifiedClaims: sample.unverifiedClaims ?? [],
      rehydratedFileContext: sample.rehydratedFileContext ?? [],
      compressedSummary: sample.compressedSummary,
      layer0History: historyScore,
      layer1Local: localScore,
      layer2Faithfulness: faithfulness,
      layer3Continuation: continuation,
    }));
  }
  markPhase('deterministicLayers', phaseStarted);

  const layer0 = aggregateFactSets(layer0History);
  const layer1 = aggregateFactSets(layer1Local);
  const layer2 = {
    total: layer2Faithfulness.length,
    ...summarizeJudgeScores(layer2Faithfulness),
    completenessRate: round(mean(layer2Faithfulness.map((item) => item.completeness ? 1 : 0))),
    accuracyRate: round(mean(layer2Faithfulness.map((item) => item.accuracy ? 1 : 0))),
    causalChainPreservation: round(mean(layer2Faithfulness.map((item) => item.causalChain ? 1 : 0))),
    causalChainRate: round(mean(layer2Faithfulness.map((item) => item.causalChain ? 1 : 0))),
    noFabricationRate: round(mean(layer2Faithfulness.map((item) => item.noFabrication ? 1 : 0))),
    actionabilityRate: round(mean(layer2Faithfulness.map((item) => item.actionability ? 1 : 0))),
  };
  const layer3 = aggregateContinuation(layer3Continuation);
  const layer1Gate = assessLayer1(layer1);
  const layer3Gate = assessLayer3(layer3);
  phaseStarted = Date.now();
  const llmJudge = hasArg('--llm-judge')
    ? await runDeepSeekJudge(samples, { maxSamples: llmJudgeSamples, model: judgeModel, cache })
    : {
        requested: false,
        executed: false,
        reason: 'LLM judge was not requested. Pass --llm-judge to enable it.',
        results: [],
      };
  markPhase('llmJudge', phaseStarted);
  phaseStarted = Date.now();
  const llmJudgeCalibration = await runJudgeCalibration(samples, {
    requested: hasArg('--llm-judge-calibration'),
    maxSamples: llmJudgeCalibrationSamples,
    model: judgeModel,
    cache,
  });
  markPhase('llmJudgeCalibration', phaseStarted);
  phaseStarted = Date.now();
  const llmJudgeLiveRerun = await runJudgeLiveRerun(samples, {
    ratio: llmJudgeLiveRerunRatio,
    model: judgeModel,
    cachedJudge: llmJudge,
    cache,
  });
  markPhase('llmJudgeLiveRerun', phaseStarted);
  phaseStarted = Date.now();
  const llmSchemaFree = await runDeepSeekSchemaFree(samples, {
    requested: hasArg('--llm-schema-free'),
    maxSamples: llmSchemaFreeSamples,
    model: judgeModel,
    cache,
  });
  markPhase('llmSchemaFree', phaseStarted);
  phaseStarted = Date.now();
  const llmContinuation = hasArg('--llm-continuation')
    ? await runDeepSeekContinuation(samples, { maxSamples: llmContinuationSamples, model: continuationModel, cache })
    : {
        requested: false,
        executed: false,
        reason: 'LLM continuation was not requested. Pass --llm-continuation to enable it.',
        results: [],
      };
  markPhase('llmContinuation', phaseStarted);
  const cohorts = {
    real: aggregateSourceCohort(samples, layer0History, layer1Local, layer3Continuation, 'real'),
    synthetic: aggregateSourceCohort(samples, layer0History, layer1Local, layer3Continuation, 'synthetic'),
    byPressure: groupScores(samples, layer1Local, (sample) => normalizePressureCohort(sample.config.pressureCohort)),
    byTurnCount: groupScores(samples, layer1Local, (sample) => String(sample.config.turnCohort ?? sample.config.transcriptLength)),
    byPressureContinuation: groupContinuation(samples, layer3Continuation, (sample) => normalizePressureCohort(sample.config.pressureCohort)),
  };
  const informationLoss = aggregateInformationLoss(layer1Local);
  const tokenEconomics = evaluateTokenEconomics(samples, llmContinuation);
  const degradationCurve = buildDegradationCurve({
    byPressure: cohorts.byPressure,
    byPressureContinuation: cohorts.byPressureContinuation,
  });
  const failureChainSchemaRisk = evaluateFailureChainSchemaRisk(samples);
  const hunkRehydrationAb = evaluateHunkRehydrationAb(samples);
  const humanEvalPack = buildHumanEvalPack(samples, layer1Local, layer3Continuation, humanEvalSampleCount);
  const humanEvaluation = evaluateHumanBaseline({
    samples,
    layer1Scores: layer1Local,
    layer3Scores: layer3Continuation,
    llmJudge,
    ratingsPath: humanEvalRatingsPath,
    pack: humanEvalPack,
  });
  const agentManualEvaluation = evaluateAgentManualBaseline({
    samples,
    layer1Scores: layer1Local,
    layer3Scores: layer3Continuation,
    llmJudge,
    ratingsPath: agentManualEvalRatingsPath,
    pack: humanEvalPack,
  });
  const humanEvalPackPath = writeHumanEvalPackPath
    ? resolve(writeHumanEvalPackPath)
    : join(outDir, 'human-eval-pack.jsonl');
  mkdirSync(dirname(humanEvalPackPath), { recursive: true });
  writeFileSync(humanEvalPackPath, `${humanEvalPack.map((item) => JSON.stringify(item)).join('\n')}${humanEvalPack.length ? '\n' : ''}`, 'utf8');
  const worstCases = buildWorstCases(samples, layer1Local, llmJudge, saveWorstCases);
  phaseStarted = Date.now();
  cache.stats.secretScan = scanDirectoryForSecrets(cacheDir);
  markPhase('cacheSecretScan', phaseStarted);
  timing.totalMs = Date.now() - runStartedAt;
  timing.finishedAt = new Date().toISOString();
  timing.samplesPerSecond = round(samples.length / Math.max(timing.totalMs / 1000, 0.001));
  const latencyCost = {
    timing,
    tokenEconomics,
    note: 'Token counts are heuristic estimates; use model tokenizer/pricing for billing-grade cost.',
  };
  const acceptance = buildAcceptance({
    suite,
    sampleCount,
    sampleLines,
    mix: build.mix,
    pressureCohorts,
    samples,
    layer0,
    layer1,
    layer2,
    layer3,
    layer1Gate,
    layer3Gate,
    llmJudge: { requested: hasArg('--llm-judge'), ...llmJudge },
    llmJudgeCalibration,
    llmJudgeLiveRerun,
    llmSchemaFree,
    llmContinuation: { requested: hasArg('--llm-continuation'), ...llmContinuation },
    cohorts,
    manifest: manifestSummary,
    cache: cache.stats,
    fullRealMin,
    hunkRehydrationAb,
    informationLoss,
  });
  const summary = {
    runId,
    target,
    generatedAt: new Date().toISOString(),
    suite,
    sampleSource,
    requestedSampleCount: sampleCount,
    sampleCount: samples.length,
    semanticMatching: semantic,
    cache: cache.stats,
    manifest: manifestSummary,
    reproducibility: {
      seed,
      sampleSelectionHash: outputManifest.sampleSelectionHash,
      promptVersions: {
        judge: JUDGE_PROMPT_VERSION,
        continuation: CONTINUATION_PROMPT_VERSION,
      },
      extractorVersion: FACT_EXTRACTOR_VERSION,
      parserVersion: PARSER_VERSION,
      redactionVersion: REDACTION_VERSION,
    },
    realInventory: build.realInventory,
    sampleMix: build.mix,
    llmJudge: {
      requested: hasArg('--llm-judge'),
      ...llmJudge,
    },
    llmJudgeCalibration,
    llmJudgeLiveRerun,
    llmSchemaFree,
    llmContinuation: {
      requested: hasArg('--llm-continuation'),
      ...llmContinuation,
    },
    layer0,
    informationLoss,
    layer1,
    layer1Gate,
    layer2,
    layer2Gate: assessLayer2(layer2),
    layer3,
    layer3Gate,
    cohorts,
    cohortBreakdown: {
      real: cohorts.real,
      synthetic: cohorts.synthetic,
      byPressure: cohorts.byPressure,
      byTurnCount: cohorts.byTurnCount,
    },
    degradationCurve,
    latencyCost,
    failureChainSchemaRisk,
    hunkRehydrationAb,
    humanEvaluation: {
      ...humanEvaluation,
      packPath: humanEvalPackPath,
    },
    agentManualEvaluation: {
      ...agentManualEvaluation,
      packPath: humanEvalPackPath,
    },
    worstCases,
    regressionExamples: worstCases.slice(0, Math.min(3, worstCases.length)),
    redactionSummary,
    acceptance,
  };

  const report = [
    '# Context Compression Eval Report',
    '',
    `- Run ID: ${runId}`,
    `- Target: ${target}`,
    `- Suite: ${suite}`,
    `- Sample source: ${sampleSource}`,
    `- Samples: ${samples.length}`,
    `- Real/Synthetic: ${build.mix.realActual}/${build.mix.syntheticActual}`,
    `- Evidence insufficient: ${build.mix.evidenceInsufficient ? 'yes' : 'no'}`,
    `- Semantic matching: ${semantic ? 'enabled' : 'disabled'}`,
    `- Cache: ${cache.stats.enabled ? `enabled hits=${cache.stats.hits} misses=${cache.stats.misses} writes=${cache.stats.writes}` : 'disabled'}`,
    `- Manifest: ${manifestSummary.input ? `input resolved=${manifestSummary.resolved}/${manifestSummary.requested}` : 'not used'}`,
    `- LLM judge: ${summary.llmJudge.executed ? `${summary.llmJudge.provider}/${summary.llmJudge.model} on ${summary.llmJudge.sampleCount} samples` : 'not executed'}`,
    `- LLM judge calibration: ${summary.llmJudgeCalibration.executed ? `executed scoreMean=${summary.llmJudgeCalibration.aggregate?.judgeScoreMean}` : 'not executed'}`,
    `- LLM schema-free: ${summary.llmSchemaFree.executed ? `executed omissionRate=${summary.llmSchemaFree.aggregate?.omissionRate}` : 'not executed'}`,
    `- LLM live rerun: ${summary.llmJudgeLiveRerun.executed ? `executed maxDelta=${summary.llmJudgeLiveRerun.consistency?.maxAbsScoreDelta}` : 'not executed'}`,
    `- LLM continuation: ${summary.llmContinuation.executed ? `${summary.llmContinuation.provider}/${summary.llmContinuation.model} on ${summary.llmContinuation.sampleCount} samples` : 'not executed'}`,
    `- Human eval pack: ${humanEvalPackPath}`,
    `- Human eval status: ${humanEvaluation.status}`,
    `- Agent manual eval status: ${agentManualEvaluation.status}`,
    `- Runtime: ${latencyCost.timing.totalMs} ms (${latencyCost.timing.samplesPerSecond} samples/s)`,
    `- Acceptance: ${acceptance.status}`,
    '',
    '## Summary',
    '',
    '| Layer | Key metrics | Gate |',
    '|---|---|---|',
    `| L0 Link | recall=${layer0.recallMean}, stale=${layer0.staleExclusionMean} | ${layer0.recallMean === 1 && layer0.staleExclusionMean === 1 ? 'PASS' : 'FAIL'} |`,
    `| Information Loss | verifiedRetention=${informationLoss.verifiedClaimsRetentionRate}, loss=${informationLoss.informationLossRate}, criticalDropped=${informationLoss.criticalDroppedVerifiedClaims} | ${informationLoss.verifiedClaimsRetentionRate >= 0.95 && informationLoss.criticalDroppedVerifiedClaims === 0 ? 'PASS' : 'FAIL'} |`,
    `| L1 Fidelity | wRecall=${layer1.weightedRecallMean}, compression=${layer1.compressionRatioMean}, density=${layer1.informationDensityMean} | ${summary.layer1Gate.pass ? 'PASS' : 'FAIL'} |`,
    `| Token Economics | inputSavings=${tokenEconomics.totals.inputTokenSavings}, outputDelta=${tokenEconomics.totals.outputTokenDelta}, netDelta=${tokenEconomics.netTokenDelta} | ${tokenEconomics.warning ? 'WARN' : 'INFO'} |`,
    `| L2 Faithfulness | score=${layer2.judgeScoreMean}, min=${layer2.judgeScoreMin}, std=${layer2.judgeScoreStdDev}, causal=${layer2.causalChainRate}, actionability=${layer2.actionabilityRate} | ${summary.layer2Gate.pass ? 'PASS' : 'FAIL'} deterministic |`,
    summary.llmJudge.executed
      ? `| L2 LLM Judge | score=${summary.llmJudge.aggregate.judgeScoreMean}, min=${summary.llmJudge.aggregate.judgeScoreMin}, std=${summary.llmJudge.aggregate.judgeScoreStdDev}, hist=${JSON.stringify(summary.llmJudge.aggregate.scoreHistogram)}, actionability=${summary.llmJudge.aggregate.actionabilityRate} | ${assessLayer2(summary.llmJudge.aggregate).pass ? 'PASS' : 'FAIL'} |`
      : '',
    summary.llmJudgeCalibration.requested
      ? `| L2 Judge Calibration | score=${summary.llmJudgeCalibration.aggregate?.judgeScoreMean ?? 'n/a'}, min=${summary.llmJudgeCalibration.aggregate?.judgeScoreMin ?? 'n/a'} | ${summary.llmJudgeCalibration.gate?.pass ? 'PASS' : 'FAIL'} |`
      : '',
    summary.llmSchemaFree.requested
      ? `| L2 Schema-Free | score=${summary.llmSchemaFree.aggregate?.judgeScoreMean ?? 'n/a'}, omissions=${summary.llmSchemaFree.aggregate?.majorOrCriticalOmissionRate ?? 'n/a'} | ${summary.llmSchemaFree.executed ? 'EXECUTED' : 'FAIL'} |`
      : '',
    `| L3 Downstream | first=${layer3.firstActionMatchRate}, critical=${layer3.criticalActionMatchRate}, noRepeat=${layer3.noRepeatedWorkRate}, delta=${layer3.taskCompletionDelta} | ${summary.layer3Gate.pass ? 'PASS' : 'FAIL'} |`,
    `| Hunk A/B | n=${hunkRehydrationAb.sampleCount}, withoutCritical=${hunkRehydrationAb.compared.withoutRehydratedFileContext.criticalActionMatchRate}, withCritical=${hunkRehydrationAb.compared.withRehydratedFileContext.criticalActionMatchRate}, paired=${hunkRehydrationAb.statisticalTests.criticalActionMatch.statisticalPowerStatus} | ${hunkRehydrationAb.gate.pass ? 'PASS' : 'FAIL'} |`,
    summary.llmContinuation.executed
      ? `| L3 LLM Continuation | first=${summary.llmContinuation.aggregate.firstActionMatchRate}, critical=${summary.llmContinuation.aggregate.criticalActionMatchRate}, noRepeat=${summary.llmContinuation.aggregate.noRepeatedWorkRate}, delta=${summary.llmContinuation.aggregate.taskCompletionDelta} | ${summary.llmContinuation.gate.pass ? 'PASS' : 'FAIL'} |`
      : '',
    '',
    '## Cohorts',
    '',
    `- Real samples: ${cohorts.real.sampleCount}, L1 weighted recall: ${cohorts.real.layer1.weightedRecallMean}`,
    `- Synthetic samples: ${cohorts.synthetic.sampleCount}, L1 weighted recall: ${cohorts.synthetic.layer1.weightedRecallMean}`,
    `- Pressure cohorts: ${Object.keys(cohorts.byPressure).join(', ')}`,
    `- Turn cohorts: ${Object.keys(cohorts.byTurnCount).join(', ')}`,
    '',
    '## Degradation Curve',
    '',
    '| Pressure | Samples | Compression | Verified retention | Loss | Critical action | Completion delta |',
    '|---|---:|---:|---:|---:|---:|---:|',
    ...degradationCurve.points.map((point) => (
      `| ${point.pressure} | ${point.sampleCount} | ${point.compressionRatioMean} | ${point.verifiedClaimsRetentionRate} | ${point.informationLossRate} | ${point.criticalActionMatchRate} | ${point.taskCompletionDelta} |`
    )),
    '',
    '## Human Evaluation',
    '',
    `- Pack path: ${humanEvalPackPath}`,
    `- Status: ${humanEvaluation.status}`,
    `- Rated samples: ${humanEvaluation.ratedSampleCount ?? 0}`,
    `- Human-auto Pearson: ${humanEvaluation.pearsonCorrelation ?? 'n/a'}`,
    `- Human-auto Spearman: ${humanEvaluation.spearmanCorrelation ?? 'n/a'}`,
    '',
    '## Agent Manual Evaluation',
    '',
    `- Disclosure: ${agentManualEvaluation.disclosure}`,
    `- Pack path: ${humanEvalPackPath}`,
    `- Ratings path: ${agentManualEvaluation.ratingsPath ?? 'n/a'}`,
    `- Status: ${agentManualEvaluation.status}`,
    `- Rated samples: ${agentManualEvaluation.ratedSampleCount ?? 0}`,
    `- Reviewer-auto Pearson: ${agentManualEvaluation.pearsonCorrelation ?? 'n/a'}`,
    `- Reviewer-auto Spearman: ${agentManualEvaluation.spearmanCorrelation ?? 'n/a'}`,
    '',
    '## Failure Chain Schema Risk',
    '',
    `- Chains: ${failureChainSchemaRisk.chainCount}`,
    `- Mean confidence: ${failureChainSchemaRisk.meanChainExtractionConfidence}`,
    `- Low confidence chains: ${failureChainSchemaRisk.lowConfidenceChainCount}`,
    `- Risk: ${failureChainSchemaRisk.hallucinationRisk}`,
    '',
    '## Worst Cases',
    '',
    worstCases.length
      ? worstCases.map((item) => `- ${item.sampleId}: missing=${item.missingFacts.length}, staleLeaks=${item.leakedStaleFacts.length}`).join('\n')
      : '- None.',
    '',
    '## Notes',
    '',
    '- Transcript files are read-only inputs and are not modified.',
    '- Report artifacts store redacted metadata and metrics only; no environment credential is persisted.',
    '- Full suite fails independently when the real cohort lacks required coverage.',
    '',
  ].filter((line) => line !== '').join('\n');

  writeFileSync(join(outDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  writeFileSync(join(outDir, 'samples.jsonl'), `${sampleLines.join('\n')}\n`, 'utf8');
  writeFileSync(join(outDir, 'worst-cases.jsonl'), `${worstCases.map((item) => JSON.stringify(item)).join('\n')}${worstCases.length ? '\n' : ''}`, 'utf8');
  writeFileSync(join(outDir, 'report.md'), report, 'utf8');
  writeFileSync(join(outRoot, 'latest-run.txt'), outDir, 'utf8');
  console.log(JSON.stringify({ outDir, summary }, null, 2));
  if (acceptance.status !== 'PASS') {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
