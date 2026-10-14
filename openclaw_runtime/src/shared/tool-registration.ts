/**
 * Static write-risk declaration for tool registration — runtime-local.
 *
 * Context: Round 2 design (A1 Layered Execution Isolation). Replaces the
 * unenforceable runtime `recordPathTouch` hook with a static declaration
 * enforced at tool registration time. The snapshotter trusts
 * `declaredWritePaths ∩ actual_fs_diff` instead of runtime path tracking.
 *
 * See: docs/runtime-design/area-1-layered-execution-isolation.md §9.2
 *      docs/runtime-design/development-manual.md §1.1, Stage 2
 */

export type WriteRiskProfile =
  | { kind: 'no_writes' }
  | { kind: 'declared_paths'; writePaths: string[] }
  | { kind: 'pattern_writes'; writePattern: string }
  | { kind: 'dynamic_writes'; requiresApproval: true }
  /**
   * Non-filesystem durable-state mutation (deviation
   * TFD-lane2-toolrisklevel-backlog-p1-2026-08-27). The tool mutates an owning
   * store — Task Ledger, approval ledger, runtime receipts, … — rather than
   * workspace files, so a filesystem diff cannot observe it and a readonly
   * ToolRiskLevel must not be read as "no durable mutation". The declaration
   * names the owning store/API contract that governs the write.
   */
  | { kind: 'durable_state'; ownerStore: string; requiresApproval: boolean };

export const DEFAULT_WRITE_RISK_PROFILE: WriteRiskProfile = {
  kind: 'dynamic_writes',
  requiresApproval: true,
};

export function requiresFullFsDiff(profile: WriteRiskProfile): boolean {
  return profile.kind === 'dynamic_writes';
}

export function requiresApproval(profile: WriteRiskProfile): boolean {
  if (profile.kind === 'dynamic_writes') return profile.requiresApproval;
  if (profile.kind === 'durable_state') return profile.requiresApproval;
  return false;
}

export function validateWriteRiskProfile(profile: unknown): string | null {
  if (typeof profile !== 'object' || profile === null) {
    return 'writeRiskProfile is required for write-capable tools';
  }
  const p = profile as Record<string, unknown>;
  if (p.kind === 'no_writes') return null;
  if (p.kind === 'declared_paths') {
    if (!Array.isArray(p.writePaths) || p.writePaths.length === 0) {
      return 'writeRiskProfile.kind="declared_paths" requires non-empty writePaths array';
    }
    return null;
  }
  if (p.kind === 'pattern_writes') {
    if (typeof p.writePattern !== 'string' || p.writePattern.length === 0) {
      return 'writeRiskProfile.kind="pattern_writes" requires non-empty writePattern string';
    }
    // P1 fix: A pattern that matches everything is semantically equivalent to
    // `dynamic_writes` but bypasses `requiresApproval`. Reject catch-all patterns
    // so callers must use `dynamic_writes` (which requires approval) instead.
    const pattern = (p.writePattern as string).trim();
    if (pattern === '*' || pattern === '**' || pattern === '**/*' || pattern === '*/*') {
      return `writeRiskProfile.kind="pattern_writes" with writePattern="${pattern}" matches all paths; use kind="dynamic_writes" (with requiresApproval=true) instead`;
    }
    return null;
  }
  if (p.kind === 'dynamic_writes') {
    if (p.requiresApproval !== true) {
      return 'writeRiskProfile.kind="dynamic_writes" requires requiresApproval=true';
    }
    return null;
  }
  if (p.kind === 'durable_state') {
    if (typeof p.ownerStore !== 'string' || p.ownerStore.trim().length === 0) {
      return 'writeRiskProfile.kind="durable_state" requires a non-empty ownerStore string naming the owning store/API contract';
    }
    if (typeof p.requiresApproval !== 'boolean') {
      return 'writeRiskProfile.kind="durable_state" requires a boolean requiresApproval';
    }
    return null;
  }
  return `writeRiskProfile.kind must be one of: no_writes, declared_paths, pattern_writes, dynamic_writes, durable_state (got: ${String(p.kind)})`;
}

