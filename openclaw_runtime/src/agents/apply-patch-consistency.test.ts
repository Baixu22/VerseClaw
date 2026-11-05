import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyPatch,
  assertPatchParentPath,
  createApplyPatchTool,
  parsePatchText,
  resolvePatchPath,
  type ApplyPatchOptions,
  type PatchFileOps,
} from "./apply-patch.js";
import { __resetBatchLocks, applyPreparedBatch, preflightPatch } from "./apply-patch-preflight.js";
import { decodeTextFile } from "./sessions/tools/text-file-codec.js";
import { __setEffectReceiptSink } from "./apply-patch-effect-receipt.js";
import {
  __resetWriteJournals,
  getOrCreateWriteJournal,
  listPreparedWriteJournalEntries,
} from "./tools/write-journal.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "clawx-uas04-"));
  __resetBatchLocks();
  __resetWriteJournals();
});

afterEach(async () => {
  vi.restoreAllMocks();
  syncBuiltinESMExports();
  __setEffectReceiptSink(undefined);
  __resetBatchLocks();
  __resetWriteJournals();
  await rm(dir, { recursive: true, force: true });
});

function patchLines(...lines: string[]): string {
  return ["*** Begin Patch", ...lines, "*** End Patch"].join("\n");
}

function options(journal = false): ApplyPatchOptions {
  return {
    cwd: dir,
    workspaceOnly: false,
    ...(journal
      ? {
          journal: {
            workspaceRoot: dir,
            sessionId: "uas-04",
            requestId: "batch-1",
            enabled: true,
          },
        }
      : {}),
  };
}

function hostFileOps(): PatchFileOps {
  return {
    exists: async (filePath) => {
      try {
        return (await stat(filePath)).isFile();
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
        throw error;
      }
    },
    readFile: async (filePath) => decodeTextFile(await readFile(filePath), filePath),
    writeFile: async (filePath, content) => {
      await writeFile(filePath, content);
    },
    remove: async (filePath) => {
      await rm(filePath);
    },
    mkdirp: async (dirPath) => {
      await mkdir(dirPath, { recursive: true });
    },
  };
}

function prepare(
  hunks: ReturnType<typeof parsePatchText>["hunks"],
  applyOptions: ApplyPatchOptions,
  fileOps: PatchFileOps,
) {
  return preflightPatch(hunks, applyOptions, fileOps, {
    resolvePath: (filePath, aliasPolicy) => resolvePatchPath(filePath, applyOptions, aliasPolicy),
    assertParentPath: (filePath) => assertPatchParentPath(filePath, applyOptions),
  });
}

function replace(path: string, from: string, to: string): string[] {
  return ["*** Update File: " + path, "@@", `-${from}`, `+${to}`];
}

