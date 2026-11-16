/**
 * VS-P3-01 slice 2: the commit gate that binds a read-only preview to the one
 * write journal allowed to mutate.
 *
 * The load-bearing assertions are the refusals: a preview that no longer matches
 * the workspace must stop the commit *before* the first write, leaving the target
 * byte-identical. Reconciling instead of refusing is the defect this exists for.
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyPatch } from "./apply-patch.js";
import {
  journalDirFor,
  listJournalSnapshotFiles,
  listPreparedWriteJournalEntries,
  undoLastWrites,
  __resetWriteJournals,
} from "./tools/write-journal.js";
import {
  buildChangeSummaryDigest,
  canonicalPreviewPath,
  lookupPatchPreview,
  normalizeContentHash,
  normalizeDiffArtifacts,
  registerPatchPreview,
  StalePatchPreviewError,
  UnknownPatchPreviewError,
  verifyPatchPreviewBinding,
  __resetPatchPreviewStore,
  type ChangeSummaryEntry,
  type PatchPreviewRecord,
} from "./apply-patch-preview-binding.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "clawx-preview-binding-"));
  __resetPatchPreviewStore();
  __resetWriteJournals();
});

afterEach(async () => {
  __resetPatchPreviewStore();
  __resetWriteJournals();
  await rm(dir, { recursive: true, force: true });
});

function patchLines(...lines: string[]): string {
  return ["*** Begin Patch", ...lines, "*** End Patch"].join("\n");
}

function record(overrides: Partial<PatchPreviewRecord> = {}): PatchPreviewRecord {
  return {
    previewId: "vsp_test",
    changeSummaryDigest: `sha256:${"0".repeat(64)}`,
    workspaceId: "ws_sha256_test",
    revision: "untracked",
    policyProfile: "clawx-patch-preview-v1",
    policyDigest: `sha256:${"1".repeat(64)}`,
    commitEligible: true,
    paths: ["f.txt"],
    createdAtMs: 0,
    ...overrides,
  };
}

describe("change summary digest", () => {
  const base: ChangeSummaryEntry[] = [
    { path: "a.txt", change: "update", baseHash: "sha256:" + "a".repeat(64), postHash: "sha256:" + "b".repeat(64) },
    { path: "b.txt", change: "add", baseHash: null, postHash: "sha256:" + "c".repeat(64) },
  ];

  it("normalizes hash spelling and path separators before hashing", () => {
    expect(normalizeContentHash("A".repeat(64))).toBe(`sha256:${"a".repeat(64)}`);
    expect(normalizeContentHash(`sha256:${"a".repeat(64)}`)).toBe(`sha256:${"a".repeat(64)}`);
    expect(normalizeContentHash("not-a-hash")).toBeNull();
    expect(normalizeContentHash(undefined)).toBeNull();
    expect(canonicalPreviewPath("src\\agents\\f.txt")).toBe("src/agents/f.txt");

    // The two readers spell the same identity differently; the digest must not care.
    const posix = buildChangeSummaryDigest([
      { path: "src/f.txt", change: "add", baseHash: null, postHash: "c".repeat(64) },
    ]);
    const windows = buildChangeSummaryDigest([
      { path: "src\\f.txt", change: "add", baseHash: null, postHash: `sha256:${"C".repeat(64)}` },
    ]);
    expect(posix).toBe(windows);
  });

  it("is order independent and sensitive to every identity field", () => {
    expect(buildChangeSummaryDigest(base)).toBe(buildChangeSummaryDigest([base[1]!, base[0]!]));
    expect(buildChangeSummaryDigest(base)).toMatch(/^sha256:[a-f0-9]{64}$/u);
    for (const mutated of [
      { ...base[0]!, postHash: "sha256:" + "9".repeat(64) },
      { ...base[0]!, baseHash: "sha256:" + "8".repeat(64) },
      { ...base[0]!, change: "delete" as const },
      { ...base[0]!, path: "a2.txt" },
      { ...base[0]!, movePath: "moved.txt" },
    ]) {
      expect(buildChangeSummaryDigest([mutated, base[1]!])).not.toBe(
        buildChangeSummaryDigest(base),
      );
    }
  });

  it("cannot be collided by shifting characters between fields", () => {
    // Length-prefixed fields are why this holds: a path that swallows the next
    // field's text produces a different canonical form, not the same one.
    const a = buildChangeSummaryDigest([
      { path: "a", change: "add", baseHash: null, postHash: null, movePath: "bc" },
    ]);
    const b = buildChangeSummaryDigest([
      { path: "ab", change: "add", baseHash: null, postHash: null, movePath: "c" },
    ]);
    expect(a).not.toBe(b);
  });
});

describe("preview store and commit gate", () => {
  const entries: ChangeSummaryEntry[] = [
    { path: "f.txt", change: "update", baseHash: "a".repeat(64), postHash: "b".repeat(64) },
  ];

  it("keeps the store bounded and lets a re-preview replace its predecessor", () => {
    for (let i = 0; i < 40; i += 1) {
      registerPatchPreview(record({ previewId: `vsp_${i}`, createdAtMs: i }));
    }
    expect(lookupPatchPreview("vsp_0")).toBeUndefined();
    expect(lookupPatchPreview("vsp_39")).toBeDefined();

    registerPatchPreview(record({ previewId: "vsp_39", revision: "rev-b" }));
    expect(lookupPatchPreview("vsp_39")?.revision).toBe("rev-b");
  });

  it("refuses an unknown id, an ineligible preview, and a drifted digest", () => {
    expect(() => verifyPatchPreviewBinding({ previewId: "vsp_missing", entries })).toThrow(
      UnknownPatchPreviewError,
    );

    registerPatchPreview(
      record({
        previewId: "vsp_conflicted",
        commitEligible: false,
        changeSummaryDigest: buildChangeSummaryDigest(entries),
      }),
    );
    expect(() =>
      verifyPatchPreviewBinding({ previewId: "vsp_conflicted", entries }),
    ).toThrow(/conflict or an unreadable baseline/u);

    registerPatchPreview(
      record({ previewId: "vsp_drift", changeSummaryDigest: `sha256:${"f".repeat(64)}` }),
    );
    expect(() => verifyPatchPreviewBinding({ previewId: "vsp_drift", entries })).toThrow(
      StalePatchPreviewError,
    );
  });

  it("accepts a matching preview and returns the verified binding", () => {
    const changeSummaryDigest = buildChangeSummaryDigest(entries);
    registerPatchPreview(record({ previewId: "vsp_ok", changeSummaryDigest }));
    expect(verifyPatchPreviewBinding({ previewId: " vsp_ok ", entries })).toEqual({
      previewId: "vsp_ok",
      changeSummaryDigest,
    });
  });
});

/**
 * Obtain the digest apply_patch itself computes, without reimplementing the
 * derivation in the test: run once with a deliberately wrong expectation and read
 * the recomputed value off the refusal. The refused run writes nothing, so the
 * workspace is still in its pre-patch state for the real attempt.
 */
