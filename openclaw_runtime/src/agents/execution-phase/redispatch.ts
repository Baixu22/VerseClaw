import {
  executeToolCalls,
  type ToolCallExecutionConfig,
} from "../../../packages/agent-core/src/agent-loop.js";
import type { AgentContext, AgentMessage } from "../runtime/index.js";
import { planPendingToolRecovery } from "./retry-authorization.js";
import { readOpenExecutionPhases, type ExecutionPhaseOptions } from "./store.js";
import { buildToolIntentIdempotencyKey, isExecutionPhaseWriterEnabled } from "./tool-boundary.js";

/** Run under the attempt's existing session lock, before transcript sanitization. */
export async function redispatchPendingToolCalls(params: {
  sessionKey: string;
  sessionId: string;
  context: AgentContext;
  config: ToolCallExecutionConfig;
  signal?: AbortSignal;
  appendResult: (message: Extract<AgentMessage, { role: "toolResult" }>) => string | undefined;
  options?: ExecutionPhaseOptions;
}): Promise<AgentMessage[]> {
  if (!isExecutionPhaseWriterEnabled()) return params.context.messages;
  const rows = readOpenExecutionPhases(params.sessionKey, params.options);
  const pending = planPendingToolRecovery({ ...params, messages: params.context.messages, rows });
  if (!pending) return params.context.messages;
  for (const call of pending.content) {
    if (call.type !== "toolCall") continue;
    const key = buildToolIntentIdempotencyKey({
      ...params,
      toolCallId: call.id,
      toolName: call.name,
      args: call.arguments,
    });
    const row = rows.find((entry) => entry.idempotency_key === key);
    if (!row || JSON.parse(row.recovery_json).resumeAuthorized !== true) {
      throw new Error("interrupted session owner has not authorized tool recovery");
    }
  }
  params.signal?.throwIfAborted();
  const messages = [...params.context.messages];
  // Reuse validation and extension hooks as well as the policy-wrapped tools.
  // No model request is involved, and the adapter claims each original call ID.
  await executeToolCalls(
    params.context,
    pending,
    { ...params.config, toolExecution: "sequential" },
    params.signal,
    (event) => {
      if (event.type === "message_end" && event.message.role === "toolResult") {
        if (!params.appendResult(event.message)) {
          throw new Error("recovered tool result was not persisted; reconciliation required");
        }
        messages.push(event.message);
      }
    },
  );
  return messages;
}
