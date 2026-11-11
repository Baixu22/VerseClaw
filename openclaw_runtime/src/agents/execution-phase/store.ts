/** Execution phases are a projection of the TaskFlow owner, never a second ledger. */
import { randomUUID } from "node:crypto";
import {
  TaskFlowCasStore,
  CAS_CREATE_SENTINEL,
  type CasFlowRow,
  type FlowStatus,
} from "../../tasks/task-flow-cas.js";
import type { OpenClawStateDatabaseOptions } from "../../state/openclaw-state-db.js";
import {
  canTransition,
  type ExecutionPhase,
} from "../../../../shared/recovery-contract/execution-phase.js";

export const EXECUTION_PHASE_OWNER = "tool-execution";
export type ExecutionEffectClass = "safe" | "unsafe" | "reconcile";
export type ExecutionPhaseOptions = OpenClawStateDatabaseOptions;
type ExecutionState = {
  executionId: string;
  idempotencyKey: string;
  sessionKey: string | null;
  runId: string | null;
  taskId: string | null;
  toolName: string;
  effectClass: ExecutionEffectClass;
  intent: Record<string, unknown>;
  recovery: Record<string, unknown>;
};
export type ExecutionPhaseRow = {
  execution_id: string;
  idempotency_key: string;
  session_key: string | null;
  run_id: string | null;
  task_id: string | null;
  tool_name: string;
  effect_class: ExecutionEffectClass;
  phase: ExecutionPhase;
  revision: number;
  intent_json: string;
  recovery_json: string;
  created_at: number;
  updated_at: number;
};
export type RecordExecutionIntentInput = {
  idempotencyKey: string;
  toolName: string;
  effectClass: ExecutionEffectClass;
  sessionKey?: string;
  runId?: string;
  taskId?: string;
  intent?: Record<string, unknown>;
  now?: number;
};
export type RecordExecutionIntentResult = {
  ok: true;
  executionId: string;
  duplicate: boolean;
  phase: ExecutionPhase;
};
export type CommitExecutionPhaseInput = {
  idempotencyKey: string;
  from: ExecutionPhase;
  to: ExecutionPhase;
  expectedRevision?: number;
  recovery?: Record<string, unknown>;
  now?: number;
};
export type CommitExecutionPhaseFailure =
  | "not-found"
  | "revision-conflict"
  | "illegal-transition"
  | "write-failed";
export type CommitExecutionPhaseResult =
  | { ok: true; phase: ExecutionPhase; revision: number }
  | { ok: false; reason: CommitExecutionPhaseFailure };

