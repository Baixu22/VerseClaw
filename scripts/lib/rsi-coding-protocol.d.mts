export const CODING_COLLECTOR: { version: string; reasoningEffort: 'low'; maxOutputTokens: number; timeoutMs: number;
  oracleTimeoutMs: number; maxProviderAttempts: number; maxContextChars: number;
  publicInputProtocol?: string; tools?: ReadonlyArray<Record<string, unknown>>;
  maxProviderCalls?: number; maxToolCalls?: number; maxToolOutputChars?: number;
  maxEditBytes?: number; maxEditFiles?: number; slotTimeoutMs?: number;
  responseFormat?: 'strict-json-schema'; incompleteOutcome?: 'known-output-limit-is-failure'; infrastructurePolicy?: 'retain-slot-and-continue'; unknownUsagePolicy?: 'reserve-request-upper-bound'; supportPackage: { name: string; version: string }; responseSchema: Record<string, unknown> };
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
export function parseCodingFinish(text: string): true;
export function reserveProviderTokens(plan: { collector: { unknownUsagePolicy?: string }; provider: { maxOutputTokens: number } },
  attempts: Array<{ request: unknown; parsedResponse: { usage: { totalTokens: number } | null } | null }>): number;
export function codingCollectorConfig(version?: string): typeof CODING_COLLECTOR | typeof STRUCTURED_CODING_COLLECTOR | typeof PUBLIC_CODING_COLLECTOR | typeof TOOL_CODING_COLLECTOR;
export function parseCodingEdits(text: string, task: { targetScope: string[]; oracle: { testPaths: string[] } }): Array<{path: string; content: string}>;
