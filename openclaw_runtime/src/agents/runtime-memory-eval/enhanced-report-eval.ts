// Enhanced report generator for runtime-memory evaluation.
// Pure functions only — no vitest imports. Aggregates results from all
// evaluation dimensions (long conversation, chain, utility, temporal
// evolution, topic drift, budget pressure, conflict resolution, hazard
// suppression, cross-axis rejection, latency benchmark) into a single
// structured report with overall score, strengths, weaknesses, and
// recommendations.

export type EnhancedEvalDimensions = {
  longConversation?: {
    significant: boolean;
    cohensD: number;
    achieved: boolean;
  };
  chain?: {
    aggregateChainRecall: number;
    maxDepth: number;
    meanGrowthRate: number;
  };
  utility?: {
    meanUtility: number;
    meanCoverage: number;
    meanCompleteness: number;
    p95Utility?: number;
  };
  temporalEvolution?: {
    writeEffect: number;
    invalidateEffect: number;
  };
  topicDrift?: {
    perTopicRecall: number[];
    crossTopicInterference: number;
    driftRecoveryTime: number;
  };
  budgetPressure?: {
    maxRecall: number;
    minRecall: number;
    kneePoint: number;
    budgetElasticity: number;
  };
  conflictResolution?: {
    wrongConflictWinnerRate: number;
    conflictSuppressionRate: number;
  };
  hazardSuppression?: {
    promptInjectionSuppressionRate: number;
    rawLeakSuppressionRate: number;
    hazardStringLeaked: string[];
  };
  crossAxisRejection?: {
    rejectionCoverage: number;
    allReasonsFired: boolean;
    correctReasonRate: number;
  };
  latencyBenchmark?: {
    latencyMsP50: number;
    latencyMsP95: number;
    tokenOverheadP50: number;
    tokenOverheadP95: number;
  };
};

export type RejectionReasonDistributionEntry = {
  reason: string;
  count: number;
  percentage: number;
};

export type JointPassRateEntry = {
  pair: string;
  dimensionA: string;
  dimensionB: string;
  scoreA: number;
  scoreB: number;
  bothPass: boolean;
  jointScore: number;
  threshold: number;
};

export type CrossDimensionCorrelation = {
  pairs: readonly JointPassRateEntry[];
  overallJointPassRate: number;
};

export type EnhancedEvalReport = {
  generatedAt: number;
  dimensions: EnhancedEvalDimensions;
  summary: {
    overallScore: number;
    dimensionScores: Record<string, number>;
    strengths: string[];
    weaknesses: string[];
    recommendations: string[];
  };
  rejectionReasonDistribution?: ReadonlyArray<RejectionReasonDistributionEntry>;
  crossDimensionCorrelation?: CrossDimensionCorrelation;
};

const DEFAULT_NOW = () => Date.now();
const LATENCY_BUDGET_MS = 50;
const TOKEN_OVERHEAD_BUDGET = 200;

export function generateEnhancedReport(
  dimensions: EnhancedEvalDimensions,
  options?: {
    now?: () => number;
    rejectionCounts?: Record<string, number>;
    correlationThreshold?: number;
  },
): EnhancedEvalReport {
  const now = options?.now ?? DEFAULT_NOW;
  const dimensionScores = computeDimensionScores(dimensions);
  const overallScore = geometricMean(Object.values(dimensionScores));
  const strengths = identifyStrengths(dimensions, dimensionScores);
  const weaknesses = identifyWeaknesses(dimensions, dimensionScores);
  const recommendations = generateRecommendations(dimensions, dimensionScores);
  const rejectionReasonDistribution = options?.rejectionCounts
    ? computeRejectionDistribution(options.rejectionCounts)
    : undefined;
  const crossDimensionCorrelation = computeCrossDimensionCorrelation(
    dimensionScores,
    options?.correlationThreshold ?? 0.5,
  );

  return {
    generatedAt: now(),
    dimensions,
    summary: {
      overallScore,
      dimensionScores,
      strengths,
      weaknesses,
      recommendations,
    },
    rejectionReasonDistribution,
    crossDimensionCorrelation,
  };
}

