export const GROUPS: readonly string[];
export function validateInventory(inventory: unknown, root?: string, defaultIds?: string[]): string[];
export function collectCases(report: unknown, root?: string): Array<{
  key: string; file: string; title: string; expectedStatus: string;
  results: Array<{ status: string }>; status: string;
}>;
export function evaluateReport(discovery: unknown, actual: unknown, exitCode: number | null, root?: string): {
  passed: boolean;
  counts: { planned: number; observed: number; passed: number; failed: number; skipped: number };
  failures: string[];
};
export function main(argv?: string[]): number;
export function validateBuildStamp(stamp: unknown, candidate: { commit: string; clean: boolean }): void;
export function matrixOutputDirectory(output: string, root?: string): string;
