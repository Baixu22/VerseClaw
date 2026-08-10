import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  assessExperienceShadowWindow,
  productizeExperienceShadow,
  readExperienceShadowEvents,
} from "./experience-shadow-product.js";
import { buildExperienceBlock } from "./experience-block-bridge.js";
import type { DistillationSuggestion, Principle } from "./types.js";

function makePrinciple(overrides: Partial<Principle> = {}): Principle {
  return {
    principle_id: "principle-001",
    created_at: "2026-07-12T00:00:00.000Z",
    updated_at: "2026-07-12T00:00:00.000Z",
    title: "Prefer small diffs",
    condition: "When editing multi-file modules",
    action: "Prefer small diffs",
    reason: "Reduces conflict rate",
    full_content:
      "When editing multi-file modules, Prefer small diffs because Reduces conflict rate.",
    task_types: ["coding"],
    context_tags: ["edit"],
    embedding: null,
    source_trajectories: ["traj-001"],
    created_by: "distiller",
    status: "staging",
    retrieval_count: 0,
    adoption_count: 0,
    post_adoption_success: 0,
    criticality: "medium",
    pinned: false,
    metadata: {},
    ...overrides,
  };
}

function makeSuggestion(): DistillationSuggestion {
  return {
    cluster_summary: "coding edit trajectories",
    source_trajectory_ids: ["traj-001"],
    suggested_principle: {
      title: "Prefer small diffs",
      task_types: ["coding"],
      context_tags: ["edit"],
      criticality: "medium",
    },
    confidence: 0.9,
  };
}

describe("experience-shadow-product (C7-H)", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "exp-shadow-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("disabled flag does not journal or produce block", () => {
    const r = productizeExperienceShadow({
      workspaceRoot: root,
      enabled: false,
      dualWrite: false,
      buildBlock: (build) => buildExperienceBlock(build),
      build: {
        principle: makePrinciple({ principle_id: "p1" }),
        suggestion: makeSuggestion(),
        sessionId: "s1",
      },
    });
    expect(r.block).toBeUndefined();
    expect(r.journaled).toBe(false);
    expect(readExperienceShadowEvents(root)).toHaveLength(0);
  });

  it("enabled shadow journals without cutover", () => {
    const r = productizeExperienceShadow({
      workspaceRoot: root,
      enabled: true,
      dualWrite: true,
      buildBlock: (build) => buildExperienceBlock(build),
      build: {
        principle: makePrinciple({ principle_id: "p2" }),
        suggestion: makeSuggestion(),
        sessionId: "s2",
      },
    });
    expect(r.block?.block_type).toBe("experience");
    expect(r.journaled).toBe(true);
    const events = readExperienceShadowEvents(root);
    expect(events).toHaveLength(1);
    expect(events[0]?.mode).toBe("dual-write-shadow");
  });

  it("assessment never allows cutover even when window metrics look good", () => {
    productizeExperienceShadow({
      workspaceRoot: root,
      enabled: true,
      dualWrite: false,
      buildBlock: (build) => buildExperienceBlock(build),
      build: {
        principle: makePrinciple({ principle_id: "p3" }),
        suggestion: makeSuggestion(),
        sessionId: "s3",
      },
    });
    const assessment = assessExperienceShadowWindow({
      workspaceRoot: root,
      requiredDays: 0,
      nowMs: Date.now() + 15 * 24 * 60 * 60 * 1000,
    });
    expect(assessment.cutoverAllowed).toBe(false);
  });
});