describe("UAS-04 preflight", () => {
  it("touches no files when a later target is missing", async () => {
    await writeFile(join(dir, "a.txt"), "aaa\n");
    const patch = patchLines(
      ...replace("a.txt", "aaa", "bbb"),
      ...replace("missing.txt", "missing", "value"),
    );

    await expect(applyPatch(patch, options(true))).rejects.toThrow(/file not found/);
    expect(await readFile(join(dir, "a.txt"), "utf8")).toBe("aaa\n");
    await expect(stat(join(dir, ".openclaw"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("reports every committed add, update, and delete", async () => {
    await writeFile(join(dir, "update.txt"), "old\n");
    await writeFile(join(dir, "delete.txt"), "remove\n");
    const result = await applyPatch(
      patchLines(
        "*** Add File: add.txt",
        "+created",
        ...replace("update.txt", "old", "new"),
        "*** Delete File: delete.txt",
      ),
      options(),
    );

    expect(result).toMatchObject({
      batchState: "committed",
      summary: {
        added: ["add.txt"],
        modified: ["update.txt"],
        deleted: ["delete.txt"],
      },
      modifiedFiles: ["add.txt", "update.txt", "delete.txt"],
    });
  });
});

describe("UAS-04 rollback and recovery", () => {
  it("restores earlier writes when a later write fails", async () => {
    await writeFile(join(dir, "a.txt"), "a0\n");
    await writeFile(join(dir, "b.txt"), "b0\n");
    const parsed = parsePatchText(
      patchLines(...replace("a.txt", "a0", "a1"), ...replace("b.txt", "b0", "b1")),
    );
    const fileOps = hostFileOps();
    const batch = await prepare(parsed.hunks, options(), fileOps);
    let writes = 0;
    const failingOps: PatchFileOps = {
      ...fileOps,
      writeFile: async (filePath, content) => {
        writes += 1;
        if (writes === 2) throw new Error("disk write failed");
        await fileOps.writeFile(filePath, content);
      },
    };

    const result = await applyPreparedBatch(batch, options(), failingOps);
    expect(result.batchState).toBe("rolled_back");
    expect(result.modifiedFiles).toEqual(["a.txt", "b.txt"]);
    expect(await readFile(join(dir, "a.txt"), "utf8")).toBe("a0\n");
    expect(await readFile(join(dir, "b.txt"), "utf8")).toBe("b0\n");
  });

  it("retains journal entries and a recovery reference when rollback fails", async () => {
    await writeFile(join(dir, "a.txt"), "a0\n");
    await writeFile(join(dir, "b.txt"), "b0\n");
    const parsed = parsePatchText(
      patchLines(...replace("a.txt", "a0", "a1"), ...replace("b.txt", "b0", "b1")),
    );
    const fileOps = hostFileOps();
    const applyOptions = options(true);
    const batch = await prepare(parsed.hunks, applyOptions, fileOps);
    let writes = 0;
    const failingOps: PatchFileOps = {
      ...fileOps,
      writeFile: async (filePath, content) => {
        writes += 1;
        if (writes >= 2) throw new Error("persistent disk failure");
        await fileOps.writeFile(filePath, content);
      },
    };

    const result = await applyPreparedBatch(batch, applyOptions, failingOps);
    expect(result.batchState).toBe("recovery_required");
    expect(result.recoveryRef).toContain(".openclaw");
    expect(result.recoveryRef).toContain("batch=batch-1");
    __resetWriteJournals();
    const recovered = getOrCreateWriteJournal(dir, "uas-04").entries;
    expect(recovered).toHaveLength(2);
    expect(recovered.every((entry) => entry.batch?.state === "recovery_required")).toBe(true);
  });

  it("restores both sides when a move fails after writing its destination", async () => {
    await writeFile(join(dir, "source.txt"), "source\n");
    await writeFile(join(dir, "destination.txt"), "destination\n");
    const parsed = parsePatchText(
      patchLines(
        "*** Update File: source.txt",
        "*** Move to: destination.txt",
        "@@",
        "-source",
        "+moved",
      ),
    );
    const fileOps = hostFileOps();
    const batch = await prepare(parsed.hunks, options(), fileOps);
    const failingOps: PatchFileOps = {
      ...fileOps,
      remove: async () => {
        throw new Error("source unlink failed");
      },
    };

    const result = await applyPreparedBatch(batch, options(), failingOps);
    expect(result.batchState).toBe("rolled_back");
    expect(await readFile(join(dir, "source.txt"), "utf8")).toBe("source\n");
    expect(await readFile(join(dir, "destination.txt"), "utf8")).toBe("destination\n");
  });
});

describe("UAS-04 lease and restart semantics", () => {
  it('exposes incomplete persistence through the real tool error without repeating file effects', async () => {
    await writeFile(join(dir, 'a.txt'), 'before\n');
    const originalWrite = fs.writeFileSync;
    vi.spyOn(fs, 'writeFileSync').mockImplementation((file, data, opts) => {
      if (String(file).endsWith('.meta.json') && String(data).includes('"state":"committed"')) {
        throw new Error('injected terminal metadata write failure');
      }
      return originalWrite(file, data, opts);
    });
    syncBuiltinESMExports();
    const tool = createApplyPatchTool({ cwd: dir, journal: { workspaceRoot: dir, sessionId: 'tool-durable', enabled: true } });
    await expect(tool.execute('tool-batch', { input: patchLines(...replace('a.txt', 'before', 'after')) }, undefined))
      .rejects.toMatchObject({ batchState: 'recovery_required', effectApplied: true, journalStatePersisted: false,
        recoveryRef: expect.stringContaining('batch=tool-batch') });
    expect(await readFile(join(dir, 'a.txt'), 'utf8')).toBe('after\n');
    __resetWriteJournals();
    expect(getOrCreateWriteJournal(dir, 'tool-durable').entries[0]?.batch?.state).toBe('prepared');
  });

  it('reports missing prepared journal evidence after a snapshot storage failure', async () => {
    await writeFile(join(dir, 'a.txt'), 'before\n');
    await mkdir(join(dir, '.openclaw'));
    await writeFile(join(dir, '.openclaw', 'journal'), 'blocked journal directory');
    const fileOps = hostFileOps();
    const applyOptions = options(true);
    const batch = await prepare(parsePatchText(patchLines(...replace('a.txt', 'before', 'after'))).hunks, applyOptions, fileOps);
    expect(batch.journalEntries).toHaveLength(0);
    const result = await applyPreparedBatch(batch, applyOptions, fileOps);
    expect(result).toMatchObject({ batchState: 'recovery_required', effectApplied: true, journalStatePersisted: false });
    expect(result.recoveryRef).toContain('batch=batch-1');
    expect(result.journal).toBeUndefined();
    expect(await readFile(join(dir, 'a.txt'), 'utf8')).toBe('after\n');
  });

  it('retains reconciliation evidence when file rollback succeeds but journal rollback cannot persist', async () => {
    await writeFile(join(dir, 'a.txt'), 'before\n');
    const ops = hostFileOps();
    const opts = options(true);
    const batch = await prepare(parsePatchText(patchLines(...replace('a.txt', 'before', 'after'))).hunks, opts, ops);
    const meta = batch.journalEntries[0].snapshotPath + '.meta.json';
    await chmod(meta, 0o444);
    let writes = 0;
    try {
      const result = await applyPreparedBatch(batch, opts, { ...ops, writeFile: async (file, bytes) => {
        await ops.writeFile(file, bytes);
        if (++writes === 1) throw new Error('write acknowledgement failed');
      } });
      expect(result).toMatchObject({ batchState: 'recovery_required', effectApplied: false, journalStatePersisted: false });
      expect(result.recoveryRef).toContain('batch=batch-1');
      expect(await readFile(join(dir, 'a.txt'), 'utf8')).toBe('before\n');
      expect(JSON.parse(await readFile(meta, 'utf8')).batch.state).toBe('prepared');
    } finally { await chmod(meta, 0o666); }
  });

  it.each(['readonly', 'storage-failure'] as const)('does not claim a durable commit after %s terminal persistence failure', async (failure) => {
    await writeFile(join(dir, 'a.txt'), 'before\n');
    const fileOps = hostFileOps();
    const applyOptions = options(true);
    const batch = await prepare(parsePatchText(patchLines(...replace('a.txt', 'before', 'after'))).hunks, applyOptions, fileOps);
    const meta = batch.journalEntries[0].snapshotPath + '.meta.json';
    const receipts: Array<{ outcome: string }> = [];
    __setEffectReceiptSink({ record: (receipt) => { receipts.push(receipt); } });
    if (failure === 'readonly') await chmod(meta, 0o444);
    else { await rm(meta); await mkdir(meta); }
    try {
      const result = await applyPreparedBatch(batch, applyOptions, fileOps);
      expect(result.batchState).toBe('recovery_required');
      expect(result).toMatchObject({ effectApplied: true, journalStatePersisted: false });
      expect(result.text).toMatch(/do not replay/i);
      expect(result.recoveryRef).toContain('batch=batch-1');
      expect(await readFile(join(dir, 'a.txt'), 'utf8')).toBe('after\n');
      expect(receipts).toHaveLength(1);
      expect(receipts[0].outcome).toBe('unknown');
      expect(batch.journalEntries[0].batch?.state).toBe('prepared');
      if (failure === 'readonly') {
        expect(JSON.parse(await readFile(meta, 'utf8')).batch.state).toBe('prepared');
        __resetWriteJournals();
        expect(getOrCreateWriteJournal(dir, 'uas-04').entries[0]?.batch?.state).toBe('prepared');
      }
    } finally {
      if (failure === 'readonly') await chmod(meta, 0o666);
    }
  });

  it("journals exactly once inside the production tool batch lease", async () => {
    await writeFile(join(dir, "a.txt"), "a0\n");
    const tool = createApplyPatchTool({
      cwd: dir,
      workspaceOnly: false,
      journal: { workspaceRoot: dir, sessionId: "uas-04", enabled: true },
    });
    const result = await tool.execute(
      "tool-call-1",
      { input: patchLines(...replace("a.txt", "a0", "a1")) },
      undefined,
    );

    expect(result.details).toMatchObject({
      batchState: "committed",
      write_journal: {
        batchId: "tool-call-1",
        undoable: true,
        snapshots: [{ path: "a.txt" }],
      },
    });
    expect(getOrCreateWriteJournal(dir, "uas-04").entries).toHaveLength(1);
  });

  it("detects a prepared journal batch after in-memory state is reset", async () => {
    await writeFile(join(dir, "a.txt"), "a0\n");
    const parsed = parsePatchText(patchLines(...replace("a.txt", "a0", "a1")));
    const batch = await prepare(parsed.hunks, options(true), hostFileOps());
    batch.release();

    __resetWriteJournals();
    const prepared = listPreparedWriteJournalEntries(dir, "uas-04");
    expect(prepared).toHaveLength(1);
    expect(prepared[0]?.batch).toEqual({ id: "batch-1", state: "prepared" });
  });

  it("serializes overlapping patches before preflight and rejects stale context", async () => {
    await writeFile(join(dir, "shared.txt"), "base\n");
    const first = applyPatch(patchLines(...replace("shared.txt", "base", "first")), options());
    const second = applyPatch(patchLines(...replace("shared.txt", "base", "second")), options());

    const settled = await Promise.allSettled([first, second]);
    expect(settled.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(settled.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(["first\n", "second\n"]).toContain(await readFile(join(dir, "shared.txt"), "utf8"));
  });
});
