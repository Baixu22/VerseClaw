export const ARMS_PROTOCOL_PATH: string;
export const ARMS_RUNS_PATH: string;
export const ARMS_REPORT_PATH: string;
export type ArmsFinding = { code: string; message: string };
export function validateArmsProtocol(protocol: unknown): { passed: boolean; errors: ArmsFinding[] };
export function buildArmsPlan(protocol: any): {
  schemaVersion: string; driven_by: string; actor: string; status: string;
  arms: string[]; cases: number; k: number; trials: number;
  providerCallsAuthorized: number; required: string[]; rule: string;
};
export function buildArmsReport(root?: string): {
  schemaVersion: string; status: string; reasons: string[]; evidenceKind: string;
  promotion: import('./lib/paired-ablation.mjs').PromotionVerdict;
  arms: Record<string, { completeCaseCount: number; passK: number | null; passAtK: number | null; flakeRate: number | null; meanTokens: number | null; gate: string }>;
  comparisons: Array<{ id: string; role: string; baseline: number | null; treatment: number | null; meanDiff: number | null; ci95: [number | null, number | null] | null; verdict: string; reasons: string[] }>;
  cost: { offMeanTokens: number | null; confirmedMeanTokens: number | null; relativeIncrease: number | null; ceiling: number; withinCeiling: boolean | null; missing: boolean };
  claims: { benefit: boolean; promotionReady: boolean; productLocksChanged: boolean; realHuman: boolean; providerCalls: number };
};