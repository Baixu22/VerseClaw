/**
 * #178: a located compaction resolves its boundary against the active branch
 * and fails closed when the requested id is absent/off-branch or leaves
 * nothing retained.
 */
import { describe, expect, it } from "vitest";
import { resolveRangeCompactionKeepEntry } from "./sessions.compaction-range.js";

const BRANCH = ["u1", "a1", "u2", "a2"];

describe("#178 located compaction boundary", () => {
  it("keeps verbatim from the selected entry for fromLeafId", () => {
    expect(resolveRangeCompactionKeepEntry({ branchIds: BRANCH, fromLeafId: "u2" })).toEqual({
      ok: true,
      keepFromEntryId: "u2",
    });
  });

  it("retains the entry after the selected one for toLeafId", () => {
    expect(resolveRangeCompactionKeepEntry({ branchIds: BRANCH, toLeafId: "u1" })).toEqual({
      ok: true,
      keepFromEntryId: "a1",
    });
  });

  it("fails closed when fromLeafId is not on the branch", () => {
    expect(resolveRangeCompactionKeepEntry({ branchIds: BRANCH, fromLeafId: "ghost" })).toEqual({
      ok: false,
      reason: "boundary-not-on-branch",
      boundaryParam: "fromLeafId",
      boundaryId: "ghost",
    });
  });

  it("fails closed when toLeafId is not on the branch", () => {
    expect(resolveRangeCompactionKeepEntry({ branchIds: BRANCH, toLeafId: "ghost" })).toEqual({
      ok: false,
      reason: "boundary-not-on-branch",
      boundaryParam: "toLeafId",
      boundaryId: "ghost",
    });
  });

  it("fails closed when toLeafId is the transcript tail", () => {
    expect(resolveRangeCompactionKeepEntry({ branchIds: BRANCH, toLeafId: "a2" })).toEqual({
      ok: false,
      reason: "boundary-is-tail",
      boundaryParam: "toLeafId",
      boundaryId: "a2",
    });
  });
});