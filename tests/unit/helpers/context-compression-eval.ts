export type FactCategory =
  | 'objective'
  | 'decision'
  | 'constraint'
  | 'blocker'
  | 'file_mutation'
  | 'test_result'
  | 'ui_detail'
  | 'ephemeral';

export type FactSeverity = 'critical' | 'important' | 'nice_to_have';

export type MatchLevel = 'exact' | 'normalized' | 'semantic' | 'missing';

export type AnnotatedFact = {
  id: string;
  text: string;
  category: FactCategory;
  severity: FactSeverity;
  acceptableParaphrases?: string[];
};

export type MatchResult = {
  fact: AnnotatedFact;
  matched: boolean;
  level: MatchLevel;
  similarity?: number;
  evidence?: string;
};

export type SemanticMatchResult = {
  matched: boolean;
  similarity?: number;
  evidence?: string;
};

export type SemanticMatcher = (input: {
  fact: AnnotatedFact;
  haystack: string;
  normalizedFact: string;
  normalizedHaystack: string;
}) => SemanticMatchResult;

export type MatchOptions = {
  semanticMatcher?: SemanticMatcher;
};

export type SeverityMetrics = {
  total: number;
  found: number;
  recall: number;
};

export type CategoryMetrics = SeverityMetrics;

export type FactSetEvaluation = {
  expectedTotal: number;
  expectedFound: number;
  forbiddenTotal: number;
  forbiddenFound: number;
  recall: number;
  precision: number;
  f1: number;
  staleExclusion: number;
  recallBySeverity: Record<FactSeverity, SeverityMetrics>;
  recallByCategory: Record<FactCategory, CategoryMetrics>;
  weightedRecall: number;
  compressionRatio: number | null;
  informationDensity: number | null;
  matchLevelCounts: Record<MatchLevel, number>;
  expectedMatches: MatchResult[];
  forbiddenMatches: MatchResult[];
};

export type CohortAggregate = {
  rounds: number;
  recallMean: number;
  recallMin: number;
  recallMax: number;
  precisionMean: number;
  precisionMin: number;
  precisionMax: number;
  f1Mean: number;
  staleExclusionMean: number;
  weightedRecallMean: number;
  compressionRatioMean: number | null;
  informationDensityMean: number | null;
  recallCriticalMean: number;
  recallCriticalMin: number;
  recallImportantMean: number;
  recallImportantMin: number;
  recallNiceToHaveMean: number;
  criticalDroppedSamples: number;
  staleLeakSamples: number;
  forbiddenFoundTotal: number;
  expectedFoundTotal: number;
  expectedTotal: number;
  matchLevelCounts: Record<MatchLevel, number>;
};

export type CausalChain = {
  id: string;
  steps: AnnotatedFact[];
  criticalStepIds?: string[];
};

export type CausalChainEvaluation = {
  totalChains: number;
  preservedChains: number;
  preservationRate: number;
  details: Array<{
    id: string;
    requiredStepIds: string[];
    foundStepIds: string[];
    preserved: boolean;
  }>;
};

export type ContinuationEval = {
  taskId: string;
  firstActionMatch: boolean;
  criticalActionMatch: boolean;
  noRepeatedWork: boolean;
  noContradictoryAction: boolean;
  completedWithCompressedContext?: boolean;
  completedWithFullContext?: boolean;
};

export type DownstreamActionKind =
  | 'read_file'
  | 'edit_file'
  | 'run_test'
  | 'run_command'
  | 'decision'
  | 'ask_user'
  | 'send_message'
  | 'other';

export type DownstreamAction = {
  id: string;
  kind: DownstreamActionKind;
  target?: string;
  decision?: string;
  label?: string;
  critical?: boolean;
  repeatsCompletedActionId?: string;
  contradictsDecisionId?: string;
};

export type ContinuationScenario = {
  taskId: string;
  fullContextActions: DownstreamAction[];
  compressedActions: DownstreamAction[];
  completedActionIdsBeforeResume?: string[];
  rejectedDecisionIds?: string[];
  requiredCriticalActionIds?: string[];
  completedWithCompressedContext?: boolean;
  completedWithFullContext?: boolean;
};

export type ContinuationAggregate = {
  total: number;
  firstActionMatchRate: number;
  criticalActionMatchRate: number;
  noRepeatedWorkRate: number;
  noContradictoryActionRate: number;
  decisionConsistencyRate: number;
  taskCompletionDelta: number | null;
};

export type Layer3Thresholds = {
  firstActionMatchRateMin: number;
  criticalActionMatchRateMin: number;
  noRepeatedWorkRateMin: number;
  noContradictoryActionRateMin: number;
  decisionConsistencyRateMin: number;
  taskCompletionDeltaMax: number;
};

export type TranscriptLength = 'short' | 'medium' | 'long' | 'extreme';
export type EditPosition = 'early' | 'middle' | 'late';
export type FactDensity = 'sparse' | 'normal' | 'dense';

export type EvalSampleConfig = {
  id: string;
  totalFacts: number;
  staleFacts: number;
  runtimeFacts: number;
  transcriptLength: TranscriptLength;
  editPosition: EditPosition;
  factDensity: FactDensity;
  confuserCount: number;
  multiEditCount: number;
  causalChainCount: number;
};

