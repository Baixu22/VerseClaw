// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';
import type {
  ChangeContextReviewAnchorResolver,
  ChangeContextReviewCommentAnchor,
} from '@shared/types/change-context';
import { createChangeContextApi } from '@electron/services/change-context-api';
import { projectReviewAnchorRangeFreshness } from '@electron/services/change-context-anchor';
import { createChangeContextReviewCommentStore, createInMemoryChangeContextReviewCommentBackend } from '@electron/services/change-context-review-store';

const anchor: ChangeContextReviewCommentAnchor = {
  path: 'src/example.ts',
  range: { startLine: 1, endLine: 2 },
  fileDigest: 'sha256:file',
  rangeDigest: 'sha256:range',
  baseRevision: null,
  candidateRevision: null,
  originalExcerpt: 'line one\nline two',
};

function createStore() {
  const backend = createInMemoryChangeContextReviewCommentBackend();
  let tick = 0;
  const now = () => {
    tick += 1;
    return `2026-10-30T00:00:${String(tick).padStart(2, '0')}.000Z`;
  };
  return {
    backend,
    store: createChangeContextReviewCommentStore({ backend, createId: () => 'comment-1', now }),
  };
}

describe('Change Context review anchor freshness', () => {
  it('is live only when both file and range digests match', async () => {
    const result = await projectReviewAnchorRangeFreshness(anchor, async () => ({
      kind: 'source-snapshot',
      revisionId: 'revision-1',
      fileDigest: anchor.fileDigest!,
      rangeDigest: anchor.rangeDigest!,
    }));
    expect(result).toMatchObject({
      state: 'live',
      fileDigestState: 'match',
      rangeDigestState: 'match',
      issues: [],
    });
  });

  it('reports stale without moving the anchor when the range changes', async () => {
    const result = await projectReviewAnchorRangeFreshness(anchor, async () => ({
      kind: 'source-snapshot',
      revisionId: 'revision-2',
      fileDigest: anchor.fileDigest!,
      rangeDigest: 'sha256:new-range',
    }));
    expect(result.state).toBe('stale');
    expect(result.fileDigestState).toBe('match');
    expect(result.rangeDigestState).toBe('changed');
    expect(result.issues[0]?.code).toBe('source_stale');
  });

  it('reports removed when the anchored source no longer exists', async () => {
    const result = await projectReviewAnchorRangeFreshness(anchor, async () => null);
    expect(result.state).toBe('removed');
    expect(result.issues[0]?.code).toBe('source_removed');
  });

  it('reports unavailable when digests or the source proof are missing', async () => {
    const noDigest = await projectReviewAnchorRangeFreshness({ ...anchor, rangeDigest: null }, async () => null);
    expect(noDigest.state).toBe('unavailable');
    expect(noDigest.issues[0]?.code).toBe('digest_missing');

    const failed = await projectReviewAnchorRangeFreshness(anchor, async () => {
      throw new Error('source unavailable');
    });
    expect(failed.state).toBe('unavailable');
    expect(failed.issues[0]?.code).toBe('source_unavailable');
  });

  it('projects the states through listComments without mutating comments', async () => {
    const { store } = createStore();
    await store.create({
      sessionKey: 'session-1',
      contextId: 'context-1',
      body: 'Review this range.',
      author: { id: 'agent:reviewer', kind: 'agent', drivenBy: 'agent' },
      anchor,
    });
    const resolveReviewAnchor: ChangeContextReviewAnchorResolver = vi.fn(async () => ({
      kind: 'source-snapshot' as const,
      revisionId: 'revision-2',
      fileDigest: anchor.fileDigest!,
      rangeDigest: 'sha256:changed',
    }));
    const api = createChangeContextApi({
      store,
      resolveReviewAnchor,
      createRequestId: () => 'request-1',
    });

    const result = await api.listComments({ sessionKey: 'session-1', contextId: 'context-1' });
    expect(result.success).toBe(true);
    expect(result.comments[0].anchorState).toBe('stale');
    expect(result.comments[0].comment.anchor).toEqual(anchor);
    expect(resolveReviewAnchor).toHaveBeenCalledWith(anchor);
  });

  it('uses explicit optimistic re-anchor and rejects a stale write', async () => {
    const { store } = createStore();
    const created = await store.create({
      sessionKey: 'session-1',
      contextId: 'context-1',
      body: 'Move only when requested.',
      author: { id: 'agent:reviewer', kind: 'agent', drivenBy: 'agent' },
      anchor,
    });
    if (!created.ok) throw new Error(created.failure.message);
    const shifted = { ...anchor, range: { startLine: 4, endLine: 5 } };

    const reanchored = await store.reanchor({
      commentId: created.value.id,
      expectedUpdatedAt: created.value.updatedAt,
      author: created.value.author,
      anchor: shifted,
      reason: 'Explicitly follow the moved range.',
    });
    expect(reanchored.ok).toBe(true);
    if (!reanchored.ok) throw new Error(reanchored.failure.message);
    expect(reanchored.value.anchor.range).toEqual({ startLine: 4, endLine: 5 });
    expect(reanchored.value.reanchorCount).toBe(1);

    const staleWrite = await store.reanchor({
      commentId: created.value.id,
      expectedUpdatedAt: created.value.updatedAt,
      author: created.value.author,
      anchor: shifted,
      reason: 'Stale writer must not overwrite.',
    });
    expect(staleWrite.ok).toBe(false);
    if (staleWrite.ok) throw new Error('stale write unexpectedly succeeded');
    expect(staleWrite.failure.code).toBe('conflict');
  });
});
