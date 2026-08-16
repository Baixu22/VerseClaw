import type { ThinkLevel } from "../auto-reply/thinking.shared.js";
import type { PromptMode } from "./system-prompt.types.js";

export type RuntimeIntensityLevel = "baseline" | "minimal" | "low" | "high" | "xhigh";
export type RuntimeIntensityPreference = "baseline" | "minimal" | "low" | "high" | "xhigh";

const RUNTIME_INTENSITY_PREFERENCES: readonly RuntimeIntensityPreference[] = [
  "baseline",
  "minimal",
  "low",
  "high",
  "xhigh",
];

export function normalizeRuntimeIntensityPreference(
  value: unknown,
): RuntimeIntensityPreference | undefined {
  return typeof value === "string" &&
    (RUNTIME_INTENSITY_PREFERENCES as readonly string[]).includes(value)
    ? (value as RuntimeIntensityPreference)
    : undefined;
}
export type RuntimeIntensitySource = "explicit" | "legacy-thinking-level";
export type LinkedRuntimeIntensityRequest = {
  reasoningEffort?: string | null;
  /** Reserved for future model-aware linking; linked-v1 keeps auto at baseline. */
  modelDefaultThinkLevel?: ThinkLevel | null;
};
export type RuntimeIntensityPromptMode = "preserve" | "minimal" | "full";
export type RuntimeIntensityResponseStyle = "normal" | "brief" | "concise" | "detailed" | "comprehensive";
export type RuntimeIntensityOrchestrationGuidance =
  | "normal"
  | "ask-before-heavy"
  | "suggest-heavy-when-useful"
  | "prefer-heavy-when-useful";

export type RuntimeIntensitySkillsPolicy =
  | { mode: "preserve" }
  | {
      mode: "top-k" | "top-k-compact";
      maxSkillsInPrompt: number;
      preferCompact: boolean;
    };

export type RuntimeIntensityToolResultsPolicy =
  | { mode: "preserve" }
  | {
      mode: "tighten";
      singleToolResultContextShare: number;
    };

export type RuntimeIntensityContextPressurePolicy =
  | { mode: "preserve" }
  | {
      mode: "tighten";
      preemptiveOverflowRatio: number;
    };

export type RuntimeIntensityShellOutputPolicy =
  | { mode: "preserve" }
  | {
      mode: "compact-preferred";
      recovery: "raw-output-pointer";
    };

export type RuntimeIntensityPolicy = {
  level: RuntimeIntensityLevel;
  policyId:
    | "baseline"
    | "minimal-lightweight"
    | "low-lightweight"
    | "high-deliberate"
    | "xhigh-maximum";
  promptMode: RuntimeIntensityPromptMode;
  responseStyle: RuntimeIntensityResponseStyle;
  orchestrationGuidance: RuntimeIntensityOrchestrationGuidance;
  skills: RuntimeIntensitySkillsPolicy;
  toolResults: RuntimeIntensityToolResultsPolicy;
  contextPressure: RuntimeIntensityContextPressurePolicy;
  shellOutput: RuntimeIntensityShellOutputPolicy;
  systemPromptLines: string[];
};

export type ResolveRuntimeIntensityPolicyInput = {
  thinkLevel?: string | null;
  /** Linked-v1 explicit intensity; when present it wins over legacy thinkLevel. */
  requestedRuntimeIntensity?: RuntimeIntensityPreference | null;
  /** Requested reasoning effort captured before provider/model downgrade. */
  requestedReasoningEffort?: string | null;
  intensitySource?: RuntimeIntensitySource;
  /** Reserved for future model-aware linking. */
  modelDefaultThinkLevel?: ThinkLevel | null;
  promptModeExplicit?: boolean;
  requestedPromptMode?: PromptMode | null;
  rawModelRun?: boolean;
};

const REASONING_EFFORT_TO_INTENSITY: Record<string, RuntimeIntensityPreference> = {
  minimal: "minimal",
  low: "low",
  medium: "baseline",
  high: "high",
  xhigh: "xhigh",
  max: "xhigh",
};

/**
 * Linked-v1 mapping: reasoning effort and runtime intensity stay coupled at
 * the product level, but intensity is resolved from the requested value so a
 * later provider/model downgrade cannot silently change prompt density.
 *
 * `auto`, `off`, `adaptive`, unset, and `medium` all keep baseline density.
 */
export function resolveRequestedRuntimeIntensity(
  params: LinkedRuntimeIntensityRequest = {},
): RuntimeIntensityPreference {
  const normalized = typeof params.reasoningEffort === "string"
    ? params.reasoningEffort.trim().toLowerCase()
    : "";
  // Linked-v1 deliberately ignores modelDefaultThinkLevel for now: auto stays
  // baseline regardless of what the model's own default happens to be.
  void params.modelDefaultThinkLevel;
  return REASONING_EFFORT_TO_INTENSITY[normalized] ?? "baseline";
}

const BASELINE_POLICY: RuntimeIntensityPolicy = {
  level: "baseline",
  policyId: "baseline",
  promptMode: "preserve",
  responseStyle: "normal",
  orchestrationGuidance: "normal",
  skills: { mode: "preserve" },
  toolResults: { mode: "preserve" },
  contextPressure: { mode: "preserve" },
  shellOutput: { mode: "preserve" },
  systemPromptLines: [],
};

