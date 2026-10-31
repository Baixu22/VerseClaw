import { createHash, randomUUID } from 'node:crypto';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import type { ChangeContextErrorCode, ChangeContextProjection, ChangeContextProjectionPayload, ChangeContextReviewVerdict } from '@shared/types/change-context';
import { isGitPatchArtifactV1 } from '@shared/types/remote-forge';

export function reviewDigest(projection: ChangeContextProjection): string {
  return `sha256:${createHash('sha256').update(JSON.stringify([
    projection.identity, projection.comparison?.mode, projection.comparison?.base,
    projection.comparison?.candidate, projection.diff,
  ])).digest('hex')}`;
}

type LoadedContext = { projection: ChangeContextProjection; payload: ChangeContextProjectionPayload; loadedAt: number };

export function createChangeContextReviewActions(input: {
  loaded: Map<string, LoadedContext>;
  refresh: (payload: ChangeContextProjectionPayload) => ReturnType<CompleteHostServiceRegistry['changeContext']['getProjection']>;
  listComments: CompleteHostServiceRegistry['changeContext']['listComments'];
  taskLedger: Pick<CompleteHostServiceRegistry['taskLedger'], 'snapshot' | 'appendEvents'>;
  applyPatch: CompleteHostServiceRegistry['git']['applyPatch'];
}): Pick<CompleteHostServiceRegistry['changeContext'], 'submitVerdict' | 'pullChanges'> {
  const fail = (code: ChangeContextErrorCode, safeMessage: string, details?: Record<string, unknown>) => ({
    schema: 'ChangeContextError/v1' as const, code, safeMessage, details, requestId: randomUUID(), retryable: code === 'unavailable',
  });
  async function current(payload: { contextId: string; workspaceId?: string | null; sessionKey: string }) {
    const loaded = input.loaded.get(payload.contextId);
    if (!loaded || Date.now() - loaded.loadedAt > 15 * 60_000) return null;
    if (loaded.projection.identity.workspaceId !== (payload.workspaceId ?? null) || loaded.projection.identity.sessionKey !== payload.sessionKey) return null;
    const refreshed = await input.refresh(loaded.payload);
    return refreshed.success && refreshed.projection?.reviewedDigest === loaded.projection.reviewedDigest ? loaded.projection : null;
  }
  return {
    submitVerdict: async (payload) => {
      try {
        if (!payload || !['approve', 'request_changes', 'comment_only'].includes(payload.decision)
          || !payload.author?.id?.trim() || !['agent', 'user', 'system'].includes(payload.author.kind)
          || (payload.author.kind === 'agent' && payload.author.drivenBy !== 'agent')) {
          return { success: false, error: fail('validation', 'A valid explicit verdict and actor are required.') };
        }
        const projection = await current(payload);
        if (!projection || !payload.reviewedDigest || payload.reviewedDigest !== projection.reviewedDigest) {
          return { success: false, error: fail('stale', 'The reviewed context is stale or unavailable. Reload before submitting.') };
        }
        if (payload.decision !== 'request_changes' && payload.taskLedgerNodeId) {
          return { success: false, error: fail('validation', 'Only request changes may link a task.') };
        }
        const comments = await input.listComments({ workspaceId: projection.identity.workspaceId, sessionKey: payload.sessionKey, contextId: payload.contextId });
        if (!comments.success || (payload.commentIds ?? []).some((id) => !comments.comments.some((entry) => entry.comment.id === id && !entry.comment.deletedAt))) {
          return { success: false, error: fail('validation', 'Verdict comment references must belong to this context.') };
        }
        const base = { id: randomUUID(), schemaVersion: 1 as const, contextId: payload.contextId,
          workspaceId: projection.identity.workspaceId, sessionKey: payload.sessionKey,
          reviewedDigest: payload.reviewedDigest, commentIds: [...new Set(payload.commentIds ?? [])],
          author: payload.author, createdAt: new Date().toISOString(),
          authority: { completesTaskLedgerNode: false as const, executesCode: false as const, grantsApproval: false as const } };
        if (payload.decision !== 'request_changes') {
          const verdict: ChangeContextReviewVerdict = { ...base, decision: payload.decision, taskLedgerEffect: 'none', taskLedgerLink: null };
          return { success: true, verdict };
        }
        const workspaceId = payload.taskLedgerWorkspaceId ?? projection.identity.workspaceId;
        if (workspaceId !== projection.identity.workspaceId) return { success: false, error: fail('validation', 'Cross-workspace task linkage is not permitted.') };
        const snapshot = await input.taskLedger.snapshot({ workspaceId });
        if (!snapshot.success) return { success: false, error: fail('unavailable', 'Task Ledger is unavailable.') };
        const nodeId = payload.taskLedgerNodeId || `change-context-review:${payload.contextId}`;
        const existing = snapshot.snapshot.nodes.find((node) => node.id === nodeId);
        if (payload.taskLedgerNodeId && !existing) return { success: false, error: fail('not_found', 'The referenced Task Ledger node does not exist.') };
        if (!existing) {
          const node = { id: nodeId, title: `Review changes: ${payload.contextId}`, kind: 'review' as const,
            parentId: null, status: 'todo' as const, owner: 'agent' as const, priority: 'normal' as const,
            tags: ['change-context'], description: 'Explicit request changes; review evidence does not authorize execution.',
            evidenceRefs: [{ type: 'other' as const, ref: payload.contextId, label: payload.reviewedDigest }],
            metadata: { source: 'change-context', contextId: payload.contextId, reviewedDigest: payload.reviewedDigest, driven_by: payload.author.drivenBy ?? 'user', actor: payload.author.id },
            createdAt: base.createdAt, updatedAt: base.createdAt, completedAt: null };
          const created = await input.taskLedger.appendEvents({ workspaceId,
            idempotencyKey: nodeId, events: [{ type: 'node_created', actor: payload.author.kind === 'agent' ? 'assistant' : 'user', taskId: nodeId, payload: { node } }] });
          if (!created.success || !created.snapshot.nodes.some((entry) => entry.id === nodeId)) return { success: false, error: fail('unavailable', 'Task creation could not be confirmed.') };
        }
        return { success: true, verdict: { ...base, decision: 'request_changes', taskLedgerEffect: 'link_only',
          taskLedgerLink: { direction: 'review-to-task-ledger', taskLedgerNodeId: nodeId, taskLedgerWorkspaceId: workspaceId, linkedAt: base.createdAt, created: !existing } } };
      } catch { return { success: false, error: fail('unavailable', 'Review owner unavailable; reload before retrying.') }; }
    },
    pullChanges: async (payload) => {
      let delegated = false;
      const denied = (state: 'unavailable' | 'stale' | 'conflicted' | 'denied' | 'partial' | 'truncated', code: ChangeContextErrorCode, message: string, details?: Record<string, unknown>) => ({
        success: false as const, state, destinationMutated: false as const, error: fail(code, message, details),
      });
      try {
        if (!payload?.contextId) return denied('unavailable', 'validation', 'A loaded Change Context is required.');
        const projection = await current(payload);
        if (!projection) return denied('stale', 'stale', 'Change Context is stale or unavailable.');
        const patch = payload.patchArtifact;
        if (!isGitPatchArtifactV1(patch) || patch.completeness !== 'complete' || patch.contentKind !== 'text' || !patch.patch) {
          return denied(patch?.completeness === 'truncated' ? 'truncated' : 'unavailable', 'unavailable', 'An available complete text patch is required.');
        }
        if (!projection.diff?.patchArtifacts.some((entry) => JSON.stringify(entry) === JSON.stringify(patch))) {
          return denied('stale', 'stale', 'Patch is not bound to the loaded review digest.');
        }
        if (!projection.identity.workspaceId || !/^[a-f0-9]{40,64}$/i.test(payload.expectedDestinationHead)) return denied('unavailable', 'validation', 'A workspace and full destination HEAD are required.');
        // The structured artifact parser drops the transport's final LF. Git
        // requires it; bind approval/receipt to the exact bytes sent to apply.
        const patchText = patch.patch.endsWith('\n') ? patch.patch : `${patch.patch}\n`;
        const patchDigest = `sha256:${createHash('sha256').update(patchText).digest('hex')}`;
        delegated = true;
        const applied = await input.applyPatch({ patch: patchText, mode: 'apply', approvalId: payload.approvalId,
          reviewBinding: { workspaceId: projection.identity.workspaceId, sessionKey: payload.sessionKey, contextId: payload.contextId, expectedHead: payload.expectedDestinationHead, patchDigest } });
        if (applied.recoveryRequired) return { success: false, state: 'recovery_required', destinationMutated: 'unknown', writeJournalId: applied.writeJournalId,
          error: fail('internal', 'Write journal recovery is required; do not retry this mutation.') };
        if (!applied.success) return denied(applied.stale ? 'stale' : applied.approvalRequired || applied.blocked ? 'denied' : 'conflicted',
          applied.stale ? 'stale' : applied.approvalRequired || applied.blocked ? 'approval_required' : 'conflict',
          applied.reason ?? applied.stderr ?? 'The existing apply owner rejected this patch.', { approval: applied.approval });
        if (!applied.writeJournalId) return { success: false, state: 'recovery_required', destinationMutated: 'unknown',
          error: fail('internal', 'Apply returned without a journal receipt; inspect recovery before retrying.') };
        return { success: true, state: 'applied', destinationMutated: true,
          receipt: { approvalId: payload.approvalId, patchDigest, destinationHeadBefore: payload.expectedDestinationHead,
            destinationHeadAfter: applied.destinationHead ?? payload.expectedDestinationHead, writeJournalId: applied.writeJournalId } };
      } catch {
        if (delegated) return { success: false, state: 'recovery_required', destinationMutated: 'unknown',
          error: fail('internal', 'Apply outcome is unknown; inspect journal recovery before retrying.') };
        return denied('unavailable', 'unavailable', 'Pull Changes could not reach the existing apply owner.');
      }
    },
  };
}
