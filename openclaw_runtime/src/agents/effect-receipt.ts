// RC-04 EffectReceipt: explains and correlates domain-journal outcomes; it never
// authorizes replay. Domain journals remain the effect/idempotency truth. A new
// effect_receipts table in the existing openclaw-state SQLite holds the bounded
// correlation record.
//
// Privacy: only the canonical SHA-256 digest of the proposal is stored; raw
// proposal payloads never persist. Legacy proposal_json columns are migrated to
// proposal_digest on reopen (digest-only, raw is dropped).
//
// Idempotency: the same idempotency key with identical content (proposal digest,
// approval id/decision, executor, outcome, journal refs, recoverability, schema
// version) is an identical-content duplicate; any difference is a content
// conflict. The store is append-only.
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
import { canonicalJsonValue } from './approval-ledger.js';
import type { DB as OpenClawStateKyselyDatabase } from '../state/openclaw-state-db.generated.js';

export const EFFECT_RECEIPT_SCHEMA_VERSION = '2';
export const EFFECT_RECEIPT_OWNER = 'openclaw_runtime.agents.effect-receipt';

export type EffectReceiptInsert = Insertable<OpenClawStateKyselyDatabase['effect_receipts']>;
export type EffectReceiptRow = Selectable<OpenClawStateKyselyDatabase['effect_receipts']>;
export type EffectReceiptDatabase = Pick<OpenClawStateKyselyDatabase, 'effect_receipts'>;

export type EffectReceiptOptions = OpenClawStateDatabaseOptions;

export type Stage1EffectReceiptContext = {
  /** Digest of the approval policy that produced the decision. Digest only. */
  approvalPolicyDigest?: string;
  actor?: {
    sessionKey: string;
    runId: string;
    attemptIndex: number;
    modelCallIndex: number;
    actorKind: 'principal' | 'delegate';
  };
  effect?: {
    toolCallId: string;
    toolName: string;
    resource: string;
    action: string;
  };
};

export type EffectReceiptInput = {
  idempotencyKey: string;
  approvalId?: string;
  proposal: Record<string, unknown>;
  approvalDecision?: 'approved' | 'denied';
  domainExecutor: string;
  outcome: 'applied' | 'not_applied' | 'unknown' | 'reconciled';
  artifactRef?: string;
  journalRef?: string;
  recoverability: string;
  /** Stage 1 logical EffectReceipt/v1 identifier facts. Never raw content. */
  stage1Context?: Stage1EffectReceiptContext;
  createdAt?: number;
};

export type EffectReceiptResult =
  | { ok: true; duplicate: false; effectReceiptId: string }
  | { ok: true; duplicate: true; effectReceiptId: string; reason: 'identical-content' }
  | { ok: false; duplicate: true; effectReceiptId: string; reason: 'content-conflict' };

