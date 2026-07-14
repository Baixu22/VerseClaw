/**
 * DCS workspace authority fingerprint + session-scope invalidate (D3 minimal slice).
 *
 * Design authority: team/dcs decision "invalidate, no schema":
 * - fingerprint = sha256(normalized absolute root).slice(0, 16)
 * - in-memory last fingerprint per sessionKey (not BlockStore / not openclaw.json)
 * - mismatch → invalidate working-memory:${sessionId} then continue
 * - missing fingerprint → no invalidation (agent-config fallback path)
 *
 * Full Chat→Main→Gateway trusted-root propagation is residual (see W6 COMPLETE).
 */
import { createHash } from "node:crypto";
import path from "node:path";
import { dcsObservability } from "./dcs-observability.js";

export type WorkspaceScopeBindAction =
  | "bound"
  | "unchanged"
  | "invalidated"
  | "skipped_no_fingerprint";

export type WorkspaceScopeBindResult = {
  action: WorkspaceScopeBindAction;
  previousFingerprint?: string;
  currentFingerprint?: string;
  workingMemoryBlockId?: string;
};

/** sessionKey → last trusted workspace fingerprint (process memory only). */
const lastFingerprintBySessionKey = new Map<string, string>();

/**
 * Normalize a workspace root and return the authority fingerprint
 * (sha256 of lowercased absolute POSIX-style path, first 16 hex chars).
 */
export function computeWorkspaceFingerprint(rootPath: string): string {
  const trimmed = rootPath.trim();
  if (!trimmed) {
    return "";
  }
  const absolute = path.resolve(trimmed);
  // Match projectIdForRoot casing policy: Windows path case must not fork identities.
  const normalized = absolute.replace(/\\/g, "/").toLowerCase();
  return createHash("sha256").update(normalized, "utf8").digest("hex").slice(0, 16);
}

export function workingMemoryBlockIdForSession(sessionId: string): string {
  return `working-memory:${sessionId}`;
}

export function getSessionWorkspaceFingerprint(sessionKey: string): string | undefined {
  const key = sessionKey.trim();
  if (!key) {
    return undefined;
  }
  return lastFingerprintBySessionKey.get(key);
}

/** Test helper: clear in-memory bindings. */
export function resetSessionWorkspaceFingerprints(): void {
  lastFingerprintBySessionKey.clear();
}

/**
 * Bind the session to a workspace fingerprint. On mismatch with the previous
 * fingerprint for the same sessionKey, invalidate the working-memory Block
 * (optionally through an S1-B-compatible enqueue) and count the event.
 */
export async function bindSessionWorkspaceFingerprint(params: {
  sessionKey: string;
  sessionId: string;
  fingerprint?: string | null;
  invalidate?: (blockId: string) => Promise<void>;
  /** When provided, invalidate runs through this serializer (S1-B queue head). */
  enqueue?: <T>(operation: () => Promise<T>) => Promise<T>;
}): Promise<WorkspaceScopeBindResult> {
  const sessionKey = params.sessionKey.trim();
  const sessionId = params.sessionId.trim();
  const fingerprint = params.fingerprint?.trim() ?? "";

  if (!sessionKey || !fingerprint) {
    return { action: "skipped_no_fingerprint" };
  }

  const previous = lastFingerprintBySessionKey.get(sessionKey);
  if (previous === fingerprint) {
    return {
      action: "unchanged",
      previousFingerprint: previous,
      currentFingerprint: fingerprint,
      workingMemoryBlockId: sessionId ? workingMemoryBlockIdForSession(sessionId) : undefined,
    };
  }

  const blockId = sessionId ? workingMemoryBlockIdForSession(sessionId) : undefined;
  const shouldInvalidate = Boolean(previous && previous !== fingerprint && blockId && params.invalidate);

  if (shouldInvalidate && blockId && params.invalidate) {
    const runInvalidate = async () => {
      await params.invalidate!(blockId);
    };
    if (params.enqueue) {
      await params.enqueue(runInvalidate);
    } else {
      await runInvalidate();
    }
    lastFingerprintBySessionKey.set(sessionKey, fingerprint);
    dcsObservability.recordWorkspaceScopeInvalidated(1);
    dcsObservability.recordWorkspaceScopeBound(1);
    return {
      action: "invalidated",
      previousFingerprint: previous,
      currentFingerprint: fingerprint,
      workingMemoryBlockId: blockId,
    };
  }

  lastFingerprintBySessionKey.set(sessionKey, fingerprint);
  dcsObservability.recordWorkspaceScopeBound(1);
  return {
    action: "bound",
    previousFingerprint: previous,
    currentFingerprint: fingerprint,
    workingMemoryBlockId: blockId,
  };
}
