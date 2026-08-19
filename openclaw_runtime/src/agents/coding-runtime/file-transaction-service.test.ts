/**
 * P1 FileTransactionService tests: one journal, one state machine, rollback
 * matrix, fail-closed prepare, and recovery_required retention.
 */
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { __resetBatchLocks } from "../apply-patch-batch-lock.js";
import { __resetWriteJournals, getOrCreateWriteJournal, journalDirFor } from "../tools/write-journal.js";
import { codingObservability } from "../../context-engine/coding-observability.js";
import {
  CodingRuntimeError,
  FileTransactionBatchRolledBackError,
  FileTransactionService,
} from "./file-transaction-service.js";
import type { CodingMutation, MutationPrepareOptions } from "../../../../shared/coding-runtime/types.js";

let root: string;
let service: FileTransactionService;
const sessionId = "session-1";
const requestId = "request-1";

function options(extra: Partial<MutationPrepareOptions> = {}): MutationPrepareOptions {
  return {
    sessionId,
    requestId,
    workspaceRoot: root,
    toolName: extra.toolName ?? "test",
    ...extra,
  };
}

async function commit(mutation: CodingMutation, extra?: Partial<MutationPrepareOptions>) {
  const prepared = await service.prepare(mutation, options(extra));
  return { prepared, result: await service.commit(prepared) };
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "uftk-service-"));
  __resetWriteJournals();
  __resetBatchLocks();
  codingObservability.reset();
  service = new FileTransactionService({ workspaceRoot: root, sessionId });
});

afterEach(async () => {
  __resetWriteJournals();
  __resetBatchLocks();
  codingObservability.reset();
  await rm(root, { recursive: true, force: true });
});

function patchLines(...lines: string[]): string {
  return ["*** Begin Patch", ...lines, "*** End Patch"].join("\n");
}

