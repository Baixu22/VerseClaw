import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const MAX_SOURCE_BYTES = 1_048_576;

export type VerseConfToolContext = {
  workspaceDir?: string;
  sessionKey?: string;
  sessionId?: string;
  agentId?: string;
};

export type VerseConfToolResult = {
  content: Array<{ type: "text"; text: string }>;
  details?: unknown;
};

export type VerseConfTool = {
  name: string;
  label: string;
  description: string;
  parameters: unknown;
  risk: "readonly" | "write";
  writeRiskProfile: { kind: "no_writes" | "dynamic_writes"; requiresApproval?: boolean };
  execute(toolCallId: string, raw: Record<string, unknown>, signal?: AbortSignal): Promise<VerseConfToolResult>;
};

export type VerseConfWriteContext = {
  workspaceRoot: string;
  sessionId: string;
  requestId: string;
  signal?: AbortSignal;
  flags?: Record<string, boolean | string>;
};

export type VerseConfWriteResult = {
  ok: true;
  operationId: string;
  path: string;
  beforeSha256: string | null;
  afterSha256: string;
  journalRef: string | null;
  batchState: "committed";
  changed: boolean;
} | {
  ok: false;
  code: "invalid_path" | "source_missing" | "source_drift" | "cancelled" | "write_failed" | "recovery_required";
  message: string;
  operationId: string;
  path?: string;
  beforeSha256?: string | null;
  afterSha256?: string | null;
  journalRef?: string | null;
  batchState?: "rolled_back" | "recovery_required";
};

export type VerseConfRuntime = {
  jsonResult(payload: unknown): VerseConfToolResult;
  readStringParam(params: Record<string, unknown>, key: string, options?: { required?: boolean; trim?: boolean; allowEmpty?: boolean }): string | undefined;
  readStructuredArtifactSource(workspaceRoot: string, relativePath: string): Promise<{ path: string; bytes: Buffer; sha256: string }>;
  commitStructuredArtifactCandidate(params: { context: VerseConfWriteContext; sourcePath: string; candidate: string; expectedBeforeSha256?: string | null; operationId?: string }): Promise<VerseConfWriteResult>;
  commitStructuredArtifactBytes(params: { context: VerseConfWriteContext; sourcePath: string; candidate: Uint8Array; expectedBeforeSha256?: string | null; operationId?: string }): Promise<VerseConfWriteResult>;
};

export function sha256Bytes(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function resolveWorkspacePath(workspaceRoot: string, relativePath: string): string {
  if (!relativePath || path.isAbsolute(relativePath)) throw new Error("artifact sourcePath must be a non-empty workspace-relative path");
  const root = path.resolve(workspaceRoot);
  const resolved = path.resolve(root, relativePath);
  const relative = path.relative(root, resolved);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error("artifact sourcePath escapes the active workspace");
  return resolved;
}

async function pathExists(filePath: string): Promise<boolean> {
  try { await access(filePath); return true; } catch { return false; }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const error = new Error("structured artifact write cancelled");
    error.name = "AbortError";
    throw error;
  }
}

async function localCommit(params: { context: VerseConfWriteContext; sourcePath: string; candidate: Uint8Array; expectedBeforeSha256?: string | null; operationId?: string }): Promise<VerseConfWriteResult> {
  const operationId = params.operationId?.trim() || randomUUID();
  let absolute: string;
  try { absolute = resolveWorkspacePath(params.context.workspaceRoot, params.sourcePath); }
  catch (error) { return { ok: false, code: "invalid_path", message: String(error), operationId }; }
  const displayPath = path.relative(params.context.workspaceRoot, absolute).replace(/\\/g, "/");
  const candidate = Buffer.from(params.candidate);
  if (candidate.byteLength > MAX_SOURCE_BYTES) return { ok: false, code: "write_failed", message: `candidate exceeds ${MAX_SOURCE_BYTES} bytes`, operationId, path: displayPath };
  let before: Buffer | null = null;
  try {
    throwIfAborted(params.context.signal);
    if (await pathExists(absolute)) {
      const file = await stat(absolute);
      if (!file.isFile()) return { ok: false, code: "source_missing", message: "artifact source is not a regular file", operationId, path: displayPath };
      before = await readFile(absolute);
      if (before.byteLength > MAX_SOURCE_BYTES) return { ok: false, code: "source_drift", message: `source exceeds ${MAX_SOURCE_BYTES} bytes`, operationId, path: displayPath };
    } else if (params.expectedBeforeSha256) {
      return { ok: false, code: "source_drift", message: "expected an existing source but it is missing", operationId, path: displayPath };
    }
    const beforeSha256 = before ? sha256Bytes(before) : null;
    if (params.expectedBeforeSha256 !== undefined && params.expectedBeforeSha256 !== beforeSha256) return { ok: false, code: "source_drift", message: "source changed since the candidate was prepared", operationId, path: displayPath, beforeSha256 };
    const afterSha256 = sha256Bytes(candidate);
    if (before && before.equals(candidate)) return { ok: true, operationId, path: displayPath, beforeSha256, afterSha256, journalRef: null, batchState: "committed", changed: false };
    throwIfAborted(params.context.signal);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, candidate);
    return { ok: true, operationId, path: displayPath, beforeSha256, afterSha256, journalRef: `local-write:${operationId}`, batchState: "committed", changed: true };
  } catch (error) {
    const cancelled = error instanceof Error && error.name === "AbortError";
    return { ok: false, code: cancelled ? "cancelled" : "write_failed", message: error instanceof Error ? error.message : String(error), operationId, path: displayPath, beforeSha256: before ? sha256Bytes(before) : null };
  }
}

function localReadStringParam(params: Record<string, unknown>, key: string, options: { required?: boolean; trim?: boolean; allowEmpty?: boolean } = {}): string | undefined {
  const raw = params[key];
  const value = typeof raw === "string" ? (options.trim === false ? raw : raw.trim()) : undefined;
  if (value && (options.allowEmpty || value.length > 0)) return value;
  if (options.required) throw new Error(`${key} required`);
  return options.allowEmpty && value === "" ? value : undefined;
}

export const localVerseConfRuntime: VerseConfRuntime = {
  jsonResult(payload) { return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }], details: payload }; },
  readStringParam: localReadStringParam,
  async readStructuredArtifactSource(workspaceRoot, relativePath) {
    const absolute = resolveWorkspacePath(workspaceRoot, relativePath);
    const bytes = await readFile(absolute);
    if (bytes.byteLength > MAX_SOURCE_BYTES) throw new Error(`structured artifact source exceeds ${MAX_SOURCE_BYTES} bytes`);
    return { path: absolute, bytes, sha256: sha256Bytes(bytes) };
  },
  commitStructuredArtifactCandidate(params) { return localCommit({ ...params, candidate: Buffer.from(params.candidate, "utf8") }); },
  commitStructuredArtifactBytes: localCommit,
};
