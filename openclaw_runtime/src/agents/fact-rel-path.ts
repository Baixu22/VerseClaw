/**
 * Resolve a tool path argument to a FactStore-relative path under workspaceRoot.
 */
import path from "node:path";
import { normalizeFactPath } from "../context-engine/factstore/ignore.js";

export function toFactRelPath(filePath: string, workspaceRoot: string): string | undefined {
  const trimmed = filePath.trim();
  if (!trimmed) {
    return undefined;
  }
  const root = path.resolve(workspaceRoot);
  const absolute = path.isAbsolute(trimmed) ? path.resolve(trimmed) : path.resolve(root, trimmed);
  const relative = path.relative(root, absolute);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    return undefined;
  }
  return normalizeFactPath(relative);
}