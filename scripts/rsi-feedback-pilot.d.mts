export const PROTOCOL_PATH: string;
export const REPORT_PATH: string;
export const MIN_CASES: number;
export const K: number;
export type FeedbackProtocolFinding = { code: string; message: string };
export function validateFeedbackProtocol(protocol: unknown): { passed: boolean; errors: FeedbackProtocolFinding[] };
export function validateFeedbackReport(report: unknown, expected: unknown): boolean;
export function buildFeedbackReport(root?: string, protocol?: any): {
  schemaVersion: string; status: string; reasons: string[];
  input: { rows: number; attributed: number; caseAttributed: number; missingCaseJoin: number; unattributed: number; attributedCases: number; completeCases: number; counts: Record<string, number> };
  claims: { benefit: boolean; promotionReady: boolean; productLocksChanged: boolean; providerCalls: number; realHuman: boolean };
  [key: string]: unknown;
};
