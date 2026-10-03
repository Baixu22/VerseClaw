/**
 * Shared recovery-ledger extractor for P6-A production-summary regeneration.
 *
 * The extraction rules are intentionally aligned with the P6-A acceptance
 * critical-fact schema: facts are deterministically derived from transcript
 * evidence only, never from a model. No API key is read or written here.
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename } from "node:path";

const FACT_SEVERITIES = ["critical", "important", "nice_to_have"];
const SEVERITY_WEIGHTS = { critical: 3, important: 2, nice_to_have: 1 };

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
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

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function normalConfidenceInterval(values) {
  if (!values.length) return { n: 0, mean: null, lower: null, upper: null, method: 'normal' };
  const avg = mean(values);
  if (values.length === 1) return { n: 1, mean: round(avg), lower: round(clamp01(avg)), upper: round(clamp01(avg)), method: 'single-sample' };
  const variance = mean(values.map((value) => (value - avg) ** 2));
  const se = Math.sqrt(variance / values.length);
  const z = 1.959963984540054;
  return {
    n: values.length,
    mean: round(avg),
    lower: round(clamp01(avg - z * se)),
    upper: round(clamp01(avg + z * se)),
    method: 'normal-95',
  };
}

function wilsonConfidenceInterval(successes, total) {
  if (!total) return { n: 0, mean: null, lower: null, upper: null, method: 'wilson' };
  if (total === 1) {
    return { n: 1, mean: round(successes), lower: round(successes), upper: round(successes), method: 'single-sample' };
  }
  const z = 1.959963984540054;
  const p = successes / total;
  const denominator = 1 + (z * z) / total;
  const center = (p + (z * z) / (2 * total)) / denominator;
  const halfWidth = (z * Math.sqrt((p * (1 - p) + (z * z) / (4 * total)) / total)) / denominator;
  return {
    n: total,
    mean: round(p),
    lower: round(clamp01(center - halfWidth)),
    upper: round(clamp01(center + halfWidth)),
    method: 'wilson-95',
  };
}

function formatConfidenceInterval(interval) {
  if (!interval || interval.n === 0) return 'n=0';
  return `n=${interval.n} mean=${interval.mean} 95% CI [${interval.lower}, ${interval.upper}]`;
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
    judgeScoreConfidenceInterval: normalConfidenceInterval(scores),
    scoreHistogram: scoreHistogram(scores),
    scoreDistributionWarning: scores.length >= 10 && stddev(scores) === 0
      ? 'all_scores_identical_check_judge_calibration_or_sample_difficulty'
      : null,
  };
}

function pearsonCorrelation(pairs) {
}

function emptyAggregate() {
  const emptyInterval = { n: 0, mean: null, lower: null, upper: null, method: 'empty' };
  return {
    rounds: 0,
    recallMean: 1,
    recallMin: 1,
    recallMax: 1,
    precisionMean: 1,
    precisionMin: 1,
    precisionMax: 1,
    f1Mean: 1,
    staleExclusionMean: 1,
    weightedRecallMean: 1,
    recallCriticalMean: 1,
    recallCriticalMin: 1,
    recallImportantMean: 1,
    recallImportantMin: 1,
    recallNiceToHaveMean: 1,
    criticalDroppedSamples: 0,
    criticalDroppedMax: 0,
    importantDroppedSamples: 0,
    staleLeakSamples: 0,
    compressionRatioMean: null,
    informationDensityMean: null,
    forbiddenFoundTotal: 0,
    expectedFoundTotal: 0,
    expectedTotal: 0,
    confidenceIntervals: {
      recall: emptyInterval,
      recallCritical: emptyInterval,
      recallImportant: emptyInterval,
      weightedRecall: emptyInterval,
    },
  };
}

function aggregateFactSets(items) {
  if (!items.length) return emptyAggregate();
  const ratios = items.map((item) => item.compressionRatio).filter((value) => typeof value === 'number');
  const densities = items.map((item) => item.informationDensity).filter((value) => typeof value === 'number');
  const criticalDroppedPerSample = items.map((item) => (
    item.recallBySeverity.critical.total - item.recallBySeverity.critical.found
  ));
  const importantDroppedPerSample = items.map((item) => (
    item.recallBySeverity.important.total - item.recallBySeverity.important.found
  ));
  return {
    rounds: items.length,
    recallMean: round(mean(items.map((item) => item.recall))),
    recallMin: round(Math.min(...items.map((item) => item.recall))),
    recallMax: round(Math.max(...items.map((item) => item.recall))),
    precisionMean: round(mean(items.map((item) => item.precision))),
    precisionMin: round(Math.min(...items.map((item) => item.precision))),
    precisionMax: round(Math.max(...items.map((item) => item.precision))),
    f1Mean: round(mean(items.map((item) => item.f1))),
    staleExclusionMean: round(mean(items.map((item) => item.staleExclusion))),
    weightedRecallMean: round(mean(items.map((item) => item.weightedRecall))),
    recallCriticalMean: round(mean(items.map((item) => item.recallBySeverity.critical.recall))),
    recallCriticalMin: round(Math.min(...items.map((item) => item.recallBySeverity.critical.recall))),
    recallImportantMean: round(mean(items.map((item) => item.recallBySeverity.important.recall))),
    recallImportantMin: round(Math.min(...items.map((item) => item.recallBySeverity.important.recall))),
    recallNiceToHaveMean: round(mean(items.map((item) => item.recallBySeverity.nice_to_have.recall))),
    criticalDroppedSamples: criticalDroppedPerSample.filter((count) => count > 0).length,
    criticalDroppedMax: Math.max(0, ...criticalDroppedPerSample),
    importantDroppedSamples: importantDroppedPerSample.filter((count) => count > 0).length,
    staleLeakSamples: items.filter((item) => item.forbiddenFound > 0).length,
    compressionRatioMean: ratios.length ? round(mean(ratios)) : null,
    informationDensityMean: densities.length ? round(mean(densities)) : null,
    forbiddenFoundTotal: items.reduce((sum, item) => sum + item.forbiddenFound, 0),
    expectedFoundTotal: items.reduce((sum, item) => sum + item.expectedFound, 0),
    expectedTotal: items.reduce((sum, item) => sum + item.expectedTotal, 0),
    confidenceIntervals: {
      recall: normalConfidenceInterval(items.map((item) => item.recall)),
      recallCritical: normalConfidenceInterval(items.map((item) => item.recallBySeverity.critical.recall)),
      recallImportant: normalConfidenceInterval(items.map((item) => item.recallBySeverity.important.recall)),
      weightedRecall: normalConfidenceInterval(items.map((item) => item.weightedRecall)),
    },
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
  const criticalDroppedPerSample = items.map((item) => (
    item.recallBySeverity.critical.total - item.recallBySeverity.critical.found
  ));
  return {
    totalVerifiedClaims: expectedTotal,
    retainedVerifiedClaims: expectedFound,
    droppedVerifiedClaims,
    verifiedClaimsRetentionRate: expectedTotal ? round(expectedFound / expectedTotal) : 1,
    informationLossRate: expectedTotal ? round(droppedVerifiedClaims / expectedTotal) : 0,
    criticalDroppedVerifiedClaims: Math.max(0, criticalTotal - criticalFound),
    samplesWithCriticalDropped: criticalDroppedPerSample.filter((count) => count > 0).length,
    criticalDroppedMaxPerSample: Math.max(0, ...criticalDroppedPerSample),
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

function emptyContinuationAggregate() {
  const emptyInterval = { n: 0, mean: null, lower: null, upper: null, method: 'empty' };
  return {
    total: 0,
    firstActionMatchRate: 1,
    firstActionMatchMin: 1,
    criticalActionMatchRate: 1,
    criticalActionMatchMin: 1,
    noRepeatedWorkRate: 1,
    noRepeatedWorkMin: 1,
    noContradictoryActionRate: 1,
    noContradictoryActionMin: 1,
    contradictoryActionCount: 0,
    decisionConsistencyRate: 1,
    taskCompletionDelta: 0,
    confidenceIntervals: {
      firstActionMatch: emptyInterval,
      criticalActionMatch: emptyInterval,
      noRepeatedWork: emptyInterval,
      noContradictoryAction: emptyInterval,
      taskCompletionDelta: emptyInterval,
    },
  };
}

function aggregateContinuation(items) {
  if (!items.length) return emptyContinuationAggregate();
  const fullCompleted = items.filter((item) => item.completedWithFullContext).length;
  const compressedCompleted = items.filter((item) => item.completedWithCompressedContext).length;
  const firstAction = items.map((item) => item.firstActionMatch ? 1 : 0);
  const criticalAction = items.map((item) => item.criticalActionMatch ? 1 : 0);
  const noRepeated = items.map((item) => item.noRepeatedWork ? 1 : 0);
  const noContradictory = items.map((item) => item.noContradictoryAction ? 1 : 0);
  return {
    total: items.length,
    firstActionMatchRate: round(mean(firstAction)),
    firstActionMatchMin: Math.min(...firstAction),
    criticalActionMatchRate: round(mean(criticalAction)),
    criticalActionMatchMin: Math.min(...criticalAction),
    noRepeatedWorkRate: round(mean(noRepeated)),
    noRepeatedWorkMin: Math.min(...noRepeated),
    noContradictoryActionRate: round(mean(noContradictory)),
    noContradictoryActionMin: Math.min(...noContradictory),
    contradictoryActionCount: noContradictory.filter((value) => value === 0).length,
    decisionConsistencyRate: round(mean(items.map((item) => item.criticalActionMatch && item.noContradictoryAction ? 1 : 0))),
    taskCompletionDelta: round(Math.max(0, fullCompleted / items.length - compressedCompleted / items.length)),
    confidenceIntervals: {
      firstActionMatch: wilsonConfidenceInterval(firstAction.filter((value) => value === 1).length, items.length),
      criticalActionMatch: wilsonConfidenceInterval(criticalAction.filter((value) => value === 1).length, items.length),
      noRepeatedWork: wilsonConfidenceInterval(noRepeated.filter((value) => value === 1).length, items.length),
      noContradictoryAction: wilsonConfidenceInterval(noContradictory.filter((value) => value === 1).length, items.length),
      taskCompletionDelta: normalConfidenceInterval(items.map((item) => (
        (item.completedWithFullContext ? 1 : 0) - (item.completedWithCompressedContext ? 1 : 0)
      ))),
    },
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
  const skippedInputs = [];
  const emptyResult = { files: [], skippedInputs };
  if (!root || !existsSync(root)) {
    skippedInputs.push({ path: '.', reason: 'transcript_root_missing', code: 'ENOENT' });
    return emptyResult;
  }
  const files = [];
  const stack = [root];
  const visitedDirectories = new Set();
  while (stack.length) {
    const current = stack.pop();
    let stat;
    try {
      stat = lstatSync(current);
    } catch (error) {
      skippedInputs.push({
        path: relative(root, current) || basename(current),
        reason: 'unreadable_path',
        code: error?.code ?? 'UNKNOWN',
      });
      continue;
    }
    if (stat.isSymbolicLink()) {
      try {
        stat = statSync(current);
      } catch (error) {
        skippedInputs.push({
          path: relative(root, current) || basename(current),
          reason: 'unreadable_path',
          code: error?.code ?? 'UNKNOWN',
        });
        continue;
      }
    }
    if (stat.isDirectory()) {
      const visitedKey = resolve(current).toLowerCase();
      if (visitedDirectories.has(visitedKey)) continue;
      visitedDirectories.add(visitedKey);
      let children;
      try {
        children = readdirSync(current);
      } catch (error) {
        skippedInputs.push({
          path: relative(root, current) || basename(current),
          reason: 'unreadable_path',
          code: error?.code ?? 'UNKNOWN',
        });
        continue;
      }
      for (const child of children) {
        stack.push(join(current, child));
      }
    } else if (stat.isFile() && current.endsWith('.jsonl')) {
      files.push(current);
    }
  }
  return { files: files.sort(), skippedInputs };
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
  const provider = String(
    parsed.provider
      ?? parsed.data?.provider
      ?? message.provider
      ?? payload?.provider
      ?? payload?.data?.provider
      ?? '',
  ).trim();
  const modelId = String(
    parsed.modelId
      ?? parsed.data?.modelId
      ?? message.model
      ?? message.modelId
      ?? payload?.model
      ?? payload?.modelId
      ?? payload?.data?.modelId
      ?? '',
  ).trim();
  if (kind === 'meta') return null;
  return {
    id: String(parsed.messageId ?? parsed.id ?? payload?.id ?? message.id ?? `${basename(file)}:${lineNumber}`),
    messageId: String(parsed.messageId ?? message.id ?? payload?.id ?? parsed.id ?? `${basename(file)}:${lineNumber}`),
    line: lineNumber,
    file,
    role: String(role),
    kind,
    text,
    ...(provider ? { provider } : {}),
    ...(modelId ? { modelId } : {}),
  };
}

function normalizeProviderCohort(value) {
  const raw = String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9_.-]/gu, '-');
  return raw || 'unknown';
}

function transcriptMetadataFromEntries(rawEntries) {
  const providers = [];
  const modelIds = [];
  const providerModels = [];
  const seenProviderModels = new Set();
  for (const entry of rawEntries ?? []) {
    if (entry?.provider && !providers.includes(entry.provider)) providers.push(entry.provider);
    if (entry?.modelId && !modelIds.includes(entry.modelId)) modelIds.push(entry.modelId);
    if (entry?.provider && entry?.modelId) {
      const providerModel = `${entry.provider}:${entry.modelId}`;
      if (!seenProviderModels.has(providerModel)) {
        seenProviderModels.add(providerModel);
        providerModels.push(providerModel);
      }
    }
  }
  return {
    providerCohort: normalizeProviderCohort(providers[0] ?? 'unknown'),
    providerModelId: modelIds[0] ?? null,
    providers,
    modelIds,
    providerModels,
  };
}

function parseTranscriptFile(file, redactionSummary) {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/u);
  redactionSummary.filesScanned += 1;
  redactionSummary.linesScanned += lines.length;
  const rawEntries = lines
    .map((line, index) => normalizeTranscriptLine(line, index + 1, file, redactionSummary))
    .filter(Boolean);
  return {
    metadata: transcriptMetadataFromEntries(rawEntries),
    entries: rawEntries.filter((entry) => entry.text.trim()),
  };
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
    return {
      entries: cached.entries,
      metadata: cached.metadata ?? transcriptMetadataFromEntries(cached.entries),
    };
  }
  const localSummary = createRedactionSummary(redactMode);
  const parsed = parseTranscriptFile(file, localSummary);
  addRedactionSummary(redactionSummary, localSummary);
  cache?.write('transcript-parse', key, {
    identity,
    redactionSummary: localSummary,
    entries: parsed.entries,
    metadata: parsed.metadata,
  });
  return parsed;
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
  // A fix-confirmation narration (grep/scan shows the fixed line, verified,
  // etc.) is success evidence even when it recaps the failure's root cause.
  // Check the FULL entry text too: the confirmation often sits past the 420
  // char compaction window (R18: committed report with grep 确认修复生效).
  if (failureResolvedByText(text)) return false;
  if (failureResolvedByText(String(entry.text ?? ''))) return false;
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
  if (/(?:fixed and confirmed|the authoritative result|successfully (?:completed|applied|verified)|已确认(?:生效|成功)|确认完毕|已成功(?:执行|完成)|完成并(?:已|确认)|文件(?:已)?(?:被)?删除|file (?:is|was) (?:gone|removed|deleted)|撤销成功|已恢复到修改前|恢复到修改前的状态|注释已被移除|已被移除|写入并确认成功|成功并确认)/iu.test(text)) {
    return true;
  }
  // Verification narrations (grep/scan confirms the fix landed) count as
  // successful outcomes even when the same message recaps the failure history.
  if (failureResolvedByText(text)) {
    return true;
  }
  return /Exit code:\s*0\b|\b(?:passed|success(?:ful)?|completed|verified|fixed(?!-string)|implemented|added|done|green)\b|通过|成功|完成|验证|已修复|已接上|已加入/iu.test(text)
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
    const text = normalize(item.text);
    if (!text) return false;
    // Key on text plus severity: the same sentence can legitimately carry two
    // roles at different severities (e.g. a critical decision entry that is
    // also the latest-outcome evidence). Dropping the outcome copy would
    // silently break terminal-state detection.
    const key = `${item.severity ?? ''}:${text}`;
    if (seen.has(key)) return false;
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

// P6-TF0074 v7 fabrication guard: explicit "tests were skipped" reports are
// negative test evidence. They must never be mined for tool names (R19: a
// bare "Cargo" fact was fabricated from the "Cargo.toml" manifest mention
// inside a verify_tests skip message and graded as a fake test result).
const TEST_SKIP_MARKER = /verify_tests:\s*skipped|no test suite was run|automatic tests were not run|tests? (?:was|were) not run|未运行测试|没有运行测试|跳过测试验证|跳过测试校验/iu;

// A bare tool/build-system name is project-type inference, not an executed
// result; summaries must never list one as a test outcome (R19: "Cargo").
const BARE_TOOL_NAME = /^(?:pnpm|npm|yarn|node(?:js)?|pytest|vitest|playwright|uv|cargo|rustc|go|rg|git|powershell|pwsh|mvn|maven|gradle|make|dotnet|javac|java|python|pip)\s*$/iu;

function extractCommandFacts(entries, prefix) {
  const seen = new Set();
  const facts = [];
  const commandRegex = /\b(?:pnpm|npm|yarn|node|pytest|vitest|playwright|uv\s+run|cargo|go\s+test|rg|git|powershell|pwsh)\b[^\n\r.;|]{0,180}/giu;
  for (const entry of entries) {
    const line = compactLine(entry.text, 260);
    if (isToolEntry(entry) && !/^\s*(?:pnpm|npm|yarn|node|pytest|vitest|playwright|uv\s+run|cargo|go\s+test)\b/ium.test(entry.text)) {
      continue;
    }
    if (TEST_SKIP_MARKER.test(entry.text)) continue;
    const hasOutcome = /pass|passed|fail|failed|error|exit code|completed|success|失败|通过|错误|退出/iu.test(line);
    const isLikelyCommandEvidence = /run|执行|验证|测试|command|命令/iu.test(line)
      || (isToolEntry(entry) && /Exit code:/iu.test(line));
    if (!hasOutcome && !isLikelyCommandEvidence) continue;
    for (const match of entry.text.matchAll(commandRegex)) {
      const text = match[0].trim().slice(0, 180);
      const follower = entry.text.slice(match.index + match[0].length, match.index + match[0].length + 12);
      if (
        seen.has(text)
        || text.length < 5
        // A bare tool name carries no execution evidence; real command
        // evidence includes an argument or subcommand ("cargo test", never
        // a lone "Cargo").
        || !/\s/u.test(text)
        // Manifest/file mentions ("Cargo.toml", "pnpm-lock.yaml") describe
        // the project type; they are not executed commands and must not be
        // guessed into test results.
        || /^\.(?:toml|json|ya?ml|lock|mod|sum|rs|py|ts|js|md)\b/iu.test(follower)
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

// Negative test evidence is still evidence: when the transcript explicitly
// reports that verification was skipped, keep that exact report so the
// summary does not invent substitute results (R19).
function extractTestSkipFacts(entries, prefix) {
  for (const entry of entries) {
    if (!TEST_SKIP_MARKER.test(entry.text)) continue;
    const skipLine = String(entry.text ?? '').split(/\r?\n/u)
      .map((line) => line.trim())
      .find((line) => TEST_SKIP_MARKER.test(line));
    const sentence = compactLine(skipLine ?? entry.text, 240);
    if (!sentence) continue;
    return [fact(`${prefix}-test-skip`, sentence, 'important', 'test_result', [], evidence(entry))];
  }
  return [];
}

/**
 * Multi-task windows: a user entry opens a NEW task segment unless it is a
 * short follow-up that continues the current work ("继续", "你刚才…"). The
 * objective's completion evidence must be found before the next new-task
 * user entry; otherwise an unrelated later success gets promoted into
 * "Task completed and verified" (R17: manual compaction was never executed
 * but a later chain-audit file write was graded as the completion; R12:
 * task #5 was graded against a later table row that only matched the
 * objective through the "JForum-master" directory name).
 */
