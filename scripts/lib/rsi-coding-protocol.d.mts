export const CODING_COLLECTOR: { version: string; reasoningEffort: 'low'; maxOutputTokens: number; timeoutMs: number;
  oracleTimeoutMs: number; maxProviderAttempts: number; maxContextChars: number;
  responseFormat?: 'strict-json-schema'; incompleteOutcome?: 'known-output-limit-is-failure'; infrastructurePolicy?: 'retain-slot-and-continue'; unknownUsagePolicy?: 'reserve-request-upper-bound'; supportPackage: { name: string; version: string }; responseSchema: Record<string, unknown> };
export const CODING_INSTRUCTIONS: string;
export const STRUCTURED_CODING_COLLECTOR: typeof CODING_COLLECTOR & {
  responseFormat: 'strict-json-schema'; incompleteOutcome: 'known-output-limit-is-failure';
  infrastructurePolicy: 'retain-slot-and-continue'; unknownUsagePolicy: 'reserve-request-upper-bound';
};
export const PUBLIC_CODING_COLLECTOR: typeof STRUCTURED_CODING_COLLECTOR & { publicInputProtocol: 'RsiCodingTaskInputs/v1' };
export function codingCollectorConfig(version?: string): typeof CODING_COLLECTOR | typeof STRUCTURED_CODING_COLLECTOR | typeof PUBLIC_CODING_COLLECTOR;
export function parseCodingEdits(text: string, task: { targetScope: string[]; oracle: { testPaths: string[] } }): Array<{path: string; content: string}>;
