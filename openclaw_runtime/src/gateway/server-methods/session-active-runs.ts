// Session operations share visible-run projection and generation-specific busy checks.
import { resolveDefaultAgentId } from "../../agents/agent-scope.js";
import { isEmbeddedAgentRunActive } from "../../agents/embedded-agent-runner/runs.js";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import { normalizeAgentId } from "../../routing/session-key.js";
import { sessionAdmissionRegistry } from "../../sessions/session-admission-registry.js";
import { resolveSessionStoreAgentId } from "../session-store-key.js";
import type { GatewayRequestContext } from "./types.js";

/**
 * Active-run matcher used by session list/update methods.
 *
 * It only reports runs visible to the Control UI so background or hidden runs
 * do not make a session look busy to user-facing session operations.
 */
type TrackedActiveSessionRun = {
  sessionKey: string;
  agentId?: string;
};

function collectTrackedActiveSessionRuns(
  context: Partial<Pick<GatewayRequestContext, "chatAbortControllers">>,
): TrackedActiveSessionRun[] {
  const runs: TrackedActiveSessionRun[] = [];
  if (!(context.chatAbortControllers instanceof Map)) {
    return runs;
  }
  for (const active of context.chatAbortControllers.values()) {
    if (
      active.projectSessionActive !== false &&
      active.controlUiVisible !== false &&
      typeof active.sessionKey === "string" &&
      active.sessionKey.trim()
    ) {
      runs.push({
        sessionKey: active.sessionKey,
        agentId: typeof active.agentId === "string" ? normalizeAgentId(active.agentId) : undefined,
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

/** Returns true when either requested or canonical session key has a visible active run. */
export function hasTrackedActiveSessionRun(params: {
  context: Partial<Pick<GatewayRequestContext, "chatAbortControllers">>;
  requestedKey: string;
  canonicalKey: string;
  agentId?: string;
  defaultAgentId?: string;
}): boolean {
  const activeRuns = collectTrackedActiveSessionRuns(params.context);
  return activeRuns.some(
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
}

// Admission permits can outlive the assistant's terminal event. Status and
// mutation callers must inspect the same physical generation before compaction.
export function isSessionBusyForManualCompaction(params: {
  context: Partial<Pick<GatewayRequestContext, "chatAbortControllers">>;
  cfg: OpenClawConfig;
  requestedKey: string;
  canonicalKey: string;
  agentId?: string;
  sessionId?: string;
}): boolean {
  const hasTrackedRun = hasTrackedActiveSessionRun({
    context: params.context,
    requestedKey: params.requestedKey,
    canonicalKey: params.canonicalKey,
    agentId: params.agentId,
    defaultAgentId: resolveDefaultAgentId(params.cfg),
  });
  const hasEmbeddedRun =
    typeof params.sessionId === "string" && params.sessionId
      ? isEmbeddedAgentRunActive(params.sessionId)
      : false;
  const admission =
    typeof params.sessionId === "string" && params.sessionId
      ? sessionAdmissionRegistry.snapshot({
          agentId: params.agentId ?? resolveSessionStoreAgentId(params.cfg, params.canonicalKey),
          canonicalSessionKey: params.canonicalKey,
          expectedSessionId: params.sessionId,
        })
      : undefined;
  return hasTrackedRun || hasEmbeddedRun || Boolean(admission?.active || admission?.fenced);
}