describe("FileTransactionService prepare/commit/rollback matrix", () => {
  it("routes write, edit, delete, move, and apply_patch through the same journal", async () => {
    await writeFile(path.join(root, "write.txt"), "w0", "utf8");
    await commit({ kind: "write", path: "write.txt", content: "w1" });

    await writeFile(path.join(root, "edit.txt"), "alpha\n", "utf8");
    await commit({
      kind: "edit",
      path: "edit.txt",
      edits: [{ oldText: "alpha", newText: "ALPHA" }],
    });

    await writeFile(path.join(root, "delete.txt"), "d0", "utf8");
    await commit({ kind: "delete", path: "delete.txt" });

    await writeFile(path.join(root, "move-src.txt"), "m0", "utf8");
    await commit({ kind: "move", from: "move-src.txt", to: "move-dst.txt" });

    const patch = patchLines(
      "*** Add File: added.txt",
      "+added",
      "*** Update File: edit.txt",
      "@@",
      "-ALPHA",
      "+BETA",
      "*** Delete File: delete2.txt",
    );
    await writeFile(path.join(root, "delete2.txt"), "x", "utf8");
    await commit({ kind: "apply_patch", input: patch });

    expect(await readFile(path.join(root, "write.txt"), "utf8")).toBe("w1");
    expect(await readFile(path.join(root, "edit.txt"), "utf8")).toBe("BETA\n");
    expect(existsSync(path.join(root, "delete.txt"))).toBe(false);
    expect(await readFile(path.join(root, "move-dst.txt"), "utf8")).toBe("m0");
    expect(existsSync(path.join(root, "move-src.txt"))).toBe(false);

    const journal = getOrCreateWriteJournal(root, sessionId);
    const kinds = new Set(journal.entries.map((entry) => entry.kind));
    expect(kinds).toEqual(new Set(["write", "edit", "delete", "move", "apply_patch"]));
    expect(codingObservability.snapshot().uftkPrepareCount).toBe(5);
    expect(codingObservability.snapshot().uftkCommitCount).toBe(5);
  });

  it("rolls back one committed mutation by its batchId (write, create, delete, move)", async () => {
    await writeFile(path.join(root, "existing.txt"), "old", "utf8");
    const { prepared } = await commit({ kind: "write", path: "existing.txt", content: "new" });
    const rolled = await service.rollback(prepared.batchId);
    expect(rolled.status).toBe("rolled_back");
    expect(rolled.events).toHaveLength(1);
    expect(await readFile(path.join(root, "existing.txt"), "utf8")).toBe("old");

    const created = await service.prepare(
      { kind: "write", path: "created.txt", content: "x" },
      options(),
    );
    await service.commit(created);
    await service.rollback(created.batchId);
    expect(existsSync(path.join(root, "created.txt"))).toBe(false);

    await writeFile(path.join(root, "del.txt"), "gone", "utf8");
    const deleted = await service.prepare({ kind: "delete", path: "del.txt" }, options());
    await service.commit(deleted);
    await service.rollback(deleted.batchId);
    expect(await readFile(path.join(root, "del.txt"), "utf8")).toBe("gone");

    await writeFile(path.join(root, "src.txt"), "mv", "utf8");
    await writeFile(path.join(root, "dst.txt"), "dst-old", "utf8");
    const moved = await service.prepare(
      { kind: "move", from: "src.txt", to: "dst.txt" },
      options(),
    );
    await service.commit(moved);
    expect(await readFile(path.join(root, "dst.txt"), "utf8")).toBe("mv");
    await service.rollback(moved.batchId);
    expect(await readFile(path.join(root, "src.txt"), "utf8")).toBe("mv");
    expect(await readFile(path.join(root, "dst.txt"), "utf8")).toBe("dst-old");
  });

  it("rolls back multiple mutations that share one batchId", async () => {
    await writeFile(path.join(root, "a.txt"), "a0", "utf8");
    await writeFile(path.join(root, "b.txt"), "b0", "utf8");

    const preparedA = await service.prepare(
      { kind: "write", path: "a.txt", content: "a1" },
      options({ batchId: "shared-batch" }),
    );
    await service.commit(preparedA);
    const preparedB = await service.prepare(
      { kind: "write", path: "b.txt", content: "b1" },
      options({ batchId: "shared-batch" }),
    );
    const second = await service.commit(preparedB);
    expect(second.batchId).toBe("shared-batch");

    const rollback = await service.rollback("shared-batch");
    expect(rollback.status).toBe("rolled_back");
    expect(rollback.files.map((file) => file.path).sort()).toEqual(["a.txt", "b.txt"]);
    expect(await readFile(path.join(root, "a.txt"), "utf8")).toBe("a0");
    expect(await readFile(path.join(root, "b.txt"), "utf8")).toBe("b0");
  });

  it("rolls back a committed apply_patch batch from journal pre-images", async () => {
    await writeFile(path.join(root, "patch.txt"), "before\n", "utf8");
    await writeFile(path.join(root, "removed.txt"), "remove-me\n", "utf8");
    const patch = patchLines(
      "*** Update File: patch.txt",
      "@@",
      "-before",
      "+after",
      "*** Delete File: removed.txt",
    );
    const prepared = await service.prepare({ kind: "apply_patch", input: patch }, options());
    const commitResult = await service.commit(prepared);
    expect(commitResult.status).toBe("committed");
    expect(await readFile(path.join(root, "patch.txt"), "utf8")).toBe("after\n");
    expect(existsSync(path.join(root, "removed.txt"))).toBe(false);

    const rollback = await service.rollback(prepared.batchId);
    expect(rollback.status).toBe("rolled_back");
    expect(await readFile(path.join(root, "patch.txt"), "utf8")).toBe("before\n");
    expect(await readFile(path.join(root, "removed.txt"), "utf8")).toBe("remove-me\n");
  });

  it("rolls back an apply_patch batch that partially failed (rolled_back)", async () => {
    const patch = patchLines(
      "*** Add File: first/one.txt",
      "+one",
      "*** Add File: blocked/two.txt",
      "+two",
    );
    const prepared = await service.prepare({ kind: "apply_patch", input: patch }, options());
    // Sabotage only the second hunk's parent after prepare; the first add is
    // already applied before the second hunk hits this error.
    await writeFile(path.join(root, "blocked"), "not a directory", "utf8");

    const error = await service.commit(prepared).then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(FileTransactionBatchRolledBackError);
    expect((error as FileTransactionBatchRolledBackError).batchState).toBe("rolled_back");
    expect(existsSync(path.join(root, "first", "one.txt"))).toBe(false);
    expect(getOrCreateWriteJournal(root, sessionId).entries).toHaveLength(0);
  });

  it("returns recovery_required + recoveryRef when apply_patch rollback also fails", async () => {
    const local = {
      exists: async (filePath: string) => {
        try {
          return (await stat(filePath)).isFile();
        } catch {
          return false;
        }
      },
      readFile: async (filePath: string) => {
        const { decodeTextFile } = await import("../sessions/tools/text-file-codec.js");
        return decodeTextFile(await readFile(filePath), filePath);
      },
      writeFile: async (filePath: string, content: Buffer | string) => {
        if (filePath.endsWith(path.join("blocked", "two.txt"))) {
          throw new Error("injected second-hunk write failure");
        }
        await writeFile(filePath, content);
      },
      remove: async (filePath: string) => {
        if (filePath.endsWith(path.join("first", "one.txt"))) {
          throw new Error("injected first-hunk rollback failure");
        }
        await rm(filePath, { force: true });
      },
      mkdirp: async (dir: string) => {
        await mkdir(dir, { recursive: true });
      },
    };
    service = new FileTransactionService({
      workspaceRoot: root,
      sessionId,
      applyPatchFileOps: local,
    });
    const patch = patchLines(
      "*** Add File: first/one.txt",
      "+one",
      "*** Add File: blocked/two.txt",
      "+two",
    );
    const prepared = await service.prepare({ kind: "apply_patch", input: patch }, options());
    const result = await service.commit(prepared);
    expect(result.status).toBe("recovery_required");
    expect(result.recoveryRef).toContain("batch=");
    expect(result.events.some((event) => event.phase === "recovery_required")).toBe(true);
    expect(getOrCreateWriteJournal(root, sessionId).entries.length).toBeGreaterThan(0);
  });

  it("does not require git and can fully rollback in a non-git directory", async () => {
    expect(existsSync(path.join(root, ".git"))).toBe(false);
    await writeFile(path.join(root, "file.txt"), "v0", "utf8");
    const { prepared } = await commit({ kind: "write", path: "file.txt", content: "v1" });
    await service.rollback(prepared.batchId);
    expect(await readFile(path.join(root, "file.txt"), "utf8")).toBe("v0");
  });

  it("leaves disk zero-changed when prepare fails", async () => {
    await writeFile(path.join(root, "f.txt"), "original\n", "utf8");
    const before = await readFile(path.join(root, "f.txt"), "utf8");
    await expect(
      service.prepare(
        { kind: "edit", path: "f.txt", edits: [{ oldText: "missing", newText: "x" }] },
        options(),
      ),
    ).rejects.toMatchObject({ code: "E_INVALID_MUTATION" });
    expect(await readFile(path.join(root, "f.txt"), "utf8")).toBe(before);
    expect(getOrCreateWriteJournal(root, sessionId).entries).toHaveLength(0);
  });

  it("fails closed when journal snapshot cannot be persisted (UFTK flag on semantics)", async () => {
    const journalFile = journalDirFor(root, sessionId);
    mkdirSync(path.dirname(journalFile), { recursive: true });
    writeFileSync(journalFile, "blocks journal directory", "utf8");
    await writeFile(path.join(root, "f.txt"), "original", "utf8");

    const error = await service
      .prepare({ kind: "write", path: "f.txt", content: "new" }, options())
      .then(
        () => null,
        (caught: unknown) => caught,
      );
    expect(error).toBeInstanceOf(CodingRuntimeError);
    expect((error as CodingRuntimeError).code).toBe("E_AUDIT_WRITE_FAILED");
    expect(await readFile(path.join(root, "f.txt"), "utf8")).toBe("original");
  });

  it("previewRollback returns a unified diff and does not touch disk or journal", async () => {
    await writeFile(path.join(root, "f.txt"), "one\ntwo\n", "utf8");
    const { prepared } = await commit({ kind: "write", path: "f.txt", content: "one\nTWO\n" });
    const beforeJournal = getOrCreateWriteJournal(root, sessionId).entries.length;
    const preview = await service.previewRollback(prepared.batchId);
    expect(preview.preview).toBe(true);
    expect(preview.diff).toContain("-TWO");
    expect(preview.diff).toContain("+two");
    expect(await readFile(path.join(root, "f.txt"), "utf8")).toBe("one\nTWO\n");
    expect(getOrCreateWriteJournal(root, sessionId).entries).toHaveLength(beforeJournal);
  });

  it("rollback failure returns recovery_required + recoveryRef and keeps the journal", async () => {
    await writeFile(path.join(root, "keep.txt"), "before", "utf8");
    const { prepared } = await commit({ kind: "write", path: "keep.txt", content: "after" });
    const entry = getOrCreateWriteJournal(root, sessionId).entries[0]!;
    rmSync(entry.snapshotPath, { force: true });

    const rollback = await service.rollback(prepared.batchId);
    expect(rollback.status).toBe("recovery_required");
    expect(rollback.recoveryRef).toContain("batch=");
    expect(getOrCreateWriteJournal(root, sessionId).entries).toHaveLength(1);
    expect(await readFile(path.join(root, "keep.txt"), "utf8")).toBe("after");
  });

  it("listAudit fails closed until Phase 4", async () => {
    await expect(service.listAudit(sessionId, {})).rejects.toMatchObject({
      code: "E_AUDIT_WRITE_FAILED",
    });
  });
});
