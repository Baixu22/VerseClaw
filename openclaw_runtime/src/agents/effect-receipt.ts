// RC-04 EffectReceipt: explains and correlates domain-journal outcomes; it never
// authorizes replay. Domain journals remain the effect/idempotency truth. A new
// effect_receipts table in the existing openclaw-state SQLite holds the bounded
// correlation record.
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

export const EFFECT_RECEIPT_SCHEMA_VERSION = '1';
export const EFFECT_RECEIPT_OWNER = 'openclaw_runtime.agents.effect-receipt';

export type EffectReceiptInsert = Insertable<OpenClawStateKyselyDatabase['effect_receipts']>;
export type EffectReceiptRow = Selectable<OpenClawStateKyselyDatabase['effect_receipts']>;
export type EffectReceiptDatabase = Pick<OpenClawStateKyselyDatabase, 'effect_receipts'>;

export type EffectReceiptOptions = OpenClawStateDatabaseOptions;

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
  createdAt?: number;
};

export type EffectReceiptResult =
  | { ok: true; duplicate: false; effectReceiptId: string }
  | { ok: true; duplicate: true; effectReceiptId: string; reason: 'identical-content' }
  | { ok: false; duplicate: true; effectReceiptId: string; reason: 'content-conflict' };

/**
 * EffectReceipt store. Append-only, idempotent under the same idempotency key with
 * identical content; a different content under the same key conflicts. It explains
 * and correlates the domain journal; it never authorizes replay.
 */
export class EffectReceiptStore {
  #database: EffectReceiptOptions = {};

  constructor(options: EffectReceiptOptions = {}) {
    this.#database = options;
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
        const same = existing.domain_executor === input.domainExecutor && existing.outcome === input.outcome;
        result = same
          ? { ok: true, duplicate: true, effectReceiptId: existing.effect_receipt_id, reason: 'identical-content' }
          : { ok: false, duplicate: true, effectReceiptId: existing.effect_receipt_id, reason: 'content-conflict' };
        return;
      }
      const effectReceiptId = `efx_${randomUUID()}`;
      const row: EffectReceiptInsert = {
        effect_receipt_id: effectReceiptId,
        idempotency_key: input.idempotencyKey,
        approval_id: input.approvalId ?? null,
        proposal_json: JSON.stringify(input.proposal),
        approval_decision: input.approvalDecision ?? null,
        domain_executor: input.domainExecutor,
        outcome: input.outcome,
        artifact_ref: input.artifactRef ?? null,
        journal_ref: input.journalRef ?? null,
        recoverability: input.recoverability,
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
