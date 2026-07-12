import { randomUUID } from "node:crypto";
import type {
  ContextBlock,
  ContextBlockSink,
} from "../block.js";

/**
 * DCS Stage 5: context_write tool
 *
 * Per DCS v1.6 spec §第六章:
 * - Only writes `notes` Block (sole `agent_writable` BlockType)
 * - Operations: `append` / `replace` / `clear`
 * - Role whitelist: `planner` / `architect` / `implementer`
 * - ANTI-7: role not in whitelist → reject
 * - `source_system="agent-notes"`, `mutability="agent_writable"`
 * - Admission: `write_origin="context_write"`
 */

export const CONTEXT_WRITE_ROLE_WHITELIST = [
  "planner",
  "architect",
  "implementer",
] as const;

const CONTEXT_WRITE_ROLE_SET: ReadonlySet<string> = new Set(
  CONTEXT_WRITE_ROLE_WHITELIST,
);

export type WriteOperation = "append" | "replace" | "clear";

export interface WriteContextParams {
  operation: WriteOperation;
  content: string;
  role: string;
  sessionId: string;
  contextBlockSink?: ContextBlockSink;
  existingBlock?: ContextBlock;
  now?: Date;
}

export interface WriteContextResult {
  accepted: boolean;
  reason?: string;
}

export async function writeContext(
  params: WriteContextParams,
): Promise<WriteContextResult> {
  // ANTI-7: role permission bypass via context is rejected
  if (!CONTEXT_WRITE_ROLE_SET.has(params.role)) {
    return {
      accepted: false,
      reason: `role '${params.role}' is not in context_write whitelist`,
    };
  }

  if (!params.contextBlockSink) {
    return { accepted: false, reason: "contextBlockSink not provided" };
  }

  const now = params.now ?? new Date();
  const existing = params.existingBlock;

  let content: string;
  switch (params.operation) {
    case "append":
      content = existing?.full_content
        ? `${existing.full_content}${params.content}`
        : params.content;
      break;
    case "replace":
      content = params.content;
      break;
    case "clear":
      content = "";
      break;
  }

  const blockId = existing?.block_id
    ?? `notes:agent-notes:${params.sessionId}:${randomUUID()}`;

  const block: ContextBlock = {
    block_id: blockId,
    block_type: "notes",
    source_system: "agent-notes",
    session_id: params.sessionId,
    presence: {
      always_on: false,
      on_demand: { expand_tool: "context_search", auto_register: false },
      background: false,
    },
    entities: [],
    valid_at: now,
    created_at: existing?.created_at ?? now,
    mutability: "agent_writable",
    summary: "## Notes",
    full_content: content,
    compression_depth: 0,
    entity_extraction_status: "empty",
  };

  const [result] = await params.contextBlockSink([
    {
      block,
      admission: { write_origin: "context_write" },
    },
  ]);

  return result
    ? { accepted: result.accepted, ...(result.reason ? { reason: result.reason } : {}) }
    : { accepted: false, reason: "sink returned no result" };
}
