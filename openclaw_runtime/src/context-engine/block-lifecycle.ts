/**
 * C6-1: Block lifecycle archive state + queries.
 * archived blocks are not dropped; they remain queryable via includeArchived.
 */
import type { ContextBlock } from "./block.js";
import { codingObservability } from "./coding-observability.js";

export type BlockLifecycleState = "active" | "archived";

export type LifecycleBlock = ContextBlock & {
  lifecycle_state?: BlockLifecycleState;
  archived_at?: Date;
  heat?: number;
};

export function archiveBlock(block: LifecycleBlock, now = new Date()): LifecycleBlock {
  codingObservability.recordCompactionLayer("archive");
  return {
    ...block,
    lifecycle_state: "archived",
    archived_at: now,
  };
}

export function isArchived(block: LifecycleBlock): boolean {
  return block.lifecycle_state === "archived";
}

export function filterBlocksByLifecycle(
  blocks: readonly LifecycleBlock[],
  options?: { includeArchived?: boolean },
): LifecycleBlock[] {
  if (options?.includeArchived) {
    return [...blocks];
  }
  return blocks.filter((b) => !isArchived(b));
}

/** Compact: archive low-heat blocks instead of dropping them. */
export function archiveLowHeatBlocks(
  blocks: readonly LifecycleBlock[],
  options?: { heatThreshold?: number; now?: Date },
): LifecycleBlock[] {
  const threshold = options?.heatThreshold ?? 1;
  const now = options?.now ?? new Date();
  return blocks.map((block) => {
    const heat = block.heat ?? 0;
    if (!isArchived(block) && heat < threshold && block.block_type !== "persona" && block.block_type !== "task_state") {
      return archiveBlock(block, now);
    }
    return block;
  });
}
