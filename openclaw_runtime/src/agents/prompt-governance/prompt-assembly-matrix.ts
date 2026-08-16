// PromptAssemblyMatrix: effort x model-support x route coverage for linked-v1.
//
// Routes:
//   R1 = built-in embedded attempt (full policy enforcement)
//   R2 = CLI-backed harness (prompt-only policy enforcement)
//   R3 = plugin harness (must declare prompt-only unless it proves full parity)

import {
  resolveProviderReasoningEffort,
  type ProviderReasoningEffortId,
} from "../provider-effort-capability.js";
import {
  resolveRequestedRuntimeIntensity,
  resolveRuntimeIntensityPolicy,
  type RuntimeIntensityLevel,
} from "../intensity-policy.js";

export type PromptAssemblyRoute = "R1-builtin" | "R2-cli" | "R3-plugin";
export type PromptAssemblyAdherence = "full" | "prompt-only";

export type PromptAssemblyMatrixCase = {
  id: string;
  provider: string;
  route: PromptAssemblyRoute;
  requestedReasoning: ProviderReasoningEffortId;
  supportedReasoning: ProviderReasoningEffortId;
  requestedIntensity: ReturnType<typeof resolveRequestedRuntimeIntensity>;
  effectiveIntensity: RuntimeIntensityLevel;
  policyId: string;
  adherence: PromptAssemblyAdherence;
};

export type PromptAssemblyMatrix = {
  version: 1;
  cases: PromptAssemblyMatrixCase[];
};

function adherenceForRoute(route: PromptAssemblyRoute): PromptAssemblyAdherence {
  return route === "R1-builtin" ? "full" : "prompt-only";
}

const COVERAGE_CASES: Array<{
  provider: string;
  route: PromptAssemblyRoute;
  requestedReasoning: ProviderReasoningEffortId;
  supportedReasoning: ProviderReasoningEffortId;
}> = [
  { provider: "deepseek", route: "R1-builtin", requestedReasoning: "minimal", supportedReasoning: "low" },
  { provider: "deepseek", route: "R1-builtin", requestedReasoning: "medium", supportedReasoning: "high" },
  { provider: "deepseek", route: "R1-builtin", requestedReasoning: "xhigh", supportedReasoning: "high" },
  { provider: "deepseek", route: "R1-builtin", requestedReasoning: "max", supportedReasoning: "max" },
  { provider: "openai", route: "R1-builtin", requestedReasoning: "high", supportedReasoning: "high" },
  { provider: "openai", route: "R2-cli", requestedReasoning: "low", supportedReasoning: "low" },
  { provider: "anthropic", route: "R1-builtin", requestedReasoning: "minimal", supportedReasoning: "low" },
  { provider: "anthropic", route: "R3-plugin", requestedReasoning: "high", supportedReasoning: "high" },
];

export function buildPromptAssemblyMatrix(): PromptAssemblyMatrix {
  const cases = COVERAGE_CASES.map((coverage) => {
    const providerEffort = resolveProviderReasoningEffort({
      provider: coverage.provider,
      requested: coverage.requestedReasoning,
    });
    const requestedIntensity = resolveRequestedRuntimeIntensity({
      reasoningEffort: coverage.requestedReasoning,
    });
    const policy = resolveRuntimeIntensityPolicy({
      requestedReasoningEffort: coverage.requestedReasoning,
      requestedRuntimeIntensity: requestedIntensity,
      thinkLevel: coverage.supportedReasoning,
      intensitySource: "explicit",
    });
    return {
      id: `${coverage.provider}:${coverage.requestedReasoning}->${coverage.supportedReasoning}:${coverage.route}`,
      provider: coverage.provider,
      route: coverage.route,
      requestedReasoning: coverage.requestedReasoning,
      supportedReasoning: coverage.supportedReasoning,
      effectiveReasoning: providerEffort?.effective ?? coverage.supportedReasoning,
      requestedIntensity,
      effectiveIntensity: policy.level,
      policyId: policy.policyId,
      adherence: adherenceForRoute(coverage.route),
    };
  });
  return { version: 1, cases };
}

export type PromptAssemblyMatrixIssue = {
  id: string;
  reason: string;
};

export function validatePromptAssemblyMatrix(matrix = buildPromptAssemblyMatrix()): PromptAssemblyMatrixIssue[] {
  const issues: PromptAssemblyMatrixIssue[] = [];
  for (const item of matrix.cases) {
    if (item.requestedIntensity !== item.effectiveIntensity) {
      issues.push({
        id: item.id,
        reason: `intensity drift: ${item.requestedIntensity} -> ${item.effectiveIntensity}`,
      });
    }
    if (item.adherence === "full" && item.route !== "R1-builtin") {
      issues.push({ id: item.id, reason: "non-builtin route cannot claim full adherence" });
    }
  }
  return issues;
}

export function listPromptAssemblyMatrixCoverage(): PromptAssemblyMatrix {
  return buildPromptAssemblyMatrix();
}
