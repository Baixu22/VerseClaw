/**
 * Resolve a tool path argument to a FactStore-relative path under workspaceRoot.
 */
import path from "node:path";
import { normalizeFactPath } from "../context-engine/factstore/ignore.js";
import { resolveWorkspaceFile } from "./session-read-hashes.js";

export function toFactRelPath(filePath: string, workspaceRoot: string): string | undefined {
  const trimmed = filePath.trim();
  if (!trimmed) {
    return undefined;
  }
  return toResolvedFactRelPath(resolveWorkspaceFile(workspaceRoot, filePath), workspaceRoot);
}

/** Project an already resolved filesystem target without expanding its filename again. */
export function toResolvedFactRelPath(
  absolutePath: string,
  workspaceRoot: string,
): string | undefined {
  const relative = path.relative(path.resolve(workspaceRoot), path.resolve(absolutePath));
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    return undefined;
  }
  return normalizeFactPath(relative);
}
