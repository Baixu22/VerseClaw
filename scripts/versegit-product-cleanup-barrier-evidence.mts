import { createHash } from "node:crypto";
import { join } from "node:path";
import { createVerseGitCleanupBarrier } from '../shared/versegit-cleanup-barrier';
import type { VerseGitCleanupIdentity } from '../shared/types/versegit';
import type { VerificationPlan } from '../electron/services/versegit-receipt-bridge';
import { cleanupBarrierEvidenceFromRecord } from '../electron/services/versegit-receipt-evidence';

/**
 * Attach a completed host cleanup barrier to a receipt cleanup record.
 *
 * Product paths perform the actual deletion between seal and detach. Historical
 * evidence probes use this helper only after independently observing the same
 * zero-survivor inventory.
 */
export function attachCompletedCleanupBarrier(input: {
  root: string;
  plan: VerificationPlan;
  cleanup: Record<string, unknown>;
  baseOid: string;
  refsDigest: string;
}): string {
  const cleanupBarrierRoot = join(input.root, 'cleanup-barrier');
  const barrier = createVerseGitCleanupBarrier(cleanupBarrierRoot);
  const identity: VerseGitCleanupIdentity = {
    ownerId: input.plan.owner,
    epoch: input.plan.epoch,
    authorizationId: input.plan.authorizationId,
    baseOid: input.baseOid,
    refsDigest: input.refsDigest,
  };
  const resource = {
    kind: 'manager' as const,
    id: 'cleanup-manager',
    target: 'session-cleanup',
    owned: true,
    preserve: false,
  };
  const seal = barrier.seal({
    runId: input.plan.runId,
    sessionId: 'session-cleanup',
    bindingId: 'binding-cleanup',
    actor: 'codex',
    expected: identity,
    current: identity,
    references: [],
    evidenceDigests: [`sha256:${createHash("sha256").update(JSON.stringify(input.cleanup)).digest("hex")}`],
    inventoryBefore: { observed: true, processes: 0, managers: 1, worktrees: 0, tempRoots: 0, survivors: [] },
    resources: [resource],
    deletedKinds: ['manager'],
    stopAccepting: true,
    drain: { ok: true, issues: [] },
  });
  if (!seal.sealId) throw new Error(`cleanup barrier seal failed: ${seal.issues.join(',')}`);
  const detached = barrier.markDetached({
    runId: input.plan.runId,
    sealId: seal.sealId,
    current: identity,
    vgDetached: true,
  });
  if (!detached.ok) throw new Error(`cleanup barrier detach failed: ${detached.issues.join(',')}`);
  const completed = barrier.complete({
    runId: input.plan.runId,
    sealId: seal.sealId,
    inventoryAfter: { observed: true, processes: 0, managers: 0, worktrees: 0, tempRoots: 0, survivors: [] },
  });
  if (!completed.ok || !completed.record) throw new Error(`cleanup barrier completion failed: ${completed.issues.join(',')}`);
  input.cleanup.cleanupBarrier = cleanupBarrierEvidenceFromRecord(completed.record);
  return cleanupBarrierRoot;
}
