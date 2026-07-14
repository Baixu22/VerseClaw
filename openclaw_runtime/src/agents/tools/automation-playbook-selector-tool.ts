/**
 * Agent tool for automation playbook selection (B2 minimal viable version).
 *
 * Lets the agent autonomously invoke the playbook selector when it judges a
 * browser-automation task is starting. This tool is a thin runtime-side adapter:
 * it does NOT import shared/agent-browser directly (openclaw_runtime is a
 * separate TS package and cannot cross-reference the repo-root shared/ tree).
 * Instead, the selector function and playbook list are injected by the caller,
 * following the same injection pattern as createAgentBrowserTool's `invoke`.
 *
 * B1 follow-up (issue #2) will add a before_prompt_build hook for deterministic
 * pre-selection; this tool remains as an agent-initiated fallback.
 */
import { Type } from "typebox";
import type { AnyAgentTool } from "./common.js";
import { asToolParamsRecord, jsonResult, readStringParam } from "./common.js";

/**
 * A single playbook candidate passed to the selector.
 */
export interface AutomationPlaybookCandidate {
  id: string;
  title: string;
  description: string;
  tags: string[];
  risk: string;
  recommendedCapabilities?: string[];
}

/**
 * Normalized selection result returned by the injected selector.
 */
export interface AutomationPlaybookSelectionResult {
  playbookId: string;
  title: string;
  source: string;
  confidence: "low" | "medium" | "high";
  reason: string;
}

/**
 * Selector function injected by the caller. Encapsulates prompt construction,
 * model invocation, JSON parsing, and normalization. Returns undefined when no
 * playbook is selected or selection fails.
 */
export type AutomationPlaybookSelectorFn = (input: {
  userContent: string;
  pageContextSummary?: string;
  signal?: AbortSignal;
}) => Promise<AutomationPlaybookSelectionResult | undefined>;

const AutomationPlaybookSchema = Type.Object({
  userContent: Type.String({
    description:
      "The user's request text that may trigger a browser-automation playbook. Pass the raw user message.",
  }),
  pageContextSummary: Type.Optional(
    Type.String({
      description:
        "Optional short summary of the current page (title, URL, visible text highlights) to help the selector pick a playbook.",
    }),
  ),
});

export function createAutomationPlaybookSelectorTool(options: {
  select: AutomationPlaybookSelectorFn;
  candidates: AutomationPlaybookCandidate[];
}): AnyAgentTool {
  const { select, candidates } = options;

  return {
    label: "Automation Playbook Selector",
    name: "select_automation_playbook",
    description:
      "Pick a browser-automation playbook for the current user request by asking the model to choose from registered playbooks. Returns the selected playbook id, title, confidence, and reason, or null when no playbook is needed. Call this at the start of a browser-automation task so the chosen playbook's guidance can guide subsequent steps.",
    parameters: AutomationPlaybookSchema,
    execute: async (_toolCallId, args, signal) => {
      const params = asToolParamsRecord(args);
      const userContent = readStringParam(params, "userContent", {
        required: true,
        label: "userContent",
      });
      const pageContextSummary = readStringParam(params, "pageContextSummary", {
        required: false,
        label: "pageContextSummary",
      });
      const selection = await select({
        userContent,
        ...(pageContextSummary ? { pageContextSummary } : {}),
        signal,
      });
      return jsonResult({
        selected: selection !== undefined,
        selection: selection ?? null,
        candidates: candidates.map((candidate) => ({
          id: candidate.id,
          title: candidate.title,
          risk: candidate.risk,
        })),
      });
    },
  };
}