/**
 * Tool risk level. Used by `assertWriteRiskProfileForTool` to decide whether
 * a `writeRiskProfile` is required at registration time.
 *
 * This is a filesystem-risk classification. `readonly` does not prove that a
 * tool performs no durable state transition in an existing owner store; such a
 * tool must declare a `durable_state` writeRiskProfile naming its owning store
 * instead of relying on the filesystem classification.
 *
 * - `readonly`: tool does not write to the filesystem; profile optional.
 * - `write`: tool writes to the filesystem; `writeRiskProfile` is REQUIRED.
 * - `destructive`: tool performs irreversible operations; `writeRiskProfile`
 *   is REQUIRED and must be `dynamic_writes` (full fs-diff) for safety.
 */
export type ToolRiskLevel = 'readonly' | 'write' | 'destructive';

/**
 * Error thrown by `assertWriteRiskProfileForTool` when a write-capable tool is
 * registered without a valid `writeRiskProfile`. The `field` property lets the
 * tool registry surface a named-field error to the caller (acceptance 0.4).
 */
export class MissingWriteRiskProfileError extends Error {
  readonly field = 'writeRiskProfile';
  constructor(message: string) {
    super(message);
    this.name = 'MissingWriteRiskProfileError';
  }
}

/**
 * Stage 0 enforcement seam: assert that a tool with the given risk level has a
 * valid `writeRiskProfile`. This is the minimal enforcement required by
 * acceptance criterion 0.4. The full tool-registry integration happens in
 * Stage 2; this function is the pure validation core that the registry will
 * call.
 *
 * Rules:
 * - `readonly` tools: profile is optional (may be omitted or `no_writes`).
 * - `write` tools: profile is REQUIRED; must pass `validateWriteRiskProfile`.
 * - `destructive` tools: profile is REQUIRED and must be `dynamic_writes`
 *   (destructive operations cannot declare static paths — they need full
 *   fs-diff for safety review).
 *
 * Throws `MissingWriteRiskProfileError` (with `field: 'writeRiskProfile'`)
 * when the rule is violated.
 */
export function assertWriteRiskProfileForTool(
  riskLevel: ToolRiskLevel,
  profile: unknown,
): void {
  if (riskLevel === 'readonly') {
    // A filesystem `readonly` classification does not cover durable-store
    // mutation, so it must not silently swallow a malformed durable-state
    // declaration.
    if ((profile as { kind?: unknown } | undefined)?.kind === 'durable_state') {
      const durableError = validateWriteRiskProfile(profile);
      if (durableError) throw new MissingWriteRiskProfileError(durableError);
    }
    return; // profile optional
  }

  // write or destructive: profile required
  const validationError = validateWriteRiskProfile(profile);
  if (validationError) {
    throw new MissingWriteRiskProfileError(validationError);
  }

  const p = profile as WriteRiskProfile;

  // S2 fix (P0): semantic consistency — a write-capable tool declaring
  // `no_writes` is contradictory and would bypass all write detection.
  // Reject this combination at registration time.
  if (riskLevel === 'write' || riskLevel === 'destructive') {
    if (p.kind === 'no_writes') {
      throw new MissingWriteRiskProfileError(
        `risk="${riskLevel}" is semantically incompatible with writeRiskProfile.kind="no_writes"; ` +
          `write-capable tools must declare declared_paths, pattern_writes, or dynamic_writes`,
      );
    }
  }

  // For destructive tools, require dynamic_writes (full fs-diff).
  if (riskLevel === 'destructive') {
    if (p.kind !== 'dynamic_writes') {
      throw new MissingWriteRiskProfileError(
        `risk="destructive" requires writeRiskProfile.kind="dynamic_writes" (got "${p.kind}"); ` +
          `destructive operations must go through full fs-diff for safety review`,
      );
    }
  }
}
