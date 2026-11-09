import { DEFAULT_SUBAGENT_MAX_CHILDREN_PER_AGENT, DEFAULT_SUBAGENT_MAX_SPAWN_DEPTH } from "../config/agent-limits.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { CommandLane } from "../process/lanes.js";
import { getCommandLaneSnapshot } from "../process/command-queue.js";
import {
  SESSION_DELEGATION_ADMISSION_SCHEMA,
  SESSION_DELEGATION_RECEIPT_SCHEMA,
  type SessionDelegationAdmission,
  type SessionDelegationBudget,
  type SessionDelegationChildReceipt,
  type SessionDelegationCoordinator,
  type SessionDelegationIsolation,
  type SessionDelegationReceipt,
  type SessionDelegationStatus,
  type SessionDelegationToolAuthorization,
} from "../../../shared/types/session-delegation.js";
import type { OrchestrationRunResult } from "./orchestrator-run-observed.js";

export type DelegationWorkerExecution = {
  backend: "subagent";
  isolation: SessionDelegationIsolation;
  toolAuthorization: SessionDelegationToolAuthorization;
};

export type DelegationAdmissionParseResult =
  | { ok: true; admission: SessionDelegationAdmission }
  | { ok: false; error: string };

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function readCoordinator(value: unknown): SessionDelegationCoordinator | null {
  const record = readRecord(value);
  if (!record) return null;
  const workspaceId = readString(record.workspaceId);
  const agentId = readString(record.agentId);
  const sessionKey = readString(record.sessionKey);
  const bindingRevision = readInteger(record.bindingRevision);
  const sessionGeneration = readString(record.sessionGeneration);
  if (!workspaceId || !agentId || !sessionKey || bindingRevision === null || !sessionGeneration) {
    return null;
  }
  return { workspaceId, agentId, sessionKey, bindingRevision, sessionGeneration };
}

export function parseDelegationAdmission(value: unknown): DelegationAdmissionParseResult {
  const record = readRecord(value);
  if (!record) return { ok: false, error: "delegationAdmission must be an object" };
  if (record.schemaVersion !== SESSION_DELEGATION_ADMISSION_SCHEMA) {
    return { ok: false, error: "delegationAdmission schemaVersion is unsupported" };
  }
  const admissionId = readString(record.admissionId);
  const idempotencyKey = readString(record.idempotencyKey);
  const coordinator = readCoordinator(record.coordinator);
  const taskRef = readString(record.taskRef);
  const parentEnvironment = readRecord(record.parentEnvironment);
  const kind = parentEnvironment?.kind;
  const canonicalRoot = readString(parentEnvironment?.canonicalRoot);
  const backend = parentEnvironment?.backend;
  const branch = parentEnvironment?.branch;
  const detachedHead = parentEnvironment?.detachedHead;
  const setupProfile = parentEnvironment?.setupProfile;
  if (!admissionId || !idempotencyKey || !coordinator || !taskRef) {
    return { ok: false, error: "delegationAdmission requires admissionId, idempotencyKey, coordinator, and taskRef" };
  }
  if (
    !parentEnvironment ||
    (kind !== "local" && kind !== "managed-worktree") ||
    !canonicalRoot ||
    (backend !== "local-workspace" && backend !== "git") ||
    (branch !== null && typeof branch !== "string") ||
    typeof detachedHead !== "boolean" ||
    (setupProfile !== null && typeof setupProfile !== "string")
  ) {
    return { ok: false, error: "delegationAdmission parentEnvironment is invalid" };
  }
  return {
    ok: true,
    admission: {
      schemaVersion: SESSION_DELEGATION_ADMISSION_SCHEMA,
      admissionId,
      idempotencyKey,
      coordinator,
      taskRef,
      parentEnvironment: {
        kind,
        canonicalRoot,
        backend,
        branch,
        detachedHead,
        setupProfile,
      },
    },
  };
}

export function resolveDelegationBudget(
  cfg: OpenClawConfig | undefined,
  maxWorkers: number,
): SessionDelegationBudget {
  const lane = getCommandLaneSnapshot(CommandLane.Subagent);
  return {
    status: 'observed',
    reason: null,
    maxWorkers,
    process: {
      maxChildrenPerAgent:
        cfg?.agents?.defaults?.subagents?.maxChildrenPerAgent ?? DEFAULT_SUBAGENT_MAX_CHILDREN_PER_AGENT,
      maxSpawnDepth:
        cfg?.agents?.defaults?.subagents?.maxSpawnDepth ?? DEFAULT_SUBAGENT_MAX_SPAWN_DEPTH,
      source: "agents.defaults.subagents",
    },
    backgroundTerminal: {
      lane: "subagent",
      maxConcurrent: lane.maxConcurrent,
      activeCount: lane.activeCount,
      queuedCount: lane.queuedCount,
      source: "process.command-queue.subagent",
    },
  };
}

function fallbackAuthorization(roleName: string): SessionDelegationToolAuthorization {
  return {
    status: "runtime-inherited",
    source: "role-contract+runtime-inheritance",
    roleName,
    effectiveRoleName: roleName,
    parentRoleName: null,
    allowlist: null,
    denylist: [],
  };
}

function fallbackIsolation(admission: SessionDelegationAdmission): SessionDelegationIsolation {
  return {
    mode: "shared",
    backend: "shared-inprocess",
    canonicalRoot: admission.parentEnvironment.canonicalRoot,
    branch: admission.parentEnvironment.branch,
    detachedHead: admission.parentEnvironment.detachedHead,
    verifiedCheckout: false,
  };
}

