import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  clearMemoryCards,
  getMemoryCards,
  listMemoryProposals,
  proposeMemoryCard,
  setMemoryStorePath,
} from "../../openclaw_runtime/src/memory/memory-store";

describe("TF-0018 automatic proposals remain review-only", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "tf0018-proposal-only-"));
    setMemoryStorePath(join(tempDir, "role-memory.sqlite"));
    clearMemoryCards();
  });

  afterEach(() => {
    clearMemoryCards();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("keeps an otherwise acceptable trace proposal out of durable cards", () => {
    const decision = proposeMemoryCard({
      type: "fact",
      scope: "role",
      roleTags: ["architect"],
      content: "The deployment pipeline validates schema compatibility before release.",
      confidence: 0.95,
      importance: 0.6,
      source: "trace",
      evidenceRefs: [{ type: "trace", ref: "trace:tf0018:auto" }],
    });

    expect(decision.accepted).toBe(false);
    expect(decision.action).toBe("needs_review");
    expect(decision.proposal?.status).toBe("needs_review");
    expect(getMemoryCards({ status: "all" })).toHaveLength(0);
    expect(listMemoryProposals({ limit: 10 })).toEqual([
      expect.objectContaining({
        id: decision.proposal?.id,
        status: "needs_review",
        operation: "create",
      }),
    ]);
  });
});
