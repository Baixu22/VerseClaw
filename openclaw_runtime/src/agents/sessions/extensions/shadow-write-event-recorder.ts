/**
 * A1 Layered Execution Isolation — Shadow write-event recorder (Stage 2 Stream 2C).
 *
 * Context: Round 2 design. During the "shadow" phase (before A1 is fully active),
 * we observe tool writes and check whether they match the declared
 * `writeRiskProfile.declaredWritePaths`. Writes to paths NOT in the declared set
 * are recorded as `undeclared_write_event` for later analysis.
 *
 * This is observe-only (shadow) — it does NOT block or modify writes. It only
 * records mismatches so we can measure declaration quality before promoting A1
 * to advisory/active modes.
 *
 * Acceptance criteria:
 * - 2.7: Shadow records `undeclared_write_event` when a tool writes to a path
 *   not in `declaredWritePaths`.
 * - 2.8: 0 `undeclared_write_event` when all tools declare correctly.
 *
 * See: docs/runtime-design/development-manual.md §Stage 2, Stream 2C
 *      docs/runtime-design/area-1-layered-execution-isolation.md §9.2
 */

import type { WriteRiskProfile } from "../../../shared/tool-registration.js";

/**
 * A single undeclared write event — recorded when a tool writes to a path
 * that is not in its declared `writeRiskProfile.declaredWritePaths`.
 */
export type UndeclaredWriteEvent = {
  /** Name of the tool that performed the write. */
  toolName: string;
  /** The path that was written to (was not declared). */
  path: string;
  /** The declared write paths for the tool (for context). */
  declaredPaths: string[];
  /** Timestamp of the event. */
  timestamp: number;
};

/**
 * Result of comparing actual writes against declared paths.
 */
export type UndeclaredWriteResult = {
  /** Paths that were written but not declared. */
  undeclaredPaths: string[];
  /** Whether any undeclared writes were detected. */
  hasUndeclared: boolean;
};

/**
 * Pure function: detect undeclared writes by comparing actual write paths
 * against declared paths.
 *
 * Uses path-prefix matching: a write to `dir/file.txt` is considered declared
 * if `dir/file.txt` is in the declared set, OR if `dir/` is a declared prefix
 * (for `pattern_writes` / `declared_paths` that point to directories).
 *
 * @param declaredPaths Paths declared by the tool's `writeRiskProfile`.
 * @param actualPaths Paths actually written to during the turn.
 * @returns The set of undeclared paths.
 */
export function detectUndeclaredWrites(
  declaredPaths: readonly string[],
  actualPaths: readonly string[],
): UndeclaredWriteResult {
  const declaredSet = new Set(declaredPaths.map(normalizePath));
  const undeclaredPaths: string[] = [];

  for (const actualPath of actualPaths) {
    const normalized = normalizePath(actualPath);
    if (!isPathDeclared(normalized, declaredSet)) {
      undeclaredPaths.push(actualPath);
    }
  }

  return {
    undeclaredPaths,
    hasUndeclared: undeclaredPaths.length > 0,
  };
}

/**
 * Shadow write-event recorder — collects `undeclared_write_event` records
 * across one or more turns.
 *
 * Usage:
 * 1. Create with tool profiles (declared write paths per tool).
 * 2. After each turn, call `recordActualWrites(toolName, actualPaths)` with
 *    the paths that were actually written (from the snapshotter's fs-diff).
 * 3. Call `getEvents()` to retrieve all recorded events.
 * 4. Call `clear()` between sessions.
 */
export class ShadowWriteEventRecorder {
  private events: UndeclaredWriteEvent[] = [];
  private declaredPathsByTool: Map<string, string[]> = new Map();
  private dynamicWriteTools: Set<string> = new Set();
  private patternWriteTools: Set<string> = new Set();

  constructor(toolProfiles: Array<{ name: string; profile: WriteRiskProfile }>) {
    for (const { name, profile } of toolProfiles) {
      if (profile.kind === "declared_paths") {
        this.declaredPathsByTool.set(name, profile.writePaths.map(normalizePath));
      } else if (profile.kind === "pattern_writes") {
        // Pattern-matching tools use glob patterns (e.g., "*.log") that can't
        // be verified by exact/path-prefix matching without a glob matcher.
        // For shadow measurement, pattern_writes tools are NOT flagged —
        // they declared their behavior, and verifying glob matches is out of
        // scope for Stage 2 shadow measurement.
        this.patternWriteTools.add(name);
      } else if (profile.kind === "dynamic_writes") {
        // dynamic_writes tools declare that they write to arbitrary paths.
        // These are NOT flagged as undeclared — the tool explicitly declared
        // that it uses dynamic_writes.
        this.dynamicWriteTools.add(name);
      }
      // no_writes tools have no declared paths — any write is undeclared.
    }
  }

  /**
   * Record actual writes for a tool. If the tool wrote to paths not in its
   * declared `writeRiskProfile`, `undeclared_write_event` records are created.
   *
   * - `dynamic_writes` tools: never flagged (they declared dynamic behavior).
   * - `pattern_writes` tools: never flagged (glob matching out of scope).
   * - `declared_paths` tools: writes outside declared paths are flagged.
   * - `no_writes` tools: ANY write is flagged as undeclared.
   *
   * @param toolName Name of the tool.
   * @param actualPaths Paths actually written to during the turn.
   */
  recordActualWrites(toolName: string, actualPaths: readonly string[]): void {
    // dynamic_writes and pattern_writes tools are never flagged.
    if (this.dynamicWriteTools.has(toolName) || this.patternWriteTools.has(toolName)) {
      return;
    }

    const declaredPaths = this.declaredPathsByTool.get(toolName) ?? [];
    const { undeclaredPaths } = detectUndeclaredWrites(declaredPaths, actualPaths);

    for (const path of undeclaredPaths) {
      this.events.push({
        toolName,
        path,
        declaredPaths,
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Get all recorded `undeclared_write_event` records.
   */
  getEvents(): readonly UndeclaredWriteEvent[] {
    return this.events;
  }

  /**
   * Get the count of recorded events.
   */
  getEventCount(): number {
    return this.events.length;
  }

  /**
   * Check if any undeclared writes were recorded.
   */
  hasEvents(): boolean {
    return this.events.length > 0;
  }

  /**
   * Clear all recorded events (e.g., between sessions).
   */
  clear(): void {
    this.events = [];
  }
}

// -------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------

/**
 * Normalize a path for comparison: forward slashes, no trailing slash,
 * lowercase (for case-insensitive matching on Windows).
 */
function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

/**
 * Check if a (normalized) actual path is declared.
 *
 * A path is considered declared if:
 * - It exactly matches a declared path, OR
 * - A declared path is a prefix of it (directory match): e.g., declared
 *   `output/` covers `output/file.txt`.
 */
function isPathDeclared(normalizedPath: string, declaredSet: Set<string>): boolean {
  // Exact match.
  if (declaredSet.has(normalizedPath)) {
    return true;
  }
  // Prefix match: declared `dir/` covers `dir/file.txt`.
  for (const declared of declaredSet) {
    if (declared.endsWith("/") && normalizedPath.startsWith(declared)) {
      return true;
    }
    // Also handle the case where declared is `dir` (no trailing slash)
    // and actual is `dir/file.txt`.
    if (normalizedPath.startsWith(declared + "/")) {
      return true;
    }
  }
  return false;
}
