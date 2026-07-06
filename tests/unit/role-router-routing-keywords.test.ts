import { describe, expect, it } from "vitest";
import { routeRole } from "../../openclaw_runtime/src/agents/role-router";
import {
  BUILT_IN_ROLE_CONTRACTS,
  normalizeRoleContract,
  type RoleContract,
} from "../../openclaw_runtime/src/agents/role-contract";

function makePackRole(overrides: Partial<RoleContract> = {}): RoleContract {
  return normalizeRoleContract({
    name: "data-scientist",
    display_name: "Data Scientist",
    role_prompt: "Analyze data, build models, surface insights.",
    tools: ["bash"],
    permissions: { filesystem: "read", network: "none" },
    model: { provider: "openai", id: "gpt-4o" },
    effort: "medium",
    output_schema: { format: "markdown", sections: ["Findings", "Methodology"] },
    ...overrides,
  });
}

describe("role-router routingKeywords (Area 3 §3.5)", () => {
  it("scores pack-role routingKeywords at +2 (parity with built-in keywords)", () => {
    const packRole = makePackRole({
      routingKeywords: ["data", "model", "dataset", "训练"],
    });
    const result = routeRole({
      task: "train a model on the customer dataset",
      availableRoles: [...BUILT_IN_ROLE_CONTRACTS, packRole],
    });
    expect(result.primary.role.name).toBe("data-scientist");
    expect(result.primary.reasons).toEqual(
      expect.arrayContaining([
        "routing-keyword:data",
        "routing-keyword:model",
        "routing-keyword:dataset",
      ]),
    );
    // +2 per matched routing keyword → 3 matches = +6, beating implementer's default +1.
    expect(result.primary.score).toBeGreaterThanOrEqual(6);
  });

  it("built-in roles still route via static ROLE_KEYWORDS when no routingKeywords declared", () => {
    const result = routeRole({
      task: "plan the release sequence",
      availableRoles: BUILT_IN_ROLE_CONTRACTS,
    });
    expect(result.primary.role.name).toBe("planner");
    expect(result.primary.reasons).toEqual(
      expect.arrayContaining(["matched:plan"]),
    );
  });

  it("pack role with no keyword match falls behind built-in with strong keyword", () => {
    const packRole = makePackRole({
      routingKeywords: ["data", "model"],
    });
    const result = routeRole({
      task: "review the security diff for auth regressions",
      availableRoles: [...BUILT_IN_ROLE_CONTRACTS, packRole],
    });
    // reviewer matches review/diff/regression (+6); security-reviewer matches
    // security/auth (+4); pack role matches none. reviewer wins.
    expect(result.primary.role.name).toBe("reviewer");
    expect(result.primary.score).toBeGreaterThanOrEqual(6);
  });

  it("routingKeywords match is case-insensitive", () => {
    const packRole = makePackRole({
      routingKeywords: ["DATA"],
    });
    const result = routeRole({
      task: "analyze the data",
      availableRoles: [...BUILT_IN_ROLE_CONTRACTS, packRole],
    });
    expect(result.primary.role.name).toBe("data-scientist");
    expect(result.primary.reasons).toContain("routing-keyword:DATA");
  });

  it("routingKeywords support non-English (CN) user-authored language", () => {
    const packRole = makePackRole({
      routingKeywords: ["数据分析", "建模"],
    });
    const result = routeRole({
      task: "对用户行为数据进行建模",
      availableRoles: [...BUILT_IN_ROLE_CONTRACTS, packRole],
    });
    expect(result.primary.role.name).toBe("data-scientist");
    // "数据分析" is a substring of "对用户行为数据进行数据分析" but not of
    // "对用户行为数据进行建模" — only "建模" matches here.
    expect(result.primary.reasons).toContain("routing-keyword:建模");
  });

  it("normalizeRoleContract accepts both routing_keywords and routingKeywords shapes", () => {
    const fromSnake = normalizeRoleContract({
      name: "r1",
      display_name: "R1",
      role_prompt: "prompt text here",
      tools: [],
      permissions: { filesystem: "none", network: "none" },
      routing_keywords: ["alpha", "beta"],
    });
    expect(fromSnake.routingKeywords).toEqual(["alpha", "beta"]);

    const fromCamel = normalizeRoleContract({
      name: "r2",
      display_name: "R2",
      role_prompt: "prompt text here",
      tools: [],
      permissions: { filesystem: "none", network: "none" },
      routingKeywords: ["gamma"],
    });
    expect(fromCamel.routingKeywords).toEqual(["gamma"]);
  });

  it("pack role without routingKeywords falls back to tag matching (+1) and implementer default", () => {
    const packRole = makePackRole({
      tags: ["data"],
    });
    const result = routeRole({
      task: "work with data",
      availableRoles: [...BUILT_IN_ROLE_CONTRACTS, packRole],
    });
    // Pack role scores +1 (tag), implementer scores +1 (default) → tie broken by name.
    // "data-scientist" < "implementer" alphabetically, so pack role wins ties.
    expect(result.primary.role.name).toBe("data-scientist");
    expect(result.primary.reasons).toContain("tag:data");
  });
});
