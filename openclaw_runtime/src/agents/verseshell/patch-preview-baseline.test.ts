/**
 * VS-P3-01 paged baseline reads.
 *
 * A ranged read is capped at 500 lines, so anything larger has to be stitched
 * from several reads — and a stitch is not an atomic observation. The assertions
 * here are about that gap: the windows must tile the file exactly, the rejoined
 * text must be proven against the file's own digest before any diff is built on
 * it, and every way that proof can fail must end in the same honest refusal the
 * single-window implementation gave.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { AciTransport } from "./aci-client.js";
import { VerseShellAciClient } from "./aci-client.js";
import {
  MAX_BASELINE_LINES,
  MAX_BASELINE_PAGES,
  planBaselinePages,
  reconstructBaseline,
  VerseShellPatchPreviewAdapter,
} from "./patch-preview.js";
import type { Observation } from "../../../../shared/verseshell/types.js";

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
  const calls: Array<{ op: string; args: Record<string, unknown> }> = [];
  const transport: AciTransport = {
    key: "test-process",
    workspace: cwd,
    capabilities: ["file.read"],
    protocolVersion: "verseshell.jsonl/v1",
    catalogDigest: "sha256:test",
    request: async (op, args) => {
      calls.push({ op, args });
      return responder(op, args);
    },
  };
  return { client: new VerseShellAciClient(transport), calls };
}

function patchLines(...lines: string[]): string {
  return ["*** Begin Patch", ...lines, "*** End Patch"].join("\n");
}

/** The digest the runtime would actually report, so a stitched baseline can be proven. */
function trueHash(text: string): string {
  return `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
}

/**
 * The runtime reports content lines: a trailing newline ends the last line, it
 * does not begin an empty one. Mirroring that here keeps `total_lines` and the
 * window tiling in these fakes equal to the measured contract.
 */
function contentLines(text: string): string[] {
  if (text === "") return [];
  const parts = text.split("\n");
  if (parts.at(-1) === "") parts.pop();
  return parts;
}

/**
 * A repo that answers ranged reads the way the pinned runtime was measured to:
 * `lines` as `{line, text}` records with terminators stripped, the whole file's
 * digest on every window, and `total_lines` counting content lines.
 *
 * `corrupt` lets a test hand back one window that does not belong to the file,
 * and `hashFor` lets one window report a different whole-file digest — which is
 * what a write landing between two reads actually looks like.
 */
function pagedRepo(
  text: string,
  options: {
    corrupt?: (lines: string[], index: number) => string[];
    hashFor?: (index: number) => string;
  } = {},
): Responder {
  const all = contentLines(text);
  const fileHash = trueHash(text);
  return (op, args) => {
    if (op === "file.hash") return ok("file.hash", { content_hash: fileHash });
    if (op === "file.read_range") {
      const start = Number(args.start_line);
      const end = Number(args.end_line);
      const index = Math.floor((start - 1) / MAX_BASELINE_LINES);
      const slice = all.slice(start - 1, end);
      const texts = options.corrupt ? options.corrupt(slice, index) : slice;
      return ok("file.read_range", {
        lines: texts.map((line, offset) => ({ line: start + offset, text: line })),
        content_hash: options.hashFor ? options.hashFor(index) : fileHash,
        total_lines: all.length,
        truncated: false,
      });
    }
    if (op === "file.diff") return ok("file.diff", { diff: ["@@ paged @@"], truncated: false });
    return ok(op);
  };
}

/** `marker` sits on line 2 so a one-line update hunk has unique context to anchor on. */
function bigText(lineCount: number, marker = "two"): string {
  const lines = Array.from({ length: lineCount }, (_, index) =>
    index === 1 ? marker : `line-${index}`,
  );
  return `${lines.join("\n")}\n`;
}

describe("VerseShell patch preview: window planning", () => {
  it("tiles the file exactly and refuses past the page budget", () => {
    expect(planBaselinePages(1)).toEqual([{ start: 1, end: 1 }]);
    expect(planBaselinePages(MAX_BASELINE_LINES)).toEqual([{ start: 1, end: MAX_BASELINE_LINES }]);
    expect(planBaselinePages(MAX_BASELINE_LINES + 1)).toEqual([
      { start: 1, end: MAX_BASELINE_LINES },
      { start: MAX_BASELINE_LINES + 1, end: MAX_BASELINE_LINES + 1 },
    ]);

    const full = planBaselinePages(MAX_BASELINE_LINES * MAX_BASELINE_PAGES);
    expect(full).toHaveLength(MAX_BASELINE_PAGES);
    // No window exceeds the runtime's own cap, and together they leave no gap.
    expect(full?.every((page) => page.end - page.start + 1 <= MAX_BASELINE_LINES)).toBe(true);
    expect(
      full?.every((page, index) => index === 0 || page.start === full[index - 1]!.end + 1),
    ).toBe(true);
    expect(full?.at(-1)?.end).toBe(MAX_BASELINE_LINES * MAX_BASELINE_PAGES);

    expect(planBaselinePages(MAX_BASELINE_LINES * MAX_BASELINE_PAGES + 1)).toBeNull();
    expect(planBaselinePages(0)).toBeNull();
    expect(planBaselinePages(-1)).toBeNull();
    expect(planBaselinePages(1.5)).toBeNull();
  });

  it("rebuilds every spelling the records cannot distinguish, and refuses the rest", () => {
    // These two files produce identical line records; only the digest separates
    // them. That is the whole reason reconstruction is proven rather than joined.
    const records = ["alpha", "bravo", "charlie"];
    const trailing = "alpha\nbravo\ncharlie\n";
    const bare = "alpha\nbravo\ncharlie";
    expect(reconstructBaseline(records, trueHash(trailing))).toBe(trailing);
    expect(reconstructBaseline(records, trueHash(bare))).toBe(bare);

    // CRLF arrives with its carriage returns stripped, so it too is rebuilt by
    // proof rather than being a whole class of unpreviewable file.
    const crlf = "alpha\r\nbravo\r\ncharlie\r\n";
    expect(reconstructBaseline(records, trueHash(crlf))).toBe(crlf);

    expect(reconstructBaseline([], trueHash(""))).toBe("");
    const paged = bigText(1_200);
    expect(reconstructBaseline(contentLines(paged), trueHash(paged))).toBe(paged);

    // Mixed endings match no uniform spelling, and no digest matches nothing.
    expect(reconstructBaseline(records, trueHash("alpha\r\nbravo\ncharlie\r\n"))).toBeNull();
    expect(reconstructBaseline(records, null)).toBeNull();
  });
});

describe("VerseShell patch preview: paged baselines", () => {
  it("pages a baseline over the single-read cap and previews it like any other update", async () => {
    const text = bigText(1_200);
    const cwd = process.cwd();
    const fake = fakeClient(cwd, pagedRepo(text));
    const preview = await new VerseShellPatchPreviewAdapter({
      cwd,
      client: fake.client,
    }).preview({ patch: patchLines("*** Update File: big.txt", "@@", "-two", "+TWO") });

    expect(fake.calls.map((call) => call.op)).toEqual([
      "file.hash",
      "file.read_range",
      "file.read_range",
      "file.read_range",
      "file.diff",
    ]);
    expect(
      fake.calls
        .filter((call) => call.op === "file.read_range")
        .map((call) => [call.args.start_line, call.args.end_line]),
    ).toEqual([
      [1, 500],
      [501, 1_000],
      [1_001, 1_200],
    ]);
    // The whole file was reconstructed, so the post-image handed to file.diff is
    // the complete one — not a 500-line prefix with the tail silently dropped.
    expect(fake.calls.at(-1)?.args).toEqual({
      path: "big.txt",
      new_text: text.replace("two", "TWO"),
    });
    expect(preview.preconditions[0]).toEqual({
      path: "big.txt",
      change: "update",
      exists: true,
      baseHash: trueHash(text),
      baselineTruncated: false,
    });
    expect(preview.commitEligible).toBe(true);
  });

  it("reads a file at exactly the cap in one window and keeps its trailing newline", async () => {
    // `total_lines` counts content lines, so a file of exactly the cap needs no
    // second window. The trailing newline it does have is not carried by the line
    // records at all — only the digest proof puts it back.
    const text = bigText(MAX_BASELINE_LINES);
    expect(contentLines(text)).toHaveLength(MAX_BASELINE_LINES);
    const cwd = process.cwd();
    const fake = fakeClient(cwd, pagedRepo(text));
    const preview = await new VerseShellPatchPreviewAdapter({
      cwd,
      client: fake.client,
    }).preview({ patch: patchLines("*** Update File: edge.txt", "@@", "-two", "+TWO") });

    expect(
      fake.calls
        .filter((call) => call.op === "file.read_range")
        .map((call) => [call.args.start_line, call.args.end_line]),
    ).toEqual([[1, 500]]);
    expect(preview.preconditions[0]?.baselineTruncated).toBe(false);
    // The post-image still ends in a newline, so nothing was lost in the rebuild.
    expect(fake.calls.at(-1)?.args).toEqual({
      path: "edge.txt",
      new_text: text.replace("two", "TWO"),
    });
    expect(preview.commitEligible).toBe(true);
  });

  it("refuses a window whose whole-file digest disagrees with the others", async () => {
    // A write landing between two reads makes the later window report a different
    // whole-file digest. Catching that at the window is earlier and more precise
    // than waiting for the rejoined text to fail its hash.
    const text = bigText(1_200);
    const cwd = process.cwd();
    const fake = fakeClient(
      cwd,
      pagedRepo(text, { hashFor: (index) => (index === 1 ? trueHash("moved") : trueHash(text)) }),
    );
    const preview = await new VerseShellPatchPreviewAdapter({
      cwd,
      client: fake.client,
    }).preview({ patch: patchLines("*** Update File: big.txt", "@@", "-two", "+TWO") });

    // It stops at the offending window rather than reading the rest of the file.
    expect(fake.calls.map((call) => call.op)).toEqual([
      "file.hash",
      "file.read_range",
      "file.read_range",
    ]);
    expect(preview.preconditions[0]).toMatchObject({
      baselineTruncated: true,
      baselineReason: "torn-stitch",
      conflict: "baseline-unreadable",
    });
    expect(preview.commitEligible).toBe(false);
  });

  it("refuses a stitch that does not hash back to the file", async () => {
    // The observed regression probe for the paging guard: drop one line from the
    // middle window, which is what a write landing between two reads looks like.
    // Without the hash check the preview would diff a baseline that never existed
    // on disk, and the commit gate would accept it as verified.
    const text = bigText(1_200);
    const cwd = process.cwd();
    const fake = fakeClient(
      cwd,
      pagedRepo(text, {
        corrupt: (lines, index) => (index === 1 ? lines.slice(1) : lines),
      }),
    );
    const preview = await new VerseShellPatchPreviewAdapter({
      cwd,
      client: fake.client,
    }).preview({ patch: patchLines("*** Update File: big.txt", "@@", "-two", "+TWO") });

    expect(fake.calls.some((call) => call.op === "file.diff")).toBe(false);
    expect(preview.preconditions[0]).toMatchObject({
      baselineTruncated: true,
      baselineReason: "torn-stitch",
      conflict: "baseline-unreadable",
      baseHash: trueHash(text),
    });
    expect(preview.diffs[0]).toEqual({ path: "big.txt", unified: "", truncated: true });
    expect(preview.commitEligible).toBe(false);
  });

  it("refuses a window that does not say how long the file is", async () => {
    // `total_lines` is the only evidence the reader has that one window was the
    // whole file — it is not proven locally, it is foreign runtime output. If a
    // window arrives without it, "the file fit in one read" is a guess, and on a
    // file this size the guess is wrong: the first window is a 500-line prefix
    // whose tail would be silently dropped. The boundary rule forbids passing a
    // prefix off as a whole file, so an absent count has to fail closed.
    const text = bigText(1_200);
    const cwd = process.cwd();
    const lines = text.split("\n");
    const fake = fakeClient(cwd, (op, args) => {
      if (op === "file.hash") return ok("file.hash", { content_hash: trueHash(text) });
      if (op === "file.read_range") {
        const start = Number(args.start_line);
        const end = Number(args.end_line);
        // Everything a real window carries, except the line count.
        return ok("file.read_range", { text: lines.slice(start - 1, end).join("\n") });
      }
      if (op === "file.diff") return ok("file.diff", { diff: "@@ paged @@" });
      return ok(op);
    });
    const preview = await new VerseShellPatchPreviewAdapter({
      cwd,
      client: fake.client,
    }).preview({ patch: patchLines("*** Update File: big.txt", "@@", "-two", "+TWO") });

    // No diff may be built on an unprovable baseline.
    expect(fake.calls.some((call) => call.op === "file.diff")).toBe(false);
    expect(preview.preconditions[0]).toMatchObject({
      baselineTruncated: true,
      baselineReason: "unreadable",
      conflict: "baseline-unreadable",
      baseHash: trueHash(text),
    });
    expect(preview.diffs[0]).toEqual({ path: "big.txt", unified: "", truncated: true });
    expect(preview.commitEligible).toBe(false);
  });

  it("aborts between windows instead of finishing a read nobody is waiting for", async () => {
    // A paged baseline is the one place a preview can run long, so the abort has to
    // land between windows rather than only before the first one. It throws instead
    // of returning a truncated baseline: an aborted read is not a finding about the
    // file, and reporting it as one would put a bogus conflict on the record.
    const text = bigText(1_200);
    const cwd = process.cwd();
    const paged = pagedRepo(text);
    const controller = new AbortController();
    const fake = fakeClient(cwd, (op, args) => {
      if (op === "file.read_range" && Number(args.start_line) === 1) controller.abort();
      return paged(op, args);
    });

    await expect(
      new VerseShellPatchPreviewAdapter({ cwd, client: fake.client }).preview(
        { patch: patchLines("*** Update File: big.txt", "@@", "-two", "+TWO") },
        controller.signal,
      ),
    ).rejects.toThrow(/abort/iu);
    // First window read, then it stopped: no second window and no diff.
    expect(fake.calls.map((call) => call.op)).toEqual(["file.hash", "file.read_range"]);
  });

  it("refuses when a later window cannot be read at all", async () => {
    const text = bigText(1_200);
    const cwd = process.cwd();
    const paged = pagedRepo(text);
    const fake = fakeClient(cwd, (op, args) =>
      op === "file.read_range" && Number(args.start_line) > MAX_BASELINE_LINES
        ? failed("file.read_range", "E_IO")
        : paged(op, args),
    );
    const preview = await new VerseShellPatchPreviewAdapter({
      cwd,
      client: fake.client,
    }).preview({ patch: patchLines("*** Update File: big.txt", "@@", "-two", "+TWO") });

    // It stops at the first unreadable window instead of walking the rest.
    expect(fake.calls.map((call) => call.op)).toEqual([
      "file.hash",
      "file.read_range",
      "file.read_range",
    ]);
    expect(preview.preconditions[0]).toMatchObject({
      baselineTruncated: true,
      baselineReason: "unreadable",
      conflict: "baseline-unreadable",
    });
    expect(preview.commitEligible).toBe(false);
  });
});
