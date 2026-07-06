import { describe, expect, it } from "vitest";
import {
  extractMaxWorkers,
  extractRequestedRoles,
  extractTemplateId,
  matchOrchestrationPreset,
  type TrustedOrchestrationPreset,
} from "../../electron/services/orchestration-presets-api";

function makePreset(overrides: Partial<TrustedOrchestrationPreset> = {}): TrustedOrchestrationPreset {
  return {
    id: "preset-1",
    workspaceId: "ws-1",
    label: "Daily review team",
    allowedRoles: ["planner", "implementer", "tester", "reviewer"],
    maxWorkers: 4,
    approvedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("orchestration-presets (Area 3 §3.3)", () => {
  describe("matchOrchestrationPreset — boundary conditions (§8)", () => {
    it("matches when request is within preset scope (subset roles, ≤ maxWorkers)", () => {
      const preset = makePreset();
      const result = matchOrchestrationPreset([preset], {
        workspaceId: "ws-1",
        requestedRoles: ["implementer", "tester"],
        maxWorkers: 2,
      });
      expect(result.matched).toBe(true);
      expect(result.preset?.id).toBe("preset-1");
    });

    it("matches when request roles exactly equal preset allowedRoles", () => {
      const preset = makePreset();
      const result = matchOrchestrationPreset([preset], {
        workspaceId: "ws-1",
        requestedRoles: ["planner", "implementer", "tester", "reviewer"],
        maxWorkers: 4,
      });
      expect(result.matched).toBe(true);
    });

    it("falls through when request adds an extra role not in preset", () => {
      const preset = makePreset();
      const result = matchOrchestrationPreset([preset], {
        workspaceId: "ws-1",
        requestedRoles: ["planner", "implementer", "tester", "reviewer", "architect"],
        maxWorkers: 4,
      });
      expect(result.matched).toBe(false);
    });

    it("falls through when request maxWorkers exceeds preset", () => {
      const preset = makePreset({ maxWorkers: 4 });
      const result = matchOrchestrationPreset([preset], {
        workspaceId: "ws-1",
        requestedRoles: ["implementer"],
        maxWorkers: 5,
      });
      expect(result.matched).toBe(false);
    });

    it("falls through when request templateId differs from preset templateId", () => {
      const preset = makePreset({ templateId: "quick-development" });
      const result = matchOrchestrationPreset([preset], {
        workspaceId: "ws-1",
        templateId: "research-team",
        requestedRoles: ["implementer"],
        maxWorkers: 2,
      });
      expect(result.matched).toBe(false);
    });

    it("matches when preset has no templateId (matches any template)", () => {
      const preset = makePreset(); // no templateId
      const result = matchOrchestrationPreset([preset], {
        workspaceId: "ws-1",
        templateId: "any-template",
        requestedRoles: ["implementer"],
        maxWorkers: 2,
      });
      expect(result.matched).toBe(true);
    });

    it("matches when request has no templateId and preset has no templateId", () => {
      const preset = makePreset();
      const result = matchOrchestrationPreset([preset], {
        workspaceId: "ws-1",
        templateId: undefined,
        requestedRoles: ["implementer"],
        maxWorkers: 2,
      });
      expect(result.matched).toBe(true);
    });

    it("revoked preset does not match", () => {
      const preset = makePreset({ revokedAt: "2026-02-01T00:00:00.000Z" });
      const result = matchOrchestrationPreset([preset], {
        workspaceId: "ws-1",
        requestedRoles: ["implementer"],
        maxWorkers: 2,
      });
      expect(result.matched).toBe(false);
    });

    it("falls through when workspaceId differs", () => {
      const preset = makePreset({ workspaceId: "ws-1" });
      const result = matchOrchestrationPreset([preset], {
        workspaceId: "ws-2",
        requestedRoles: ["implementer"],
        maxWorkers: 2,
      });
      expect(result.matched).toBe(false);
    });

    it("returns no match when presets array is empty", () => {
      const result = matchOrchestrationPreset([], {
        workspaceId: "ws-1",
        requestedRoles: ["implementer"],
        maxWorkers: 2,
      });
      expect(result.matched).toBe(false);
    });

    it("matches the first fitting preset when multiple presets exist", () => {
      const presetA = makePreset({ id: "preset-a", allowedRoles: ["planner"] });
      const presetB = makePreset({ id: "preset-b", allowedRoles: ["implementer", "tester"] });
      const result = matchOrchestrationPreset([presetA, presetB], {
        workspaceId: "ws-1",
        requestedRoles: ["implementer"],
        maxWorkers: 2,
      });
      expect(result.matched).toBe(true);
      expect(result.preset?.id).toBe("preset-b");
    });

    it("matches when request has no explicit maxWorkers", () => {
      const preset = makePreset({ maxWorkers: 4 });
      const result = matchOrchestrationPreset([preset], {
        workspaceId: "ws-1",
        requestedRoles: ["implementer"],
        maxWorkers: undefined,
      });
      expect(result.matched).toBe(true);
    });

    it("matches template-only request (no explicit roles) when preset has no templateId", () => {
      const preset = makePreset();
      const result = matchOrchestrationPreset([preset], {
        workspaceId: "ws-1",
        templateId: undefined,
        requestedRoles: [],
        maxWorkers: 4,
      });
      // No roles requested → subset check passes vacuously; maxWorkers ≤ 4.
      expect(result.matched).toBe(true);
    });

    it("falls through when template-only request has a different templateId", () => {
      const preset = makePreset({ templateId: "quick-development" });
      const result = matchOrchestrationPreset([preset], {
        workspaceId: "ws-1",
        templateId: "other-template",
        requestedRoles: [],
        maxWorkers: 4,
      });
      expect(result.matched).toBe(false);
    });

    it("does not mutate the input presets array", () => {
      const preset = makePreset();
      const presets = [preset];
      matchOrchestrationPreset(presets, {
        workspaceId: "ws-1",
        requestedRoles: ["implementer"],
        maxWorkers: 2,
      });
      expect(presets).toHaveLength(1);
      expect(presets[0]).toBe(preset);
    });
  });

  describe("extractRequestedRoles", () => {
    it("extracts roleNames from explicit workers array", () => {
      const params = {
        workers: [
          { roleName: "implementer", task: "do the thing" },
          { roleName: "tester", task: "verify it" },
        ],
      };
      expect(extractRequestedRoles(params)).toEqual(["implementer", "tester"]);
    });

    it("returns empty array when no workers field", () => {
      expect(extractRequestedRoles({ task: "something" })).toEqual([]);
    });

    it("returns empty array for non-record input", () => {
      expect(extractRequestedRoles(null)).toEqual([]);
      expect(extractRequestedRoles("string")).toEqual([]);
      expect(extractRequestedRoles(undefined)).toEqual([]);
    });

    it("skips workers with missing or empty roleName", () => {
      const params = {
        workers: [
          { roleName: "implementer", task: "x" },
          { task: "no role" },
          { roleName: "  ", task: "blank role" },
          { roleName: "tester", task: "y" },
        ],
      };
      expect(extractRequestedRoles(params)).toEqual(["implementer", "tester"]);
    });
  });

  describe("extractTemplateId", () => {
    it("reads templateId field", () => {
      expect(extractTemplateId({ templateId: "quick-development" })).toBe("quick-development");
    });

    it("reads teamTemplateId as alias", () => {
      expect(extractTemplateId({ teamTemplateId: "research-team" })).toBe("research-team");
    });

    it("prefers templateId over teamTemplateId", () => {
      expect(extractTemplateId({ templateId: "first", teamTemplateId: "second" })).toBe("first");
    });

    it("returns undefined when neither field present", () => {
      expect(extractTemplateId({ task: "x" })).toBeUndefined();
    });

    it("returns undefined for empty/whitespace strings", () => {
      expect(extractTemplateId({ templateId: "  " })).toBeUndefined();
      expect(extractTemplateId({ templateId: "" })).toBeUndefined();
    });

    it("returns undefined for non-record input", () => {
      expect(extractTemplateId(null)).toBeUndefined();
      expect(extractTemplateId(42)).toBeUndefined();
    });
  });

  describe("extractMaxWorkers", () => {
    it("reads a valid positive integer", () => {
      expect(extractMaxWorkers({ maxWorkers: 4 })).toBe(4);
    });

    it("floors non-integer numbers", () => {
      expect(extractMaxWorkers({ maxWorkers: 3.9 })).toBe(3);
    });

    it("clamps to minimum 1", () => {
      expect(extractMaxWorkers({ maxWorkers: 0 })).toBe(1);
      expect(extractMaxWorkers({ maxWorkers: -5 })).toBe(1);
    });

    it("returns undefined for non-number input", () => {
      expect(extractMaxWorkers({ maxWorkers: "4" })).toBeUndefined();
      expect(extractMaxWorkers({})).toBeUndefined();
      expect(extractMaxWorkers(null)).toBeUndefined();
    });

    it("returns undefined for NaN/Infinity", () => {
      expect(extractMaxWorkers({ maxWorkers: NaN })).toBeUndefined();
      expect(extractMaxWorkers({ maxWorkers: Infinity })).toBeUndefined();
    });
  });
});
