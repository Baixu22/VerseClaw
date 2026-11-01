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
  droppedPairCount: number;
  droppedPairs: Array<{ key: string; reason: string }>;
  meanDiff: number | null;
  sd: number | null;
  standardError: number | null;
  ci95: [number | null, number | null] | null;
  cohensDz: number | null;
};

export type PreRegisteredAblation = {
  primaryMetric: string;
  minCases?: number;
  k?: number;
  degradationBudget?: number;
  safetyMustHold?: boolean;
};

export function summarizeCondition(runs: AblationRun[], options?: { k?: number; minCases?: number }): ConditionSummary;
export function pairedEffect(baselineRuns: AblationRun[], treatmentRuns: AblationRun[], options?: { metric?: string }): PairedEffect;
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
  reasons: string[];
};