function isNewTaskUserEntry(entry) {
  if (!isUserEntry(entry) || !isUsefulNaturalLanguageEntry(entry) || isInternalContextEntry(entry)) return false;
  const text = String(entry.text ?? '').trim();
  if (text.length < 16) return false;
  if (/^\[System\]/iu.test(text)) return false;
  if (/继续|接着|你刚才|刚才的|上面的|上一步|go on|keep going|as you were|proceed with the (?:same|current)/iu.test(text)) return false;
  return true;
}

function objectiveSegmentEndLine(entries, objectiveEntry) {
  if (!objectiveEntry) return undefined;
  const startIndex = entries.indexOf(objectiveEntry);
  if (startIndex < 0) return undefined;
  for (let index = startIndex + 1; index < entries.length; index += 1) {
    if (isNewTaskUserEntry(entries[index])) return entries[index].line;
  }
  return undefined;
}

/**
 * Promote the objective segment's terminal report verbatim so structured
 * sections carry what the investigation actually found (R17: /compact and
 * compaction-planning discovered, CLI unavailable, context usage
 * 109329/1000000, manual compaction NOT executed; R12: analyzed-files
 * tracking content for tasks #1-#5). Sentences are copied from the
 * transcript unchanged, so the fact stays evidence-traceable instead of
 * inferred from project type or directory names.
 */