function computeDimensionScores(
  dims: EnhancedEvalDimensions,
): Record<string, number> {
  const scores: Record<string, number> = {};

  if (dims.longConversation) {
    scores.longConversation = dims.longConversation.significant
      ? clamp01(dims.longConversation.cohensD / 0.8)
      : 0.2;
  }

  if (dims.chain) {
    scores.chain = clamp01(dims.chain.aggregateChainRecall);
  }

  if (dims.utility) {
    const p95 = dims.utility.p95Utility ?? dims.utility.meanUtility;
    scores.utility = clamp01(dims.utility.meanUtility * 0.7 + p95 * 0.3);
  }

  if (dims.temporalEvolution) {
    const invalidatePenalty = dims.temporalEvolution.invalidateEffect < 0 ? 1 : 0.5;
    scores.temporalEvolution =
      clamp01(Math.max(0, dims.temporalEvolution.writeEffect)) * invalidatePenalty;
  }

  if (dims.topicDrift) {
    const minRecall = dims.topicDrift.perTopicRecall.length > 0
      ? Math.min(...dims.topicDrift.perTopicRecall)
      : 0;
    scores.topicDrift =
      clamp01(1 - dims.topicDrift.crossTopicInterference) * clamp01(minRecall);
  }

  if (dims.budgetPressure) {
    scores.budgetPressure =
      clamp01(dims.budgetPressure.maxRecall) *
      (1 - clamp01(dims.budgetPressure.kneePoint / 512));
  }

  if (dims.conflictResolution) {
    scores.conflictResolution =
      clamp01(dims.conflictResolution.conflictSuppressionRate) *
      (1 - clamp01(dims.conflictResolution.wrongConflictWinnerRate));
  }

  if (dims.hazardSuppression) {
    scores.hazardSuppression =
      clamp01(dims.hazardSuppression.promptInjectionSuppressionRate) *
      clamp01(dims.hazardSuppression.rawLeakSuppressionRate);
  }

  if (dims.crossAxisRejection) {
    scores.crossAxisRejection =
      clamp01(dims.crossAxisRejection.rejectionCoverage) *
      clamp01(dims.crossAxisRejection.correctReasonRate);
  }

  if (dims.latencyBenchmark) {
    scores.latencyBenchmark =
      clamp01(1 - dims.latencyBenchmark.latencyMsP95 / LATENCY_BUDGET_MS) *
      clamp01(1 - dims.latencyBenchmark.tokenOverheadP95 / TOKEN_OVERHEAD_BUDGET);
  }

  return scores;
}

function identifyStrengths(
  dims: EnhancedEvalDimensions,
  scores: Record<string, number>,
): string[] {
  const strengths: string[] = [];

  if (scores.longConversation !== undefined && scores.longConversation >= 0.9) {
    strengths.push(`Long conversation A/B test shows large effect (d=${dims.longConversation!.cohensD.toFixed(2)})`);
  }
  if (scores.chain !== undefined && scores.chain >= 0.9) {
    strengths.push(`Chain recall is excellent (${dims.chain!.aggregateChainRecall.toFixed(2)})`);
  }
  if (scores.utility !== undefined && scores.utility >= 0.8) {
    strengths.push(`Utility score is high (${dims.utility!.meanUtility.toFixed(2)})`);
  }
  if (scores.temporalEvolution !== undefined && scores.temporalEvolution >= 0.5) {
    strengths.push("Temporal write effect is positive — facts are recalled after writing");
  }
  if (scores.topicDrift !== undefined && scores.topicDrift >= 0.9) {
    strengths.push(`Topic isolation is strong (interference=${dims.topicDrift!.crossTopicInterference.toFixed(2)})`);
  }
  if (scores.budgetPressure !== undefined && scores.budgetPressure >= 0.9) {
    strengths.push("Budget pressure resilience is strong at ample budgets");
  }
  if (scores.conflictResolution !== undefined && scores.conflictResolution >= 0.9) {
    strengths.push("Conflict resolution picks correct winners with high suppression");
  }
  if (scores.hazardSuppression !== undefined && scores.hazardSuppression >= 0.9) {
    strengths.push("Hazard sentinel suppression is effective for both prompt injection and raw leak");
  }
  if (scores.crossAxisRejection !== undefined && scores.crossAxisRejection >= 0.9) {
    strengths.push("Cross-axis rejection coverage is complete with correct reasons");
  }
  if (scores.latencyBenchmark !== undefined && scores.latencyBenchmark >= 0.8) {
    strengths.push("Latency benchmark within budget at p95");
  }

  return strengths;
}

