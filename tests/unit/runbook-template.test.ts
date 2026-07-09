import { describe, expect, it } from "vitest";

import { BUILT_IN_ROLE_CONTRACTS } from "../../openclaw_runtime/src/agents/role-contract.js";
import {
  validateRunbookTemplate,
  type RunbookTemplate,
} from "../../openclaw_runtime/src/agents/runbook-template.js";
import {
  BUILT_IN_RUNBOOK_TEMPLATES,
  listRunbookTemplates,
  selectRunbookCandidates,
} from "../../openclaw_runtime/src/agents/runbook-registry.js";

const knownRoleNames = BUILT_IN_ROLE_CONTRACTS.map((role) => role.name);

function validRunbook(overrides: Partial<RunbookTemplate> = {}): RunbookTemplate {
  return {
    id: "feature-implementation",
    version: "1.0.0",
    title: "Feature Implementation",
    intent: ["feature", "implementation"],
    requiredRoles: ["planner", "implementer", "tester"],
    optionalRoles: ["reviewer"],
    graph: {
      nodes: [
        {
          id: "plan",
          roleName: "planner",
          task: "Plan implementation scope",
        },
        {
          id: "implement",
          roleName: "implementer",
          task: "Implement scoped change",
          dependsOn: ["plan"],
        },
        {
          id: "verify",
          roleName: "tester",
          task: "Verify implementation evidence",
          dependsOn: ["implement"],
          verifier: true,
        },
      ],
    },
    verification: {
      verifierRole: "reviewer",
      expectedEvidence: ["tests", "changed files"],
    },
    handoff: {
      rules: ["planner hands off to implementer", "tester hands off to reviewer"],
    },
    ...overrides,
  };
}

describe("RunbookTemplate validation", () => {
  it("accepts a valid structured runbook", () => {
    expect(validateRunbookTemplate(validRunbook(), knownRoleNames)).toEqual({ ok: true, issues: [] });
  });

  it("rejects unknown role names", () => {
    const result = validateRunbookTemplate(
      validRunbook({
        requiredRoles: ["planner", "ghost-role"],
      }),
      knownRoleNames,
    );

    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "requiredRoles[1]", message: "unknown role: ghost-role" }),
      ]),
    );
  });

  it("rejects duplicate graph node ids", () => {
    const template = validRunbook();
    template.graph.nodes[1] = { ...template.graph.nodes[1]!, id: "plan" };

    const result = validateRunbookTemplate(template, knownRoleNames);

    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "graph.nodes[1].id", message: "duplicate node id: plan" }),
      ]),
    );
  });

  it("rejects dependencies on unknown graph nodes", () => {
    const template = validRunbook();
    template.graph.nodes[1] = { ...template.graph.nodes[1]!, dependsOn: ["missing-node"] };

    const result = validateRunbookTemplate(template, knownRoleNames);

    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "graph.nodes[1].dependsOn[0]", message: "unknown dependency: missing-node" }),
      ]),
    );
  });

  it("rejects missing expected evidence", () => {
    const result = validateRunbookTemplate(
      validRunbook({
        verification: { verifierRole: "reviewer", expectedEvidence: [] },
      }),
      knownRoleNames,
    );

    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "verification.expectedEvidence", message: "expected evidence is required" }),
      ]),
    );
  });

  it.each(["tools", "permissions", "prompt"] as const)("rejects unsafe node field %s", (field) => {
    const template = validRunbook();
    template.graph.nodes[0] = {
      ...template.graph.nodes[0]!,
      [field]: field === "tools" ? ["bash"] : "unsafe",
    } as RunbookTemplate["graph"]["nodes"][number];

    const result = validateRunbookTemplate(template, knownRoleNames);

    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: `graph.nodes[0].${field}`,
          message: `${field} cannot be declared by a runbook`,
        }),
      ]),
    );
  });
});

describe("built-in runbook registry", () => {
  it("includes and validates the required P2 built-in runbooks", () => {
    const ids = new Set(listRunbookTemplates().map((template) => template.id));

    expect([...ids]).toEqual(
      expect.arrayContaining([
        "code-review",
        "feature-implementation",
        "security-check",
        "documentation-migration",
        "test-repair",
      ]),
    );
    expect(BUILT_IN_RUNBOOK_TEMPLATES.length).toBeGreaterThanOrEqual(5);
    for (const template of BUILT_IN_RUNBOOK_TEMPLATES) {
      expect(validateRunbookTemplate(template, knownRoleNames)).toEqual({ ok: true, issues: [] });
    }
  });

  it("returns selected and unselected runbook reasons as structured data", () => {
    const selection = selectRunbookCandidates({
      task: "fix failing test suite after repeated failures",
      priorFailureCount: 2,
    });

    expect(selection.selected?.template.id).toBe("test-repair");
    expect(selection.selected?.reasons).toContain("prior-failure-match");
    expect(selection.unselected.length).toBeGreaterThan(0);
    expect(selection.unselected[0]).toEqual(
      expect.objectContaining({
        runbookId: expect.any(String),
        reasons: expect.any(Array),
      }),
    );
  });

  it("reports invalid explicit runbook selection without silently choosing another", () => {
    const selection = selectRunbookCandidates({
      task: "repair tests",
      explicitRunbookId: "ghost-runbook",
    });

    expect(selection.selected).toBeUndefined();
    expect(selection.unselected).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          runbookId: "ghost-runbook",
          reasons: ["explicit-runbook-not-found"],
        }),
      ]),
    );
  });
});