function sha256Text(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Canonical digest of a proposal payload (never stored raw). */
export function effectProposalDigest(proposal: Record<string, unknown>): string {
  return sha256Text(canonicalJsonValue({ proposal }));
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

const EFFECT_RECEIPTS_CREATE_SQL = `
CREATE TABLE effect_receipts_rc04_new (
  effect_receipt_id TEXT NOT NULL PRIMARY KEY,
  idempotency_key TEXT NOT NULL,
  approval_id TEXT,
  proposal_digest TEXT NOT NULL,
  approval_decision TEXT,
  domain_executor TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('applied','not_applied','unknown','reconciled')),
  artifact_ref TEXT,
  journal_ref TEXT,
  recoverability TEXT NOT NULL,
  effect_context_json TEXT NOT NULL DEFAULT '{}',
  schema_version TEXT NOT NULL DEFAULT '2',
  created_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_effect_receipts_idempotency
  ON effect_receipts_rc04_new(idempotency_key);

CREATE INDEX IF NOT EXISTS idx_effect_receipts_approval
  ON effect_receipts_rc04_new(approval_id, created_at DESC);
`;

/**
 * Ensure the query indexes exist on the live effect_receipts table. The
 * migration path rebuilds the table (DROP + RENAME), which drops any indexes
 * created on the old table, so indexes must be recreated afterwards. Runs
 * unconditionally because CREATE INDEX IF NOT EXISTS is idempotent.
 */
function ensureEffectReceiptsIndexes(db: import('node:sqlite').DatabaseSync): void {
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_effect_receipts_idempotency ON effect_receipts(idempotency_key);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_effect_receipts_approval ON effect_receipts(approval_id, created_at DESC);`);
}

/**
 * Migrate a legacy effect_receipts table (still carrying raw proposal_json) to
 * the digest-only shape. Raw proposals are replaced by their canonical SHA-256
 * digest and the raw column is dropped. Runs once per database handle.
 */
function migrateEffectReceiptsShape(db: import('node:sqlite').DatabaseSync): void {
  if (tableHasColumn(db, 'effect_receipts', 'proposal_json')) {
    if (tableHasColumn(db, 'effect_receipts', 'effect_context_json') === false) {
      db.exec(`ALTER TABLE effect_receipts ADD COLUMN effect_context_json TEXT NOT NULL DEFAULT '{}';`);
    }
    const legacyRows = db
      .prepare(
        `SELECT effect_receipt_id, idempotency_key, approval_id, proposal_json,
                approval_decision, domain_executor, outcome, artifact_ref,
                journal_ref, recoverability, effect_context_json, created_at
           FROM effect_receipts`,
      )
      .all() as Array<Record<string, unknown>>;
    db.exec(`DROP TABLE IF EXISTS effect_receipts_rc04_new;`);
    db.exec(EFFECT_RECEIPTS_CREATE_SQL);
    const insert = db.prepare(
      `INSERT INTO effect_receipts_rc04_new (
         effect_receipt_id, idempotency_key, approval_id, proposal_digest,
         approval_decision, domain_executor, outcome, artifact_ref,
         journal_ref, recoverability, effect_context_json, schema_version, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const row of legacyRows) {
      const rawJson = typeof row.proposal_json === 'string' ? row.proposal_json : '{}';
      let digest: string;
      try {
        digest = sha256Text(canonicalJsonValue({ proposal: JSON.parse(rawJson) as unknown }));
      } catch {
        digest = sha256Text(rawJson);
      }
      insert.run(
        asSqlValue(row.effect_receipt_id),
        asSqlValue(row.idempotency_key),
        asSqlValue(row.approval_id),
        digest,
        asSqlValue(row.approval_decision),
        asSqlValue(row.domain_executor),
        asSqlValue(row.outcome),
        asSqlValue(row.artifact_ref),
        asSqlValue(row.journal_ref),
        asSqlValue(row.recoverability),
        asSqlValue(typeof row.effect_context_json === 'string' ? row.effect_context_json : '{}'),
        EFFECT_RECEIPT_SCHEMA_VERSION,
        asSqlValue(row.created_at),
      );
    }
    db.exec(`DROP TABLE effect_receipts;`);
    db.exec(`ALTER TABLE effect_receipts_rc04_new RENAME TO effect_receipts;`);
    // The rebuilt table dropped the old indexes; recreate them on the live name.
    ensureEffectReceiptsIndexes(db);
  }
  if (tableHasColumn(db, 'effect_receipts', 'schema_version') === false) {
    db.exec(`ALTER TABLE effect_receipts ADD COLUMN schema_version TEXT NOT NULL DEFAULT '2';`);
  }
  if (tableHasColumn(db, 'effect_receipts', 'effect_context_json') === false) {
    db.exec(`ALTER TABLE effect_receipts ADD COLUMN effect_context_json TEXT NOT NULL DEFAULT '{}';`);
  }
  ensureEffectReceiptsIndexes(db);
}

const migratedHandles = new WeakSet<object>();

function ensureEffectReceiptsShape(options: EffectReceiptOptions): void {
  const database = openOpenClawStateDatabase(options);
  if (migratedHandles.has(database.db)) {
    return;
  }
  if (tableHasColumn(database.db, 'effect_receipts', 'effect_receipt_id')) {
    runOpenClawStateWriteTransaction(({ db }) => migrateEffectReceiptsShape(db), options);
  }
  migratedHandles.add(database.db);
}

function sameOptionalString(left: string | null, right: string | undefined | null): boolean {
  return (left ?? null) === (right ?? null);
}

const STAGE1_ACTOR_KINDS = new Set(["principal", "delegate"]);

function sanitizeStage1Actor(value: unknown): Stage1EffectReceiptContext["actor"] | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const actor = value as Record<string, unknown>;
  if (
    typeof actor.sessionKey !== "string" ||
    typeof actor.runId !== "string" ||
    typeof actor.attemptIndex !== "number" ||
    typeof actor.modelCallIndex !== "number" ||
    typeof actor.actorKind !== "string" ||
    !STAGE1_ACTOR_KINDS.has(actor.actorKind)
  ) {
    return undefined;
  }
  return {
    sessionKey: actor.sessionKey,
    runId: actor.runId,
    attemptIndex: actor.attemptIndex,
    modelCallIndex: actor.modelCallIndex,
    actorKind: actor.actorKind as "principal" | "delegate",
  };
}

function sanitizeStage1Effect(value: unknown): Stage1EffectReceiptContext["effect"] | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const effect = value as Record<string, unknown>;
  if (
    typeof effect.toolCallId !== "string" ||
    typeof effect.toolName !== "string" ||
    typeof effect.resource !== "string" ||
    typeof effect.action !== "string"
  ) {
    return undefined;
  }
  return {
    toolCallId: effect.toolCallId,
    toolName: effect.toolName,
    resource: effect.resource,
    action: effect.action,
  };
}

/**
 * Stage 1 context is a runtime allowlist, not a JSON passthrough. Unknown
 * fields (raw proposal, tool arguments, tool output, secrets) are stripped
 * before the value reaches effect_context_json.
 */