function identifyWeaknesses(
  dims: EnhancedEvalDimensions,
  scores: Record<string, number>,
): string[] {
  const weaknesses: string[] = [];

  if (scores.longConversation !== undefined && scores.longConversation < 0.5) {
    weaknesses.push("Long conversation test effect size is small");
  }
  if (scores.chain !== undefined && scores.chain < 0.8) {
    weaknesses.push(`Chain recall is low (${dims.chain!.aggregateChainRecall.toFixed(2)})`);
  }
  if (scores.utility !== undefined && scores.utility < 0.7) {
    weaknesses.push(`Utility score is below target (${dims.utility!.meanUtility.toFixed(2)})`);
  }
  if (scores.temporalEvolution !== undefined && scores.temporalEvolution <= 0) {
    weaknesses.push("Temporal write effect is non-positive — facts not recalled after writing");
  }
  if (scores.topicDrift !== undefined && scores.topicDrift < 0.9) {
    weaknesses.push(`Cross-topic interference is high (${dims.topicDrift!.crossTopicInterference.toFixed(2)})`);
  }
  if (scores.budgetPressure !== undefined && scores.budgetPressure < 0.8) {
    weaknesses.push(`Budget pressure resilience is weak (maxRecall=${dims.budgetPressure!.maxRecall.toFixed(2)})`);
  }
  if (dims.budgetPressure && dims.budgetPressure.kneePoint > 64) {
    weaknesses.push(`Budget knee point is high (${dims.budgetPressure.kneePoint}) — recall drops early`);
  }
  if (scores.conflictResolution !== undefined && scores.conflictResolution < 0.9) {
    weaknesses.push(`Conflict resolution has issues (wrongWinnerRate=${dims.conflictResolution!.wrongConflictWinnerRate.toFixed(2)})`);
  }
  if (scores.hazardSuppression !== undefined && scores.hazardSuppression < 1) {
    weaknesses.push("Hazard sentinel suppression is incomplete — some hazard facts leaked");
  }
  if (scores.crossAxisRejection !== undefined && scores.crossAxisRejection < 1) {
    weaknesses.push(`Cross-axis rejection coverage incomplete (coverage=${dims.crossAxisRejection!.rejectionCoverage.toFixed(2)})`);
  }
  if (scores.latencyBenchmark !== undefined && scores.latencyBenchmark < 0.5) {
    const lb = dims.latencyBenchmark!;
    const latencyRatio = lb.latencyMsP95 / LATENCY_BUDGET_MS;
    const tokenRatio = lb.tokenOverheadP95 / TOKEN_OVERHEAD_BUDGET;
    if (tokenRatio > latencyRatio) {
      weaknesses.push(`Token overhead is high (p95=${lb.tokenOverheadP95}/${TOKEN_OVERHEAD_BUDGET})`);
    } else {
      weaknesses.push(`Latency is high (p95=${lb.latencyMsP95}ms/${LATENCY_BUDGET_MS}ms)`);
    }
  }

  return weaknesses;
}

