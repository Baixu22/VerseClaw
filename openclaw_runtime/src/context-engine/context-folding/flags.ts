/**
 * Context folding feature flag (default off).
 *
 * Mirrors the checkpointed-context-reset gate: with the flag off no tool is
 * registered, so the tool list, prompt bytes, compaction and subagent paths stay
 * byte-identical to the baseline. Rollback is disable-only.
 */
import {
  CONTEXT_FOLDING_ENV,
  CONTEXT_FOLDING_FLAG_PATH,
  describeContextFoldingStatus,
  resolveContextFoldingEnabled,
  type ContextFoldingFlagState,
  type ContextFoldingStatus,
} from "../../../../shared/types/context-folding.js";

export { CONTEXT_FOLDING_ENV, CONTEXT_FOLDING_FLAG_PATH };

export function resolveContextFoldingFlagState(
  cfg?: unknown,
  env: NodeJS.ProcessEnv = process.env,
): ContextFoldingFlagState {
  return resolveContextFoldingEnabled({ config: cfg, env });
}

/** Enabled only when explicitly switched on; nothing about it is a default. */
export function isContextFoldingEnabled(
  cfg?: unknown,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return resolveContextFoldingFlagState(cfg, env).enabled;
}

export function describeContextFoldingRuntimeStatus(
  cfg?: unknown,
  env: NodeJS.ProcessEnv = process.env,
): ContextFoldingStatus {
  return describeContextFoldingStatus({ config: cfg, env });
}
