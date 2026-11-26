// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { requireNodeSqlite } from '../../openclaw_runtime/src/infra/node-sqlite';
import { readMessageIntents, SessionCollaborationMessageStore } from '../../openclaw_runtime/src/sessions/session-collaboration-message-store';
import { resolveOpenClawStateSqlitePath } from '../../openclaw_runtime/src/state/openclaw-state-db.paths';
import { createSessionCollaborationMessage } from '../../shared/session-collaboration-message';
import { parseSessionCollaborationQuery } from '../../shared/types/session-collaboration';
import { normalizeRunScope } from '../../shared/types/identity-scope';

const a = parseSessionCollaborationQuery({ requester: { workspaceId: 'a', projectId: 'a', sessionKey: 'agent:main:a', sessionGeneration: 'ga' } }).requester;
const b = parseSessionCollaborationQuery({ requester: { workspaceId: 'b', projectId: 'b', sessionKey: 'agent:main:b', sessionGeneration: 'gb' } }).requester;
const message = () => createSessionCollaborationMessage({ id: 'stable-message', target: b, purpose: 'finding', message: 'Original content' }, { scope: a, run: null, actor: 'operator' }, 1);
let path: string, db: InstanceType<ReturnType<typeof requireNodeSqlite>['DatabaseSync']>, store: SessionCollaborationMessageStore;
beforeEach(() => { path = join(mkdtempSync(join(tmpdir(), 'session-delivery-')), 'state.sqlite'); db = new (requireNodeSqlite().DatabaseSync)(path); store = new SessionCollaborationMessageStore(db, true); });
afterEach(() => db.close());
describe('original message intent owner', () => {
  it('keeps the first source capture through replay and refuses different content', () => {
    const first = store.accept(message());
    db.close();
    db = new (requireNodeSqlite().DatabaseSync)(path);
    store = new SessionCollaborationMessageStore(db);
    const other = createSessionCollaborationMessage({ id: 'stable-message', target: b, purpose: 'finding', message: 'Changed content' }, { scope: a, run: null, actor: 'operator' }, 1);
    expect(() => store.accept(other)).toThrow('ID_CONFLICT');
    const retry = { ...message(), createdAt: 99 };
    expect(store.accept(retry).envelope_json).toBe(first.envelope_json);
  });
  it('leaves the first read empty without creating the message table', () => {
    const root = dirname(path);
    const stateFile = join(root, 'state', 'openclaw.sqlite');
    vi.stubEnv('OPENCLAW_STATE_DIR', root);
    try {
      expect(resolveOpenClawStateSqlitePath()).toBe(stateFile);
      mkdirSync(dirname(stateFile), { recursive: true });
      const stateDb = new (requireNodeSqlite().DatabaseSync)(stateFile);
      try {
        stateDb.exec('CREATE TABLE existing_owner (id INTEGER)');
        const read = vi.fn();
        expect(readMessageIntents(read)).toBeUndefined();
        expect(read).not.toHaveBeenCalled();
        expect(stateDb.prepare("SELECT name FROM sqlite_schema WHERE type = 'table'").all()).toEqual([{ name: 'existing_owner' }]);
      } finally {
        stateDb.close();
      }
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it('allows an accepted intent once and preserves unknown dispatch across an actual database reopen', () => {
    const row = store.accept(message()); expect(store.claim(row.id, row.payload_digest)).toBe(true);
    db.close(); db = new (requireNodeSqlite().DatabaseSync)(path); store = new SessionCollaborationMessageStore(db);
    expect(store.claim(row.id, row.payload_digest)).toBe(false); expect(store.receipt(store.get(row.id)!).phase).toBe('unknown');
    expect(store.receipt(store.get(row.id)!).reason).toBe('dispatch-outcome-unknown');
  });
  it('retains an owner ack and reads bounded metadata without full message bytes or writes', () => {
    const msg = message(), row = store.accept(msg); store.claim(row.id, row.payload_digest);
    store.record(msg.id, { schemaVersion: 'SessionCollaborationReceipt/v1', message: msg, phase: 'accepted', run: null, replyRef: null, updatedAt: 10 });
    const before = db.prepare('SELECT * FROM session_message_intents').all();
    const summaries = store.summaries(a, 0, 20); expect(summaries).toHaveLength(1); expect(summaries[0].header.preview).toBe(msg.message);
    expect('message' in summaries[0].header).toBe(false); expect(store.receipt(store.get(msg.id)!).message.createdAt).toBe(1);
    expect(db.prepare('SELECT * FROM session_message_intents').all()).toEqual(before);
    expect(store.claim(msg.id, msg.payloadDigest)).toBe(false);
  });
  it('does not replace a known accepted input with a late unknown or rejection', () => {
    const msg = message(); store.accept(msg); store.claim(msg.id, msg.payloadDigest);
    const receipt = { schemaVersion: 'SessionCollaborationReceipt/v1' as const, message: msg, phase: 'accepted' as const, run: null, replyRef: null, updatedAt: 2 };
    store.record(msg.id, receipt); store.record(msg.id, { ...receipt, phase: 'unknown', updatedAt: 3 });
    expect(store.receipt(store.get(msg.id)!).phase).toBe('accepted');
    store.record(msg.id, { ...receipt, phase: 'rejected', updatedAt: 4 }); expect(store.receipt(store.get(msg.id)!).phase).toBe('accepted');
  });
  it('keeps confirmed delivery when earlier acknowledgements arrive after reopening the owner', () => {
    const msg = message();
    const run = normalizeRunScope({ runId: 'receiver-run', scope: { workspaceId: b.workspaceId, projectId: b.projectId, sessionKey: b.sessionKey } });
    store.accept(msg);
    store.claim(msg.id, msg.payloadDigest);
    const delivered = { schemaVersion: 'SessionCollaborationReceipt/v1' as const, message: msg, phase: 'delivered' as const, run, replyRef: null, updatedAt: 10 };
    store.record(msg.id, delivered);
    db.close();
    db = new (requireNodeSqlite().DatabaseSync)(path);
    store = new SessionCollaborationMessageStore(db);
    store.record(msg.id, { ...delivered, phase: 'queued', updatedAt: 11 });
    store.record(msg.id, { ...delivered, phase: 'accepted', run: null, updatedAt: 12 });
    expect(store.receipt(store.get(msg.id)!)).toEqual(delivered);
  });
  it('retains the actual owner reply and its byte hash separately from metadata pages', () => {
    const msg = message(), text = 'Receiver reply', run = normalizeRunScope({ runId: 'receiver-run', scope: { workspaceId: b.workspaceId, projectId: b.projectId, sessionKey: b.sessionKey } });
    store.accept(msg); store.claim(msg.id, msg.payloadDigest);
    store.record(msg.id, { schemaVersion: 'SessionCollaborationReceipt/v1', message: msg, phase: 'replied', run, replyRef: 'message-owner-reply',
      reply: { text, sha256: createHash('sha256').update(text).digest('hex'), run, truncated: false }, updatedAt: 2 });
    expect(store.receipt(store.get(msg.id)!).reply?.text).toBe(text);
    expect(JSON.stringify(store.summaries(b, 0, 20))).not.toContain(text);
    expect(store.summaries(b, 0, 20)[0].phase).toBe('replied');
  });
});
