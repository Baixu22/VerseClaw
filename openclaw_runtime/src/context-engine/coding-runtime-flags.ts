/**
 * Runtime coding feature flags (C0-2 / C0-4 and later C2/C4-H/C5-H/C7 flags).
 *
 * Defaults match CODING-OPTIMIZATION-EDD section 0.3. Config path:
 *   runtime.coding.<flag>...
 *
 * TASK-P0-02: Fact view tool gating is NOT here. Single source of truth is
 * `isDcsContextViewToolsEnabled` (env OPENCLAW_DCS_CONTEXT_VIEW_TOOLS / Settings
 * control plane). The former `runtime.coding.factViews.enabled` default-true
 * leaf was a dead config with zero production callers and has been removed.
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
  /** P1 UFTK: unified file transaction path. Default false until P1 acceptance. */
  "runtime.coding.uftk.enabled": false,
  /** P2 UFTK: optimistic baseVersion guard. Default false; not model-visible. */
  "runtime.coding.uftk.baseVersionGuard.enabled": false,
  /** P3 UFTK: exec workspace side-effect fingerprinting. Default false. */
  "runtime.coding.uftk.execSideEffects.enabled": false,
  /** P3 UFTK: command prefix approval policy. Default false. */
  "runtime.coding.uftk.commandApproval.enabled": false,
  /** P4 UFTK: durable coding audit log (JSONL + SQLite). Default false. */
  "runtime.coding.uftk.auditLog.enabled": false,
  /** P5 UFTK: git-backed checkpoint. Default false. */
  "runtime.coding.uftk.gitCheckpoint.enabled": false,
  /** P6A UFTK: unified lock scheduler + cross-process shared reads + restore barrier + commit CAS + lock observability. Default false. */
  "runtime.coding.uftk.concurrencyV2.enabled": false,
  /** P6B UFTK: path-scoped checkpoint create/restore. Default false. */
  "runtime.coding.uftk.gitCheckpoint.pathScoped.enabled": false,
  /** P6B UFTK: mandatory safety snapshot before restore. Default false. */
  "runtime.coding.uftk.gitCheckpoint.safetySnapshot.enabled": false,
  /** P6B UFTK: checkpoint label / diff / exportPatch / retention / prune. Default false. */
  "runtime.coding.uftk.gitCheckpoint.lifecycle.enabled": false,
  /** P7 UFTK: exec workspace file side-effect undo via path-scoped restore. Default false. */
  "runtime.coding.uftk.execUndo.enabled": false,
  /** P7 UFTK: turn / long-task automatic checkpoint. Default false. */
  "runtime.coding.uftk.autoCheckpoint.enabled": false,
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
 * `isDcsContextViewToolsEnabled` (env/Settings). Kept as a named no-op so
 * accidental imports fail closed instead of reintroducing a true default.
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

/** Resolve bounded post-write test execution. Default off. */
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

/** P1 UFTK unified file transaction path. Default false; never resolved from env. */
export function isCodingUftkEnabled(
  cfg?: OpenClawConfig,
  overrides?: { uftkEnabled?: boolean },
): boolean {
  if (typeof overrides?.uftkEnabled === "boolean") {
    return overrides.uftkEnabled;
  }
  const fromConfig = readCodingLeaf(codingConfigFrom(cfg), "uftk");
  return fromConfig ?? DEFAULT_CODING_FEATURE_FLAGS["runtime.coding.uftk.enabled"];
}

/**
 * P2 optimistic baseVersion guard. Default false. `baseVersion` remains an
 * internal caller parameter; this flag controls the production tool wiring and
 * must stay false until the Phase 2 acceptance gate is complete.
 */
export function isCodingBaseVersionGuardEnabled(
  cfg?: OpenClawConfig,
  overrides?: { baseVersionGuardEnabled?: boolean },
): boolean {
  if (typeof overrides?.baseVersionGuardEnabled === "boolean") {
    return overrides.baseVersionGuardEnabled;
  }
  const uftk = asRecord(codingConfigFrom(cfg)?.uftk);
  const guard = asRecord(uftk?.baseVersionGuard);
  if (typeof guard?.enabled === "boolean") {
    return guard.enabled;
  }
  return DEFAULT_CODING_FEATURE_FLAGS["runtime.coding.uftk.baseVersionGuard.enabled"];
}

