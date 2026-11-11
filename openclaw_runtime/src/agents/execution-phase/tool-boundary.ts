/** Opt-in durable dispatch and exclusive pre-effect execution claim. */
import { createHash } from "node:crypto";
import type { AgentMessage } from "../runtime/index.js";
import { stableStringify } from "../stable-stringify.js";
import { resolveWorkflowLifecycleMode } from "../../tasks/workflow-lifecycle-owner.js";
import {
  commitExecutionPhase,
  markExecutionNeedsReconciliation,
  readExecutionPhase,
  recordExecutionIntent,
  type ExecutionEffectClass,
  type ExecutionPhaseOptions,
  type ExecutionPhaseRow,
} from "./store.js";

export const EXECUTION_PHASE_WRITER_ENV = "OPENCLAW_EXECUTION_PHASE_WRITER";
export function isExecutionPhaseWriterEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    resolveWorkflowLifecycleMode("task-loop", env) === "taskflow" &&
    env[EXECUTION_PHASE_WRITER_ENV]?.trim().toLowerCase() === "taskflow"
  );
}
const UNSAFE_TOOLS = new Set([
  "write",
  "edit",
  "apply_patch",
  "undo_write",
  "bash",
  "exec",
  "process",
  "message",
]);
const SAFE_TOOLS = new Set([
  "read",
  "ls",
  "glob",
  "grep",
  "find",
  "web_search",
  "web_fetch",
  "session_status",
]);
export function classifyToolEffect(toolName: string): ExecutionEffectClass {
  const name = toolName.trim().toLowerCase();
  return UNSAFE_TOOLS.has(name) ? "unsafe" : SAFE_TOOLS.has(name) ? "safe" : "reconcile";
}
export type ToolIntentKey = {
  runId?: string;
  sessionKey?: string;
  sessionId?: string;
  toolCallId?: string;
  toolName: string;
  args: unknown;
};
export function buildToolIntentIdempotencyKey(key: ToolIntentKey): string | null {
  return key.sessionKey && key.sessionId && key.toolCallId
    ? JSON.stringify([key.sessionKey, key.sessionId, key.toolCallId])
    : null;
}
function toolIntent(key: ToolIntentKey) {
  return {
    boundaryVersion: 2,
    sessionId: key.sessionId,
    toolCallId: key.toolCallId,
    argsDigest: createHash("sha256").update(stableStringify(key.args)).digest("hex"),
  };
}
export function matchesToolIntent(row: ExecutionPhaseRow, key: ToolIntentKey): boolean {
  return (
    row.idempotency_key === buildToolIntentIdempotencyKey(key) &&
    row.tool_name === key.toolName &&
    row.session_key === key.sessionKey &&
    row.intent_json === JSON.stringify(toolIntent(key))
  );
}
export function recordToolDispatch(
  key: ToolIntentKey,
  options: ExecutionPhaseOptions = {},
): string {
  const idempotencyKey = buildToolIntentIdempotencyKey(key);
  if (!idempotencyKey)
    throw new Error("execution phase requires session generation and tool call identity");
  recordExecutionIntent(
    {
      idempotencyKey,
      sessionKey: key.sessionKey,
      runId: key.runId,
      toolName: key.toolName,
      effectClass: classifyToolEffect(key.toolName),
      intent: toolIntent(key),
    },
    options,
  );
  return idempotencyKey;
}
/** Called only after the assistant call message has reached the transcript. */
export function recordAssistantToolDispatches(
  message: AgentMessage,
  context: Pick<ToolIntentKey, "runId" | "sessionKey" | "sessionId"> & {
    toolNames?: ReadonlySet<string>;
  },
  options: ExecutionPhaseOptions = {},
): void {
  if (
    !isExecutionPhaseWriterEnabled() ||
    message.role !== "assistant" ||
    message.stopReason === "aborted" ||
    message.stopReason === "error"
  )
    return;
  for (const call of message.content) {
    if (call.type === "toolCall" && (!context.toolNames || context.toolNames.has(call.name))) {
      recordToolDispatch(
        { ...context, toolName: call.name, toolCallId: call.id, args: call.arguments },
        options,
      );
    }
  }
}
export function beginToolExecution(
  key: ToolIntentKey,
  env: NodeJS.ProcessEnv = process.env,
  options: ExecutionPhaseOptions = {},
): string | null {
  if (!isExecutionPhaseWriterEnabled(env)) return null;
  // A failed write must prevent execution. Claim commits before any effect.
  const idempotencyKey = buildToolIntentIdempotencyKey(key);
  if (!idempotencyKey)
    throw new Error("execution phase requires session generation and tool call identity");
  let row = readExecutionPhase(idempotencyKey, options);
  if (!row) {
    // Dynamically cataloged tools have no top-level assistant call of their
    // own. They still need a durable pre-effect claim, but the transcript
    // recovery planner cannot replay them without a matching assistant call.
    recordToolDispatch(key, options);
    row = readExecutionPhase(idempotencyKey, options);
  }
  // Arguments may
  // have been schema-coerced or policy-adjusted by now; recovery matched the
  // original transcript digest before entering those same validators/hooks.
  if (
    !row ||
    row.phase !== "dispatched" ||
    row.tool_name !== key.toolName ||
    JSON.parse(row.intent_json).boundaryVersion !== 2 ||
    (row.run_id !== (key.runId ?? null) && JSON.parse(row.recovery_json).resumeAuthorized !== true)
  ) {
    throw new Error("execution phase requires reconciliation; refusing duplicate tool execution");
  }
  const claimed = commitExecutionPhase(
    {
      idempotencyKey,
      from: "dispatched",
      to: "effect_pending",
      expectedRevision: row.revision,
    },
    options,
  );
  if (!claimed.ok) throw new Error(`execution phase claim failed: ${claimed.reason}`);
  return idempotencyKey;
}
export function completeToolExecution(
  idempotencyKey: string | null,
  options: ExecutionPhaseOptions = {},
): void {
  if (!idempotencyKey) return;
  // A failed commit leaves effect_pending as conservative recovery truth.
  commitExecutionPhase({ idempotencyKey, from: "effect_pending", to: "effect_committed" }, options);
}
export function failToolExecution(
  idempotencyKey: string | null,
  options: ExecutionPhaseOptions = {},
): void {
  if (!idempotencyKey) return;
  // A throw or abort can occur AFTER an effect. It never proves not_applied.
  markExecutionNeedsReconciliation(
    idempotencyKey,
    "tool-execution-interrupted",
    Date.now(),
    options,
  );
}

/** Settle the same lifecycle only after the real result has been persisted. */
export function settlePersistedToolResult(
  message: AgentMessage,
  context: Pick<ToolIntentKey, "sessionKey" | "sessionId">,
  options: ExecutionPhaseOptions = {},
): void {
  if (!isExecutionPhaseWriterEnabled() || message.role !== "toolResult") return;
  const details = message.details as { openclawSyntheticMissingToolResult?: boolean } | undefined;
  if (details?.openclawSyntheticMissingToolResult) return;
  const key = buildToolIntentIdempotencyKey({
    ...context,
    toolCallId: message.toolCallId,
    toolName: message.toolName,
    args: null,
  });
  if (!key) return;
  const row = readExecutionPhase(key, options);
  if (!row || row.phase !== "effect_committed") return;
  const verified = commitExecutionPhase(
    {
      idempotencyKey: key,
      from: "effect_committed",
      to: "verified",
      expectedRevision: row.revision,
    },
    options,
  );
  if (verified.ok)
    commitExecutionPhase(
      {
        idempotencyKey: key,
        from: "verified",
        to: "terminal",
        expectedRevision: verified.revision,
      },
      options,
    );
}
