import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function read(file: string): string {
  return readFileSync(file, "utf8");
}

describe("UAS-04 Coding mutation consistency boundary", () => {
  const preflight = read("openclaw_runtime/src/agents/apply-patch-preflight.ts");
  const batchLock = read("openclaw_runtime/src/agents/apply-patch-batch-lock.ts");
  const applyPatch = read("openclaw_runtime/src/agents/apply-patch.ts");
  const journalEntrypoint = read("openclaw_runtime/src/agents/tools/write-journal.ts");
  const journal = read("openclaw_runtime/src/agents/tools/write-journal-core.ts");
  const toolKit = read("openclaw_runtime/src/agents/agent-tools.ts");

  it("holds path-sorted leases across preflight and mutation", () => {
    const acquire = preflight.indexOf("await acquirePatchBatchLocks");
    const readOriginals = preflight.indexOf("await readOriginals", acquire);
    const apply = preflight.indexOf("export async function applyPreparedBatch");
    expect(acquire).toBeGreaterThan(-1);
    expect(readOriginals).toBeGreaterThan(acquire);
    expect(apply).toBeGreaterThan(readOriginals);
    expect(preflight).toContain("targets.map((target) => target.resolvedPath)");
    expect(preflight).toContain("batch.release()");
    expect(batchLock).toContain("new Set(resolvedPaths.map(normalizePatchLockPath))");
    expect(batchLock).toContain(".sort()");
  });

  it("uses the existing write journal for prepared and recovery states", () => {
    expect(preflight).toContain("snapshotPreparedWrite");
    expect(preflight).toContain('setWriteJournalBatchState(batch.journalEntries, "committed")');
    expect(preflight).toContain('setWriteJournalBatchState(batch.journalEntries, batchState)');
    expect(journal).toContain('entry.batch?.state === "prepared"');
    expect(journal).toContain("writeJournalRecoveryRef");
    expect(journalEntrypoint).toContain('export * from "./write-journal-core.js"');
    expect(journalEntrypoint).toContain("undoJournalWrites(params, toRelativeWorkspacePath)");
    expect(toolKit).toContain('if (kind !== "apply_patch")');
    expect(applyPatch).toContain("write_journal: result.journal");
  });

  it("keeps post-write verify outside the rollback state machine", () => {
    expect(preflight).not.toContain("autoVerify");
    expect(preflight).not.toContain("verify outcome");
    expect(preflight).not.toContain("VerseShell");
  });
});