async function digestFromRefusal(patch: string): Promise<string> {
  registerPatchPreview(record({ previewId: "vsp_probe", changeSummaryDigest: `sha256:${"e".repeat(64)}` }));
  try {
    await applyPatch(patch, { cwd: dir, previewId: "vsp_probe" });
  } catch (error) {
    if (error instanceof StalePatchPreviewError) return error.actualDigest;
    throw error;
  }
  throw new Error("expected the probe preview to be refused");
}

describe("apply_patch honors the preview binding end to end", () => {
  it("commits a verified preview and records it as journal provenance", async () => {
    await writeFile(join(dir, "f.txt"), "one\ntwo\nthree\n", "utf-8");
    const patch = patchLines("*** Update File: f.txt", "@@", " one", "-two", "+TWO", " three");
    const changeSummaryDigest = await digestFromRefusal(patch);
    expect(await readFile(join(dir, "f.txt"), "utf-8")).toBe("one\ntwo\nthree\n");

    registerPatchPreview(record({ previewId: "vsp_live", changeSummaryDigest }));
    const result = await applyPatch(patch, {
      cwd: dir,
      previewId: "vsp_live",
      journal: { workspaceRoot: dir, sessionId: "vsp", requestId: "batch-1", enabled: true },
    });

    expect(result.batchState).toBe("committed");
    expect(await readFile(join(dir, "f.txt"), "utf-8")).toBe("one\nTWO\nthree\n");
    expect(result.journal?.preview).toEqual({ previewId: "vsp_live", changeSummaryDigest });
  });

  it("refuses and writes nothing when the target moved after the preview", async () => {
    await writeFile(join(dir, "f.txt"), "one\ntwo\nthree\n", "utf-8");
    const patch = patchLines("*** Update File: f.txt", "@@", " one", "-two", "+TWO", " three");
    const changeSummaryDigest = await digestFromRefusal(patch);

    // Someone else edits the file between the preview and the commit.
    await writeFile(join(dir, "f.txt"), "zero\none\ntwo\nthree\n", "utf-8");
    registerPatchPreview(record({ previewId: "vsp_moved", changeSummaryDigest }));

    await expect(
      applyPatch(patch, { cwd: dir, previewId: "vsp_moved" }),
    ).rejects.toThrow(StalePatchPreviewError);
    expect(await readFile(join(dir, "f.txt"), "utf-8")).toBe("zero\none\ntwo\nthree\n");
  });

  it("refuses an unknown preview id rather than applying unverified", async () => {
    await writeFile(join(dir, "f.txt"), "a\n", "utf-8");
    await expect(
      applyPatch(patchLines("*** Update File: f.txt", "@@", "-a", "+A"), {
        cwd: dir,
        previewId: "vsp_never_taken",
      }),
    ).rejects.toThrow(UnknownPatchPreviewError);
    expect(await readFile(join(dir, "f.txt"), "utf-8")).toBe("a\n");
  });

  it("applies unchanged when no preview id is supplied", async () => {
    await writeFile(join(dir, "f.txt"), "a\n", "utf-8");
    const result = await applyPatch(patchLines("*** Update File: f.txt", "@@", "-a", "+A"), {
      cwd: dir,
    });
    expect(result.batchState).toBe("committed");
    expect(result.journal?.preview).toBeUndefined();
    expect(await readFile(join(dir, "f.txt"), "utf-8")).toBe("A\n");
  });

  it("covers add and delete identity, including a post-preview creation race", async () => {
    const addPatch = patchLines("*** Add File: new.txt", "+hello");
    const addDigest = await digestFromRefusal(addPatch);
    registerPatchPreview(record({ previewId: "vsp_add", changeSummaryDigest: addDigest }));
    await applyPatch(addPatch, { cwd: dir, previewId: "vsp_add" });
    expect(await readFile(join(dir, "new.txt"), "utf-8")).toBe("hello\n");

    await writeFile(join(dir, "gone.txt"), "bye\n", "utf-8");
    const deletePatch = patchLines("*** Delete File: gone.txt");
    const deleteDigest = await digestFromRefusal(deletePatch);
    // The file changes after the preview: the delete must be refused, not guessed.
    await writeFile(join(dir, "gone.txt"), "bye and also this\n", "utf-8");
    registerPatchPreview(record({ previewId: "vsp_del", changeSummaryDigest: deleteDigest }));
    await expect(
      applyPatch(deletePatch, { cwd: dir, previewId: "vsp_del" }),
    ).rejects.toThrow(StalePatchPreviewError);
    expect(await readFile(join(dir, "gone.txt"), "utf-8")).toBe("bye and also this\n");
  });
});

