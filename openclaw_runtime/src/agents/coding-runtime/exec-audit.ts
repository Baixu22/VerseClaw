/**
 * P3 UFTK: exec workspace side-effect audit.
 *
 * Captures bounded workspace file fingerprints before and after an exec,
 * diffs them into `CodingFileSideEffect` records, and writes a structured
 * `CodingExecEvent` (with command approval metadata) to the unified audit
 * sink. Raw command text is never persisted: only `commandRedacted` and a
 * sha256 `commandHash` are recorded.
 *
 * JSONL/SQLite audit storage remains Phase 4 work. The unified sink is
 * in-memory in P3 and fail-closed for forbidden command decisions.
 */
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  CODING_RUNTIME_EVENT_TYPES,
  CODING_RUNTIME_SCHEMA_VERSION,
  type CodingExecApproval,
  type CodingExecEvent,
  type CodingExecEventStatus,
  type CodingFileSideEffect,
} from "../../../../shared/coding-runtime/types.js";
import { assertCodingAuditEvent } from "../../../../shared/coding-runtime/schema.js";
import { redactSensitiveText } from "../../logging/redact.js";
import { getCodingAuditSink } from "./audit-sink.js";
import {
  evaluateCommandApprovalPolicy,
  type CodingCommandApprovalPolicy,
} from "./command-approval-policy.js";

export type WorkspaceFileFingerprint = {
  path: string;
  contentHash: string | null;
  mtimeMs: number;
  size: number;
};

export type WorkspaceSnapshot = {
  root: string;
  capturedAtMs: number;
  files: Map<string, WorkspaceFileFingerprint>;
  truncated: boolean;
};

export type CaptureWorkspaceSnapshotOptions = {
  /** Upper bound on how many files are fingerprinted per snapshot. */
  maxFiles?: number;
  /** Files larger than this use a null content hash but keep size + mtime. */
  maxFileBytes?: number;
  /** Directory names skipped during the workspace walk. */
  skipDirs?: string[];
};

export const DEFAULT_WORKSPACE_SNAPSHOT_MAX_FILES = 20_000;
export const DEFAULT_WORKSPACE_SNAPSHOT_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const DEFAULT_WORKSPACE_SNAPSHOT_SKIP_DIRS = [
  ".git",
  "node_modules",
  ".venv",
  "venv",
  "__pycache__",
  ".next",
  "coverage",
] as const;

function normalizeRelPath(root: string, absPath: string): string {
  return path.relative(root, absPath).split(path.sep).join("/");
}

function isFileErrorCode(value: unknown, code: string): boolean {
  return !!value && typeof value === "object" && (value as { code?: unknown }).code === code;
}

async function hashFileIfSmall(absPath: string, maxFileBytes: number): Promise<string | null> {
  const stat = await fs.stat(absPath);
  if (stat.size > maxFileBytes) return null;
  const bytes = await fs.readFile(absPath);
  return createHash("sha256").update(bytes).digest("hex");
}

