// RC-04 durable approval owner. Replaces the Gateway process Map pending/resolved
// truth with a durable approval_ledger in the existing openclaw-state SQLite. The
// state sequence is intent_reserved -> approval_pending -> approved|denied ->
// execution_started -> applied|not_applied|unknown -> reconciled. Repeated
// identical resolve is idempotent; denial produces no effect; an unknown outcome
// stops in needs_reconciliation and is never auto-replayed.
import { randomUUID } from 'node:crypto';

import type { Insertable, Selectable } from 'kysely';

import {
  getNodeSqliteKysely,
  executeSqliteQuerySync,
  executeSqliteQueryTakeFirstSync,
} from '../infra/kysely-sync.js';
import {
  openOpenClawStateDatabase,
  runOpenClawStateWriteTransaction,
  type OpenClawStateDatabaseOptions,
} from '../state/openclaw-state-db.js';
import type { DB as OpenClawStateKyselyDatabase } from '../state/openclaw-state-db.generated.js';

export const APPROVAL_LEDGER_SCHEMA_VERSION = '1';
export const APPROVAL_LEDGER_OWNER = 'openclaw_runtime.agents.approval-ledger';

export const APPROVAL_STATE_SEQUENCE = [
  'intent_reserved',
  'approval_pending',
  'approved',
  'denied',
  'execution_started',
  'applied',
  'not_applied',
  'unknown',
  'reconciled',
  'needs_reconciliation',
] as const;
export type ApprovalState = (typeof APPROVAL_STATE_SEQUENCE)[number];

export type ApprovalLedgerInsert = Insertable<OpenClawStateKyselyDatabase['approval_ledger']>;
export type ApprovalLedgerRow = Selectable<OpenClawStateKyselyDatabase['approval_ledger']>;
export type ApprovalLedgerDatabase = Pick<OpenClawStateKyselyDatabase, 'approval_ledger'>;

export type ApprovalRequestPayload = Record<string, unknown>;

export type ApprovalLedgerOptions = OpenClawStateDatabaseOptions;

export type ReserveApprovalInput = {
  idempotencyKey: string;
  /** Optional stable approval id; when present it is used as approval_id
   *  (mirrors the Gateway approval record id). Defaults to a generated id. */
  approvalId?: string;
  request: ApprovalRequestPayload;
  expiresAtMs: number;
  requestedByConnId?: string;
  requestedByDeviceId?: string;
  requestedByClientId?: string;
  createdAt?: number;
};

export type ResolveApprovalInput = {
  approvalId: string;
  decision: 'approved' | 'denied';
  resolvedBy?: string;
  resolvedAtMs?: number;
};

export type EffectOutcomeInput = {
  approvalId: string;
  outcome: 'applied' | 'not_applied' | 'unknown';
  effectReceiptId?: string;
  domainJournalRef?: string;
};

export type TransitionResult =
  | { ok: true; row: ApprovalLedgerRow }
  | { ok: false; reason: 'not-found' | 'state-conflict' | 'already-resolved'; row?: ApprovalLedgerRow };

/**
 * Durable approval ledger. Every transition is an idempotent, state-guarded write
 * through the shared openclaw-state immediate transaction. Restart survives
 * because rows persist in SQLite.
 */
export class ApprovalLedger {
  #database: ApprovalLedgerOptions = {};

  constructor(options: ApprovalLedgerOptions = {}) {
    this.#database = options;
  }

