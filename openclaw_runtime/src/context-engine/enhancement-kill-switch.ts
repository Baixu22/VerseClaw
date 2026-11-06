/**
 * One-shot kill switch for memory/context enhancement paths.
 *
 * When engaged, production turn wiring must fail-closed:
 * - VToken Working Context assembly
 * - chat-turn memory inject pilot (role-memory / runtime-memory)
 * - DCS context-block feature flags used by the Assembler
 * - CVK systemPromptAddition prepend in embedded attempt
 *
 * Failures while evaluating the switch must treat enhancement as disabled
 * (fail-closed) and must never throw into the agent turn.
 *
 * Engage via:
 * - env VERSE_CONTEXT_ENHANCEMENT_KILL_SWITCH=1|true|on|yes
 * - config runtime.contextEnhancement.killSwitch=true
 *
 * Default: not engaged (false). Individual features remain default-off / opt-in.
 */

import { isRecord } from "../runtime-core/types.js";

export const CONTEXT_ENHANCEMENT_KILL_SWITCH_ENV = "VERSE_CONTEXT_ENHANCEMENT_KILL_SWITCH";

function envTruthy(raw: string | undefined): boolean | null {
  if (raw == null || raw.trim() === "") return null;
  const v = raw.trim().toLowerCase();
  if (v === "1" || v === "true" || v === "yes" || v === "on") return true;
  if (v === "0" || v === "false" || v === "no" || v === "off") return false;
  return null;
}

function runtimeConfigFrom(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  if (isRecord(value.runtime)) return value.runtime;
  if (
    isRecord(value.vtoken) ||
    isRecord(value.memory) ||
    isRecord(value.contextBlock) ||
    isRecord(value.contextEnhancement)
  ) {
    return value;
  }
  return undefined;
}

/**
 * Returns true when the enhancement kill switch is engaged.
 * Never throws: malformed config/env is treated as not engaged for this check,
 * while callers still keep per-feature defaults fail-closed.
 */
export function isContextEnhancementKillSwitchEngaged(
  cfg?: unknown,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  try {
    const fromEnv = envTruthy(env[CONTEXT_ENHANCEMENT_KILL_SWITCH_ENV]);
    if (fromEnv === true) return true;

    const runtime = runtimeConfigFrom(cfg);
    const enhancement = isRecord(runtime?.contextEnhancement)
      ? runtime.contextEnhancement
      : undefined;
    if (enhancement?.killSwitch === true) return true;
    return false;
  } catch {
    // Fail-closed for enhancement: if we cannot evaluate, cut enhancements.
    return true;
  }
}

/**
 * Convenience: enhancement allowed only when kill switch is not engaged.
 */
export function isContextEnhancementAllowed(
  cfg?: unknown,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return !isContextEnhancementKillSwitchEngaged(cfg, env);
}
