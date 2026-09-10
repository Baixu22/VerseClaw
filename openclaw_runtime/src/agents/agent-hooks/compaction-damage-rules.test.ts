/**
 * M5-B2: runtime compaction damage rules — shadow-only content audit for
 * produced compaction summaries (decision_loss / entity_loss /
 * dangling_tool_reference / goal_token_decay families).
 */
import { describe, expect, it } from "vitest";
import {
  auditCompactionDamage,
  REQUIRED_COMPACTION_SECTIONS,
  scoreContextHealthFromCompactionAudit,
} from "./compaction-damage-rules.js";

describe("M5-B2 auditCompactionDamage", () => {
  it("marks a well-formed structured summary as clean", () => {
    const summary = REQUIRED_COMPACTION_SECTIONS
      .map((section) => `${section}\nEdited src/auth/middleware.ts and verified rotateToken callers.`)
      .join("\n\n");
    const audit = auditCompactionDamage(summary);
    expect(audit.verdict).toBe("clean");
    expect(audit.damages).toEqual([]);
  });

  it("flags goal_token_decay when no goal markers survive", () => {
    const summary = "Some prose with no objective, no decision, and no plan.";
    const audit = auditCompactionDamage(summary);
    expect(audit.damages.some((d) => d.type === "goal_token_decay")).toBe(true);
    expect(audit.verdict).toBe("suspect");
  });

  it("flags structure_damage for missing required sections", () => {
    const summary = "## Goal and Progress\nEdited src/auth/middleware.ts with rotate()";
    const audit = auditCompactionDamage(summary);
    expect(audit.damages.some((d) => d.type === "structure_damage")).toBe(true);
  });

  it("flags entity_loss_risk when no identifiers survive", () => {
    const summary = ["## Goal and Progress", "all done, nothing to report."].join("\n");
    const audit = auditCompactionDamage(summary);
    expect(audit.damages.some((d) => d.type === "entity_loss_risk")).toBe(true);
  });

  it("flags actionability_loss when no action verbs survive", () => {
    const summary = REQUIRED_COMPACTION_SECTIONS
      .map((section) => `${section}\nThe situation and outcome are acceptable overall.`)
      .join("\n\n");
    const audit = auditCompactionDamage(summary);
    expect(audit.damages.some((d) => d.type === "actionability_loss")).toBe(true);
  });

  it("defaults to shadow mode and never changes behavior on verdict", () => {
    const audit = auditCompactionDamage("garbage");
    expect(audit.mode).toBe("shadow");
    // Shadow contract: verdict is informational; a caller may opt into enforce.
    const enforced = auditCompactionDamage("garbage", { mode: "enforce" });
    expect(enforced.mode).toBe("enforce");
    expect(enforced.verdict).toBe("suspect");
  });
});

describe("M5-B2 B-4 bridge scoreContextHealthFromCompactionAudit", () => {
  it("scores a clean audit as fully healthy", () => {
    const summary = REQUIRED_COMPACTION_SECTIONS
      .map((section) => `${section}\nEdited src/auth/middleware.ts and verified rotateToken callers.`)
      .join("\n\n");
    const audit = auditCompactionDamage(summary);
    expect(audit.verdict).toBe("clean");
    const score = scoreContextHealthFromCompactionAudit(audit);
    expect(score.dimensions.structuralFidelity).toBe(100);
    expect(score.dimensions.goalAlignment).toBe(100);
  });

  it("lowers structuralFidelity when sections are missing", () => {
    const audit = auditCompactionDamage("## Goal and Progress\nall done.");
    const score = scoreContextHealthFromCompactionAudit(audit);
    expect(score.dimensions.structuralFidelity).toBeLessThan(100);
    // One of eight required sections survives → 13, below the 70 alert
    // threshold, so a STRUCTURE_DAMAGE reason is attached.
    expect(score.dimensions.structuralFidelity).toBe(13);
    expect(score.reasons.some((reason) => reason.startsWith("STRUCTURE_DAMAGE"))).toBe(true);
  });

  it("lowers goalAlignment when goal anchors decayed", () => {
    const audit = auditCompactionDamage("some prose with no objective or plan");
    const score = scoreContextHealthFromCompactionAudit(audit);
    expect(score.dimensions.goalAlignment).toBe(30);
    expect(score.reasons.some((reason) => reason.startsWith("GOAL_DRIFT"))).toBe(true);
  });
});
