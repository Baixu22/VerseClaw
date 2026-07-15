/**
 * parse-on-touch wrapper (C0-2): after a successful read/search tool execute,
 * enqueue the touched file on the shared Materializer without parsing inline.
 * Also records session read hashes for C2-2 stale write guard.
 */
import path from "node:path";
import { codingObservability } from "../context-engine/coding-observability.js";
import type { Materializer } from "../context-engine/factstore/materialize.js";
import { getToolParamsRecord } from "./agent-tools.params.js";
import type { AnyAgentTool } from "./agent-tools.types.js";
import {
  hashFileOnDisk,
  recordSessionReadHash,
  resolveWorkspaceFile,
} from "./session-read-hashes.js";
import { toFactRelPath } from "./fact-rel-path.js";

export type ParseOnTouchOptions = {
  workspaceRoot: string;
  materializer?: Pick<Materializer, "onFileTouched">;
  enabled?: boolean;
  /** Param keys that may hold a file path (read uses "path"). */
  pathKeys?: string[];
  /** Session id for C2-2 last-read hash tracking. */
  sessionId?: string;
  /** When true (default), record content hash after successful read. */
  trackReadHashes?: boolean;
};

function extractPathFromArgs(args: unknown, pathKeys: string[]): string | undefined {
  const record = getToolParamsRecord(args);
  if (!record) {
    return undefined;
  }
  for (const key of pathKeys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return undefined;
}

/**
 * Wrap a tool so a successful execute enqueues onFileTouched for the path param.
 * Failures (thrown) never touch. Touch is enqueue-only (<5ms budget).
 */
export function wrapToolWithParseOnTouch(
  tool: AnyAgentTool,
  options: ParseOnTouchOptions,
): AnyAgentTool {
  if (!options.materializer || options.enabled === false) {
    // Still allow read-hash tracking without materializer when requested.
    if (options.trackReadHashes === false || !options.sessionId) {
      return tool;
    }
  }
  if (options.enabled === false && options.trackReadHashes === false) {
    return tool;
  }
  const materializer = options.materializer;
  const pathKeys = options.pathKeys ?? ["path"];
  const workspaceRoot = path.resolve(options.workspaceRoot);
  const trackHashes = options.trackReadHashes !== false;

  return {
    ...tool,
    execute: async (toolCallId, args, signal, onUpdate) => {
      const result = await tool.execute(toolCallId, args, signal, onUpdate);
      const filePath = extractPathFromArgs(args, pathKeys);
      if (!filePath) {
        return result;
      }
      const rel = toFactRelPath(filePath, workspaceRoot);
      if (!rel) {
        return result;
      }
      if (options.enabled !== false && materializer) {
        const started = performance.now();
        materializer.onFileTouched(rel);
        codingObservability.recordTouchLatency(performance.now() - started);
      }
      if (trackHashes && options.sessionId) {
        const abs = resolveWorkspaceFile(workspaceRoot, filePath);
        const hash = hashFileOnDisk(abs);
        if (hash) {
          recordSessionReadHash(options.sessionId, rel, hash);
        }
      }
      return result;
    },
  };
}
