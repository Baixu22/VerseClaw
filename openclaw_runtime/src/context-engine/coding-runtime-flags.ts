/**
 * Runtime coding feature flags (C0-2 / C0-4 and later C2/C4-H/C5-H flags).
 *
 * Defaults match CODING-OPTIMIZATION-EDD section 0.3. Config path:
 *   runtime.coding.<flag>...
 */
import type { OpenClawConfig } from "../../config/types.openclaw.js";

export const DEFAULT_CODING_FEATURE_FLAGS = {
  "runtime.coding.factViews.enabled": true,
  "runtime.coding.parseOnTouch.enabled": true,
  "runtime.coding.staleWriteGuard.enabled": false,
  "runtime.coding.writeJournal.enabled": true,
  /** C4-H: inprocess until git backend ACCEPT evidence. */
  "runtime.coding.worktree.backend": "inprocess" as const,
  /** C5-H: memory until multi-process WAL ACCEPT evidence. */
  "runtime.coding.symbolLease.mode": "memory" as const,
  /** C5-H: patch-flow remains recommend-only. */
  "runtime.coding.patchFlow.default": false,
  /** C7-H: experience shadow dual-write off until stable window. */
  "runtime.coding.sekb.experienceShadow": false,
} as const;

export type CodingFeatureFlagName = keyof typeof DEFAULT_CODING_FEATURE_FLAGS;

export type WorktreeBackend = "inprocess" | "git";
export type SymbolLeaseMode = "memory" | "wal";

type CodingFlagLeaf = { enabled?: boolean; backend?: string; mode?: string; default?: boolean };

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function codingConfigFrom(cfg?: OpenClawConfig): Record<string, unknown> | undefined {
  return asRecord(cfg?.runtime?.coding);
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

/** C4-H worktree backend. Default inprocess (safe). */
export function resolveWorktreeBackend(
  cfg?: OpenClawConfig,
  overrides?: { backend?: WorktreeBackend },
): WorktreeBackend {
  if (overrides?.backend === "inprocess" || overrides?.backend === "git") {
    return overrides.backend;
  }
  const leaf = asRecord(codingConfigFrom(cfg)?.worktree) as CodingFlagLeaf | undefined;
  if (leaf?.backend === "git" || leaf?.backend === "inprocess") {
    return leaf.backend;
  }
  return DEFAULT_CODING_FEATURE_FLAGS["runtime.coding.worktree.backend"];
}

/** C5-H symbol lease mode. Default memory (safe). */
export function resolveSymbolLeaseMode(
  cfg?: OpenClawConfig,
  overrides?: { mode?: SymbolLeaseMode },
): SymbolLeaseMode {
  if (overrides?.mode === "memory" || overrides?.mode === "wal") {
    return overrides.mode;
  }
  const leaf = asRecord(codingConfigFrom(cfg)?.symbolLease) as CodingFlagLeaf | undefined;
  if (leaf?.mode === "wal" || leaf?.mode === "memory") {
    return leaf.mode;
  }
  return DEFAULT_CODING_FEATURE_FLAGS["runtime.coding.symbolLease.mode"];
}

/** C5-H patch-flow default orchestration path. Default false. */
export function isCodingPatchFlowDefault(
  cfg?: OpenClawConfig,
  overrides?: { patchFlowDefault?: boolean },
): boolean {
  if (typeof overrides?.patchFlowDefault === "boolean") {
    return overrides.patchFlowDefault;
  }
  const leaf = asRecord(codingConfigFrom(cfg)?.patchFlow) as CodingFlagLeaf | undefined;
  if (typeof leaf?.default === "boolean") {
    return leaf.default;
  }
  if (typeof leaf?.enabled === "boolean") {
    return leaf.enabled;
  }
  return DEFAULT_CODING_FEATURE_FLAGS["runtime.coding.patchFlow.default"];
}

/** C7-H SEKB experience shadow dual-write. Default false (no cutover). */
export function isCodingSekbExperienceShadowEnabled(
  cfg?: OpenClawConfig,
  overrides?: { experienceShadow?: boolean },
): boolean {
  if (typeof overrides?.experienceShadow === "boolean") {
    return overrides.experienceShadow;
  }
  const sekb = asRecord(codingConfigFrom(cfg)?.sekb) as CodingFlagLeaf & {
    experienceShadow?: boolean;
  } | undefined;
  if (typeof sekb?.experienceShadow === "boolean") {
    return sekb.experienceShadow;
  }
  if (typeof sekb?.enabled === "boolean") {
    return sekb.enabled;
  }
  return DEFAULT_CODING_FEATURE_FLAGS["runtime.coding.sekb.experienceShadow"];
}