export type AblationRun = {
  caseId: string;
  repeat: number;
  success: boolean;
  latencyMs?: number;
  tokens?: number;
  falseBlock?: boolean;
  safetyViolation?: boolean;
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
  incompleteCaseCount: number;
};

export type PairedEffect = {
  metric: string;
  pairCount: number;
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