function extractObjectiveReportFacts(segmentEntries, prefix, { objectiveText } = {}) {
  const reportMarker = /关键结论|结论|测试报告|分步报告|报告如下|最终报告|结果如下|追踪更新|累计分析|key findings|let me report|report this honestly|未能执行|无法执行|没有可用|here is the (?:final )?report/iu;
  const candidates = segmentEntries.filter((entry) => (
    isAssistantEntry(entry)
    && isUsefulNaturalLanguageEntry(entry)
    && String(entry.text ?? '').trim().length >= 120
    && reportMarker.test(entry.text)
  ));
  // Prefer the report that belongs to the objective's own task: numbered
  // serial tasks match on their task number, otherwise on objective tokens.
  // Without this, a later unrelated report inside the segment wins (R12:
  // a chain-audit step report displaced the task #5 tracking update).
  const reportTaskNumberMatch = /(?:连续)?任务\s*#\s*(\d+)|\btask\s*#\s*(\d+)/iu.exec(String(objectiveText ?? ''));
  const reportTaskNumber = reportTaskNumberMatch?.[1] ?? reportTaskNumberMatch?.[2];
  const reportTaskNumberPattern = reportTaskNumber
    ? new RegExp(`(?:#\\s*${reportTaskNumber}\\b|任务\\s*#?\\s*${reportTaskNumber}\\b|第\\s*${reportTaskNumber}\\s*个|task\\s*#?\\s*${reportTaskNumber}\\b)`, 'iu')
    : undefined;
  const reportTokens = objectiveTokens(objectiveText);
  const relevant = reportTaskNumberPattern
    ? candidates.filter((entry) => reportTaskNumberPattern.test(String(entry.text ?? '')))
    : (reportTokens.size ? candidates.filter((entry) => entryMentionsAnyToken(entry, reportTokens)) : candidates);
  const report = (relevant.length ? relevant : candidates).at(-1);
  if (!report) return [];
  const interest = /未能执行|无法执行|没有可用|不可用|CLI|contextTokens|totalTokens|\/compact|compaction|compact|压缩|结论|累计分析|追踪更新|#\d+|key findings|not reachable|no dedicated|automatic/iu;
  const sentences = sentenceCandidates(report, { max: 24 }).filter((sentence) => interest.test(sentence));
  const picked = [];
  let budget = 0;
  for (const sentence of sentences) {
    if (picked.length >= 8) break;
    if (budget + sentence.length > 720) continue;
    picked.push(sentence);
    budget += sentence.length;
  }
  if (!picked.length) return [];
  return [{
    ...fact(`${prefix}-objective-report`, compactLine(picked.join(' '), 760), 'important', 'decision', [], evidence(report)),
    sourceQuotes: picked.map((text) => ({ text, evidence: evidence(report) })),
  }];
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

/**
 * Expected-vs-failure qualification: some tool results that pattern-match
 * "error/disabled" text are expected status reports, not product failures.
 * Promoting them as blockers misleads the recovery summary into an
 * "In Progress / inspect failure" state for work that is actually complete.
 */
function expectedBehaviorQualification(text) {
  const value = String(text ?? '');
  // Feature-status report: a capability reporting disabled/unavailable with no
  // non-zero exit code and no failing tests is a status, not a failure.
  if (/\b(?:disabled|unavailable)\s*[:=]\s*true\b/iu.test(value)
    && !/Exit code:\s*(?!0\b)\d+|\b\d+\s+failed\b/iu.test(value)) {
    return 'Expected feature status: the capability reported itself as disabled/unavailable; this is a status report, not a product failure.';
  }
  // Files locked by the runtime itself (SQLite/WAL siblings the process holds
  // open) are an expected environment condition when the source says so.
  if (/\b(?:is being used by another process|in active use|database is locked)\b/iu.test(value)
    && /\b(?:expected|normal|harmless|runtime|openclaw|holds?\b|预期|正常)\b/iu.test(value)) {
    return 'Expected environment condition: the locked files are held by the runtime itself, not a product failure.';
  }
  return undefined;
}

function classifyFailure(entry) {
  const text = String(entry.text ?? '');
  if (expectedBehaviorQualification(text)) {
    return 'expected_behavior';
  }
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
  if (/\b\w[\w .-]{0,30} required\b|\brequires [\w .-]{3,60}/iu.test(text) && /\bstatus\b|\bquery\b|\blist\b|查询|状态|列出/iu.test(text)) {
    return 'expected_behavior';
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
  // JSON error payloads: surface the actual "error" field value instead of
  // the generic '"status": "error",' line (R21: mission_loop's concrete
  // error message was lost to the generic fragment).
  const jsonErrorMatch = /"error"\s*:\s*"([^"]{4,300})"/iu.exec(String(text ?? ''));
  if (jsonErrorMatch) return jsonErrorMatch[1];
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
  if (classification === 'expected_behavior') {
    return expectedBehaviorQualification(text)
      ?? 'Expected/benign status per evidence, not a product failure.';
  }
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
  if (classification === 'expected_behavior') {
    return 'No repair needed: preserve this expected-status context as-is; do not treat it as an open failure.';
  }
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
      classification === 'expected_behavior' ? 'Expected status (not a failure):' : 'Tool/test failure summary:',
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

/**
 * A failure is considered resolved-historical when its own narration already
 * carries a verification confirmation (grep/scan shows the fix landed), or any
 * later natural-language entry in the same window evidences a successful
 * outcome. Resolved failures must not drive Current State, next actions, or
 * the continuation directive.
 */
function failureResolvedByText(text) {
  const value = String(text ?? '');
  // CJK alternatives must not require \b boundaries: CJK characters are word
  // characters, so "确认修复生效" has no boundary before 修复生效 (R18).
  if (/\b(?:grep|rg|scan)\b[^\n]{0,200}(?:\b(?:shows? the fixed|shows? the corrected|confirmed|confirms|verifies|no stray|no longer|is in place)\b|已确认|验证通过|修复生效)|(?:检查|验证)[^\n]{0,200}(?:\b(?:shows? the fixed|shows? the corrected|confirmed|confirms|verifies|no stray|no longer|is in place)\b|已确认|验证通过|修复生效)/iu.test(value)) {
    return true;
  }
  return /\b(?:fix is in place|now logs? the error|successfully (?:replaced|applied|wrote)|写入成功|成功写入|已修复)\b/iu.test(value);
}

/**
 * Strict verified-completion test used only for failure-resolution marking.
 * Deliberately narrower than isSuccessfulOutcome: loose markers like the word
 * "fixed" inside an adjustment note ("fixed-string scan") must not resolve an
 * open failure.
 */
function isVerifiedCompletionEntry(entry) {
  const text = compactLine(entry.text, 420);
  if (/Exit code:\s*0\b/iu.test(text)) return true;
  if (/\b(?:Tests?|Test Files?)\s+\d+\s+passed\b/iu.test(text) && !/\b\d+\s+failed\b/iu.test(text)) return true;
  if (/(?:fixed and confirmed|the authoritative result|successfully (?:completed|applied|verified)|已确认(?:生效|成功)|确认完毕|已成功(?:执行|完成)|完成并(?:已|确认)|文件(?:已)?(?:被)?删除|file (?:is|was) (?:gone|removed|deleted)|报告如下|尝试报告|最终报告|final report below|撤销成功|已恢复到修改前|恢复到修改前的状态|注释已被移除|已被移除|写入并确认成功|成功并确认)/iu.test(text)) return true;
  if (failureResolvedByText(text)) return true;
  return false;
}

function laterSuccessExists(entries, fromLine) {
  return entries.some((entry) => (
    entry.line > fromLine
    && isAssistantEntry(entry)
    && isUsefulNaturalLanguageEntry(entry)
    && isVerifiedCompletionEntry(entry)
  ));
}

function withFailureResolution(summary, entries) {
  if (!summary) return summary;
  const sourceEntry = entries.find((entry) => (
    entry.messageId === summary.evidence?.messageId
    && entry.line === summary.evidence?.line
  ));
  const resolved = failureResolvedByText(summary.text)
    || (sourceEntry ? failureResolvedByText(String(sourceEntry.text ?? '')) : false)
    || laterSuccessExists(entries, summary.evidence.line);
  return resolved ? { ...summary, resolved: true } : summary;
}

function extractToolFailureFacts(entries, prefix) {
  return entries
    .filter((entry) => (isToolEntry(entry) || /Exit code:\s*(?!0\b)\d+|Tests?\s+\d+\s+failed|ParserError|not recognized as the name/iu.test(entry.text)) && isFailureEvidence(entry))
    .map((entry) => summarizeToolOrTestFailure(entry))
    .filter(Boolean)
    .slice(-4)
    .map((summary, index) => ({
      ...fact(`${prefix}-tool-failure-${index + 1}`, summary.text, summary.classification === 'test_failure' ? 'critical' : 'important', summary.classification === 'test_failure' ? 'test_result' : 'blocker', [], summary.evidence),
      failureSummary: withFailureResolution(summary, entries),
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
  // Collapse identical retried failures first (same error text), then cap:
  // without dedup, retry storms push the earliest distinct attempts (e.g. an
  // alternative tool tried first) out of the chain window (R21).
  const failureEntries = (() => {
    const allFailureEntries = entries
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => (isAssistantEntry(entry) || isToolEntry(entry) || roleIs(entry, 'toolresult')) && isFailureEvidence(entry));
    const seenFailureTexts = new Set();
    const distinctFailureEntries = [];
    for (const item of allFailureEntries) {
      const key = normalize(compactLine(item.entry.text, 260));
      if (seenFailureTexts.has(key)) continue;
      seenFailureTexts.add(key);
      distinctFailureEntries.push(item);
    }
    return distinctFailureEntries.slice(-6);
  })();
  return failureEntries.map(({ entry, index }, chainIndex) => {
    const failureSummary = withFailureResolution(summarizeToolOrTestFailure(entry), entries);
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
    const validationConfirmsAbsence = Boolean(validation && /不存在的文件|确实不存在|确认[^。\n]{0,30}不存在|file (?:does not exist|is absent|was not found)[\s\S]{0,80}(?:confirmed|verified|expected|probe)|(?:confirmed|verified)[\s\S]{0,80}file (?:does not exist|is absent)/iu.test(String(validation.text ?? '')));
    const rawClassification = failureSummary?.classification ?? classifyFailure(entry);
    // A raw tool error immediately followed by an assistant explanation that
    // qualifies it as expected status inherits that qualification; otherwise
    // the raw JSON chain and the explanation chain render contradictory
    // classifications for the same event (R4: locked SQLite files; R20:
    // memory_search disabled/unavailable).
    const qualifyingExplanation = rawClassification !== 'expected_behavior' && !validationConfirmsAbsence && (isToolEntry(entry) || roleIs(entry, 'toolresult'))
      ? nearestEntry(entries, index, 1, [/./u], (candidate) => isAssistantEntry(candidate) && Boolean(expectedBehaviorQualification(candidate.text)), 4)
      : undefined;
    const inheritedQualification = qualifyingExplanation ? expectedBehaviorQualification(qualifyingExplanation.text) : undefined;
    const classification = validationConfirmsAbsence || qualifyingExplanation ? 'expected_behavior' : rawClassification;
    const resolvedSummary = (validationConfirmsAbsence || qualifyingExplanation) && failureSummary
      ? {
        ...failureSummary,
        classification: 'expected_behavior',
        resolved: true,
        ...(inheritedQualification ? { likelyCause: inheritedQualification, followUp: 'No repair needed: preserve this expected-status context as-is; do not treat it as an open failure.' } : {}),
      }
      : failureSummary;
    const text = [
      (failureSummary?.resolved || validationConfirmsAbsence || qualifyingExplanation) ? 'Resolved failure chain (historical):' : 'Failure chain:',
      `attempt="${compactLine(sentenceCandidates(attempt, { max: 8 }).filter((candidate) => /attempt|tried|try|ran|run|scan|command|execute|validate|test|edit|inspect|尝试|运行|执行|扫描|验证/iu.test(candidate)).at(-1) ?? sentenceCandidates(attempt, { max: 8 }).at(-1) ?? attempt.text, 180)}"`,
      `failure="${failureSummary?.firstError ?? bestSentence(entry, [/failed|failure|error|Exit code/iu], 180)}"`,
      `classification=${classification}`,
      `likelyCause="${validationConfirmsAbsence ? 'Confirmed absence: multiple access methods verified the target does not exist; this is an investigated state, not a product failure.' : (resolvedSummary?.likelyCause ?? likelyCauseForFailure(classification, entry.text))}"`,
      adjustment ? `adjustment="${bestSentence(adjustment, [/switch|fallback|corrected|fixed-string|rerun|changed|adjust|./iu], 180)}"` : 'adjustment="not evidenced"',
      validation ? `validation="${bestSentence(validation, [/passed|failed|Exit code|success|verified|./iu], 180)}"` : 'validation="not evidenced"',
      validationConfirmsAbsence ? 'nextAction="No repair needed: the absence is confirmed evidence; preserve this investigated state."' : ((qualifyingExplanation && !next) ? `nextAction="${resolvedSummary?.followUp ?? 'No repair needed: preserve this expected-status context as-is.'}"` : (next ? `nextAction="${bestSentence(next, [/next action|next|todo|rerun|inspect|fix|run|./iu], 180)}"` : `nextAction="${resolvedSummary?.followUp ?? followUpForFailure(classification, undefined, '')}"`)),
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
      failureSummary: resolvedSummary,
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
    decision: [/decision|decided|choose|chosen|switch|use|fixed-string|one-pattern|delegates to|record only commands|采用|决定|选择|切换|结论|原因|已|完成|修复|加入|key findings|next|todo|continue|接下来|下一步|继续/iu],
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
  // A repeated identical request is one task episode: scope from the FIRST
  // occurrence so earlier attempts (e.g. alternative tools tried before the
  // repeat) stay visible (R21: the mission_loop attempt preceded the last
  // repeated request).
  const objectiveTextKey = objective ? normalize(objective.text) : '';
  const firstIdenticalRequest = objective && isUserEntry(objective) && objectiveTextKey
    ? entries.find((entry) => isUserEntry(entry) && normalize(entry.text) === objectiveTextKey)
    : undefined;
  const objectiveIndex = objective && isUserEntry(objective) && !isInternalContextEntry(objective)
    ? entries.indexOf(firstIdenticalRequest ?? objective)
    : 0;
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
  const windowHasExpectedStatus = scopedEntries.some((entry) => (
    (isToolEntry(entry) || isAssistantEntry(entry))
    && Boolean(expectedBehaviorQualification(entry.text))
  ));
  const objectiveExpectsControlledFailure = /不存在|nonexistent|deliberately|故意|预期|expected\b/iu.test(String(objective?.text ?? ''));
  const isExpectedNarrationEntry = (entry) => Boolean(expectedBehaviorQualification(entry.text))
    || (windowHasExpectedStatus && /\b(?:disabled|unavailable)\b|禁用|不可用|暂停/iu.test(entry.text))
    || (objectiveExpectsControlledFailure && /不存在|ENOENT|no such file|not be found|找不到|PathNotFound/iu.test(entry.text));
  const blocker = firstMatchingEntry(
    scopedNaturalEntries,
    [/blocked|blocker|failed|failure|error|cannot|root cause|because|blocked at|hung|stuck|ensureSessionStateMigrated|plugins\.bootstrap|legacy state migration|失败|错误|阻塞|无法|原因|\u5361\u5728/iu],
    new Set(),
    (entry) => isAssistantEntry(entry) && isFailureEvidence(entry) && !isExpectedNarrationEntry(entry),
  ) ?? firstMatchingEntry(scopedEntries, [/failed|failure|error|cannot|blocked at|hung|stuck|ensureSessionStateMigrated|plugins\.bootstrap|失败|错误|无法|Exit code:\s*(?!0\b)\d+/iu], new Set(), (entry) => isToolEntry(entry) && isFailureEvidence(entry) && !isExpectedNarrationEntry(entry));
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
    (entry) => (isAssistantEntry(entry) || isToolEntry(entry)) && isFailureEvidence(entry) && !isExpectedNarrationEntry(entry),
  );
  // Multi-task windows: bound the objective's task segment at the next
  // new-task user entry and only accept completion evidence inside it
  // (R17/R12: later unrelated chain-audit successes were promoted into
  // "Task completed and verified" for objectives they never satisfied).
  const objectiveEntry = objective && isUserEntry(objective) && !isInternalContextEntry(objective) ? objective : undefined;
  const segmentEndLine = objectiveSegmentEndLine(entries, objectiveEntry);
  // Numbered serial-task objectives ("连续任务 #5", "task #5"): completion
  // evidence must reference the same task number. Directory-name token
  // matches alone are too weak: later unrelated tasks in the same repo
  // mention the same path tokens (R12: a later chain-audit report matched
  // "jforum" through the JForum-master directory name).
  const objectiveTaskNumberMatch = /(?:连续)?任务\s*#\s*(\d+)|\btask\s*#\s*(\d+)/iu.exec(String(objective?.text ?? ''));
  const objectiveTaskNumber = objectiveTaskNumberMatch?.[1] ?? objectiveTaskNumberMatch?.[2];
  const objectiveTaskNumberPattern = objectiveTaskNumber
    ? new RegExp(`(?:#\\s*${objectiveTaskNumber}\\b|任务\\s*#?\\s*${objectiveTaskNumber}\\b|第\\s*${objectiveTaskNumber}\\s*个|task\\s*#?\\s*${objectiveTaskNumber}\\b)`, 'iu')
    : undefined;
  const mentionsObjectiveTaskNumber = (entry) => (
    !objectiveTaskNumberPattern || objectiveTaskNumberPattern.test(String(entry.text ?? ''))
  );
  const segmentEntries = segmentEndLine === undefined
    ? scopedEntries
    : scopedEntries.filter((entry) => entry.line < segmentEndLine);
  const segmentNaturalEntries = segmentEntries.filter(isUsefulNaturalLanguageEntry);
  // Prefer an outcome that actually belongs to the objective task: in
  // multi-task transcripts the last raw success entry can belong to a
  // different sub-task (R15: the ValidationException undo objective was
  // graded against a file-creation table row from chain_audit_test).
  const objectiveOutcomeTokensAll = objectiveTokens(objective?.text);
  const objectiveOutcomeTokens = ([...objectiveOutcomeTokensAll].some((token) => token.includes('.'))
    ? new Set([...objectiveOutcomeTokensAll].filter((token) => token.includes('.')))
    : objectiveOutcomeTokensAll);
  const objectiveRelevantOutcome = objectiveOutcomeTokens.size
    ? ([...segmentNaturalEntries].reverse().find((entry) => (
        isAssistantEntry(entry)
        && isSuccessfulOutcome(entry)
        && mentionsObjectiveTaskNumber(entry)
        && entryMentionsAnyToken(entry, objectiveOutcomeTokens)
        && isVerifiedCompletionEntry(entry)
      ))
      ?? [...segmentNaturalEntries].reverse().find((entry) => (
        isAssistantEntry(entry)
        && isSuccessfulOutcome(entry)
        && mentionsObjectiveTaskNumber(entry)
        && entryMentionsAnyToken(entry, objectiveOutcomeTokens)
      )))
    : undefined;
  // When a task boundary exists, never borrow completion evidence from
  // later tasks; when it does not (single-task windows), segment scope and
  // global scope are identical, so this stays fail-safe in both cases.
  const outcome = objectiveRelevantOutcome ?? lastMatchingEntry(
    segmentNaturalEntries,
    [/passed|success|completed|verified|fixed|implemented|added|done|通过|成功|完成|验证|已修复|已接上|已加入/iu],
    new Set(),
    (entry) => isAssistantEntry(entry) && isSuccessfulOutcome(entry) && mentionsObjectiveTaskNumber(entry),
  ) ?? lastMatchingEntry(
    segmentEntries,
    [/passed|success|completed|verified|Exit code:\s*0|通过|成功|完成|验证/iu],
    new Set(),
    (entry) => isToolEntry(entry) && isSuccessfulOutcome(entry) && /^\s*(?:pnpm|npm|yarn|node|pytest|vitest|playwright|uv\s+run|cargo|go\s+test)\b/ium.test(entry.text),
  );
  // When the objective's own task segment ended without verified completion,
  // record that state explicitly (with the latest objective-scoped report) so
  // the summary and continuation directive neither silently treat the
  // objective as done nor forget it (R17: manual compaction was never
  // executed; the investigation findings are the latest evidence).
  const objectiveReportFact = extractObjectiveReportFacts(segmentEntries, prefix, { objectiveText: objective?.text }).at(0) ?? null;
  const pendingObjectiveFact = segmentEndLine !== undefined && !outcome && objective
    ? fact(`${prefix}-pending-objective`, objectiveReportFact
      ? `Objective not verified complete in its own task segment; latest objective report: ${objectiveReportFact.text}`
      : `Objective not verified complete in its own task segment; objective: ${compactLine(objective.text, 200)}`, 'important', 'decision', [], evidence(objective))
    : null;
  if (pendingObjectiveFact) {
    pendingObjectiveFact.generatedFromEvidence = true;
    pendingObjectiveFact.sourceQuotes = objectiveReportFact?.sourceQuotes
      ?? [{ text: compactLine(objective.text, 200), evidence: evidence(objective) }];
  }
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
    outcome
      ? (/步骤\s*[-—]?\s*\d|\*\*步骤|Step\s*\d/iu.test(outcome.text)
        // Multi-step outcome reports (write -> read -> undo -> verify style)
        // must keep the whole step chain: truncating to the first sentence
        // drops the causal chain the judges grade (R19 completeness).
        ? fact(`${prefix}-latest-outcome`, compactLine(outcome.text, 640), 'important', 'test_result', [], evidence(outcome))
        : lineFact(prefix, 'latest-outcome', 'Latest outcome', outcome, 'important', 'test_result'))
      : null,
    next ? lineFact(prefix, 'next-action', 'Next action', next, 'critical', 'decision') : null,
    ...extractPathFacts(scopedEntries, prefix),
    ...extractCommandFacts(scopedEntries, prefix),
    ...extractTestSkipFacts(scopedEntries, prefix),
    ...(objectiveReportFact && !pendingObjectiveFact ? [objectiveReportFact] : []),
    ...(pendingObjectiveFact ? [pendingObjectiveFact] : []),
  ].filter(Boolean);

  if (!objective) unverifiedClaims.push('No explicit objective evidence found.');
  if (!decision) unverifiedClaims.push('No explicit decision evidence found.');
  if (!constraint) unverifiedClaims.push('No explicit constraint evidence found.');
  if (!next) unverifiedClaims.push('No explicit next action evidence found.');

  return { expected: uniqueByText(expected), unverifiedClaims, objectiveSegmentEndLine: segmentEndLine };
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

function objectiveTokens(objectiveText) {
  const tokens = new Set();
  for (const match of String(objectiveText ?? '').matchAll(/[A-Za-z][A-Za-z0-9_.\/-]{5,}/gu)) {
    const token = match[0].toLowerCase();
    if (!/^(?:objective|task|goal|please|context|summary|implement|continue|complete|correct)$/.test(token)) tokens.add(token);
  }
  return tokens;
}

function entryMentionsAnyToken(entry, tokens) {
  const text = String(entry?.text ?? '').toLowerCase();
  for (const token of tokens) {
    if (text.includes(token)) return true;
  }
  return false;
}

export function isUnresolvedFailureFact(item) {
  return Boolean(item.failureSummary?.followUp)
    && item.failureSummary.classification !== 'expected_behavior'
    && !item.failureSummary.resolved;
}

function deriveNextActions(facts, explicitNextActions) {
  const failureFacts = facts.filter((item) => isUnresolvedFailureFact(item)).slice(-3);
  const latestFailure = failureFacts.at(-1);
  const latestOutcome = facts.filter((item) => item.id.includes('latest-outcome')).at(-1);
  const failureIsCurrent = latestFailure && (!latestOutcome || latestFailure.evidence.line > latestOutcome.evidence.line);
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
  const pendingObjectiveFact = facts.filter((item) => item.id.includes('pending-objective')).at(-1);
  if (pendingObjectiveFact) {
    return [{ text: pendingObjectiveFact.text, source: 'objective_report' }];
  }
  return [{ text: 'Continue from the current evidence-backed state; no unsupported next action was promoted.', source: 'fallback' }];
}

function buildRealSummary({ sampleId, facts, unverifiedClaims, entries, pressure, originalTranscript, forbidden = [], rehydratedFileContext = [], objectiveSegmentEndLine }) {
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
  // Bare tool names are project-type inference, not executed results (R19).
  const tests = byCategory('test_result').filter((text) => !BARE_TOOL_NAME.test(String(text).trim()));
  const decisions = [...byCategory('decision'), ...byCategory('constraint')];
  const activeFailureFocus = originalTokens >= 3000
    ? facts
      .filter((item) => isUnresolvedFailureFact(item))
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
  const lastUserEntry = [...entries].filter((entry) => isUserEntry(entry) && isUsefulNaturalLanguageEntry(entry) && !isInternalContextEntry(entry)).at(-1);
  const reportRequested = /\b(?:report|results?|summary)\b|报告|汇报|结果/iu.test(String(lastUserEntry?.text ?? ''));
  // Completion evidence is scoped to the objective's task segment: a verified
  // completion from a later unrelated task must not mark this objective done
  // (R17/R12). Without a boundary the full entry list is used, unchanged.
  const objectiveFact = facts.find((item) => item.id.includes('objective'));
  const completionSourceEntries = objectiveSegmentEndLine === undefined || !objectiveFact?.evidence
    ? entries
    : entries.filter((entry) => entry.line >= objectiveFact.evidence.line && entry.line < objectiveSegmentEndLine);
  const completionCandidates = [...completionSourceEntries]
    .filter((entry) => isAssistantEntry(entry) && isUsefulNaturalLanguageEntry(entry)
      && (isVerifiedCompletionEntry(entry)
        || (reportRequested && /(?:\bresults?\b[:\uFF1A:]?|summary|报告如下|尝试报告|最终报告|结果[\uFF1A:])/iu.test(String(entry.text ?? ''))))
    );
  const completionObjectiveTokensAll = objectiveTokens((facts.find((item) => item.id.includes('objective')) ?? {}).text);
  const completionObjectiveTokens = ([...completionObjectiveTokensAll].some((token) => token.includes('.'))
    ? new Set([...completionObjectiveTokensAll].filter((token) => token.includes('.')))
    : completionObjectiveTokensAll);
  const completionEntry = completionObjectiveTokens.size
    ? ([...completionCandidates].reverse().find((entry) => entryMentionsAnyToken(entry, completionObjectiveTokens))
      ?? completionCandidates.at(-1))
    : completionCandidates.at(-1);
  const verifiedCompletion = latestOutcome
    ? { text: latestOutcome.text, line: latestOutcome.evidence.line }
    : (completionEntry ? { text: compactLine(completionEntry.text, 240), line: completionEntry.line } : undefined);
  const unresolvedBlockerFacts = facts.filter((item) => (
    item.category === 'blocker'
    && !(item.failureSummary && (item.failureSummary.resolved || item.failureSummary.classification === 'expected_behavior'))
    && !laterSuccessExists(entries, item.evidence.line)
  ));
  const latestBlocker = unresolvedBlockerFacts.at(-1);
  const taskVerifiedComplete = Boolean(verifiedCompletion)
    && (!latestBlocker || verifiedCompletion.line >= latestBlocker.evidence.line);
  const currentState = taskVerifiedComplete
    ? `Done/Validated: latest outcome is "${verifiedCompletion.text}".`
    : latestBlocker
      ? `In Progress: the latest unresolved blocker/failure is "${latestBlocker.text}".`
      : derivedNextActions.length && derivedNextActions[0].source !== 'fallback'
        ? `In Progress: continue with "${derivedNextActions[0].text}".`
        : 'No unresolved failure was promoted; continue from the evidence-backed transcript facts below.';
  const outcomeStatus = taskVerifiedComplete
    ? `Task completed and verified: "${compactLine(verifiedCompletion.text, 220)}". Do not redo completed work; preserve this validated outcome.`
    : (latestOutcome || verifiedCompletion)
      ? `A validated outcome exists ("${compactLine((latestOutcome ?? verifiedCompletion).text, 200)}") but unresolved failure evidence follows it; the open failure above is the current work.`
      : latestBlocker
        ? 'No verified completion evidence was promoted in this window; treat the unresolved failures above as open work.'
        : 'No verified completion evidence and no unresolved failure was promoted in this window; continue from the evidence-backed facts below.';
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
    '## Outcome Status',
    `- ${outcomeStatus}`,
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



/**
 * Build a deterministic recovery ledger for one manifest sample window.
 * Uses the same active-entry/window selection as the fixed P6-A manifest.
 */
export function buildRecoveryLedger(file, sampleId, { windowSize = 200, ordinalIndex = 0 } = {}) {
  const redactionSummary = createRedactionSummary("strict");
  const parsed = parseTranscriptFile(file, redactionSummary);
  const allEntries = parsed.entries ?? [];
  const usable = activeEntriesForSampling(allEntries);
  const size = Math.min(windowSize, usable.length);
  const maxStart = Math.max(usable.length - size, 0);
  const start = maxStart ? (ordinalIndex * 17) % (maxStart + 1) : 0;
  const selectedEntries = usable.slice(start, start + size);
  const tailEntries = usable.slice(-40);
  const entries = [...new Map(
    [...selectedEntries, ...tailEntries].map((entry) => [`${entry.file}:${entry.line}:${entry.messageId}`, entry]),
  ).values()].sort((left, right) => left.line - right.line);
  const { expected, unverifiedClaims, objectiveSegmentEndLine } = extractRealFacts(entries, sampleId);
  const originalTranscript = entries
    .map((entry) => `[${entry.role}/${entry.kind}/${entry.messageId}] ${entry.text}`)
    .join("\n");
  return {
    sampleId,
    file,
    redactionSummary,
    window: { allEntries: allEntries.length, usable: usable.length, size, start },
    entries,
    originalTranscript,
    expected,
    unverifiedClaims,
    objectiveSegmentEndLine,
  };
}

function actionFromFact(prefix, id, item, kind, critical = false) {
  return {
    id: `${prefix}-${id}`,
    kind,
    ...(kind === "decision" ? { decision: item?.text ?? "continue from evidence-backed summary" } : { target: item?.text ?? "continue from evidence-backed summary" }),
    ...(critical ? { critical: true } : {}),
  };
}


/**
 * Mirrors the P6-A real-continuation candidate derivation from the same
 * deterministic facts, and emits an explicit continuation directive so the
 * live continuation model selects the evidence-backed candidate.
 */
export function buildContinuationDirective(ledger) {
  const expected = ledger.expected ?? [];
  const prefix = ledger.sampleId ?? "R";
  const fileFact = expected.find((item) => item.category === "file_context" || item.category === "file_mutation");
  const testFact = expected.find((item) => item.category === "test_result");
  const latestOutcomeFact = expected.filter((item) => item.id.includes("latest-outcome")).at(-1);
  const pendingObjectiveFact = expected.filter((item) => item.id.includes('pending-objective')).at(-1);
  // v8 directive fix (candidate-v4 micro attribution): the primary next action
  // must come from the ACTIVE objective segment. A stale earlier-task next
  // action (first array match) must not dictate continuation — R17 root cause.
  const nextActionFacts = expected.filter((item) => item.id.includes("next-action"));
  const segmentStartLine = pendingObjectiveFact?.evidence?.line;
  const segmentEndLine = ledger.objectiveSegmentEndLine;
  const inActiveSegment = (item) => (
    (!Number.isFinite(segmentStartLine) || item.evidence?.line >= segmentStartLine)
    && (!Number.isFinite(segmentEndLine) || segmentEndLine <= 0 || item.evidence?.line <= segmentEndLine)
  );
  const scopedFacts = nextActionFacts.filter(inActiveSegment);
  const nextFact = [...(scopedFacts.length ? scopedFacts : nextActionFacts)]
    .sort((left, right) => (right.evidence?.line ?? 0) - (left.evidence?.line ?? 0))[0];
  const currentNextFact = nextFact && (
    !latestOutcomeFact
    || nextFact.evidence.line > latestOutcomeFact.evidence.line
  )
    ? nextFact
    : undefined;
  const actionableFailure = [...expected].reverse().find((item) => (
    isUnresolvedFailureFact(item)
    && (!latestOutcomeFact || item.evidence.line > latestOutcomeFact.evidence.line)
  ));
  // v8 directive fix: a concrete, provenance-verified next action recorded
  // AFTER an unresolved failure outranks the failure's generic followUp —
  // R9/R30 root cause ("Fix the environment... then rerun." buried the
  // specific rebuild/reinstall action).
  const concreteOverridesFollowUp = Boolean(
    actionableFailure
    && currentNextFact
    && currentNextFact.provenance
    && (currentNextFact.evidence?.line ?? 0) > (actionableFailure.evidence?.line ?? 0)
  );
  const primaryActionFact = actionableFailure && !concreteOverridesFollowUp
    ? { text: actionableFailure.failureSummary.followUp }
    : currentNextFact
      ?? (latestOutcomeFact
        ? { text: `Do not repeat completed work; preserve the validated outcome: ${latestOutcomeFact.text}` }
        : pendingObjectiveFact
          ? { text: pendingObjectiveFact.text }
          : undefined);
  const primary = primaryActionFact
    ? actionFromFact(prefix, "continue", primaryActionFact, "decision", true)
    : fileFact
      ? actionFromFact(prefix, "read", fileFact, "read_file", true)
      : actionFromFact(prefix, "inspect", expected[0], "decision", true);
  const support = [
    fileFact ? actionFromFact(prefix, "read", fileFact, "read_file", !primaryActionFact) : null,
    testFact ? actionFromFact(prefix, "test", testFact, "run_test", false) : null,
  ].filter((action) => action && actionSignature(action) !== actionSignature(primary));
  const candidate = (action, authoritative = false) => {
    const value = action.kind === "decision" ? action.decision : action.target;
    return `${authoritative ? "The only valid next action is " : "Optional support action: "}candidate action id "${action.id}" (${action.kind}): ${value}`;
  };
  return {
    primary,
    support,
    text: [
      "## Continuation Directive (authoritative)",
      `${candidate(primary, true)}.`,
      "Do not repeat completed work and do not pursue stale or rejected directions; when taking over, state this next action concretely in your plan.",
      ...support.map((action) => `- ${candidate(action)}.`),
    ].join("\n"),
  };
}

export function buildDeterministicRecoverySummary(ledger) {
  return buildRealSummary({
    sampleId: ledger.sampleId,
    facts: ledger.expected ?? [],
    unverifiedClaims: ledger.unverifiedClaims ?? [],
    entries: ledger.entries ?? [],
    pressure: "0.75",
    originalTranscript: ledger.originalTranscript ?? "",
    forbidden: [],
    rehydratedFileContext: [],
    objectiveSegmentEndLine: ledger.objectiveSegmentEndLine,
  });
}

export function buildLeanRecoverySummary(ledger, directiveText = "") {
  const facts = ledger.expected ?? [];
  const objective = facts.filter((item) => item.category === "objective").map((item) => item.text);
  const critical = facts.filter((item) => item.severity === "critical");
  const important = facts.filter((item) => item.severity === "important");
  const niceToHave = facts.filter((item) => item.severity === "nice_to_have");
  const files = facts.filter((item) => item.category === "file_context" || item.category === "file_mutation").map((item) => item.text);
  const tests = facts.filter((item) => item.category === "test_result").map((item) => item.text).filter((text) => !BARE_TOOL_NAME.test(String(text).trim()));
  const section = (title, items) => items.length
    ? [`## ${title}`, ...items.map((item) => `- [${item.category}] ${item.text} (e=${item.id}@${basename(item.evidence?.file ?? "")}:${item.evidence?.line ?? ""})`), ""]
    : [];
  const recent = (ledger.entries ?? []).slice(-40).map((entry) => (
    `- [${entry.role}/${entry.kind}/${entry.messageId}@${entry.line}] ${String(entry.text ?? "").slice(0, 1200)}`
  ));
  const lines = [
    "## Goal and Progress",
    ...(objective.length ? objective.map((item) => `- ${item}`) : ["- No explicit objective was promoted without evidence."]),
    "",
    ...section("Critical Recovery Ledger", critical),
    ...section("Important Recovery Ledger", important),
    ...section("Nice-to-Have Recovery Ledger", niceToHave),
    ...(files.length ? ["## Files Touched / Relevant Files", ...files.map((item) => `- ${item}`), ""] : []),
    ...(tests.length ? ["## Tests and Results", ...tests.map((item) => `- ${item}`), ""] : []),
    "## Recent Evidence Chronology (authoritative)",
    ...recent,
  ];
  if (directiveText) {
    lines.push("", directiveText);
  }
  return lines.join("\n");
}

export function ledgerText(ledger) {
  const critical = (ledger.expected ?? []).filter((item) => item.severity === "critical");
  const important = (ledger.expected ?? []).filter((item) => item.severity === "important");
  const niceToHave = (ledger.expected ?? []).filter((item) => item.severity === "nice_to_have");
  const section = (title, items) => items.length
    ? [`## ${title}`, ...items.map((item) => `- [${item.category}] ${item.text} (e=${item.id}@${basename(item.evidence?.file ?? "")}:${item.evidence?.line ?? ""})`), ""]
    : [];
  return [
    ...section("Critical Recovery Ledger", critical),
    ...section("Important Recovery Ledger", important),
    ...section("Nice-to-Have Recovery Ledger", niceToHave),
  ].join("\n");
}
