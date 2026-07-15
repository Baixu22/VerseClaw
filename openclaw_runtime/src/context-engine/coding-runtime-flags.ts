/**
 * Runtime coding feature flags (C0-2 / C0-4 and later C2 flags).
 *
 * Defaults match CODING-OPTIMIZATION-EDD section 0.3. Config path:
 *   runtime.coding.<flag>.enabled
 */
import type { OpenClawConfig } from "../../config/types.openclaw.js";

export const DEFAULT_CODING_FEATURE_FLAGS = {
  "runtime.coding.factViews.enabled": true,
  "runtime.coding.parseOnTouch.enabled": true,
  "runtime.coding.staleWriteGuard.enabled": false,
  "runtime.coding.writeJournal.enabled": true,
} as const;

export type CodingFeatureFlagName = keyof typeof DEFAULT_CODING_FEATURE_FLAGS;

export type CodingFeatureFlags = Partial<Record<CodingFeatureFlagName, boolean>>;

type CodingFlagLeaf = { enabled?: boolean };

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function codingConfigFrom(cfg?: OpenClawConfig): Record<string, unknown> | undefined {
  const runtime = asRecord((cfg as { runtime?: unknown } | undefined)?.runtime);
  return asRecord(runtime?.coding);
}

function readCodingLeaf(
  coding: Record<string, unknown> | undefined,
  key: string,
): boolean | undefined {
  const leaf = asRecord(coding?.[key]) as CodingFlagLeaf | undefined;
  if (!leaf || typeof leaf.enabled !== "boolean") {
    return undefined;
  }
  return leaf.enabled;
}

/** FactStore view tools (context_impact/understand/reuse/verify). Default true. */
export function isCodingFactViewsEnabled(
  cfg?: OpenClawConfig,
  overrides?: { factViewsEnabled?: boolean },
): boolean {
  if (typeof overrides?.factViewsEnabled === "boolean") {
    return overrides.factViewsEnabled;
  }
  const fromConfig = readCodingLeaf(codingConfigFrom(cfg), "factViews");
  return fromConfig ?? DEFAULT_CODING_FEATURE_FLAGS["runtime.coding.factViews.enabled"];
}

/** parse-on-touch after successful read/grep. Default true. */
export function isCodingParseOnTouchEnabled(
  cfg?: OpenClawConfig,
  overrides?: { parseOnTouchEnabled?: boolean },
): boolean {
  if (typeof overrides?.parseOnTouchEnabled === "boolean") {
    return overrides.parseOnTouchEnabled;
  }
  const fromConfig = readCodingLeaf(codingConfigFrom(cfg), "parseOnTouch");
  return fromConfig ?? DEFAULT_CODING_FEATURE_FLAGS["runtime.coding.parseOnTouch.enabled"];
}

/** Block stale full-file writes (C2-2). Default false (shadow). */
export function isCodingStaleWriteGuardEnabled(
  cfg?: OpenClawConfig,
  overrides?: { staleWriteGuardEnabled?: boolean },
): boolean {
  if (typeof overrides?.staleWriteGuardEnabled === "boolean") {
    return overrides.staleWriteGuardEnabled;
  }
  const fromConfig = readCodingLeaf(codingConfigFrom(cfg), "staleWriteGuard");
  return fromConfig ?? DEFAULT_CODING_FEATURE_FLAGS["runtime.coding.staleWriteGuard.enabled"];
}

/** Snapshot pre-write content for undo_write (C2-8). Default true. */
export function isCodingWriteJournalEnabled(
  cfg?: OpenClawConfig,
  overrides?: { writeJournalEnabled?: boolean },
): boolean {
  if (typeof overrides?.writeJournalEnabled === "boolean") {
    return overrides.writeJournalEnabled;
  }
  const fromConfig = readCodingLeaf(codingConfigFrom(cfg), "writeJournal");
  return fromConfig ?? DEFAULT_CODING_FEATURE_FLAGS["runtime.coding.writeJournal.enabled"];
}