export function serializeStage1EffectContext(context?: Stage1EffectReceiptContext): string {
  if (!context || typeof context !== "object" || Array.isArray(context)) return "{}";
  const sanitized: Record<string, unknown> = {};
  if (typeof context.approvalPolicyDigest === "string" && context.approvalPolicyDigest) {
    sanitized.approvalPolicyDigest = context.approvalPolicyDigest;
  }
  const actor = sanitizeStage1Actor(context.actor);
  const effect = sanitizeStage1Effect(context.effect);
  if (actor) sanitized.actor = actor;
  if (effect) sanitized.effect = effect;
  return JSON.stringify(actor || effect ? sanitized : {});
}

export function parseStage1EffectContext(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function receiptContentMatches(existing: EffectReceiptRow, input: EffectReceiptInput): boolean {
  return (
    existing.proposal_digest === effectProposalDigest(input.proposal) &&
    sameOptionalString(existing.approval_id, input.approvalId) &&
    sameOptionalString(existing.approval_decision, input.approvalDecision) &&
    existing.domain_executor === input.domainExecutor &&
    existing.outcome === input.outcome &&
    sameOptionalString(existing.artifact_ref, input.artifactRef) &&
    sameOptionalString(existing.journal_ref, input.journalRef) &&
    existing.recoverability === input.recoverability &&
    existing.effect_context_json === serializeStage1EffectContext(input.stage1Context) &&
    existing.schema_version === EFFECT_RECEIPT_SCHEMA_VERSION
  );
}

/**
 * EffectReceipt store. Append-only, idempotent under the same idempotency key with
 * identical content; any content difference under the same key conflicts. It
 * explains and correlates the domain journal; it never authorizes replay.
 */
export class EffectReceiptStore {
  #database: EffectReceiptOptions = {};

  constructor(options: EffectReceiptOptions = {}) {
    this.#database = options;
    ensureEffectReceiptsShape(options);
  }

  record(input: EffectReceiptInput): EffectReceiptResult {
    let result: EffectReceiptResult | undefined;
    runOpenClawStateWriteTransaction(({ db }) => {
      const query = getNodeSqliteKysely<EffectReceiptDatabase>(db);
      const existing = executeSqliteQueryTakeFirstSync(
        db,
        query.selectFrom('effect_receipts').selectAll().where('idempotency_key', '=', input.idempotencyKey),
      );
      if (existing) {
        result = receiptContentMatches(existing, input)
          ? { ok: true, duplicate: true, effectReceiptId: existing.effect_receipt_id, reason: 'identical-content' }
          : { ok: false, duplicate: true, effectReceiptId: existing.effect_receipt_id, reason: 'content-conflict' };
        return;
      }
      const effectReceiptId = `efx_${randomUUID()}`;
      const row: EffectReceiptInsert = {
        effect_receipt_id: effectReceiptId,
        idempotency_key: input.idempotencyKey,
        approval_id: input.approvalId ?? null,
        proposal_digest: effectProposalDigest(input.proposal),
        approval_decision: input.approvalDecision ?? null,
        domain_executor: input.domainExecutor,
        outcome: input.outcome,
        artifact_ref: input.artifactRef ?? null,
        journal_ref: input.journalRef ?? null,
        recoverability: input.recoverability,
        effect_context_json: serializeStage1EffectContext(input.stage1Context),
        schema_version: EFFECT_RECEIPT_SCHEMA_VERSION,
        created_at: input.createdAt ?? Date.now(),
      };
      executeSqliteQuerySync(db, query.insertInto('effect_receipts').values(row));
      result = { ok: true, duplicate: false, effectReceiptId };
    }, this.#database);
    if (!result) {
      return { ok: false, duplicate: true, effectReceiptId: '', reason: 'content-conflict' };
    }
    return result;
  }

  getById(effectReceiptId: string): EffectReceiptRow | undefined {
    const { db } = openOpenClawStateDatabase(this.#database);
    const query = getNodeSqliteKysely<EffectReceiptDatabase>(db);
    return executeSqliteQueryTakeFirstSync(
      db,
      query.selectFrom('effect_receipts').selectAll().where('effect_receipt_id', '=', effectReceiptId),
    );
  }

  listByApproval(approvalId: string): EffectReceiptRow[] {
    const { db } = openOpenClawStateDatabase(this.#database);
    const query = getNodeSqliteKysely<EffectReceiptDatabase>(db);
    return executeSqliteQuerySync<EffectReceiptRow>(
      db,
      query.selectFrom('effect_receipts').selectAll().where('approval_id', '=', approvalId).orderBy('created_at', 'desc'),
    ).rows;
  }

  clearForTest(): void {
    runOpenClawStateWriteTransaction(({ db }) => {
      const query = getNodeSqliteKysely<EffectReceiptDatabase>(db);
      executeSqliteQuerySync(db, query.deleteFrom('effect_receipts'));
    }, this.#database);
  }
}
