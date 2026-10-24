/**
 * C6 internal context ladder: archive low-heat Blocks, then apply token-pressure
 * selection. The ladder is an internal subordinate of DCS Block projection; it
 * has no user-facing on/off switch.
 */
import {
  archiveLowHeatBlocks,
  filterBlocksByLifecycle,
  type LifecycleBlock,
} from "./block-lifecycle.js";
import {
  selectBlocksUnderTokenPressure,
  type PressureMode,
} from "./token-pressure.js";

export type { PressureMode } from "./token-pressure.js";

/** Lower bound for the internal Block allowance. */
export const C6_INTERNAL_BLOCK_BUDGET_MIN_TOKENS = 2_000;
/** Upper bound for the internal Block allowance. */
export const C6_INTERNAL_BLOCK_BUDGET_MAX_TOKENS = 8_000;
/** Fraction of the model context window allocated to Block projection. */
export const C6_INTERNAL_BLOCK_BUDGET_RATIO = 0.25;
/** Internal policy: archive only Blocks selected out under real pressure. */
export const C6_INTERNAL_HEAT_THRESHOLD = 0;

export type ContextLadderPolicy = {
  enabled: true;
  tokenBudget: number;
  mode: PressureMode;
  heatThreshold: number;
};

export type ContextLadderResult = {
  blocks: LifecycleBlock[];
  activeBlocks: LifecycleBlock[];
  archivedBlocks: LifecycleBlock[];
  mode: PressureMode;
};

export function contextLadderModeForTokenBudget(tokenBudget: number): PressureMode {
  return tokenBudget < C6_INTERNAL_BLOCK_BUDGET_MIN_TOKENS
    ? "emergency"
    : tokenBudget < C6_INTERNAL_BLOCK_BUDGET_MAX_TOKENS
      ? "pressure"
      : "normal";
}

/**
 * Declared C6 production policy. DCS calls this whenever at least one Block
 * projection source is enabled. The model context window only sizes the Block
 * allowance; it is never a user preference.
 */
export function resolveInternalContextLadderPolicy(
  contextWindowTokens: number,
): ContextLadderPolicy | undefined {
  if (!Number.isFinite(contextWindowTokens) || contextWindowTokens <= 0) {
    return undefined;
  }
  const tokenBudget = Math.max(
    C6_INTERNAL_BLOCK_BUDGET_MIN_TOKENS,
    Math.min(
      C6_INTERNAL_BLOCK_BUDGET_MAX_TOKENS,
      Math.floor(contextWindowTokens * C6_INTERNAL_BLOCK_BUDGET_RATIO),
    ),
  );
  return {
    enabled: true,
    tokenBudget,
    mode: contextLadderModeForTokenBudget(tokenBudget),
    heatThreshold: C6_INTERNAL_HEAT_THRESHOLD,
  };
}

export function applyContextLadder(params: {
  blocks: readonly LifecycleBlock[];
  tokenBudget: number;
  mode?: PressureMode;
  heatThreshold?: number;
  now?: Date;
}): ContextLadderResult {
  const mode = params.mode ?? contextLadderModeForTokenBudget(params.tokenBudget);
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