export type EvalSampleMatrixInput = {
  transcriptLengths?: TranscriptLength[];
  editPositions?: EditPosition[];
  factDensities?: FactDensity[];
  baseFacts?: number;
  staleFacts?: number;
  runtimeFacts?: number;
};

export type ContradictionProbe = {
  id: string;
  original: AnnotatedFact;
  contradiction: AnnotatedFact;
};

export type FabricationProbe = {
  id: string;
  fabricated: AnnotatedFact;
};

export type FaithfulnessJudgePromptInput = {
  originalTranscript: string;
  compressedSummary: string;
  expectedFacts?: AnnotatedFact[];
  causalChains?: CausalChain[];
};

export type DeterministicFaithfulnessEvaluation = {
  completeness: boolean;
  accuracy: boolean;
  causalChain: boolean;
  noFabrication: boolean;
  actionability: boolean;
  score: number;
  completenessRate: number;
  accuracyRate: number;
  causalChainPreservation: number;
  contradictionRate: number;
  fabricatedFactsFound: number;
  contradictions: Array<{
    id: string;
    originalFactId: string;
    contradictionFactId: string;
  }>;
  causalChains: CausalChainEvaluation;
};

export type Layer1Thresholds = {
  recallCriticalMeanMin: number;
  recallCriticalMinMin: number;
  recallImportantMeanMin: number;
  recallNiceToHaveMeanMin: number;
  weightedRecallMeanMin: number;
  precisionMeanMin: number;
  forbiddenFoundTotalMax: number;
  compressionRatioMeanMin: number;
  compressionRatioMeanMax: number;
  informationDensityMeanMin: number;
};

export type GateCheck = {
  id: string;
  pass: boolean;
  actual: number | null;
  expected: string;
};

export type GateAssessment = {
  pass: boolean;
  checks: GateCheck[];
};

const FACT_CATEGORIES: FactCategory[] = [
  'objective',
  'decision',
  'constraint',
  'blocker',
  'file_mutation',
  'test_result',
  'ui_detail',
  'ephemeral',
];

const FACT_SEVERITIES: FactSeverity[] = ['critical', 'important', 'nice_to_have'];

const SEVERITY_WEIGHTS: Record<FactSeverity, number> = {
  critical: 3,
  important: 2,
  nice_to_have: 1,
};

const DEFAULT_TRANSCRIPT_LENGTHS: TranscriptLength[] = ['short', 'medium', 'long'];
const DEFAULT_EDIT_POSITIONS: EditPosition[] = ['early', 'middle', 'late'];
const DEFAULT_FACT_DENSITIES: FactDensity[] = ['sparse', 'normal', 'dense'];

export const DEFAULT_LAYER1_CI_THRESHOLDS: Layer1Thresholds = {
  recallCriticalMeanMin: 0.95,
  recallCriticalMinMin: 1,
  recallImportantMeanMin: 0.85,
  recallNiceToHaveMeanMin: 0.5,
  weightedRecallMeanMin: 0.9,
  precisionMeanMin: 1,
  forbiddenFoundTotalMax: 0,
  compressionRatioMeanMin: 0.12,
  compressionRatioMeanMax: 0.5,
  informationDensityMeanMin: 2,
};

export const DEFAULT_LAYER3_THRESHOLDS: Layer3Thresholds = {
  firstActionMatchRateMin: 0.95,
  criticalActionMatchRateMin: 0.95,
  noRepeatedWorkRateMin: 0.98,
  noContradictoryActionRateMin: 1,
  decisionConsistencyRateMin: 0.95,
  taskCompletionDeltaMax: 0.08,
};

function emptySeverityMetrics(): Record<FactSeverity, SeverityMetrics> {
  return {
    critical: { total: 0, found: 0, recall: 1 },
    important: { total: 0, found: 0, recall: 1 },
    nice_to_have: { total: 0, found: 0, recall: 1 },
  };
}

function emptyCategoryMetrics(): Record<FactCategory, CategoryMetrics> {
  return {
    objective: { total: 0, found: 0, recall: 1 },
    decision: { total: 0, found: 0, recall: 1 },
    constraint: { total: 0, found: 0, recall: 1 },
    blocker: { total: 0, found: 0, recall: 1 },
    file_mutation: { total: 0, found: 0, recall: 1 },
    test_result: { total: 0, found: 0, recall: 1 },
    ui_detail: { total: 0, found: 0, recall: 1 },
    ephemeral: { total: 0, found: 0, recall: 1 },
  };
}

function round(value: number): number {
  return Number(value.toFixed(4));
}

function mean(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

export function normalizeEvalText(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\p{P}\p{S}\s_]+/gu, '');
}

export function paraphraseSemanticMatcher(input: {
  fact: AnnotatedFact;
  haystack: string;
  normalizedFact: string;
  normalizedHaystack: string;
}): SemanticMatchResult {
  for (const paraphrase of input.fact.acceptableParaphrases ?? []) {
    const normalizedParaphrase = normalizeEvalText(paraphrase);
    if (normalizedParaphrase && input.normalizedHaystack.includes(normalizedParaphrase)) {
      return {
        matched: true,
        similarity: 1,
        evidence: paraphrase,
      };
    }
  }
  return { matched: false };
}

