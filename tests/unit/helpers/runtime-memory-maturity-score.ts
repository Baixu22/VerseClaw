// Maturity score aggregator for the runtime memory evaluation system.
// Aggregates results from all 16 layers (L1-L11 + CV1-CV5) into a single
// maturity score across 8 scoring dimensions, with 4 hard disqualifiers.
//
// This is a META-evaluation tool: it does not run tests itself. Instead, it
// takes the declared results of all layers and computes whether the overall
// system meets the maturity threshold (>=0.7 = mature, <0.5 = immature).
//
// Disqualifiers (any one triggers → overall = 0):
// 1. circular_validation_disqualifier — a layer uses filterQueriesBySeededGroups
// 2. metric_manipulation_disqualifier — a layer excludes recall=0 from denominator
// 3. hollow_llm_disqualifier — all LLM tests skipped when key IS available
// 4. cohen_d_infinity_disqualifier — a layer has Cohen's d = Infinity (zero variance)

export type LayerId =
  | "L1" | "L2" | "L3" | "L4" | "L5"
  | "L6" | "L7" | "L8" | "L9" | "L10" | "L11"
  | "CV1" | "CV2" | "CV3" | "CV4" | "CV5";

export type LayerResult = {
  layerId: LayerId;
  layerName: string;
  passed: boolean;
  skipped: boolean;
  hasLlm: boolean;
  testCount: number;
  /** Pass rate in [0,1]. If absent, derived from `passed` (1.0 / 0.0). */
  passRate?: number;
  // Anti-overfitting flags (true = violation)
  usesFilterQueriesBySeededGroups?: boolean;
  usesExpectedFactIds?: boolean;
  excludesZeroRecallFromDenominator?: boolean;
  cohenDIsInfinity?: boolean;
  hasRealVariance?: boolean;
  // Anti-hallucination flags (true = feature present)
  usesUniqueTokenProbe?: boolean;
  usesAbAblation?: boolean;
  usesNegativeAssertion?: boolean;
  usesMultiJudgeVote?: boolean;
  /**
   * L11 external benchmark Recall@5 in [0,1]. When present on an L11 layer,
   * the `externalBenchmark` dimension is derived via thresholds:
   *   >= 0.70 → 1.0 (pass), 0.50..0.70 → 0.5 (partial), < 0.50 → 0.0 (fail).
   * When L11 is skipped (no LLM key), the dimension is excluded from the
   * overall weighted sum and the remaining weights are renormalized — this
   * does NOT trigger the hollow_llm disqualifier.
   */
  externalBenchmarkRecallAt5?: number;
};

export type MaturityDimension =
  | "correctness"
  | "statisticalRigor"
  | "antiOverfitting"
  | "antiHallucination"
  | "coverage"
  | "crossValidation"
  | "retrievalQuality"
  | "externalBenchmark";

export type MaturityScore = {
  overall: number;
  level: "mature" | "developing" | "immature";
  dimensions: Record<MaturityDimension, number>;
  disqualifiers: string[];
  passed: boolean;
  weights: Record<MaturityDimension, number>;
};

export type MaturityInput = {
  layers: LayerResult[];
  llmKeyAvailable: boolean;
};

export const EXPECTED_LAYERS: readonly LayerId[] = [
  "L1", "L2", "L3", "L4", "L5",
  "L6", "L7", "L8", "L9", "L10", "L11",
  "CV1", "CV2", "CV3", "CV4", "CV5",
] as const;

export const CV_LAYERS: readonly LayerId[] = [
  "CV1", "CV2", "CV3", "CV4", "CV5",
] as const;

/**
 * v3 weights (Phase 7.3 extension). Added externalBenchmark (0.10) for the
 * L11 LoCoMo external benchmark layer; the original 7 dimensions were
 * rebalanced down so the total remains exactly 1.00.
 */
export const DIMENSION_WEIGHTS: Record<MaturityDimension, number> = {
  correctness: 0.20,
  statisticalRigor: 0.12,
  antiOverfitting: 0.16,
  antiHallucination: 0.16,
  coverage: 0.08,
  crossValidation: 0.08,
  retrievalQuality: 0.10,
  externalBenchmark: 0.10,
};

export const MATURITY_THRESHOLD = 0.7;
export const IMMATURE_THRESHOLD = 0.5;

