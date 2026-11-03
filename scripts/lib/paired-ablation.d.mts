export type AblationRun = {
  caseId: string;
  repeat: number;
  success: boolean;
  latencyMs?: number;
  tokens?: number;
  falseBlock?: boolean;
  safetyViolation?: boolean;
  safetyRequired?: boolean;
  anchor?: 'positive' | 'negative';
  negativeExpectedOutcome?: 'pass' | 'fail';
  [metric: string]: unknown;
};

export type ConditionSummary = {
  runCount: number;
  caseCount: number;
  successRate: number | null;
  passK: number | null;
  p50LatencyMs: number | null;
  p95LatencyMs: number | null;
  meanTokens: number | null;
  falseBlocks: number;
  safetyViolations: number;
  completeCaseCount: number;
  incompleteCaseCount: number;
  flakeRate: number | null;
  flakeCaseIds: string[];
  flakeMode: 'rate' | 'case-count';
  maxFlakeCases: number | null;
  safety: {
    requiredCaseCount: number;
    skippedCount: number;
    flakeCount: number;
    violated: boolean;
  };
  anchors: {
    positiveCaseCount: number;
    positivePassed: number;
    negativeCaseCount: number;
    negativeRejected: number;
    violated: boolean;
  };
  gate: 'pass' | 'insufficient-sample' | 'fail';
  gateReasons: string[];
};

export type PairedEffect = {
  metric: string;
  pairCount: number;
  repeatPairCount: number;
  pairUnit: 'caseId/repeat';
  inferenceUnit: 'caseId';
  aggregation: 'pass^k' | 'case-mean';
  caseIds: string[];
  excludedPartialPairs: Array<{ caseId: string; repeat: number; baseline: number; treatment: number }>;
  droppedPairCount: number;
  droppedPairs: Array<{ key: string; reason: string }>;
  meanDiff: number | null;
  sd: number | null;
  standardError: number | null;
  ci95: [number | null, number | null] | null;
  cohensDz: number | null;
  varianceStatus: 'not-estimable' | 'degenerate' | 'estimated';
  power: {
    status: string; method: string; inferenceUnit: 'caseId'; reason: string;
    confidenceLevel: number; targetPower: number; minimumDetectableEffect: number;
    observedDetectableEffect: number | null; requiredCasesApprox: number | null;
    requiredPairsApprox: number | null; passKPower: string;
  };
};

export type PreRegisteredAblation = {
  primaryMetric: string;
  minCases?: number;
  k?: number;
  degradationBudget?: number;
  safetyMustHold?: boolean;
  flakeThreshold?: number;
  maxFlakeCases?: number;
  minimumEffect?: number;
  minimumImprovement?: number;
  costIncreaseMaximum?: number | null;
  costIncrease?: number | null;
};

export type PromotionVerdict = {
  status: 'promote' | 'hold' | 'eliminate' | 'insufficient-evidence';
  reasons: string[];
  thresholds: { minimumAbsoluteImprovement: number; costIncreaseMaximum: number | null };
  observed: { meanDiff: number | null; ci95Lower: number | null; costIncrease: number | null };
};

export function evaluatePromotion(input?: {
  minimumImprovement?: number;
  costIncreaseMaximum?: number | null;
  meanDiff?: number | null;
  ci95?: [number | null, number | null] | null;
  costIncrease?: number | null;
  integrityViolated?: boolean;
  sampleSufficient?: boolean;
  unstable?: boolean;
}): PromotionVerdict;

export function summarizeCondition(runs: AblationRun[], options?: { k?: number; minCases?: number; flakeThreshold?: number; maxFlakeCases?: number }): ConditionSummary;
export function pairedEffect(baselineRuns: AblationRun[], treatmentRuns: AblationRun[], options?: { metric?: string; k?: number; minCases?: number; minimumEffect?: number }): PairedEffect;
export function evaluateAblation(input: {
  baselineRuns: AblationRun[];
  treatmentRuns: AblationRun[];
  preRegistered: PreRegisteredAblation;
}): {
  preRegistered: PreRegisteredAblation;
  baseline: ConditionSummary;
  treatment: ConditionSummary;
  effect: PairedEffect;
  verdict: 'component-helps' | 'no-effect' | 'hurts' | 'safety-regression' | 'insufficient-sample';
  promotion: PromotionVerdict;
  reasons: string[];
};
