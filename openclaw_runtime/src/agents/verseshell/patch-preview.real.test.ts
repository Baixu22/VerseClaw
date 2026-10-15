/**
 * VS-P3-01 against the real pinned runtime.
 *
 * Every other preview test drives a fake responder. That is what let this slice
 * ship decoding that no runtime ever produced: the fakes were written from the
 * implementation's assumptions, so they agreed with it by construction and a
 * full green suite said nothing about whether `file.read_range` and `file.diff`
 * are read correctly. These tests exist to close that gap, and they are the
 * reason the fakes elsewhere were rewritten to the shapes asserted here.
 *
 * They run only where the verified binary is actually present; everywhere else
 * they skip rather than pretend.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { JsonObject } from "../../../../shared/verseshell/types.js";
import type { VerseShellAciClient } from "./aci-client.js";
import { applyPatch } from "../apply-patch.js";
import { EffectReceiptStore } from "../effect-receipt.js";
import { closeOpenClawStateDatabase } from "../../state/openclaw-state-db.js";
import { VerseShellProcessManager } from "./process-manager.js";
import { VERSESHELL_PATCH_PREVIEW_PROFILE_ID } from "./policy-profile.js";
import { readBaseline } from "./patch-preview-baseline.js";
import { MAX_BASELINE_LINES, VerseShellPatchPreviewAdapter } from "./patch-preview.js";

const binaryPath = fileURLToPath(
  new URL("../../../../resources/bin/win32-x64/ae.exe", import.meta.url),
);
const runRealBinary = process.platform === "win32" && existsSync(binaryPath);

const managers: VerseShellProcessManager[] = [];
const workspaces: string[] = [];

afterEach(async () => {
  await Promise.allSettled(managers.splice(0).map((manager) => manager.shutdownAll()));
  await Promise.allSettled(
    workspaces.splice(0).map((workspace) => rm(workspace, { recursive: true, force: true })),
  );
  closeOpenClawStateDatabase();
  delete process.env.OPENCLAW_STATE_DIR;
});

/** The pinned catalog this bridge targets; the same digest governed exec pins. */
async function realClient(workspace: string): Promise<VerseShellAciClient> {
  const sha256 = createHash("sha256").update(await readFile(binaryPath)).digest("hex");
  const manager = new VerseShellProcessManager({
    resolveBinary: () => ({ path: binaryPath, source: "verified-bundled", verified: true }),
  });
  managers.push(manager);
  return manager.getClient({
    workspace,
    policyProfile: VERSESHELL_PATCH_PREVIEW_PROFILE_ID,
    expectedBinaryVersion: "1.0.0",
    expectedProtocolVersion: "verseshell.jsonl/v1",
    expectedCatalogDigest:
      "sha256:67f78a723d582bf0809aab1f94352772c8a2818367b2f5e9d931722c06e979e8",
    expectedCatalogCount: 32,
    env: {
      VERSESHELL_RUNTIME_VERSION: "1.0.0",
      VERSESHELL_SERVER_PROTOCOL: "verseshell.jsonl/v1",
      VERSESHELL_OPERATION_CATALOG_DIGEST:
        "sha256:67f78a723d582bf0809aab1f94352772c8a2818367b2f5e9d931722c06e979e8",
      VERSESHELL_OPERATION_CATALOG_COUNT: "32",
      VERSESHELL_AE_SHA256: sha256,
      VERSESHELL_OS_SHELL: "powershell",
    },
  } as never);
}

async function workspaceWith(files: Record<string, string>): Promise<string> {
  const workspace = await mkdtemp(path.join(tmpdir(), "clawx-preview-real-"));
  workspaces.push(workspace);
  for (const [name, body] of Object.entries(files)) {
    await writeFile(path.join(workspace, name), body, "utf8");
  }
  return workspace;
}

function patchLines(...lines: string[]): string {
  return ["*** Begin Patch", ...lines, "*** End Patch"].join("\n");
}

