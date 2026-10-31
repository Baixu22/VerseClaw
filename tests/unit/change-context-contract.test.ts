// @vitest-environment node

import { describe, expect, it } from 'vitest';
import type {
  ChangeContextComparisonMode,
  ChangeContextPullChangesPayload,
  ChangeContextReviewAnchorState,
  ChangeContextReviewComment,
  ChangeContextReviewCommentAnchor,
  ChangeContextRevisionRef,
  ChangeContextState,
} from '@shared/types/change-context';
import {
  CHANGE_CONTEXT_COMPARISON_MODES,
  CHANGE_CONTEXT_REVIEW_ANCHOR_STATES,
  CHANGE_CONTEXT_REVIEW_COMMENT_STORE_POLICY,
  CHANGE_CONTEXT_REVIEW_VERDICTS,
  CHANGE_CONTEXT_STATES,
} from '@shared/types/change-context';
import { createChangeContextApi } from '@electron/services/change-context-api';
import {
  createChangeContextReviewCommentStore,
  createInMemoryChangeContextReviewCommentBackend,
} from '@electron/services/change-context-review-store';

const baseRevision: ChangeContextRevisionRef = {
  kind: 'git-commit',
  commit: '0123456789abcdef',
  treeDigest: 'sha256:base-tree',
};

const candidateRevision: ChangeContextRevisionRef = {
  kind: 'git-worktree',
  workspaceId: 'workspace-1',
  headCommit: 'fedcba9876543210',
  worktreeDigest: 'sha256:candidate-tree',
};

const anchor: ChangeContextReviewCommentAnchor = {
  path: 'src/example.ts',
  range: { startLine: 4, endLine: 6 },
  fileDigest: 'sha256:file',
  rangeDigest: 'sha256:range',
  baseRevision,
  candidateRevision,
  originalExcerpt: 'const value = 1;',
};

function fixedClock() {
  let tick = 0;
  return () => {
    tick += 1;
    return `2026-10-30T00:00:${String(tick).padStart(2, '0')}.000Z`;
  };
}

