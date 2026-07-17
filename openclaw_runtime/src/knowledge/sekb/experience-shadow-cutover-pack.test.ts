import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { assessExperienceShadowWindow } from "./experience-shadow-product.js";
import {
  buildManualCutoverPack,
  seedExperienceShadowStableWindow,
} from "./experience-shadow-cutover-pack.js";

describe("experience-shadow-cutover-pack (Goal B / B2)", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "c7h-cutover-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("seeds multi-day stable window and never allows cutover", () => {
    const now = Date.UTC(2026, 6, 15, 12, 0, 0);
    seedExperienceShadowStableWindow({
      workspaceRoot: root,
      eventCount: 20,
      windowDays: 15,
      allAccepted: true,
      nowMs: now,
    });
    const assessment = assessExperienceShadowWindow({
      workspaceRoot: root,
      requiredDays: 14,
      nowMs: now,
    });
    expect(assessment.eventCount).toBe(20);
    expect(assessment.stableWindowMet).toBe(true);
    expect(assessment.cutoverAllowed).toBe(false);

    const pack = buildManualCutoverPack({
      workspaceRoot: root,
      requiredDays: 14,
      nowMs: now,
      productReviewRequested: false,
    });
    expect(pack.cutoverAllowed).toBe(false);
    expect(pack.cutoverRecommended).toBe(false);
    expect(pack.defaultsUnchanged).toBe(true);
    expect(pack.assessment.stableWindowMet).toBe(true);
    expect(pack.manualSteps.length).toBeGreaterThan(3);
    expect(pack.killSwitch.experienceShadowFlag).toContain("experienceShadow");
  });

  it("cutoverRecommended advisory only when product review requested + stable", () => {
    const now = Date.UTC(2026, 6, 15, 12, 0, 0);
    seedExperienceShadowStableWindow({
      workspaceRoot: root,
      windowDays: 15,
      allAccepted: true,
      nowMs: now,
    });
    const pack = buildManualCutoverPack({
      workspaceRoot: root,
      requiredDays: 14,
      nowMs: now,
      productReviewRequested: true,
    });
    expect(pack.cutoverRecommended).toBe(true);
    expect(pack.cutoverAllowed).toBe(false);
  });

  it("harm events block stable window", () => {
    const now = Date.UTC(2026, 6, 15, 12, 0, 0);
    seedExperienceShadowStableWindow({
      workspaceRoot: root,
      windowDays: 15,
      allAccepted: false,
      nowMs: now,
    });
    const pack = buildManualCutoverPack({
      workspaceRoot: root,
      requiredDays: 14,
      nowMs: now,
      productReviewRequested: true,
    });
    expect(pack.assessment.stableWindowMet).toBe(false);
    expect(pack.cutoverRecommended).toBe(false);
    expect(pack.cutoverAllowed).toBe(false);
  });
});