export function matchFact(fact: AnnotatedFact, haystack: string, options: MatchOptions = {}): MatchResult {
  if (haystack.includes(fact.text)) {
    return { fact, matched: true, level: 'exact' };
  }
  const normalizedFact = normalizeEvalText(fact.text);
  const normalizedHaystack = normalizeEvalText(haystack);
  if (normalizedFact && normalizedHaystack.includes(normalizedFact)) {
    return { fact, matched: true, level: 'normalized' };
  }
  const semanticMatch = options.semanticMatcher?.({
    fact,
    haystack,
    normalizedFact,
    normalizedHaystack,
  });
  if (semanticMatch?.matched) {
    return {
      fact,
      matched: true,
      level: 'semantic',
      similarity: semanticMatch.similarity,
      evidence: semanticMatch.evidence,
    };
  }
  return { fact, matched: false, level: 'missing' };
}

export function estimateEvalTokens(value: string): number {
  const normalized = value.normalize('NFKC');
  const cjk = normalized.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu)?.length ?? 0;
  const words = normalized
    .replace(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu, ' ')
    .match(/[A-Za-z0-9_./\\:-]+/g)?.length ?? 0;
  return Math.max(1, cjk + words);
}

export function evaluateFactSet(input: {
  haystack: string;
  expected: AnnotatedFact[];
  forbidden?: AnnotatedFact[];
  originalText?: string;
  compressedText?: string;
  matchOptions?: MatchOptions;
}): FactSetEvaluation {
  const forbidden = input.forbidden ?? [];
  const expectedMatches = input.expected.map((fact) => matchFact(fact, input.haystack, input.matchOptions));
  const forbiddenMatches = forbidden.map((fact) => matchFact(fact, input.haystack, input.matchOptions));
  const expectedFound = expectedMatches.filter((item) => item.matched).length;
  const forbiddenFound = forbiddenMatches.filter((item) => item.matched).length;
  const recall = input.expected.length ? expectedFound / input.expected.length : 1;
  const precision = expectedFound / Math.max(expectedFound + forbiddenFound, 1);
  const f1 = recall + precision > 0 ? (2 * recall * precision) / (recall + precision) : 0;
  const staleExclusion = forbidden.length ? (forbidden.length - forbiddenFound) / forbidden.length : 1;
  const recallBySeverity = emptySeverityMetrics();
  const recallByCategory = emptyCategoryMetrics();
  const matchLevelCounts: Record<MatchLevel, number> = { exact: 0, normalized: 0, semantic: 0, missing: 0 };

  for (const match of expectedMatches) {
    matchLevelCounts[match.level] += 1;
    const severityMetrics = recallBySeverity[match.fact.severity];
    severityMetrics.total += 1;
    if (match.matched) severityMetrics.found += 1;
    const categoryMetrics = recallByCategory[match.fact.category];
    categoryMetrics.total += 1;
    if (match.matched) categoryMetrics.found += 1;
  }
  for (const severity of FACT_SEVERITIES) {
    const metrics = recallBySeverity[severity];
    metrics.recall = metrics.total ? metrics.found / metrics.total : 1;
  }
  for (const category of FACT_CATEGORIES) {
    const metrics = recallByCategory[category];
    metrics.recall = metrics.total ? metrics.found / metrics.total : 1;
  }

  const weightTotal = FACT_SEVERITIES.reduce((sum, severity) => sum + SEVERITY_WEIGHTS[severity], 0);
  const weightedRecall = FACT_SEVERITIES.reduce(
    (sum, severity) => sum + (SEVERITY_WEIGHTS[severity] * recallBySeverity[severity].recall),
    0,
  ) / weightTotal;
  const compressionRatio = input.originalText && input.compressedText
    ? estimateEvalTokens(input.compressedText) / estimateEvalTokens(input.originalText)
    : null;
  const informationDensity = compressionRatio && compressionRatio > 0
    ? weightedRecall / compressionRatio
    : null;

  return {
    expectedTotal: input.expected.length,
    expectedFound,
    forbiddenTotal: forbidden.length,
    forbiddenFound,
    recall,
    precision,
    f1,
    staleExclusion,
    recallBySeverity,
    recallByCategory,
    weightedRecall,
    compressionRatio,
    informationDensity,
    matchLevelCounts,
    expectedMatches,
    forbiddenMatches,
  };
}

