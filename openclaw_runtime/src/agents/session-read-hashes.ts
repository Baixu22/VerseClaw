/**
 * Session-scoped last-read content hashes (C2-2 stale write guard).
 * Only files read in this session participate in stale blocking.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { resolveToCwd } from "./sessions/tools/path-utils.js";

/** sessionId -> relPath -> content hash */
const registry = new Map<string, Map<string, string>>();

export function hashFileContent(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

export function hashFileOnDisk(absolutePath: string): string | undefined {
  try {
    return hashFileContent(readFileSync(absolutePath));
  } catch {
    return undefined;
  }
}

export function recordSessionReadHash(
  sessionId: string | undefined,
  relPath: string,
  contentHash: string,
): void {
  const sid = sessionId?.trim();
  if (!sid || !relPath || !contentHash) {
    return;
  }
  let map = registry.get(sid);
  if (!map) {
    map = new Map();
    registry.set(sid, map);
  }
  map.set(normalizeRel(relPath), contentHash);
}

export function getSessionReadHash(
  sessionId: string | undefined,
  relPath: string,
): string | undefined {
  const sid = sessionId?.trim();
  if (!sid) {
    return undefined;
  }
  return registry.get(sid)?.get(normalizeRel(relPath));
}

export function clearSessionReadHashes(sessionId?: string): void {
  if (sessionId?.trim()) {
    registry.delete(sessionId.trim());
    return;
  }
  registry.clear();
}

export function __resetSessionReadHashes(): void {
  registry.clear();
}

function normalizeRel(relPath: string): string {
  return relPath.replace(/\\/g, "/").replace(/^\.\//, "");
}

/** Resolve the same input target as the native read/write tools for hashing. */
export function resolveWorkspaceFile(workspaceRoot: string, relOrAbs: string): string {
  return path.normalize(resolveToCwd(relOrAbs, workspaceRoot));
}