async function walkWorkspace(
  root: string,
  options: CaptureWorkspaceSnapshotOptions,
): Promise<{ files: Map<string, WorkspaceFileFingerprint>; truncated: boolean }> {
  const files = new Map<string, WorkspaceFileFingerprint>();
  const maxFiles = options.maxFiles ?? DEFAULT_WORKSPACE_SNAPSHOT_MAX_FILES;
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_WORKSPACE_SNAPSHOT_MAX_FILE_BYTES;
  const skipDirs = new Set(options.skipDirs ?? DEFAULT_WORKSPACE_SNAPSHOT_SKIP_DIRS);
  let truncated = false;

  async function walk(dirAbs: string): Promise<void> {
    if (truncated) return;
    let entries;
    try {
      entries = await fs.readdir(dirAbs, { withFileTypes: true });
    } catch (caught) {
      if (isFileErrorCode(caught, "ENOENT")) return;
      throw caught;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (truncated) return;
      const absPath = path.join(dirAbs, entry.name);
      if (entry.isDirectory()) {
        if (skipDirs.has(entry.name)) continue;
        await walk(absPath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (files.size >= maxFiles) {
        truncated = true;
        return;
      }
      const stat = await fs.stat(absPath);
      files.set(normalizeRelPath(root, absPath), {
        path: normalizeRelPath(root, absPath),
        contentHash: await hashFileIfSmall(absPath, maxFileBytes),
        mtimeMs: stat.mtimeMs,
        size: stat.size,
      });
    }
  }

  await walk(root);
  return { files, truncated };
}

export async function captureWorkspaceSnapshot(
  workspaceRoot: string,
  options: CaptureWorkspaceSnapshotOptions = {},
): Promise<WorkspaceSnapshot> {
  const root = path.resolve(workspaceRoot);
  const result = await walkWorkspace(root, options);
  return {
    root,
    capturedAtMs: Date.now(),
    files: result.files,
    truncated: result.truncated,
  };
}

function fingerprintMatches(
  before: WorkspaceFileFingerprint | undefined,
  after: WorkspaceFileFingerprint | undefined,
): boolean {
  if (!before || !after) return false;
  if (before.contentHash !== null && after.contentHash !== null) {
    return before.contentHash === after.contentHash;
  }
  return before.mtimeMs === after.mtimeMs && before.size === after.size;
}

export function diffWorkspaceSnapshots(
  before: WorkspaceSnapshot,
  after: WorkspaceSnapshot,
): CodingFileSideEffect[] {
  const effects: CodingFileSideEffect[] = [];
  const keys = new Set([...before.files.keys(), ...after.files.keys()]);
  for (const relPath of [...keys].sort((a, b) => a.localeCompare(b))) {
    const beforeFile = before.files.get(relPath);
    const afterFile = after.files.get(relPath);
    if (!beforeFile && afterFile) {
      effects.push({
        path: relPath,
        status: "added",
        beforeHash: null,
        afterHash: afterFile.contentHash,
        beforeVersion: null,
        afterVersion: {
          path: relPath,
          contentHash: afterFile.contentHash ?? "",
          mtimeMs: afterFile.mtimeMs,
          size: afterFile.size,
        },
        bytesBefore: 0,
        bytesAfter: afterFile.size,
      });
      continue;
    }
    if (beforeFile && !afterFile) {
      effects.push({
        path: relPath,
        status: "deleted",
        beforeHash: beforeFile.contentHash,
        afterHash: null,
        beforeVersion: {
          path: relPath,
          contentHash: beforeFile.contentHash ?? "",
          mtimeMs: beforeFile.mtimeMs,
          size: beforeFile.size,
        },
        afterVersion: null,
        bytesBefore: beforeFile.size,
        bytesAfter: 0,
      });
      continue;
    }
    if (beforeFile && afterFile && !fingerprintMatches(beforeFile, afterFile)) {
      effects.push({
        path: relPath,
        status: "modified",
        beforeHash: beforeFile.contentHash,
        afterHash: afterFile.contentHash,
        beforeVersion: {
          path: relPath,
          contentHash: beforeFile.contentHash ?? "",
          mtimeMs: beforeFile.mtimeMs,
          size: beforeFile.size,
        },
        afterVersion: {
          path: relPath,
          contentHash: afterFile.contentHash ?? "",
          mtimeMs: afterFile.mtimeMs,
          size: afterFile.size,
        },
        bytesBefore: beforeFile.size,
        bytesAfter: afterFile.size,
      });
    }
  }
  return effects;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function commandDisplay(command: string): string {
  return redactSensitiveText(command, { mode: "tools" });
}

export type BuildCodingExecEventParams = {
  sessionId: string;
  requestId: string;
  workspaceRoot: string;
  command: string;
  cwd: string;
  status: CodingExecEventStatus;
  approval?: CodingExecApproval | null;
  exitCode: number | null;
  durationMs: number;
  timeoutMs?: number;
  outputTruncated: boolean;
  sideEffects: CodingFileSideEffect[];
  error?: string;
  beforeFingerprint?: string | null;
  afterFingerprint?: string | null;
};

export function buildCodingExecEvent(params: BuildCodingExecEventParams): CodingExecEvent {
  const event: CodingExecEvent = {
    schemaVersion: CODING_RUNTIME_SCHEMA_VERSION,
    eventId: `coding-exec:${params.requestId}:${randomUUID()}`,
    eventType: CODING_RUNTIME_EVENT_TYPES.EXEC,
    sessionId: params.sessionId,
    requestId: params.requestId,
    toolName: "exec",
    timestamp: Date.now(),
    path: params.cwd,
    beforeHash: params.beforeFingerprint ?? null,
    afterHash: params.afterFingerprint ?? null,
    workspaceRoot: params.workspaceRoot,
    commandId: sha256(`${params.requestId}:${params.command}`).slice(0, 24),
    commandHash: sha256(params.command),
    commandRedacted: commandDisplay(params.command),
    cwd: params.cwd,
    status: params.status,
    exitCode: params.exitCode,
    durationMs: params.durationMs,
    outputTruncated: params.outputTruncated,
    sideEffects: params.sideEffects,
    ...(params.timeoutMs !== undefined ? { timeoutMs: params.timeoutMs } : {}),
    ...(params.approval ? { approval: params.approval } : {}),
    ...(params.error ? { error: params.error } : {}),
  };
  assertCodingAuditEvent(event);
  return event;
}

export type ExecAuditorOptions = {
  workspaceRoot: string;
  sessionId: string;
  /** When false, no snapshot is captured and no exec event is written. */
  enabled?: boolean;
  /** When false, exec events are still written but carry no side-effect diff. */
  sideEffectsEnabled?: boolean;
  /** Optional bounded-snapshot overrides. */
  snapshot?: CaptureWorkspaceSnapshotOptions;
  /** Prefix approval policy. When disabled, `evaluateApproval` returns null. */
  commandApprovalEnabled?: boolean;
  commandApprovalPolicy?: CodingCommandApprovalPolicy;
};

export class ExecAuditor {
  readonly #workspaceRoot: string;
  readonly #sessionId: string;
  readonly #enabled: boolean;
  readonly #sideEffectsEnabled: boolean;
  readonly #snapshot: CaptureWorkspaceSnapshotOptions;
  readonly #commandApprovalEnabled: boolean;
  readonly #commandApprovalPolicy: CodingCommandApprovalPolicy;

  constructor(options: ExecAuditorOptions) {
    this.#workspaceRoot = path.resolve(options.workspaceRoot);
    this.#sessionId = options.sessionId.trim() || "default";
    this.#enabled = options.enabled ?? false;
    this.#sideEffectsEnabled = options.sideEffectsEnabled ?? this.#enabled;
    this.#snapshot = options.snapshot ?? {};
    this.#commandApprovalEnabled = options.commandApprovalEnabled ?? false;
    this.#commandApprovalPolicy = options.commandApprovalPolicy ?? { rules: [] };
  }

  get enabled(): boolean {
    return this.#enabled;
  }

  async captureBefore(): Promise<WorkspaceSnapshot | null> {
    if (!this.#enabled || !this.#sideEffectsEnabled) return null;
    return captureWorkspaceSnapshot(this.#workspaceRoot, this.#snapshot);
  }

  evaluateApproval(command: string): CodingExecApproval | null {
    if (!this.#commandApprovalEnabled) return null;
    return evaluateCommandApprovalPolicy(command, this.#commandApprovalPolicy);
  }

  async recordExecEvent(params: {
    before: WorkspaceSnapshot | null;
    command: string;
    requestId: string;
    startedAtMs: number;
    approval: CodingExecApproval | null;
    status: CodingExecEventStatus;
    exitCode: number | null;
    timeoutMs?: number;
    outputTruncated: boolean;
    error?: string;
    cwd?: string;
  }): Promise<CodingExecEvent> {
    if (!this.#enabled) {
      throw new Error("ExecAuditor is disabled; refusing to fabricate an exec event");
    }
    let afterSnapshot: WorkspaceSnapshot | null = null;
    let sideEffects: CodingFileSideEffect[] = [];
    if (params.before) {
      afterSnapshot = await captureWorkspaceSnapshot(this.#workspaceRoot, this.#snapshot);
      sideEffects = diffWorkspaceSnapshots(params.before, afterSnapshot);
    }
    const event = buildCodingExecEvent({
      sessionId: this.#sessionId,
      requestId: params.requestId,
      workspaceRoot: this.#workspaceRoot,
      command: params.command,
      cwd: params.cwd ?? this.#workspaceRoot,
      status: params.status,
      approval: params.approval,
      exitCode: params.exitCode,
      durationMs: Math.max(0, Date.now() - params.startedAtMs),
      timeoutMs: params.timeoutMs,
      outputTruncated: params.outputTruncated,
      sideEffects,
      error: params.error,
      beforeFingerprint: params.before ? "workspace-snapshot" : null,
      afterFingerprint: afterSnapshot ? "workspace-snapshot" : null,
    });
    await getCodingAuditSink().write(event);
    return event;
  }
}