export function aggregateFactSetEvaluations(evaluations: FactSetEvaluation[]): CohortAggregate {
  const compressionRatios = evaluations
    .map((item) => item.compressionRatio)
    .filter((value): value is number => typeof value === 'number');
  const informationDensities = evaluations
    .map((item) => item.informationDensity)
    .filter((value): value is number => typeof value === 'number');
  return {
    rounds: evaluations.length,
    recallMean: round(mean(evaluations.map((item) => item.recall))),
    recallMin: round(Math.min(...evaluations.map((item) => item.recall))),
    recallMax: round(Math.max(...evaluations.map((item) => item.recall))),
    precisionMean: round(mean(evaluations.map((item) => item.precision))),
    precisionMin: round(Math.min(...evaluations.map((item) => item.precision))),
    precisionMax: round(Math.max(...evaluations.map((item) => item.precision))),
    f1Mean: round(mean(evaluations.map((item) => item.f1))),
    staleExclusionMean: round(mean(evaluations.map((item) => item.staleExclusion))),
    weightedRecallMean: round(mean(evaluations.map((item) => item.weightedRecall))),
    compressionRatioMean: compressionRatios.length ? round(mean(compressionRatios)) : null,
    informationDensityMean: informationDensities.length ? round(mean(informationDensities)) : null,
    recallCriticalMean: round(mean(evaluations.map((item) => item.recallBySeverity.critical.recall))),
    recallCriticalMin: round(Math.min(...evaluations.map((item) => item.recallBySeverity.critical.recall))),
    recallImportantMean: round(mean(evaluations.map((item) => item.recallBySeverity.important.recall))),
    recallImportantMin: round(Math.min(...evaluations.map((item) => item.recallBySeverity.important.recall))),
    recallNiceToHaveMean: round(mean(evaluations.map((item) => item.recallBySeverity.nice_to_have.recall))),
    criticalDroppedSamples: evaluations.filter((item) => item.recallBySeverity.critical.total - item.recallBySeverity.critical.found > 0).length,
    staleLeakSamples: evaluations.filter((item) => item.forbiddenFound > 0).length,
    forbiddenFoundTotal: evaluations.reduce((sum, item) => sum + item.forbiddenFound, 0),
    expectedFoundTotal: evaluations.reduce((sum, item) => sum + item.expectedFound, 0),
    expectedTotal: evaluations.reduce((sum, item) => sum + item.expectedTotal, 0),
    matchLevelCounts: evaluations.reduce<Record<MatchLevel, number>>((acc, item) => {
      acc.exact += item.matchLevelCounts.exact;
      acc.normalized += item.matchLevelCounts.normalized;
      acc.semantic += item.matchLevelCounts.semantic;
      acc.missing += item.matchLevelCounts.missing;
      return acc;
    }, { exact: 0, normalized: 0, semantic: 0, missing: 0 }),
  };
}

export function buildEvalSampleMatrix(input: EvalSampleMatrixInput = {}): EvalSampleConfig[] {
  const transcriptLengths = input.transcriptLengths ?? DEFAULT_TRANSCRIPT_LENGTHS;
  const editPositions = input.editPositions ?? DEFAULT_EDIT_POSITIONS;
  const factDensities = input.factDensities ?? DEFAULT_FACT_DENSITIES;
  const configs: EvalSampleConfig[] = [];
  for (const transcriptLength of transcriptLengths) {
    for (const editPosition of editPositions) {
      for (const factDensity of factDensities) {
        const densityMultiplier = factDensity === 'dense' ? 2 : factDensity === 'sparse' ? 0.75 : 1;
        const lengthMultiplier = transcriptLength === 'extreme' ? 4 : transcriptLength === 'long' ? 2 : transcriptLength === 'medium' ? 1.25 : 1;
        const id = `${transcriptLength}-${editPosition}-${factDensity}`;
        configs.push({
          id,
          totalFacts: Math.max(1, Math.round((input.baseFacts ?? 14) * densityMultiplier)),
          staleFacts: input.staleFacts ?? 5,
          runtimeFacts: input.runtimeFacts ?? 6,
          transcriptLength,
          editPosition,
          factDensity,
          confuserCount: Math.round(2 * densityMultiplier * lengthMultiplier),
          multiEditCount: editPosition === 'middle' ? 2 : 1,
          causalChainCount: transcriptLength === 'short' ? 1 : transcriptLength === 'medium' ? 2 : 3,
        });
      }
    }
  }
  return configs;
}

export function assessLayer1Gate(
  aggregate: CohortAggregate,
  thresholds: Layer1Thresholds = DEFAULT_LAYER1_CI_THRESHOLDS,
): GateAssessment {
  const checks: GateCheck[] = [
    {
      id: 'recallCritical.mean',
      pass: aggregate.recallCriticalMean >= thresholds.recallCriticalMeanMin,
      actual: aggregate.recallCriticalMean,
      expected: `>= ${thresholds.recallCriticalMeanMin}`,
    },
    {
      id: 'recallCritical.min',
      pass: aggregate.recallCriticalMin >= thresholds.recallCriticalMinMin,
      actual: aggregate.recallCriticalMin,
      expected: `>= ${thresholds.recallCriticalMinMin}`,
    },
    {
      id: 'recallImportant.mean',
      pass: aggregate.recallImportantMean >= thresholds.recallImportantMeanMin,
      actual: aggregate.recallImportantMean,
      expected: `>= ${thresholds.recallImportantMeanMin}`,
    },
    {
      id: 'recallNiceToHave.mean',
      pass: aggregate.recallNiceToHaveMean >= thresholds.recallNiceToHaveMeanMin,
      actual: aggregate.recallNiceToHaveMean,
      expected: `>= ${thresholds.recallNiceToHaveMeanMin}`,
    },
    {
      id: 'weightedRecall.mean',
      pass: aggregate.weightedRecallMean >= thresholds.weightedRecallMeanMin,
      actual: aggregate.weightedRecallMean,
      expected: `>= ${thresholds.weightedRecallMeanMin}`,
    },
    {
      id: 'precision.mean',
      pass: aggregate.precisionMean >= thresholds.precisionMeanMin,
      actual: aggregate.precisionMean,
      expected: `>= ${thresholds.precisionMeanMin}`,
    },
    {
      id: 'forbiddenFound.total',
      pass: aggregate.forbiddenFoundTotal <= thresholds.forbiddenFoundTotalMax,
      actual: aggregate.forbiddenFoundTotal,
      expected: `<= ${thresholds.forbiddenFoundTotalMax}`,
    },
    {
      id: 'criticalDropped.samples',
      pass: aggregate.criticalDroppedSamples === 0,
      actual: aggregate.criticalDroppedSamples,
      expected: '= 0',
    },
    {
      id: 'staleLeak.samples',
      pass: aggregate.staleLeakSamples === 0,
      actual: aggregate.staleLeakSamples,
      expected: '= 0',
    },
  ];
  return {
    pass: checks.every((check) => check.pass),
    checks,
  };
}

