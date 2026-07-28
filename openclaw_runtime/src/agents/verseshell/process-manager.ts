import { createHash } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptions } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { sanitizeHostExecEnv } from "../../infra/host-env-security.js";
import { killProcessTree } from "../../process/kill-tree.js";
import {
  AciProcessExitedError,
  AciProtocolError,
  AciTimeoutError,
  AciTransportError,
  type AciExecuteOptions,
  type AciTransport,
  VerseShellAciClient,
} from "./aci-client.js";
import { parseAciFrame, type JsonObject, type Observation } from "./normalizer.js";
import {
  resolveVerseShellPolicyProfile,
  type VerseShellPolicyProfileId,
} from "./policy-profile.js";

const VERSESHELL_OBSERVATION_SCHEMA = "verseshell.observation/v1";
const VERSESHELL_OPERATION_CATALOG_SCHEMA = "verseshell.operation-catalog/v1";
const VERSESHELL_CAPABILITY_MODE = "allow_list";

export type ResolvedVerseShellBinary = {
  path: string;
  source: "verified-bundled" | "dev-override" | "test";
  verified: boolean;
};

export type VerseShellBinaryResolver = () => Promise<ResolvedVerseShellBinary> | ResolvedVerseShellBinary;

export type AciChildProcess = Pick<
  ChildProcessWithoutNullStreams,
  | "stdin"
  | "stdout"
  | "stderr"
  | "pid"
  | "killed"
  | "exitCode"
  | "signalCode"
  | "on"
  | "once"
  | "kill"
>;

export type AciSpawn = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => AciChildProcess;

export type VerseShellProcessConfig = {
  workspace: string;
  /** Repository-reviewed profile; capabilities and digest are derived internally. */
  policyProfile: VerseShellPolicyProfileId;
  expectedBinaryVersion: string;
  expectedProtocolVersion: string;
  expectedCatalogDigest: string;
  expectedCatalogCount: number;
  /** Upstream action-bound token, isolated to this process identity. */
  approvalToken?: string;
  agentId?: string;
  requestTimeoutMs?: number;
  handshakeTimeoutMs?: number;
  maxConcurrency?: number;
  maxQueueSize?: number;
  maxLineBytes?: number;
};

export type VerseShellProcessManagerOptions = {
  maxProcesses?: number;
  idleTtlMs?: number;
  idleSweepMs?: number;
  maxRestarts?: number;
  restartBaseDelayMs?: number;
  restartMaxDelayMs?: number;
  shutdownGraceMs?: number;
  resolveBinary?: VerseShellBinaryResolver;
  spawnProcess?: AciSpawn;
  now?: () => number;
};

export type VerseShellProcessHealth = {
  key: string;
  workspace: string;
  capabilities: readonly string[];
  policyProfile: string;
  policyProfileDigest: string;
  policyMode: "agent_strict";
  binaryVersion: string;
  protocolVersion: string;
  catalogDigest: string;
  catalogCount: number;
  state: "starting" | "ready" | "backoff" | "stopped" | "failed";
  pid: number | null;
  active: number;
  queued: number;
  restartAttempts: number;
  lastUsedAt: number;
  lastError?: string;
};

type ImmutableProcessConfig = Readonly<{
  key: string;
  workspace: string;
  capabilities: readonly string[];
  policyProfile: string;
  policyProfileDigest: string;
  expectedPolicyMode: "agent_strict";
  expectedBinaryVersion: string;
  expectedProtocolVersion: string;
  expectedCatalogDigest: string;
  expectedCatalogCount: number;
  agentId: string;
  requestTimeoutMs: number;
  handshakeTimeoutMs: number;
  maxConcurrency: number;
  maxQueueSize: number;
  maxLineBytes: number;
  approvalToken?: string;
}>;

type RequestEntry = {
  id: string;
  op: string;
  args: JsonObject;
  timeoutMs: number;
  resolve: (observation: Observation) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
  sent: boolean;
};

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const MAX_REQUEST_TIMEOUT_MS = 10 * 60_000;
const DEFAULT_HANDSHAKE_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_LINE_BYTES = 4 * 1024 * 1024;
const DEFAULT_MAX_CONCURRENCY = 4;
const DEFAULT_MAX_QUEUE_SIZE = 64;
const STRICT_POLICY_ARGUMENT = "strict";
const STRICT_POLICY_MODE = "agent_strict" as const;
const SHA256_DIGEST = /^sha256:[a-f0-9]{64}$/;
const BINARY_SHA256 = /^[a-f0-9]{64}$/;
const APPROVAL_TOKEN = /^apv_[a-f0-9]{16}$/;
const APPROVAL_TOKEN_IN_TEXT = /apv_[a-f0-9]{16}/giu;