function shouldPreservePromptMode(params: ResolveRuntimeIntensityPolicyInput): boolean {
  return (
    params.rawModelRun === true ||
    params.promptModeExplicit === true ||
    params.requestedPromptMode === "none"
  );
}

function normalizeIntensityLevel(
  thinkLevel: ResolveRuntimeIntensityPolicyInput["thinkLevel"],
): RuntimeIntensityLevel {
  const value = typeof thinkLevel === "string" ? thinkLevel.trim().toLowerCase() : "";
  if (value === "minimal" || value === "low" || value === "high") {
    return value;
  }
  if (value === "xhigh" || value === "max") {
    return "xhigh";
  }
  return "baseline";
}

function withPromptModeProtection(
  policy: RuntimeIntensityPolicy,
  params: ResolveRuntimeIntensityPolicyInput,
): RuntimeIntensityPolicy {
  return shouldPreservePromptMode(params) ? { ...policy, promptMode: "preserve" } : policy;
}

export function resolveRuntimeIntensityPolicy(
  params: ResolveRuntimeIntensityPolicyInput,
): RuntimeIntensityPolicy {
  const requestedLevel =
    params.requestedRuntimeIntensity ??
    (params.requestedReasoningEffort !== undefined && params.requestedReasoningEffort !== null
      ? resolveRequestedRuntimeIntensity({
          reasoningEffort: params.requestedReasoningEffort,
          modelDefaultThinkLevel: params.modelDefaultThinkLevel,
        })
      : undefined);
  const level = requestedLevel ?? normalizeIntensityLevel(params.thinkLevel);
  if (level === "minimal") {
    return withPromptModeProtection(
      {
        level,
        policyId: "minimal-lightweight",
        promptMode: "minimal",
        responseStyle: "brief",
        orchestrationGuidance: "ask-before-heavy",
        skills: { mode: "top-k-compact", maxSkillsInPrompt: 8, preferCompact: true },
        toolResults: { mode: "tighten", singleToolResultContextShare: 0.12 },
        contextPressure: { mode: "tighten", preemptiveOverflowRatio: 0.72 },
        shellOutput: { mode: "compact-preferred", recovery: "raw-output-pointer" },
        systemPromptLines: [
          "Runtime intensity: minimal. Prefer short answers, small context reads, compact tool-output summaries, and expand only when the user asks or correctness requires it.",
          "When compact shell output is available, prefer it while preserving the raw-output recovery path for missing details.",
          "For long-task graphs or multi-model orchestration, explain the tradeoff and ask before escalating.",
        ],
      },
      params,
    );
  }
  if (level === "low") {
    return withPromptModeProtection(
      {
        level,
        policyId: "low-lightweight",
        promptMode: "minimal",
        responseStyle: "concise",
        orchestrationGuidance: "ask-before-heavy",
        skills: { mode: "top-k", maxSkillsInPrompt: 16, preferCompact: false },
        toolResults: { mode: "tighten", singleToolResultContextShare: 0.25 },
        contextPressure: { mode: "tighten", preemptiveOverflowRatio: 0.82 },
        shellOutput: { mode: "compact-preferred", recovery: "raw-output-pointer" },
        systemPromptLines: [
          "Runtime intensity: low. Prefer concise output, targeted context reads, and compact tool-result use while keeping all permitted capabilities available.",
          "When compact shell output is available, prefer it while preserving the raw-output recovery path for missing details.",
          "Suggest heavier long-task, graph, subagent, or multi-model workflows only when they are likely to improve the result.",
        ],
      },
      params,
    );
  }
  if (level === "high") {
    return withPromptModeProtection(
      {
        level,
        policyId: "high-deliberate",
        promptMode: "full",
        responseStyle: "detailed",
        orchestrationGuidance: "suggest-heavy-when-useful",
        skills: { mode: "preserve" },
        toolResults: { mode: "preserve" },
        contextPressure: { mode: "preserve" },
        shellOutput: { mode: "preserve" },
        systemPromptLines: [
          "Runtime intensity: high. Use fuller reasoning and context when it helps, and suggest explicit /loop, ClawGraph, role, subagent, or multi-model workflows for complex work.",
          "Do not silently create long-task state or bypass approvals; ask when escalation changes workflow shape.",
        ],
      },
      params,
    );
  }
  if (level === "xhigh") {
    return withPromptModeProtection(
      {
        level,
        policyId: "xhigh-maximum",
        promptMode: "full",
        responseStyle: "comprehensive",
        orchestrationGuidance: "prefer-heavy-when-useful",
        skills: { mode: "preserve" },
        toolResults: { mode: "preserve" },
        contextPressure: { mode: "preserve" },
        shellOutput: { mode: "preserve" },
        systemPromptLines: [
          "Runtime intensity: xhigh. Prefer the strongest available reasoning and consider explicit long-context, ClawGraph, role, subagent, or multi-model workflows for complex tasks.",
          "Keep capability and approval boundaries intact; do not silently enter /loop or create long-task authority without the explicit workflow path.",
        ],
      },
      params,
    );
  }
  return BASELINE_POLICY;
}