function buildChildReceipts(
  admission: SessionDelegationAdmission,
  result: OrchestrationRunResult,
): SessionDelegationChildReceipt[] {
  return result.outcomes.map((outcome) => {
    const childSessionKey = outcome.spawn.result?.childSessionKey?.trim() || null;
    const childRunId = outcome.spawn.result?.runId?.trim() || null;
    const accepted = outcome.spawn.status === "accepted" && Boolean(childSessionKey) && Boolean(childRunId);
    const executionIsolation = outcome.execution?.isolation;
    const isolation = executionIsolation?.mode === "shared"
      ? {
          ...executionIsolation,
          canonicalRoot: executionIsolation.canonicalRoot || admission.parentEnvironment.canonicalRoot,
          branch: admission.parentEnvironment.branch,
          detachedHead: admission.parentEnvironment.detachedHead,
        }
      : executionIsolation ?? fallbackIsolation(admission);
    return {
      roleName: outcome.roleName,
      taskNodeId: outcome.ledger.taskNodeId ?? outcome.ledger.taskId,
      roleInstanceId: outcome.ledger.roleInstanceId,
      admissionStatus: accepted ? "accepted" : "rejected",
      runState: accepted ? "accepted-not-completed" : "not-accepted",
      completionObserved: false,
      backend: "subagent",
      childSessionKey,
      childRunId,
      toolAuthorization: outcome.execution?.toolAuthorization ?? (() => {
        const auth = outcome.spawn.authorization;
        if (!auth) return fallbackAuthorization(outcome.roleName);
        if ("status" in auth) return auth as unknown as SessionDelegationToolAuthorization;
        return {
          status: "effective" as const,
          source: "role-contract+parent-clamp" as const,
          roleName: outcome.roleName,
          effectiveRoleName: outcome.roleName,
          parentRoleName: null,
          allowlist: "allowlist" in auth ? auth.allowlist : null,
          denylist: "denylist" in auth ? auth.denylist : [],
        };
      })(),
      isolation,
      schedulerWave: outcome.ledger.executionWave ?? null,
      error: outcome.spawn.error ?? outcome.spawn.result?.error ?? null,
    };
  });
}

export function buildDelegationReceipt(params: {
  admission: SessionDelegationAdmission;
  orchestrationRunId: string;
  result: OrchestrationRunResult;
  maxWorkers: number;
  cfg?: OpenClawConfig;
  parentGenerationAfterRun?: string | null;
  now?: () => string;
}): SessionDelegationReceipt {
  const children = buildChildReceipts(params.admission, params.result);
  const acceptedCount = children.filter((child) => child.admissionStatus === "accepted").length;
  const generationChanged =
    params.parentGenerationAfterRun !== undefined &&
    params.parentGenerationAfterRun !== params.admission.coordinator.sessionGeneration;
  const errors = params.result.failures.map((failure) => `${failure.roleName}:${failure.status}${failure.error ? `:${failure.error}` : ""}`);
  if (generationChanged) {
    errors.push("parent-session-generation-changed-during-admission");
  }
  if (params.result.outcomes.some((outcome) => outcome.spawn.status === "accepted" && (!outcome.spawn.result?.runId || !outcome.spawn.result.childSessionKey))) {
    errors.push("spawn-accepted-without-child-session-and-run");
  }
  let status: SessionDelegationStatus;
  if (generationChanged) {
    status = acceptedCount > 0 ? "outcome-unknown" : "rejected";
  } else if (acceptedCount === 0) {
    status = "rejected";
  } else if (errors.length > 0 || acceptedCount !== params.result.taskGraph.nodes.length) {
    status = "partial";
  } else {
    status = "accepted";
  }
  return {
    schemaVersion: SESSION_DELEGATION_RECEIPT_SCHEMA,
    admissionId: params.admission.admissionId,
    idempotencyKey: params.admission.idempotencyKey,
    status,
    orchestrationRunId: params.orchestrationRunId,
    acceptedAt: acceptedCount > 0 ? (params.now?.() ?? new Date().toISOString()) : null,
    coordinator: params.admission.coordinator,
    taskRef: params.admission.taskRef,
    parentEnvironment: params.admission.parentEnvironment,
    parentEnvironmentRevision: params.admission.coordinator.bindingRevision,
    authorization: {
      approvalId: null,
      grantState: "authorized",
      owner: "gateway-permission",
    },
    budget: resolveDelegationBudget(params.cfg, params.maxWorkers),
    scheduler: {
      executionWaves: params.result.executionWaves.map((wave) => ({
        wave: wave.wave,
        taskNodeIds: [...wave.taskNodeIds],
        roles: [...wave.roles],
        reason: wave.reason,
        ...(wave.deferredReasons ? { deferredReasons: [...wave.deferredReasons] } : {}),
      })),
      metrics: {
        queued: params.result.schedulerMetrics.queued,
        running: params.result.schedulerMetrics.running,
        scheduled: params.result.schedulerMetrics.scheduled
          ?? new Set(params.result.executionWaves.flatMap(wave => wave.taskNodeIds)).size,
        skipped: params.result.schedulerMetrics.skipped,
        concurrencyCap: params.result.schedulerMetrics.concurrencyCap,
        budgetEstimate: params.result.schedulerMetrics.budgetEstimate,
      },
    },
    children,
    errors,
    completionObserved: false,
    recoveryRequired: generationChanged && acceptedCount > 0,
  };
}