describe.runIf(runRealBinary)("VerseShell patch preview: real runtime baselines", () => {
  /**
   * `lines` strips terminators, so these five files are the whole question: two
   * of them return byte-identical line records and differ only in a trailing
   * newline, and the CRLF one loses its carriage returns entirely. Reconstruction
   * is proven against the digest precisely because the records cannot decide it.
   */
  it.each([
    ["a trailing newline", "trailing.txt", "alpha\nbravo\ncharlie\n"],
    ["no trailing newline", "notrailing.txt", "alpha\nbravo\ncharlie"],
    ["CRLF endings", "crlf.txt", "alpha\r\nbravo\r\ncharlie\r\n"],
    ["a blank interior line", "blank.txt", "alpha\n\ncharlie\n"],
    ["an empty file", "empty.txt", ""],
  ])("rebuilds a file with %s byte for byte", async (_label, name, body) => {
    const workspace = await workspaceWith({ [name]: body });
    const client = await realClient(workspace);
    const baseline = await readBaseline({
      request: (op, args: JsonObject) => client.execute(op, args, { effectful: false }),
      target: name,
      needText: true,
    });

    expect(baseline.truncated).toBe(false);
    expect(baseline.text).toBe(body);
    expect(baseline.hash).toBe(
      `sha256:${createHash("sha256").update(body, "utf8").digest("hex")}`,
    );
  });

  it("refuses a file whose line endings cannot be rebuilt", async () => {
    // Mixed endings survive no uniform spelling, so no candidate hashes back and
    // the honest answer is a refusal rather than a baseline that never existed.
    const body = "alpha\r\nbravo\ncharlie\r\n";
    const workspace = await workspaceWith({ "mixed.txt": body });
    const client = await realClient(workspace);
    const baseline = await readBaseline({
      request: (op, args: JsonObject) => client.execute(op, args, { effectful: false }),
      target: "mixed.txt",
      needText: true,
    });

    expect(baseline.truncated).toBe(true);
    expect(baseline.reason).toBe("unreadable");
    expect(baseline.text).toBeUndefined();
  });

  it("pages a file past the single-read cap and previews it end to end", async () => {
    const lineCount = MAX_BASELINE_LINES * 2 + 37;
    const body = `${Array.from({ length: lineCount }, (_, i) =>
      i === 1 ? "two" : `line-${i}`,
    ).join("\n")}\n`;
    const workspace = await workspaceWith({ "big.txt": body });
    const client = await realClient(workspace);

    const preview = await new VerseShellPatchPreviewAdapter({ cwd: workspace, client }).preview({
      patch: patchLines("*** Update File: big.txt", "@@", "-two", "+TWO"),
    });

    expect(preview.preconditions[0]).toMatchObject({
      path: "big.txt",
      change: "update",
      baselineTruncated: false,
    });
    expect(preview.preconditions[0]?.conflict).toBeUndefined();
    expect(preview.commitEligible).toBe(true);
    // A real unified diff, not the empty string the array shape used to yield.
    expect(preview.diffs[0]?.unified).toContain("-two");
    expect(preview.diffs[0]?.unified).toContain("+TWO");
  });

  it("leaves a small file's diff unclipped", async () => {
    // `file.diff` renders full context, so its length tracks the file's rather
    // than the change's. Well under the runtime's cap it comes back whole, which
    // is what makes the clipped case below a real distinction and not a constant.
    const workspace = await workspaceWith({ "small.txt": "alpha\ntwo\ncharlie\n" });
    const client = await realClient(workspace);

    const preview = await new VerseShellPatchPreviewAdapter({ cwd: workspace, client }).preview({
      patch: patchLines("*** Update File: small.txt", "@@", "-two", "+TWO"),
    });

    expect(preview.diffs[0]?.truncated).toBe(false);
    expect(preview.diffs[0]?.unified).toContain("+TWO");
    expect(preview.commitEligible).toBe(true);
  });

  it("renders a change the runtime would have clipped, in full", async () => {
    // The runtime caps its own diff at 200 array entries and flags it. A preview
    // whose whole job is showing a reviewer the change cannot hand back a 200-line
    // prefix of a 3000-line one, so the render is ours — same generator the write
    // journal uses, same inputs, three orders of magnitude more headroom.
    const lineCount = 3_000;
    const body = `${Array.from({ length: lineCount }, (_, i) => `row-${i}`).join("\n")}\n`;
    const workspace = await workspaceWith({ "wide.txt": body });
    const client = await realClient(workspace);

    const hunks = Array.from({ length: lineCount }, (_, i) => [`-row-${i}`, `+CH-${i}`]).flat();
    const preview = await new VerseShellPatchPreviewAdapter({ cwd: workspace, client }).preview({
      patch: patchLines("*** Update File: wide.txt", "@@", ...hunks),
    });

    expect(preview.preconditions[0]?.baselineTruncated).toBe(false);
    expect(preview.diffs[0]?.truncated).toBe(false);
    // Every line is present, including the last — the one a 200-entry cap drops.
    expect(preview.diffs[0]?.unified).toContain("+CH-0");
    expect(preview.diffs[0]?.unified).toContain(`+CH-${lineCount - 1}`);
    expect(preview.commitEligible).toBe(true);
  });

  it("reports a missing target instead of inventing a baseline", async () => {
    const workspace = await workspaceWith({ "present.txt": "kept\n" });
    const client = await realClient(workspace);

    const preview = await new VerseShellPatchPreviewAdapter({ cwd: workspace, client }).preview({
      patch: patchLines("*** Delete File: absent.txt"),
    });

    expect(preview.preconditions[0]).toMatchObject({
      path: "absent.txt",
      change: "delete",
      exists: false,
      conflict: "missing-target",
    });
    expect(preview.commitEligible).toBe(false);
  });

  it("rebuilds a CRLF file and previews a real update on it", async () => {
    // ClawX is a Windows-first repo, so CRLF must work through the whole adapter
    // and not just the baseline reader: the post-image reconstruction has to
    // survive the hunk application without the carriage returns turning into a
    // failed match.
    const body = "alpha\r\ntwo\r\ncharlie\r\n";
    const workspace = await workspaceWith({ "c.txt": body });
    const client = await realClient(workspace);

    const preview = await new VerseShellPatchPreviewAdapter({ cwd: workspace, client }).preview({
      patch: patchLines("*** Update File: c.txt", "@@", "-two", "+TWO"),
    });

    expect(preview.preconditions[0]).toMatchObject({
      path: "c.txt",
      change: "update",
      baselineTruncated: false,
    });
    expect(preview.commitEligible).toBe(true);
    expect(preview.diffs[0]?.unified).toContain("-two");
    expect(preview.diffs[0]?.unified).toContain("+TWO");
  });

  it("commits a real preview through the real write path (AC-3 end to end)", async () => {
    // This is the case every other test leaves mocked: the previewId and digest
    // come out of the preview produced by the actual runtime, and the commit gate
    // verifies them against the file preflight itself reads, no hand-built record
    // anywhere. If the adapter's digest ever stops agreeing with the write path's,
    // this is the test that turns red.
    const workspace = await workspaceWith({ "f.txt": "one\ntwo\nthree\n" });
    const stateDir = path.join(workspace, "..", `state-${path.basename(workspace)}`);
    const { mkdir } = await import("node:fs/promises");
    await mkdir(stateDir, { recursive: true });
    process.env.OPENCLAW_STATE_DIR = stateDir;
    const client = await realClient(workspace);

    const preview = await new VerseShellPatchPreviewAdapter({ cwd: workspace, client }).preview({
      patch: patchLines("*** Update File: f.txt", "@@", " one", "-two", "+TWO", " three"),
    });
    expect(preview.commitEligible).toBe(true);

    const result = await applyPatch(
      patchLines("*** Update File: f.txt", "@@", " one", "-two", "+TWO", " three"),
      {
        cwd: workspace,
        previewId: preview.previewId,
        journal: {
          workspaceRoot: workspace,
          sessionId: "e2e-sess",
          requestId: "batch-e2e",
          enabled: true,
        },
      },
    );

    expect(result.batchState).toBe("committed");
    // The journal evidence carries what the runtime's own preview produced.
    expect(result.journal?.preview).toEqual({
      previewId: preview.previewId,
      changeSummaryDigest: preview.changeSummaryDigest,
    });
    expect(await readFile(path.join(workspace, "f.txt"), "utf-8")).toBe("one\nTWO\nthree\n");

    // And the receipt row really landed, with no human decision on it.
    const rows = new EffectReceiptStore().listByApproval(preview.previewId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.idempotency_key).toBe("apply_patch:batch-e2e");
    expect(rows[0]?.outcome).toBe("applied");
    expect(rows[0]?.approval_decision).toBeNull();
    expect(rows[0]?.domain_executor).toBe("clawx-write-journal");
  });

  it("refuses to commit a preview after the file moved, leaving it byte-identical", async () => {
    const workspace = await workspaceWith({ "f.txt": "one\ntwo\nthree\n" });
    const client = await realClient(workspace);

    const preview = await new VerseShellPatchPreviewAdapter({ cwd: workspace, client }).preview({
      patch: patchLines("*** Update File: f.txt", "@@", " one", "-two", "+TWO", " three"),
    });
    // A line lands before the hunk's context: the patch still applies cleanly, so
    // preflight succeeds — but the baseline is no longer the previewed one, which
    // is exactly the drift the commit gate exists to catch.
    await writeFile(path.join(workspace, "f.txt"), "header\none\ntwo\nthree\n", "utf-8");

    await expect(
      applyPatch(patchLines("*** Update File: f.txt", "@@", " one", "-two", "+TWO", " three"), {
        cwd: workspace,
        previewId: preview.previewId,
        journal: {
          workspaceRoot: workspace,
          sessionId: "stale-sess",
          requestId: "batch-stale",
          enabled: true,
        },
      }),
    ).rejects.toThrow(/stale/iu);

    // Nothing was written, nothing was reconciled: the drift is what's on disk.
    expect(await readFile(path.join(workspace, "f.txt"), "utf-8")).toBe(
      "header\none\ntwo\nthree\n",
    );
  });
});