let cachedDefaultBinary:
  | { key: string; promise: Promise<ResolvedVerseShellBinary> }
  | undefined;

function unrefTimer<T extends NodeJS.Timeout>(timer: T): T {
  timer.unref?.();
  return timer;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    unrefTimer(setTimeout(resolve, Math.max(0, ms)));
  });
}

function clampPositive(value: number | undefined, fallback: number, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isFinite(value) || (value ?? 0) <= 0) return fallback;
  return Math.min(Math.trunc(value!), max);
}

function canonicalCapabilityList(capabilities: readonly string[]): readonly string[] {
  const normalized = Array.from(
    new Set(capabilities.map((capability) => capability.trim()).filter(Boolean)),
  ).sort();
  if (normalized.length === 0) {
    throw new AciProtocolError("VerseShell requires an explicit non-empty capability allow-list");
  }
  if (normalized.some((capability) => capability.toLowerCase() === "all")) {
    throw new AciProtocolError('VerseShell capability "all" is forbidden');
  }
  return Object.freeze(normalized);
}

function validatePolicyProfile(policyProfile: string): string {
  const normalized = policyProfile.trim();
  if (!normalized) throw new AciProtocolError("VerseShell policy profile is required");
  if (normalized.toLowerCase() === "permissive") {
    throw new AciProtocolError("VerseShell permissive policy is forbidden");
  }
  return normalized;
}

function validatePolicyProfileDigest(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!SHA256_DIGEST.test(normalized)) {
    throw new AciProtocolError("VerseShell policy profile digest must be a sha256:<64 lowercase hex> value");
  }
  return normalized;
}

function validateCatalogDigest(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!SHA256_DIGEST.test(normalized)) {
    throw new AciProtocolError("VerseShell operation catalog digest must be a sha256:<64 lowercase hex> value");
  }
  return normalized;
}

function validateApprovalToken(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (!APPROVAL_TOKEN.test(normalized)) {
    throw new AciProtocolError("VerseShell approval token has an invalid action-bound shape");
  }
  return normalized;
}

function validateCatalogCount(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new AciProtocolError("VerseShell operation catalog count must be a positive safe integer");
  }
  return value;
}

function redactApprovalTokens(value: string): string {
  return value.replace(APPROVAL_TOKEN_IN_TEXT, "[REDACTED_APPROVAL_TOKEN]");
}

async function canonicalWorkspace(workspace: string): Promise<string> {
  const resolved = path.resolve(workspace);
  const real = await fs.realpath(resolved);
  return process.platform === "win32" ? real.replace(/\\/g, "/").toLowerCase() : real;
}

function processKey(config: Omit<ImmutableProcessConfig, "key">): string {
  const material = JSON.stringify({
    workspace: config.workspace,
    capabilities: config.capabilities,
    policy_profile: config.policyProfile,
    policy_profile_digest: config.policyProfileDigest,
    policy_mode: config.expectedPolicyMode,
    binary_version: config.expectedBinaryVersion,
    protocol_version: config.expectedProtocolVersion,
    catalog_digest: config.expectedCatalogDigest,
    catalog_count: config.expectedCatalogCount,
    approval_token_digest: config.approvalToken
      ? createHash("sha256").update(config.approvalToken).digest("hex")
      : null,
  });
  return createHash("sha256").update(material).digest("hex");
}

