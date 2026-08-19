import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { __resetBatchLocks } from "../apply-patch-batch-lock.js";
import { __resetWriteJournals, getOrCreateWriteJournal } from "../tools/write-journal.js";
import { FileTransactionService } from "./file-transaction-service.js";
import { buildRollbackPreview } from "./rollback-preview.js";

let root: string;
let service: FileTransactionService;
const sessionId = "preview-session";

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "uftk-preview-"));
  __resetWriteJournals();
  __resetBatchLocks();
  service = new FileTransactionService({ workspaceRoot: root, sessionId });
});

afterEach(async () => {
  __resetWriteJournals();
  __resetBatchLocks();
  await rm(root, { recursive: true, force: true });
});

async function commit(kind: "write" | "edit" | "delete" | "move", input: Record<string, unknown>) {
  const mutation =
    kind === "write"
      ? { kind: "write" as const, path: String(input.path), content: String(input.content) }
      : kind === "edit"
        ? {
            kind: "edit" as const,
            path: String(input.path),
            edits: input.edits as Array<{ oldText: string; newText: string }>,
          }
        : kind === "delete"
          ? { kind: "delete" as const, path: String(input.path) }
          : { kind: "move" as const, from: String(input.from), to: String(input.to) };
  const prepared = await service.prepare(mutation, {
    sessionId,
    requestId: "preview-request",
    workspaceRoot: root,
    toolName: kind,
  });
  await service.commit(prepared);
  return prepared;
}

describe("rollback preview", () => {
  it("previews removal for a created file", async () => {
    const prepared = await commit("write", { path: "created.txt", content: "new\n" });
    const preview = await service.previewRollback(prepared.batchId);
    expect(preview.diff).toContain("-new");
    expect(preview.files).toEqual([
      expect.objectContaining({ path: "created.txt", status: "removed" }),
    ]);
  });

  it("previews a modified-file restore as a unified diff", async () => {
    await writeFile(path.join(root, "f.txt"), "one\ntwo\n", "utf8");
    const prepared = await commit("write", { path: "f.txt", content: "one\nTWO\n" });
    const preview = await service.previewRollback(prepared.batchId);
    expect(preview.diff).toContain("-TWO");
    expect(preview.diff).toContain("+two");
  });

  it("previews restoration for a deleted file", async () => {
    await writeFile(path.join(root, "gone.txt"), "restore me\n", "utf8");
    const prepared = await commit("delete", { path: "gone.txt" });
    const preview = await service.previewRollback(prepared.batchId);
    expect(preview.diff).toContain("+restore me");
    expect(preview.files[0]).toMatchObject({ path: "gone.txt", status: "restored" });
  });

  it("previews both sides of a move restore", async () => {
    await writeFile(path.join(root, "src.txt"), "moved content\n", "utf8");
    await writeFile(path.join(root, "dst.txt"), "old dest\n", "utf8");
    const prepared = await commit("move", { from: "src.txt", to: "dst.txt" });
    const preview = await service.previewRollback(prepared.batchId);
    expect(preview.files.map((file) => file.path).sort()).toEqual(["dst.txt", "src.txt"]);
    expect(preview.diff).toContain("+moved content");
    expect(preview.diff).toContain("+old dest");
  });

  it("buildRollbackPreview is read-only for disk and journal", async () => {
    await writeFile(path.join(root, "f.txt"), "before\n", "utf8");
    const prepared = await commit("write", { path: "f.txt", content: "after\n" });
    const journalEntriesBefore = getOrCreateWriteJournal(root, sessionId).entries.length;
    const entries = getOrCreateWriteJournal(root, sessionId).entries.filter(
      (entry) => entry.batch?.id === prepared.batchId,
    );
    await buildRollbackPreview(entries);
    expect(await readFile(path.join(root, "f.txt"), "utf8")).toBe("after\n");
    expect(getOrCreateWriteJournal(root, sessionId).entries).toHaveLength(journalEntriesBefore);
    expect(existsSync(path.join(root, ".openclaw", "journal"))).toBe(true);
  });
});
