export const HISTORICAL_CORPUS_PATH: string;
export const CODING_BINDINGS_PATH: string;
export const DEFAULT_COMMAND_TIMEOUT_MS: number;
export const TEMP_ROOT: string;

export type HistoricalGradeTask = Record<string, any> & {
  id: string;
  base: string;
  ref: string;
  baseCommit: string;
  referenceCommit: string;
  sourceRecordData: any;
  oracleDigest: string;
  inputDigest: Record<string, string>;
  oracleRevision: string;
  oracleTestDigests: Record<string, string>;
  oracle: {
    commandLine?: string;
    commandLines?: string[];
    testPaths: string[];
    inputDigests: Record<string, string>;
    expectedSkips: number;
    expectedTestCount: number | null;
  };
  input: { targetScope: string[] };
};

export type GradeEdit = { path: string; content: string | Uint8Array };
export type GradeEdits = GradeEdit[] | Record<string, string | Uint8Array>;

export function missingModuleDiagnostics(report: any, workspace: string, task: HistoricalGradeTask): OracleDiagnostic[];
export function linkGraderDependencies(root: string, workspace: string, descriptors: Array<{ usesRootDeps?: boolean; usesRuntimeDeps?: boolean }>, supportRoot?: string): string[];
export type OracleFailureClass = 'assertion' | 'infrastructure' | 'target-module-absent' | 'oracle-input-drift';

export function classifyMissingModuleFailure(diagnostics?: OracleDiagnostic[]): { failureClass: 'assertion' | 'infrastructure' | 'target-module-absent'; inTargetScope: boolean; diagnostics: OracleDiagnostic[] };

export function resolveHistoricalTask(root: string, taskId: string, options?: { codingCohort?: boolean }): HistoricalGradeTask;

export function prepareGradeWorkspace(options: {
  root: string;
  task: HistoricalGradeTask;
  workspace: string;
  revision: string;
  edits?: GradeEdits;
}): Promise<{ workspace: string; revision: string; edits: string[]; oracleFiles: string[] }>;
export function prepareStdioGradeWorkspace(options: Parameters<typeof prepareGradeWorkspace>[0]): ReturnType<typeof prepareGradeWorkspace>;

export type OracleDiagnostic = {
  kind: string;
  missingPath?: string;
  importer?: string | null;
  inTargetScope?: boolean;
  command?: string;
  message?: string;
};

export type OracleExecution = {
  command: string;
  actualArgv: string[];
  kind: 'vitest' | 'command';
  cwd: string;
  exitCode: number | null;
  timedOut: boolean;
  signal: string | null;
  error: string | null;
  errorCode?: string | null;
  elapsedMs?: number;
  report: any | null;
  reportPath: string | null;
  stdoutPath: string;
  stderrPath: string;
};

export function runLiveTaskOracles(options: {
  root: string;
  task: HistoricalGradeTask;
  workspace: string;
  outDir: string;
  timeoutMs?: number;
  supportRoot?: string;
}): Promise<{
  schemaVersion: 'RsiLiveTaskGrader/v1';
  driven_by: 'agent';
  actor: string;
  taskId: string;
  commands: string[];
  executions: OracleExecution[];
  numTotalTests: number;
  numPassedTests: number;
  numFailedTests: number;
  numPendingTests: number;
  passed: boolean;
  failureClass: OracleFailureClass | null;
  timeoutMs: number;
  oracleHashBefore: string;
  oracleHashAfter: string | null;
  oracleUnchanged: boolean;
  inputDigests: Record<string, string>;
  oracleRevision: string | null;
  oracleTestDigests: Record<string, string> | null;
  diagnostics: OracleDiagnostic[];
  workspace: string;
  outDir: string;
  reportPath: string;
}>;
