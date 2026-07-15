/**
 * C6-3: token-pressure truncate + emergency assemble by Block priority.
 * Priority: persona > task_state > working_memory > remaining.
 */
import type { ContextBlock } from "./block.js";
import { codingObservability } from "./coding-observability.js";
import type { LifecycleBlock } from "./block-lifecycle.js";
import { isArchived } from "./block-lifecycle.js";

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

export function selectBlocksUnderTokenPressure(params: {
  blocks: readonly LifecycleBlock[];
  tokenBudget: number;
  mode?: PressureMode;
  estimateTokens?: (block: ContextBlock) => number;
}): LifecycleBlock[] {
  const mode = params.mode ?? (params.tokenBudget < 2000 ? "emergency" : params.tokenBudget < 8000 ? "pressure" : "normal");
  codingObservability.recordCompactionLayer(`token_pressure_${mode}`);
  const estimate =
    params.estimateTokens ??
    ((b: ContextBlock) => Math.ceil(((b.summary?.length ?? 0) + (b.full_content?.length ?? 0)) / 4));

  let candidates = params.blocks.filter((b) => !isArchived(b));
  if (mode === "emergency") {
    candidates = candidates.filter(
      (b) => b.block_type === "persona" || b.block_type === "task_state",
    );
    // keep only last 2 working_memory if any slipped — emergency drops them
  }

  const sorted = [...candidates].sort(
    (a, b) => (PRIORITY[b.block_type] ?? 0) - (PRIORITY[a.block_type] ?? 0),
  );
  const kept: LifecycleBlock[] = [];
  let used = 0;
  for (const block of sorted) {
    const cost = estimate(block);
    if (used + cost > params.tokenBudget && kept.length > 0) {
      continue;
    }
    kept.push(block);
    used += cost;
  }
  return kept;
}