/** Verify the Electron-resolved immutable binary identity once per Gateway process. */
export function resolveDefaultVerseShellBinary(): Promise<ResolvedVerseShellBinary> {
  const executable = process.env.VERSESHELL_AE_PATH?.trim();
  const expectedSha256 = process.env.VERSESHELL_AE_SHA256?.trim().toLowerCase();
  const provenance = process.env.VERSESHELL_RUNTIME_PROVENANCE?.trim();
  if (!executable || provenance !== "verified" || !expectedSha256 || !BINARY_SHA256.test(expectedSha256)) {
    return Promise.reject(
      new AciTransportError(
        "E_ACI_BINARY_UNAVAILABLE",
        "VerseShell typed ACI requires an Electron-verified binary path and SHA-256 identity",
      ),
    );
  }
  const key = `${path.resolve(executable)}\0${expectedSha256}`;
  if (cachedDefaultBinary?.key === key) return cachedDefaultBinary.promise;
  const promise = (async (): Promise<ResolvedVerseShellBinary> => {
    const resolved = await fs.realpath(path.resolve(executable));
    const info = await fs.stat(resolved);
    if (!info.isFile() || info.size <= 0) {
      throw new AciTransportError("E_ACI_BINARY_UNAVAILABLE", "Verified VerseShell binary is missing");
    }
    const actualSha256 = createHash("sha256").update(await fs.readFile(resolved)).digest("hex");
    if (actualSha256 !== expectedSha256) {
      throw new AciTransportError(
        "E_ACI_BINARY_UNVERIFIED",
        "VerseShell binary SHA-256 no longer matches the Electron-verified identity",
      );
    }
    return { path: resolved, source: "verified-bundled", verified: true };
  })();
  cachedDefaultBinary = { key, promise };
  return promise;
}

function defaultSpawn(command: string, args: readonly string[], options: SpawnOptions): AciChildProcess {
  return spawn(command, [...args], options) as ChildProcessWithoutNullStreams;
}

class ManagedAciProcess implements AciTransport {
  readonly key: string;
  readonly workspace: string;
  readonly capabilities: readonly string[];
  readonly protocolVersion: string;
  readonly catalogDigest: string;
  readonly catalogCount: number;

  private child: AciChildProcess | null = null;
  private state: VerseShellProcessHealth["state"] = "stopped";
  private startPromise: Promise<void> | null = null;
  private restartTimer: NodeJS.Timeout | null = null;
  private restartAttempts = 0;
  private requestCounter = 0;
  private active = 0;
  private readonly pending = new Map<string, RequestEntry>();
  private readonly queue: RequestEntry[] = [];
  private stdoutBuffer = Buffer.alloc(0);
  private intentionallyStopping = false;
  private disposed = false;
  private lastError: string | undefined;
  private _lastUsedAt: number;

  constructor(
    private readonly config: ImmutableProcessConfig,
    private readonly binary: ResolvedVerseShellBinary,
    private readonly options: Required<
      Pick<
        VerseShellProcessManagerOptions,
        | "maxRestarts"
        | "restartBaseDelayMs"
        | "restartMaxDelayMs"
        | "shutdownGraceMs"
        | "spawnProcess"
        | "now"
      >
    >,
  ) {
    this.key = config.key;
    this.workspace = config.workspace;
    this.capabilities = config.capabilities;
    this.protocolVersion = config.expectedProtocolVersion;
    this.catalogDigest = config.expectedCatalogDigest;
    this.catalogCount = config.expectedCatalogCount;
    this._lastUsedAt = options.now();
  }

  get lastUsedAt(): number {
    return this._lastUsedAt;
  }

  get idle(): boolean {
    return this.active === 0 && this.queue.length === 0 && this.pending.size === 0;
  }

  health(): VerseShellProcessHealth {
    return {
      key: this.key,
      workspace: this.workspace,
      capabilities: this.capabilities,
      policyProfile: this.config.policyProfile,
      policyProfileDigest: this.config.policyProfileDigest,
      policyMode: this.config.expectedPolicyMode,
      binaryVersion: this.config.expectedBinaryVersion,
      protocolVersion: this.protocolVersion,
      catalogDigest: this.catalogDigest,
      catalogCount: this.catalogCount,
      state: this.state,
      pid: this.child?.pid ?? null,
      active: this.active,
      queued: this.queue.length,
      restartAttempts: this.restartAttempts,
      lastUsedAt: this.lastUsedAt,
      lastError: this.lastError,
    };
  }

  async ensureStarted(): Promise<void> {
    if (this.disposed) throw new AciTransportError("E_ACI_SHUTDOWN", "ACI process is shut down");
    if (this.state === "ready" && this.child) return;
    if (this.restartTimer) {
      throw new AciTransportError("E_ACI_BACKOFF", "VerseShell process is restarting");
    }
    if (!this.startPromise) {
      this.startPromise = this.start().finally(() => {
        this.startPromise = null;
      });
    }
    return this.startPromise;
  }

