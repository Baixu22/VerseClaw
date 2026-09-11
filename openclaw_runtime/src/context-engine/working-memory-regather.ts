/**
 * T-B6 (TF-0126): env gate for working-memory regather within an attempt.
 * **Default off.**
 *
 * With the gate on, the working_memory channel is re-queried on later model
 * calls of the same attempt (the tool loop may have written new Blocks since
 * the last call) and unchanged content is deduplicated by candidate dedupKey
 * (contentDigest) instead of a channel-level skip. With the gate off, the
 * legacy per-attempt exactly-once skip applies and behavior is byte-identical
 * to pre-T-B6 (AC-5).
 *
 * Deliberately env-only rather than a new config leaf: a config leaf would
 * have to be declared across `zod-schema.ts` / `types.openclaw.ts` /
 * `runtime-feature-leaves.ts` / the ops catalog to satisfy §R1 A4, and all
 * four are the other lane's exclusive files this round (same reasoning as
 * TF-0128's audit gate). Requirement-5 allows reusing existing gating.
 */
import { isContextEnhancementKillSwitchEngaged } from "./enhancement-kill-switch.js";

export const WORKING_MEMORY_REGATHER_ENV = "OPENCLAW_WORKING_MEMORY_REGATHER";

/**
 * Whether working_memory may be re-collected on later model calls of the same
 * attempt.
 *
 * Fail-closed in both directions: unset/unparseable env means off, and an
 * engaged enhancement kill switch (env form or config form) overrides an
 * explicit opt-in — requirement-5 demands the regather enablement move with
 * the kill switch. Callers in long-lived components must pass a per-call
 * resolved config (kill-switch-config-source.ts), never a construction-time
 * snapshot, so a config-form kill engaged mid-session takes effect.
 */
export function isWorkingMemoryRegatherEnabled(
  cfg?: unknown,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  try {
    if (isContextEnhancementKillSwitchEngaged(cfg, env)) return false;
    const raw = env[WORKING_MEMORY_REGATHER_ENV]?.trim().toLowerCase();
    return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
  } catch {
    // Never let a gate evaluation break a model call.
    return false;
  }
}
