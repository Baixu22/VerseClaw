/**
 * C6-1: Block lifecycle archive state + queries.
 * archived blocks are not dropped; they remain queryable via includeArchived.
 */
import type { ContextBlock } from "./block.js";
import { codingObservability } from "./coding-observability.js";
import { dcsObservability } from "./dcs-observability.js";

export type BlockLifecycleState = "active" | "archived";

export type LifecycleBlock = ContextBlock & {
  lifecycle_state?: BlockLifecycleState;
  archived_at?: Date;
  heat?: number;
};

function presenceLifecycle(block: LifecycleBlock): BlockLifecycleState | undefined {
  const presence = block.presence as ContextBlock["presence"] & {
    lifecycle_state?: BlockLifecycleState;
  };
  return presence.lifecycle_state;
}

export function archiveBlock(block: LifecycleBlock, now = new Date()): LifecycleBlock {
  codingObservability.recordCompactionLayer("archive");
  dcsObservability.recordContextLadderAction("archive");
  const presence = {
    ...block.presence,
    lifecycle_state: "archived" as const,
    archived_at: now.toISOString(),
    ...(typeof block.heat === "number" ? { heat: block.heat } : {}),
  };
  return {
    ...block,
    lifecycle_state: "archived",
    archived_at: now,
    presence,
  };
}

export function isArchived(block: LifecycleBlock): boolean {
  return block.lifecycle_state === "archived" || presenceLifecycle(block) === "archived";
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
    const heat =
      block.heat ??
      (typeof (block.presence as { heat?: number }).heat === "number"
        ? (block.presence as { heat?: number }).heat!
        : 0);
    if (
      !isArchived(block) &&
      heat < threshold &&
      block.block_type !== "persona" &&
      block.block_type !== "task_state"
    ) {
      return archiveBlock({ ...block, heat }, now);
    }
    return block;
  });
}

/**
 * Promote presence-stored lifecycle overlays onto top-level LifecycleBlock fields
 * so archive filters work after BlockStore round-trip (presence_json).
 */
export function hydrateLifecycleBlock(block: ContextBlock): LifecycleBlock {
  const presence = block.presence as ContextBlock["presence"] & {
    lifecycle_state?: BlockLifecycleState;
    archived_at?: string;
    heat?: number;
  };
  const lifecycle_state = presence.lifecycle_state;
  const archived_at =
    typeof presence.archived_at === "string" ? new Date(presence.archived_at) : undefined;
  const heat = typeof presence.heat === "number" ? presence.heat : undefined;
  return {
    ...block,
    ...(lifecycle_state ? { lifecycle_state } : {}),
    ...(archived_at && Number.isFinite(archived_at.getTime()) ? { archived_at } : {}),
    ...(typeof heat === "number" ? { heat } : {}),
  };
}
