/**
 * P2 FileTransactionService concurrency and optimistic-conflict tests.
 */
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { __resetBatchLocks } from "../apply-patch-batch-lock.js";
import { __resetWriteJournals, getOrCreateWriteJournal, hashFileContent } from "../tools/write-journal.js";
import { codingObservability } from "../../context-engine/coding-observability.js";
import { CodingRuntimeError, FileTransactionService } from "./file-transaction-service.js";
import { resetCodingRuntimeFileLocksForTest } from "./file-lock-manager.js";
import type { FileVersion, MutationPrepareOptions } from "../../../../shared/coding-runtime/types.js";

let root: string;
let service: FileTransactionService;
const sessionId = "p2-concurrency";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function options(extra: Partial<MutationPrepareOptions> = {}): MutationPrepareOptions {
  return {
    sessionId,
    requestId: `request-${Math.random().toString(36).slice(2)}`,
    workspaceRoot: root,
    toolName: extra.toolName ?? "test",
    ...extra,
  };
}

async function fileVersion(relPath: string): Promise<FileVersion> {
  const absPath = path.join(root, relPath);
  const bytes = await readFile(absPath);
  const fileStat = await stat(absPath);
  return {
    path: relPath,
    contentHash: hashFileContent(bytes),
    mtimeMs: fileStat.mtimeMs,
    size: fileStat.size,
  };
}

function patchLines(...lines: string[]): string {
  return ["*** Begin Patch", ...lines, "*** End Patch"].join("\n");
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "uftk-concurrency-"));
  __resetWriteJournals();
  __resetBatchLocks();
  resetCodingRuntimeFileLocksForTest();
  codingObservability.reset();
  service = new FileTransactionService({ workspaceRoot: root, sessionId });
});

afterEach(async () => {
  __resetWriteJournals();
  __resetBatchLocks();
  resetCodingRuntimeFileLocksForTest();
  codingObservability.reset();
  await rm(root, { recursive: true, force: true });
});

describe("concurrent writers", () => {
  it("serializes same-file prepare -> commit pairs so neither write is lost", async () => {
    await writeFile(path.join(root, "shared.txt"), "v0", "utf8");
    const first = await service.prepare(
      { kind: "write", path: "shared.txt", content: "v1" },
      options(),
    );
    let secondSettled = false;
    const secondPromise = service
      .prepare({ kind: "write", path: "shared.txt", content: "v2" }, options())
      .finally(() => {
        secondSettled = true;
      });

    await delay(80);
    expect(secondSettled).toBe(false);

    const firstResult = await service.commit(first);
    expect(firstResult.status).toBe("committed");
    const second = await secondPromise;
    expect(secondSettled).toBe(true);
    const secondResult = await service.commit(second);
    expect(secondResult.status).toBe("committed");
    expect(await readFile(path.join(root, "shared.txt"), "utf8")).toBe("v2");
  });

  it("independent files prepare and commit in parallel", async () => {
    await writeFile(path.join(root, "a.txt"), "a0", "utf8");
    await writeFile(path.join(root, "b.txt"), "b0", "utf8");
    const [preparedA, preparedB] = await Promise.all([
      service.prepare({ kind: "write", path: "a.txt", content: "a1" }, options()),
      service.prepare({ kind: "write", path: "b.txt", content: "b1" }, options()),
    ]);
    const [resultA, resultB] = await Promise.all([
      service.commit(preparedA),
      service.commit(preparedB),
    ]);
    expect(resultA.status).toBe("committed");
    expect(resultB.status).toBe("committed");
    expect(await readFile(path.join(root, "a.txt"), "utf8")).toBe("a1");
    expect(await readFile(path.join(root, "b.txt"), "utf8")).toBe("b1");
  });
});