/** P3 UFTK exec workspace side-effect fingerprinting. Default false. */
export function isCodingExecSideEffectsEnabled(
  cfg?: OpenClawConfig,
  overrides?: { execSideEffectsEnabled?: boolean },
): boolean {
  if (typeof overrides?.execSideEffectsEnabled === "boolean") {
    return overrides.execSideEffectsEnabled;
  }
  const uftk = asRecord(codingConfigFrom(cfg)?.uftk);
  const leaf = asRecord(uftk?.execSideEffects);
  if (typeof leaf?.enabled === "boolean") {
    return leaf.enabled;
  }
  return DEFAULT_CODING_FEATURE_FLAGS["runtime.coding.uftk.execSideEffects.enabled"];
}

/** P3 UFTK command prefix approval policy. Default false. */
export function isCodingCommandApprovalEnabled(
  cfg?: OpenClawConfig,
  overrides?: { commandApprovalEnabled?: boolean },
): boolean {
  if (typeof overrides?.commandApprovalEnabled === "boolean") {
    return overrides.commandApprovalEnabled;
  }
  const uftk = asRecord(codingConfigFrom(cfg)?.uftk);
  const leaf = asRecord(uftk?.commandApproval);
  if (typeof leaf?.enabled === "boolean") {
    return leaf.enabled;
  }
  return DEFAULT_CODING_FEATURE_FLAGS["runtime.coding.uftk.commandApproval.enabled"];
}

/** P4 UFTK durable coding audit log (JSONL + SQLite). Default false. */
export function isCodingAuditLogEnabled(
  cfg?: OpenClawConfig,
  overrides?: { auditLogEnabled?: boolean },
): boolean {
  if (typeof overrides?.auditLogEnabled === "boolean") {
    return overrides.auditLogEnabled;
  }
  const uftk = asRecord(codingConfigFrom(cfg)?.uftk);
  const leaf = asRecord(uftk?.auditLog);
  if (typeof leaf?.enabled === "boolean") {
    return leaf.enabled;
  }
  return DEFAULT_CODING_FEATURE_FLAGS["runtime.coding.uftk.auditLog.enabled"];
}

/** P5 UFTK git-backed checkpoint. Default false; not wired to any model tool. */
export function isCodingGitCheckpointEnabled(
  cfg?: OpenClawConfig,
  overrides?: { gitCheckpointEnabled?: boolean },
): boolean {
  if (typeof overrides?.gitCheckpointEnabled === "boolean") {
    return overrides.gitCheckpointEnabled;
  }
  const uftk = asRecord(codingConfigFrom(cfg)?.uftk);
  const leaf = asRecord(uftk?.gitCheckpoint);
  if (typeof leaf?.enabled === "boolean") {
    return leaf.enabled;
  }
  return DEFAULT_CODING_FEATURE_FLAGS["runtime.coding.uftk.gitCheckpoint.enabled"];
}

/**
 * P6A UFTK concurrencyV2: unified lock scheduler + cross-process shared reads
 * + restore barrier + commit CAS + lock observability. Default false; must stay
 * false until the Phase 6A acceptance gate is complete.
 */
export function isCodingConcurrencyV2Enabled(
  cfg?: OpenClawConfig,
  overrides?: { concurrencyV2Enabled?: boolean },
): boolean {
  if (typeof overrides?.concurrencyV2Enabled === "boolean") {
    return overrides.concurrencyV2Enabled;
  }
  const uftk = asRecord(codingConfigFrom(cfg)?.uftk);
  const leaf = asRecord(uftk?.concurrencyV2);
  if (typeof leaf?.enabled === "boolean") {
    return leaf.enabled;
  }
  return DEFAULT_CODING_FEATURE_FLAGS["runtime.coding.uftk.concurrencyV2.enabled"];
}

function readGitCheckpointSubLeaf(
  cfg: OpenClawConfig | undefined,
  key: "pathScoped" | "safetySnapshot" | "lifecycle",
): boolean | undefined {
  const uftk = asRecord(codingConfigFrom(cfg)?.uftk);
  const gitCheckpoint = asRecord(uftk?.gitCheckpoint);
  const leaf = asRecord(gitCheckpoint?.[key]);
  return typeof leaf?.enabled === "boolean" ? leaf.enabled : undefined;
}

