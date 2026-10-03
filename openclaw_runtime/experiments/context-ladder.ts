/**
 * C6 orchestrator: archive low-heat then apply token-pressure selection.
 * Opt-in helper only - does not flip assembler production defaults.
 */
import {
  archiveLowHeatBlocks,
  filterBlocksByLifecycle,
  type LifecycleBlock,
} from "../src/context-engine/block-lifecycle.js";
import {
  selectBlocksUnderTokenPressure,
  type PressureMode,
} from "./token-pressure.js";

export type ContextLadderResult = {
  blocks: LifecycleBlock[];
  activeBlocks: LifecycleBlock[];
  archivedBlocks: LifecycleBlock[];
  mode: PressureMode;
};

export function applyContextLadder(params: {
  blocks: readonly LifecycleBlock[];
  tokenBudget: number;
  mode?: PressureMode;
  heatThreshold?: number;
  now?: Date;
}): ContextLadderResult {
  const mode =
    params.mode ??
    (params.tokenBudget < 2000 ? "emergency" : params.tokenBudget < 8000 ? "pressure" : "normal");
  const afterArchive = archiveLowHeatBlocks(params.blocks, {
    heatThreshold: params.heatThreshold,
    now: params.now,
  });
  const selected = selectBlocksUnderTokenPressure({
    blocks: afterArchive,
    tokenBudget: params.tokenBudget,
    mode,
  });
  const selectedIds = new Set(selected.map((b) => b.block_id));
  // Preserve archive markers on non-selected blocks rather than dropping identity.
  const blocks = afterArchive.map((b) => {
    if (selectedIds.has(b.block_id)) return b;
    if (b.block_type === "persona" || b.block_type === "task_state") return b;
    if (b.lifecycle_state === "archived") return b;
    return {
      ...b,
      lifecycle_state: "archived" as const,
      archived_at: params.now ?? new Date(),
      presence: {
        ...b.presence,
        lifecycle_state: "archived" as const,
        archived_at: (params.now ?? new Date()).toISOString(),
      },
    };
  });
  return {
    blocks,
    activeBlocks: filterBlocksByLifecycle(blocks),
    archivedBlocks: blocks.filter((b) => b.lifecycle_state === "archived"),
    mode,
  };
}