describe("single-file optimistic version conflicts", () => {
  it("write returns structured E_CONFLICT + diff and leaves the target zero-changed", async () => {
    await writeFile(path.join(root, "f.txt"), "base", "utf8");
    const baseVersion = await fileVersion("f.txt");
    await writeFile(path.join(root, "f.txt"), "external", "utf8");

    const error = await service
      .prepare(
        { kind: "write", path: "f.txt", content: "mine", baseVersion },
        options(),
      )
      .then(
        () => null,
        (caught: unknown) => caught,
      );

    expect(error).toBeInstanceOf(CodingRuntimeError);
    const conflict = error as CodingRuntimeError;
    expect(conflict.code).toBe("E_CONFLICT");
    expect(conflict.baseVersion).toEqual(baseVersion);
    expect(conflict.currentVersion?.contentHash).toBe(hashFileContent(Buffer.from("external", "utf8")));
    expect(conflict.diff).toContain("-baseVersion:");
    expect(conflict.diff).toContain("+currentVersion:");
    expect(await readFile(path.join(root, "f.txt"), "utf8")).toBe("external");
    expect(getOrCreateWriteJournal(root, sessionId).entries).toHaveLength(0);
  });

  it("edit and delete use the same E_CONFLICT contract", async () => {
    await writeFile(path.join(root, "e.txt"), "alpha", "utf8");
    const editBase = await fileVersion("e.txt");
    await writeFile(path.join(root, "e.txt"), "changed", "utf8");
    await expect(
      service.prepare(
        {
          kind: "edit",
          path: "e.txt",
          edits: [{ oldText: "alpha", newText: "ALPHA" }],
          baseVersion: editBase,
        },
        options(),
      ),
    ).rejects.toMatchObject({ code: "E_CONFLICT", path: "e.txt" });

    await writeFile(path.join(root, "d.txt"), "delete-me", "utf8");
    const deleteBase = await fileVersion("d.txt");
    await writeFile(path.join(root, "d.txt"), "do-not-delete", "utf8");
    await expect(
      service.prepare({ kind: "delete", path: "d.txt", baseVersion: deleteBase }, options()),
    ).rejects.toMatchObject({ code: "E_CONFLICT", path: "d.txt" });
    expect(await readFile(path.join(root, "d.txt"), "utf8")).toBe("do-not-delete");
  });

  it("guard-disabled services keep P2 off by default for explicit production wiring", async () => {
    const unguarded = new FileTransactionService({
      workspaceRoot: root,
      sessionId,
      baseVersionGuardEnabled: false,
    });
    await writeFile(path.join(root, "g.txt"), "base", "utf8");
    const staleBase = await fileVersion("g.txt");
    await writeFile(path.join(root, "g.txt"), "external", "utf8");

    const prepared = await unguarded.prepare(
      { kind: "write", path: "g.txt", content: "mine", baseVersion: staleBase },
      options(),
    );
    const result = await unguarded.commit(prepared);
    expect(result.status).toBe("committed");
    expect(await readFile(path.join(root, "g.txt"), "utf8")).toBe("mine");
  });
});

describe("apply_patch baseVersions", () => {
  it("returns E_CONFLICT before any target mutation when one file version is stale", async () => {
    await writeFile(path.join(root, "one.txt"), "one-base\n", "utf8");
    await writeFile(path.join(root, "two.txt"), "two-base\n", "utf8");
    const oneBase = await fileVersion("one.txt");
    const twoBase = await fileVersion("two.txt");
    await writeFile(path.join(root, "two.txt"), "two-external\n", "utf8");

    const patch = patchLines(
      "*** Update File: one.txt",
      "@@",
      "-one-base",
      "+one-new",
      "*** Update File: two.txt",
      "@@",
      "-two-base",
      "+two-new",
    );
    const error = await service
      .prepare(
        { kind: "apply_patch", input: patch, baseVersions: [oneBase, twoBase] },
        options(),
      )
      .then(
        () => null,
        (caught: unknown) => caught,
      );

    expect(error).toBeInstanceOf(CodingRuntimeError);
    const conflict = error as CodingRuntimeError;
    expect(conflict.code).toBe("E_CONFLICT");
    expect(conflict.path).toBe("two.txt");
    expect(conflict.baseVersion).toEqual(twoBase);
    expect(conflict.currentVersion?.contentHash).toBe(
      hashFileContent(Buffer.from("two-external\n", "utf8")),
    );
    expect(conflict.diff).toContain("--- two.txt");
    expect(conflict.diff).toContain("+++ two.txt");
    expect(await readFile(path.join(root, "one.txt"), "utf8")).toBe("one-base\n");
    expect(await readFile(path.join(root, "two.txt"), "utf8")).toBe("two-external\n");
    expect(getOrCreateWriteJournal(root, sessionId).entries).toHaveLength(0);
  });

  it("applies when every baseVersion matches the preflight read", async () => {
    await writeFile(path.join(root, "match.txt"), "old\n", "utf8");
    const base = await fileVersion("match.txt");
    const patch = patchLines(
      "*** Update File: match.txt",
      "@@",
      "-old",
      "+new",
    );
    const prepared = await service.prepare(
      { kind: "apply_patch", input: patch, baseVersions: [base] },
      options(),
    );
    const result = await service.commit(prepared);
    expect(result.status).toBe("committed");
    expect(await readFile(path.join(root, "match.txt"), "utf8")).toBe("new\n");
  });

  it("an unknown baseVersion path conflicts closed instead of being ignored", async () => {
    const patch = patchLines("*** Add File: added.txt", "+added");
    const error = await service
      .prepare(
        {
          kind: "apply_patch",
          input: patch,
          baseVersions: [
            {
              path: "not-in-patch.txt",
              contentHash: "any",
              mtimeMs: 1,
              size: 1,
            },
          ],
        },
        options(),
      )
      .then(
        () => null,
        (caught: unknown) => caught,
      );
    expect(error).toBeInstanceOf(CodingRuntimeError);
    expect((error as CodingRuntimeError).code).toBe("E_CONFLICT");
    expect((error as CodingRuntimeError).path).toBe("not-in-patch.txt");
  });
});
