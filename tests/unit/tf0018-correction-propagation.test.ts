import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createRoleMemoryContextProvider } from "../../openclaw_runtime/src/context-engine/role-memory-context-provider";
import {
  clearMemoryCards,
  getMemoryCard,
  listMemoryProposals,
  proposeMemoryCard,
  reviewMemoryProposalRecord,
  revokePoisonedMemoryCard,
  setMemoryStorePath,
  supersedeMemoryCard,
} from "../../openclaw_runtime/src/memory/memory-store";

describe("TF-0018 correction and deletion propagation", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "tf0018-correction-"));
    setMemoryStorePath(join(tempDir, "role-memory.sqlite"));
    clearMemoryCards();
  });

  afterEach(() => {
    clearMemoryCards();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("links corrections and injects only current, non-revoked cards", async () => {
    const original = proposeMemoryCard({
      type: "preference",
      scope: "role",
      roleTags: ["architect"],
      content: "Use the legacy deployment region for new services.",
      confidence: 0.9,
      importance: 0.6,
      source: "user",
      evidenceRefs: [{ type: "manual", ref: "review:original" }],
    });
    expect(original.card).toBeDefined();

    const corrected = supersedeMemoryCard(original.card!.id, {
      type: "preference",
      scope: "role",
      roleTags: ["architect"],
      content: "Use the primary deployment region for new services.",
      confidence: 0.95,
      importance: 0.7,
      source: "user",
      evidenceRefs: [{ type: "manual", ref: "review:correction" }],
    });
    const correctionProposalId = corrected.proposal?.id;
    expect(corrected.accepted).toBe(true);
    expect(correctionProposalId).toMatch(/^prop_/);
    expect(getMemoryCard(original.card!.id)).toMatchObject({
      status: "archived",
      supersededBy: corrected.card?.id,
      correctionRef: correctionProposalId,
    });
    expect(getMemoryCard(corrected.card!.id)).toMatchObject({
      status: "active",
      supersedes: original.card!.id,
      correctionRef: correctionProposalId,
    });

    const reviewedProposal = proposeMemoryCard({
      type: "constraint",
      scope: "role",
      roleTags: ["architect"],
      content: "Reviewed deployments must rehearse migrations before release.",
      confidence: 0.9,
      importance: 0.5,
      source: "session_summary",
      evidenceRefs: [{ type: "session", ref: "session:tf0018:reviewed" }],
    });
    expect(reviewedProposal.action).toBe("needs_review");
    const reviewed = reviewMemoryProposalRecord(reviewedProposal.proposal!.id, "approve", {
      actor: { type: "user", id: "reviewer" },
    });
    expect(reviewed.card?.correctionRef).toBe(reviewedProposal.proposal!.id);
    expect(getMemoryCard(reviewed.card!.id)?.correctionRef).toBe(reviewedProposal.proposal!.id);

    const poisoned = proposeMemoryCard({
      type: "fact",
      scope: "role",
      roleTags: ["architect"],
      content: "An untrusted import supplied temporary deployment guidance.",
      confidence: 0.9,
      importance: 0.5,
      source: "user",
      evidenceRefs: [{ type: "manual", ref: "review:poison" }],
    });
    const revoked = revokePoisonedMemoryCard(poisoned.card!.id, {
      actor: { type: "user", id: "reviewer" },
      reason: "Reviewer confirmed poisoned provenance.",
    });
    expect(revoked).toMatchObject({ status: "tombstone" });
    expect(revoked?.correctionRef).toMatch(/^prop_/);
    expect(listMemoryProposals({ limit: 50 })).toContainEqual(
      expect.objectContaining({
        id: revoked?.correctionRef,
        operation: "tombstone",
        status: "applied",
      }),
    );

    const provider = createRoleMemoryContextProvider({ resolveRoleName: () => "architect" });
    const result = await provider.getContext({ goal: "Prepare the next deployment", tokenBudget: 2048 });
    const injected = result.contextItems.map((item) => item.text).join("\n");

    expect(result.status).toBe("success");
    expect(injected).toContain("Use the primary deployment region");
    expect(injected).toContain("Reviewed deployments must rehearse migrations");
    expect(injected).not.toContain("legacy deployment region");
    expect(injected).not.toContain("untrusted import");
  });
});
