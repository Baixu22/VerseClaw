// RC-04 durable approval owner. Replaces the Gateway process Map pending/resolved
// truth with a durable approval_ledger in the existing openclaw-state SQLite. The
// state sequence is intent_reserved -> approval_pending -> approved|denied ->
// execution_started -> applied|not_applied|unknown -> reconciled. Repeated
// identical resolve is idempotent; denial produces no effect; an unknown outcome
// stops in needs_reconciliation and is never auto-replayed.
//
// Privacy: only the canonical SHA-256 digest of the request is stored; raw
// request payloads (which may carry command text or secrets) never persist.
// Legacy databases that still carry request_json are migrated on reopen: the
// raw column is replaced by request_digest (digest-only, raw is dropped).
//
// Concurrency: every transition runs in one SQLite immediate transaction and the
// UPDATE is guarded by WHERE approval_id = ? AND revision = ? so a stale or
// concurrent writer is rejected atomically (affected rows = 0).
import { createHash, randomUUID } from 'node:crypto';

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

export const APPROVAL_LEDGER_SCHEMA_VERSION = '2';
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
  | {
      ok: false;
      reason: 'not-found' | 'state-conflict' | 'already-resolved' | 'revision-conflict' | 'idempotency-conflict';
      row?: ApprovalLedgerRow;
    };

function sha256Text(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Canonical stable-key JSON so equal objects always produce the same digest. */
export function canonicalJsonValue(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJsonValue(entry)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJsonValue(record[key])}`).join(',')}}`;
}

/** Canonical digest of an approval request payload (never stored raw). */
export function approvalRequestDigest(request: ApprovalRequestPayload): string {
  return sha256Text(canonicalJsonValue({ request }));
}

function tableExists(db: import('node:sqlite').DatabaseSync, tableName: string): boolean {
  const row = db
    .prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName) as { ok?: unknown } | undefined;
  return row?.ok === 1;
}

function tableHasColumn(db: import('node:sqlite').DatabaseSync, tableName: string, columnName: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name?: unknown }>;
  return rows.some((row) => row.name === columnName);
}

/** Coerce a legacy row cell into a node:sqlite bindable value. */
function asSqlValue(value: unknown): import('node:sqlite').SQLInputValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'bigint' ||
    value instanceof Uint8Array
  ) {
    return value as import('node:sqlite').SQLInputValue;
  }
  return String(value);
}

const APPROVAL_LEDGER_CREATE_SQL = `
CREATE TABLE approval_ledger_rc04_new (
  approval_id TEXT NOT NULL PRIMARY KEY,
  idempotency_key TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN (
    'intent_reserved','approval_pending','approved','denied',
    'execution_started','applied','not_applied','unknown','reconciled',
    'needs_reconciliation'
  )),
  request_digest TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  requested_by_conn_id TEXT,
  requested_by_device_id TEXT,
  requested_by_client_id TEXT,
  expires_at_ms INTEGER NOT NULL,
  resolved_at_ms INTEGER,
  decision TEXT,
  resolved_by TEXT,
  effect_receipt_id TEXT,
  domain_journal_ref TEXT,
  outcome TEXT CHECK (outcome IN ('applied','not_applied','unknown')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_approval_ledger_idempotency
  ON approval_ledger_rc04_new(idempotency_key);

CREATE INDEX IF NOT EXISTS idx_approval_ledger_state_created
  ON approval_ledger_rc04_new(state, created_at DESC);
`;

/**
 * Ensure the query indexes exist on the live approval_ledger table. The
 * migration path rebuilds the table (DROP + RENAME), which drops any indexes
 * created on the old table, so indexes must be recreated afterwards. Runs
 * unconditionally because CREATE INDEX IF NOT EXISTS is idempotent.
 */
