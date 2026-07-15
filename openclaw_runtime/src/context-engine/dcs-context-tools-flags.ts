/**
 * C1-1 / C0-4: tool-level kill-switch for DCS FactStore view tools.
 *
 * Default is OFF/shadow — view tools stay out of the default catalog until
 * C1-2 A/B graduation flips the product default (user decision required).
 * Block tools (context_read/search/write) remain dep-gated only (W5 contract).
 *
 * Env (truthy: 1|on|true|yes):
 * - OPENCLAW_DCS_CONTEXT_VIEW_TOOLS — preferred
 * - OPENCLAW_DCS_CONTEXT_TOOLS — alias (seven-tool family switch; only gates views today)
 *
 * Schema on_demand:
 * - OPENCLAW_DCS_CONTEXT_TOOL_SCHEMA_MODE=summary|full (default summary for registry)
 */
import { isTruthyEnvValue } from "../infra/env.js";

export type ContextToolSchemaMode = "summary" | "full";

export function isDcsContextViewToolsEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    isTruthyEnvValue(env.OPENCLAW_DCS_CONTEXT_VIEW_TOOLS) ||
    isTruthyEnvValue(env.OPENCLAW_DCS_CONTEXT_TOOLS)
  );
}

/**
 * C1-1: tool_registry presentation mode for context_* tools.
 * Default "summary" — name + one-line purpose; full schema in full_content via expand.
 */
export function resolveContextToolSchemaMode(
  env: NodeJS.ProcessEnv = process.env,
): ContextToolSchemaMode {
  const raw = (env.OPENCLAW_DCS_CONTEXT_TOOL_SCHEMA_MODE ?? "summary").trim().toLowerCase();
  return raw === "full" ? "full" : "summary";
}
