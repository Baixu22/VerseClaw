import type { BenefitPlan, BenefitSlot, BenefitTask, BenefitTrialReceipt } from './rsi-benefit-eval.mjs';
import type { ResponsesProviderResult } from './rsi-responses-provider.mjs';
export function collectToolCodingTrial(options: { root: string; plan: BenefitPlan; slot: BenefitSlot;
  apiKey: string; scratch: string; supportRoot: string;
  provider?: (request: { instructions: string; input: unknown }) => Promise<ResponsesProviderResult>;
  grade?: (edits: BenefitTrialReceipt['edits'], workspace?: string) => Promise<any>;
  prepare?: (workspace: string, task: BenefitTask) => Promise<void>;
  remainingTokens?: number; remainingProviderCalls?: number }): Promise<BenefitTrialReceipt>;
