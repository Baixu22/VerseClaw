import type { CampaignBudget, CampaignPriceObservation } from './lib/rsi-campaign-budget.mjs';
export function inspectFreeQuota(database: string, model: string): CampaignPriceObservation;
export function inspectCachedModel(database: string, model: string): {
  source: string; fetchedAt: number; ageMs: number;
  model: { id: string; provider: string; credits: string; supportsToolCall: boolean; maxInputTokens: number; maxOutputTokens: number };
};
export function preparePairedMeasurement(options: { root?: string; base: string; authorization: CampaignBudget['authorization'];
  quotaDatabase: string; evolutionFile: string }): Promise<any>;
export function reconcileCampaign(base: string, options: { root?: string; scratch: string }): any;
