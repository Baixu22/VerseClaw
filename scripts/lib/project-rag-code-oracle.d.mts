export type CodeProbeSpec = { symbol: string; mode?: string; builtins?: string[]; helpers?: string[];
  support?: Array<{ path: string; symbols: string[] }>; defect?: { before: string; after: string } };
export type CodeProbeResult = { value?: unknown; error?: { name: string; message: string; code: string | null } };
export function codeDeclaration(source: string, symbol: string): { text: string; start: number; end: number };
export function executeCodeProbe(source: string, spec: CodeProbeSpec, supportingSources: Record<string, string>, cases: unknown[]): CodeProbeResult[];
export function stageCodeDefect(source: string, spec: CodeProbeSpec): string;
export function gradeCodeProbe(source: string, oracle: { referenceSource: string; spec: CodeProbeSpec; supportingSources: Record<string, string>; cases: unknown[]; expected: CodeProbeResult[] }): {
  passed: boolean; caseCount: number; results: CodeProbeResult[]; probeMode: string;
};