const flowId = (key: string) => `tool-execution:${key}`;
function state(row: CasFlowRow): ExecutionState {
  if (row.controller_id !== EXECUTION_PHASE_OWNER || !row.execution_phase || !row.state_json) {
    throw new Error("execution lifecycle ownership mismatch");
  }
  return JSON.parse(row.state_json) as ExecutionState;
}
function project(row: CasFlowRow): ExecutionPhaseRow {
  const value = state(row);
  return {
    execution_id: value.executionId,
    idempotency_key: value.idempotencyKey,
    session_key: value.sessionKey,
    run_id: value.runId,
    task_id: value.taskId,
    tool_name: value.toolName,
    effect_class: value.effectClass,
    phase: row.execution_phase as ExecutionPhase,
    revision: row.revision,
    intent_json: JSON.stringify(value.intent),
    recovery_json: JSON.stringify(value.recovery),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
function phaseStatus(phase: ExecutionPhase, needsReconciliation = false): FlowStatus {
  if (phase === "terminal") return "succeeded";
  if (phase === "failed") return "failed";
  if (phase === "aborted") return "cancelled";
  return needsReconciliation ? "blocked" : "running";
}
export function readExecutionPhase(
  key: string,
  options: ExecutionPhaseOptions = {},
): ExecutionPhaseRow | undefined {
  const row = new TaskFlowCasStore(options).getById(flowId(key));
  return row ? project(row) : undefined;
}
export function readOpenExecutionPhases(
  sessionKey: string,
  options: ExecutionPhaseOptions = {},
): ExecutionPhaseRow[] {
  return new TaskFlowCasStore(options)
    .listByController(EXECUTION_PHASE_OWNER)
    .filter(
      (row) =>
        row.owner_key === sessionKey &&
        !["terminal", "failed", "aborted"].includes(row.execution_phase ?? ""),
    )
    .map(project);
}
export function recordExecutionIntent(
  input: RecordExecutionIntentInput,
  options: ExecutionPhaseOptions = {},
): RecordExecutionIntentResult {
  const store = new TaskFlowCasStore(options);
  const existing = store.getById(flowId(input.idempotencyKey));
  if (existing) {
    const row = project(existing);
    if (
      row.tool_name !== input.toolName ||
      row.session_key !== (input.sessionKey ?? null) ||
      row.intent_json !== JSON.stringify(input.intent ?? {})
    )
      throw new Error("execution intent identity conflict");
    return { ok: true, executionId: row.execution_id, duplicate: true, phase: row.phase };
  }
  const value: ExecutionState = {
    executionId: `exe_${randomUUID()}`,
    idempotencyKey: input.idempotencyKey,
    sessionKey: input.sessionKey ?? null,
    runId: input.runId ?? null,
    taskId: input.taskId ?? null,
    toolName: input.toolName,
    effectClass: input.effectClass,
    intent: input.intent ?? {},
    recovery: {},
  };
  const committed = store.casUpsert({
    flowId: flowId(input.idempotencyKey),
    expectedRevision: CAS_CREATE_SENTINEL,
    status: "running",
    executionPhase: "dispatched",
    controllerId: EXECUTION_PHASE_OWNER,
    ownerKey: input.sessionKey ?? "unbound",
    currentStep: input.toolName,
    stateJson: JSON.stringify(value),
  });
  if (!committed.ok) throw new Error(`execution intent commit failed: ${committed.reason}`);
  return { ok: true, executionId: value.executionId, duplicate: false, phase: "dispatched" };
}
export function commitExecutionPhase(
  input: CommitExecutionPhaseInput,
  options: ExecutionPhaseOptions = {},
): CommitExecutionPhaseResult {
  try {
    const store = new TaskFlowCasStore(options);
    const row = store.getById(flowId(input.idempotencyKey));
    if (!row) return { ok: false, reason: "not-found" };
    if (input.expectedRevision !== undefined && row.revision !== input.expectedRevision)
      return { ok: false, reason: "revision-conflict" };
    if (row.execution_phase === input.to)
      return { ok: true, phase: input.to, revision: row.revision };
    if (row.execution_phase !== input.from) return { ok: false, reason: "revision-conflict" };
    if (!canTransition(input.from, input.to)) return { ok: false, reason: "illegal-transition" };
    const value = state(row);
    value.recovery = input.recovery ?? {};
    const committed = store.casUpsert({
      flowId: row.flow_id,
      expectedRevision: row.revision,
      expectedExecutionPhase: input.from,
      executionPhase: input.to,
      status: phaseStatus(input.to),
      controllerId: EXECUTION_PHASE_OWNER,
      stateJson: JSON.stringify(value),
    });
    if (!committed.ok)
      return {
        ok: false,
        reason: committed.reason === "error" ? "write-failed" : committed.reason,
      };
    return { ok: true, phase: input.to, revision: committed.revision };
  } catch {
    return { ok: false, reason: "write-failed" };
  }
}
function updateRecovery(
  row: ExecutionPhaseRow,
  recovery: Record<string, unknown>,
  options: ExecutionPhaseOptions,
): boolean {
  const store = new TaskFlowCasStore(options);
  const current = store.getById(flowId(row.idempotency_key));
  if (!current || current.revision !== row.revision) return false;
  const value = state(current);
  value.recovery = recovery;
  return store.casUpsert({
    flowId: current.flow_id,
    expectedRevision: row.revision,
    expectedExecutionPhase: row.phase,
    executionPhase: row.phase,
    status: phaseStatus(row.phase, recovery.needsReconciliation === true),
    controllerId: EXECUTION_PHASE_OWNER,
    stateJson: JSON.stringify(value),
  }).ok;
}
export function markExecutionNeedsReconciliation(
  key: string,
  reason: string,
  now = Date.now(),
  options: ExecutionPhaseOptions = {},
): boolean {
  try {
    const row = readExecutionPhase(key, options);
    return (
      !!row && updateRecovery(row, { needsReconciliation: true, reason, settledAt: now }, options)
    );
  } catch {
    return false;
  }
}
export function authorizeExecutionRecovery(
  row: ExecutionPhaseRow,
  options: ExecutionPhaseOptions = {},
): void {
  if (row.phase !== "dispatched" || !updateRecovery(row, { resumeAuthorized: true }, options)) {
    throw new Error("recovery authorization revision conflict");
  }
}
export function settleOrphanedExecutionPhases(
  params: { runIdPrefix?: string; now?: number; options?: ExecutionPhaseOptions } = {},
): { settled: number; needsReconciliation: number } {
  let settled = 0;
  let needsReconciliation = 0;
  for (const flow of new TaskFlowCasStore(params.options).listByController(EXECUTION_PHASE_OWNER)) {
    const row = project(flow);
    if (params.runIdPrefix && !row.run_id?.startsWith(params.runIdPrefix)) continue;
    if (row.phase === "verified") {
      if (
        commitExecutionPhase(
          {
            idempotencyKey: row.idempotency_key,
            from: "verified",
            to: "terminal",
            expectedRevision: row.revision,
          },
          params.options,
        ).ok
      )
        settled++;
    }
    if (row.phase === "effect_pending" || row.phase === "effect_committed") {
      if (
        markExecutionNeedsReconciliation(
          row.idempotency_key,
          "gateway-restart",
          params.now,
          params.options,
        )
      )
        needsReconciliation++;
    }
  }
  return { settled, needsReconciliation };
}