export function computeMaturityScore(input: MaturityInput): MaturityScore {
  const { layers, llmKeyAvailable } = input;
  const disqualifiers: string[] = [];

  // === Disqualifier checks ===

  // 1. circular_validation_disqualifier
  if (layers.some((l) => l.usesFilterQueriesBySeededGroups)) {
    disqualifiers.push("circular_validation_disqualifier");
  }

  // 2. metric_manipulation_disqualifier
  if (layers.some((l) => l.excludesZeroRecallFromDenominator)) {
    disqualifiers.push("metric_manipulation_disqualifier");
  }

  // 3. hollow_llm_disqualifier — all LLM tests skipped when key IS available
  const llmLayers = layers.filter((l) => l.hasLlm);
  const hasLlmLayers = llmLayers.length > 0;
  const allLlmSkipped = hasLlmLayers && llmLayers.every((l) => l.skipped);
  if (llmKeyAvailable && allLlmSkipped) {
    disqualifiers.push("hollow_llm_disqualifier");
  }

  // 4. cohen_d_infinity_disqualifier
  if (layers.some((l) => l.cohenDIsInfinity)) {
    disqualifiers.push("cohen_d_infinity_disqualifier");
  }

  // === Dimension calculations ===

  // 1. Correctness = passed non-skipped layers / total layers
  const correctness = layers.length > 0
    ? layers.filter((l) => l.passed && !l.skipped).length / layers.length
    : 0;

  // 2. Statistical Rigor = layers with finite Cohen's d + real variance / layers with stats
  const statLayers = layers.filter((l) => l.hasRealVariance !== undefined);
  const statisticalRigor = statLayers.length > 0
    ? statLayers.filter((l) => l.hasRealVariance && !l.cohenDIsInfinity).length / statLayers.length
    : 1.0;

  // 3. Anti-Overfitting = layers not using forbidden patterns / total layers
  const antiOverfitting = layers.length > 0
    ? layers.filter((l) =>
        !l.usesFilterQueriesBySeededGroups &&
        !l.usesExpectedFactIds &&
        !l.excludesZeroRecallFromDenominator,
      ).length / layers.length
    : 0;

  // 4. Anti-Hallucination = LLM layers (non-skipped) with all 4 features / total non-skipped LLM
  const llmNonSkipped = llmLayers.filter((l) => !l.skipped);
  const antiHallucination = llmNonSkipped.length > 0
    ? llmNonSkipped.filter((l) =>
        l.usesUniqueTokenProbe &&
        l.usesAbAblation &&
        l.usesNegativeAssertion &&
        l.usesMultiJudgeVote,
      ).length / llmNonSkipped.length
    : 1.0;

  // 5. Coverage = present layers / expected layers
  const presentIds = new Set(layers.map((l) => l.layerId));
  const coverage = EXPECTED_LAYERS.filter((id) => presentIds.has(id)).length / EXPECTED_LAYERS.length;

  // 6. Cross-Validation = CV layers passed / total CV layers
  const cvPresent = layers.filter((l) => CV_LAYERS.includes(l.layerId));
  const crossValidation = cvPresent.length > 0
    ? cvPresent.filter((l) => l.passed && !l.skipped).length / cvPresent.length
    : 0;

  // 7. Retrieval Quality = L10 layer pass rate (Module B hybrid retrieval).
  //    If L10 is absent, the dimension scores 0 — the system must implement
  //    L10 to earn this weight. A skipped L10 contributes 0.
  const l10 = layers.find((l) => l.layerId === "L10");
  const retrievalQuality = l10 && !l10.skipped
    ? (l10.passRate ?? (l10.passed ? 1.0 : 0.0))
    : 0;

  // 8. External Benchmark = L11 LoCoMo benchmark, derived from Recall@5 via
  //    thresholds: >= 0.70 → 1.0, 0.50..0.70 → 0.5, < 0.50 → 0.0.
  //    When L11 is skipped (no LLM key), the dimension is excluded from the
  //    overall weighted sum and the remaining weights are renormalized.
  const l11 = layers.find((l) => l.layerId === "L11");
  let externalBenchmark = 0;
  let externalBenchmarkSkipped = false;
  if (l11) {
    if (l11.skipped) {
      externalBenchmarkSkipped = true;
    } else if (l11.externalBenchmarkRecallAt5 !== undefined) {
      const r5 = l11.externalBenchmarkRecallAt5;
      externalBenchmark = r5 >= 0.70 ? 1.0 : r5 >= 0.50 ? 0.5 : 0.0;
    } else {
      externalBenchmark = l11.passed ? 1.0 : 0.0;
    }
  }

  const dimensions: Record<MaturityDimension, number> = {
    correctness,
    statisticalRigor,
    antiOverfitting,
    antiHallucination,
    coverage,
    crossValidation,
    retrievalQuality,
    externalBenchmark,
  };

  // Overall = weighted average of dimensions. When L11 is skipped, the
  // externalBenchmark dimension is excluded and the remaining weights are
  // renormalized so the system is not penalized for lacking an LLM key.
  let weightedSum = 0;
  let activeWeight = 0;
  for (const dim of Object.keys(dimensions) as MaturityDimension[]) {
    if (dim === "externalBenchmark" && externalBenchmarkSkipped) {
      continue;
    }
    weightedSum += dimensions[dim] * DIMENSION_WEIGHTS[dim];
    activeWeight += DIMENSION_WEIGHTS[dim];
  }
  const weightedAverage = activeWeight > 0 ? weightedSum / activeWeight : 0;

  // Disqualifiers force overall to 0
  const overall = disqualifiers.length > 0 ? 0 : weightedAverage;

  const level: MaturityScore["level"] =
    overall >= MATURITY_THRESHOLD ? "mature"
    : overall < IMMATURE_THRESHOLD ? "immature"
    : "developing";

  return {
    overall,
    level,
    dimensions,
    disqualifiers,
    passed: disqualifiers.length === 0 && overall >= MATURITY_THRESHOLD,
    weights: DIMENSION_WEIGHTS,
  };
}

