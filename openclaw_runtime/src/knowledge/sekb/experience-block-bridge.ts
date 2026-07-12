import type {
  ContextBlock,
  ContextBlockSink,
} from "../../context-engine/block.js";
import type { DistillationSuggestion, Principle } from "./types.js";

/**
 * DCS Stage 5: Bridge between SEKB distillation `confirm_and_save` and the
 * BlockStore `experience` Block.
 *
 * Per DCS v1.6 spec §阶段5 and §P3:
 * - Only `confirm_and_save` confirmed principles write `experience` Blocks
 * - ANTI-8: `suggest_principles_from_trajectories` advisory results MUST NOT
 *   write any Block
 * - `source_system="sekb"`, `mutability="system_managed"`, `compression_depth=0`
 * - `presence = { always_on: false, on_demand: { expand_tool: "context_search",
 *   auto_register: false }, background: true }`
 * - Admission: `confirmed=true`, `confidence=suggestion.confidence`,
 *   `write_origin="handler"`
 */

export interface BuildExperienceBlockParams {
  principle: Principle;
  suggestion: DistillationSuggestion;
  sessionId: string;
  now?: Date;
}

export function buildExperienceBlock(
  params: BuildExperienceBlockParams,
): ContextBlock {
  const now = params.now ?? new Date();
  const principle = params.principle;

  const entities = [
    ...principle.task_types,
    ...principle.context_tags,
  ];

  return {
    block_id: `experience:sekb:${params.sessionId}:${principle.principle_id}`,
    block_type: "experience",
    source_system: "sekb",
    session_id: params.sessionId,
    presence: {
      always_on: false,
      on_demand: { expand_tool: "context_search", auto_register: false },
      background: true,
    },
    entities,
    valid_at: now,
    created_at: now,
    mutability: "system_managed",
    summary: `## Experience\n${principle.title}`,
    full_content: principle.full_content,
    compression_depth: 0,
    entity_extraction_status: "empty",
  };
}

export interface HandleConfirmAndSaveParams {
  principle: Principle;
  suggestion: DistillationSuggestion;
  sessionId: string;
  contextBlockSink?: ContextBlockSink;
  now?: Date;
}

export async function handleConfirmAndSave(
  params: HandleConfirmAndSaveParams,
): Promise<{ accepted: boolean } | undefined> {
  if (!params.contextBlockSink) {
    return undefined;
  }
  const block = buildExperienceBlock({
    principle: params.principle,
    suggestion: params.suggestion,
    sessionId: params.sessionId,
    now: params.now,
  });
  const [result] = await params.contextBlockSink([
    {
      block,
      admission: {
        confirmed: true,
        confidence: params.suggestion.confidence,
        write_origin: "handler",
      },
    },
  ]);
  return result ? { accepted: result.accepted } : undefined;
}
