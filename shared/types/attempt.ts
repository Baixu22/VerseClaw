import type { GitApplyPatchResult } from './git.js';

export type AttemptEvidenceRef = {
  kind: 'session' | 'trace' | 'file' | 'test' | 'verification' | 'other';
  ref: string;
  label: string | null;
};

export type AttemptVerification = 'pending' | 'passed' | 'failed' | 'unavailable';

/** Immutable read model; the attempt owner never overwrites an attempt ID. */
export type AttemptView = {
  attemptId: string;
  sessionKey: string | null;
  worktreePath: string | null;
  evidenceRefs: AttemptEvidenceRef[];
  patch: string | null;
  verification: AttemptVerification;
  createdAt: string;
};

export type AttemptApplyInput = {
  attempt: AttemptView;
  apply: (input: { patch: string; mode: 'preflight' | 'apply'; approvalId?: string }) => Promise<GitApplyPatchResult>;
  approvalId?: string | null;
};

export type AttemptApplyResult =
  | { status: 'blocked'; reason: string; attemptId: string; preflight: GitApplyPatchResult }
  | { status: 'approval-required'; attemptId: string; preflight: GitApplyPatchResult }
  | { status: 'applied'; attemptId: string; preflight: GitApplyPatchResult; applied: GitApplyPatchResult }
  | { status: 'failed'; attemptId: string; reason: string; preflight: GitApplyPatchResult | null; applied?: GitApplyPatchResult };

function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`Attempt requires ${field}`);
  }
  return value;
}

export function createAttemptView(input: Omit<AttemptView, 'createdAt'> & { createdAt?: string }): AttemptView {
  const evidenceRefs = input.evidenceRefs.map((ref, index) => ({
    kind: ref.kind,
    ref: requiredText(ref.ref, `evidenceRefs[${index}].ref`),
    label: ref.label,
  }));
  return {
    attemptId: requiredText(input.attemptId, 'attemptId'),
    sessionKey: input.sessionKey,
    worktreePath: input.worktreePath,
    evidenceRefs,
    patch: input.patch,
    verification: input.verification,
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
}

/**
 * Explicit diff-first apply. Preflight always runs first; an apply without an
 * approval ID returns approval-required and never calls the mutating path.
 */
export async function applyAttemptPatch(input: AttemptApplyInput): Promise<AttemptApplyResult> {
  const attempt = createAttemptView(input.attempt);
  if (!attempt.patch?.trim()) {
    return { status: 'blocked', reason: 'Attempt has no patch to apply', attemptId: attempt.attemptId, preflight: { success: false, appliedPaths: [], skippedPaths: [], conflictedPaths: [], preflight: true } };
  }
  if (attempt.verification === 'failed') {
    return { status: 'blocked', reason: 'Attempt verification failed', attemptId: attempt.attemptId, preflight: { success: false, appliedPaths: [], skippedPaths: [], conflictedPaths: [], preflight: true } };
  }
  let preflight: GitApplyPatchResult;
  try {
    preflight = await input.apply({ patch: attempt.patch, mode: 'preflight' });
  } catch (error) {
    return { status: 'failed', attemptId: attempt.attemptId, reason: error instanceof Error ? error.message : String(error), preflight: null };
  }
  if (!preflight.success) {
    return { status: 'blocked', reason: preflight.reason ?? preflight.stderr ?? 'Patch preflight failed', attemptId: attempt.attemptId, preflight };
  }
  if (!input.approvalId?.trim()) {
    return { status: 'approval-required', attemptId: attempt.attemptId, preflight };
  }
  try {
    const applied = await input.apply({ patch: attempt.patch, mode: 'apply', approvalId: input.approvalId });
    if (!applied.success) {
      return { status: 'failed', attemptId: attempt.attemptId, reason: applied.reason ?? applied.stderr ?? 'Patch apply failed', preflight, applied };
    }
    return { status: 'applied', attemptId: attempt.attemptId, preflight, applied };
  } catch (error) {
    return { status: 'failed', attemptId: attempt.attemptId, reason: error instanceof Error ? error.message : String(error), preflight };
  }
}
