import { extractArtifactDescriptors, extractArtifactHandles, extractStreamCapture } from "../../../../shared/verseshell/extraction.js";
import type { DiagnosticTraceContext } from "../../infra/diagnostic-trace-context.js";
import { decodeResultQueryRequest } from "../../../../shared/verseshell/validation.js";
import type { ArtifactDescriptor, ArtifactOwnerLineage, Diagnostic, JsonObject, Observation, StreamCapture } from "../../../../shared/verseshell/types.js";
import { VerseShellProcessManager, type VerseShellProcessConfig } from "./process-manager.js";
import {
  VERSESHELL_GOVERNED_EXEC_PROFILE_ID,
  VERSESHELL_PATCH_PREVIEW_PROFILE_ID,
  VERSESHELL_READONLY_FACADE_PROFILE_ID,
} from "./policy-profile.js";
import {
  resolveVerseShellCommandPlan,
  type VerseShellCommandPlan,
} from "./command-profiles.js";

const SHA256_DIGEST = /^sha256:[a-f0-9]{64}$/;
const APPROVAL_TOKEN = /^apv_[a-f0-9]{16}$/;
const RESULT_HANDLE = /^result:\/\/sha256\/[a-f0-9]{64}$/u;
const MAX_RESULT_LINES = 500;
const MAX_RESULT_MATCHES = 200;
const MAX_RESULT_BYTES = 64 * 1024;
const MAX_RESULT_TOKENS = 4_000;

export type GovernedVerseShellExecResult = {
  stdout: string;
  stderr: string;
  success: boolean;
  exitCode: number;
  timedOut: boolean;
  profile: string;
  tokenEstimate: number;
  artifacts: string[];
  artifactMetadata?: ArtifactDescriptor[];
  stdoutCapture?: StreamCapture;
  stderrCapture?: StreamCapture;
};

export type GovernedVerseShellExecOptions = {
  command: string;
  /** Host-owned argv produced before approval. */
  argv?: readonly string[];
  /** Immutable plan produced by OpenClaw's approval pipeline. */
  executionPlan?: VerseShellCommandPlan;
  /** Explicit terminal-shell compatibility; argv is the default. */
  shellMode?: "argv" | "explicit-shell";
  cwd: string;
  timeoutMs?: number;
  agentId?: string;
  /** True only after OpenClaw's resolved exec policy allowed this action. */
  hostPolicyApproved: boolean;
  env?: NodeJS.ProcessEnv;
  manager?: VerseShellProcessManager;
};

export type GovernedVerseShellResultQueryOptions = {
  handle: string;
  mode: "meta" | "head" | "tail" | "slice" | "grep" | "raw";
  cwd: string;
  agentId?: string;
  lines?: number;
  startLine?: number;
  endLine?: number;
  pattern?: string;
  maxMatches?: number;
  env?: NodeJS.ProcessEnv;
  manager?: VerseShellProcessManager;
  expectedOwner?: Partial<ArtifactOwnerLineage>;
  /** Host/runtime parent trace; result handles never supply lineage. */
  trace?: DiagnosticTraceContext;
};

export class GovernedVerseShellError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly hint?: string,
  ) {
    super(message);
    this.name = "GovernedVerseShellError";
  }
}

let sharedManager: VerseShellProcessManager | undefined;

export function getGovernedVerseShellManager(
  provided?: VerseShellProcessManager,
): VerseShellProcessManager {
  if (provided) return provided;
  sharedManager ??= new VerseShellProcessManager();
  return sharedManager;
}

function managerFor(options: GovernedVerseShellExecOptions): VerseShellProcessManager {
  return getGovernedVerseShellManager(options.manager);
}

function requiredEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new GovernedVerseShellError(
      "E_VERSESHELL_CONTRACT_MISSING",
      `Verified VerseShell runtime contract is missing ${name}`,
    );
  }
  return value;
}

