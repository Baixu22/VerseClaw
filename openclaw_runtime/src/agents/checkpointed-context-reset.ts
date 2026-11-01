/**
 * Checkpoint-first context reset primitive (TF-0645 / A5).
 *
 * A plain reset throws the window away with no summary and no recoverable point.
 * This primitive inverts the order: write an archive of the current payload,
 * verify the archive by re-reading it and matching its digest, and only then let
 * a caller perform the reset. If any step fails the reset is refused with a
 * reason, so the worst outcome is "nothing happened", never "context gone".
 *
 * Default off: with the flag off the tool is not registered at all, so the tool
 * list and prompt stay byte-identical.
 */
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";

export const CONTEXT_ARCHIVE_SCHEMA = "ContextArchive/v1" as const;
export const CONTEXT_ARCHIVE_DIR = "context-archives";
export const CHECKPOINTED_CONTEXT_RESET_ENV = "VERSE_CHECKPOINTED_CONTEXT_RESET";
/** A payload larger than this is refused rather than silently truncated. */
export const CONTEXT_ARCHIVE_MAX_CHARS = 8 * 1024 * 1024;

export type ContextArchiveHandle = {
  schema: typeof CONTEXT_ARCHIVE_SCHEMA;
  archiveId: string;
  sessionKey?: string;
  sessionId?: string;
  chars: number;
  sha256: string;
  createdAt: string;
  path: string;
};

type ArchivedPayload = {
  schema: typeof CONTEXT_ARCHIVE_SCHEMA;
  archiveId: string;
  sessionKey?: string;
  sessionId?: string;
  chars: number;
  sha256: string;
  createdAt: string;
  payload: string;
};

export type CheckpointedResetRequest = {
  handle: ContextArchiveHandle;
  requestId: string;
  requestedAt: string;
};

export type CheckpointedResetOutcome =
  | { status: "reset"; handle: ContextArchiveHandle }
  | { status: "refused"; reason: string };