/**
 * P6B UFTK path-scoped checkpoint create/restore. Default false. The whole-tree
 * P5 API keeps its accepted semantics regardless of this flag; only the
 * `paths`-scoped surface is gated here.
 */
export function isCodingGitCheckpointPathScopedEnabled(
  cfg?: OpenClawConfig,
  overrides?: { gitCheckpointPathScopedEnabled?: boolean },
): boolean {
  if (typeof overrides?.gitCheckpointPathScopedEnabled === "boolean") {
    return overrides.gitCheckpointPathScopedEnabled;
  }
  return (
    readGitCheckpointSubLeaf(cfg, "pathScoped") ??
    DEFAULT_CODING_FEATURE_FLAGS["runtime.coding.uftk.gitCheckpoint.pathScoped.enabled"]
  );
}

/**
 * P6B UFTK mandatory safety snapshot before restore. Default false. With the
 * flag off, the transactional restore refuses to overwrite dirty in-scope
 * content instead of silently discarding it.
 */
export function isCodingGitCheckpointSafetySnapshotEnabled(
  cfg?: OpenClawConfig,
  overrides?: { gitCheckpointSafetySnapshotEnabled?: boolean },
): boolean {
  if (typeof overrides?.gitCheckpointSafetySnapshotEnabled === "boolean") {
    return overrides.gitCheckpointSafetySnapshotEnabled;
  }
  return (
    readGitCheckpointSubLeaf(cfg, "safetySnapshot") ??
    DEFAULT_CODING_FEATURE_FLAGS["runtime.coding.uftk.gitCheckpoint.safetySnapshot.enabled"]
  );
}

/** P6B UFTK checkpoint lifecycle (label/diff/exportPatch/retention/prune). Default false. */
export function isCodingGitCheckpointLifecycleEnabled(
  cfg?: OpenClawConfig,
  overrides?: { gitCheckpointLifecycleEnabled?: boolean },
): boolean {
  if (typeof overrides?.gitCheckpointLifecycleEnabled === "boolean") {
    return overrides.gitCheckpointLifecycleEnabled;
  }
  return (
    readGitCheckpointSubLeaf(cfg, "lifecycle") ??
    DEFAULT_CODING_FEATURE_FLAGS["runtime.coding.uftk.gitCheckpoint.lifecycle.enabled"]
  );
}

function readUftkSubLeaf(
  cfg: OpenClawConfig | undefined,
  key: "execUndo" | "autoCheckpoint",
): boolean | undefined {
  const uftk = asRecord(codingConfigFrom(cfg)?.uftk);
  const leaf = asRecord(uftk?.[key]);
  return typeof leaf?.enabled === "boolean" ? leaf.enabled : undefined;
}

/**
 * P7 UFTK exec workspace file side-effect undo. Default false; not wired to any
 * model tool. Only workspace file side effects are ever undone -- network, DB,
 * remote push and dependency installs are explicitly out of scope.
 */
export function isCodingExecUndoEnabled(
  cfg?: OpenClawConfig,
  overrides?: { execUndoEnabled?: boolean },
): boolean {
  if (typeof overrides?.execUndoEnabled === "boolean") {
    return overrides.execUndoEnabled;
  }
  return (
    readUftkSubLeaf(cfg, "execUndo") ??
    DEFAULT_CODING_FEATURE_FLAGS["runtime.coding.uftk.execUndo.enabled"]
  );
}

/**
 * P7 UFTK turn / long-task automatic checkpoint. Default false; never replaces
 * write-journal rollback.
 */
export function isCodingAutoCheckpointEnabled(
  cfg?: OpenClawConfig,
  overrides?: { autoCheckpointEnabled?: boolean },
): boolean {
  if (typeof overrides?.autoCheckpointEnabled === "boolean") {
    return overrides.autoCheckpointEnabled;
  }
  return (
    readUftkSubLeaf(cfg, "autoCheckpoint") ??
    DEFAULT_CODING_FEATURE_FLAGS["runtime.coding.uftk.autoCheckpoint.enabled"]
  );
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
