// Maps a role contract effort level to an OpenClaw subagent thinking level.
//
// Role contracts use the effort vocabulary from role-contract.ts
// ("auto" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max"), while
// the runtime subagent/agent surface uses a thinking vocabulary
// ("off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "adaptive" | "max").
// "auto" has no direct thinking peer, so it resolves to "adaptive".
import type { RoleContractEffort } from "./role-contract.js";

export type SubagentThinkingLevel =
  | "off"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "adaptive"
  | "max";

const EFFORT_TO_THINKING: Record<RoleContractEffort, SubagentThinkingLevel> = {
  auto: "adaptive",
  minimal: "minimal",
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "xhigh",
  max: "max",
};

/** Resolve the thinking level a role contract's effort should request, if any. */
export function roleEffortToThinking(
  effort: RoleContractEffort | undefined,
): SubagentThinkingLevel | undefined {
  if (!effort) {
    return undefined;
  }
  return EFFORT_TO_THINKING[effort];
}
