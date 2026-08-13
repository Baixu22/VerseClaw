// Agent Core module: Reasonix-aligned output-budget ladder and clipping.
//
// Faithful port of DeepSeek-Reasonix `internal/provider/provider.go`
// (`AutoOutputBudget`) and `internal/agent/output_budget.go`
// (`outputBudgetReserve`, `effectiveOutputBudget`). The ladder bounds the
// completion budget when a request leaves `max_output_tokens` unset; the
// effective budget clips it against the shared context window at send time,
// reserving 8K for the prompt so an exhausted window fails locally before an
// HTTP 400.

export const outputBudgetReserve = 8 * 1024;

/** Auto ladder for max_output_tokens=0. Bounds completion only; never compact_ratio. */
export const DefaultOrdinaryOutputTokens = 16 * 1024;
export const DefaultReasoningOutputTokens = 32 * 1024;
export const DefaultHighReasoningOutputTokens = 64 * 1024;
export const DefaultHighOutputTokens = 128 * 1024;

/**
 * Faithful port of `AutoOutputBudget`: maps `max_output_tokens=0` to
 * 16K (non-reasoning) / 32K (reasoning) / 64K (high/max). 128K is explicit-only
 * and never auto-selected.
 */
export function autoOutputBudget(reasoningEnabled: boolean, effort: string | undefined): number {
  if (!reasoningEnabled) {
    return DefaultOrdinaryOutputTokens;
  }
  switch (String(effort ?? "").trim().toLowerCase()) {
    case "high":
    case "max":
      return DefaultHighReasoningOutputTokens;
    default:
      return DefaultReasoningOutputTokens;
  }
}

export type EffectiveOutputBudgetResult =
  | { budget: number; clipped: false }
  | { budget: number; clipped: true }
  | { error: "compaction-required"; estimatedPromptTokens: number };

/**
 * Faithful port of `effectiveOutputBudget`. Clips the completion budget at send
 * time only (never moving the compaction trigger) when the provider shares one
 * context window. Returns a clipped budget, or a compaction-required error when
 * the estimated prompt leaves no room after the 8K reserve.
 */
export function effectiveOutputBudget(params: {
  contextWindow: number;
  estimatedRequestTokens: number;
  budget: number;
  sharesContextWindow: boolean;
}): EffectiveOutputBudgetResult {
  if (params.contextWindow <= 0 || !params.sharesContextWindow) {
    return { budget: params.budget, clipped: false };
  }
  if (params.budget <= 0) {
    return { budget: params.budget, clipped: false };
  }
  const available = params.contextWindow - params.estimatedRequestTokens - outputBudgetReserve;
  if (available <= 0) {
    return {
      error: "compaction-required",
      estimatedPromptTokens: params.estimatedRequestTokens,
    };
  }
  if (params.budget <= available) {
    return { budget: params.budget, clipped: false };
  }
  return { budget: available, clipped: true };
}
