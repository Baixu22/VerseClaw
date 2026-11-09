import type { ResponsesProviderResult, ResponsesRequest } from './rsi-responses-provider.mjs';

export type CampaignBudget = {
  schemaVersion: 'RsiCampaignBudget/v1'; driven_by: 'agent'; actor: string; endpoint: string; model: string;
  authorization: { approvedBy: 'owner'; currency: 'CNY'; maxCost: number; maxProviderCalls: number; maxTotalTokens: number; source: string };
  billing: { kind: 'existing-free-quota'; currency: 'CNY'; provider: string; plan: 'Free'; newPurchaseAllowed: false;
    evidenceDigest: string; creditMultiplier: string } | { kind: 'token-tariff'; currency: 'CNY'; inputPerMillion: number; outputPerMillion: number; evidenceDigest: string };
};
export type CampaignPriceObservation = { provider: string; model: string; plan: string; newPurchaseAllowed: boolean; remainingQuota: number; [key: string]: unknown };
export function validateCampaignBudget(campaign: CampaignBudget): boolean;
export function createCampaignLedger(options: { directory: string; campaign: CampaignBudget;
  verifyPriceBasis?: () => Promise<CampaignPriceObservation> | CampaignPriceObservation }): {
  directory: string; campaignDigest: string;
  reserve(request: ResponsesRequest, identity: string): Promise<any>;
  settle(reservation: any, result: ResponsesProviderResult | null | undefined): void;
  snapshot(): { campaignDigest: string; providerCalls: number; accountedTokens: number; knownTokens: number;
    unknownUsageRequests: string[]; currency: string; spendingUpperBound: number; billedCost: null; rows: any[] };
};
