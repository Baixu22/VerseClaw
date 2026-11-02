export type RsiDecisionCheckFinding = { code: string; message: string };
export type RsiDecisionCheckDrift = { path: string; recorded: string; current: string | null };
export type RsiDecisionCheckResult = {
  passed: boolean;
  status: string | null;
  decisions: Record<string, string>;
  boundFileCount: number;
  nonJudgedInputCount: number;
  hashDrift: RsiDecisionCheckDrift[];
  errors: RsiDecisionCheckFinding[];
  warnings: RsiDecisionCheckFinding[];
};
export const PATHS: {
  acceptance: string;
  decisions: string;
  policyV2: string;
  corpus: string;
  historicalRun: string;
};
export function validateDecisionAcceptance(
  acceptance: unknown,
  root?: string,
  options?: { allowDirty?: boolean; skipHashes?: boolean },
): RsiDecisionCheckResult;