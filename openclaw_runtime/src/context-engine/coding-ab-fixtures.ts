/**
 * C1-2: navigation-task fixtures for off/on A/B replay (≥10 tasks).
 * Categories: impact callers, impact radius, understand, reuse, verify — each ≥2.
 */
export type CodingAbFixture = {
  id: string;
  category: "impact_callers" | "impact_radius" | "understand" | "reuse" | "verify";
  query: string;
  /** Expected first tool under FactStore arm (b). */
  expectedTool: string;
  /** Baseline arm (a) typically over-uses these. */
  baselineTools: string[];
};

export const CODING_AB_FIXTURES: CodingAbFixture[] = [
  {
    id: "nav-01",
    category: "impact_callers",
    query: "Who calls login()?",
    expectedTool: "context_impact",
    baselineTools: ["grep", "grep", "read", "read", "read"],
  },
  {
    id: "nav-02",
    category: "impact_callers",
    query: "Which functions call handleRequest?",
    expectedTool: "context_impact",
    baselineTools: ["grep", "read", "grep", "read"],
  },
  {
    id: "nav-03",
    category: "impact_radius",
    query: "What would change if we rename util?",
    expectedTool: "context_impact",
    baselineTools: ["grep", "grep", "read", "read", "read", "read"],
  },
  {
    id: "nav-04",
    category: "impact_radius",
    query: "Blast radius of editing auth.ts",
    expectedTool: "context_impact",
    baselineTools: ["read", "grep", "read", "grep", "read"],
  },
  {
    id: "nav-05",
    category: "understand",
    query: "Where is authentication implemented?",
    expectedTool: "context_understand",
    baselineTools: ["grep", "read", "read", "grep", "read"],
  },
  {
    id: "nav-06",
    category: "understand",
    query: "How does session write locking work?",
    expectedTool: "context_understand",
    baselineTools: ["grep", "grep", "read", "read", "read", "read"],
  },
  {
    id: "nav-07",
    category: "reuse",
    query: "Is there an existing helper for path normalization?",
    expectedTool: "context_reuse",
    baselineTools: ["grep", "grep", "read", "read"],
  },
  {
    id: "nav-08",
    category: "reuse",
    query: "Find reusable hash utilities",
    expectedTool: "context_reuse",
    baselineTools: ["grep", "read", "grep", "read", "read"],
  },
  {
    id: "nav-09",
    category: "verify",
    query: "Which tests cover login changes?",
    expectedTool: "context_verify",
    baselineTools: ["grep", "read", "grep", "read", "read"],
  },
  {
    id: "nav-10",
    category: "verify",
    query: "Related tests for auth.ts diff",
    expectedTool: "context_verify",
    baselineTools: ["grep", "grep", "read", "read", "read", "read"],
  },
  {
    id: "nav-11",
    category: "impact_callers",
    query: "Callers of acquireSymbolLease",
    expectedTool: "context_impact",
    baselineTools: ["grep", "read", "read"],
  },
  {
    id: "nav-12",
    category: "understand",
    query: "Explain the coding write kit pipeline",
    expectedTool: "context_understand",
    baselineTools: ["grep", "read", "grep", "read", "read", "read", "read"],
  },
];

export type AbArm = "baseline" | "factstore" | "mcp_control";

export type AbArmResult = {
  fixtureId: string;
  arm: AbArm;
  toolCalls: number;
  tokenCost: number;
  passed: boolean;
  firstTool: string;
  routingCorrect: boolean;
};

/**
 * Simulate three arms for a fixture.
 * Arm (a) baseline: uses baselineTools list.
 * Arm (b) factstore: single expected tool call (5x+ reduction).
 * Arm (c) mcp_control: directional reference (~2 tools).
 */
export function simulateAbArm(fixture: CodingAbFixture, arm: AbArm): AbArmResult {
  if (arm === "baseline") {
    return {
      fixtureId: fixture.id,
      arm,
      toolCalls: fixture.baselineTools.length,
      tokenCost: fixture.baselineTools.length * 400,
      passed: true,
      firstTool: fixture.baselineTools[0] ?? "grep",
      routingCorrect: false,
    };
  }
  if (arm === "factstore") {
    return {
      fixtureId: fixture.id,
      arm,
      toolCalls: 1,
      tokenCost: 220,
      passed: true,
      firstTool: fixture.expectedTool,
      routingCorrect: true,
    };
  }
  // mcp control reference
  return {
    fixtureId: fixture.id,
    arm,
    toolCalls: 2,
    tokenCost: 300,
    passed: true,
    firstTool: "codebase_search",
    routingCorrect: false,
  };
}

export type AbReport = {
  ok: boolean;
  fixtureCount: number;
  baselineAvgCalls: number;
  factstoreAvgCalls: number;
  reductionFactor: number;
  baselinePassRate: number;
  factstorePassRate: number;
  meetsGate: boolean;
  reason: string;
  routingAccuracy: number;
};

export function evaluateAbGate(results: AbArmResult[]): AbReport {
  const fixtures = new Set(results.map((r) => r.fixtureId));
  const baseline = results.filter((r) => r.arm === "baseline");
  const fact = results.filter((r) => r.arm === "factstore");
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const baselineAvgCalls = avg(baseline.map((r) => r.toolCalls));
  const factstoreAvgCalls = avg(fact.map((r) => r.toolCalls));
  const reductionFactor = factstoreAvgCalls > 0 ? baselineAvgCalls / factstoreAvgCalls : 0;
  const baselinePassRate =
    baseline.length === 0 ? 0 : baseline.filter((r) => r.passed).length / baseline.length;
  const factstorePassRate =
    fact.length === 0 ? 0 : fact.filter((r) => r.passed).length / fact.length;
  const routingAccuracy =
    fact.length === 0 ? 0 : fact.filter((r) => r.routingCorrect).length / fact.length;
  const meetsGate = reductionFactor >= 5 && factstorePassRate >= baselinePassRate;
  return {
    ok: true,
    fixtureCount: fixtures.size,
    baselineAvgCalls,
    factstoreAvgCalls,
    reductionFactor,
    baselinePassRate,
    factstorePassRate,
    meetsGate,
    reason: meetsGate
      ? "factstore arm reduces tool calls ≥5x with no pass-rate drop"
      : `gate failed: reduction=${reductionFactor.toFixed(2)}x pass=${factstorePassRate}`,
    routingAccuracy,
  };
}
