export type AcceptanceCoverage = {
  runtime: boolean;
  ui: boolean;
  comms: boolean;
  release: boolean;
};

export type AcceptanceGate = {
  id: string;
  name: string;
  profile: string;
  command: string | null;
  commandLine?: string;
  args: string[];
  required: boolean;
  allowSkip: boolean;
  timeoutMs: number;
  kind?: string;
  adapter?: string;
  safety?: Record<string, unknown>;
  testExpectation?: Record<string, unknown> | null;
  copyInputs?: Array<{
    path: string | null;
    exists: boolean;
    bytes: number | null;
    sha256: string | null;
  }>;
};

export type AcceptanceSourceFile = {
  path: string;
  exists: boolean;
  sha256: string;
  gitBlob: string;
};

export type AcceptanceManifest = {
  schema: string;
  manifestVersion: number;
  runId: string;
  createdAt: string;
  task: {
    id: string;
    title: string;
    specPath: string;
    humanEvidence: string;
    requiredRules: string[];
    requiredTests: string[];
  };
  executionMode: string;
  candidate: {
    commit: string;
    tree: string;
    ref: string;
    cleanAtPlan: boolean;
  };
  baseRef: string | null;
  changedPaths: string[];
  coverage: AcceptanceCoverage;
  requiredProfiles: string[];
  source: {
    files: AcceptanceSourceFile[];
    missing: string[];
    lockFiles: AcceptanceSourceFile[];
    identityPolicy: string;
    eolPolicy: string;
    provisionCopies?: Array<{
      path: string | null;
      exists: boolean;
      bytes: number | null;
      sha256: string | null;
    }>;
  };
  gates: AcceptanceGate[];
  safety: Record<string, unknown>;
  eligibility: Record<string, unknown>;
  residuals: string[];
  planDigest: string;
  manifestDigest: string;
};

export type AcceptanceReport = {
  schema: string;
  role: string;
  runId: string;
  result: string;
  engineeringAcceptedByAgent: boolean;
  failures: string[];
  gates: Array<Record<string, unknown>>;
  controlledArtifacts?: Array<Record<string, unknown>>;
  mutationCheck?: Record<string, unknown>;
  reportDigest?: string;
  testCounts?: Record<string, unknown>;
  executorActor?: string;
  verifierActor?: string;
  consistency?: Record<string, unknown>;
};

export type RepositoryIdentity = {
  commit: string;
  tree: string;
  ref: string;
  clean: boolean;
  status: string;
};

export type AcceptanceStatus = {
  runs: Array<{
    runId: string;
    result: string;
    engineeringAcceptedByAgent: boolean;
    path: string;
    [key: string]: unknown;
  }>;
};

export const ACCEPTANCE_SCHEMA: string;
export const ACCEPTANCE_REPORT_SCHEMA: string;
export const TF0009_ADAPTER_ID: string;
export const ROOT_UNIT_EXPECTED_SKIPS: number;

export function stableJson(value: unknown): string;
export function sha256(value: string | Uint8Array): string;
export function sha256File(filePath: string): string;
export function digestReport(report: unknown): string;
export function equalDigest(expected: unknown, actual: unknown): boolean;
export function digestPlan(manifest: unknown): string;
export function digestManifest(manifest: unknown): string;
export function repositoryIdentity(root?: string, options?: Record<string, unknown>): RepositoryIdentity;
export function resolveChangedPaths(root?: string, options?: Record<string, unknown>): string[];
export function inferCoverage(changedPaths?: string[]): AcceptanceCoverage;
export function createAcceptancePlan(options?: Record<string, unknown>): AcceptanceManifest;
export function validateAcceptanceManifest(
  manifest: unknown,
  options?: Record<string, unknown>,
): { ok: boolean; errors: string[] };
export function validateAcceptanceEnvironment(
  env?: Record<string, string | undefined>,
): { ok: boolean; errors: string[]; providerKeys: string[] };
export function redactText(value: string, options?: Record<string, unknown>): string;
export function assertSafeOutputDirectory(outputDir: string, sourceRoot?: string): string;
export function parseTestCounts(stdout: string, stderr?: string): {
  passed: number;
  failed: number;
  skipped: number;
  total: number;
  source: string;
  segments: number;
} | null;
export function isCountableTestCommand(command?: string | null, args?: string[], commandLine?: string): boolean;

export function sealReport(report: AcceptanceReport): AcceptanceReport;
export function runAcceptance(
  manifest: AcceptanceManifest,
  options?: Record<string, unknown>,
): AcceptanceReport;
export function validateReportEvidence(
  manifest: unknown,
  report: unknown,
  outputDir: string,
  options?: Record<string, unknown>,
): string[];
export function validateExecutorEvidence(
  manifest: unknown,
  executorReport: unknown,
  outputDir: string,
): string[];
export function verifyAcceptance(
  manifest: AcceptanceManifest,
  options?: Record<string, unknown>,
): AcceptanceReport;
export function readAcceptanceStatus(outputRoot?: string): AcceptanceStatus;
export function writePlan(outputDir: string, manifest: AcceptanceManifest): void;
export function loadManifest(manifestPath: string): AcceptanceManifest;