  request(op: string, args: JsonObject, opts: AciExecuteOptions = {}): Promise<Observation> {
    if (this.disposed) {
      return Promise.reject(new AciTransportError("E_ACI_SHUTDOWN", "ACI process is shut down"));
    }
    if (opts.signal?.aborted) {
      return Promise.reject(new AciTransportError("E_ACI_ABORTED", "ACI request was aborted"));
    }
    if (this.queue.length >= this.config.maxQueueSize) {
      return Promise.reject(new AciTransportError("E_ACI_QUEUE_FULL", "VerseShell request queue is full"));
    }

    const timeoutMs = clampPositive(
      opts.timeoutMs,
      this.config.requestTimeoutMs,
      MAX_REQUEST_TIMEOUT_MS,
    );
    const id = `aci-${++this.requestCounter}`;
    this._lastUsedAt = this.options.now();

    return new Promise<Observation>((resolve, reject) => {
      const timer = unrefTimer(
        setTimeout(() => this.timeoutRequest(id), timeoutMs),
      );
      const entry: RequestEntry = {
        id,
        op,
        args,
        timeoutMs,
        resolve,
        reject,
        timer,
        sent: false,
      };
      this.queue.push(entry);
      if (opts.signal) {
        opts.signal.addEventListener(
          "abort",
          () => this.abortRequest(id),
          { once: true },
        );
      }
      void this.ensureStarted()
        .then(() => this.drainQueue())
        .catch((error) => this.rejectQueuedEntry(id, asTransportError(error)));
    });
  }