  /** Reserve an intent -> approval_pending. Idempotent under the same idempotency key. */
  reserve(input: ReserveApprovalInput): TransitionResult {
    let result: TransitionResult | undefined;
    runOpenClawStateWriteTransaction(({ db }) => {
      const query = getNodeSqliteKysely<ApprovalLedgerDatabase>(db);
      const existing = executeSqliteQueryTakeFirstSync(
        db,
        query.selectFrom('approval_ledger').selectAll().where('idempotency_key', '=', input.idempotencyKey),
      );
      if (existing) {
        result = { ok: true, row: existing };
        return;
      }
      const now = input.createdAt ?? Date.now();
      const row: ApprovalLedgerInsert = {
        approval_id: input.approvalId ?? `aprv_${randomUUID()}`,
        idempotency_key: input.idempotencyKey,
        state: 'approval_pending',
        request_json: JSON.stringify(input.request),
        requested_by_conn_id: input.requestedByConnId ?? null,
        requested_by_device_id: input.requestedByDeviceId ?? null,
        requested_by_client_id: input.requestedByClientId ?? null,
        expires_at_ms: input.expiresAtMs,
        resolved_at_ms: null,
        decision: null,
        resolved_by: null,
        effect_receipt_id: null,
        domain_journal_ref: null,
        created_at: now,
        updated_at: now,
      };
      executeSqliteQuerySync(db, query.insertInto('approval_ledger').values(row));
      const inserted = executeSqliteQueryTakeFirstSync(
        db,
        query.selectFrom('approval_ledger').selectAll().where('idempotency_key', '=', input.idempotencyKey),
      );
      result = inserted ? { ok: true, row: inserted } : { ok: false, reason: 'not-found' };
    }, this.#database);
    return result ?? { ok: false, reason: 'not-found' };
  }

  /**
   * Resolve approval_pending -> approved|denied. Idempotent: a repeated identical
   * resolve returns the existing row with ok=true; a resolve of an already-resolved
   * approval with a different decision returns state-conflict.
   */
  resolve(input: ResolveApprovalInput): TransitionResult {
    let result: TransitionResult | undefined;
    runOpenClawStateWriteTransaction(({ db }) => {
      const query = getNodeSqliteKysely<ApprovalLedgerDatabase>(db);
      const existing = executeSqliteQueryTakeFirstSync(
        db,
        query.selectFrom('approval_ledger').selectAll().where('approval_id', '=', input.approvalId),
      );
      if (!existing) {
        result = { ok: false, reason: 'not-found' };
        return;
      }
      if (existing.state !== 'approval_pending') {
        if (existing.state === 'approved' && input.decision === 'approved') {
          result = { ok: true, row: existing };
          return;
        }
        if (existing.state === 'denied' && input.decision === 'denied') {
          result = { ok: true, row: existing };
          return;
        }
        result = { ok: false, reason: 'state-conflict', row: existing };
        return;
      }
      const now = input.resolvedAtMs ?? Date.now();
      executeSqliteQuerySync(
        db,
        query
          .updateTable('approval_ledger')
          .set({
            state: input.decision,
            decision: input.decision,
            resolved_at_ms: now,
            resolved_by: input.resolvedBy ?? null,
            updated_at: now,
          })
          .where('approval_id', '=', input.approvalId),
      );
      const updated = executeSqliteQueryTakeFirstSync(
        db,
        query.selectFrom('approval_ledger').selectAll().where('approval_id', '=', input.approvalId),
      );
      result = updated ? { ok: true, row: updated } : { ok: false, reason: 'not-found' };
    }, this.#database);
    return result ?? { ok: false, reason: 'not-found' };
  }

  /** Mark execution_started after an approved approval. */
  markExecutionStarted(approvalId: string): TransitionResult {
    return this.#transition(approvalId, ['approved'], 'execution_started');
  }

  /** Record the effect outcome: applied|not_applied -> reconciled, or unknown -> needs_reconciliation. */
  recordEffectOutcome(input: EffectOutcomeInput): TransitionResult {
    let result: TransitionResult | undefined;
    runOpenClawStateWriteTransaction(({ db }) => {
      const query = getNodeSqliteKysely<ApprovalLedgerDatabase>(db);
      const existing = executeSqliteQueryTakeFirstSync(
        db,
        query.selectFrom('approval_ledger').selectAll().where('approval_id', '=', input.approvalId),
      );
      if (!existing) {
        result = { ok: false, reason: 'not-found' };
        return;
      }
      const nextState: ApprovalState = input.outcome === 'unknown' ? 'needs_reconciliation' : 'reconciled';
      if (existing.state === 'applied' || existing.state === 'not_applied') {
        // Idempotent: same outcome already recorded.
        if (existing.state === input.outcome) {
          result = { ok: true, row: existing };
          return;
        }
        result = { ok: false, reason: 'state-conflict', row: existing };
        return;
      }
      const now = Date.now();
      executeSqliteQuerySync(
        db,
        query
          .updateTable('approval_ledger')
          .set({
            state: nextState,
            effect_receipt_id: input.effectReceiptId ?? null,
            domain_journal_ref: input.domainJournalRef ?? null,
            updated_at: now,
          })
          .where('approval_id', '=', input.approvalId),
      );
      const updated = executeSqliteQueryTakeFirstSync(
        db,
        query.selectFrom('approval_ledger').selectAll().where('approval_id', '=', input.approvalId),
      );
      result = updated ? { ok: true, row: updated } : { ok: false, reason: 'not-found' };
    }, this.#database);
    return result ?? { ok: false, reason: 'not-found' };
  }

  /** Reconcile a needs_reconciliation record to reconciled (manual/domain-journal driven). */
  reconcile(approvalId: string, domainJournalRef?: string): TransitionResult {
    return this.#transition(approvalId, ['needs_reconciliation'], 'reconciled', {
      domain_journal_ref: domainJournalRef ?? null,
    });
  }

  getById(approvalId: string): ApprovalLedgerRow | undefined {
    const { db } = openOpenClawStateDatabase(this.#database);
    const query = getNodeSqliteKysely<ApprovalLedgerDatabase>(db);
    return executeSqliteQueryTakeFirstSync(
      db,
      query.selectFrom('approval_ledger').selectAll().where('approval_id', '=', approvalId),
    );
  }

  /** Look up an approval by its idempotency key. */
  getByIdempotencyKey(idempotencyKey: string): ApprovalLedgerRow | undefined {
    const { db } = openOpenClawStateDatabase(this.#database);
    const query = getNodeSqliteKysely<ApprovalLedgerDatabase>(db);
    return executeSqliteQueryTakeFirstSync(
      db,
      query.selectFrom('approval_ledger').selectAll().where('idempotency_key', '=', idempotencyKey),
    );
  }

  listByState(state: ApprovalState): ApprovalLedgerRow[] {
    const { db } = openOpenClawStateDatabase(this.#database);
    const query = getNodeSqliteKysely<ApprovalLedgerDatabase>(db);
    return executeSqliteQuerySync<ApprovalLedgerRow>(
      db,
      query.selectFrom('approval_ledger').selectAll().where('state', '=', state).orderBy('created_at', 'desc'),
    ).rows;
  }

  clearForTest(): void {
    runOpenClawStateWriteTransaction(({ db }) => {
      const query = getNodeSqliteKysely<ApprovalLedgerDatabase>(db);
      executeSqliteQuerySync(db, query.deleteFrom('approval_ledger'));
    }, this.#database);
  }

  #transition(
    approvalId: string,
    fromStates: ApprovalState[],
    toState: ApprovalState,
    extra: Partial<ApprovalLedgerInsert> = {},
  ): TransitionResult {
    let result: TransitionResult | undefined;
    runOpenClawStateWriteTransaction(({ db }) => {
      const query = getNodeSqliteKysely<ApprovalLedgerDatabase>(db);
      const existing = executeSqliteQueryTakeFirstSync(
        db,
        query.selectFrom('approval_ledger').selectAll().where('approval_id', '=', approvalId),
      );
      if (!existing) {
        result = { ok: false, reason: 'not-found' };
        return;
      }
      if (!fromStates.includes(existing.state as ApprovalState)) {
        if (existing.state === toState) {
          result = { ok: true, row: existing };
          return;
        }
        result = { ok: false, reason: 'state-conflict', row: existing };
        return;
      }
      const now = Date.now();
      executeSqliteQuerySync(
        db,
        query
          .updateTable('approval_ledger')
          .set({ ...extra, state: toState, updated_at: now })
          .where('approval_id', '=', approvalId),
      );
      const updated = executeSqliteQueryTakeFirstSync(
        db,
        query.selectFrom('approval_ledger').selectAll().where('approval_id', '=', approvalId),
      );
      result = updated ? { ok: true, row: updated } : { ok: false, reason: 'not-found' };
    }, this.#database);
    return result ?? { ok: false, reason: 'not-found' };
  }
}
