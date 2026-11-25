/** Restart decision made from bound durable phases and the active transcript. */
import {
  authorizeExecutionRecovery,
  readOpenExecutionPhases,
  type ExecutionPhaseOptions,
} from "./store.js";
import { buildToolIntentIdempotencyKey, isExecutionPhaseWriterEnabled } from "./tool-boundary.js";
import { planPendingToolRecovery } from "./retry-authorization.js";
import type { SessionEntry } from "../../config/sessions/types.js";
import { redispatchPendingToolCalls } from "./redispatch.js";

export function hasPersistedToolRecoveryAdmission(
  entry: SessionEntry | undefined,
  sessionId: string,
  runId: string,
): boolean {
  const main = entry?.restartRecovery;
  const subagent = entry?.subagentRecovery?.authority;
  const mainAdmitted = main?.authority
    ? main.authority.decision.entry === "main-session-restart" &&
      main.authority.decision.kind === "resume" &&
      main.authority.attempts > 0 &&
      main.authority.idempotencyKey === runId &&
      entry?.lifecycleRunId === runId &&
      entry.status === "running" &&
      ["pending", "accepted", "reconcile"].includes(main.authority.state)
    : main?.state !== "wedged";
  return (
    entry?.sessionId === sessionId &&
    (((main?.sessionId === sessionId ||
      (entry?.lifecycleRunId === main?.runId &&
        main &&
        entry?.usageFamilySessionIds?.includes(main.sessionId))) &&
      main?.runId === runId &&
      mainAdmitted) ||
      (subagent?.idempotencyKey === runId &&
        subagent.decision.entry === "subagent-orphan" &&
        subagent.decision.kind === "resume" &&
        subagent.attempts > 0 &&
        (subagent.state === "pending" ||
          subagent.state === "accepted" ||
          subagent.state === "reconcile")))
  );
}

export async function redispatchAdmittedSessionTools(
  params: Parameters<typeof redispatchPendingToolCalls>[0] & {
    entry: SessionEntry | undefined;
    runId: string;
  },
): Promise<Awaited<ReturnType<typeof redispatchPendingToolCalls>>> {
  const admitted = hasPersistedToolRecoveryAdmission(params.entry, params.sessionId, params.runId);
  if (!admitted) return params.context.messages;
  const messages = await redispatchPendingToolCalls(params);
  let end = messages.length;
  while (end > 0) {
    const tail = messages[end - 1];
    if (
      tail.role !== "assistant" ||
      tail.stopReason !== "aborted" ||
      tail.content.some((part) => part.type === "toolCall")
    )
      break;
    end--;
  }
  // Keep interrupted assistant output in the transcript; model continuation
  // resumes from the durable user intent or tool result that preceded it.
  return end === messages.length ? messages : messages.slice(0, end);
}

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
