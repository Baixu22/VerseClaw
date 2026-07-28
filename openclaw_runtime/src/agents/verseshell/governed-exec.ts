import type { Diagnostic, JsonObject, Observation } from "../../../../shared/verseshell/types.js";
import { VerseShellProcessManager, type VerseShellProcessConfig } from "./process-manager.js";
import { VERSESHELL_GOVERNED_EXEC_PROFILE_ID } from "./policy-profile.js";
import { resolveVerseShellCommandArgv } from "./shell-command.js";

const SHA256_DIGEST = /^sha256:[a-f0-9]{64}$/;
const APPROVAL_TOKEN = /^apv_[a-f0-9]{16}$/;
const RESULT_HANDLE = /^result:\/\/sha256\/[a-f0-9]{64}$/u;
const RESULT_QUERY_MODES = new Set(["meta", "head", "tail", "slice", "grep", "raw"]);
const MAX_RESULT_LINES = 500;
const MAX_RESULT_PATTERN_LENGTH = 500;
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
};

export type GovernedVerseShellExecOptions = {
  command: string;
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

function managerFor(options: GovernedVerseShellExecOptions): VerseShellProcessManager {
  if (options.manager) return options.manager;
  sharedManager ??= new VerseShellProcessManager();
  return sharedManager;
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

function processConfig(options: {
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

function boundedInteger(value: number | undefined, fallback: number, maximum: number): number {
  if (!Number.isInteger(value) || (value ?? 0) <= 0) return fallback;
  return Math.min(value!, maximum);
}

function validateResultQuery(options: GovernedVerseShellResultQueryOptions): void {
  if (!RESULT_QUERY_MODES.has(options.mode)) {
    throw new GovernedVerseShellError(
      "E_VERSESHELL_RESULT_MODE",
      "VerseShell result query mode is invalid",
    );
  }
  if (options.mode === "grep") {
    const pattern = options.pattern?.trim();
    if (!pattern) {
      throw new GovernedVerseShellError(
        "E_VERSESHELL_RESULT_PATTERN",
        "VerseShell grep result query requires a pattern",
      );
    }
    if (pattern.length > MAX_RESULT_PATTERN_LENGTH) {
      throw new GovernedVerseShellError(
        "E_VERSESHELL_RESULT_PATTERN",
        `VerseShell grep pattern exceeds ${MAX_RESULT_PATTERN_LENGTH} characters`,
      );
    }
  }
  if (options.mode === "slice") {
    const startLine = boundedInteger(options.startLine, 1, 1_000_000);
    const endLine = options.endLine === undefined
      ? startLine + boundedInteger(options.lines, 40, MAX_RESULT_LINES) - 1
      : boundedInteger(options.endLine, startLine, 1_000_000);
    if (endLine < startLine) {
      throw new GovernedVerseShellError(
        "E_VERSESHELL_RESULT_RANGE",
        "VerseShell result slice endLine must be greater than or equal to startLine",
      );
    }
    if (endLine - startLine + 1 > MAX_RESULT_LINES) {
      throw new GovernedVerseShellError(
        "E_VERSESHELL_RESULT_RANGE",
        `VerseShell result slices are limited to ${MAX_RESULT_LINES} lines`,
      );
    }
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
export async function executeGovernedVerseShell(
  options: GovernedVerseShellExecOptions,
): Promise<GovernedVerseShellExecResult> {
  const manager = managerFor(options);
  const config = processConfig(options);
  const timeoutMs = options.timeoutMs;
  const argv = resolveVerseShellCommandArgv(options.command, undefined, options.env ?? process.env);
  const args: JsonObject = {
    argv,
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
  const observation = await client.queryResult(options.handle, args);
  if (!observation.ok) {
    throw new GovernedVerseShellError(
      observation.error?.code ?? "E_VERSESHELL_RESULT_QUERY",
      observation.error?.message ?? "VerseShell result query failed",
      observation.error?.hint,
    );
  }
  return observation;
}

export async function shutdownGovernedVerseShell(): Promise<void> {
  const manager = sharedManager;
  sharedManager = undefined;
  await manager?.shutdownAll();
}
