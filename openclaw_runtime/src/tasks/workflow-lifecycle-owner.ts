// RC-06B..D workflow lifecycle owner. ClawGraph, Mission, and Task Loop each
// select exactly one lifecycle writer:
//   legacy     - the domain's own state is authoritative; TaskFlow is not written.
//   projection - legacy stays authoritative; TaskFlow receives an observational
//                copy and every rejected write is recorded as drift.
//   taskflow   - cutover: the TaskFlow CAS row is the lifecycle truth. A domain
//                applies a status to its own state only after the CAS commit
//                succeeds, so the legacy field is a cache of the committed row.
// Rollback is selecting legacy again: the TaskFlow writer is then frozen and no
// mode ever writes both authorities as truth.
import { isTruthyEnvValue } from '../infra/env.js';
import {
  CAS_CREATE_SENTINEL,
  isTerminalFlowStatus,
  TaskFlowCasStore,
  type CasFlowRow,
  type CasWriteResult,
  type FlowStatus,
} from './task-flow-cas.js';

export type WorkflowLifecycleDomain = 'clawgraph' | 'mission' | 'task-loop';
export type WorkflowLifecycleMode = 'legacy' | 'projection' | 'taskflow';

export const WORKFLOW_LIFECYCLE_CONTROLLER_IDS: Record<WorkflowLifecycleDomain, string> = {
  clawgraph: 'clawgraph-lifecycle',
  mission: 'mission-lifecycle',
  'task-loop': 'task-loop-lifecycle',
};

const MODE_ENV: Record<WorkflowLifecycleDomain, string> = {
  clawgraph: 'OPENCLAW_CLAWGRAPH_LIFECYCLE_WRITER',
  mission: 'OPENCLAW_MISSION_LIFECYCLE_WRITER',
  'task-loop': 'OPENCLAW_TASK_LOOP_LIFECYCLE_WRITER',
};

/** Pre-cutover projection switches kept as aliases for `projection`. */
const PROJECTION_ENV: Record<WorkflowLifecycleDomain, string> = {
  clawgraph: 'RC06B_CLAWGRAPH_PROJECTION',
  mission: 'RC06C_MISSION_PROJECTION',
  'task-loop': 'RC06D_TASK_LOOP_PROJECTION',
};

export function isWorkflowLifecycleControllerId(controllerId: string | null | undefined): boolean {
  return controllerId != null && Object.values(WORKFLOW_LIFECYCLE_CONTROLLER_IDS).includes(controllerId);
}

export function resolveWorkflowLifecycleMode(
  domain: WorkflowLifecycleDomain,
  env: NodeJS.ProcessEnv = process.env,
): WorkflowLifecycleMode {
  const raw = env[MODE_ENV[domain]]?.trim().toLowerCase();
  if (raw === 'legacy' || raw === 'projection' || raw === 'taskflow') return raw;
  return isTruthyEnvValue(env[PROJECTION_ENV[domain]]) ? 'projection' : 'legacy';
}

export function workflowLifecycleFlowId(domain: WorkflowLifecycleDomain, id: string): string {
  return `${domain}:${id}`;
}

export type WorkflowLifecycleDrift = {
  domain: WorkflowLifecycleDomain;
  reason: 'revision-conflict' | 'illegal-transition' | 'not-found' | 'error';
  transition: string;
  count: number;
};

const drift = new Map<string, WorkflowLifecycleDrift>();

function recordDrift(domain: WorkflowLifecycleDomain, reason: WorkflowLifecycleDrift['reason'], transition: string) {
  const key = `${domain}|${reason}|${transition}`;
  const existing = drift.get(key);
  drift.set(key, { domain, reason, transition, count: (existing?.count ?? 0) + 1 });
}

/** Rejected lifecycle writes, never silently dropped. */
export function getWorkflowLifecycleDrift(): WorkflowLifecycleDrift[] {
  return [...drift.values()];
}

export function resetWorkflowLifecycleDriftForTest(): void {
  drift.clear();
}

