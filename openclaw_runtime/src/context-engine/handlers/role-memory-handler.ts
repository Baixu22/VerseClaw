import type { ContextBlock, ContextBlockSink } from "../block.js";
import type { ContextPack } from "../../memory/types.js";

/**
 * DCS Stage 4 knowledge Block handler (role-memory path, subagent session).
 *
 * Wraps `buildContextPack` output and converts it into a system-managed
 * `knowledge` Block with `source_system="role-memory"`. The legacy builder is
 * NOT modified — this handler is a parallel, flag-gated producer.
 *
 * Per DCS v1.6 spec:
 * - subagent session only (ANTI-3 enforced by Assembler selectHandlers)
 * - always_on=false, on_demand.expand_tool="context_search", background=true
 * - mutability="system_managed"
 */

const ROLE_MEMORY_KNOWLEDGE_TOKEN_BUDGET = 400;
const ROLE_MEMORY_KNOWLEDGE_PRIORITY = 5;

export interface BuildRoleMemoryKnowledgeBlockParams {
  sessionId: string;
  pack: ContextPack;
  now?: Date;
}

export function buildRoleMemoryKnowledgeBlock(
  params: BuildRoleMemoryKnowledgeBlockParams,
): ContextBlock {
  const now = params.now ?? new Date();
  const pack = params.pack;

  const fullContent = JSON.stringify(pack.buckets);

  return {
    block_id: `knowledge:role-memory:${params.sessionId}`,
    block_type: "knowledge",
    source_system: "role-memory",
    session_id: params.sessionId,
    presence: {
      always_on: false,
      token_budget: ROLE_MEMORY_KNOWLEDGE_TOKEN_BUDGET,
      priority: ROLE_MEMORY_KNOWLEDGE_PRIORITY,
      on_demand: { expand_tool: "context_search", auto_register: false },
      background: true,
    },
    entities: [],
    valid_at: now,
    created_at: now,
    mutability: "system_managed",
    summary: "## Knowledge\n→ context_search('role-memory') for full pack",
    full_content: fullContent,
    compression_depth: 0,
    entity_extraction_status: "empty",
  };
}

export interface HandleRoleMemoryKnowledgeParams {
  sessionId: string;
  pack: ContextPack;
  contextBlockSink?: ContextBlockSink;
  now?: Date;
}

export async function handleRoleMemoryKnowledge(
  params: HandleRoleMemoryKnowledgeParams,
): Promise<{ accepted: boolean } | undefined> {
  if (!params.contextBlockSink) {
    return undefined;
  }
  const block = buildRoleMemoryKnowledgeBlock({
    sessionId: params.sessionId,
    pack: params.pack,
    now: params.now,
  });
  const [result] = await params.contextBlockSink([
    { block, admission: { significance: "medium", write_origin: "handler" } },
  ]);
  return result ? { accepted: result.accepted } : undefined;
}
