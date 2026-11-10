---
title: dcs-turn-budget / openclaw_runtime/src/context-engine/injection-budget-config-source.ts
revision: 1
status: active
trust: confirmed
verifiedAt: "2026-11-09T22:32:47.090Z"
acl:
  read: [operator]
scope:
  workspaceId: rag-corpus-workspace
retention:
  policy: source-coupled
actor: codex/project-rag-corpus-author
driven_by: agent
---

# Repository source snapshot

Origin: openclaw_runtime/src/context-engine/injection-budget-config-source.ts
Commit: 1a4cc531ee050794b89dc8d7e49ac7c7a1c71ec0

~~~typescript
/**
 * FP-P2-04: mtime-keyed config source for the turn injection budget.
 *
 * `runtime.contextBlock.injectionBudget.{totalChars,dropAlertRatio}` lives in
 * `openclaw.json`, but the budget getters run on every turn and the runtime is
 * long-lived. Mirroring `kill-switch-config-source.ts`, the file is cached
 * against its mtime+size stamp so an operator write is picked up on the next
 * turn without a restart, and a missing/unreadable file resolves to
 * `undefined` — the budget then falls back to the FP-P0-05 defaults.
 *
 * Unlike the kill switch (which fails closed to a sentinel), budget overrides
 * fail open: a corrupt config must degrade to the documented defaults, never to
 * a zero or infinite budget.
 */
import fs from "node:fs";
import { resolveConfigPath } from "../config/paths.js";

export type InjectionBudgetConfigOverrides = {
  totalChars?: number;
  dropAlertRatio?: number;
  /**
   * B-1: per-channel decay half-life in turns. Channels absent here keep their
   * `TURN_INJECTION_CHANNEL_POLICY` default (Infinity ⇒ no decay).
   */
  channelDecay?: Partial<Record<string, number>>;
};

type CacheEntry = { stamp: string; overrides: InjectionBudgetConfigOverrides | undefined };

let cache: CacheEntry | undefined;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stampFor(configPath: string): string {
  const stat = fs.statSync(configPath);
  return `${stat.size}:${Math.trunc(stat.mtimeMs)}`;
}

/**
 * Extract the budget overrides from a parsed `openclaw.json`. Fields that fail
 * the zod-level invariants (positive integer total, ratio in [0,1]) are ignored
 * individually, so a bad `dropAlertRatio` never takes down a good `totalChars`.
 */
function readOverrides(value: unknown): InjectionBudgetConfigOverrides | undefined {
  if (!isObject(value)) return undefined;
  const runtime = isObject(value.runtime) ? value.runtime : undefined;
  const contextBlock = isObject(runtime?.contextBlock) ? runtime.contextBlock : undefined;
  const injectionBudget = isObject(contextBlock?.injectionBudget)
    ? contextBlock.injectionBudget
    : undefined;
  if (!injectionBudget) return undefined;
  const out: InjectionBudgetConfigOverrides = {};
  if (
    typeof injectionBudget.totalChars === "number" &&
    Number.isInteger(injectionBudget.totalChars) &&
    injectionBudget.totalChars >= 1
  ) {
    out.totalChars = injectionBudget.totalChars;
  }
  if (
    typeof injectionBudget.dropAlertRatio === "number" &&
    Number.isFinite(injectionBudget.dropAlertRatio) &&
    injectionBudget.dropAlertRatio >= 0 &&
    injectionBudget.dropAlertRatio <= 1
  ) {
    out.dropAlertRatio = injectionBudget.dropAlertRatio;
  }
  if (isObject(injectionBudget.channelDecay)) {
    const channelDecay: NonNullable<InjectionBudgetConfigOverrides["channelDecay"]> = {};
    for (const [channel, halfLife] of Object.entries(injectionBudget.channelDecay)) {
      // B-1: a finite positive half-life, or `null`/`"inf"` to restore the
      // no-decay default. Anything else for a channel is ignored.
      if (
        typeof halfLife === "number" &&
        Number.isFinite(halfLife) &&
        halfLife > 0
      ) {
        channelDecay[channel] = halfLife;
      }
    }
    if (Object.keys(channelDecay).length > 0) {
      out.channelDecay = channelDecay;
    }
  }
  return out.totalChars !== undefined || out.dropAlertRatio !== undefined || out.channelDecay !== undefined
    ? out
    : undefined;
}

/**
 * Resolve the budget overrides from the active config file.
 *
 * Returns `undefined` when there is no config file (nothing to override), when
 * the file cannot be parsed, or when neither field is present — each case falls
 * back to the FP-P0-05 defaults at the call site.
 */
export function resolveInjectionBudgetConfig(
  env: NodeJS.ProcessEnv = process.env,
): InjectionBudgetConfigOverrides | undefined {
  let configPath: string;
  try {
    configPath = resolveConfigPath(env);
  } catch {
    return undefined;
  }
  let stamp: string;
  try {
    stamp = stampFor(configPath);
  } catch {
    // Missing config file is a normal fresh install; nothing to override.
    return undefined;
  }
  if (cache?.stamp === stamp) {
    return cache.overrides;
  }
  let overrides: InjectionBudgetConfigOverrides | undefined;
  try {
    overrides = readOverrides(JSON.parse(fs.readFileSync(configPath, "utf-8")));
  } catch {
    overrides = undefined;
  }
  cache = { stamp, overrides };
  return overrides;
}

/** Test helper: drop the mtime-keyed cache. */
export function resetInjectionBudgetConfigCache(): void {
  cache = undefined;
}

~~~