function generateRecommendations(
  dims: EnhancedEvalDimensions,
  _scores: Record<string, number>,
): string[] {
  const recs: string[] = [];

  if (dims.chain && dims.chain.aggregateChainRecall < 0.8) {
    recs.push("链式召回不足 — 建议检查冲突解决逻辑，确保链式 facts 使用不同 predicate");
  }
  if (dims.utility && dims.utility.meanUtility < 0.7) {
    recs.push("效用分数偏低 — 建议优化 fact 覆盖率和完整性，减少 extraneous facts");
  }
  if (dims.topicDrift && dims.topicDrift.crossTopicInterference > 0.1) {
    recs.push("跨主题干扰较高 — 建议加强 subject 隔离，检查 consumer 的 subject_mismatch 拒绝路径");
  }
  if (dims.budgetPressure && dims.budgetPressure.kneePoint > 64) {
    recs.push("预算拐点偏高 — 建议优化 fact token 估算，减少 fact 序列化长度");
  }
  if (dims.longConversation && dims.longConversation.cohensD < 0.5) {
    recs.push("效应量偏小 — 建议增加样本量或改进 treatment 注入策略");
  }
  if (dims.temporalEvolution && dims.temporalEvolution.invalidateEffect >= 0) {
    recs.push("时间失效效果不明显 — 建议检查 invalid_at 边界设置和 consumer 的 invalidated_at_reference_time 拒绝路径");
  }
  if (dims.conflictResolution && dims.conflictResolution.wrongConflictWinnerRate > 0) {
    recs.push("冲突解决选出错误 winner — 检查 compareFactRank 排序逻辑（confidence → valid_at → reference_time → factId）");
  }
  if (dims.hazardSuppression && dims.hazardSuppression.hazardStringLeaked.length > 0) {
    recs.push("风险字符串泄漏 — 检查 sentinel 正则表达式覆盖度，特别关注 DEFAULT_PROMPT_INJECTION_SENTINEL 和 DEFAULT_RAW_LEAK_SENTINEL");
  }
  if (dims.crossAxisRejection && dims.crossAxisRejection.correctReasonRate < 1) {
    recs.push("拒绝原因匹配错误 — 检查 rejectionReasonBeforeConflict 分支顺序，确保 fact 属性触发正确的拒绝原因");
  }
  if (dims.crossAxisRejection && dims.crossAxisRejection.rejectionCoverage < 1) {
    recs.push("拒绝路径覆盖不全 — 检查未触发的拒绝原因，确保增强评测覆盖全部 13 条拒绝路径");
  }
  if (dims.latencyBenchmark && dims.latencyBenchmark.latencyMsP95 > LATENCY_BUDGET_MS) {
    recs.push(`延迟 P95 超标 (${dims.latencyBenchmark.latencyMsP95}ms > ${LATENCY_BUDGET_MS}ms) — 检查 shadow 读取和 consumer 排序性能`);
  }

  return recs;
}

function computeCrossDimensionCorrelation(
  scores: Record<string, number>,
  threshold: number,
): CrossDimensionCorrelation {
  const CORRELATION_PAIRS: ReadonlyArray<[string, string]> = [
    ["latencyBenchmark", "utility"],
    ["hazardSuppression", "utility"],
    ["budgetPressure", "utility"],
    ["crossAxisRejection", "utility"],
    ["conflictResolution", "utility"],
  ];

  const pairs: JointPassRateEntry[] = [];
  for (const [dimA, dimB] of CORRELATION_PAIRS) {
    const scoreA = scores[dimA];
    const scoreB = scores[dimB];
    if (scoreA === undefined || scoreB === undefined) continue;
    pairs.push({
      pair: `${dimA}+${dimB}`,
      dimensionA: dimA,
      dimensionB: dimB,
      scoreA,
      scoreB,
      bothPass: scoreA >= threshold && scoreB >= threshold,
      jointScore: Math.min(scoreA, scoreB),
      threshold,
    });
  }

  const overallJointPassRate =
    pairs.length === 0 ? 0 : pairs.filter((p) => p.bothPass).length / pairs.length;

  return { pairs, overallJointPassRate };
}

