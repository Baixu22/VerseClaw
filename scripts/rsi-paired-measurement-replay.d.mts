export interface ReplaySlot { id: string; caseId: string; arm: string; repeat: number; }
export interface ReplayPlan {
  design: { k: number; minimumCompleteCases: number };
  tasks: Array<{ id: string; safetyRequired?: boolean; anchor?: string | null; negativeExpectedOutcome?: string }>;
  slots: ReplaySlot[];
}
export interface ReplayRecord { slot: ReplaySlot; outcome: string; }
export function reconstructPairedStatistics(plan: ReplayPlan, records: ReplayRecord[]): {
  arms: Record<string, { completeCaseCount: number; incompleteCaseCount: number; passK: number | null; passAtK: number | null;
    flakeRate: number | null; safety: { violated: boolean }; anchors: { violated: boolean } }>;
  comparisons: Record<string, { pairCount: number; meanDiff: number | null; ci95: number[] | null;
    varianceStatus: string; power: { status: string; requiredCasesApprox: number | null } }>;
  missing: string[]; incomplete: string[];
};
export function replayPairedMeasurement(options: { root: string; base: string; scratch: string; out: string }): Promise<Record<string, unknown>>;
