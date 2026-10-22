/**
 * Cleanup helper for subagent sessions. It deletes child session state through
 * the gateway and preserves lifecycle-hook behavior for session-mode spawns.
 */
import type { callGateway as defaultCallGateway } from "../gateway/call.js";
import { buildSessionDeleteOperationId } from "../sessions/session-delete-operation-id.js";
import type { SpawnSubagentMode } from "./subagent-spawn.types.js";

type CallGateway = typeof defaultCallGateway;

/** Deletes a child subagent session and optionally emits session-mode lifecycle hooks. */
export async function deleteSubagentSessionForCleanup(params: {
  callGateway: CallGateway;
  childSessionKey: string;
  runId: string;
  spawnMode?: SpawnSubagentMode;
  onError?: (error: unknown) => void;
}): Promise<{ ok: boolean; error: unknown | null }> {
  try {
    await params.callGateway({
      method: "sessions.delete",
      params: {
        key: params.childSessionKey,
        operationId: buildSessionDeleteOperationId("subagent-cleanup", params.runId),
        deleteTranscript: true,
        emitLifecycleHooks: params.spawnMode === "session",
      },
      timeoutMs: 10_000,
    });
    return { ok: true, error: null };
  } catch (error) {
    params.onError?.(error);
    return { ok: false, error };
  }
}
