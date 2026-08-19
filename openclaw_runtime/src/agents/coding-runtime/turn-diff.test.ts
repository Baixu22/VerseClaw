import { describe, expect, it } from "vitest";
import {
  buildVersionConflictDiff,
  normalizeTurnText,
  TurnDiffTracker,
} from "./turn-diff.js";
import type { FileVersion } from "../../../../shared/coding-runtime/types.js";

describe("normalizeTurnText", () => {
  it("strips BOM, records the original line ending, and normalizes to LF", () => {
    const normalized = normalizeTurnText("\uFEFFalpha\r\nbeta\r\n");
    expect(normalized.text).toBe("alpha\nbeta\n");
    expect(normalized.lineEnding).toBe("\r\n");
    expect(normalized.bytes).toBe(Buffer.byteLength("\uFEFFalpha\r\nbeta\r\n", "utf8"));
  });

  it("falls back to LF for BOM-only content", () => {
    expect(normalizeTurnText("\uFEFF").lineEnding).toBe("\n");
  });
});

describe("TurnDiffTracker", () => {
  it("accumulates one per-file diff across repeated edits in a turn", () => {
    const tracker = new TurnDiffTracker();
    tracker.recordFileChange({ path: "src/a.ts", oldText: "one\ntwo\n", newText: "one\nTWO\n" });
    tracker.recordFileChange({ path: "src/a.ts", oldText: "one\nTWO\n", newText: "ONE\nTWO\n" });

    const change = tracker.changeForPath("src/a.ts");
    expect(change?.oldText).toBe("one\ntwo\n");
    expect(change?.newText).toBe("ONE\nTWO\n");
    const diff = tracker.diffForPath("src/a.ts");
    expect(diff).toContain("-one");
    expect(diff).toContain("+ONE");
    expect(tracker.diff()).toBe(diff);
  });

  it("tracks add and delete in the same turn", () => {
    const tracker = new TurnDiffTracker();
    tracker.recordFileChange({ path: "added.txt", newText: "created\n" });
    tracker.recordFileChange({ path: "removed.txt", oldText: "gone\n" });

    expect(tracker.changeForPath("added.txt")?.status).toBe("added");
    expect(tracker.changeForPath("removed.txt")?.status).toBe("deleted");
    const diff = tracker.diff();
    expect(diff).toContain("--- /dev/null");
    expect(diff).toContain("+++ added.txt");
    expect(diff).toContain("--- removed.txt");
    expect(diff).toContain("+++ /dev/null");
  });

  it("normalizes CRLF samples before diffing", () => {
    const tracker = new TurnDiffTracker();
    tracker.recordFileChange({
      path: "crlf.txt",
      oldText: "alpha\r\nbeta\r\n",
      newText: "alpha\r\nBETA\r\n",
    });
    const diff = tracker.diffForPath("crlf.txt");
    expect(diff).toContain("-beta");
    expect(diff).toContain("+BETA");
    expect(tracker.changeForPath("crlf.txt")?.lineEnding).toBe("\r\n");
  });

  it("sorts touched files and clear resets the turn", () => {
    const tracker = new TurnDiffTracker();
    tracker.recordFileChange({ path: "b.txt", oldText: "b0", newText: "b1" });
    tracker.recordFileChange({ path: "a.txt", oldText: "a0", newText: "a1" });
    const diff = tracker.diff();
    expect(diff.indexOf("a.txt")).toBeLessThan(diff.indexOf("b.txt"));
    tracker.clear();
    expect(tracker.hasChanges()).toBe(false);
    expect(tracker.diff()).toBe("");
  });

  it("is not a file-state source of truth: a no-op delta produces no diff", () => {
    const tracker = new TurnDiffTracker();
    tracker.recordFileChange({ path: "same.txt", oldText: "same\n", newText: "same\n" });
    expect(tracker.hasChanges()).toBe(false);
    expect(tracker.diffForPath("same.txt")).toBe("");
  });
});

describe("buildVersionConflictDiff", () => {
  const base: FileVersion = {
    path: "conflict.txt",
    contentHash: "base-hash",
    mtimeMs: 100,
    size: 10,
  };
  const current: FileVersion = {
    path: "conflict.txt",
    contentHash: "current-hash",
    mtimeMs: 200,
    size: 12,
  };

  it("emits a deterministic version-level unified diff when content is unavailable", () => {
    const diff = buildVersionConflictDiff({ path: "conflict.txt", baseVersion: base, currentVersion: current });
    expect(diff).toContain("--- conflict.txt");
    expect(diff).toContain("+++ conflict.txt");
    expect(diff).toContain("base-hash");
    expect(diff).toContain("current-hash");
    expect(diff).toContain("-baseVersion:");
    expect(diff).toContain("+currentVersion:");
  });

  it("prefers a real content diff when both samples are supplied", () => {
    const diff = buildVersionConflictDiff({
      path: "conflict.txt",
      baseVersion: base,
      currentVersion: current,
      baseText: "old\n",
      currentText: "new\n",
    });
    expect(diff).toContain("-old");
    expect(diff).toContain("+new");
    expect(diff).not.toContain("base-hash");
  });
});

