import type {
  ChangeContextReviewAnchorFreshness,
  ChangeContextReviewAnchorResolver,
  ChangeContextReviewCommentAnchor,
} from '@shared/types/change-context';

function unavailable(message: string, code: 'digest_missing' | 'source_unavailable'): ChangeContextReviewAnchorFreshness {
  return {
    state: 'unavailable',
    fileDigestState: 'missing',
    rangeDigestState: 'missing',
    issues: [{ code, message, source: 'review-store' }],
  };
}

/**
 * Compare a stored anchor against a source snapshot without ever moving it.
 * Exact file+range matches are live. A missing proof is unavailable, a same-file
 * changed range is stale, and a missing anchored file/range is removed.
 */
export async function projectReviewAnchorRangeFreshness(
  anchor: ChangeContextReviewCommentAnchor,
  resolveRevision: ChangeContextReviewAnchorResolver,
): Promise<ChangeContextReviewAnchorFreshness> {
  if (!anchor.fileDigest || !anchor.rangeDigest) {
    return unavailable('The comment does not contain both file and range digests.', 'digest_missing');
  }

  let revision;
  try {
    revision = await resolveRevision(anchor);
  } catch (error) {
    return unavailable(error instanceof Error ? error.message : String(error), 'source_unavailable');
  }

  if (!revision) {
    return {
      state: 'removed',
      fileDigestState: 'missing',
      rangeDigestState: 'missing',
      issues: [{
        code: 'source_removed',
        message: 'The anchored file or range no longer exists; the comment was not moved or deleted.',
        source: 'review-store',
      }],
    };
  }

  if (revision.fileDigest !== anchor.fileDigest) {
    return {
      state: 'stale',
      fileDigestState: 'changed',
      rangeDigestState: 'changed',
      issues: [{
        code: 'source_stale',
        message: 'The anchored file changed; the comment was not moved.',
        source: 'review-store',
      }],
    };
  }

  if (revision.rangeDigest !== anchor.rangeDigest) {
    return {
      state: 'stale',
      fileDigestState: 'match',
      rangeDigestState: 'changed',
      issues: [{
        code: 'source_stale',
        message: 'The anchored range changed; the comment was not moved.',
        source: 'review-store',
      }],
    };
  }

  return {
    state: 'live',
    fileDigestState: 'match',
    rangeDigestState: 'match',
    issues: [],
  };
}
