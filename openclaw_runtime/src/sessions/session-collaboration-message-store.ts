import type { DatabaseSync } from 'node:sqlite';
import type { Generated } from 'kysely';
import { createHash } from 'node:crypto';
import { getNodeSqliteKysely, executeSqliteQuerySync, executeSqliteQueryTakeFirstSync } from '../infra/kysely-sync.js';
import { runSqliteImmediateTransactionSync } from '../infra/sqlite-transaction.js';
import { openOpenClawStateDatabase } from '../state/openclaw-state-db.js';
import { resolveOpenClawStateSqlitePath } from '../state/openclaw-state-db.paths.js';
import { requireNodeSqlite } from '../infra/node-sqlite.js';
import { verifySessionCollaborationMessage, validateSessionCollaborationReceipt, sessionCollaborationMessageDigest } from '../../../shared/session-collaboration-message.js';
import type { SessionCollaborationMessage, SessionCollaborationMessageReceipt } from '../../../shared/types/session-collaboration-message.js';
import type { AutonomySessionScope } from '../../../shared/types/identity-scope.js';

type IntentRow = { seq: number; id: string; payload_digest: string; envelope_json: string; header_json: string;
  source_scope: string; target_scope: string; task_node: string | null; dispatch_key: string;
  state: 'accepted' | 'dispatching' | 'settled'; receipt_json: string | null; reply_json: string | null; updated_at: number };
type MessageDb = { session_message_intents: Omit<IntentRow, 'seq'> & { seq: Generated<number> } };
export type SessionMessageSummary = Omit<SessionCollaborationMessage, 'message'> & { preview: string; truncated: boolean };
export const messageScopeKey = (scope: AutonomySessionScope) => JSON.stringify([scope.workspaceId, scope.projectId, scope.sessionKey, scope.sessionGeneration]);
const deliveryProgress: ReadonlyArray<SessionCollaborationMessageReceipt['phase']> = ['accepted', 'queued', 'delivered', 'replied'];

