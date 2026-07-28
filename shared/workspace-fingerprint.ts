/**
 * DCS workspace authority fingerprint (D3 closeout shared helper).
 *
 * Design authority: team/dcs decision "invalidate, no schema":
 * - fingerprint = sha256(normalized absolute root).slice(0, 16)
 * - normalization is case-insensitive and slash-insensitive so Windows path
 *   casing does not fork workspace identities.
 *
 * This pure helper is shared between:
 * - Main process (`electron/services/chat-api.ts`) — produces the trusted
 *   fingerprint from the workspace's normalized rootPath and forwards it to
 *   Gateway via `chat.send`.
 * - Runtime (`openclaw_runtime/src/context-engine/workspace-fingerprint.ts`)
 *   — re-exports this helper so embedded attempt binds the same authority
 *   fingerprint from `effectiveWorkspace`.
 *
 * In-memory session bind/invalidate state stays in the runtime module; this
 * shared file owns only the pure normalization+hash function.
 */
import { createHash } from "node:crypto";
import path from "node:path";

/**
 * Normalize a workspace root and return the authority fingerprint
 * (sha256 of lowercased absolute POSIX-style path, first 16 hex chars).
 *
 * Returns an empty string for empty/whitespace input so callers can branch
 * on the falsy result without try/catch.
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