export type WorkflowLifecycleOptions = {
  database?: { env?: NodeJS.ProcessEnv; path?: string };
};

export type WorkflowLifecycleCommit =
  | { ok: true; status: FlowStatus; revision: number; unchanged?: boolean }
  | { ok: false; reason: WorkflowLifecycleDrift['reason']; current?: FlowStatus };

function revisionOf(row: CasFlowRow): number {
  return typeof row.revision === 'bigint' ? Number(row.revision) : (row.revision ?? 0);
}

/**
 * Commit one lifecycle status through the TaskFlow CAS writer. A status equal
 * to the committed one is a no-op. A revision race is retried once against the
 * fresh row; any other rejection is recorded as drift and returned.
 */
export function commitWorkflowLifecycle(input: {
  domain: WorkflowLifecycleDomain;
  id: string;
  status: FlowStatus;
  currentStep?: string;
  stateJson?: string | null;
  options?: WorkflowLifecycleOptions;
}): WorkflowLifecycleCommit {
  const store = new TaskFlowCasStore(input.options?.database ?? {});
  const flowId = workflowLifecycleFlowId(input.domain, input.id);
  let result: CasWriteResult | undefined;
  let from: string = 'none';
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const existing = store.getById(flowId);
    from = existing?.status ?? 'none';
    if (
      existing &&
      existing.status === input.status &&
      input.currentStep === undefined &&
      input.stateJson === undefined
    ) {
      return { ok: true, status: input.status, revision: revisionOf(existing), unchanged: true };
    }
    result = store.casUpsert({
      flowId,
      expectedRevision: existing ? revisionOf(existing) : CAS_CREATE_SENTINEL,
      status: input.status,
      ownerKey: `${input.domain}-runtime`,
      controllerId: WORKFLOW_LIFECYCLE_CONTROLLER_IDS[input.domain],
      ...(input.currentStep !== undefined ? { currentStep: input.currentStep } : {}),
      ...(input.stateJson !== undefined ? { stateJson: input.stateJson } : {}),
    });
    if (result.ok || result.reason !== 'revision-conflict') break;
  }
  if (result?.ok) return { ok: true, status: input.status, revision: result.revision };
  const reason = result?.reason ?? 'error';
  recordDrift(input.domain, reason, `${from}->${input.status}`);
  const current = store.getById(flowId)?.status as FlowStatus | undefined;
  return { ok: false, reason, ...(current ? { current } : {}) };
}

export function readWorkflowLifecycle(
  domain: WorkflowLifecycleDomain,
  id: string,
  options: WorkflowLifecycleOptions = {},
): CasFlowRow | undefined {
  return new TaskFlowCasStore(options.database ?? {}).getById(workflowLifecycleFlowId(domain, id));
}

export function listWorkflowLifecycles(
  domain: WorkflowLifecycleDomain,
  options: WorkflowLifecycleOptions = {},
): CasFlowRow[] {
  return new TaskFlowCasStore(options.database ?? {}).listByController(WORKFLOW_LIFECYCLE_CONTROLLER_IDS[domain]);
}

/**
 * Restart recovery: a non-terminal lifecycle whose live controller is gone
 * after a process restart can no longer progress, so it is settled as lost
 * through the CAS writer. Returns the ids that were settled.
 */
export function settleOrphanedWorkflowLifecycles(input: {
  domain: WorkflowLifecycleDomain;
  isLive: (id: string) => boolean;
  options?: WorkflowLifecycleOptions;
}): string[] {
  const prefix = `${input.domain}:`;
  const settled: string[] = [];
  for (const row of listWorkflowLifecycles(input.domain, input.options)) {
    if (isTerminalFlowStatus(row.status as FlowStatus)) continue;
    const id = row.flow_id.slice(prefix.length);
    if (input.isLive(id)) continue;
    const committed = commitWorkflowLifecycle({
      domain: input.domain,
      id,
      status: 'lost',
      currentStep: 'restart:controller-gone',
      options: input.options,
    });
    if (committed.ok) settled.push(id);
  }
  return settled;
}
