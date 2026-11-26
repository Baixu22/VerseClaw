export const CODING_COLLECTOR: { version: string; reasoningEffort: 'low'; maxOutputTokens: number; timeoutMs: number;
  oracleTimeoutMs: number; maxProviderAttempts: number; maxContextChars: number;
  publicInputProtocol?: string; tools?: ReadonlyArray<Record<string, unknown>>;
  maxProviderCalls?: number; maxToolCalls?: number; maxToolOutputChars?: number;
  maxEditBytes?: number; maxEditFiles?: number; slotTimeoutMs?: number;
  workspaceManifest?: string; maxManifestChars?: number; toolFeedback?: string; editPublicCheck?: string;
  terminalToolRound?: string; terminalMessage?: string; toolCostPolicy?: string;
  costPolicy?: typeof GUIDED_TOOL_COST_POLICY | typeof TERMINAL_TOOL_COST_POLICY | typeof FILE_WRITE_TOOL_COST_POLICY;
  responseFormat?: 'strict-json-schema' | 'tool-or-message-terminal'; incompleteOutcome?: 'known-output-limit-is-failure'; infrastructurePolicy?: 'retain-slot-and-continue'; unknownUsagePolicy?: 'reserve-request-upper-bound'; supportPackage: { name: string; version: string }; responseSchema: Record<string, unknown> };
export const CODING_INSTRUCTIONS: string;
export const STRUCTURED_CODING_COLLECTOR: typeof CODING_COLLECTOR & {
  responseFormat: 'strict-json-schema'; incompleteOutcome: 'known-output-limit-is-failure';
  infrastructurePolicy: 'retain-slot-and-continue'; unknownUsagePolicy: 'reserve-request-upper-bound';
};
export const PUBLIC_CODING_COLLECTOR: typeof STRUCTURED_CODING_COLLECTOR & { publicInputProtocol: 'RsiCodingTaskInputs/v1' };
export const CODING_TOOLS: ReadonlyArray<Record<string, unknown>>;
export const TOOL_CODING_COLLECTOR: typeof PUBLIC_CODING_COLLECTOR & {
  maxProviderCalls: number; maxToolCalls: number; maxToolOutputChars: number;
  maxEditBytes: number; maxEditFiles: number; slotTimeoutMs: number;
  tools: typeof CODING_TOOLS;
};
export const TOOL_CODING_INSTRUCTIONS: string;
export type GuidedToolCostPolicy = { schemaVersion: 'RsiCodingToolCostPolicy/v1'; collectorVersion: 'RsiCodingCollector/v5';
  policy: 'absolute-per-slot-budget'; maxToolCallsPerSlot: 12; maxProviderCallsPerSlot: 4 };
export const GUIDED_TOOL_COST_POLICY: Readonly<GuidedToolCostPolicy>;
export const GUIDED_CODING_TOOLS: ReadonlyArray<Record<string, unknown>>;
export const GUIDED_TOOL_CODING_COLLECTOR: typeof TOOL_CODING_COLLECTOR & {
  workspaceManifest: 'RsiCodingWorkspaceManifest/v1'; maxManifestChars: number;
  toolFeedback: 'structured-errors-and-remaining-budget'; editPublicCheck: 'after-each-applied-batch';
  terminalToolRound: 'execute-then-grade-when-public-check-passes'; toolCostPolicy: 'absolute-per-slot-budget';
};
export const GUIDED_TOOL_CODING_INSTRUCTIONS: string;
export type TerminalToolCostPolicy = Omit<GuidedToolCostPolicy, 'schemaVersion' | 'collectorVersion'> & {
  schemaVersion: 'RsiCodingToolCostPolicy/v2'; collectorVersion: 'RsiCodingCollector/v6' };
export const TERMINAL_TOOL_COST_POLICY: Readonly<TerminalToolCostPolicy>;
export const PUBLIC_ERROR_CONVENTION: string;
export const TERMINAL_CODING_COLLECTOR: Omit<typeof GUIDED_TOOL_CODING_COLLECTOR, 'version' | 'publicInputProtocol' | 'responseFormat' | 'costPolicy'> & {
  version: 'RsiCodingCollector/v6'; publicInputProtocol: 'RsiCodingTaskInputs/v2'; responseFormat: 'tool-or-message-terminal';
  terminalMessage: 'nonempty-completed-with-verified-edits'; costPolicy: typeof TERMINAL_TOOL_COST_POLICY };
export const TERMINAL_CODING_INSTRUCTIONS: string;
export type FileWriteToolCostPolicy = Omit<GuidedToolCostPolicy, 'schemaVersion' | 'collectorVersion'> & {
  schemaVersion: 'RsiCodingToolCostPolicy/v3'; collectorVersion: 'RsiCodingCollector/v7' };
export const FILE_WRITE_TOOL_COST_POLICY: Readonly<FileWriteToolCostPolicy>;
export const FILE_WRITE_CODING_COLLECTOR: Omit<typeof TERMINAL_CODING_COLLECTOR, 'version' | 'costPolicy'> & {
  version: 'RsiCodingCollector/v7'; costPolicy: typeof FILE_WRITE_TOOL_COST_POLICY };
export const FILE_WRITE_CODING_INSTRUCTIONS: string;
export type CodingWorkspaceManifest = { protocol: string; readable: string[]; writable: string[]; supplied: string[]; absent: string[]; declarations: string[]; onDemand: string[];
  budgets: { providerCalls: number; toolCalls: number; toolOutputChars: number; editFiles: number; editBytes: number } };
export type CodingToolBudget = { providerCallsRemaining: number; toolCallsRemaining: number; note?: string };
type CollectorLike = { version?: string; tools?: ReadonlyArray<Record<string, unknown>> } | null | undefined;
export function isToolCodingCollector(collector: CollectorLike): boolean;
export function isGuidedCodingCollector(collector: CollectorLike): boolean;
export function isTerminalCodingCollector(collector: CollectorLike): boolean;
export function isFileWriteCodingCollector(collector: CollectorLike): boolean;
export function codingWorkspaceManifest(task: { targetScope: string[]; publicInput?: {
  baseFiles: Array<{ path: string; content: string | null }>; omittedContext: Array<{ path: string }>;
  publicContract: { declarations: Array<{ path: string; content: string }> } } },
  collector?: typeof GUIDED_TOOL_CODING_COLLECTOR | typeof TERMINAL_CODING_COLLECTOR | typeof FILE_WRITE_CODING_COLLECTOR): CodingWorkspaceManifest;
export function codingToolBudget(collector: { maxProviderCalls?: number; maxToolCalls?: number },
  providerCalls: number, executedToolCalls: number, providerLimit?: number): CodingToolBudget;
export function parseCodingFinish(text: string): true;
export function codingTerminalReason(collector: CollectorLike, text: string): 'model-finish' | 'model-message';
export function reserveProviderTokens(plan: { collector: { unknownUsagePolicy?: string }; provider: { maxOutputTokens: number } },
  attempts: Array<{ request: unknown; parsedResponse: { usage: { totalTokens: number } | null } | null }>): number;
export function codingCollectorConfig(version?: string): typeof CODING_COLLECTOR | typeof STRUCTURED_CODING_COLLECTOR | typeof PUBLIC_CODING_COLLECTOR | typeof TOOL_CODING_COLLECTOR | typeof GUIDED_TOOL_CODING_COLLECTOR | typeof TERMINAL_CODING_COLLECTOR | typeof FILE_WRITE_CODING_COLLECTOR;
export function parseCodingEdits(text: string, task: { targetScope: string[]; oracle: { testPaths: string[] } }): Array<{path: string; content: string}>;
