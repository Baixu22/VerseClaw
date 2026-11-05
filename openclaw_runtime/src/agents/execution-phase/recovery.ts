/** Restart decision made from bound durable phases and the active transcript. */
import {
  authorizeExecutionRecovery,
  readOpenExecutionPhases,
  type ExecutionPhaseOptions,
} from "./store.js";
import { buildToolIntentIdempotencyKey, isExecutionPhaseWriterEnabled } from "./tool-boundary.js";
import { planPendingToolRecovery } from "./retry-authorization.js";

export type ExecutionPhaseRecoveryAction = "none" | "resume" | "reconcile";
export type ExecutionPhaseRecovery = {
  action: ExecutionPhaseRecoveryAction;
  phases: string[];
  reason: string;
};
export function resolveExecutionPhaseRecovery(
  sessionKey: string,
  env: NodeJS.ProcessEnv = process.env,
  options: ExecutionPhaseOptions = {},
  transcript?: { sessionId: string; messages: readonly unknown[] },
): ExecutionPhaseRecovery {
  if (!isExecutionPhaseWriterEnabled(env)) {
    return { action: "none", phases: [], reason: "execution-phase writer disabled" };
  }
  try {
    const rows = readOpenExecutionPhases(sessionKey, options);
    const phases = rows.map((row) => row.phase);
    if (transcript) {
      const pending = planPendingToolRecovery({ ...transcript, sessionKey, rows });
      return {
        action: pending ? "resume" : "none",
        phases,
        reason: pending ? "bound unstarted dispatch" : "no pending tools in active tail",
      };
    }
    return {
      action: rows.length ? "reconcile" : "none",
      phases,
      reason: "active transcript required for authorization",
    };
  } catch (error) {
    return { action: "reconcile", phases: [], reason: String(error) };
  }
}

export function authorizePendingToolRecovery(
  params: {
    sessionKey: string;
    sessionId: string;
    messages: readonly unknown[];
  },
  options: ExecutionPhaseOptions = {},
): void {
  const rows = readOpenExecutionPhases(params.sessionKey, options);
  const pending = planPendingToolRecovery({ ...params, rows });
  for (const call of pending?.content ?? []) {
    if (call.type !== "toolCall") continue;
    const key = buildToolIntentIdempotencyKey({
      ...params,
      toolCallId: call.id,
      toolName: call.name,
      args: call.arguments,
    });
    const row = rows.find((entry) => entry.idempotency_key === key);
    if (!row) throw new Error("recovery authorization disappeared");
    authorizeExecutionRecovery(row, options);
  }
}
