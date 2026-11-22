// Session active-run helpers decide whether session operations should treat a
// session as busy based on Control UI-visible active chat/agent runs.
import { normalizeAgentId } from "../../routing/session-key.js";
import type { GatewayRequestContext } from "./types.js";

/**
 * Active-run matcher used by session list/update methods.
 *
 * Presentation reads report visible runs. Execution mutations can include
 * hidden runs and pin the physical generation through the same matcher.
 */
type TrackedActiveSessionRun = {
  sessionKey: string;
  agentId?: string;
  sessionId?: string;
};

function collectTrackedActiveSessionRuns(
  context: Partial<Pick<GatewayRequestContext, "chatAbortControllers">>,
  options: { includeHidden?: boolean; expectedSessionId?: string } = {},
): TrackedActiveSessionRun[] {
  const runs: TrackedActiveSessionRun[] = [];
  if (!(context.chatAbortControllers instanceof Map)) {
    return runs;
  }
  for (const active of context.chatAbortControllers.values()) {
    if (
      (options.includeHidden || (active.projectSessionActive !== false && active.controlUiVisible !== false)) &&
      typeof active.sessionKey === "string" &&
      active.sessionKey.trim()
    ) {
      runs.push({
        sessionKey: active.sessionKey,
        agentId: typeof active.agentId === "string" ? normalizeAgentId(active.agentId) : undefined,
        sessionId: typeof active.sessionId === "string" ? active.sessionId : undefined,
      });
    }
  }
  return runs;
}

function isTrackedActiveSessionRunForKey(
  active: TrackedActiveSessionRun,
  key: string,
  agentId?: string,
  defaultAgentId?: string,
): boolean {
  if (active.sessionKey !== key) {
    return false;
  }
  if (key !== "global") {
    return true;
  }
  const requestedAgentId = agentId ?? defaultAgentId;
  if (!requestedAgentId) {
    return true;
  }
  const activeAgentId = active.agentId ?? defaultAgentId;
  return activeAgentId
    ? normalizeAgentId(activeAgentId) === normalizeAgentId(requestedAgentId)
    : false;
}

/** Matches active runs by canonical/requested key and the requested visibility/generation. */
export function readTrackedSessionRunState(params: {
  context: Partial<Pick<GatewayRequestContext, "chatAbortControllers">>;
  requestedKey: string;
  canonicalKey: string;
  agentId?: string;
  defaultAgentId?: string;
  includeHidden?: boolean;
  expectedSessionId?: string;
}): "active" | "unknown" | "idle" {
  const activeRuns = collectTrackedActiveSessionRuns(params.context, params);
  const matches = activeRuns.filter(
    (active) =>
      isTrackedActiveSessionRunForKey(
        active,
        params.canonicalKey,
        params.agentId,
        params.defaultAgentId,
      ) ||
      isTrackedActiveSessionRunForKey(
        active,
        params.requestedKey,
        params.agentId,
        params.defaultAgentId,
      ),
  );
  if (params.expectedSessionId && matches.some(active => !active.sessionId)) return "unknown";
  return matches.some(active => !params.expectedSessionId || active.sessionId === params.expectedSessionId) ? "active" : "idle";
}

export function hasTrackedActiveSessionRun(params: Parameters<typeof readTrackedSessionRunState>[0]): boolean {
  return readTrackedSessionRunState(params) !== "idle";
}
