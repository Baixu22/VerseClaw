import type { BenefitTask, BenefitTrialReceipt } from './rsi-benefit-eval.mjs';
export type CodingToolState = { root: string; task: BenefitTask; workspace: string | null;
  edits: Map<string, string>; cache: Map<string, string | null> };
export type CodingToolCall = { name: string; arguments: string };
export function createCodingToolState(root: string, task: BenefitTask, workspace?: string | null): CodingToolState;
export function evaluateCodingTool(state: CodingToolState, call: CodingToolCall): Record<string, any>;
export function executeCodingTool(state: CodingToolState, call: CodingToolCall): { output: Record<string, any>; infrastructure: boolean };
export function codingToolEdits(state: CodingToolState): Array<{ path: string; content: string }>;
export function hasPassingPublicCheck(events: BenefitTrialReceipt['execution']['toolEvents']): boolean;
export function verifyCodingToolJournal(root: string, task: BenefitTask,
  events: BenefitTrialReceipt['execution']['toolEvents'], edits: Array<{ path: string; content: string }>, interrupted?: boolean): true;
