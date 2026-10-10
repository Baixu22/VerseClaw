/* Test typing surface for check-error-governance.mjs (issue #115). */
export const SCHEMA: string;

export const SURFACE_INFO_STRING: string;

export const REUSED_ENVELOPE: string;

export const REUSED_ERROR_TYPES: string[];

export const GOVERNANCE_RULE_ID: string;

export const GOVERNANCE_PATHS: Record<string, string>;

export const REUSED_SYMBOL_OWNERS: Record<string, string[]>;

export const ERROR_TYPE_CODE_SETS: Record<string, string>;

export const GAP_PROBES: Record<string, { evidence: string; isOpen(root: string): boolean }>;

export const RECORD_ANCHORS: string[];

export const RECORD_STATE_LABELS: string[];

export const RECORD_DISAMBIGUATION_ANCHORS: string[];

export const RECORD_REGEX_ANCHORS: Array<{ id: string; pattern: RegExp }>;

export const RULE_EXECUTABLE_ANCHORS: string[];

export const HUMAN_PREREQUISITE_PATTERNS: Array<{ id: string; pattern: RegExp }>;

export const HUMAN_PREREQUISITE_NEGATIONS: RegExp[];

export const WAITING_DECISION_FALLBACK: {
  recognized: boolean;
  decision: string;
  autoApprove: boolean;
  executedAction: string | null;
  effectsAllowed: boolean;
};

export interface ErrorGovernanceFinding {
  check: string;
  code: string;
  message: string;
  [key: string]: unknown;
}

export interface ErrorGovernanceCheck {
  id: string;
  description: string;
  status: 'pass' | 'fail';
  findings: string[];
}

export interface ErrorGovernanceReport {
  schema: string;
  generatedAt: string;
  drivenBy: string;
  root: string;
  inputs: Record<string, { path: string; present: boolean; bytes?: number; sha256?: string }>;
  checks: ErrorGovernanceCheck[];
  findings: ErrorGovernanceFinding[];
  result: 'pass' | 'fail';
}

export interface WaitingDecision {
  recognized: boolean;
  decision: string;
  autoApprove: boolean;
  executedAction: string | null;
  effectsAllowed: boolean;
  reason?: string;
  approvalType?: string | null;
  waitingStatus?: string | null;
}

export function mergeSurface(base: unknown, override: unknown): any;

export function extractSurfaceBlock(ruleText: string): any;

export function parseHostErrorCodes(hostContractText: string): string[];

export function parseWaitingTypes(contractText: string): { waitingStatus: string[]; approvalType: string[] };

export function declaresSymbol(text: string, symbol: string): boolean;

export function resolveWaitingDecision(descriptor?: any, waitingTypes?: any): WaitingDecision;

export function findHumanPrerequisites(text: string): Array<{
  code: string;
  id: string;
  line: number;
  text: string;
  message: string;
}>;

export function validateErrorGovernance(options?: any): ErrorGovernanceReport;