export function evaluateCausalChains(input: {
  haystack: string;
  chains: CausalChain[];
  matchOptions?: MatchOptions;
}): CausalChainEvaluation {
  const details = input.chains.map((chain) => {
    const requiredStepIds = chain.criticalStepIds ?? chain.steps.map((step) => step.id);
    const foundStepIds = chain.steps
      .filter((step) => requiredStepIds.includes(step.id) && matchFact(step, input.haystack, input.matchOptions).matched)
      .map((step) => step.id);
    return {
      id: chain.id,
      requiredStepIds,
      foundStepIds,
      preserved: requiredStepIds.every((id) => foundStepIds.includes(id)),
    };
  });
  const preservedChains = details.filter((item) => item.preserved).length;
  return {
    totalChains: input.chains.length,
    preservedChains,
    preservationRate: input.chains.length ? preservedChains / input.chains.length : 1,
    details,
  };
}

export function buildFaithfulnessJudgePrompt(input: FaithfulnessJudgePromptInput): string {
  const expectedFacts = input.expectedFacts?.length
    ? input.expectedFacts.map((fact) => `- [${fact.severity}/${fact.category}] ${fact.text}`).join('\n')
    : '- No explicit annotated facts supplied.';
  const causalChains = input.causalChains?.length
    ? input.causalChains.map((chain) => (
      `- ${chain.id}: ${chain.steps.map((step) => step.text).join(' -> ')}`
    )).join('\n')
    : '- No explicit causal chains supplied.';
  return [
    'You are evaluating a context summary for faithfulness.',
    '',
    '## Original Transcript',
    input.originalTranscript,
    '',
    '## Compressed Summary',
    input.compressedSummary,
    '',
    '## Annotated Critical Facts',
    expectedFacts,
    '',
    '## Annotated Causal Chains',
    causalChains,
    '',
    '## Evaluation Criteria',
    'For each question, answer YES or NO with a one-sentence justification:',
    '1. COMPLETENESS: Does the summary preserve all critical decisions and their rationale?',
    '2. ACCURACY: Is every factual claim in the summary actually present in the original?',
    '3. CAUSAL_CHAIN: If the original contains a try/fail/root-cause/switch chain, does the summary preserve it?',
    '4. NO_FABRICATION: Does the summary avoid adding information not in the original?',
    '5. ACTIONABILITY: Could an agent reading ONLY the summary correctly continue the task?',
    '',
    'Return strict JSON: {"completeness": boolean, "accuracy": boolean, "causal_chain": boolean, "no_fabrication": boolean, "actionability": boolean, "score": number, "justifications": string[]}',
  ].join('\n');
}