describe("diff artifact association (AC-3)", () => {
  it("keeps only well-formed handles, deduplicated, ordered and counted", () => {
    expect(
      normalizeDiffArtifacts([
        "result://b",
        "result://a",
        "result://b",
        "  result://c  ",
        "",
        "   ",
        undefined,
        42,
        `result://${"x".repeat(300)}`,
        "result://nul\0",
      ]),
    ).toEqual(["result://a", "result://b", "result://c"]);
    // The count is capped, so a runtime cannot pad an unbounded field.
    expect(
      normalizeDiffArtifacts(Array.from({ length: 200 }, (_, i) => `result://${i}`)),
    ).toHaveLength(64);
  });

  it("returns the stored handles, which the caller has no way to supply", async () => {
    const entries: ChangeSummaryEntry[] = [
      { path: "f.txt", change: "update", baseHash: `sha256:${"a".repeat(64)}`, postHash: null },
    ];
    const changeSummaryDigest = buildChangeSummaryDigest(entries);
    registerPatchPreview(
      record({
        previewId: "vsp_art",
        changeSummaryDigest,
        diffArtifacts: [`result://sha256/${"1".repeat(64)}`, `result://sha256/${"2".repeat(64)}`],
      }),
    );
    // verifyPatchPreviewBinding takes only an id and the entries the write path
    // itself computed — there is no parameter through which a caller could name a
    // diff nobody rendered.
    expect(verifyPatchPreviewBinding({ previewId: "vsp_art", entries })).toEqual({
      previewId: "vsp_art",
      changeSummaryDigest,
      diffArtifacts: [`result://sha256/${"1".repeat(64)}`, `result://sha256/${"2".repeat(64)}`],
    });

    // Re-previewing replaces the record, and the gate follows the new one.
    registerPatchPreview(
      record({ previewId: "vsp_art", changeSummaryDigest, diffArtifacts: [`result://sha256/${"3".repeat(64)}`] }),
    );
    expect(
      verifyPatchPreviewBinding({ previewId: "vsp_art", entries }).diffArtifacts,
    ).toEqual([`result://sha256/${"3".repeat(64)}`]);

    // A preview with no artifacts reports none rather than an empty array.
    registerPatchPreview(record({ previewId: "vsp_bare", changeSummaryDigest }));
    expect(verifyPatchPreviewBinding({ previewId: "vsp_bare", entries })).not.toHaveProperty(
      "diffArtifacts",
    );
  });

  it("carries the handles through a real commit into the journal evidence", async () => {
    await writeFile(join(dir, "f.txt"), "one\ntwo\nthree\n", "utf-8");
    const patch = patchLines("*** Update File: f.txt", "@@", " one", "-two", "+TWO", " three");
    const changeSummaryDigest = await digestFromRefusal(patch);
    registerPatchPreview(
      record({
        previewId: "vsp_e2e",
        changeSummaryDigest,
        diffArtifacts: [`result://sha256/${"f".repeat(64)}`],
      }),
    );

    const result = await applyPatch(patch, {
      cwd: dir,
      previewId: "vsp_e2e",
      journal: { workspaceRoot: dir, sessionId: "vsp", requestId: "batch-art", enabled: true },
    });

    expect(result.batchState).toBe("committed");
    // approval id, change summary digest and the diffs it stands for, on one record.
    expect(result.journal?.preview).toEqual({
      previewId: "vsp_e2e",
      changeSummaryDigest,
      diffArtifacts: [`result://sha256/${"f".repeat(64)}`],
    });
  });
});