function ensureApprovalLedgerIndexes(db: import('node:sqlite').DatabaseSync): void {
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_approval_ledger_idempotency ON approval_ledger(idempotency_key);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_approval_ledger_state_created ON approval_ledger(state, created_at DESC);`);
}

/**
 * Migrate a legacy approval_ledger (still carrying raw request_json) to the
 * digest-only shape. Raw payloads are replaced by their canonical SHA-256
 * digest and the raw column is dropped; secrets never survive the migration.
 * Runs once per database handle inside the shared immediate transaction.
 */
function migrateApprovalLedgerShape(db: import('node:sqlite').DatabaseSync): void {
  if (tableHasColumn(db, 'approval_ledger', 'request_json')) {
    const legacyRows = db
      .prepare(
        `SELECT approval_id, idempotency_key, state, request_json,
                requested_by_conn_id, requested_by_device_id, requested_by_client_id,
                expires_at_ms, resolved_at_ms, decision, resolved_by,
                effect_receipt_id, domain_journal_ref, created_at, updated_at
           FROM approval_ledger`,
      )
      .all() as Array<Record<string, unknown>>;
    db.exec(`DROP TABLE IF EXISTS approval_ledger_rc04_new;`);
    db.exec(APPROVAL_LEDGER_CREATE_SQL);
    const insert = db.prepare(
      `INSERT INTO approval_ledger_rc04_new (
         approval_id, idempotency_key, state, request_digest,
         requested_by_conn_id, requested_by_device_id, requested_by_client_id,
         expires_at_ms, resolved_at_ms, decision, resolved_by,
         effect_receipt_id, domain_journal_ref, outcome, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const row of legacyRows) {
      const rawJson = typeof row.request_json === 'string' ? row.request_json : '{}';
      let digest: string;
      try {
        digest = sha256Text(canonicalJsonValue({ request: JSON.parse(rawJson) as unknown }));
      } catch {
        digest = sha256Text(rawJson);
      }
      insert.run(
        asSqlValue(row.approval_id),
        asSqlValue(row.idempotency_key),
        asSqlValue(row.state),
        digest,
        asSqlValue(row.requested_by_conn_id),
        asSqlValue(row.requested_by_device_id),
        asSqlValue(row.requested_by_client_id),
        asSqlValue(row.expires_at_ms),
        asSqlValue(row.resolved_at_ms),
        asSqlValue(row.decision),
        asSqlValue(row.resolved_by),
        asSqlValue(row.effect_receipt_id),
        asSqlValue(row.domain_journal_ref),
        asSqlValue(row.outcome ?? null),
        asSqlValue(row.created_at),
        asSqlValue(row.updated_at),
      );
    }
    db.exec(`DROP TABLE approval_ledger;`);
    db.exec(`ALTER TABLE approval_ledger_rc04_new RENAME TO approval_ledger;`);
    // The rebuilt table dropped the old indexes; recreate them on the live name.
    ensureApprovalLedgerIndexes(db);
  }
  if (tableHasColumn(db, 'approval_ledger', 'revision') === false) {
    db.exec(`ALTER TABLE approval_ledger ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;`);
  }
  if (tableHasColumn(db, 'approval_ledger', 'outcome') === false) {
    db.exec(`ALTER TABLE approval_ledger ADD COLUMN outcome TEXT CHECK (outcome IN ('applied','not_applied','unknown'));`);
  }
  ensureApprovalLedgerIndexes(db);
}

const migratedHandles = new WeakSet<object>();

function ensureApprovalLedgerShape(options: ApprovalLedgerOptions): void {
  const database = openOpenClawStateDatabase(options);
  if (migratedHandles.has(database.db)) {
    return;
  }
  if (tableExists(database.db, 'approval_ledger')) {
    runOpenClawStateWriteTransaction(({ db }) => migrateApprovalLedgerShape(db), options);
  }
  migratedHandles.add(database.db);
}

/**
 * Durable approval ledger. Every transition is an idempotent, state-guarded,
 * revision-CAS write through the shared openclaw-state immediate transaction.
 * Restart survives because rows persist in SQLite.
 */
export class ApprovalLedger {
  #database: ApprovalLedgerOptions = {};

  constructor(options: ApprovalLedgerOptions = {}) {
    this.#database = options;
    ensureApprovalLedgerShape(options);
  }

