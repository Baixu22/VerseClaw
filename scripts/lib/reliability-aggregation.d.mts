export type ReliabilityTrialOutcome = 'pass' | 'fail' | 'missing' | 'timeout' | 'crash' | 'skip';

export type ReliabilityCase = {
  id: string;
  safetyRequired?: boolean;
  anchor?: 'positive' | 'negative';
  trials: ReliabilityTrialOutcome[];
};

export type ReliabilityOptions = {
  k?: number;
  minCases?: number;
  flakeThreshold?: number;
};

export type ReliabilityIncompleteEntry = {
  caseId: string;
  trialIndex: number;
  outcome: ReliabilityTrialOutcome;
};

export type ReliabilityAggregation = {
  k: number;
  caseCount: number;
  completeCaseCount: number;
  incompleteCaseCount: number;
  trialCount: number;
  passCount: number;
  failCount: number;
  perTrialSuccessRate: number | null;
  passK: number | null;
  passAtK: number | null;
  flakeRate: number | null;
  flakeCaseIds: string[];
  flakeThreshold: number;
  minimumNonZeroFlakeRate: number | null;
  flakeThresholdReachable: boolean | null;
  incomplete: ReliabilityIncompleteEntry[];
  safety: { requiredCaseCount: number; skippedCount: number; flakeCount: number; violated: boolean };
  anchors: { positiveCaseCount: number; positivePassed: number; negativeCaseCount: number; negativeRejected: number; violated: boolean };
  gate: 'pass' | 'fail' | 'insufficient-sample';
  reasons: string[];
};

export const RELIABILITY_TRIAL_OUTCOMES: ReliabilityTrialOutcome[];

export function aggregateReliability(cases: ReliabilityCase[], options?: ReliabilityOptions): ReliabilityAggregation;