  private async start(): Promise<void> {
    this.state = "starting";
    this.intentionallyStopping = false;
    this.stdoutBuffer = Buffer.alloc(0);
    const args = [
      "--serve",
      "--agent",
      "--format",
      "json",
      "--policy",
      STRICT_POLICY_ARGUMENT,
      "--workspace",
      this.config.workspace,
      "--max-concurrency",
      String(this.config.maxConcurrency),
      "--cap",
      this.config.capabilities.join(","),
    ];
    const env = sanitizeHostExecEnv({
      baseEnv: process.env,
      overrides: {
        AETHER_WORKSPACE: this.config.workspace,
        AETHER_MODE: "agent",
        AETHER_POLICY: "strict",
        VERSESHELL_WORKSPACE: this.config.workspace,
        AE_FORMAT: "json",
        VERSESHELL_POLICY_PROFILE_ID: this.config.policyProfile,
        VERSESHELL_POLICY_PROFILE_DIGEST: this.config.policyProfileDigest,
      },
      blockPathOverrides: true,
    });
    for (const key of Object.keys(env)) {
      if (key.toUpperCase() === "AETHER_APPROVE" || key.toUpperCase() === "AETHER_APPROVE_ALL") {
        delete env[key];
      }
    }
    if (this.config.approvalToken) env.AETHER_APPROVE = this.config.approvalToken;

    let child: AciChildProcess;
    try {
      child = this.options.spawnProcess(this.binary.path, args, {
        cwd: this.config.workspace,
        env,
        stdio: ["pipe", "pipe", "pipe"],
        detached: process.platform !== "win32",
        windowsHide: true,
      });
    } catch (error) {
      const transportError = new AciTransportError(
        "E_ACI_SPAWN",
        `Failed to spawn VerseShell: ${String(error)}`,
        error,
      );
      this.failStart(transportError);
      throw transportError;
    }
    this.child = child;
    child.stdout.on("data", (chunk: Buffer | string) => this.handleStdout(chunk));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      const message = chunk.trim();
      if (message) this.lastError = redactApprovalTokens(message).slice(0, 2_000);
    });
    child.once("error", (error) => this.handleProcessFailure(error));
    child.once("close", (code, signal) => this.handleProcessClose(code, signal));

    const observation = await this.sendHandshake();
    this.validateHandshake(observation);
    this.state = "ready";
    this.lastError = undefined;
    this.drainQueue();
  }

  private sendHandshake(): Promise<Observation> {
    const id = `aci-handshake-${++this.requestCounter}`;
    return new Promise((resolve, reject) => {
      const timer = unrefTimer(
        setTimeout(() => {
          this.pending.delete(id);
          const error = new AciTimeoutError(
            `VerseShell runtime.handshake timed out after ${this.config.handshakeTimeoutMs}ms`,
            this.config.handshakeTimeoutMs,
          );
          this.failProtocol(error);
          reject(error);
        }, this.config.handshakeTimeoutMs),
      );
      const entry: RequestEntry = {
        id,
        op: "runtime.handshake",
        args: {},
        timeoutMs: this.config.handshakeTimeoutMs,
        resolve,
        reject,
        timer,
        sent: true,
      };
      this.pending.set(id, entry);
      this.writeEntry(entry);
    });
  }

  private validateHandshake(observation: Observation): void {
    if (!observation.ok || typeof observation.data !== "object" || observation.data === null || Array.isArray(observation.data)) {
      throw new AciProtocolError("VerseShell runtime.handshake did not return successful data");
    }
    const data = observation.data as Record<string, unknown>;
    const capabilityState =
      typeof data.capabilities === "object" && data.capabilities !== null && !Array.isArray(data.capabilities)
        ? (data.capabilities as Record<string, unknown>)
        : {};
    const capabilities = Array.isArray(capabilityState.granted)
      ? capabilityState.granted.filter((item): item is string => typeof item === "string").sort()
      : [];
    const workspaceState =
      typeof data.workspace === "object" && data.workspace !== null && !Array.isArray(data.workspace)
        ? (data.workspace as Record<string, unknown>)
        : {};
    const operationCatalog =
      typeof data.operation_catalog === "object" &&
      data.operation_catalog !== null &&
      !Array.isArray(data.operation_catalog)
        ? (data.operation_catalog as Record<string, unknown>)
        : {};
    const expectedCapabilities = [...this.config.capabilities];
    const mismatches = [
      data.crate_version === this.config.expectedBinaryVersion ? null : "crate_version",
      data.runtime_version === this.config.expectedBinaryVersion ? null : "runtime_version",
      data.server_protocol === this.config.expectedProtocolVersion ? null : "server_protocol",
      data.observation_schema === VERSESHELL_OBSERVATION_SCHEMA ? null : "observation_schema",
      data.operation_catalog_schema === VERSESHELL_OPERATION_CATALOG_SCHEMA
        ? null
        : "operation_catalog_schema",
      workspaceState.id === workspaceId(this.config.workspace) && workspaceState.canonical === true
        ? null
        : "workspace",
      capabilityState.mode === VERSESHELL_CAPABILITY_MODE ? null : "capabilities.mode",
      JSON.stringify(capabilities) === JSON.stringify(expectedCapabilities) ? null : "capabilities",
      data.policy_mode === this.config.expectedPolicyMode ? null : "policy_mode",
      typeof data.policy_profile === "object" &&
      data.policy_profile !== null &&
      !Array.isArray(data.policy_profile) &&
      (data.policy_profile as Record<string, unknown>).id === this.config.policyProfile &&
      (data.policy_profile as Record<string, unknown>).digest === this.config.policyProfileDigest
        ? null
        : "policy_profile",
      operationCatalog.digest === this.config.expectedCatalogDigest ? null : "operation_catalog.digest",
      operationCatalog.count === this.config.expectedCatalogCount ? null : "operation_catalog.count",
    ].filter(Boolean);
    if (mismatches.length > 0) {
      const error = new AciProtocolError(
        `VerseShell handshake mismatch: ${mismatches.join(", ")}`,
      );
      this.failProtocol(error);
      throw error;
    }
  }

  private handleStdout(chunk: Buffer | string): void {
    const bytes = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
    this.stdoutBuffer = Buffer.concat([this.stdoutBuffer, bytes]);
    if (this.stdoutBuffer.length > this.config.maxLineBytes && this.stdoutBuffer.indexOf(0x0a) === -1) {
      this.failProtocol(new AciProtocolError("VerseShell emitted an oversized JSONL frame"));
      return;
    }

    while (true) {
      const newline = this.stdoutBuffer.indexOf(0x0a);
      if (newline === -1) break;
      const lineBuffer = this.stdoutBuffer.subarray(0, newline);
      this.stdoutBuffer = this.stdoutBuffer.subarray(newline + 1);
      if (lineBuffer.length > this.config.maxLineBytes) {
        this.failProtocol(new AciProtocolError("VerseShell emitted an oversized JSONL frame"));
        return;
      }
      const line = lineBuffer.toString("utf8").replace(/\r$/, "");
      if (!line.trim()) continue;
      const frame = parseAciFrame(line, this.config.maxLineBytes);
      if (!frame) {
        this.failProtocol(new AciProtocolError("VerseShell emitted a malformed JSONL frame"));
        return;
      }
      if (frame.kind === "control") continue;
      const entry = this.pending.get(frame.observation.id);
      if (!entry) {
        this.failProtocol(
          new AciProtocolError(`VerseShell response id mismatch: ${frame.observation.id}`),
        );
        return;
      }
      if (frame.observation.op !== entry.op) {
        this.failProtocol(
          new AciProtocolError(
            `VerseShell response op mismatch for ${entry.id}: ${frame.observation.op}`,
          ),
        );
        return;
      }
      this.pending.delete(entry.id);
      clearTimeout(entry.timer);
      if (!entry.op.startsWith("runtime.handshake")) this.active--;
      this._lastUsedAt = this.options.now();
      entry.resolve(frame.observation);
      this.drainQueue();
    }
  }

  private drainQueue(): void {
    if (this.state !== "ready" || !this.child) return;
    while (this.active < this.config.maxConcurrency && this.queue.length > 0) {
      const entry = this.queue.shift()!;
      if (entry.sent) continue;
      entry.sent = true;
      this.active++;
      this.pending.set(entry.id, entry);
      this.writeEntry(entry);
    }
  }

  private writeEntry(entry: RequestEntry): void {
    if (!this.child) {
      this.rejectEntry(entry, new AciTransportError("E_ACI_NOT_RUNNING", "VerseShell is not running"));
      return;
    }
    const request = JSON.stringify({
      id: entry.id,
      op: entry.op,
      args: entry.args,
      agent: this.config.agentId,
      timeout_ms: entry.timeoutMs,
      budget: { max_tokens: 4_000 },
    });
    try {
      this.child.stdin.write(`${request}\n`, "utf8");
    } catch (error) {
      this.pending.delete(entry.id);
      if (entry.sent && entry.op !== "runtime.handshake") this.active--;
      this.rejectEntry(
        entry,
        new AciTransportError("E_ACI_WRITE", `VerseShell write failed: ${String(error)}`, error),
      );
    }
  }

  private timeoutRequest(id: string): void {
    const queuedIndex = this.queue.findIndex((entry) => entry.id === id);
    if (queuedIndex >= 0) {
      const [entry] = this.queue.splice(queuedIndex, 1);
      this.rejectEntry(
        entry,
        new AciTimeoutError(`ACI request ${entry.op} timed out in queue`, entry.timeoutMs),
      );
      return;
    }
    const entry = this.pending.get(id);
    if (!entry) return;
    this.pending.delete(id);
    if (entry.op !== "runtime.handshake") this.active--;
    this.rejectEntry(
      entry,
      new AciTimeoutError(`ACI request ${entry.op} timed out`, entry.timeoutMs),
    );
    // The server cannot cancel a single evaluation. Kill without replaying any request.
    this.failProtocol(new AciTimeoutError("VerseShell process reset after request timeout", entry.timeoutMs));
  }

  private abortRequest(id: string): void {
    const error = new AciTransportError("E_ACI_ABORTED", "ACI request was aborted");
    const queuedIndex = this.queue.findIndex((entry) => entry.id === id);
    if (queuedIndex >= 0) {
      const [entry] = this.queue.splice(queuedIndex, 1);
      this.rejectEntry(entry, error);
      return;
    }
    const entry = this.pending.get(id);
    if (!entry) return;
    this.pending.delete(id);
    if (entry.op !== "runtime.handshake") this.active--;
    this.rejectEntry(entry, error);
    this.failProtocol(error);
  }

  private rejectQueuedEntry(id: string, error: Error): void {
    const index = this.queue.findIndex((entry) => entry.id === id);
    if (index < 0) return;
    const [entry] = this.queue.splice(index, 1);
    this.rejectEntry(entry, error);
  }

  private rejectEntry(entry: RequestEntry, error: Error): void {
    clearTimeout(entry.timer);
    entry.reject(error);
  }

  private failProtocol(error: Error): void {
    this.lastError = redactApprovalTokens(error.message);
    this.rejectAll(error);
    this.terminateNow();
  }

  private failStart(error: Error): void {
    this.lastError = redactApprovalTokens(error.message);
    this.state = "failed";
    this.rejectAll(error);
  }

  private handleProcessFailure(error: Error): void {
    if (this.intentionallyStopping) return;
    this.lastError = redactApprovalTokens(error.message);
  }

  private handleProcessClose(code: number | null, signal: NodeJS.Signals | null): void {
    const wasIntentional = this.intentionallyStopping || this.disposed;
    this.child = null;
    this.stdoutBuffer = Buffer.alloc(0);
    if (wasIntentional) {
      this.state = "stopped";
      return;
    }
    const error = new AciProcessExitedError(
      `VerseShell process exited (code=${code}, signal=${signal})`,
      code,
      signal,
    );
    this.lastError = redactApprovalTokens(error.message);
    this.rejectAll(error);
    this.scheduleRestart();
  }

  private rejectAll(error: Error): void {
    for (const entry of this.pending.values()) this.rejectEntry(entry, error);
    this.pending.clear();
    for (const entry of this.queue.splice(0)) this.rejectEntry(entry, error);
    this.active = 0;
  }

  private scheduleRestart(): void {
    if (this.disposed || this.intentionallyStopping) return;
    if (this.restartAttempts >= this.options.maxRestarts) {
      this.state = "failed";
      return;
    }
    const delayMs = Math.min(
      this.options.restartBaseDelayMs * 2 ** this.restartAttempts,
      this.options.restartMaxDelayMs,
    );
    this.restartAttempts++;
    this.state = "backoff";
    this.restartTimer = unrefTimer(
      setTimeout(() => {
        this.restartTimer = null;
        if (this.disposed) return;
        void this.ensureStarted().catch((error) => {
          this.lastError = redactApprovalTokens(String(error));
          this.scheduleRestart();
        });
      }, delayMs),
    );
  }

  private terminateNow(): void {
    const child = this.child;
    if (!child) return;
    this.intentionallyStopping = false;
    if (child.pid) {
      killProcessTree(child.pid, { graceMs: this.options.shutdownGraceMs });
    } else {
      child.kill("SIGKILL");
    }
  }

  async shutdown(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.intentionallyStopping = true;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
    this.rejectAll(new AciTransportError("E_ACI_SHUTDOWN", "ACI process is shutting down"));
    const child = this.child;
    if (!child) {
      this.state = "stopped";
      return;
    }
    const closed = new Promise<void>((resolve) => child.once("close", () => resolve()));
    try {
      child.stdin.write("SHUTDOWN\n", "utf8");
    } catch {
      // Continue to process-tree termination below.
    }
    await Promise.race([closed, delay(this.options.shutdownGraceMs)]);
    if (this.child) this.terminateNow();
    this.child = null;
    this.state = "stopped";
  }
}

