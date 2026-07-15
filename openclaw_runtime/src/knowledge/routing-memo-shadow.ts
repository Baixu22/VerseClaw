/**
 * C7-1: routing memo JSONL dual-write shadow into BlockStore-shaped records (no cutover).
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { ContextBlock } from "../context-engine/block.js";

export type RoutingMemoEntry = {
  atMs: number;
  sessionId: string;
  query: string;
  chosenTool: string;
  success: boolean;
};

export function routingMemoPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".openclaw", "memory", "routing-memo.jsonl");
}

export function appendRoutingMemo(
  workspaceRoot: string,
  entry: RoutingMemoEntry,
): void {
  const file = routingMemoPath(workspaceRoot);
  mkdirSync(path.dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(entry)}\n`, "utf8");
}

/** Shadow dual-write: produce a notes block without requiring store cutover. */
export function routingMemoToShadowBlock(entry: RoutingMemoEntry): ContextBlock {
  return {
    block_id: `routing-memo-shadow:${entry.sessionId}:${entry.atMs}`,
    block_type: "notes",
    source_system: "agent-notes",
    session_id: entry.sessionId,
    presence: { always_on: false, background: true },
    entities: [entry.chosenTool],
    valid_at: new Date(entry.atMs),
    created_at: new Date(entry.atMs),
    mutability: "system_managed",
    summary: `route ${entry.query.slice(0, 80)} → ${entry.chosenTool}`,
    full_content: JSON.stringify(entry),
    compression_depth: 0,
    entity_extraction_status: "empty",
  };
}

export function readRoutingMemo(workspaceRoot: string): RoutingMemoEntry[] {
  const file = routingMemoPath(workspaceRoot);
  if (!existsSync(file)) return [];
  const out: RoutingMemoEntry[] = [];
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as RoutingMemoEntry);
    } catch {
      // skip
    }
  }
  return out;
}