export function evaluateDeterministicFaithfulness(input: {
  originalText: string;
  summaryText: string;
  expectedFacts: AnnotatedFact[];
  contradictionProbes?: ContradictionProbe[];
  fabricationProbes?: FabricationProbe[];
  causalChains?: CausalChain[];
  matchOptions?: MatchOptions;
}): DeterministicFaithfulnessEvaluation {
  const expectedInSummary = evaluateFactSet({
    haystack: input.summaryText,
    expected: input.expectedFacts,
    matchOptions: input.matchOptions,
  });
  const expectedInOriginal = evaluateFactSet({
    haystack: input.originalText,
    expected: input.expectedFacts,
    matchOptions: input.matchOptions,
  });
  const causalChains = evaluateCausalChains({
    haystack: input.summaryText,
    chains: input.causalChains ?? [],
    matchOptions: input.matchOptions,
  });
  const contradictions = (input.contradictionProbes ?? []).flatMap((probe) => {
    const originalPresent = matchFact(probe.original, input.originalText, input.matchOptions).matched;
    const contradictionPresent = matchFact(probe.contradiction, input.summaryText, input.matchOptions).matched;
    return originalPresent && contradictionPresent
      ? [{
          id: probe.id,
          originalFactId: probe.original.id,
          contradictionFactId: probe.contradiction.id,
        }]
      : [];
  });
  const fabricatedFactsFound = (input.fabricationProbes ?? [])
    .filter((probe) => (
      !matchFact(probe.fabricated, input.originalText, input.matchOptions).matched
      && matchFact(probe.fabricated, input.summaryText, input.matchOptions).matched
    ))
    .length;
  const completenessRate = expectedInSummary.recallBySeverity.critical.recall;
  const accuracyRate = expectedInOriginal.expectedTotal
    ? expectedInSummary.expectedFound / Math.max(expectedInOriginal.expectedFound, 1)
    : 1;
  const contradictionRate = input.contradictionProbes?.length
    ? contradictions.length / input.contradictionProbes.length
    : 0;
  const completeness = completenessRate >= 0.95;
  const accuracy = accuracyRate <= 1 && contradictions.length === 0;
  const causalChain = causalChains.preservationRate >= 0.8;
  const noFabrication = fabricatedFactsFound === 0;
  const actionability = completeness && causalChain && noFabrication;
  const booleans = [completeness, accuracy, causalChain, noFabrication, actionability];
  return {
    completeness,
    accuracy,
    causalChain,
    noFabrication,
    actionability,
    score: round((booleans.filter(Boolean).length / booleans.length) * 10),
    completenessRate,
    accuracyRate,
    causalChainPreservation: causalChains.preservationRate,
    contradictionRate,
    fabricatedFactsFound,
    contradictions,
    causalChains,
  };
}

export function actionSignature(action: DownstreamAction): string {
  return normalizeEvalText([
    action.kind,
    action.target ?? '',
    action.decision ?? '',
  ].filter(Boolean).join(':'));
}

function hasActionSignature(actions: DownstreamAction[], signature: string): boolean {
  return actions.some((action) => actionSignature(action) === signature);
}

