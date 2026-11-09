import type { ProtocolContrastPlan, ProtocolSlot } from './rsi-protocol-contrast.mjs';
export type ProtocolIndependentComparison = { pairCount: number; caseIds: string[]; meanDiff: number | null; sd: number | null;
  ci95: [number, number] | null; varianceStatus: string; power: { status: string; observedDetectableEffect: number | null; requiredCasesApprox: number | null } };
export function reconstructProtocolStatistics(plan: ProtocolContrastPlan, records: Array<{ scheduledSlot: ProtocolSlot; outcome: string }>): {
  variants: Record<string, { completeCaseCount: number; incompleteCaseCount: number; passK: number | null; passAtK: number | null;
    confidenceInterval95: [number, number] | null; passAtKConfidenceInterval95: [number, number] | null;
    flakeRate: number | null; safetyViolated: boolean; anchorsViolated: boolean;
    cases: Array<{ caseId: string; trials: string[]; complete: boolean; passK: number | null; passAtK: number | null }> }>;
  comparisons: Record<string, ProtocolIndependentComparison>; unexecutedSlots: number;
};
export function replayProtocolContrast(options: { root: string; base: string; scratch: string; out?: string }): {
  passed: boolean; recordedSlots: number; providerCallsDuringReplay: number; independentArithmetic: boolean;
  statistics: ReturnType<typeof reconstructProtocolStatistics>; independentAccounting: Record<string, unknown>;
};
