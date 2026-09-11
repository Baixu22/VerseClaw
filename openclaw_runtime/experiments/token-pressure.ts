/**
 * C6-3: token-pressure truncate + emergency assemble by Block priority.
 * Priority: persona > task_state > working_memory > remaining.
 * Emergency preserves: persona + task_state + most recent turn.
 */
import type { ContextBlock } from "../src/context-engine/block.js";
import { codingObservability } from "../src/context-engine/coding-observability.js";
import { dcsObservability } from "../src/context-engine/dcs-observability.js";
import type { LifecycleBlock } from "../src/context-engine/block-lifecycle.js";
import { isArchived } from "../src/context-engine/block-lifecycle.js";

const PRIORITY: Record<string, number> = {
  persona: 100,
  task_state: 90,
  working_memory: 70,
  tool_registry: 50,
  knowledge: 40,
  experience: 40,
  environment: 30,
  notes: 20,
};

export type PressureMode = "normal" | "pressure" | "emergency";

function blockTimestampMs(block: LifecycleBlock): number {
  const created = block.created_at?.getTime();
  if (typeof created === "number" && Number.isFinite(created)) {
    return created;
  }
  const valid = block.valid_at?.getTime();
  return typeof valid === "number" && Number.isFinite(valid) ? valid : 0;
}

function isCoreEmergencyType(blockType: string): boolean {
  return blockType === "persona" || blockType === "task_state";
}

export function selectBlocksUnderTokenPressure(params: {
  blocks: readonly LifecycleBlock[];
  tokenBudget: number;
  mode?: PressureMode;
  estimateTokens?: (block: ContextBlock) => number;
  /** How many most-recent non-core turns to keep in emergency. Default 1. */
  recentTurnCount?: number;
}): LifecycleBlock[] {
  const mode =
    params.mode ??
    (params.tokenBudget < 2000 ? "emergency" : params.tokenBudget < 8000 ? "pressure" : "normal");
  codingObservability.recordCompactionLayer(`token_pressure_${mode}`);
  dcsObservability.recordContextLadderAction(`token_pressure_${mode}`);

  const estimate =
    params.estimateTokens ??
    ((b: ContextBlock) =>
      Math.ceil(((b.summary?.length ?? 0) + (b.full_content?.length ?? 0)) / 4));

  let candidates = params.blocks.filter((b) => !isArchived(b));

  if (mode === "emergency") {
    const core = candidates.filter((b) => isCoreEmergencyType(b.block_type));
    const recentCount = Math.max(0, params.recentTurnCount ?? 1);
    const recent = candidates
      .filter((b) => !isCoreEmergencyType(b.block_type))
      .sort((a, b) => blockTimestampMs(b) - blockTimestampMs(a))
      .slice(0, recentCount);
    candidates = [...core, ...recent];
  }

  const sorted = [...candidates].sort((a, b) => {
    const byPriority = (PRIORITY[b.block_type] ?? 0) - (PRIORITY[a.block_type] ?? 0);
    if (byPriority !== 0) return byPriority;
    return blockTimestampMs(b) - blockTimestampMs(a);
  });

  const kept: LifecycleBlock[] = [];
  let used = 0;
  for (const block of sorted) {
    const cost = estimate(block);
    const isCore = isCoreEmergencyType(block.block_type);
    if (used + cost > params.tokenBudget && kept.length > 0 && !(mode === "emergency" && isCore)) {
      continue;
    }
    kept.push(block);
    used += cost;
  }
  return kept;
}