describe("abort of a previewed commit (AC-1)", () => {
  it("leaves the workspace byte-identical and no prepared batch behind", async () => {
    await writeFile(join(dir, "f.txt"), "one\ntwo\nthree\n", "utf-8");
    const patch = patchLines("*** Update File: f.txt", "@@", " one", "-two", "+TWO", " three");
    const changeSummaryDigest = await digestFromRefusal(patch);
    registerPatchPreview(record({ previewId: "vsp_abort", changeSummaryDigest }));

    const controller = new AbortController();
    controller.abort();
    // An abort propagates rather than being reported as a batch outcome: the caller
    // asked to stop, which is not a finding about the patch.
    await expect(
      applyPatch(patch, {
        cwd: dir,
        previewId: "vsp_abort",
        signal: controller.signal,
        journal: {
          workspaceRoot: dir,
          sessionId: "abort-sess",
          requestId: "batch-abort",
          enabled: true,
        },
      }),
    ).rejects.toThrow(/abort/iu);

    expect(await readFile(join(dir, "f.txt"), "utf-8")).toBe("one\ntwo\nthree\n");
    // The prepared snapshots are discarded rather than left dangling: a stuck
    // prepared batch would block every later patch on this path.
    expect(listPreparedWriteJournalEntries(dir, "abort-sess")).toEqual([]);
  });
});

