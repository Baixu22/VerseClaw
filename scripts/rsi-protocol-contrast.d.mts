import type { BenefitPlan, BenefitTask, ProtocolContrastBudgetAtStart, validateCollectedBenefitTrial } from './lib/rsi-benefit-eval.mjs';
import type { CampaignBudget, createCampaignLedger } from './lib/rsi-campaign-budget.mjs';
import type { summarizeTf0592Trials } from './rsi-tf0592-statistical-adjudication.mjs';
export type ProtocolSlot = { id: string; variantId: string; caseId: string; repeat: number; benefitSlotId: string; taskIdentityDigest: string; position: number };
export type ProtocolContrastPlan = {
  schemaVersion: 'RsiProtocolContrastPlan/v1'; driven_by: 'agent'; actor: string; runId: string; createdAt: string;
  evidenceKind: 'live-provider'; source: { commit: string; tree: string; bindings: Record<string, string> };
  campaign: CampaignBudget; variants: Array<{ id: string; version: string; callsPerSlot: number; plan: BenefitPlan }>;
  taskIds: string[]; slots: ProtocolSlot[];
  design: { k: number; minimumCompleteCases: number; plannedSlots: number; contextArm: string; order: string;
    inferenceUnit: string; comparisons: string[]; minimumImprovement: number; costIncreaseMaximum: number };
  claims: Record<string, boolean>;
};
export type ProtocolRecord = ReturnType<typeof validateCollectedBenefitTrial> & { scheduledSlot: ProtocolSlot; envelope?: unknown };
export const PROTOCOL_VARIANTS: ReadonlyArray<{ id: string; version: string; callsPerSlot: number }>;
export function protocolTaskIdentity(task: BenefitTask): Record<string, unknown>;
export function createProtocolContrastPlan(root: string, options: { campaign: CampaignBudget; runId?: string; actor?: string }): ProtocolContrastPlan;
export function validateProtocolContrastPlan(root: string, plan: ProtocolContrastPlan): boolean;
export function prefixProtocolLedger(ledger: ReturnType<typeof createCampaignLedger>, variantId: string): ReturnType<typeof createCampaignLedger>;
export function readProtocolContrastRun(options: { root?: string; base: string; scratch: string }): {
  plan: ProtocolContrastPlan; price: unknown; records: ProtocolRecord[]; accounting: ReturnType<ReturnType<typeof createCampaignLedger>['snapshot']>;
  interruptedReservations: string[]; resourceLimitViolations: string[]; terminalResponses: number;
};
export function summarizeProtocolContrast(plan: ProtocolContrastPlan, records: ProtocolRecord[]): Record<string, ReturnType<typeof summarizeTf0592Trials>>;
export function sealProtocolContrastRun(options: { root?: string; base: string; scratch: string }): Record<string, unknown>;
export function prepareProtocolContrast(options: { root?: string; base: string; authorization: CampaignBudget['authorization']; quotaDatabase: string }): Record<string, unknown>;
export function calibrateProtocolContrast(options: { root?: string; base: string; supportRoot: string }): Promise<Record<string, unknown>>;
export function runProtocolContrast(options: { root?: string; base: string; scratch: string; supportRoot: string; quotaDatabase: string; apiKey: string; limit?: number }): Promise<Record<string, unknown>>;
export type { ProtocolContrastBudgetAtStart };
