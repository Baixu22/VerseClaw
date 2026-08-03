// RC-06B ClawGraph -> TaskFlow read-only projection. Step 1+2 of the four-step
// migration: observe the legacy ClawGraph process Map without behavior change and
// project run lifecycle events into flow_runs (via the RC-06A CAS store) behind a
// default-off flag. The legacy ClawGraph process Map remains authoritative until a
// separate cutover with idempotency and rollback proof. Indefinite dual-write is
// not a migration strategy.
import type { ClawGraphRunEvent } from './types.js';
import { TaskFlowCasStore, type FlowStatus } from '../../tasks/task-flow-cas.js';

export const CLAWGRAPH_PROJECTION_FLAG = 'rc06b.clawgraphProjection';
export const CLAWGRAPH_PROJECTION_SCHEMA_VERSION = '1';

export type ClawgraphProjectionOptions = {
  enabled?: boolean;
  database?: { env?: NodeJS.ProcessEnv; path?: string };
};

export type ClawgraphProjectionResult = {
  projected: boolean;
  flowId?: string;
  revision?: number;
  status?: FlowStatus;
  skippedReason?: 'flag-off' | 'unknown-event';
};

const EVENT_TO_FLOW_STATUS: Record<string, FlowStatus> = {
  run_started: 'running',
  node_started: 'running',
  node_ready: 'running',
  node_handoff: 'running',
  node_audit: 'running',
  node_done: 'running',
  review_requested: 'blocked',
  review_resolved: 'running',
  run_completed: 'succeeded',
  run_blocked: 'blocked',
  run_aborted: 'cancelled',
};

/**
 * Project one ClawGraph run lifecycle event into flow_runs using the CAS store.
 * The ClawGraph process Map remains authoritative; this is an observational
 * projection only. Returns whether the projection was applied.
 */
export function projectClawgraphRunEvent(
  event: ClawGraphRunEvent,
  options: ClawgraphProjectionOptions = {},
): ClawgraphProjectionResult {
  if (options.enabled !== true) {
    return { projected: false, skippedReason: 'flag-off' };
  }
  const targetStatus = EVENT_TO_FLOW_STATUS[event.type];
  if (!targetStatus) {
    return { projected: false, skippedReason: 'unknown-event' };
  }
  const flowId = `clawgraph:${event.runId}`;
  const store = new TaskFlowCasStore(options.database ?? {});
  // Read the current row to compute the expected revision (CAS write).
  const existing = store.getById(flowId);
  const expectedRevision = existing ? normalizeRevision(existing.revision) : 0;
  const result = store.casUpsert({
    flowId,
    expectedRevision,
    status: targetStatus,
    ownerKey: 'clawgraph-runtime',
    currentStep: event.nodeId ? `node:${event.nodeId}` : undefined,
    stateJson: JSON.stringify({ eventId: event.id, message: event.message }),
  });
  if (!result.ok) {
    // A conflicting projection is skipped rather than failing the legacy path.
    return { projected: false, skippedReason: result.reason === 'illegal-transition' ? 'unknown-event' : 'flag-off' };
  }
  return { projected: true, flowId, revision: result.revision, status: targetStatus };
}

/** Recover a ClawGraph run's projected flow state after restart. */
export function recoverClawgraphProjection(
  runId: string,
  options: ClawgraphProjectionOptions = {},
): { flowId?: string; status?: FlowStatus; recovered: boolean } {
  if (options.enabled !== true) {
    return { recovered: false };
  }
  const store = new TaskFlowCasStore(options.database ?? {});
  const row = store.getById(`clawgraph:${runId}`);
  if (!row) {
    return { recovered: false };
  }
  return { flowId: row.flow_id, status: row.status as FlowStatus, recovered: true };
}

function normalizeRevision(value: number | bigint | null | undefined): number {
  if (typeof value === 'bigint') return Number(value);
  return typeof value === 'number' ? value : 0;
}
