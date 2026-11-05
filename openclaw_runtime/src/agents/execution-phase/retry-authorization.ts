/** A durable dispatch authorizes execution; transcript repair text never does. */
import type { AssistantMessage } from "../../../packages/llm-core/src/index.js";
import type { AgentMessage } from "../runtime/index.js";
import { DEFAULT_MISSING_TOOL_RESULT_TEXT } from "../session-transcript-repair.js";
import { matchesToolIntent, buildToolIntentIdempotencyKey } from "./tool-boundary.js";
import type { ExecutionPhaseRow } from "./store.js";

function isSyntheticResult(message: Extract<AgentMessage, { role: "toolResult" }>): boolean {
  const details = message.details as { openclawSyntheticMissingToolResult?: boolean } | undefined;
  return (
    details?.openclawSyntheticMissingToolResult === true ||
    message.content.some(
      (block) => block.type === "text" && block.text === DEFAULT_MISSING_TOOL_RESULT_TEXT,
    )
  );
}

export function planPendingToolRecovery(params: {
  messages: readonly unknown[];
  rows: ExecutionPhaseRow[];
  sessionKey: string;
  sessionId: string;
}): AssistantMessage | null {
  const messages = params.messages as readonly AgentMessage[];
  for (const row of params.rows) {
    const intent = JSON.parse(row.intent_json) as { sessionId?: string };
    if (intent.sessionId === params.sessionId && row.phase === "effect_pending") {
      throw new Error(
        "effect outcome requires reconciliation, even if an error result was persisted",
      );
    }
  }
  // Only the active tail batch is eligible. Older turns and sibling branches
  // cannot be resurrected just because their dispatch row still exists.
  const lastAssistant = messages.findLast((message) => message?.role === "assistant");
  if (
    !lastAssistant ||
    lastAssistant.role !== "assistant" ||
    lastAssistant.stopReason === "error" ||
    lastAssistant.stopReason === "aborted" ||
    !Array.isArray(lastAssistant.content)
  )
    return null;
  if (
    messages
      .slice(messages.lastIndexOf(lastAssistant) + 1)
      .some((message) => message?.role === "user")
  )
    return null;
  const completed = new Set(
    messages.flatMap((message) =>
      message?.role === "toolResult" && !isSyntheticResult(message) ? [message.toolCallId] : [],
    ),
  );
  const pending = lastAssistant.content.filter(
    (call) => call.type === "toolCall" && !completed.has(call.id),
  );
  if (pending.length === 0) return null;
  const rowsByKey = new Map(params.rows.map((row) => [row.idempotency_key, row]));
  for (const call of pending) {
    if (call.type !== "toolCall") continue;
    const key = {
      sessionKey: params.sessionKey,
      sessionId: params.sessionId,
      toolCallId: call.id,
      toolName: call.name,
      args: call.arguments,
    };
    const row = rowsByKey.get(buildToolIntentIdempotencyKey(key) ?? "");
    if (!row || row.phase !== "dispatched" || !matchesToolIntent(row, key)) {
      throw new Error(
        `tool call ${call.id} requires reconciliation; no matching unstarted dispatch`,
      );
    }
  }
  return { ...lastAssistant, content: pending };
}
