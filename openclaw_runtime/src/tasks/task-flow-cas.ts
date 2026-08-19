// RC-06A TaskFlow capability proof: SQLite-level expected-revision CAS, explicit
// legal transition graph, restart persistence, concurrent-writer rejection, and
// delivery-state consistency. This proves the durable concurrency semantics
// TaskFlow needs before it can be treated as a workflow owner. It operates on the
// same flow_runs table and openclaw-state SQLite, but as a controlled proof layer:
// the legacy blind upsert remains the active path until a cutover is proven.
import { randomUUID } from 'node:crypto';

import type { Insertable, Selectable } from 'kysely';

import {
  executeSqliteQuerySync,
  executeSqliteQueryTakeFirstSync,
  getNodeSqliteKysely,
} from '../infra/kysely-sync.js';
import {
  openOpenClawStateDatabase,
  runOpenClawStateWriteTransaction,
  type OpenClawStateDatabaseOptions,
} from '../state/openclaw-state-db.js';
import type { DB as OpenClawStateKyselyDatabase } from '../state/openclaw-state-db.generated.js';

export const TASK_FLOW_CAS_SCHEMA_VERSION = '1';

/** Create sentinel: a new flow MUST be created with expectedRevision = -1. */
export const CAS_CREATE_SENTINEL = -1;

export const FLOW_STATUSES = [
  'queued',
  'running',
  'waiting',
  'blocked',
  'succeeded',
  'failed',
  'cancelled',
  'lost',
] as const;
export type FlowStatus = (typeof FLOW_STATUSES)[number];

const TERMINAL_STATUSES: ReadonlySet<FlowStatus> = new Set(['succeeded', 'failed', 'cancelled', 'lost']);

