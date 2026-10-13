/** #178: resolve a located ("summarize up to / from here") compaction boundary. */

/** Result of resolving a located-compaction boundary against the active branch. */
export type RangeCompactionBoundaryResolution =
  | { ok: true; keepFromEntryId: string }
  | {
      ok: false;
      reason: "boundary-not-on-branch" | "boundary-is-tail";
      boundaryParam: "fromLeafId" | "toLeafId";
      boundaryId: string;
    };

/**
 * Turn a located-compaction boundary into the entry id that starts the retained
 * (verbatim) tail.
 *
 * - `fromLeafId` keeps that entry and everything after it.
 * - `toLeafId` summarizes the head through that entry, so the retained tail
 *   starts at the next branch entry.
 *
 * An id that is not on the active branch fails closed, as does a `toLeafId`
 * that is the transcript tail (there is nothing left to keep).
 */
export function resolveRangeCompactionKeepEntry(params: {
  branchIds: string[];
  fromLeafId?: string;
  toLeafId?: string;
}): RangeCompactionBoundaryResolution {
  if (params.fromLeafId) {
    if (!params.branchIds.includes(params.fromLeafId)) {
      return {
        ok: false,
        reason: "boundary-not-on-branch",
        boundaryParam: "fromLeafId",
        boundaryId: params.fromLeafId,
      };
    }
    return { ok: true, keepFromEntryId: params.fromLeafId };
  }
  const toLeafId = params.toLeafId ?? "";
  const index = params.branchIds.indexOf(toLeafId);
  if (index < 0) {
    return {
      ok: false,
      reason: "boundary-not-on-branch",
      boundaryParam: "toLeafId",
      boundaryId: toLeafId,
    };
  }
  const nextEntryId = params.branchIds[index + 1];
  if (!nextEntryId) {
    return {
      ok: false,
      reason: "boundary-is-tail",
      boundaryParam: "toLeafId",
      boundaryId: toLeafId,
    };
  }
  return { ok: true, keepFromEntryId: nextEntryId };
}