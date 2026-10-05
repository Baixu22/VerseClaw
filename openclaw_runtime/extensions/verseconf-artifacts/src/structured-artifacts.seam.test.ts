import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { closeOpenClawStateDatabase } from "openclaw/plugin-sdk/core";
import { __resetBatchLocks } from "../../../src/agents/apply-patch-batch-lock.js";
import { __resetWriteJournals } from "../../../src/agents/tools/write-journal.js";
import { commitStructuredArtifactCandidate, readStructuredArtifactSource } from "../../../src/plugin-sdk/structured-artifacts.js";

afterAll(() => { closeOpenClawStateDatabase(); });

async function tempWorkspace(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "verseconf-artifacts-seam-"));
}

describe("structured artifact commit owner", () => {
  it("rejects reads and writes through junctions below a junction workspace root", async () => {
    const fixture = await tempWorkspace();
    const realRoot = path.join(fixture, "workspace");
    const outside = path.join(fixture, "outside");
    const workspaceRoot = path.join(fixture, "workspace-alias");
    await mkdir(realRoot);
    await mkdir(outside);
    const linkType = process.platform === "win32" ? "junction" : "dir";
    await symlink(realRoot, workspaceRoot, linkType);
    await symlink(outside, path.join(realRoot, "linked"), linkType);
    await writeFile(path.join(outside, "source.json"), "outside sentinel");
    await writeFile(path.join(realRoot, "safe.json"), "inside sentinel");
    expect((await readStructuredArtifactSource(workspaceRoot, "safe.json")).bytes.toString()).toBe("inside sentinel");
    await expect(readStructuredArtifactSource(workspaceRoot, "linked/source.json")).rejects.toThrow(/symlink/);
    for (const sourcePath of ["linked/source.json", "linked/new-dir/new.json"]) {
      const result = await commitStructuredArtifactCandidate({
        context: { workspaceRoot, sessionId: "junction-seam", requestId: sourcePath },
        sourcePath, candidate: "must not write", operationId: sourcePath,
      });
      expect(result).toMatchObject({ ok: false, code: "invalid_path" });
    }
    expect(await readFile(path.join(outside, "source.json"), "utf8")).toBe("outside sentinel");
    await expect(readFile(path.join(outside, "new-dir/new.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("commits with the existing journal and refuses path escape", async () => {
    const workspaceRoot = await tempWorkspace();
    __resetBatchLocks();
    __resetWriteJournals();
    const filePath = "research.json";
    await writeFile(path.join(workspaceRoot, filePath), "{\"before\":true}\n", "utf8");
    const context = { workspaceRoot, sessionId: "session-seam", requestId: "request-seam", flags: { test: "agent" } };

    const committed = await commitStructuredArtifactCandidate({
      context,
      sourcePath: filePath,
      candidate: "{\"after\":true}\n",
      expectedBeforeSha256: (await readStructuredArtifactSource(workspaceRoot, filePath)).sha256,
      operationId: "op-seam-1",
    });
    expect(committed.ok).toBe(true);
    if (committed.ok) {
      expect(committed.changed).toBe(true);
      expect(committed.batchState).toBe("committed");
      expect(committed.journalRef).toContain("write-journal:session-seam:");
    }
    await expect(readFile(path.join(workspaceRoot, filePath), "utf8")).resolves.toBe("{\"after\":true}\n");

    const escape = await commitStructuredArtifactCandidate({
      context,
      sourcePath: "../outside.json",
      candidate: "{}",
      operationId: "op-seam-escape",
    });
    expect(escape).toMatchObject({ ok: false, code: "invalid_path" });
  });

  it("fails closed on stale source digest and cancellation without mutation", async () => {
    const workspaceRoot = await tempWorkspace();
    __resetBatchLocks();
    __resetWriteJournals();
    const filePath = "research.json";
    await writeFile(path.join(workspaceRoot, filePath), "{\"version\":1}\n", "utf8");
    const context = { workspaceRoot, sessionId: "session-drift", requestId: "request-drift" };
    const stale = await commitStructuredArtifactCandidate({
      context,
      sourcePath: filePath,
      candidate: "{\"version\":2}\n",
      expectedBeforeSha256: "0".repeat(64),
      operationId: "op-stale",
    });
    expect(stale).toMatchObject({ ok: false, code: "source_drift" });
    await expect(readFile(path.join(workspaceRoot, filePath), "utf8")).resolves.toBe("{\"version\":1}\n");

    const controller = new AbortController();
    controller.abort();
    const cancelled = await commitStructuredArtifactCandidate({
      context: { ...context, signal: controller.signal, requestId: "request-cancel" },
      sourcePath: filePath,
      candidate: "{\"version\":3}\n",
      operationId: "op-cancel",
    });
    expect(cancelled).toMatchObject({ ok: false, code: "cancelled" });
    await expect(readFile(path.join(workspaceRoot, filePath), "utf8")).resolves.toBe("{\"version\":1}\n");
  });
});