describe('change context contract', () => {
  it('freezes all comparison, state and verdict variants', () => {
    const comparisonModes: ChangeContextComparisonMode[] = [...CHANGE_CONTEXT_COMPARISON_MODES];
    const states: ChangeContextState[] = [...CHANGE_CONTEXT_STATES];
    const anchorStates: ChangeContextReviewAnchorState[] = [...CHANGE_CONTEXT_REVIEW_ANCHOR_STATES];

    expect(comparisonModes).toEqual(['merge-base', 'last-commit', 'last-turn', 'checkpoint']);
    expect(states).toEqual(['available', 'partial', 'truncated', 'stale', 'removed', 'unavailable']);
    expect(anchorStates).toEqual(['live', 'stale', 'removed', 'unavailable']);
    expect(CHANGE_CONTEXT_REVIEW_VERDICTS).toEqual(['approve', 'request_changes', 'comment_only']);
  });

  it('does not place task, execution or approval authority on review comments', () => {
    type AuthorityField = Extract<
      keyof ChangeContextReviewComment,
      'taskLedgerNodeId' | 'approvalId' | 'executionId' | 'writeJournalId'
    >;
    const authorityFields: AuthorityField[] = [];
    expect(authorityFields).toEqual([]);
    expect(CHANGE_CONTEXT_REVIEW_COMMENT_STORE_POLICY.authority).toEqual({
      session: false,
      task: false,
      execution: false,
      approval: false,
      gitMutation: false,
    });
  });

  it('stores comments as explicit tombstones with optimistic mutation guards', async () => {
    const backend = createInMemoryChangeContextReviewCommentBackend();
    const store = createChangeContextReviewCommentStore({
      backend,
      now: fixedClock(),
      createId: () => 'comment-1',
    });

    const created = await store.create({
      workspaceId: 'workspace-1',
      sessionKey: 'session-1',
      contextId: 'context-1',
      body: 'Please cover the null case.',
      author: { id: 'agent:reviewer', kind: 'agent', drivenBy: 'agent' },
      anchor,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error(created.failure.message);
    expect(created.value).not.toHaveProperty('taskLedgerNodeId');
    expect(created.value).not.toHaveProperty('approvalId');
    expect(created.value).not.toHaveProperty('executionId');

    const resolved = await store.resolve({ commentId: created.value.id, resolved: true, author: created.value.author });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) throw new Error(resolved.failure.message);
    expect(resolved.value.resolvedAt).toBe('2026-10-30T00:00:02.000Z');

    const movedAnchor: ChangeContextReviewCommentAnchor = {
      ...anchor,
      range: { startLine: 8, endLine: 10 },
    };
    const reanchored = await store.reanchor({
      commentId: created.value.id,
      expectedUpdatedAt: resolved.value.updatedAt,
      author: created.value.author,
      anchor: movedAnchor,
      reason: 'Explicit re-anchor after the reviewed range moved.',
    });
    expect(reanchored.ok).toBe(true);
    if (!reanchored.ok) throw new Error(reanchored.failure.message);
    expect(reanchored.value.anchor.range).toEqual(movedAnchor.range);
    expect(reanchored.value.reanchorCount).toBe(1);

    const deleted = await store.delete({
      commentId: created.value.id,
      expectedUpdatedAt: reanchored.value.updatedAt,
      author: created.value.author,
      reason: 'Review evidence withdrawn by the author.',
    });
    expect(deleted.ok).toBe(true);
    if (!deleted.ok) throw new Error(deleted.failure.message);
    expect(deleted.value.deletedAt).toBe('2026-10-30T00:00:04.000Z');
    expect(backend.snapshot().comments).toHaveLength(1);

    const visible = await store.list({ sessionKey: 'session-1', contextId: 'context-1' });
    expect(visible.ok).toBe(true);
    if (!visible.ok) throw new Error(visible.failure.message);
    expect(visible.value.comments).toEqual([]);

    const tombstones = await store.list({
      sessionKey: 'session-1',
      contextId: 'context-1',
      includeDeleted: true,
    });
    expect(tombstones.ok).toBe(true);
    if (!tombstones.ok) throw new Error(tombstones.failure.message);
    expect(tombstones.value.comments[0].deletionReason).toBe('Review evidence withdrawn by the author.');
  });

  it('returns explicit unavailable states instead of empty successful projections', async () => {
    const store = createChangeContextReviewCommentStore({
      backend: createInMemoryChangeContextReviewCommentBackend(),
      now: fixedClock(),
    });
    const api = createChangeContextApi({ store, createRequestId: () => 'request-1' });

    const projection = await api.getProjection({
      sessionKey: 'session-1',
      comparison: { mode: 'last-turn' },
    });
    expect(projection.success).toBe(false);
    expect(projection.projection?.comparison?.state).toBe('unavailable');
    expect(projection.projection?.diff?.state).toBe('unavailable');
    expect(projection.error).toMatchObject({ code: 'unavailable', requestId: 'request-1' });

    const pull = await api.pullChanges({} as ChangeContextPullChangesPayload);
    expect(pull.success).toBe(false);
    if (pull.success) throw new Error('Pull Changes must remain unavailable in TF-0613');
    expect(pull.state).toBe('unavailable');
    expect(pull.destinationMutated).toBe(false);
  });

  it('keeps a corrupt comment store partial instead of reporting an empty success', async () => {
    const backend = createInMemoryChangeContextReviewCommentBackend({
      schemaVersion: 1,
      comments: [{ invalid: true } as never],
    });
    const store = createChangeContextReviewCommentStore({ backend });
    const api = createChangeContextApi({ store, createRequestId: () => 'request-2' });

    const list = await api.listComments({ sessionKey: 'session-1' });
    expect(list.success).toBe(false);
    expect(list.storeState).toBe('partial');
    expect(list.comments).toEqual([]);
    expect(list.error).toMatchObject({ code: 'partial', requestId: 'request-2' });
  });
});
