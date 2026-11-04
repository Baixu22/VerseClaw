export const HISTORICAL_CORPUS_PATH: string;
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

export function resolveHistoricalTask(root: string, taskId: string): HistoricalGradeTask;

export function prepareGradeWorkspace(options: {
  root: string;
  task: HistoricalGradeTask;
  workspace: string;
  revision: string;
  edits?: GradeEdits;
}): Promise<{ workspace: string; revision: string; edits: string[]; oracleFiles: string[] }>;

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
  timeoutMs: number;
  oracleHashBefore: string;
  oracleHashAfter: string | null;
  oracleUnchanged: boolean;
  inputDigests: Record<string, string>;
  diagnostics: OracleDiagnostic[];
  workspace: string;
  outDir: string;
  reportPath: string;
}>;