/**
 * VS-P3-01 patch preview / journal bridge.
 *
 * The load-bearing assertion here is negative: the pinned catalog ships its own
 * write authority (`file.apply_patch`, the direct `file.*` writers, a `tx.*`
 * frame with its own journal and trash tokens). The bridge must never reach any
 * of it, so ClawX keeps one commit/undo/stale-guard/recovery owner. The fakes
 * mirror shapes measured in `patch-preview.real.test.ts`, which is what proves
 * those shapes are right.
 */
import { createHash } from "node:crypto";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { AciExecuteOptions, AciTransport } from "./aci-client.js";
import { VerseShellAciClient } from "./aci-client.js";
import {
  buildChangeSummaryDigest,
  createVerseShellPatchPreviewTool,
  isPatchPreviewOperationAllowed,
  lookupPatchPreview,
  MAX_BASELINE_LINES,
  MAX_BASELINE_PAGES,
  PREVIEW_PATCH_TOOL_NAME,
  VerseShellPatchPreviewAdapter,
  __resetPatchPreviewStore,
} from "./patch-preview.js";
import {
  resolveVerseShellPolicyProfile,
  VERSESHELL_PATCH_PREVIEW_DENIED_OPERATIONS,
  VERSESHELL_PATCH_PREVIEW_OPERATIONS,
  VERSESHELL_PATCH_PREVIEW_PROFILE_ID,
} from "./policy-profile.js";
import type { Observation } from "../../../../shared/verseshell/types.js";

const ENABLED_FLAGS = {
  verifiedRuntime: true,
  typedAci: true,
  facade: true,
  governedExec: true,
  artifactResults: true,
  patchPreview: true,
};

function config(flags: Record<string, boolean>, killSwitch = false) {
  return {
    tools: { profile: "full" },
    runtime: { verseShellFoundation: { ...flags, killSwitch } },
  } as never;
}

function ok(op: string, data: Record<string, unknown> = {}): Observation {
  return {
    schema: "verseshell.observation/v1",
    id: `${op}-request`,
    op,
    ok: true,
    status: 'ok',
    data: data as Observation["data"],
    meta: { elapsed_ms: 1, profile: "test", token_estimate: 1 },
  };
}

function failed(op: string, code: string): Observation {
  return {
    schema: "verseshell.observation/v1",
    id: `${op}-request`,
    op,
    ok: false,
    status: 'failed',
    error: { code, message: `${op} failed`, recoverable: false },
    meta: { elapsed_ms: 1, profile: "test", token_estimate: 1 },
  };
}

type Responder = (op: string, args: Record<string, unknown>) => Observation;

function fakeClient(cwd: string, responder: Responder) {
  const calls: Array<{ op: string; args: Record<string, unknown>; options?: AciExecuteOptions }> = [];
  const transport: AciTransport = {
    key: "test-process",
    workspace: cwd,
    capabilities: ["file.read"],
    protocolVersion: "verseshell.jsonl/v1",
    catalogDigest: "sha256:test",
    request: async (op, args, options) => {
      calls.push({ op, args, ...(options ? { options } : {}) });
      return responder(op, args);
    },
  };
  return { client: new VerseShellAciClient(transport), calls };
}

function patchLines(...lines: string[]): string {
  return ["*** Begin Patch", ...lines, "*** End Patch"].join("\n");
}

/** Real-shaped digests: the binding normalizer rejects anything that is not sha256 hex. */
function hash(seed: string): string {
  return `sha256:${seed.repeat(64).slice(0, 64)}`;
}

