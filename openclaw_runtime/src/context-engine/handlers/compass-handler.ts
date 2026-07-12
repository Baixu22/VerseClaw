import type { ContextBlock, ContextBlockSink } from "../block.js";
import type { PreReplyInjection } from "../../runtime-core/memory-pre-reply-injection.js";

/**
 * Format a knowledge Block for injection into the LLM context.
 *
 * Shared between compass (main) and role-memory (subagent) paths. Returns
 * `undefined` when the Block has no `full_content`, so the assembler skips
 * injection.
 */
export function formatKnowledgeInjection(
  block: ContextBlock | undefined,
): string | undefined {
  if (!block?.full_content) {
    return undefined;
  }
  const content = block.full_content.trim();
  if (!content) {
    return undefined;
  }
  return `## Knowledge\n${content}`;
}

/**
 * DCS Stage 4 knowledge Block handler (compass path, main session).
 *
 * Wraps `buildPreReplyInjection` output and converts it into a system-managed
 * `knowledge` Block with `source_system="compass"`. The legacy builder is NOT
 * modified — this handler is a parallel, flag-gated producer.
 *
 * Per DCS v1.6 spec:
 * - main session only (ANTI-3 enforced by Assembler selectHandlers)
 * - always_on=false, on_demand.expand_tool="context_search", background=true
 * - mutability="system_managed" (v1.6 convergence; v1.0 "readonly" reconciled)
 */

const COMPASS_KNOWLEDGE_TOKEN_BUDGET = 400;
const COMPASS_KNOWLEDGE_PRIORITY = 5;

export interface BuildCompassKnowledgeBlockParams {
  sessionId: string;
  injection: PreReplyInjection;
  now?: Date;
}

export function buildCompassKnowledgeBlock(
  params: BuildCompassKnowledgeBlockParams,
): ContextBlock {
  const now = params.now ?? new Date();
  const injection = params.injection;

  const parts: string[] = [];
  if (injection.sspString) {
    parts.push(injection.sspString);
  }
  if (injection.top5FactsString) {
    parts.push(injection.top5FactsString);
  }
  const fullContent = parts.length > 0 ? parts.join("\n\n") : undefined;

  return {
    block_id: `knowledge:compass:${params.sessionId}`,
    block_type: "knowledge",
    source_system: "compass",
    session_id: params.sessionId,
    presence: {
      always_on: false,
      token_budget: COMPASS_KNOWLEDGE_TOKEN_BUDGET,
      priority: COMPASS_KNOWLEDGE_PRIORITY,
      on_demand: { expand_tool: "context_search", auto_register: false },
      background: true,
    },
    entities: [],
    valid_at: now,
    created_at: now,
    mutability: "system_managed",
    summary: "## Knowledge\n→ context_search('compass') for full facts",
    full_content: fullContent,
    compression_depth: 0,
    entity_extraction_status: "empty",
  };
}

export interface HandleCompassKnowledgeParams {
  sessionId: string;
  injection: PreReplyInjection;
  contextBlockSink?: ContextBlockSink;
  now?: Date;
}

export async function handleCompassKnowledge(
  params: HandleCompassKnowledgeParams,
): Promise<{ accepted: boolean } | undefined> {
  if (!params.contextBlockSink) {
    return undefined;
  }
  const block = buildCompassKnowledgeBlock({
    sessionId: params.sessionId,
    injection: params.injection,
    now: params.now,
  });
  const [result] = await params.contextBlockSink([
    {
      block,
      admission: {
        significance: "high",
        write_origin: "handler",
        verification_status: "verified",
        confidence: 1.0,
        audn_state: "ACTIVE",
      },
    },
  ]);
  return result ? { accepted: result.accepted } : undefined;
}