function workspaceId(canonicalWorkspace: string): string {
  return `ws_sha256_${createHash("sha256").update(canonicalWorkspace).digest("hex")}`;
}

function asTransportError(error: unknown): Error {
  return error instanceof Error
    ? error
    : new AciTransportError("E_ACI_TRANSPORT", String(error));
}

export class VerseShellProcessManager {
  private readonly processes = new Map<string, ManagedAciProcess>();
  private readonly options: Required<VerseShellProcessManagerOptions>;
  private readonly idleTimer: NodeJS.Timeout;
  private shuttingDown = false;

  constructor(options: VerseShellProcessManagerOptions = {}) {
    const idleTtlMs = clampPositive(options.idleTtlMs, 5 * 60_000);
    this.options = {
      maxProcesses: clampPositive(options.maxProcesses, 8),
      idleTtlMs,
      idleSweepMs: clampPositive(options.idleSweepMs, Math.min(60_000, idleTtlMs)),
      maxRestarts: clampPositive(options.maxRestarts, 3),
      restartBaseDelayMs: clampPositive(options.restartBaseDelayMs, 250),
      restartMaxDelayMs: clampPositive(options.restartMaxDelayMs, 5_000),
      shutdownGraceMs: clampPositive(options.shutdownGraceMs, 1_000),
      resolveBinary: options.resolveBinary ?? resolveDefaultVerseShellBinary,
      spawnProcess: options.spawnProcess ?? defaultSpawn,
      now: options.now ?? Date.now,
    };
    this.idleTimer = unrefTimer(
      setInterval(() => void this.collectIdle(), this.options.idleSweepMs),
    );
  }

