/** Current-session "checkpoint first, then new context" tool (TF-0645). */
import { Type } from "typebox";
import type { AnyAgentTool } from "./common.js";
import { jsonResult } from "./common.js";
import {
  createContextArchive,
  requestCheckpointedReset,
  verifyContextArchive,
  type ContextArchiveHandle,
} from "../checkpointed-context-reset.js";

export const SESSIONS_NEW_CONTEXT_TOOL_NAME = "sessions_new_context";

const SessionsNewContextToolSchema = Type.Object({});

export type SessionsNewContextToolResult = {
  status: "scheduled" | "refused" | "error";
  session?: "current";
  timing?: "after_turn";
  reason?: string;
  handle?: {
    archiveId: string;
    chars: number;
    sha256: string;
    createdAt: string;
  };
};

/**
 * Creates the checkpoint-first reset tool.
 *
 * The tool does not reset anything itself: it snapshots the current transcript,
 * proves the archive can be read back, and schedules the reset for after the
 * turn. The caller that owns the reply loop performs the reset, so a running turn
 * is never interrupted and no model turn is replayed.
 */
export function createSessionsNewContextTool(opts?: {
  sessionId?: string;
  sessionKey?: string;
  stateDir?: string;
  readTranscript?: () => string | undefined;
}): AnyAgentTool {
  return {
    label: "New Context (Checkpoint First)",
    name: SESSIONS_NEW_CONTEXT_TOOL_NAME,
    description:
      "Archive this session's transcript, verify the archive, then start a new context after the current turn finishes. Refuses instead of resetting when the archive cannot be verified.",
    parameters: SessionsNewContextToolSchema,
    execute: async () => {
      if (!opts?.sessionId) {
        return jsonResult({ status: "error", reason: "no-current-session" } satisfies SessionsNewContextToolResult);
      }
      if (!opts.readTranscript) {
        return jsonResult({
          status: "refused",
          reason: "reset-unsupported-here",
        } satisfies SessionsNewContextToolResult);
      }
      let payload: string | undefined;
      try {
        payload = opts.readTranscript();
      } catch {
        return jsonResult({ status: "refused", reason: "transcript-unreadable" } satisfies SessionsNewContextToolResult);
      }
      if (!payload) {
        return jsonResult({ status: "refused", reason: "empty-transcript" } satisfies SessionsNewContextToolResult);
      }
      let handle: ContextArchiveHandle;
      try {
        handle = createContextArchive({
          payload,
          sessionId: opts.sessionId,
          ...(opts.sessionKey ? { sessionKey: opts.sessionKey } : {}),
          ...(opts.stateDir ? { stateDir: opts.stateDir } : {}),
        });
      } catch (error) {
        return jsonResult({
          status: "refused",
          reason: error instanceof Error ? error.message : "archive-write-failed",
        } satisfies SessionsNewContextToolResult);
      }
      const verified = verifyContextArchive(handle);
      if (!verified.ok) {
        return jsonResult({
          status: "refused",
          reason: `archive-unverified:${verified.reason ?? "unknown"}`,
        } satisfies SessionsNewContextToolResult);
      }
      requestCheckpointedReset({ handle, sessionId: opts.sessionId });
      return jsonResult({
        status: "scheduled",
        session: "current",
        timing: "after_turn",
        handle: {
          archiveId: handle.archiveId,
          chars: handle.chars,
          sha256: handle.sha256,
          createdAt: handle.createdAt,
        },
      } satisfies SessionsNewContextToolResult);
    },
  };
}