export function createGovernedVerseShellProcessConfig(options: {
  cwd: string;
  timeoutMs?: number;
  agentId?: string;
  env?: NodeJS.ProcessEnv;
}): VerseShellProcessConfig {
  const env = options.env ?? process.env;
  const expectedCatalogDigest = requiredEnv(env, "VERSESHELL_OPERATION_CATALOG_DIGEST").toLowerCase();
  if (!SHA256_DIGEST.test(expectedCatalogDigest)) {
    throw new GovernedVerseShellError(
      "E_VERSESHELL_CONTRACT_INVALID",
      "Verified VerseShell operation catalog digest is invalid",
    );
  }
  const expectedCatalogCountRaw = requiredEnv(env, "VERSESHELL_OPERATION_CATALOG_COUNT");
  if (!/^[1-9]\d*$/u.test(expectedCatalogCountRaw)) {
    throw new GovernedVerseShellError(
      "E_VERSESHELL_CONTRACT_INVALID",
      "Verified VerseShell operation catalog count is invalid",
    );
  }
  const expectedCatalogCount = Number(expectedCatalogCountRaw);
  if (!Number.isSafeInteger(expectedCatalogCount)) {
    throw new GovernedVerseShellError(
      "E_VERSESHELL_CONTRACT_INVALID",
      "Verified VerseShell operation catalog count is invalid",
    );
  }
  return {
    workspace: options.cwd,
    policyProfile: VERSESHELL_GOVERNED_EXEC_PROFILE_ID,
    expectedBinaryVersion: requiredEnv(env, "VERSESHELL_RUNTIME_VERSION"),
    expectedProtocolVersion: requiredEnv(env, "VERSESHELL_SERVER_PROTOCOL"),
    expectedCatalogDigest,
    expectedCatalogCount,
    agentId: options.agentId,
    requestTimeoutMs: options.timeoutMs,
  };
}

/** Process config for the P2 read/search/result facade. It has no command
 * approval token and is still supervised by the same ACI manager. */
export function createReadonlyVerseShellProcessConfig(options: {
  cwd: string;
  timeoutMs?: number;
  agentId?: string;
  env?: NodeJS.ProcessEnv;
}): VerseShellProcessConfig {
  return {
    ...createGovernedVerseShellProcessConfig(options),
    policyProfile: VERSESHELL_READONLY_FACADE_PROFILE_ID,
  };
}

/** Process config for the P3 patch-preview bridge. It requests only read
 * operations; commit/undo/recovery stay with the ClawX write journal. */
export function createPatchPreviewVerseShellProcessConfig(options: {
  cwd: string;
  timeoutMs?: number;
  agentId?: string;
  env?: NodeJS.ProcessEnv;
}): VerseShellProcessConfig {
  return {
    ...createGovernedVerseShellProcessConfig(options),
    policyProfile: VERSESHELL_PATCH_PREVIEW_PROFILE_ID,
  };
}

function processConfig(options: {
  cwd: string;
  timeoutMs?: number;
  agentId?: string;
  env?: NodeJS.ProcessEnv;
}): VerseShellProcessConfig {
  return createGovernedVerseShellProcessConfig(options);
}

function boundedInteger(value: number | undefined, fallback: number, maximum: number): number {
  if (!Number.isInteger(value) || (value ?? 0) <= 0) return fallback;
  return Math.min(value!, maximum);
}

