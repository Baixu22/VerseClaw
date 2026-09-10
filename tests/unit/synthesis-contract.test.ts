import { describe, expect, it } from "vitest";
import {
  buildSynthesisContract,
  renderSynthesisContractPrompt,
  type SynthesisContract,
} from "../../openclaw_runtime/src/agents/synthesis-contract";
import type { OrchestratorPlan } from "../../openclaw_runtime/src/agents/orchestrator";

function makePlan(overrides: Partial<OrchestratorPlan> = {}): OrchestratorPlan {
  const routeDiagnostics = {
    difficulty: "moderate",
    confidence: 0.7,
    reasons: [],
    rejectedRoles: [],
    capabilityGaps: [],
    requiredCapabilities: [],
  };
  return {
    mode: "lead-workers",
    leadRole: "planner",
    workers: [
      { roleName: "planner", task: "plan the work" },
      { roleName: "implementer", task: "implement the plan" },
      { roleName: "reviewer", task: "review the implementation" },
    ],
    reasons: [],
    routeDiagnostics: routeDiagnostics as never,
    taskGraph: {
      runId: "test",
      nodes: [],
      edges: [],
      status: "pending" as never,
      mode: " dag",
    } as unknown as OrchestratorPlan["taskGraph"],
    graphStatus: "pending" as never,
    executionWaves: [],
    capabilityGaps: [],
    estimatedRepairPolicy: { maxAttempts: 1, backoff: "linear" } as never,
    ...overrides,
  } as OrchestratorPlan;
}

describe("buildSynthesisContract (Area 3 §3.2)", () => {
  it("returns undefined for single-worker router-mode plans (degrade to today)", () => {
    const plan = makePlan({
      mode: "router",
      workers: [{ roleName: "implementer", task: "do the thing" }],
    });
    expect(buildSynthesisContract(plan)).toBeUndefined();
  });

  it("builds contract with perWorker entries from built-in role output schemas", () => {
    const plan = makePlan();
    const contract = buildSynthesisContract(plan);
    expect(contract).toBeDefined();
    expect(contract!.perWorker).toHaveLength(3);
    const planner = contract!.perWorker.find((w) => w.roleName === "planner");
    expect(planner).toBeDefined();
    expect(planner!.expectedSections).toEqual(["Goal", "Plan", "Risks", "Acceptance"]);
    expect(planner!.expectedFormat).toBe("markdown");
    const reviewer = contract!.perWorker.find((w) => w.roleName === "reviewer");
    expect(reviewer!.expectedSections).toEqual(["Findings", "Evidence", "Recommendation"]);
  });

  it("includes verifier role in perWorker when present and not already a worker", () => {
    const plan = makePlan({ verifierRole: "skeptic" });
    const contract = buildSynthesisContract(plan);
    const skeptic = contract!.perWorker.find((w) => w.roleName === "skeptic");
    expect(skeptic).toBeDefined();
    expect(skeptic!.isVerifier).toBe(true);
    expect(skeptic!.expectedSections).toEqual(["Verdict", "Refutations", "Required Fixes"]);
  });

  it("does not duplicate verifier when verifier is already a worker", () => {
    const plan = makePlan({
      workers: [
        { roleName: "planner", task: "plan" },
        { roleName: "skeptic", task: "refute" },
      ],
      verifierRole: "skeptic",
    });
    const contract = buildSynthesisContract(plan);
    const skeptics = contract!.perWorker.filter((w) => w.roleName === "skeptic");
    expect(skeptics).toHaveLength(1);
  });

  it("mergeTemplate has stable default sections", () => {
    const contract = buildSynthesisContract(makePlan());
    expect(contract!.mergeTemplate.sections).toEqual([
      "Summary",
      "Per-role findings",
      "Conflicts",
      "Open items",
      "Verdict",
    ]);
    expect(contract!.mergeTemplate.conflictRule).toBe("surface");
  });

  it("unknown worker role produces empty expectedSections (Lead marks as gap)", () => {
    const plan = makePlan({
      workers: [
        { roleName: "planner", task: "plan" },
        { roleName: "unknown-custom-role", task: "custom" },
      ],
    });
    const contract = buildSynthesisContract(plan);
    const unknown = contract!.perWorker.find((w) => w.roleName === "unknown-custom-role");
    expect(unknown).toBeDefined();
    expect(unknown!.expectedSections).toEqual([]);
    expect(unknown!.expectedFormat).toBe("markdown"); // default
  });

  it("honors config-defined role overrides via cfg parameter", () => {
    const cfg = {
      agents: {
        roles: [
          {
            name: "custom-analyst",
            display_name: "Custom Analyst",
            role_prompt: "Analyze things thoroughly.",
            tools: [],
            permissions: { filesystem: "read", network: "none" },
            output_schema: {
              format: "markdown",
              sections: ["Hypothesis", "Evidence", "Conclusion"],
            },
          },
        ],
      },
    };
    const plan = makePlan({
      workers: [
        { roleName: "planner", task: "plan" },
        { roleName: "custom-analyst", task: "analyze" },
      ],
    });
    const contract = buildSynthesisContract(plan, cfg);
    const analyst = contract!.perWorker.find((w) => w.roleName === "custom-analyst");
    expect(analyst!.expectedSections).toEqual(["Hypothesis", "Evidence", "Conclusion"]);
  });
});