describe("undo of a previewed commit (AC-1)", () => {
  /**
   * AC-3 rests on this: with no artifact handle from the runtime, "the diff a
   * reviewer saw" is recoverable only because the write journal keeps the
   * pre-image of a *committed* batch on disk. Post-image is the working tree and
   * the generator is `generateUnifiedPatch`, so the diff can be re-derived at any
   * time — but only while the snapshot survives the commit. If cleanup ever moves
   * to committed batches too, that argument silently collapses, so it is asserted
   * rather than assumed.
   */
  it("keeps the committed pre-image on disk, so the reviewed diff stays derivable", async () => {
    await writeFile(join(dir, "f.txt"), "one\ntwo\nthree\n", "utf-8");
    const patch = patchLines("*** Update File: f.txt", "@@", " one", "-two", "+TWO", " three");
    const changeSummaryDigest = await digestFromRefusal(patch);
    registerPatchPreview(record({ previewId: "vsp_keep", changeSummaryDigest }));

    const result = await applyPatch(patch, {
      cwd: dir,
      previewId: "vsp_keep",
      journal: { workspaceRoot: dir, sessionId: "keep-sess", requestId: "batch-keep", enabled: true },
    });
    expect(result.batchState).toBe("committed");

    const snapshots = listJournalSnapshotFiles(dir, "keep-sess");
    expect(snapshots).toHaveLength(1);
    const preImage = await readFile(join(journalDirFor(dir, "keep-sess"), snapshots[0]!), "utf-8");
    expect(preImage).toBe("one\ntwo\nthree\n");
    // Pre-image on disk plus post-image in the tree is the whole diff input.
    expect(await readFile(join(dir, "f.txt"), "utf-8")).toBe("one\nTWO\nthree\n");
  });

  it("restores the pre-commit content through the one journal that committed it", async () => {
    await writeFile(join(dir, "f.txt"), "one\ntwo\nthree\n", "utf-8");
    const patch = patchLines("*** Update File: f.txt", "@@", " one", "-two", "+TWO", " three");
    const changeSummaryDigest = await digestFromRefusal(patch);
    registerPatchPreview(record({ previewId: "vsp_undo", changeSummaryDigest }));

    const result = await applyPatch(patch, {
      cwd: dir,
      previewId: "vsp_undo",
      journal: { workspaceRoot: dir, sessionId: "undo-sess", requestId: "batch-undo", enabled: true },
    });
    expect(result.batchState).toBe("committed");
    expect(result.journal?.undoable).toBe(true);
    expect(await readFile(join(dir, "f.txt"), "utf-8")).toBe("one\nTWO\nthree\n");

    const undone = await undoLastWrites({ workspaceRoot: dir, sessionId: "undo-sess" });
    expect(undone.errors).toEqual([]);
    expect(undone.restored).toHaveLength(1);
    // Undo is the write journal's, not the preview's: the preview never had a
    // rollback path to compete with.
    expect(await readFile(join(dir, "f.txt"), "utf-8")).toBe("one\ntwo\nthree\n");
  });
});
