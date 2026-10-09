/**
 * Prompt-surface helpers for OpenClaw tool guidance.
 *
 * Maps runtime/session surfaces to the fallback tool text and workflow hints that belong in prompts.
 */
import { isOpenClawMainPromptSurface } from "../plugins/agent-prompt-surface-kind.js";
import type { AgentPromptSurfaceKind } from "../plugins/types.js";
import { isAcpSessionKey, isSubagentSessionKey } from "../routing/session-key.js";

/** Builds fallback tool guidance when a runtime cannot render the structured tool list. */
export function buildOpenClawToolFallbackText(params: {
  surface: AgentPromptSurfaceKind;
  execToolName: string;
  processToolName: string;
}): string {
  if (isOpenClawMainPromptSurface(params.surface)) {
    return [
      "OpenClaw lists the standard tools above. This runtime enables:",
      "- grep: search file contents for patterns",
      "- find: find files by glob pattern",
      "- ls: list directory contents",
      "- apply_patch: apply multi-file patches",
      `- ${params.execToolName}: run shell commands (supports background via yieldMs/background)`,
      `- ${params.processToolName}: manage background exec sessions`,
      "- browser: control OpenClaw's dedicated browser",
      "- canvas: present/eval/snapshot the Canvas",
      "- nodes: list/describe/notify/camera/screen on paired nodes",
      "- cron: manage cron jobs and wake events (use for reminders; when scheduling a reminder, write the systemEvent text as something that will read like a reminder when it fires, and mention that it is a reminder depending on the time gap between setting and firing; include recent context in reminder text if appropriate)",
      "- sessions_compact: compact the current session after this turn",
      "- sessions_list: list sessions",
      "- sessions_history: fetch session history",
      "- sessions_send: send to another session",
      "- sessions_spawn: spawn an isolated sub-agent session",
      "- sessions_yield: end this turn and wait for sub-agent completion events",
      "- subagents: list active/recent sub-agent runs",
      '- session_status: show usage/time/model state and answer "what model are we using?"',
    ].join("\n");
  }

  return "No OpenClaw tool list is injected for this runtime prompt surface. Use only tools exposed directly by the active backend.";
}

/**
 * Builds tool guidance for a known-empty capability surface (caller supplied an
 * explicitly empty tool list), which must not advertise any tool catalog.
 */
export function buildOpenClawKnownEmptyToolListText(params: {
  surface: AgentPromptSurfaceKind;
}): string {
  const statement = isOpenClawMainPromptSurface(params.surface)
    ? "No tools are enabled for this run: the runtime reported an empty tool allowlist."
    : "No OpenClaw tool list is injected for this runtime prompt surface: the runtime reported an empty tool allowlist.";
  return `${statement} Do not attempt tool calls or describe unavailable tool capabilities.`;
}

/**
 * Returns whether the main OpenClaw prompt should include workflow hints around
 * the tool list. Hints require a rendered tool list; without one (known-empty or
 * unavailable tool metadata) there is nothing to attach positive guidance to.
 */
export function shouldRenderOpenClawToolWorkflowHints(params: {
  surface: AgentPromptSurfaceKind;
  hasToolList: boolean;
}): boolean {
  return isOpenClawMainPromptSurface(params.surface) && params.hasToolList;
}

/** Maps a session key to the prompt surface used for tool guidance and runtime behavior. */
export function resolveAgentPromptSurfaceForSessionKey(
  sessionKey?: string,
): AgentPromptSurfaceKind {
  if (sessionKey && isAcpSessionKey(sessionKey)) {
    return "acp_backend";
  }
  return sessionKey && isSubagentSessionKey(sessionKey) ? "subagent" : "openclaw_main";
}