function computeRejectionDistribution(
  rejectionCounts: Record<string, number>,
): RejectionReasonDistributionEntry[] {
  const entries = Object.entries(rejectionCounts).filter(([, count]) => count > 0);
  const total = entries.reduce((sum, [, count]) => sum + count, 0);
  if (total === 0) return [];
  return entries
    .map(([reason, count]) => ({
      reason,
      count,
      percentage: count / total,
    }))
    .sort((a, b) => b.count - a.count);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function geometricMean(values: number[]): number {
  if (values.length === 0) return 0;
  let product = 1;
  for (const v of values) {
    if (v <= 0) return 0;
    product *= v;
  }
  return Math.pow(product, 1 / values.length);
}

export function formatEnhancedReportAsMarkdown(report: EnhancedEvalReport): string {
  const lines: string[] = [];
  lines.push("# Runtime Memory Enhanced Evaluation Report");
  lines.push("");
  lines.push(`- Generated at: ${new Date(report.generatedAt).toISOString()}`);
  lines.push(`- Overall score: ${report.summary.overallScore.toFixed(4)}`);
  lines.push("");

  lines.push("## Dimension Scores");
  lines.push("");
  lines.push("| Dimension | Score |");
  lines.push("|-----------|-------|");
  for (const [dim, score] of Object.entries(report.summary.dimensionScores)) {
    lines.push(`| ${dim} | ${score.toFixed(4)} |`);
  }
  lines.push("");

  lines.push("## Dimension Details");
  lines.push("");

  if (report.dimensions.longConversation) {
    const lc = report.dimensions.longConversation;
    lines.push("### Long Conversation");
    lines.push(`- Significant: ${lc.significant}`);
    lines.push(`- Cohen's d: ${lc.cohensD.toFixed(4)}`);
    lines.push(`- Achieved: ${lc.achieved}`);
    lines.push("");
  }

  if (report.dimensions.chain) {
    const ch = report.dimensions.chain;
    lines.push("### Chain Eval");
    lines.push(`- Aggregate chain recall: ${ch.aggregateChainRecall.toFixed(4)}`);
    lines.push(`- Max depth: ${ch.maxDepth}`);
    lines.push(`- Mean growth rate: ${ch.meanGrowthRate.toFixed(4)}`);
    lines.push("");
  }

  if (report.dimensions.utility) {
    const ut = report.dimensions.utility;
    lines.push("### Utility");
    lines.push(`- Mean utility: ${ut.meanUtility.toFixed(4)}`);
    lines.push(`- Mean coverage: ${ut.meanCoverage.toFixed(4)}`);
    lines.push(`- Mean completeness: ${ut.meanCompleteness.toFixed(4)}`);
    if (ut.p95Utility !== undefined) {
      lines.push(`- P95 utility: ${ut.p95Utility.toFixed(4)}`);
    }
    lines.push("");
  }

  if (report.dimensions.temporalEvolution) {
    const te = report.dimensions.temporalEvolution;
    lines.push("### Temporal Evolution");
    lines.push(`- Write effect: ${te.writeEffect.toFixed(4)}`);
    lines.push(`- Invalidate effect: ${te.invalidateEffect.toFixed(4)}`);
    lines.push("");
  }

  if (report.dimensions.topicDrift) {
    const td = report.dimensions.topicDrift;
    lines.push("### Topic Drift");
    lines.push(`- Per-topic recall: [${td.perTopicRecall.map((r) => r.toFixed(2)).join(", ")}]`);
    lines.push(`- Cross-topic interference: ${td.crossTopicInterference.toFixed(4)}`);
    lines.push(`- Drift recovery time: ${td.driftRecoveryTime}`);
    lines.push("");
  }

  if (report.dimensions.budgetPressure) {
    const bp = report.dimensions.budgetPressure;
    lines.push("### Budget Pressure");
    lines.push(`- Max recall: ${bp.maxRecall.toFixed(4)}`);
    lines.push(`- Min recall: ${bp.minRecall.toFixed(4)}`);
    lines.push(`- Knee point: ${bp.kneePoint}`);
    lines.push(`- Budget elasticity: ${bp.budgetElasticity.toFixed(6)}`);
    lines.push("");
  }

  if (report.dimensions.conflictResolution) {
    const cr = report.dimensions.conflictResolution;
    lines.push("### Conflict Resolution");
    lines.push(`- Wrong conflict winner rate: ${cr.wrongConflictWinnerRate.toFixed(4)}`);
    lines.push(`- Conflict suppression rate: ${cr.conflictSuppressionRate.toFixed(4)}`);
    lines.push("");
  }

  if (report.dimensions.hazardSuppression) {
    const hs = report.dimensions.hazardSuppression;
    lines.push("### Hazard Suppression");
    lines.push(`- Prompt injection suppression rate: ${hs.promptInjectionSuppressionRate.toFixed(4)}`);
    lines.push(`- Raw leak suppression rate: ${hs.rawLeakSuppressionRate.toFixed(4)}`);
    lines.push(`- Hazard strings leaked: ${hs.hazardStringLeaked.length}`);
    lines.push("");
  }

  if (report.dimensions.crossAxisRejection) {
    const ca = report.dimensions.crossAxisRejection;
    lines.push("### Cross-Axis Rejection");
    lines.push(`- Rejection coverage: ${ca.rejectionCoverage.toFixed(4)}`);
    lines.push(`- All reasons fired: ${ca.allReasonsFired}`);
    lines.push(`- Correct reason rate: ${ca.correctReasonRate.toFixed(4)}`);
    lines.push("");
  }

  if (report.dimensions.latencyBenchmark) {
    const lb = report.dimensions.latencyBenchmark;
    lines.push("### Latency Benchmark");
    lines.push(`- Latency p50: ${lb.latencyMsP50.toFixed(2)}ms`);
    lines.push(`- Latency p95: ${lb.latencyMsP95.toFixed(2)}ms`);
    lines.push(`- Token overhead p50: ${lb.tokenOverheadP50.toFixed(2)}`);
    lines.push(`- Token overhead p95: ${lb.tokenOverheadP95.toFixed(2)}`);
    lines.push("");
  }

  if (report.rejectionReasonDistribution && report.rejectionReasonDistribution.length > 0) {
    lines.push("### Rejection Reason Distribution");
    lines.push("");
    lines.push("| Reason | Count | Percentage |");
    lines.push("|--------|-------|------------|");
    for (const entry of report.rejectionReasonDistribution) {
      lines.push(`| ${entry.reason} | ${entry.count} | ${(entry.percentage * 100).toFixed(1)}% |`);
    }
    lines.push("");
  }

  if (report.crossDimensionCorrelation && report.crossDimensionCorrelation.pairs.length > 0) {
    const cdc = report.crossDimensionCorrelation;
    lines.push("### Cross-Dimension Correlation");
    lines.push("");
    lines.push(`- Overall joint pass rate: ${(cdc.overallJointPassRate * 100).toFixed(1)}%`);
    lines.push(`- Threshold: ${cdc.pairs[0].threshold}`);
    lines.push("");
    lines.push("| Pair | Score A | Score B | Both Pass | Joint Score |");
    lines.push("|------|---------|---------|-----------|-------------|");
    for (const entry of cdc.pairs) {
      lines.push(`| ${entry.pair} | ${entry.scoreA.toFixed(4)} | ${entry.scoreB.toFixed(4)} | ${entry.bothPass ? "YES" : "NO"} | ${entry.jointScore.toFixed(4)} |`);
    }
    lines.push("");
  }

  lines.push("## Strengths");
  lines.push("");
  if (report.summary.strengths.length === 0) {
    lines.push("- (none)");
  } else {
    for (const s of report.summary.strengths) {
      lines.push(`- ${s}`);
    }
  }
  lines.push("");

  lines.push("## Weaknesses");
  lines.push("");
  if (report.summary.weaknesses.length === 0) {
    lines.push("- (none)");
  } else {
    for (const w of report.summary.weaknesses) {
      lines.push(`- ${w}`);
    }
  }
  lines.push("");

  lines.push("## Recommendations");
  lines.push("");
  if (report.summary.recommendations.length === 0) {
    lines.push("- (none)");
  } else {
    for (const r of report.summary.recommendations) {
      lines.push(`- ${r}`);
    }
  }
  lines.push("");

  return lines.join("\n");
}
