import { describe, expect, it, vi } from 'vitest';
import { applyAttemptPatch, createAttemptView } from '@shared/types/attempt';
import type { GitApplyPatchResult } from '@shared/types/git';

function patchResult(overrides: Partial<GitApplyPatchResult> = {}): GitApplyPatchResult {
  return { success: true, appliedPaths: [], skippedPaths: [], conflictedPaths: [], preflight: false, ...overrides };
}

const attempt = createAttemptView({
  attemptId: 'attempt-1',
  sessionKey: 'session-1',
  worktreePath: '/worktrees/attempt-1',
  evidenceRefs: [{ kind: 'test', ref: 'test-1', label: 'unit' }],
  patch: 'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-a\n+b\n',
  verification: 'passed',
});

describe('attempt diff-first apply', () => {
  it('returns approval-required after a successful preflight and does not apply', async () => {
    const apply = vi.fn(async ({ mode }: { mode: 'preflight' | 'apply' }) => patchResult({ preflight: mode === 'preflight' }));
    await expect(applyAttemptPatch({ attempt, apply })).resolves.toMatchObject({
      status: 'approval-required',
      attemptId: 'attempt-1',
    });
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith(expect.objectContaining({ mode: 'preflight' }));
  });

  it('applies only with an explicit approval ID', async () => {
    const apply = vi.fn(async ({ mode }: { mode: 'preflight' | 'apply' }) => patchResult({
      preflight: mode === 'preflight',
      appliedPaths: mode === 'apply' ? ['a.ts'] : [],
    }));
    const result = await applyAttemptPatch({ attempt, apply, approvalId: 'approval-1' });
    expect(result).toMatchObject({ status: 'applied', attemptId: 'attempt-1' });
    expect(apply).toHaveBeenLastCalledWith(expect.objectContaining({ mode: 'apply', approvalId: 'approval-1' }));
  });

  it('blocks failed verification and preserves malformed patch failures', async () => {
    const apply = vi.fn(async () => patchResult());
    await expect(applyAttemptPatch({ attempt: { ...attempt, verification: 'failed' }, apply, approvalId: 'a' }))
      .resolves.toMatchObject({ status: 'blocked', reason: 'Attempt verification failed' });
    expect(apply).not.toHaveBeenCalled();

    const failed = vi.fn(async () => patchResult({ success: false, reason: 'patch does not apply', stderr: 'bad patch' }));
    await expect(applyAttemptPatch({ attempt, apply: failed, approvalId: 'a' }))
      .resolves.toMatchObject({ status: 'blocked', reason: 'patch does not apply' });
  });

  it('composes with the existing Git apply authority without inventing a second E2E surface', async () => {
    const calls: Array<{ mode: string; approvalId?: string }> = [];
    const apply = vi.fn(async ({ mode, approvalId }: { mode: 'preflight' | 'apply'; approvalId?: string }) => {
      calls.push({ mode, ...(approvalId ? { approvalId } : {}) });
      return patchResult({ preflight: mode === 'preflight' });
    });
    await applyAttemptPatch({ attempt, apply });
    expect(calls).toEqual([{ mode: 'preflight' }]);
    await applyAttemptPatch({ attempt, apply, approvalId: 'approval-1' });
    expect(calls).toEqual([{ mode: 'preflight' }, { mode: 'preflight' }, { mode: 'apply', approvalId: 'approval-1' }]);
  });

  it('keeps immutable attempt identity and evidence references', () => {
    expect(attempt.attemptId).toBe('attempt-1');
    expect(attempt.evidenceRefs).toEqual([{ kind: 'test', ref: 'test-1', label: 'unit' }]);
    expect(attempt.worktreePath).toBe('/worktrees/attempt-1');
  });
});
