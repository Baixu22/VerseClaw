/**
 * #178: a located compaction must keep the untouched (retained) side of the
 * transcript byte-identical - only the compaction entry is added. This drives
 * the real transcript state/writer with the cut point that `prepareCompaction`
 * selects for an explicit `keepFromEntryId`.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { prepareCompaction } from "../../../packages/agent-core/src/harness/compaction/compaction.js";
import { CURRENT_SESSION_VERSION } from "../../config/sessions/version.js";
import { readTranscriptFileState, writeTranscriptFileAtomic } from "./transcript-file-state.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function messageEntry(id: string, parentId: string | null, role: "user" | "assistant", text: string) {
  return {
    type: "message",
    id,
    parentId,
    timestamp: "2026-01-01T00:00:00.000Z",
    message:
      role === "assistant"
        ? { role, content: [{ type: "text", text }], provider: "test", model: "test", timestamp: 1 }
        : { role, content: text, timestamp: 1 },
  };
}

describe("#178 located compaction transcript surgery", () => {
  it("pins the cut point from prepareCompaction and leaves the retained entries byte-identical", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "ranged-compaction-"));
    roots.push(root);
    const file = path.join(root, "session.jsonl");
    const header = {
      type: "session",
      version: CURRENT_SESSION_VERSION,
      id: "sess-1",
      timestamp: "2026-01-01T00:00:00.000Z",
      cwd: root,
    };
    const filler = "x".repeat(4000);
    const entries = [
      messageEntry("e1", null, "user", `q1 ${filler}`),
      messageEntry("e2", "e1", "assistant", `a1 ${filler}`),
      messageEntry("e3", "e2", "user", `q2 ${filler}`),
      messageEntry("e4", "e3", "assistant", `a2 ${filler}`),
    ];
    writeFileSync(file, `${[header, ...entries].map((entry) => JSON.stringify(entry)).join("\n")}\n`, "utf-8");
    const originalLines = readFileSync(file, "utf-8").trim().split("\n");

    const state = await readTranscriptFileState(file);
    const preparation = prepareCompaction(
      state.getEntries() as never,
      { enabled: true, reserveTokens: 16_384, keepRecentTokens: 1_000, keepFromEntryId: "e3" },
    );
    expect(preparation.ok).toBe(true);
    if (!preparation.ok || !preparation.value) throw new Error("expected a preparation");
    // The located boundary pinned the retained tail to e3.
    expect(preparation.value.firstKeptEntryId).toBe("e3");

    const compactionEntry = {
      type: "compaction",
      id: "c1",
      parentId: "e4",
      timestamp: "2026-01-02T00:00:00.000Z",
      summary: "Summarized the first turn.",
      firstKeptEntryId: preparation.value.firstKeptEntryId,
      tokensBefore: 2000,
    };
    await writeTranscriptFileAtomic(file, [header, ...entries, compactionEntry] as never);

    const rewrittenLines = readFileSync(file, "utf-8").trim().split("\n");
    // Every original entry (header + all four messages) is byte-identical; only
    // the new compaction entry is appended.
    expect(rewrittenLines.slice(0, originalLines.length)).toEqual(originalLines);
    expect(rewrittenLines).toHaveLength(originalLines.length + 1);
    expect(JSON.parse(rewrittenLines[rewrittenLines.length - 1] as string)).toMatchObject({
      type: "compaction",
      firstKeptEntryId: "e3",
    });
  });
});