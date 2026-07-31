import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  clearMemoryCards,
  getMemoryCard,
  getMemoryCards,
  listMemoryConflicts,
  proposeMemoryCard,
  setMemoryStorePath,
} from "../../openclaw_runtime/src/memory/memory-store";

describe("TF-0018 conflict handling", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "tf0018-conflict-"));
    setMemoryStorePath(join(tempDir, "role-memory.sqlite"));
    clearMemoryCards();
  });

  afterEach(() => {
    clearMemoryCards();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("keeps the active fact unchanged when a contradictory proposal arrives", () => {
    const active = proposeMemoryCard({
      type: "fact",
      scope: "role",
      roleTags: ["operator"],
      content: "Feature X is not enabled.",
      confidence: 0.95,
      importance: 0.6,
      source: "user",
      evidenceRefs: [{ type: "manual", ref: "review:feature-x-disabled" }],
    });
    expect(active.card).toBeDefined();

    const conflicting = proposeMemoryCard({
      type: "fact",
      scope: "role",
      roleTags: ["operator"],
      content: "Feature X is enabled.",
      confidence: 0.95,
      importance: 0.6,
      source: "user",
      evidenceRefs: [{ type: "manual", ref: "review:feature-x-enabled" }],
    });

    expect(conflicting.accepted).toBe(false);
    expect(conflicting.action).toBe("needs_review");
    expect(conflicting.proposal?.status).toBe("needs_review");
    expect(conflicting.conflicts).toEqual([
      expect.objectContaining({ type: "contradiction", cardIds: [active.card!.id] }),
    ]);
    expect(listMemoryConflicts({ status: "open" })).toContainEqual(
      expect.objectContaining({ type: "contradiction", cardIds: [active.card!.id] }),
    );
    expect(getMemoryCards({ status: "all" })).toHaveLength(1);
    expect(getMemoryCard(active.card!.id)?.content).toBe("Feature X is not enabled.");
  });

  it("detects a contradiction regardless of which polarity was stored first", () => {
    const active = proposeMemoryCard({
      type: "fact",
      scope: "role",
      roleTags: ["operator"],
      content: "Feature X is enabled.",
      confidence: 0.95,
      importance: 0.6,
      source: "user",
      evidenceRefs: [{ type: "manual", ref: "review:feature-x-enabled" }],
    });
    expect(active.accepted).toBe(true);

    const contradictory = proposeMemoryCard({
      type: "fact",
      scope: "role",
      roleTags: ["operator"],
      content: "Feature X is not enabled.",
      confidence: 0.95,
      importance: 0.6,
      source: "user",
      evidenceRefs: [{ type: "manual", ref: "review:feature-x-disabled" }],
    });

    expect(contradictory).toMatchObject({ accepted: false, action: "needs_review" });
    expect(contradictory.conflicts).toContainEqual(
      expect.objectContaining({ type: "contradiction", cardIds: [active.card!.id] }),
    );
    expect(getMemoryCards({ status: "all" })).toHaveLength(1);
  });
});
