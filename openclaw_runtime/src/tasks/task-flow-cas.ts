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
  expectedRevision: number;
  status: FlowStatus;
  ownerKey?: string;
  currentStep?: string;
  stateJson?: string;
  waitJson?: string;
  deliveryState?: string;
};

/**
 * Expected-revision CAS upsert against flow_runs. Reads the current row in the
 * same immediate transaction, checks the expected revision and the legal
 * transition, and only then writes. A concurrent writer with a stale revision is
 * rejected atomically.
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
      const currentStatus = existing ? (existing.status as FlowStatus) : 'queued';
      const currentRevision = existing ? normalizeNumber(existing.revision) ?? 0 : 0;

      if (existing && currentRevision !== input.expectedRevision) {
        result = { ok: false, reason: 'revision-conflict', message: `expected ${input.expectedRevision}, got ${currentRevision}` };
        return;
      }
      if (existing && !isLegalTransition(currentStatus, input.status)) {
        result = { ok: false, reason: 'illegal-transition', message: `${currentStatus}->${input.status}` };
        return;
      }
      const nextRevision = existing ? currentRevision + 1 : 0;
      const now = Date.now();
      const row: Insertable<CasFlowRow> = {
        flow_id: input.flowId,
        shape: existing?.shape ?? null,
        sync_mode: existing?.sync_mode ?? 'managed',
        owner_key: input.ownerKey ?? existing?.owner_key ?? 'cas-proof',
        requester_origin_json: existing?.requester_origin_json ?? null,
        controller_id: existing?.controller_id ?? null,
        revision: nextRevision,
        status: input.status,
        notify_policy: existing?.notify_policy ?? 'none',
        goal: existing?.goal ?? `cas-${input.flowId}`,
        current_step: input.currentStep ?? existing?.current_step ?? null,
        blocked_task_id: existing?.blocked_task_id ?? null,
        blocked_summary: existing?.blocked_summary ?? null,
        state_json: input.stateJson ?? existing?.state_json ?? null,
        wait_json: input.waitJson ?? existing?.wait_json ?? null,
        cancel_requested_at: existing?.cancel_requested_at ?? null,
        created_at: existing?.created_at ?? now,
        updated_at: now,
        ended_at: input.status === 'succeeded' || input.status === 'failed' || input.status === 'cancelled' ? now : existing?.ended_at ?? null,
      };
      executeSqliteQuerySync(
        db,
        query
          .insertInto('flow_runs')
          .values(row)
          .onConflict((conflict) =>
            conflict.column('flow_id').doUpdateSet({
              shape: (eb) => eb.ref('excluded.shape'),
              sync_mode: (eb) => eb.ref('excluded.sync_mode'),
              owner_key: (eb) => eb.ref('excluded.owner_key'),
              controller_id: (eb) => eb.ref('excluded.controller_id'),
              revision: (eb) => eb.ref('excluded.revision'),
              status: (eb) => eb.ref('excluded.status'),
              notify_policy: (eb) => eb.ref('excluded.notify_policy'),
              goal: (eb) => eb.ref('excluded.goal'),
              current_step: (eb) => eb.ref('excluded.current_step'),
              state_json: (eb) => eb.ref('excluded.state_json'),
              wait_json: (eb) => eb.ref('excluded.wait_json'),
              updated_at: (eb) => eb.ref('excluded.updated_at'),
              ended_at: (eb) => eb.ref('excluded.ended_at'),
            }),
          ),
      );
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
