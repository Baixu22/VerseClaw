import type { BlockStoreApi, BlockType, ContextBlock } from "../block.js";
import {
  filterBlocksByLifecycle,
  hydrateLifecycleBlock,
  type LifecycleBlock,
} from "../block-lifecycle.js";

/**
 * DCS Stage 5: context_read tool library
 *
 * Expands on_demand Blocks by named block_type for the caller's session
 * (or an authorized direct-parent session via BlockStore rules).
 * Optional category filters tool_registry full_content entries.
 */

export const CONTEXT_READ_BLOCK_TYPES = [
  "persona",
  "task_state",
  "working_memory",
  "tool_registry",
  "knowledge",
  "experience",
  "environment",
  "notes",
] as const satisfies readonly BlockType[];

export type ContextReadBlockType = (typeof CONTEXT_READ_BLOCK_TYPES)[number];

export interface ReadContextParams {
  block_type: BlockType;
  category?: string;
  sessionId: string;
  /** Optional target session; defaults to sessionId. Parent reads go through BlockStore auth. */
  targetSessionId?: string;
  blockStore: Pick<BlockStoreApi, "query">;
  limit?: number;
  /** When true, include archived lifecycle blocks (C6-1). Default false. */
  includeArchived?: boolean;
}

export interface ReadContextResult {
  ok: boolean;
  block_type: BlockType;
  count: number;
  contents: string[];
  reason?: string;
}

function isBlockType(value: string): value is BlockType {
  return (CONTEXT_READ_BLOCK_TYPES as readonly string[]).includes(value);
}

/**
 * Filter tool_registry full_content JSON by entry category (case-insensitive).
 * Non-JSON or non-registry payloads are returned unchanged.
 */
export function filterToolRegistryContentByCategory(
  fullContent: string | undefined,
  category: string | undefined,
): string {
  const content = fullContent ?? "";
  const needle = category?.trim();
  if (!needle) {
    return content;
  }
  try {
    const parsed = JSON.parse(content) as { entries?: unknown };
    if (!Array.isArray(parsed.entries)) {
      return content;
    }
    const lowered = needle.toLowerCase();
    const filtered = parsed.entries.filter((entry) => {
      if (!entry || typeof entry !== "object") {
        return false;
      }
      const record = entry as Record<string, unknown>;
      const cat = typeof record.category === "string" ? record.category : "";
      const kind = typeof record.kind === "string" ? record.kind : "";
      const title = typeof record.title === "string" ? record.title : "";
      return (
        cat.toLowerCase() === lowered ||
        kind.toLowerCase() === lowered ||
        title.toLowerCase().includes(lowered)
      );
    });
    return JSON.stringify({ entries: filtered, category: needle });
  } catch {
    return content;
  }
}

export async function readContext(params: ReadContextParams): Promise<ReadContextResult> {
  if (!isBlockType(params.block_type)) {
    return {
      ok: false,
      block_type: params.block_type,
      count: 0,
      contents: [],
      reason: `unsupported block_type '${String(params.block_type)}'`,
    };
  }

  const requester = params.sessionId.trim();
  if (!requester) {
    return {
      ok: false,
      block_type: params.block_type,
      count: 0,
      contents: [],
      reason: "sessionId required",
    };
  }

  const target = params.targetSessionId?.trim() || requester;
  const limit =
    typeof params.limit === "number" && Number.isFinite(params.limit)
      ? Math.max(1, Math.floor(params.limit))
      : 10;

  // Authorization is enforced inside BlockStore.query (session + direct-parent rules).
  const blocks: ContextBlock[] = await params.blockStore.query({
    requester_session_id: requester,
    session_id: target,
    block_types: [params.block_type],
    limit,
  });

  const lifecycleBlocks: LifecycleBlock[] = blocks.map((block) => hydrateLifecycleBlock(block));
  const visible = filterBlocksByLifecycle(lifecycleBlocks, {
    includeArchived: params.includeArchived === true,
  });

  const contents = visible.map((block) => {
    if (params.block_type === "tool_registry" && params.category?.trim()) {
      return filterToolRegistryContentByCategory(block.full_content, params.category);
    }
    return block.full_content ?? "";
  });

  return {
    ok: true,
    block_type: params.block_type,
    count: contents.length,
    contents,
  };
}
