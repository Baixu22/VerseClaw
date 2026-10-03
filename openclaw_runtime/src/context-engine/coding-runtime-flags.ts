/**
 * Runtime coding feature flags (C0-2 / C0-4 and later C2/C4-H/C5-H/C7 flags).
 *
 * Defaults match CODING-OPTIMIZATION-EDD section 0.3. Config path:
 *   runtime.coding.<flag>...
 *
 * TASK-P0-02: Fact view tool gating is NOT here. Single source of truth is
 * `isDcsContextViewToolsEnabled` (env OPENCLAW_DCS_CONTEXT_VIEW_TOOLS / Settings
 * control plane). The former `runtime.coding.factViews.enabled` gate was
 * removed from this flag table (TASK-P0-02) and `isCodingFactViewsEnabled`
 * is fail-closed (always returns false). The obsolete config leaf is rejected
 * by the strict schema; keep this no-op so accidental imports still fail
 * closed instead of reintroducing a true default.
 */
import type { OpenClawConfig } from "../config/types.openclaw.js";

export const DEFAULT_CODING_FEATURE_FLAGS = {
  "runtime.coding.parseOnTouch.enabled": true,
  "runtime.coding.staleWriteGuard.enabled": false,
  "runtime.coding.writeJournal.enabled": true,
  /** FP-P2-05: post-write execution. "auto" runs only when a runner is detected within budget. */
  "runtime.coding.autoVerify.enabled": "auto" as const,
  /** C4-H: inprocess until git backend ACCEPT evidence. */
  "runtime.coding.worktree.backend": "inprocess" as const,
  /** C5-H: memory until multi-process WAL ACCEPT evidence. */
  /** C5-1: symbol lease on write tools. Default off (shared path unperturbed). */
  "runtime.coding.symbolLease.enabled": false,
  "runtime.coding.symbolLease.mode": "memory" as const,
  /** C5-H: patch-flow remains recommend-only. */
  "runtime.coding.patchFlow.default": false,
  /** C7-H: experience shadow dual-write off until stable window. */
  "runtime.coding.sekb.experienceShadow": false,
  /** C7-1: routing memo JSONL dual-write shadow. Default false (no production injection). */
  "runtime.coding.routingMemo.shadow": false,
} as const;

export type CodingFeatureFlagName = keyof typeof DEFAULT_CODING_FEATURE_FLAGS;

export type WorktreeBackend = "inprocess" | "git";
export type SymbolLeaseMode = "memory" | "wal";

type CodingFlagLeaf = { enabled?: boolean; backend?: string; mode?: string; default?: boolean; shadow?: boolean };

export const DEFAULT_CODING_AUTO_VERIFY_TIMEOUT_SECONDS = 90;
export const MAX_CODING_AUTO_VERIFY_TIMEOUT_SECONDS = 90;

export type CodingAutoVerifyConfig = {
  /**
   * - true: always run detected tests after writes.
   * - false: never run.
   * - "auto": run only when a test runner is detected AND the estimated
   *   timeout fits the configured budget (default 90s). This is the new
   *   default: post-write verification becomes active where it is cheap and
   *   reliable, while stays off where no runner exists.
   */
  enabled: boolean | "auto";
  timeoutSeconds: number;
  command?: string;
};

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

/**
 * @deprecated TASK-P0-02: always `false`. Fact view tools are gated only by
 * `isDcsContextViewToolsEnabled` (env/Settings). The obsolete config leaf is
 * rejected by the strict schema. Kept as a named no-op so accidental imports
 * fail closed instead of reintroducing a true default.
 */
export function isCodingFactViewsEnabled(
  _cfg?: OpenClawConfig,
  _overrides?: { factViewsEnabled?: boolean },
): boolean {
  return false;
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

/**
 * Resolve bounded post-write test execution.
 *
 * The shipped default is `"auto"` (see `DEFAULT_CODING_FEATURE_FLAGS`): run one
 * bounded project test command when, and only when, a runner is detected. It is
 * neither "off" nor a bypass - the command still travels through the effective
 * exec tool's policy and approval pipeline, so an unallowlisted command waits
 * for approval exactly like a model-issued one. That is required, not a defect:
 * FP-P2-05 states the write path "must never spawn directly or construct a
 * second approval, sandbox, or timeout plane".
 */
export function resolveCodingAutoVerifyConfig(cfg?: OpenClawConfig): CodingAutoVerifyConfig {
  const leaf = asRecord(codingConfigFrom(cfg)?.autoVerify);
  const timeoutSeconds =
    typeof leaf?.timeoutSeconds === "number" &&
    Number.isInteger(leaf.timeoutSeconds) &&
    leaf.timeoutSeconds >= 1 &&
    leaf.timeoutSeconds <= MAX_CODING_AUTO_VERIFY_TIMEOUT_SECONDS
      ? leaf.timeoutSeconds
      : DEFAULT_CODING_AUTO_VERIFY_TIMEOUT_SECONDS;
  const command = typeof leaf?.command === "string" ? leaf.command.trim() : "";
  const enabledValue = leaf?.enabled === undefined
    ? DEFAULT_CODING_FEATURE_FLAGS["runtime.coding.autoVerify.enabled"]
    : leaf.enabled;
  return {
    enabled:
      enabledValue === "auto" || enabledValue === true || enabledValue === false
        ? enabledValue
        : DEFAULT_CODING_FEATURE_FLAGS["runtime.coding.autoVerify.enabled"],
    timeoutSeconds,
    ...(command ? { command } : {}),
  };
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


/** C5-1 symbol lease on write tools. Default false (shared path unperturbed). */
export function isCodingSymbolLeaseEnabled(
  cfg?: OpenClawConfig,
  overrides?: { symbolLeaseEnabled?: boolean },
): boolean {
  if (typeof overrides?.symbolLeaseEnabled === "boolean") {
    return overrides.symbolLeaseEnabled;
  }
  const leaf = asRecord(codingConfigFrom(cfg)?.symbolLease) as CodingFlagLeaf | undefined;
  if (typeof leaf?.enabled === "boolean") {
    return leaf.enabled;
  }
  return DEFAULT_CODING_FEATURE_FLAGS["runtime.coding.symbolLease.enabled"];
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

/** C7-1 routing memo JSONL dual-write shadow. Default false (no cutover / no prompt injection). */
export function isCodingRoutingMemoShadowEnabled(
  cfg?: OpenClawConfig,
  overrides?: { routingMemoShadow?: boolean },
): boolean {
  if (typeof overrides?.routingMemoShadow === "boolean") {
    return overrides.routingMemoShadow;
  }
  const leaf = asRecord(codingConfigFrom(cfg)?.routingMemo) as CodingFlagLeaf & {
    shadow?: boolean;
  } | undefined;
  if (typeof leaf?.shadow === "boolean") {
    return leaf.shadow;
  }
  if (typeof leaf?.enabled === "boolean") {
    return leaf.enabled;
  }
  return DEFAULT_CODING_FEATURE_FLAGS["runtime.coding.routingMemo.shadow"];
}
