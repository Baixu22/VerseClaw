export const CODING_COLLECTOR: { version: string; reasoningEffort: 'low'; maxOutputTokens: number; timeoutMs: number;
  oracleTimeoutMs: number; maxProviderAttempts: number; maxContextChars: number;
  supportPackage: { name: string; version: string }; responseSchema: Record<string, unknown> };
export const CODING_INSTRUCTIONS: string;
export function parseCodingEdits(text: string, task: { targetScope: string[]; oracle: { testPaths: string[] } }): Array<{path: string; content: string}>;
