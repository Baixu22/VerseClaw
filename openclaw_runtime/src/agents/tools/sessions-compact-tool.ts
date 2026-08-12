/** Current-session manual compaction tool. */
import { Type } from "typebox";
import type {
  ManualCompactionRequest,
  ManualCompactionRequestStatus,
} from "../manual-compaction-request.js";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, readStringParam } from "./common.js";

const SessionsCompactToolSchema = Type.Object({
  customInstructions: Type.Optional(
    Type.String({
      description: "Optional instructions for what the compaction summary should preserve.",
      maxLength: 4_000,
    }),
  ),
});

/** Creates a tool that can request compaction only for its bound active session. */
export function createSessionsCompactTool(opts?: {
  sessionId?: string;
  onRequest?: (request: ManualCompactionRequest) => ManualCompactionRequestStatus;
}): AnyAgentTool {
  return {
    label: "Compact Session",
    name: "sessions_compact",
    description:
      "Compact this current session after the active turn finishes. Cannot target other sessions.",
    parameters: SessionsCompactToolSchema,
    execute: async (_toolCallId, args) => {
      if (!opts?.sessionId) {
        return jsonResult({ status: "error", error: "No current session context" });
      }
      if (!opts.onRequest) {
        return jsonResult({ status: "error", error: "Manual compaction is not supported here" });
      }
      const params = args as Record<string, unknown>;
      const customInstructions = readStringParam(params, "customInstructions");
      const request: ManualCompactionRequest = customInstructions ? { customInstructions } : {};
      const status = opts.onRequest(request);
      return jsonResult({
        status,
        session: "current",
        timing: "after_turn",
      });
    },
  };
}
