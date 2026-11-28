// @vitest-environment node
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { requireNodeSqlite } from '../../openclaw_runtime/src/infra/node-sqlite';
import { SessionCollaborationMessageStore } from '../../openclaw_runtime/src/sessions/session-collaboration-message-store';
import { createSessionCollaborationMessage } from '../../shared/session-collaboration-message';
import { parseSessionCollaborationQuery } from '../../shared/types/session-collaboration';
import { normalizeRunScope } from '../../shared/types/identity-scope';
import type { SessionCollaborationMessageReceipt } from '../../shared/types/session-collaboration-message';

const source = parseSessionCollaborationQuery({ requester: { workspaceId: 'source', projectId: 'source', sessionKey: 'agent:main:source', sessionGeneration: 'gs' } }).requester;
const target = { ...source, sessionKey: 'agent:main:target' as typeof source.sessionKey, sessionGeneration: 'gt' };
let root: string, db: InstanceType<ReturnType<typeof requireNodeSqlite>['DatabaseSync']>, store: SessionCollaborationMessageStore;
function reopen() { db.close(); db = new (requireNodeSqlite().DatabaseSync)(join(root, 'state.sqlite')); store = new SessionCollaborationMessageStore(db); }
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'collaboration-recovery-')); db = new (requireNodeSqlite().DatabaseSync)(join(root, 'state.sqlite')); store = new SessionCollaborationMessageStore(db, true); });
afterEach(() => { db.close(); rmSync(root, { recursive: true, force: true }); });

it.each(['accepted', 'dispatch', 'queued', 'delivered', 'replied'] as const)('recovers the original message after interruption at %s without repeating its effect', phase => {
  const message = createSessionCollaborationMessage({ id: `failure-${phase}`, target, purpose: 'request', message: 'Original recovery request' },
    { scope: source, run: null, actor: 'operator' }, 1);
  store.accept(message);
  let effects = 0;
  const run = normalizeRunScope({ runId: 'original-run', scope: target });
  if (phase !== 'accepted') { expect(store.claim(message.id, message.payloadDigest)).toBe(true); effects++; }
  if (!['accepted', 'dispatch'].includes(phase)) {
    const text = 'Original receiver reply';
    store.record(message.id, { schemaVersion: 'SessionCollaborationReceipt/v1', message, phase, run, replyRef: phase === 'replied' ? 'reply-original' : null,
      ...(phase === 'replied' ? { reply: { text, sha256: createHash('sha256').update(text).digest('hex'), run, truncated: false } } : {}), updatedAt: 2 } as SessionCollaborationMessageReceipt);
  }
  reopen();
  expect(store.accept(message).payload_digest).toBe(message.payloadDigest);
  if (store.claim(message.id, message.payloadDigest)) effects++;
  expect(effects).toBe(1);
  const recovered = store.receipt(store.get(message.id)!);
  expect(recovered.message).toEqual(message);
  expect(recovered.phase).toBe(phase === 'accepted' || phase === 'dispatch' ? 'unknown' : phase);
  if (phase === 'replied') expect(recovered.reply?.text).toBe('Original receiver reply');
  expect(store.summaries({ ...target, sessionGeneration: 'reset' }, 0, 20)).toEqual([]);
  expect(() => store.accept(createSessionCollaborationMessage({ id: message.id, target, purpose: 'request', message: 'Changed intent' },
    { scope: source, run: null, actor: 'operator' }, 1))).toThrow('ID_CONFLICT');
  expect(db.prepare('SELECT COUNT(*) AS count FROM session_message_intents').get()?.count).toBe(1);
});