  /**
   * Reserve an intent -> approval_pending. Idempotent under the same idempotency
   * key **only when the request content matches**: a conflicting request under an
   * already-used key is rejected (idempotency-conflict) instead of silently
   * reusing the prior approval.
   */
  reserve(input: ReserveApprovalInput): TransitionResult {
    let result: TransitionResult | undefined;
    runOpenClawStateWriteTransaction(({ db }) => {
      const query = getNodeSqliteKysely<ApprovalLedgerDatabase>(db);
      const existing = executeSqliteQueryTakeFirstSync(
        db,
        query.selectFrom('approval_ledger').selectAll().where('idempotency_key', '=', input.idempotencyKey),
      );
      if (existing) {
        if (existing.request_digest === approvalRequestDigest(input.request)) {
          result = { ok: true, row: existing };
        } else {
          result = { ok: false, reason: 'idempotency-conflict', row: existing };
        }
        return;
      }
      const now = input.createdAt ?? Date.now();
      const row: ApprovalLedgerInsert = {
        approval_id: input.approvalId ?? `aprv_${randomUUID()}`,
        idempotency_key: input.idempotencyKey,
        state: 'approval_pending',
        request_digest: approvalRequestDigest(input.request),
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
   * approval with a different decision returns state-conflict. Denied approvals can
   * never move to execution_started (markExecutionStarted only accepts approved).
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
        if (existing.state === input.decision) {
          result = { ok: true, row: existing };
          return;
        }
        result = { ok: false, reason: 'state-conflict', row: existing };
        return;
      }
      const now = input.resolvedAtMs ?? Date.now();
      const updated = executeSqliteQueryTakeFirstSync(
        db,
        query
          .updateTable('approval_ledger')
          .set({
            state: input.decision,
            decision: input.decision,
            resolved_at_ms: now,
            resolved_by: input.resolvedBy ?? null,
            revision: existing.revision + 1,
            updated_at: now,
          })
          .where('approval_id', '=', input.approvalId)
          .where('state', '=', 'approval_pending')
          .where('revision', '=', existing.revision)
          .returningAll(),
      );
      result = updated ? { ok: true, row: updated } : { ok: false, reason: 'revision-conflict', row: existing };
    }, this.#database);
    return result ?? { ok: false, reason: 'not-found' };
  }

  /** Mark execution_started after an approved approval. Denied can never start.
   *  Non-idempotent on purpose: a second mark on an already-started approval is
   *  rejected so concurrent callers cannot both enter the executor (the ledger
   *  grants exactly one execution_started). */
  markExecutionStarted(approvalId: string): TransitionResult {
    return this.#transition(approvalId, ['approved'], 'execution_started', {}, { idempotent: false });
  }

  /**
   * Record the effect outcome strictly after execution_started, walking the
   * full state sequence inside one transaction:
   *   execution_started -> applied -> reconciled
   *   execution_started -> not_applied -> reconciled
   *   execution_started -> unknown -> needs_reconciliation
   * The intermediate applied|not_applied|unknown state is persisted in the
   * `outcome` column so the sequence remains auditable after reconciliation.
   * Records from approval_pending/approved/denied fail (state-conflict).
   * Replaying the same outcome on an already-reconciled row is idempotent;
   * a different outcome on a reconciled row conflicts.
   */
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
      if (existing.outcome === input.outcome) {
        // Idempotent replay of the same outcome, whatever the current state.
        result = { ok: true, row: existing };
        return;
      }
      if (existing.state !== 'execution_started') {
        result = { ok: false, reason: 'state-conflict', row: existing };
        return;
      }
      const nextState: ApprovalState = input.outcome === 'unknown' ? 'needs_reconciliation' : 'reconciled';
      const now = Date.now();
      // Step 1: execution_started -> applied|not_applied|unknown (records the
      // intermediate outcome state and the outcome column).
      const intermediate = executeSqliteQueryTakeFirstSync(
        db,
        query
          .updateTable('approval_ledger')
          .set({
            state: input.outcome,
            outcome: input.outcome,
            effect_receipt_id: input.effectReceiptId ?? null,
            domain_journal_ref: input.domainJournalRef ?? null,
            revision: existing.revision + 1,
            updated_at: now,
          })
          .where('approval_id', '=', input.approvalId)
          .where('state', '=', 'execution_started')
          .where('revision', '=', existing.revision)
          .returningAll(),
      );
      if (!intermediate) {
        result = { ok: false, reason: 'revision-conflict', row: existing };
        return;
      }
      // Step 2: applied|not_applied|unknown -> reconciled|needs_reconciliation.
      const updated = executeSqliteQueryTakeFirstSync(
        db,
        query
          .updateTable('approval_ledger')
          .set({
            state: nextState,
            revision: intermediate.revision + 1,
            updated_at: now,
          })
          .where('approval_id', '=', input.approvalId)
          .where('state', '=', input.outcome)
          .where('revision', '=', intermediate.revision)
          .returningAll(),
      );
      result = updated ? { ok: true, row: updated } : { ok: false, reason: 'revision-conflict', row: intermediate };
    }, this.#database);
    return result ?? { ok: false, reason: 'not-found' };
  }

  /** Reconcile a needs_reconciliation record to reconciled (manual/domain-journal driven). */
  reconcile(approvalId: string, domainJournalRef?: string): TransitionResult {
    return this.#transition(approvalId, ['needs_reconciliation'], 'reconciled', {
      domain_journal_ref: domainJournalRef ?? null,
    });
  }

  /** Read an approval row (the durable truth). */
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
    options: { idempotent?: boolean } = {},
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
      if (existing.state === toState) {
        if (options.idempotent !== false) {
          result = { ok: true, row: existing };
        } else {
          // Strict transitions (e.g. execution_started) reject a repeated mark
          // so exactly one caller wins the transition.
          result = { ok: false, reason: 'state-conflict', row: existing };
        }
        return;
      }
      if (!fromStates.includes(existing.state as ApprovalState)) {
        result = { ok: false, reason: 'state-conflict', row: existing };
        return;
      }
      const now = Date.now();
      const updated = executeSqliteQueryTakeFirstSync(
        db,
        query
          .updateTable('approval_ledger')
          .set({ ...extra, state: toState, revision: existing.revision + 1, updated_at: now })
          .where('approval_id', '=', approvalId)
          .where('state', 'in', fromStates)
          .where('revision', '=', existing.revision)
          .returningAll(),
      );
      result = updated ? { ok: true, row: updated } : { ok: false, reason: 'revision-conflict', row: existing };
    }, this.#database);
    return result ?? { ok: false, reason: 'not-found' };
  }
}
