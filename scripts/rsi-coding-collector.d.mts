import type { BenefitPlan, BenefitSlot, BenefitTask, BenefitTrialReceipt, BenefitReport } from './lib/rsi-benefit-eval.mjs';
import type { createResponsesProvider } from './lib/rsi-responses-provider.mjs';
import type { runLiveTaskOracles } from './lib/rsi-live-grader.mjs';

export function collectCodingTrial(options: {
  root: string; plan: BenefitPlan; slot: BenefitSlot; apiKey: string; scratch: string; supportRoot: string;
  provider?: ReturnType<typeof createResponsesProvider>;
  grade?: (edits: Array<{path: string; content: string}>, workspace?: string) => Promise<Awaited<ReturnType<typeof runLiveTaskOracles>>>;
  prepare?: (workspace: string, task: BenefitTask) => Promise<void>;
  remainingTokens?: number; remainingProviderCalls?: number;
}): Promise<BenefitTrialReceipt>;
export function runCodingCollector(options: {
  root?: string; directory: string; scratch: string; supportRoot: string; apiKey: string; limit?: number;
}): Promise<{ written: number; report: BenefitReport }>;
export function reservedCodingTokens(plan: BenefitPlan, rows: Pick<BenefitTrialReceipt, 'providerAttempts'>[]): number;
