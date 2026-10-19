// Semantic rewrite of ragcode-context-engine's src/core/freshness-gate.ts (MIT),
// https://github.com/MarshallEriksen-Neura/ragcode — adapted per SPEC §4.3:
// staleness is decided by content-hash comparison (files.produced_hash vs the hash of
// the file's current content), not by ragcode's indexStatus stale/pending lists.
//
// Mode names follow the retired CodeGraph freshnessMode tiers
// (fast | balanced | strict) documented in the frozen parity provenance / SEAM_MAP §C; ragcode's env values map onto them.

export type FreshnessMode = "fast" | "balanced" | "strict";

export type FileFreshnessStatus = "fresh" | "stale" | "missing";

export interface FreshnessCheck {
  path: string;
  status: FileFreshnessStatus;
  /** Hash the stored facts were produced from (undefined when missing). */
  producedHash?: string;
  /** Hash of the file's current content as observed by the caller. */
  currentHash?: string;
  producer?: string;
}

export interface FreshnessReport {
  mode: FreshnessMode;
  fresh: string[];
  stale: string[];
  missing: string[];
  /** Files actually refreshed by the gate (empty until a refresher exists — Task D). */
  refreshed: string[];
  checks: FreshnessCheck[];
}

export interface StoredFreshnessInput {
  path: string;
  producedHash: string;
  producer?: string;
}

/** Pure hash-compare check: produced_hash != current content hash ⇒ stale. */
export function checkFileFreshness(
  stored: StoredFreshnessInput | undefined,
  currentHash: string | undefined,
): FreshnessCheck {
  if (!stored) {
    return { path: "", status: "missing", currentHash };
  }
  const check: FreshnessCheck = {
    path: stored.path,
    status: "fresh",
    producedHash: stored.producedHash,
    currentHash,
    producer: stored.producer,
  };
  if (currentHash === undefined || stored.producedHash === "" || stored.producedHash !== currentHash) {
    check.status = "stale";
  }
  return check;
}

export interface FreshnessGateOptions {
  mode?: FreshnessMode;
  /**
   * Bounded refresh hook (wired up by the Task D materializer). Given the stale/missing
   * paths the gate wants refreshed, returns the paths actually refreshed.
   */
  refresh?: (paths: string[]) => string[];
  /** Refresh budget for balanced mode; aligned with maxParsePerQuery (§3). */
  maxRefreshFiles?: number;
}

export const DEFAULT_MAX_REFRESH_FILES = 12;

/**
 * Freshness gate over a batch of checks.
 * - fast: never refreshes; reports staleness only (codegraph "skip sync").
 * - balanced: refreshes stale/missing up to maxRefreshFiles (throttled incremental sync).
 * - strict: refreshes everything stale/missing before returning (wait for sync).
 * Without a refresh hook every mode degrades to report-only.
 */
export function gateFreshness(checks: FreshnessCheck[], options: FreshnessGateOptions = {}): FreshnessReport {
  const mode = options.mode ?? resolveFreshnessModeFromEnv();
  const fresh = checks.filter((check) => check.status === "fresh").map((check) => check.path);
  const stale = checks.filter((check) => check.status === "stale").map((check) => check.path);
  const missing = checks.filter((check) => check.status === "missing").map((check) => check.path);

  let refreshed: string[] = [];
  if (mode !== "fast" && options.refresh) {
    const candidates = [...stale, ...missing];
    const budget = mode === "strict" ? candidates.length : (options.maxRefreshFiles ?? DEFAULT_MAX_REFRESH_FILES);
    if (candidates.length > 0 && budget > 0) {
      refreshed = options.refresh(candidates.slice(0, budget));
    }
  }

  return { mode, fresh, stale, missing, refreshed, checks };
}

/**
 * Env override, ragcode-compatible values folded into the codegraph tiers:
 * off/false/stale-ok/no-refresh → fast; force/force-refresh/always → strict; default balanced.
 */
export function resolveFreshnessModeFromEnv(env: NodeJS.ProcessEnv = process.env): FreshnessMode {
  const raw = env.OPENCLAW_FACTSTORE_FRESHNESS?.toLowerCase();
  if (raw === "fast" || raw === "off" || raw === "false" || raw === "stale-ok" || raw === "no-refresh") return "fast";
  if (raw === "strict" || raw === "force" || raw === "force-refresh" || raw === "always") return "strict";
  return "balanced";
}
