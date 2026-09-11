/**
 * VS-P3-01 AC-3: the diff artifacts a preview stands for.
 *
 * The acceptance criterion is an association, not a rendering: one approval id,
 * one change summary digest and the diffs a reviewer would actually have looked
 * at have to end up on the same record. This file covers the producing half —
 * that the handles the runtime reported are stored on the preview the commit gate
 * will later read. The consuming half (gate → journal evidence → effect receipt)
 * is covered in `apply-patch-preview-binding.test.ts` and
 * `apply-patch-effect-receipt.test.ts`.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { AciTransport } from "./aci-client.js";
import { VerseShellAciClient } from "./aci-client.js";
import {
  lookupPatchPreview,
  VerseShellPatchPreviewAdapter,
  __resetPatchPreviewStore,
} from "./patch-preview.js";
import type { Observation } from "../../../../shared/verseshell/types.js";

function ok(op: string, data: Record<string, unknown> = {}): Observation {
  return {
    schema: "verseshell.observation/v1",
    id: `${op}-request`,
    op,
    ok: true,
    data: data as Observation["data"],
    meta: { elapsed_ms: 1, profile: "test", token_estimate: 1 },
  };
}

type Responder = (op: string, args: Record<string, unknown>) => Observation;

function fakeClient(cwd: string, responder: Responder) {
  const transport: AciTransport = {
    key: "test-process",
    workspace: cwd,
    capabilities: ["file.read"],
    protocolVersion: "verseshell.jsonl/v1",
    catalogDigest: "sha256:test",
    request: async (op, args) => responder(op, args),
  };
  return new VerseShellAciClient(transport);
}

function patchLines(...lines: string[]): string {
  return ["*** Begin Patch", ...lines, "*** End Patch"].join("\n");
}

function _hash(seed: string): string {
  return `sha256:${seed.repeat(64).slice(0, 64)}`;
}

/** The digest the runtime would actually report for a body. */
function trueHash(text: string): string {
  return `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
}

const BODY = "one\ntwo\n";

/** The runtime contract validates handles as result://sha256/<64 lowercase hex>. */
function artifactHandle(seed: string): string {
  return `result://sha256/${seed.repeat(64).slice(0, 64)}`;
}

/**
 * Note on the handles below: the pinned runtime's `file.diff` does not currently
 * report one at any diff size, so no preview against it stores artifacts today —
 * `patch-preview.real.test.ts` is what asserts the live behaviour. These cases
 * cover the association machinery itself, which is kept so that a runtime that
 * does emit handles is wired the moment it appears. They are deliberately a
 * capability test, not a claim about what the current catalog returns.
 */
function repo(diffData: Record<string, unknown>): Responder {
  const contentHash = trueHash(BODY);
  return (op) => {
    if (op === "file.hash") return ok("file.hash", { content_hash: contentHash });
    if (op === "file.read_range") {
      return ok("file.read_range", {
        lines: [
          { line: 1, text: "one" },
          { line: 2, text: "two" },
        ],
        content_hash: contentHash,
        total_lines: 2,
        truncated: false,
      });
    }
    if (op === "file.diff") return ok("file.diff", diffData);
    return ok(op);
  };
}

const UPDATE = patchLines("*** Update File: f.txt", "@@", "-two", "+TWO");

describe("VerseShell patch preview: diff artifact association", () => {
  it("stores the handles the runtime reported on the preview record", async () => {
    __resetPatchPreviewStore();
    const cwd = process.cwd();
    const client = fakeClient(
      cwd,
      repo({ diff: "@@ -1 +1 @@", handle: artifactHandle("d") }),
    );
    const preview = await new VerseShellPatchPreviewAdapter({ cwd, client }).preview({
      patch: UPDATE,
    });

    expect(preview.diffs[0]?.artifact).toBe(artifactHandle("d"));
    // The stored record is what the commit gate reads, so the association has to
    // live here rather than only in the tool response the model saw.
    expect(lookupPatchPreview(preview.previewId)?.diffArtifacts).toEqual([artifactHandle("d")]);
  });

  it("stores no artifact list when the runtime reported no handle", async () => {
    __resetPatchPreviewStore();
    const cwd = process.cwd();
    const client = fakeClient(cwd, repo({ diff: "@@ -1 +1 @@" }));
    const preview = await new VerseShellPatchPreviewAdapter({ cwd, client }).preview({
      patch: UPDATE,
    });

    // Absent, not an empty array: "no diff was archived" and "an empty archive"
    // are different claims and the receipt must not blur them.
    expect(preview.diffs[0]).not.toHaveProperty("artifact");
    expect(lookupPatchPreview(preview.previewId)).not.toHaveProperty("diffArtifacts");
  });

  it("deduplicates one handle reported for several paths", async () => {
    __resetPatchPreviewStore();
    const cwd = process.cwd();
    const client = fakeClient(
      cwd,
      repo({ diff: "@@ -1 +1 @@", handle: artifactHandle("e") }),
    );
    const preview = await new VerseShellPatchPreviewAdapter({ cwd, client }).preview({
      patch: patchLines(
        "*** Update File: f.txt",
        "@@",
        "-two",
        "+TWO",
        "*** Update File: g.txt",
        "@@",
        "-two",
        "+TWO",
      ),
    });

    expect(preview.diffs).toHaveLength(2);
    expect(lookupPatchPreview(preview.previewId)?.diffArtifacts).toEqual([artifactHandle("e")]);
  });
});