/** The digest the runtime would actually report for a body. */
function trueHash(text: string): string {
  return `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
}

const THREE_LINES = "one\ntwo\nthree\n";

/**
 * A readable target in the measured runtime shape. The digest is the text's own,
 * because the reader proves its rebuild against it and refuses a synthetic one.
 */
function readableRepo(text: string): Responder {
  const contentHash = trueHash(text);
  const body = text.endsWith("\n") ? text.slice(0, -1) : text;
  const lines = body.split("\n").map((line, index) => ({ line: index + 1, text: line }));
  return (op) => {
    if (op === "file.hash") return ok("file.hash", { content_hash: contentHash });
    if (op === "file.read_range") {
      return ok("file.read_range", {
        lines,
        content_hash: contentHash,
        total_lines: lines.length,
        truncated: false,
      });
    }
    // The runtime reports its own whole-file digest here too; agreeing with
    // file.hash is what says the target did not move mid-preview.
    if (op === "file.diff") return ok("file.diff", { diff: ["-two", "+TWO"], content_hash: contentHash });
    return ok(op);
  };
}

describe("VerseShell patch preview: no second write authority", () => {
  it("keeps every mutation and transaction operation outside the reviewed profile", () => {
    const profile = resolveVerseShellPolicyProfile(VERSESHELL_PATCH_PREVIEW_PROFILE_ID);
    expect(VERSESHELL_PATCH_PREVIEW_OPERATIONS).toEqual(["file.diff", "file.hash", "file.read_range"]);
    expect(profile.capabilities).toEqual(["file.read"]);
    for (const op of [
      "file.apply_patch", "file.edit_range", "file.remove", "file.replace_exact", "file.write",
      "tx.begin", "tx.commit", "tx.rollback", "tx.restore", "tx.savepoint", "tx.status",
    ]) {
      expect(VERSESHELL_PATCH_PREVIEW_DENIED_OPERATIONS).toContain(op);
      expect(isPatchPreviewOperationAllowed(op)).toBe(false);
    }
    for (const op of VERSESHELL_PATCH_PREVIEW_OPERATIONS) {
      expect(isPatchPreviewOperationAllowed(op)).toBe(true);
    }
    // exec.run is a real catalog operation, and it is still outside this profile.
    expect(isPatchPreviewOperationAllowed("exec.run")).toBe(false);
  });

  it("requests only read operations while previewing a real update patch", async () => {
    const cwd = process.cwd();
    const fake = fakeClient(cwd, readableRepo("one\ntwo\nthree\n"));
    const adapter = new VerseShellPatchPreviewAdapter({ cwd, revision: "rev-a", client: fake.client });

    const preview = await adapter.preview({
      patch: patchLines("*** Update File: f.txt", "@@", " one", "-two", "+TWO", " three"),
    });

    expect(fake.calls.map((call) => call.op)).toEqual([
      "file.hash",
      "file.read_range",
      "file.diff",
    ]);
    expect(fake.calls.every((call) => call.options?.effectful === false)).toBe(true);
    expect(preview.commitAuthority).toBe("clawx-write-journal");
    expect(preview.verseShellTransaction).toBe("denied");
    expect(preview.summary).toEqual({ added: [], modified: ["f.txt"], deleted: [] });
  });
});

describe("VerseShell patch preview: preconditions and diffs", () => {
  it("carries the base hash and the diff for an update", async () => {
    const cwd = process.cwd();
    const fake = fakeClient(cwd, readableRepo(THREE_LINES));
    const adapter = new VerseShellPatchPreviewAdapter({ cwd, client: fake.client });

    const preview = await adapter.preview({
      patch: patchLines("*** Update File: f.txt", "@@", " one", "-two", "+TWO", " three"),
    });

    expect(preview.preconditions).toEqual([
      {
        path: "f.txt",
        change: "update",
        exists: true,
        baseHash: trueHash(THREE_LINES),
        baselineTruncated: false,
      },
    ]);
    // Rendered host-side from the proven baseline and the bound post-image, so it
    // shows the whole change rather than the runtime's 200-line prefix of one.
    expect(preview.diffs).toHaveLength(1);
    expect(preview.diffs[0]).toMatchObject({ path: "f.txt", truncated: false });
    expect(preview.diffs[0]?.unified).toContain("-two");
    expect(preview.diffs[0]?.unified).toContain("+TWO");
    expect(preview.diffs[0]?.unified).toContain(" three");
    // The post-image handed to file.diff is the ClawX-computed one, not VerseShell's.
    expect(fake.calls.at(-1)?.args).toEqual({ path: "f.txt", new_text: "one\nTWO\nthree\n" });
    expect(preview.revision).toBe("untracked");
    expect(preview.policyProfile).toBe(VERSESHELL_PATCH_PREVIEW_PROFILE_ID);
    expect(preview.policyDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });

  it("renders an added file without asking VerseShell to diff a missing path", async () => {
    const cwd = process.cwd();
    const fake = fakeClient(cwd, (op) =>
      op === "file.hash" ? failed("file.hash", "E_NOT_FOUND") : ok(op),
    );
    const adapter = new VerseShellPatchPreviewAdapter({ cwd, client: fake.client });

    const preview = await adapter.preview({
      patch: patchLines("*** Add File: new.txt", "+hello", "+world"),
    });

    expect(fake.calls.map((call) => call.op)).toEqual(["file.hash"]);
    expect(preview.preconditions[0]).toEqual({
      path: "new.txt",
      change: "add",
      exists: false,
      baseHash: null,
      baselineTruncated: false,
    });
    expect(preview.diffs[0]?.unified).toBe(
      "--- /dev/null\n+++ b/new.txt\n@@ -0,0 +1,2 @@\n+hello\n+world",
    );
    expect(preview.summary).toEqual({ added: ["new.txt"], modified: [], deleted: [] });
  });
});

describe("VerseShell patch preview: conflicts and honest bounds", () => {
  it("flags an add over an existing path and a delete of a missing path", async () => {
    const cwd = process.cwd();
    const present = fakeClient(cwd, (op) =>
      op === "file.hash" ? ok("file.hash", { content_hash: hash("11ee") }) : ok(op, { diff: "d" }),
    );
    const addOver = await new VerseShellPatchPreviewAdapter({
      cwd,
      client: present.client,
    }).preview({ patch: patchLines("*** Add File: taken.txt", "+x") });
    expect(addOver.preconditions[0]?.conflict).toBe("add-over-existing");
    expect(addOver.preconditions[0]?.baseHash).toBe(hash("11ee"));

    const missing = fakeClient(cwd, (op) =>
      op === "file.hash" ? failed("file.hash", "E_NOT_FOUND") : ok(op),
    );
    const deleteMissing = await new VerseShellPatchPreviewAdapter({
      cwd,
      client: missing.client,
    }).preview({ patch: patchLines("*** Delete File: gone.txt") });
    expect(deleteMissing.preconditions[0]).toMatchObject({
      change: "delete",
      exists: false,
      conflict: "missing-target",
    });
    // Nothing to show and nothing clipped: deleting a path that was never there
    // is fully described by the conflict, so the empty diff is not a truncation.
    expect(deleteMissing.diffs[0]).toEqual({ path: "gone.txt", unified: "", truncated: false });
    expect(deleteMissing.summary.deleted).toEqual(["gone.txt"]);
  });

  it("refuses to build a post-image from a baseline past the paged-read cap", async () => {
    const cwd = process.cwd();
    const fake = fakeClient(cwd, (op) => {
      if (op === "file.hash") return ok("file.hash", { content_hash: hash("b16") });
      if (op === "file.read_range") {
        return ok("file.read_range", {
          lines: [{ line: 1, text: "one" }],
          content_hash: hash("b16"),
          total_lines: MAX_BASELINE_LINES * MAX_BASELINE_PAGES + 1,
          truncated: false,
        });
      }
      return ok(op, { diff: "should-not-be-used" });
    });
    const preview = await new VerseShellPatchPreviewAdapter({
      cwd,
      client: fake.client,
    }).preview({ patch: patchLines("*** Update File: big.txt", "@@", "-two", "+TWO") });

    // One probe read, then it stops: past the page budget there is no prefix worth
    // reading, so it does not walk 40 windows only to refuse at the end.
    expect(fake.calls.map((call) => call.op)).toEqual(["file.hash", "file.read_range"]);
    expect(preview.preconditions[0]).toMatchObject({
      baselineTruncated: true,
      baselineReason: "over-cap",
      conflict: "baseline-unreadable",
      baseHash: hash("b16"),
    });
    expect(preview.diffs[0]).toEqual({ path: "big.txt", unified: "", truncated: true });
  });

  it("surfaces a non-not-found hash failure instead of reading it as absent", async () => {
    const cwd = process.cwd();
    const fake = fakeClient(cwd, () => failed("file.hash", "E_OUTSIDE_WORKSPACE"));
    await expect(
      new VerseShellPatchPreviewAdapter({ cwd, client: fake.client }).preview({
        patch: patchLines("*** Update File: f.txt", "@@", "-a", "+b"),
      }),
    ).rejects.toThrow(/E_OUTSIDE_WORKSPACE/u);
  });
});

describe("VerseShell patch preview: input and identity bounds", () => {
  it("rejects traversal, absolute paths and oversized patches", async () => {
    const cwd = process.cwd();
    const fake = fakeClient(cwd, readableRepo("a\n"));
    const adapter = new VerseShellPatchPreviewAdapter({ cwd, client: fake.client });

    await expect(
      adapter.preview({ patch: patchLines("*** Add File: ../escape.txt", "+x") }),
    ).rejects.toThrow(/workspace/u);
    await expect(
      adapter.preview({
        patch: patchLines(`*** Add File: ${path.resolve(cwd, "abs.txt")}`, "+x"),
      }),
    ).rejects.toThrow(/relative/u);
    await expect(adapter.preview({ patch: "   " })).rejects.toThrow(/patch is required/u);
    await expect(
      adapter.preview({ patch: patchLines("*** Add File: big.txt", `+${"x".repeat(600_000)}`) }),
    ).rejects.toThrow(/bounded/u);
  });

  it("binds the change summary digest to the pre and post identity of every target", () => {
    const base = [
      { path: "a.txt", change: "update" as const, baseHash: hash("1a"), postHash: hash("2b") },
      { path: "b.txt", change: "add" as const, baseHash: null, postHash: hash("3c") },
    ];
    const reordered = [base[1]!, base[0]!];
    expect(buildChangeSummaryDigest(base)).toBe(buildChangeSummaryDigest(reordered));
    expect(buildChangeSummaryDigest(base)).toMatch(/^sha256:[a-f0-9]{64}$/u);
    // A different post-image is a different preview: the journal must refuse it.
    expect(
      buildChangeSummaryDigest([{ ...base[0]!, postHash: hash("9d") }, base[1]!]),
    ).not.toBe(buildChangeSummaryDigest(base));
    // So is a different baseline for the same result — that is the stale-write guard.
    expect(
      buildChangeSummaryDigest([{ ...base[0]!, baseHash: hash("8e") }, base[1]!]),
    ).not.toBe(buildChangeSummaryDigest(base));
  });
});

describe("VerseShell patch preview: hand-off to the write journal", () => {
  it("registers a commit-eligible preview the journal can later verify", async () => {
    __resetPatchPreviewStore();
    const cwd = process.cwd();
    const fake = fakeClient(cwd, readableRepo(THREE_LINES));
    const preview = await new VerseShellPatchPreviewAdapter({
      cwd,
      revision: "rev-a",
      client: fake.client,
    }).preview({
      patch: patchLines("*** Update File: f.txt", "@@", " one", "-two", "+TWO", " three"),
    });

    expect(preview.commitEligible).toBe(true);
    const stored = lookupPatchPreview(preview.previewId);
    expect(stored).toMatchObject({
      previewId: preview.previewId,
      changeSummaryDigest: preview.changeSummaryDigest,
      workspaceId: preview.workspaceId,
      revision: "rev-a",
      policyProfile: VERSESHELL_PATCH_PREVIEW_PROFILE_ID,
      commitEligible: true,
      paths: ["f.txt"],
    });
  });

  it("registers a conflicted or truncated preview as not commit-eligible", async () => {
    __resetPatchPreviewStore();
    const cwd = process.cwd();
    const truncated = fakeClient(cwd, (op) => {
      if (op === "file.hash") return ok("file.hash", { content_hash: hash("b16") });
      if (op === "file.read_range") {
        return ok("file.read_range", {
          lines: [{ line: 1, text: "one" }],
          content_hash: hash("b16"),
          total_lines: MAX_BASELINE_LINES * MAX_BASELINE_PAGES + 1,
          truncated: false,
        });
      }
      return ok(op, { diff: "d" });
    });
    const overCap = await new VerseShellPatchPreviewAdapter({
      cwd,
      client: truncated.client,
    }).preview({ patch: patchLines("*** Update File: big.txt", "@@", "-two", "+TWO") });
    expect(overCap.commitEligible).toBe(false);
    expect(lookupPatchPreview(overCap.previewId)?.commitEligible).toBe(false);

    const occupied = fakeClient(cwd, (op) =>
      op === "file.hash" ? ok("file.hash", { content_hash: hash("11ee") }) : ok(op, { diff: "d" }),
    );
    const addOver = await new VerseShellPatchPreviewAdapter({
      cwd,
      client: occupied.client,
    }).preview({ patch: patchLines("*** Add File: taken.txt", "+x") });
    expect(addOver.commitEligible).toBe(false);
    expect(lookupPatchPreview(addOver.previewId)?.commitEligible).toBe(false);
  });
});

describe("VerseShell patch preview: batch sequencing", () => {
  it("feeds a second hunk on the same path the first hunk's result", async () => {
    const cwd = process.cwd();
    const fake = fakeClient(cwd, readableRepo("one\ntwo\nthree\n"));
    const preview = await new VerseShellPatchPreviewAdapter({
      cwd,
      client: fake.client,
    }).preview({
      patch: patchLines(
        "*** Update File: f.txt",
        "@@",
        "-two",
        "+TWO",
        "*** Update File: f.txt",
        "@@",
        "-three",
        "+THREE",
      ),
    });

    // The baseline is read once per path, not once per hunk, and the single diff
    // carries the cumulative post-image — the same result precomputeHunks reaches.
    expect(fake.calls.map((call) => call.op)).toEqual([
      "file.hash",
      "file.read_range",
      "file.diff",
    ]);
    expect(fake.calls.at(-1)?.args).toEqual({
      path: "f.txt",
      new_text: "one\nTWO\nTHREE\n",
    });
    expect(preview.diffs).toHaveLength(1);
    // Both hunks bind against the same pre-batch identity, and each carries its
    // own post-image, so a drift in either one invalidates the preview.
    expect(preview.preconditions).toHaveLength(2);
    expect(preview.preconditions.every((entry) => entry.baseHash === trueHash(THREE_LINES))).toBe(
      true,
    );
    expect(preview.commitEligible).toBe(true);
  });

  it("does not flag an add over a path the same batch already deleted", async () => {
    const cwd = process.cwd();
    const fake = fakeClient(cwd, readableRepo("gone\n"));
    const preview = await new VerseShellPatchPreviewAdapter({
      cwd,
      client: fake.client,
    }).preview({
      patch: patchLines("*** Delete File: f.txt", "*** Add File: f.txt", "+fresh"),
    });

    expect(preview.preconditions.map((entry) => entry.conflict)).toEqual([undefined, undefined]);
    expect(preview.summary).toEqual({
      added: ["f.txt"],
      modified: [],
      deleted: ["f.txt"],
    });
    expect(preview.commitEligible).toBe(true);
  });
});

describe("VerseShell patch preview: default-off tool surface", () => {
  const cwd = process.cwd();

  it("stays absent with no flags, without patchPreview, and under the kill switch", () => {
    expect(createVerseShellPatchPreviewTool({ cwd, config: config({}) })).toBeNull();
    const { patchPreview: _omitted, ...withoutPreview } = ENABLED_FLAGS;
    expect(createVerseShellPatchPreviewTool({ cwd, config: config(withoutPreview) })).toBeNull();
    expect(
      createVerseShellPatchPreviewTool({ cwd, config: config(ENABLED_FLAGS, true) }),
    ).toBeNull();
    for (const flag of Object.keys(ENABLED_FLAGS)) {
      expect(
        createVerseShellPatchPreviewTool({
          cwd,
          config: config({ ...ENABLED_FLAGS, [flag]: false }),
        }),
      ).toBeNull();
    }
  });

  it("materializes one read-only tool when every gate is ready", () => {
    const tool = createVerseShellPatchPreviewTool({ cwd, config: config(ENABLED_FLAGS) });
    expect(tool).not.toBeNull();
    expect(tool?.name).toBe(PREVIEW_PATCH_TOOL_NAME);
    expect(tool?.risk).toBe("readonly");
    expect(tool?.description).toMatch(/write journal/u);
  });
});