export function evaluateContinuationScenario(scenario: ContinuationScenario): ContinuationEval {
  const fullFirst = scenario.fullContextActions[0];
  const compressedFirst = scenario.compressedActions[0];
  const firstActionMatch = Boolean(
    fullFirst
    && compressedFirst
    && actionSignature(fullFirst) === actionSignature(compressedFirst),
  );
  const requiredCriticalActionIds = scenario.requiredCriticalActionIds
    ?? scenario.fullContextActions.filter((action) => action.critical).map((action) => action.id);
  const requiredCriticalActions = requiredCriticalActionIds.flatMap((id) => {
    const action = scenario.fullContextActions.find((item) => item.id === id);
    return action ? [action] : [];
  });
  const criticalActionMatch = requiredCriticalActions.every((action) => (
    hasActionSignature(scenario.compressedActions, actionSignature(action))
  ));
  const completedSignatures = new Set(
    (scenario.completedActionIdsBeforeResume ?? []).flatMap((id) => {
      const action = scenario.fullContextActions.find((item) => item.id === id);
      return action ? [actionSignature(action)] : [];
    }),
  );
  const noRepeatedWork = scenario.compressedActions.every((action) => (
    !action.repeatsCompletedActionId
    && !completedSignatures.has(actionSignature(action))
  ));
  const rejectedDecisionIds = new Set(scenario.rejectedDecisionIds ?? []);
  const noContradictoryAction = scenario.compressedActions.every((action) => (
    !action.contradictsDecisionId
    && !(action.decision && rejectedDecisionIds.has(action.decision))
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

export function aggregateContinuationEvaluations(evaluations: ContinuationEval[]): ContinuationAggregate {
  const fullCompleted = evaluations.filter((item) => item.completedWithFullContext === true).length;
  const compressedCompleted = evaluations.filter((item) => item.completedWithCompressedContext === true).length;
  return {
    total: evaluations.length,
    firstActionMatchRate: mean(evaluations.map((item) => item.firstActionMatch ? 1 : 0)),
    criticalActionMatchRate: mean(evaluations.map((item) => item.criticalActionMatch ? 1 : 0)),
    noRepeatedWorkRate: mean(evaluations.map((item) => item.noRepeatedWork ? 1 : 0)),
    noContradictoryActionRate: mean(evaluations.map((item) => item.noContradictoryAction ? 1 : 0)),
    decisionConsistencyRate: mean(evaluations.map((item) => item.criticalActionMatch && item.noContradictoryAction ? 1 : 0)),
    taskCompletionDelta: evaluations.some((item) => item.completedWithFullContext !== undefined || item.completedWithCompressedContext !== undefined)
      ? Math.max(0, (fullCompleted / evaluations.length) - (compressedCompleted / evaluations.length))
      : null,
  };
}

export function assessLayer3Gate(
  aggregate: ContinuationAggregate,
  thresholds: Layer3Thresholds = DEFAULT_LAYER3_THRESHOLDS,
): GateAssessment {
  const checks: GateCheck[] = [
    {
      id: 'firstActionMatch.rate',
      pass: aggregate.firstActionMatchRate >= thresholds.firstActionMatchRateMin,
      actual: aggregate.firstActionMatchRate,
      expected: `>= ${thresholds.firstActionMatchRateMin}`,
    },
    {
      id: 'criticalActionMatch.rate',
      pass: aggregate.criticalActionMatchRate >= thresholds.criticalActionMatchRateMin,
      actual: aggregate.criticalActionMatchRate,
      expected: `>= ${thresholds.criticalActionMatchRateMin}`,
    },
    {
      id: 'noRepeatedWork.rate',
      pass: aggregate.noRepeatedWorkRate >= thresholds.noRepeatedWorkRateMin,
      actual: aggregate.noRepeatedWorkRate,
      expected: `>= ${thresholds.noRepeatedWorkRateMin}`,
    },
    {
      id: 'noContradictoryAction.rate',
      pass: aggregate.noContradictoryActionRate >= thresholds.noContradictoryActionRateMin,
      actual: aggregate.noContradictoryActionRate,
      expected: `>= ${thresholds.noContradictoryActionRateMin}`,
    },
    {
      id: 'decisionConsistency.rate',
      pass: aggregate.decisionConsistencyRate >= thresholds.decisionConsistencyRateMin,
      actual: aggregate.decisionConsistencyRate,
      expected: `>= ${thresholds.decisionConsistencyRateMin}`,
    },
  ];
  if (aggregate.taskCompletionDelta !== null) {
    checks.push({
      id: 'taskCompletion.delta',
      pass: aggregate.taskCompletionDelta <= thresholds.taskCompletionDeltaMax,
      actual: aggregate.taskCompletionDelta,
      expected: `<= ${thresholds.taskCompletionDeltaMax}`,
    });
  }
  return {
    pass: checks.every((check) => check.pass),
    checks,
  };
}

// P4 paired-trajectory and model-cascade types/functions.

export type PairedTrajectoryRow = {
  sampleId: string;
  compressedSummary: string;
  fullContextSuccess: boolean;
  compressedSuccess: boolean;
  failureKind?: 'wrong_next_action' | 'omitted_blocker' | 'repeated_work' | 'stale_branch' | 'other' | null;
  compressorModel?: string;
  retryCount?: number;
  latencyMs?: number;
  tokenUsage?: { input: number; output: number; cacheRead?: number; cacheWrite?: number };
  cost?: { input: number; output: number; cacheRead?: number; cacheWrite?: number };
};

export type TrajectoryDamageClass =
  | 'compression_induced_failure'
  | 'preexisting_failure'
  | 'compressed_success'
  | 'indeterminate';

export type CriticalAtomCriticResult = {
  sampleId: string;
  model: string;
  promptVersion: string;
  missingAtoms: Array<{
    canonicalIdentity: string;
    type: string;
    severity: 'critical' | 'important' | 'nice_to_have';
    rationale: string;
  }>;
  repairGuideline: string;
};

export type FailureGuideline = {
  id: string;
  canonicalIdentity: string;
  type: string;
  severity: string;
  failureKind: string;
  count: number;
  sampleIds: string[];
  repairGuideline: string;
};

export type FailureGuidelineSet = {
  version: 1;
  generatedAt: string;
  atomLimit: number;
  guidelines: FailureGuideline[];
};

export type ModelIndependenceAudit = {
  ok: boolean;
  reason: string;
  compressorModel?: string;
  judgeModel?: string;
  schemaFreeModel?: string;
  continuationModel?: string;
  criticModel?: string;
};

export function classifyPairedTrajectory(row: PairedTrajectoryRow): TrajectoryDamageClass {
  if (row.fullContextSuccess && !row.compressedSuccess) {
    return 'compression_induced_failure';
  }
  if (!row.fullContextSuccess) {
    return 'preexisting_failure';
  }
  if (row.compressedSuccess) {
    return 'compressed_success';
  }
  return 'indeterminate';
}

export function assertModelIndependence(params: {
  compressorModel?: string;
  judgeModel?: string;
  schemaFreeModel?: string;
  continuationModel?: string;
  criticModel?: string;
}): ModelIndependenceAudit {
  const compressor = params.compressorModel?.trim();
  const judge = params.judgeModel?.trim();
  const schemaFree = params.schemaFreeModel?.trim();
  const continuation = params.continuationModel?.trim();
  const critic = params.criticModel?.trim();
  const evaluatorModels = [...new Set([judge, schemaFree, continuation, critic].filter(Boolean))];
  const sharedWithCompressor = evaluatorModels.filter((model) => model === compressor);
  const ok = Boolean(compressor) && evaluatorModels.length > 0 && sharedWithCompressor.length === 0;
  return {
    ok,
    reason: !compressor
      ? 'Missing explicit compressor model.'
      : evaluatorModels.length === 0
        ? 'Missing explicit judge/schema-free/continuation/critic model.'
        : sharedWithCompressor.length > 0
          ? `Compressor model ${compressor} is reused by an evaluation stage; compressor must differ from judge/schema-free/continuation/critic models.`
          : `Compressor ${compressor} differs from every configured evaluation model: ${evaluatorModels.join(', ')}.`,
    ...(compressor ? { compressorModel: compressor } : {}),
    ...(judge ? { judgeModel: judge } : {}),
    ...(schemaFree ? { schemaFreeModel: schemaFree } : {}),
    ...(continuation ? { continuationModel: continuation } : {}),
    ...(critic ? { criticModel: critic } : {}),
  };
}

export function buildFailureGuidelines(params: {
  rows: PairedTrajectoryRow[];
  criticResults?: CriticalAtomCriticResult[];
  maxAtoms?: number;
  generatedAt?: string;
}): FailureGuidelineSet {
  const maxAtoms = Math.max(1, Math.floor(params.maxAtoms ?? 24));
  const byIdentity = new Map<string, FailureGuideline>();
  for (const row of params.rows) {
    if (classifyPairedTrajectory(row) !== 'compression_induced_failure') continue;
    const critic = (params.criticResults ?? []).find((item) => item.sampleId === row.sampleId);
    if (!critic) continue;
    for (const atom of critic.missingAtoms.slice(0, maxAtoms)) {
      const identity = atom.canonicalIdentity || atom.type;
      const key = `${atom.type}\u0000${identity}`;
      const existing = byIdentity.get(key);
      if (existing) {
        existing.count += 1;
        existing.sampleIds = [...new Set([...existing.sampleIds, row.sampleId])].slice(0, 12);
        if (atom.rationale) existing.repairGuideline = atom.rationale;
        continue;
      }
      byIdentity.set(key, {
        id: `guideline-${atom.type}-${byIdentity.size + 1}`,
        canonicalIdentity: identity,
        type: atom.type,
        severity: atom.severity,
        failureKind: row.failureKind ?? 'other',
        count: 1,
        sampleIds: [row.sampleId],
        repairGuideline: atom.rationale || critic.repairGuideline || '',
      });
    }
  }
  const guidelines = [...byIdentity.values()]
    .sort((left, right) => right.count - left.count || left.canonicalIdentity.localeCompare(right.canonicalIdentity))
    .slice(0, maxAtoms);
  return {
    version: 1,
    generatedAt: params.generatedAt ?? new Date(0).toISOString(),
    atomLimit: maxAtoms,
    guidelines,
  };
}

export function summarizePairedTrajectoryMetrics(params: {
  rows: PairedTrajectoryRow[];
  criticResults?: CriticalAtomCriticResult[];
}): {
  sampleCount: number;
  compressionInducedFailureCount: number;
  preexistingFailureCount: number;
  compressedSuccessCount: number;
  indeterminateCount: number;
  retryRate: number;
  latency: { mean: number; min: number; max: number };
  tokens: { inputMean: number; inputMin: number; inputMax: number; outputMean: number; outputMin: number; outputMax: number };
  cost: { mean: number; min: number; max: number };
  criticCoverage: { matchedFailures: number; totalFailures: number; rate: number };
} {
  const rows = params.rows;
  const failures = rows.filter((row) => classifyPairedTrajectory(row) === 'compression_induced_failure');
  const retries = rows.map((row) => row.retryCount ?? 0);
  const latencies = rows
    .map((row) => row.latencyMs)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const tokenInputs = rows
    .map((row) => row.tokenUsage?.input)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const tokenOutputs = rows
    .map((row) => row.tokenUsage?.output)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const costs = rows
    .map((row) => {
      const cost = row.cost;
      if (!cost) return undefined;
      const total = (cost.input ?? 0) + (cost.output ?? 0) + (cost.cacheRead ?? 0) + (cost.cacheWrite ?? 0);
      return Number.isFinite(total) ? total : undefined;
    })
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const criticMatched = (params.criticResults ?? []).filter((item) => item.sampleId).length;
  const sum = (values: number[]) => values.reduce((acc, value) => acc + value, 0);
  return {
    sampleCount: rows.length,
    compressionInducedFailureCount: failures.length,
    preexistingFailureCount: rows.filter((row) => classifyPairedTrajectory(row) === 'preexisting_failure').length,
    compressedSuccessCount: rows.filter((row) => classifyPairedTrajectory(row) === 'compressed_success').length,
    indeterminateCount: rows.filter((row) => classifyPairedTrajectory(row) === 'indeterminate').length,
    retryRate: retries.length ? retries.filter((value) => value > 0).length / retries.length : 0,
    latency: {
      mean: latencies.length ? sum(latencies) / latencies.length : 0,
      min: latencies.length ? Math.min(...latencies) : 0,
      max: latencies.length ? Math.max(...latencies) : 0,
    },
    tokens: {
      inputMean: tokenInputs.length ? sum(tokenInputs) / tokenInputs.length : 0,
      inputMin: tokenInputs.length ? Math.min(...tokenInputs) : 0,
      inputMax: tokenInputs.length ? Math.max(...tokenInputs) : 0,
      outputMean: tokenOutputs.length ? sum(tokenOutputs) / tokenOutputs.length : 0,
      outputMin: tokenOutputs.length ? Math.min(...tokenOutputs) : 0,
      outputMax: tokenOutputs.length ? Math.max(...tokenOutputs) : 0,
    },
    cost: {
      mean: costs.length ? sum(costs) / costs.length : 0,
      min: costs.length ? Math.min(...costs) : 0,
      max: costs.length ? Math.max(...costs) : 0,
    },
    criticCoverage: {
      matchedFailures: criticMatched,
      totalFailures: failures.length,
      rate: failures.length ? criticMatched / failures.length : 0,
    },
  };
}