describe("renderSynthesisContractPrompt (Area 3 §3.2)", () => {
  it("returns empty string when contract is undefined (degrade to today)", () => {
    expect(renderSynthesisContractPrompt(undefined)).toBe("");
  });

  it("includes all merge template sections as required headers", () => {
    const contract: SynthesisContract = {
      perWorker: [
        { roleName: "planner", expectedFormat: "markdown", expectedSections: ["Goal", "Plan"] },
      ],
      mergeTemplate: {
        sections: ["Summary", "Per-role findings", "Verdict"],
        conflictRule: "surface",
      },
    };
    const prompt = renderSynthesisContractPrompt(contract);
    expect(prompt).toContain("- Summary");
    expect(prompt).toContain("- Per-role findings");
    expect(prompt).toContain("- Verdict");
  });

  it("lists each worker's expected sections", () => {
    const contract: SynthesisContract = {
      perWorker: [
        { roleName: "planner", expectedFormat: "markdown", expectedSections: ["Goal", "Plan"] },
        { roleName: "reviewer", expectedFormat: "markdown", expectedSections: ["Findings"] },
      ],
      mergeTemplate: { sections: ["Summary"], conflictRule: "surface" },
    };
    const prompt = renderSynthesisContractPrompt(contract);
    expect(prompt).toContain("planner: Goal, Plan");
    expect(prompt).toContain("reviewer: Findings");
  });

  it("marks verifier workers with (verifier) tag", () => {
    const contract: SynthesisContract = {
      perWorker: [
        { roleName: "planner", expectedFormat: "markdown", expectedSections: [] },
        { roleName: "skeptic", expectedFormat: "markdown", expectedSections: ["Verdict"], isVerifier: true },
      ],
      mergeTemplate: { sections: ["Summary"], conflictRule: "surface" },
    };
    const prompt = renderSynthesisContractPrompt(contract);
    expect(prompt).toContain("skeptic (verifier): Verdict");
  });

  it("states the conflict rule explicitly", () => {
    const contract: SynthesisContract = {
      perWorker: [],
      mergeTemplate: { sections: ["Summary"], conflictRule: "surface" },
    };
    const prompt = renderSynthesisContractPrompt(contract);
    expect(prompt).toContain("Conflict rule: surface");
    expect(prompt).toContain("never silently resolve");
  });

  it("handles workers with no declared sections gracefully", () => {
    const contract: SynthesisContract = {
      perWorker: [
        { roleName: "mystery-role", expectedFormat: "markdown", expectedSections: [] },
      ],
      mergeTemplate: { sections: ["Summary"], conflictRule: "surface" },
    };
    const prompt = renderSynthesisContractPrompt(contract);
    expect(prompt).toContain("mystery-role: (no declared sections — accept free-form output)");
  });
});
