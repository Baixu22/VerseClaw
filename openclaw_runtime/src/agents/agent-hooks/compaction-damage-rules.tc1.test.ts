/**
 * T-C1 (TF-0128): the compaction damage detector must actually be able to fire.
 *
 * Before this task the detector was unfireable on the failure mode it was built
 * for. `GOAL_ANCHOR_PATTERN` accepted `DECISIONS?` / `CONSTRAINTS?` as evidence
 * that the goal survived, and decision/constraint headings are part of the
 * required contract — so any structurally-complete summary was scored
 * goal-intact no matter what it said. A summary hollowed out to nothing but the
 * required headings and the word "None." passed both `structure_damage` and
 * `goal_token_decay`, and the health bridge reported overall 100 with no reasons.
 *
 * These tests pin the fix and would each have failed before it.
 */
import { describe, expect, it } from "vitest";
import {
  auditCompactionDamage,
  GOAL_RETENTION_MIN_COVERAGE,
  REQUIRED_COMPACTION_SECTIONS,
  scoreContextHealthFromCompactionAudit,
} from "./compaction-damage-rules.js";
import { stripRequiredSectionHeadings } from "./compaction-sections.js";

/** A summary with every required section present and no content whatsoever. */
function hollowedSummary(): string {
  return REQUIRED_COMPACTION_SECTIONS.map((section) => `${section}\nNone.`).join("\n\n");
}

describe("T-C1 AC-1: a structurally-complete but hollowed summary is goal-decayed", () => {
  it("flags goal_token_decay on the required-section None. summary (previously judged clean)", () => {
    const audit = auditCompactionDamage(hollowedSummary());
    // The whole point: structure is intact, so structure_damage must NOT fire...
    expect(audit.missingSectionCount).toBe(0);
    expect(audit.damages.some((damage) => damage.type === "structure_damage")).toBe(false);
    // ...while goal decay MUST, because there is no goal content left.
    const goalDecay = audit.damages.find((damage) => damage.type === "goal_token_decay");
    expect(goalDecay).toBeDefined();
    expect(goalDecay?.severity).toBe("critical");
    expect(audit.verdict).toBe("suspect");
  });

  it("propagates the decay into the health bridge instead of reporting a perfect score", () => {
    const score = scoreContextHealthFromCompactionAudit(auditCompactionDamage(hollowedSummary()));
    expect(score.dimensions.goalAlignment).toBeLessThan(70);
    expect(score.overall).toBeLessThan(100);
    expect(score.reasons.some((reason) => reason.startsWith("GOAL_DRIFT"))).toBe(true);
  });

  it("does not regress the real case: a genuine summary with the same sections stays clean", () => {
    const real = REQUIRED_COMPACTION_SECTIONS
      .map((section) => `${section}\nEdited src/auth/middleware.ts and verified rotateKey callers.`)
      .join("\n\n");
    const audit = auditCompactionDamage(real);
    expect(audit.damages.some((damage) => damage.type === "goal_token_decay")).toBe(false);
    expect(audit.missingSectionCount).toBe(0);
  });

  it("keeps the goal check orthogonal to the section contract", () => {
    // Section headings alone must not constitute goal evidence...
    const headingsOnly = REQUIRED_COMPACTION_SECTIONS.join("\n");
    expect(
      auditCompactionDamage(headingsOnly).damages.some((d) => d.type === "goal_token_decay"),
    ).toBe(true);
    // ...and stripping them is what makes that true.
    const stripped = stripRequiredSectionHeadings(headingsOnly);
    for (const section of REQUIRED_COMPACTION_SECTIONS) {
      expect(stripped).not.toContain(section);
    }
    expect(stripped.trim()).toBe("");
  });
});

describe("T-C1 AC-1: objective-based goal detection", () => {
  const objective = "migrate the session store to SQLite and drop the JSON file";

  it("uses objective coverage when an objective is supplied", () => {
    const retained = auditCompactionDamage(
      `## Decisions\n${objective} — done for the main store.`,
      { objective },
    );
    expect(retained.damages.some((damage) => damage.type === "goal_token_decay")).toBe(false);
  });

  it("flags decay when the objective's language is gone, even with sections intact", () => {
    const audit = auditCompactionDamage(hollowedSummary(), { objective });
    const goalDecay = audit.damages.find((damage) => damage.type === "goal_token_decay");
    expect(goalDecay).toBeDefined();
    // The detail must name the measured basis so a reviewer can tell an
    // objective miss from a fallback miss.
    expect(goalDecay?.detail).toContain("coverage");
  });

  it("threshold sits below the health monitor's goalAlignment alert level", () => {
    // Keeps the binary flag from firing later than the graded dimension warns.
    expect(GOAL_RETENTION_MIN_COVERAGE).toBeGreaterThan(0);
    expect(GOAL_RETENTION_MIN_COVERAGE).toBeLessThan(0.7);
  });
});

describe("T-C1 AC-3: Chinese summaries", () => {
  const objective = "把损伤检测器与摘要章节契约解耦";

  it("detects a retained Chinese goal", () => {
    const audit = auditCompactionDamage(
      `## Decisions\n${objective}，已完成并补了测试。`,
      { objective },
    );
    expect(audit.damages.some((damage) => damage.type === "goal_token_decay")).toBe(false);
  });

  it("detects a decayed Chinese goal", () => {
    const audit = auditCompactionDamage(hollowedSummary(), { objective });
    expect(audit.damages.some((damage) => damage.type === "goal_token_decay")).toBe(true);
  });

  it("recognizes Chinese goal anchors in the fallback path", () => {
    // No objective supplied -> anchor fallback; Chinese anchors must work there.
    const audit = auditCompactionDamage("目标：完成 SQLite 迁移\n修复了 store.ts 的写入路径");
    expect(audit.damages.some((damage) => damage.type === "goal_token_decay")).toBe(false);
  });

  it("recognizes Chinese action verbs (actionability_loss stays quiet)", () => {
    const audit = auditCompactionDamage(
      "目标：完成迁移\n已修复 store.ts 的写入路径，并重构了 loader.ts",
    );
    expect(audit.damages.some((damage) => damage.type === "actionability_loss")).toBe(false);
  });

  it("flags actionability_loss on Chinese prose with no action verb", () => {
    const audit = auditCompactionDamage("目标：情况已被评估\n结论是可以接受的，无需其他说明。");
    expect(audit.damages.some((damage) => damage.type === "actionability_loss")).toBe(true);
  });
});
