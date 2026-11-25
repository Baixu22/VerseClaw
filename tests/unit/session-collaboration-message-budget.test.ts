// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { requireNodeSqlite } from '../../openclaw_runtime/src/infra/node-sqlite';
import { SessionCollaborationMessageStore } from '../../openclaw_runtime/src/sessions/session-collaboration-message-store';
import { createSessionCollaborationMessage } from '../../shared/session-collaboration-message';
import { parseSessionCollaborationQuery } from '../../shared/types/session-collaboration';
const scope = parseSessionCollaborationQuery({ requester: { workspaceId: 'scope', projectId: 'scope', sessionKey: 'agent:main:source', sessionGeneration: 'generation' } }).requester;
describe('notification coalescing', () => {
  it('coalesces a status burst with its original intent and keeps requests independent', () => {
    const db = new (requireNodeSqlite().DatabaseSync)(':memory:'), store = new SessionCollaborationMessageStore(db, true);
    try {
      const build = (id: string, purpose: 'status' | 'request') => createSessionCollaborationMessage({ id, target: scope, purpose, message: 'Same bytes' }, { scope, run: null, actor: 'operator' });
      const first = store.accept(build('first', 'status'));
      const second = store.accept(build('second', 'status'));
      expect(store.receipt(second).coalescedTo).toBe(first.id); expect(store.claim(second.id, second.payload_digest)).toBe(false);
      const request = store.accept(build('request', 'request')); expect(store.claim(request.id, request.payload_digest)).toBe(true);
    } finally { db.close(); }
  });
});