/** The existing shared state DB owns message intents; run and queue facts remain with their owners. */
export class SessionCollaborationMessageStore {
  constructor(readonly db: DatabaseSync, initialize = false) {
    if (initialize) db.exec(`CREATE TABLE IF NOT EXISTS session_message_intents (
      seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, payload_digest TEXT NOT NULL,
      envelope_json TEXT NOT NULL, header_json TEXT NOT NULL, source_scope TEXT NOT NULL, target_scope TEXT NOT NULL,
      task_node TEXT, dispatch_key TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('accepted','dispatching','settled')),
      receipt_json TEXT, reply_json TEXT, updated_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS session_message_source ON session_message_intents(source_scope,seq);
      CREATE INDEX IF NOT EXISTS session_message_target ON session_message_intents(target_scope,seq);`);
  }
  private query() { return getNodeSqliteKysely<MessageDb>(this.db); }
  get(id: string) { return executeSqliteQueryTakeFirstSync(this.db, this.query().selectFrom('session_message_intents').selectAll().where('id', '=', id)); }
  accept(input: SessionCollaborationMessage): IntentRow {
    const message = verifySessionCollaborationMessage(input);
    return runSqliteImmediateTransactionSync(this.db, () => {
      const existing = this.get(message.id);
      if (existing) { if (existing.payload_digest !== message.payloadDigest) throw new Error('COLLABORATION_MESSAGE_ID_CONFLICT'); return existing; }
      const { message: body, ...metadata } = message;
      let coalesced: SessionCollaborationMessageReceipt | null = null;
      if (['finding', 'status'].includes(message.purpose)) {
        const content = sessionCollaborationMessageDigest({ ...message, id: 'notification-content' });
        const recent = executeSqliteQuerySync(this.db, this.query().selectFrom('session_message_intents').selectAll()
          .where('source_scope', '=', messageScopeKey(message.source)).where('target_scope', '=', messageScopeKey(message.target))
          .where('updated_at', '>=', Date.now() - 10_000).orderBy('seq', 'desc').limit(20)).rows;
        for (const row of recent) {
          const original = verifySessionCollaborationMessage(JSON.parse(row.envelope_json));
          if (sessionCollaborationMessageDigest({ ...original, id: 'notification-content' }) !== content) continue;
          const receipt = this.receipt(row); if (['rejected', 'expired'].includes(receipt.phase)) continue;
          coalesced = { ...receipt, message, coalescedTo: receipt.coalescedTo ?? original.id, updatedAt: Date.now() }; break;
        }
      }
      const preview = Array.from(body).slice(0, 256).join('');
      let receiptMetadata: Omit<SessionCollaborationMessageReceipt, 'message' | 'reply'> | null = null;
      let replyCopy: SessionCollaborationMessageReceipt['reply'];
      if (coalesced) { const { message: _original, reply, ...rest } = coalesced; receiptMetadata = rest; replyCopy = reply; }
      executeSqliteQuerySync(this.db, this.query().insertInto('session_message_intents').values({ id: message.id,
        payload_digest: message.payloadDigest, envelope_json: JSON.stringify(message),
        header_json: JSON.stringify({ ...metadata, preview, truncated: preview.length < body.length }),
        source_scope: messageScopeKey(message.source), target_scope: messageScopeKey(message.target), task_node: message.task?.taskNodeId ?? null,
        dispatch_key: `collaboration:${createHash('sha256').update(message.payloadDigest).digest('hex')}`,
        state: coalesced ? 'settled' : 'accepted', receipt_json: coalesced ? JSON.stringify(receiptMetadata) : null,
        reply_json: replyCopy ? JSON.stringify(replyCopy) : null, updated_at: Date.now() }));
      return this.get(message.id)!;
    });
  }
  claim(id: string, digest: string): boolean {
    return runSqliteImmediateTransactionSync(this.db, () => Boolean(executeSqliteQueryTakeFirstSync(this.db,
      this.query().updateTable('session_message_intents').set({ state: 'dispatching', updated_at: Date.now() })
        .where('id', '=', id).where('payload_digest', '=', digest).where('state', '=', 'accepted').returning('id'))));
  }
  record(id: string, input: SessionCollaborationMessageReceipt) {
    runSqliteImmediateTransactionSync(this.db, () => {
      const row = this.get(id);
      if (!row) throw new Error('COLLABORATION_MESSAGE_MISSING');
      const original = verifySessionCollaborationMessage(JSON.parse(row.envelope_json));
      const receipt = validateSessionCollaborationReceipt(original, input);
      const previous = row.receipt_json ? JSON.parse(row.receipt_json) as SessionCollaborationMessageReceipt : null;
      if (previous?.phase === 'replied' && receipt.phase !== 'replied') return;
      if (previous) {
        const recordedStep = deliveryProgress.indexOf(previous.phase);
        const incomingStep = deliveryProgress.indexOf(receipt.phase);
        if (recordedStep >= 0 && (receipt.phase === 'unknown' || receipt.phase === 'rejected')) return;
        if (incomingStep >= 0 && incomingStep < recordedStep) return;
      }
      const { message: _message, reply, ...metadata } = receipt;
      executeSqliteQuerySync(this.db, this.query().updateTable('session_message_intents').set({ state: 'settled', receipt_json: JSON.stringify(metadata),
        reply_json: reply ? JSON.stringify(reply) : row.reply_json, updated_at: receipt.updatedAt })
        .where('id', '=', id).where('payload_digest', '=', original.payloadDigest));
    });
  }
  receipt(row: IntentRow, seen = new Set<string>()): SessionCollaborationMessageReceipt {
    if (seen.has(row.id) || seen.size >= 4) throw new Error('COLLABORATION_MESSAGE_REFERENCE_CYCLE');
    seen.add(row.id);
    const message = verifySessionCollaborationMessage(JSON.parse(row.envelope_json));
    if (row.receipt_json) {
      const metadata = JSON.parse(row.receipt_json) as SessionCollaborationMessageReceipt;
      if (metadata.coalescedTo && metadata.coalescedTo !== row.id) {
        const original = this.get(metadata.coalescedTo);
        if (original) {
          const source = verifySessionCollaborationMessage(JSON.parse(original.envelope_json));
          if (sessionCollaborationMessageDigest({ ...source, id: 'notification-content' }) !== sessionCollaborationMessageDigest({ ...message, id: 'notification-content' })) throw new Error('COLLABORATION_COALESCED_SOURCE_MISMATCH');
          const result = this.receipt(original, seen);
          return validateSessionCollaborationReceipt(message, { ...result, message, coalescedTo: source.id });
        }
      }
      return validateSessionCollaborationReceipt(message, { ...metadata, message, ...(row.reply_json ? { reply: JSON.parse(row.reply_json) } : {}) });
    }
    return { schemaVersion: 'SessionCollaborationReceipt/v1', message, phase: row.state === 'accepted' ? 'accepted' : 'unknown',
      run: null, replyRef: null, updatedAt: row.updated_at, ...(row.state === 'dispatching' ? { reason: 'dispatch-outcome-unknown' } : {}) };
  }
  summaries(scope: AutonomySessionScope, after: number, limit: number, taskNodeId?: string) {
    const key = messageScopeKey(scope);
    let query = this.query().selectFrom('session_message_intents').select(['seq', 'id', 'header_json', 'state', 'receipt_json', 'updated_at', 'source_scope', 'target_scope', 'payload_digest'])
      .where(expression => expression.or([expression('source_scope', '=', key), expression('target_scope', '=', key)]))
      .where('seq', '>', after).orderBy('seq').limit(Math.min(50, Math.max(1, limit)));
    if (taskNodeId) query = query.where('task_node', '=', taskNodeId);
    return executeSqliteQuerySync(this.db, query).rows.map(row => {
      const header = JSON.parse(row.header_json) as SessionMessageSummary;
      if (header.id !== row.id || header.payloadDigest !== row.payload_digest || messageScopeKey(header.source) !== row.source_scope || messageScopeKey(header.target) !== row.target_scope) throw new Error('COLLABORATION_MESSAGE_HEADER_MISMATCH');
      return { sequence: row.seq, header,
      phase: row.receipt_json ? (JSON.parse(row.receipt_json) as SessionCollaborationMessageReceipt).phase : row.state === 'accepted' ? 'accepted' as const : 'unknown' as const,
      run: row.receipt_json ? (JSON.parse(row.receipt_json) as SessionCollaborationMessageReceipt).run : null,
      replyRef: row.receipt_json ? (JSON.parse(row.receipt_json) as SessionCollaborationMessageReceipt).replyRef : null,
      updatedAt: row.updated_at };
    });
  }
}

export function messageIntentWriter() { return new SessionCollaborationMessageStore(openOpenClawStateDatabase().db, true); }
export function readMessageIntents<T>(read: (store: SessionCollaborationMessageStore) => T): T {
  const db = new (requireNodeSqlite().DatabaseSync)(resolveOpenClawStateSqlitePath(), { readOnly: true });
  try { return read(new SessionCollaborationMessageStore(db)); } finally { db.close(); }
}