  async getClient(config: VerseShellProcessConfig): Promise<VerseShellAciClient> {
    if (this.shuttingDown) {
      throw new AciTransportError("E_ACI_SHUTDOWN", "ACI manager is shutting down");
    }
    const workspace = await canonicalWorkspace(config.workspace);
    const profile = resolveVerseShellPolicyProfile(config.policyProfile);
    const capabilities = canonicalCapabilityList(profile.capabilities);
    const policyProfile = validatePolicyProfile(profile.id);
    const policyProfileDigest = validatePolicyProfileDigest(profile.digest);
    const approvalToken = validateApprovalToken(config.approvalToken);
    const withoutKey: Omit<ImmutableProcessConfig, "key"> = {
      workspace,
      capabilities,
      policyProfile,
      policyProfileDigest,
      expectedPolicyMode: STRICT_POLICY_MODE,
      expectedBinaryVersion: config.expectedBinaryVersion.trim(),
      expectedProtocolVersion: config.expectedProtocolVersion.trim(),
      expectedCatalogDigest: validateCatalogDigest(config.expectedCatalogDigest),
      expectedCatalogCount: validateCatalogCount(config.expectedCatalogCount),
      agentId: config.agentId?.trim() || "openclaw",
      requestTimeoutMs: clampPositive(
        config.requestTimeoutMs,
        DEFAULT_REQUEST_TIMEOUT_MS,
        MAX_REQUEST_TIMEOUT_MS,
      ),
      handshakeTimeoutMs: clampPositive(config.handshakeTimeoutMs, DEFAULT_HANDSHAKE_TIMEOUT_MS),
      maxConcurrency: clampPositive(config.maxConcurrency, DEFAULT_MAX_CONCURRENCY),
      maxQueueSize: clampPositive(config.maxQueueSize, DEFAULT_MAX_QUEUE_SIZE),
      maxLineBytes: clampPositive(config.maxLineBytes, DEFAULT_MAX_LINE_BYTES),
      approvalToken,
    };
    if (
      !withoutKey.expectedBinaryVersion ||
      !withoutKey.expectedProtocolVersion ||
      !withoutKey.expectedCatalogDigest
    ) {
      throw new AciProtocolError(
        "Expected binary version, server protocol, catalog digest, and catalog count are required for VerseShell isolation",
      );
    }
    const key = processKey(withoutKey);
    const existing = this.processes.get(key);
    if (existing) return new VerseShellAciClient(existing);

    await this.collectIdle();
    if (this.processes.size >= this.options.maxProcesses) {
      throw new AciTransportError(
        "E_ACI_PROCESS_LIMIT",
        `VerseShell process limit (${this.options.maxProcesses}) reached`,
      );
    }
    const binary = await this.options.resolveBinary();
    if (!binary.verified) {
      throw new AciTransportError(
        "E_ACI_BINARY_UNVERIFIED",
        "Bundled VerseShell resolver returned an unverified binary",
      );
    }
    const immutable = Object.freeze({ ...withoutKey, key }) as ImmutableProcessConfig;
    const managed = new ManagedAciProcess(immutable, Object.freeze({ ...binary }), this.options);
    this.processes.set(key, managed);
    try {
      await managed.ensureStarted();
    } catch (error) {
      this.processes.delete(key);
      await managed.shutdown();
      throw error;
    }
    return new VerseShellAciClient(managed);
  }