function validateResultQuery(options: GovernedVerseShellResultQueryOptions): void {
  try {
    decodeResultQueryRequest({
      handle: options.handle,
      mode: options.mode,
      ...(options.lines === undefined ? {} : { lines: options.lines }),
      ...(options.startLine === undefined ? {} : { start_line: options.startLine }),
      ...(options.endLine === undefined ? {} : { end_line: options.endLine }),
      ...(options.pattern === undefined ? {} : { pattern: options.pattern }),
      ...(options.maxMatches === undefined ? {} : { max_matches: Math.min(options.maxMatches, MAX_RESULT_MATCHES) }),
    }, {
      max_bytes: MAX_RESULT_BYTES,
      max_tokens: MAX_RESULT_TOKENS,
      max_lines: MAX_RESULT_LINES,
      max_matches: MAX_RESULT_MATCHES,
    });
  } catch (error) {
    const code = error instanceof Error && "code" in error ? String((error as { code?: unknown }).code) : "E_VERSESHELL_RESULT_QUERY";
    const message = error instanceof Error ? error.message : "VerseShell result query is invalid";
    const mapped = code === "result_query_invalid"
      ? message.includes("handle")
        ? "E_VERSESHELL_RESULT_HANDLE"
        : message.includes("pattern")
          ? "E_VERSESHELL_RESULT_PATTERN"
          : message.includes("slice") || message.includes("end_line")
            ? "E_VERSESHELL_RESULT_RANGE"
            : "E_VERSESHELL_RESULT_QUERY"
      : code;
    throw new GovernedVerseShellError(mapped, message);
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function approvalToken(observation: Observation): string | undefined {
  const token = asRecord(observation.data)?.approval_token;
  return typeof token === "string" && APPROVAL_TOKEN.test(token) ? token : undefined;
}

function diagnosticLine(diagnostic: Diagnostic): string {
  const location = diagnostic.path
    ? `${diagnostic.path}${diagnostic.line ? `:${diagnostic.line}` : ""}${diagnostic.column ? `:${diagnostic.column}` : ""}`
    : diagnostic.tool;
  const code = diagnostic.code ? ` ${diagnostic.code}` : "";
  return `${location}: ${diagnostic.severity}${code}: ${diagnostic.message}`;
}

function streamText(value: unknown): { text: string; artifact?: string } {
  const stream = asRecord(value);
  if (!stream) return { text: "" };
  const text = typeof stream.text === "string"
    ? stream.text
    : typeof stream.summary === "string"
      ? stream.summary
      : "";
  const artifact = typeof stream.artifact === "string" && stream.artifact.startsWith("result://")
    ? stream.artifact
    : undefined;
  if (artifact && !RESULT_HANDLE.test(artifact)) {
    throw new GovernedVerseShellError("E_VERSESHELL_RESULT_HANDLE", "VerseShell returned a malformed artifact handle");
  }
  return { text, artifact };
}

function formatObservation(observation: Observation): GovernedVerseShellExecResult {
  const data = asRecord(observation.data) ?? {};
  const stdout = streamText(data.stdout);
  const stderr = streamText(data.stderr);
  const diagnostics = (observation.diagnostics ?? []).map(diagnosticLine);
  const stdoutParts = [stdout.text, stdout.artifact ? `[VerseShell stdout artifact: ${stdout.artifact}]` : ""];
  const stderrParts = [
    stderr.text,
    ...diagnostics,
    stderr.artifact ? `[VerseShell stderr artifact: ${stderr.artifact}]` : "",
  ];
  const artifacts = [stdout.artifact, stderr.artifact].filter((value): value is string => Boolean(value));
  const stdoutCapture = asRecord(data.stdout) && "raw_bytes" in (data.stdout as Record<string, unknown>)
    ? extractStreamCapture(data.stdout, "$observation.data.stdout")
    : undefined;
  const stderrCapture = asRecord(data.stderr) && "raw_bytes" in (data.stderr as Record<string, unknown>)
    ? extractStreamCapture(data.stderr, "$observation.data.stderr")
    : undefined;
  const artifactMetadata = Array.isArray(data.artifacts) && data.artifacts.some((entry) => asRecord(entry)?.digest !== undefined)
    ? extractArtifactDescriptors(observation)
    : undefined;
  const exitCode = typeof data.exit_code === "number" && Number.isInteger(data.exit_code)
    ? data.exit_code
    : observation.ok
      ? 0
      : 1;
  const timedOut = data.timed_out === true || observation.error?.code === "E_TIMEOUT";
  const commandCompleted = observation.ok || observation.error?.code === "E_PROCESS_EXIT" || timedOut;
  if (!commandCompleted) {
    throw new GovernedVerseShellError(
      observation.error?.code ?? "E_VERSESHELL_OPERATION",
      observation.error?.message ?? "VerseShell operation was rejected",
      observation.error?.hint,
    );
  }
  return {
    stdout: stdoutParts.filter(Boolean).join("\n").trim(),
    stderr: stderrParts.filter(Boolean).join("\n").trim(),
    success: observation.ok && exitCode === 0 && !timedOut,
    exitCode,
    timedOut,
    profile: observation.meta.profile,
    tokenEstimate: observation.meta.token_estimate,
    artifacts,
    ...(artifactMetadata ? { artifactMetadata } : {}),
    ...(stdoutCapture ? { stdoutCapture } : {}),
    ...(stderrCapture ? { stderrCapture } : {}),
  };
}

async function executeOnce(
  manager: VerseShellProcessManager,
  config: VerseShellProcessConfig,
  args: JsonObject,
  timeoutMs: number | undefined,
): Promise<{ observation: Observation; processKey: string }> {
  const client = await manager.getClient(config);
  const observation = await client.execute("exec.run", args, {
    timeoutMs,
    effectful: true,
  });
  return { observation, processKey: client.processKey };
}

/** Execute one host-policy-approved command through strict typed ACI without native fallback. */
/** @deprecated Compatibility-contract helper only; production exec uses governed-process.ts. */
export async function executeGovernedVerseShell(
  options: GovernedVerseShellExecOptions,
): Promise<GovernedVerseShellExecResult> {
  const manager = managerFor(options);
  const config = processConfig(options);
  const timeoutMs = options.timeoutMs;
  const plan = options.executionPlan ?? resolveVerseShellCommandPlan({
    command: options.command,
    argv: options.argv,
    cwd: options.cwd,
    env: options.env,
    allowExplicitShell: options.shellMode !== "argv",
  });
  const args: JsonObject = {
    argv: plan.argv,
    cwd: ".",
    profile: "auto",
    artifact: "auto",
    ...(timeoutMs ? { timeout_ms: timeoutMs } : {}),
  };
  const first = await executeOnce(manager, config, args, timeoutMs);
  if (first.observation.error?.code !== "E_NEEDS_APPROVAL") {
    return formatObservation(first.observation);
  }
  if (!options.hostPolicyApproved) {
    return formatObservation(first.observation);
  }
  const token = approvalToken(first.observation);
  if (!token) {
    throw new GovernedVerseShellError(
      "E_VERSESHELL_APPROVAL_CONTRACT",
      "VerseShell did not return a valid action-bound approval token",
    );
  }

  const approvedConfig = { ...config, approvalToken: token };
  const approvedClient = await manager.getClient(approvedConfig);
  try {
    const observation = await approvedClient.execute("exec.run", args, {
      timeoutMs,
      effectful: true,
    });
    return formatObservation(observation);
  } finally {
    // Never retain an approval-bearing process after the one bound action completes.
    await manager.shutdownProcess(approvedClient.processKey);
  }
}

/** Read a bounded slice of a prior result artifact through the same verified ACI process. */
export async function queryGovernedVerseShellResult(
  options: GovernedVerseShellResultQueryOptions,
): Promise<Observation> {
  if (!RESULT_HANDLE.test(options.handle)) {
    throw new GovernedVerseShellError(
      "E_VERSESHELL_RESULT_HANDLE",
      "VerseShell result handle is invalid",
    );
  }
  validateResultQuery(options);
  const manager = options.manager ?? managerFor({
    command: "",
    cwd: options.cwd,
    hostPolicyApproved: false,
    agentId: options.agentId,
    env: options.env,
  });
  const client = await manager.getClient(processConfig(options));
  const args: JsonObject = {
    mode: options.mode,
    max_bytes: MAX_RESULT_BYTES,
    max_tokens: MAX_RESULT_TOKENS,
    ...(options.lines ? { lines: boundedInteger(options.lines, 40, MAX_RESULT_LINES) } : {}),
    ...(options.startLine ? { start_line: boundedInteger(options.startLine, 1, 1_000_000) } : {}),
    ...(options.endLine ? { end_line: boundedInteger(options.endLine, 1, 1_000_000) } : {}),
    ...(options.pattern ? { pattern: options.pattern.trim() } : {}),
    ...(options.maxMatches
      ? { max_matches: boundedInteger(options.maxMatches, 50, MAX_RESULT_MATCHES) }
      : {}),
  };
  const observation = await client.queryResult(options.handle, args, {
    retryable: true,
    effectful: false,
    traceId: options.trace?.traceId,
  });
  if (observation.op !== "result.query") {
    throw new GovernedVerseShellError(
      "E_VERSESHELL_RESULT_QUERY",
      `VerseShell result query response operation mismatch: ${observation.op}`,
    );
  }
  extractArtifactHandles(observation);
  const queryData = asRecord(observation.data);
  if (Array.isArray(queryData?.artifacts) && queryData.artifacts.length > 0) {
    extractArtifactDescriptors(observation, { now_ms: Date.now(), expected_owner: options.expectedOwner });
  }
  if (queryData !== undefined) {
    const bytes = new TextEncoder().encode(JSON.stringify(queryData)).byteLength;
    if (bytes > MAX_RESULT_BYTES) {
      throw new GovernedVerseShellError(
        "E_VERSESHELL_RESULT_QUERY",
        `VerseShell result query response exceeds ${MAX_RESULT_BYTES} bytes`,
      );
    }
  }
  if (!observation.ok) {
    throw new GovernedVerseShellError(
      observation.error?.code ?? "E_VERSESHELL_RESULT_QUERY",
      observation.error?.message ?? "VerseShell result query failed",
      observation.error?.hint,
    );
  }
  if (!queryData || Object.keys(queryData).length === 0) {
    throw new GovernedVerseShellError(
      "E_VERSESHELL_RESULT_MISSING",
      "VerseShell result query returned no bounded data",
    );
  }
  return observation;
}

export async function shutdownGovernedVerseShell(): Promise<void> {
  const manager = sharedManager;
  sharedManager = undefined;
  await manager?.shutdownAll();
}