function digest(payload: string): string {
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

/** Enabled only when explicitly switched on; nothing about it is a default. */
export function isCheckpointedContextResetEnabled(
  cfg?: unknown,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = env[CHECKPOINTED_CONTEXT_RESET_ENV];
  if (raw != null && raw.trim() !== "") {
    const value = raw.trim().toLowerCase();
    if (value === "1" || value === "true" || value === "yes" || value === "on") return true;
    if (value === "0" || value === "false" || value === "no" || value === "off") return false;
    return false;
  }
  try {
    const record = cfg && typeof cfg === "object" ? (cfg as Record<string, unknown>) : undefined;
    const runtime = (record?.runtime as Record<string, unknown> | undefined) ?? record;
    const contextBlock = runtime?.contextBlock as Record<string, unknown> | undefined;
    const leaf = contextBlock?.checkpointedContextReset as { enabled?: unknown } | undefined;
    return leaf?.enabled === true;
  } catch {
    return false;
  }
}

/**
 * Write the archive and return its handle.
 *
 * Throws only for a real refusal (oversize or unwritable path), so the caller can
 * turn it into a tool-level `refused` result instead of a half-finished reset.
 */
export function createContextArchive(params: {
  payload: string;
  sessionKey?: string;
  sessionId?: string;
  stateDir?: string;
  now?: string;
}): ContextArchiveHandle {
  if (typeof params.payload !== "string" || params.payload.length === 0) {
    throw new Error("refused: empty transcript payload");
  }
  if (params.payload.length > CONTEXT_ARCHIVE_MAX_CHARS) {
    throw new Error(
      `refused: payload exceeds archive limit (${params.payload.length} > ${CONTEXT_ARCHIVE_MAX_CHARS})`,
    );
  }
  const stateDir = params.stateDir ?? resolveStateDir();
  const dir = path.join(stateDir, CONTEXT_ARCHIVE_DIR);
  mkdirSync(dir, { recursive: true });
  const archiveId = randomUUID();
  const createdAt = params.now ?? new Date().toISOString();
  const sha256 = digest(params.payload);
  const pathname = path.join(dir, `${archiveId}.json`);
  const archived: ArchivedPayload = {
    schema: CONTEXT_ARCHIVE_SCHEMA,
    archiveId,
    ...(params.sessionKey ? { sessionKey: params.sessionKey } : {}),
    ...(params.sessionId ? { sessionId: params.sessionId } : {}),
    chars: params.payload.length,
    sha256,
    createdAt,
    payload: params.payload,
  };
  writeFileSync(pathname, JSON.stringify(archived), { encoding: "utf8", mode: 0o600 });
  return {
    schema: CONTEXT_ARCHIVE_SCHEMA,
    archiveId,
    ...(params.sessionKey ? { sessionKey: params.sessionKey } : {}),
    ...(params.sessionId ? { sessionId: params.sessionId } : {}),
    chars: archived.chars,
    sha256,
    createdAt,
    path: pathname,
  };
}

/** Re-read and verify. A handle alone proves nothing; the bytes must match. */
export function verifyContextArchive(handle: ContextArchiveHandle): {
  ok: boolean;
  reason?: string;
  chars?: number;
} {
  try {
    if (handle?.schema !== CONTEXT_ARCHIVE_SCHEMA) return { ok: false, reason: "bad-schema" };
    if (!handle.path || !existsSync(handle.path)) return { ok: false, reason: "archive-missing" };
    const archived = JSON.parse(readFileSync(handle.path, "utf8")) as ArchivedPayload;
    if (archived.schema !== CONTEXT_ARCHIVE_SCHEMA) return { ok: false, reason: "bad-archive" };
    if (archived.archiveId !== handle.archiveId) return { ok: false, reason: "archive-id-mismatch" };
    if (archived.chars !== handle.chars) return { ok: false, reason: "chars-mismatch" };
    if (archived.sha256 !== handle.sha256) return { ok: false, reason: "handle-digest-mismatch" };
    if (digest(archived.payload) !== handle.sha256) {
      return { ok: false, reason: "payload-digest-mismatch" };
    }
    if (archived.payload.length !== handle.chars) return { ok: false, reason: "payload-chars-mismatch" };
    return { ok: true, chars: archived.chars };
  } catch {
    return { ok: false, reason: "archive-unreadable" };
  }
}

/**
 * Verify, then reset. Order matters: the reset callback cannot run unless the
 * archive on disk was just proven to match the handle.
 */
export async function performCheckpointedContextReset(params: {
  handle: ContextArchiveHandle;
  reset: () => Promise<boolean>;
}): Promise<CheckpointedResetOutcome> {
  const verified = verifyContextArchive(params.handle);
  if (!verified.ok) {
    return { status: "refused", reason: verified.reason ?? "archive-unverified" };
  }
  let resetOk: boolean;
  try {
    resetOk = await params.reset();
  } catch {
    return { status: "refused", reason: "reset-failed" };
  }
  if (!resetOk) return { status: "refused", reason: "reset-declined" };
  return { status: "reset", handle: params.handle };
}

/**
 * Pending requests for the current turn.
 *
 * Keyed by session id and taken at most once. A request that is never taken (no
 * reply loop to honour it) simply expires with the process and has no effect.
 */
const pendingBySession = new Map<string, CheckpointedResetRequest>();

export function requestCheckpointedReset(request: {
  handle: ContextArchiveHandle;
  sessionId?: string;
  requestId?: string;
  now?: string;
}): CheckpointedResetRequest {
  const key = request.sessionId || request.handle.sessionId || "current";
  const entry: CheckpointedResetRequest = {
    handle: request.handle,
    requestId: request.requestId ?? randomUUID(),
    requestedAt: request.now ?? new Date().toISOString(),
  };
  pendingBySession.set(key, entry);
  return entry;
}

export function takeCheckpointedReset(sessionId: string | undefined): CheckpointedResetRequest | undefined {
  const key = sessionId || "current";
  const entry = pendingBySession.get(key);
  if (!entry) return undefined;
  pendingBySession.delete(key);
  return entry;
}

export function peekCheckpointedReset(sessionId: string | undefined): CheckpointedResetRequest | undefined {
  return pendingBySession.get(sessionId || "current");
}

export function resetCheckpointedResetStateForTests(): void {
  pendingBySession.clear();
}