  health(key?: string): VerseShellProcessHealth | VerseShellProcessHealth[] | undefined {
    if (key) return this.processes.get(key)?.health();
    return this.list();
  }

  list(): VerseShellProcessHealth[] {
    return Array.from(this.processes.values(), (managed) => managed.health()).sort((a, b) =>
      a.key.localeCompare(b.key),
    );
  }

  async collectIdle(): Promise<number> {
    const cutoff = this.options.now() - this.options.idleTtlMs;
    const expired = Array.from(this.processes.entries()).filter(
      ([, managed]) => managed.idle && managed.lastUsedAt <= cutoff,
    );
    await Promise.all(
      expired.map(async ([key, managed]) => {
        this.processes.delete(key);
        await managed.shutdown();
      }),
    );
    return expired.length;
  }

  async shutdownWorkspace(workspace: string): Promise<number> {
    const canonical = await canonicalWorkspace(workspace);
    const matching = Array.from(this.processes.entries()).filter(
      ([, managed]) => managed.workspace === canonical,
    );
    await Promise.all(
      matching.map(async ([key, managed]) => {
        this.processes.delete(key);
        await managed.shutdown();
      }),
    );
    return matching.length;
  }

  async shutdownProcess(key: string): Promise<boolean> {
    const managed = this.processes.get(key);
    if (!managed) return false;
    this.processes.delete(key);
    await managed.shutdown();
    return true;
  }

  async shutdownAll(): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    clearInterval(this.idleTimer);
    const processes = Array.from(this.processes.values());
    this.processes.clear();
    await Promise.allSettled(processes.map((managed) => managed.shutdown()));
  }
}