/** Terminal statuses are absorbing and can never be an initial status. */
export function isTerminalFlowStatus(status: FlowStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

/**
 * Explicit legal transition graph. Only these transitions are allowed; any
 * other transition is rejected by the CAS write.
 */
export const LEGAL_FLOW_TRANSITIONS: ReadonlyArray<readonly [FlowStatus, FlowStatus]> = [
  ['queued', 'running'],
  ['queued', 'cancelled'],
  ['running', 'waiting'],
  ['running', 'blocked'],
  ['running', 'succeeded'],
  ['running', 'failed'],
  ['running', 'cancelled'],
  ['waiting', 'running'],
    ['waiting', 'failed'],
  ['waiting', 'cancelled'],
  ['blocked', 'running'],
  ['blocked', 'cancelled'],
  ['blocked', 'failed'],
  // Repeated non-terminal progress events (e.g. ClawGraph node_ready/started)
  // re-project the same running/blocked status idempotently.
  ['running', 'running'],
  ['waiting', 'waiting'],
  ['blocked', 'blocked'],
  // Terminal states are absorbing.
  ['succeeded', 'succeeded'],
  ['failed', 'failed'],
  ['cancelled', 'cancelled'],
  ['lost', 'lost'],
];

const LEGAL_TRANSITION_SET = new Set(LEGAL_FLOW_TRANSITIONS.map(([from, to]) => `${from}->${to}`));

export function isLegalTransition(from: FlowStatus, to: FlowStatus): boolean {
  return LEGAL_TRANSITION_SET.has(`${from}->${to}`);
}

export type CasFlowRow = Selectable<OpenClawStateKyselyDatabase['flow_runs']>;
export type CasFlowDatabase = Pick<OpenClawStateKyselyDatabase, 'flow_runs'>;

export type CasWriteResult =
  | { ok: true; row: CasFlowRow; revision: number }
  | { ok: false; reason: 'revision-conflict' | 'illegal-transition' | 'not-found' | 'error'; message?: string };

export type CasFlowOptions = OpenClawStateDatabaseOptions;

export type CasUpsertInput = {
  flowId: string;
  /** expectedRevision = CAS_CREATE_SENTINEL (-1) creates a new flow; otherwise
   *  the writer must hold the current revision. */
  expectedRevision: number;
  status: FlowStatus;
  ownerKey?: string;
  currentStep?: string;
  /** Explicit null clears the field (e.g. wait payload on cancel/terminal). */
  stateJson?: string | null;
  waitJson?: string | null;
  /** Delivery projection, persisted on flow_runs.delivery_state in the same
   *  row/transaction as the lifecycle transition (never declared but dropped).
   *  Explicit null clears the field. */
  deliveryState?: string | null;
    /** Managed-flow controller ownership. `goal-wake` rows are the wait
     *  ledger and may only be created through this CAS writer. */
    controllerId?: string | null;
    /** Single dependency reference used by the goal-wake wait ledger. */
    blockedTaskId?: string | null;
    blockedSummary?: string | null;
};

/**
 * Expected-revision CAS write against flow_runs. Creation requires the explicit
 * create sentinel (expectedRevision = -1) and a non-terminal initial status;
 * updates are guarded by `WHERE flow_id = ? AND revision = ?` at the SQL level
 * so a stale or concurrent writer is rejected atomically (affected rows = 0).
 * The legal transition graph is validated inside the same immediate
 * transaction as the write. delivery_state persists on the same row, so
 * delivery/lifecycle can never split.
 */
export class TaskFlowCasStore {
  #database: CasFlowOptions = {};

  constructor(options: CasFlowOptions = {}) {
    this.#database = options;
  }

  casUpsert(input: CasUpsertInput): CasWriteResult {
    let result: CasWriteResult | undefined;
    runOpenClawStateWriteTransaction(({ db }) => {
      const query = getNodeSqliteKysely<CasFlowDatabase>(db);
      const existing = executeSqliteQueryTakeFirstSync(
        db,
        query.selectFrom('flow_runs').selectAll().where('flow_id', '=', input.flowId),
      );

      if (!existing) {
        // ---- CREATE path: explicit sentinel + non-terminal initial status.
        if (input.expectedRevision !== CAS_CREATE_SENTINEL) {
          result = {
            ok: false,
            reason: 'revision-conflict',
            message: `new flow requires expectedRevision=${CAS_CREATE_SENTINEL}, got ${input.expectedRevision}`,
          };
          return;
        }
        if (isTerminalFlowStatus(input.status)) {
          result = {
            ok: false,
            reason: 'illegal-transition',
            message: `terminal status ${input.status} cannot be an initial status`,
          };
          return;
        }
        const now = Date.now();
        const row: Insertable<CasFlowRow> = {
          flow_id: input.flowId,
          shape: null,
          sync_mode: 'managed',
          owner_key: input.ownerKey ?? 'cas-proof',
          requester_origin_json: null,
          controller_id: input.controllerId ?? null,
          revision: 0,
          status: input.status,
          notify_policy: 'done_only',
          goal: `cas-${input.flowId}`,
          current_step: input.currentStep ?? null,
          blocked_task_id: input.blockedTaskId ?? null,
          blocked_summary: input.blockedSummary ?? null,
          state_json: input.stateJson ?? null,
          wait_json: input.waitJson ?? null,
          delivery_state: input.deliveryState ?? null,
          cancel_requested_at: null,
          created_at: now,
          updated_at: now,
          ended_at: null,
        };
        executeSqliteQuerySync(db, query.insertInto('flow_runs').values(row));
        const inserted = executeSqliteQueryTakeFirstSync(
          db,
          query.selectFrom('flow_runs').selectAll().where('flow_id', '=', input.flowId),
        );
        result = inserted ? { ok: true, row: inserted, revision: 0 } : { ok: false, reason: 'not-found' };
        return;
      }

      // ---- UPDATE path: revision CAS + legal transition, atomic in SQL.
      const currentRevision = normalizeNumber(existing.revision) ?? 0;
      if (currentRevision !== input.expectedRevision) {
        result = {
          ok: false,
          reason: 'revision-conflict',
          message: `expected ${input.expectedRevision}, got ${currentRevision}`,
        };
        return;
      }
      const currentStatus = existing.status as FlowStatus;
      if (
        input.controllerId !== undefined
        && existing.controller_id != null
        && existing.controller_id !== input.controllerId
      ) {
        result = {
          ok: false,
          reason: 'illegal-transition',
          message: `controller ownership is immutable (${existing.controller_id}->${input.controllerId ?? 'null'})`,
        };
        return;
      }
      if (!isLegalTransition(currentStatus, input.status)) {
        result = { ok: false, reason: 'illegal-transition', message: `${currentStatus}->${input.status}` };
        return;
      }
      const nextRevision = currentRevision + 1;
      const now = Date.now();
      const endedAt =
        input.status === 'succeeded' || input.status === 'failed' || input.status === 'cancelled' || input.status === 'lost'
          ? now
          : existing.ended_at ?? null;
      const updatedResult = executeSqliteQuerySync(
        db,
        query
          .updateTable('flow_runs')
          .set({
            status: input.status,
            revision: nextRevision,
            owner_key: input.ownerKey ?? existing.owner_key,
            controller_id: input.controllerId !== undefined ? input.controllerId : existing.controller_id,
            current_step: input.currentStep ?? existing.current_step,
            blocked_task_id: input.blockedTaskId !== undefined ? input.blockedTaskId : existing.blocked_task_id,
            blocked_summary: input.blockedSummary !== undefined ? input.blockedSummary : existing.blocked_summary,
            state_json: input.stateJson !== undefined ? input.stateJson : existing.state_json,
            wait_json: input.waitJson !== undefined ? input.waitJson : existing.wait_json,
            delivery_state: input.deliveryState !== undefined ? input.deliveryState : existing.delivery_state,
            updated_at: now,
            ended_at: endedAt,
          })
          .where('flow_id', '=', input.flowId)
          .where('revision', '=', input.expectedRevision),
      );
      const affected = Number(updatedResult.numAffectedRows ?? 0n);
      if (affected === 0) {
        result = {
          ok: false,
          reason: 'revision-conflict',
          message: `no row updated (revision guard) for ${input.flowId}`,
        };
        return;
      }
      const updated = executeSqliteQueryTakeFirstSync(
        db,
        query.selectFrom('flow_runs').selectAll().where('flow_id', '=', input.flowId),
      );
      result = updated ? { ok: true, row: updated, revision: nextRevision } : { ok: false, reason: 'not-found' };
    }, this.#database);
    return result ?? { ok: false, reason: 'error', message: 'no transaction outcome' };
  }

  /** Read a flow row; used to prove restart persistence. */
  getById(flowId: string): CasFlowRow | undefined {
    const { db } = openOpenClawStateDatabase(this.#database);
    const query = getNodeSqliteKysely<CasFlowDatabase>(db);
    return executeSqliteQueryTakeFirstSync(
      db,
      query.selectFrom('flow_runs').selectAll().where('flow_id', '=', flowId),
    );
  }

  /** List flows in a state; used to prove delivery-state consistency. */
  listByStatus(status: FlowStatus): CasFlowRow[] {
    const { db } = openOpenClawStateDatabase(this.#database);
    const query = getNodeSqliteKysely<CasFlowDatabase>(db);
    return executeSqliteQuerySync<CasFlowRow>(
      db,
      query.selectFrom('flow_runs').selectAll().where('status', '=', status).orderBy('created_at', 'asc'),
    ).rows;
  }
}

function normalizeNumber(value: number | bigint | null | undefined): number | undefined {
  if (typeof value === 'bigint') return Number(value);
  return typeof value === 'number' ? value : undefined;
}

export function makeCasFlowId(): string {
  return `flow_${randomUUID()}`;
}