// Build a "all pass, no disqualifier" scenario for the happy-path test.
// This represents the IDEAL state of the memory system after all layers are implemented.
export function buildAllPassScenario(llmKeyAvailable: boolean): LayerResult[] {
  return [
    { layerId: "L1", layerName: "Write-path semantic filtering", passed: true, skipped: false, hasLlm: false, testCount: 12 },
    { layerId: "L2", layerName: "Read-path consumer rejection", passed: true, skipped: false, hasLlm: false, testCount: 19 },
    {
      layerId: "L3", layerName: "Real LLM usage", passed: true, skipped: !llmKeyAvailable, hasLlm: true, testCount: 8,
      usesUniqueTokenProbe: true, usesAbAblation: true, usesNegativeAssertion: true, usesMultiJudgeVote: true,
    },
    { layerId: "L4", layerName: "Long-term accumulation", passed: true, skipped: false, hasLlm: false, testCount: 10 },
    {
      layerId: "L5", layerName: "Adversarial holdout", passed: true, skipped: !llmKeyAvailable, hasLlm: true, testCount: 6,
      usesUniqueTokenProbe: true, usesAbAblation: true, usesNegativeAssertion: true, usesMultiJudgeVote: true,
      hasRealVariance: true, cohenDIsInfinity: false,
    },
    {
      layerId: "L6", layerName: "Long conversation (1000+30 LLM)", passed: true, skipped: !llmKeyAvailable, hasLlm: true, testCount: 11,
      usesUniqueTokenProbe: true, usesAbAblation: true, usesNegativeAssertion: true, usesMultiJudgeVote: true,
      hasRealVariance: true, cohenDIsInfinity: false,
    },
    {
      layerId: "L7", layerName: "Interleaved read-write", passed: true, skipped: !llmKeyAvailable, hasLlm: true, testCount: 10,
      usesUniqueTokenProbe: true, usesAbAblation: true, usesNegativeAssertion: true, usesMultiJudgeVote: true,
    },
    {
      layerId: "L8", layerName: "Useless content LLM-judge", passed: true, skipped: !llmKeyAvailable, hasLlm: true, testCount: 8,
      usesUniqueTokenProbe: true, usesAbAblation: true, usesNegativeAssertion: true, usesMultiJudgeVote: true,
    },
    { layerId: "L9", layerName: "Maturity score aggregator", passed: true, skipped: false, hasLlm: false, testCount: 7 },
    { layerId: "L10", layerName: "Hybrid retrieval quality (FTS5+vector RRF)", passed: true, skipped: false, hasLlm: false, testCount: 4, passRate: 1.0 },
    {
      layerId: "L11", layerName: "LoCoMo external benchmark", passed: true, skipped: !llmKeyAvailable, hasLlm: true, testCount: 3,
      externalBenchmarkRecallAt5: 0.75,
    },
    {
      layerId: "CV1", layerName: "L1 LLM-judge cross-validation", passed: true, skipped: !llmKeyAvailable, hasLlm: true, testCount: 4,
      usesMultiJudgeVote: true,
    },
    {
      layerId: "CV2", layerName: "L2 LLM-judge cross-validation", passed: true, skipped: !llmKeyAvailable, hasLlm: true, testCount: 4,
      usesNegativeAssertion: true, usesMultiJudgeVote: true,
    },
    {
      layerId: "CV3", layerName: "L3 Multi-judge vote extension", passed: true, skipped: !llmKeyAvailable, hasLlm: true, testCount: 4,
      usesUniqueTokenProbe: true, usesAbAblation: true, usesNegativeAssertion: true, usesMultiJudgeVote: true,
    },
    {
      layerId: "CV4", layerName: "L4 Retention LLM-judge cross-validation", passed: true, skipped: !llmKeyAvailable, hasLlm: true, testCount: 5,
      usesUniqueTokenProbe: true, usesAbAblation: true, usesNegativeAssertion: true, usesMultiJudgeVote: true,
    },
    {
      layerId: "CV5", layerName: "L5 Multi-judge vote enhancement", passed: true, skipped: !llmKeyAvailable, hasLlm: true, testCount: 6,
      usesUniqueTokenProbe: true, usesAbAblation: true, usesNegativeAssertion: true, usesMultiJudgeVote: true,
      hasRealVariance: true, cohenDIsInfinity: false,
    },
  ];
}
