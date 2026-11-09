import type { BenefitTrialReceipt } from './lib/rsi-benefit-eval.mjs';
export function projectEmptyOracleReceipt(row: BenefitTrialReceipt): BenefitTrialReceipt;
export function isUndispatchedSpaceFailure(row: BenefitTrialReceipt): boolean;
export function recoverProtocolContrast(options: { root: string; base: string; scratch: string; quotaDatabase?: string;
  supportRoot?: string; apiKey?: string; run?: boolean; out?: string; limit?: number; recoverUndispatched?: boolean }): Promise<Record<string, unknown>>;
