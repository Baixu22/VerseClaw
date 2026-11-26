import { createHash } from 'node:crypto';
import { emptySessionCollaborationPage, validateSessionCollaborationPage, type SessionCollaborationPage } from './types/session-collaboration.js';
import { parseSessionCollaborationWatch, type SessionCollaborationWatch, type SessionCollaborationWatchEvent, type SessionCollaborationWatchResult } from './types/session-collaboration-watch.js';
import type { SessionCollaborationMaterialState } from './types/session-collaboration-material.js';

export type SessionCollaborationObservation = {
  page: SessionCollaborationPage;
  terminal?: SessionCollaborationWatchEvent | null;
  receipts?: SessionCollaborationWatchEvent[];
  receiptFloor?: number;
  receiptTruncated?: boolean;
  materialState?: SessionCollaborationMaterialState;
};
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const stableFacts = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableFacts);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !['readAt', 'capturedAt', 'observedAt'].includes(key))
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stableFacts(item)]));
};

/** A bounded wait owns listeners only; every state transition is reread from the original owner. */
export async function waitForSessionCollaboration(input: SessionCollaborationWatch, deps: {
  read: () => Promise<SessionCollaborationObservation>;
  subscribe: (wake: () => void) => () => void;
  signal?: AbortSignal;
}): Promise<SessionCollaborationWatchResult> {
  const request = parseSessionCollaborationWatch(input);
  const basis = hash({ query: request.query, condition: request.condition, run: request.run, materialRef: request.materialRef });
  let previous: string | null = request.observedMaterialState ? hash(request.observedMaterialState) : null, sequence = 0;
  const failure = (state: 'stale' | 'unavailable' | 'unknown', reason: 'scope-mismatch' | 'owner-unavailable' | 'protocol-unverified') => ({
    schemaVersion: 'SessionCollaborationWatch/v1' as const, id: request.id, state, cursor: null,
    page: emptySessionCollaborationPage(request.query, state, reason), event: null,
  });
  if (request.cursor) {
    try {
      const cursor = JSON.parse(Buffer.from(request.cursor, 'base64url').toString());
      if (!Array.isArray(cursor) || cursor.length !== 3 || cursor[0] !== basis || !/^[a-f0-9]{64}$/.test(cursor[1])
        || !Number.isSafeInteger(cursor[2]) || cursor[2] < 0) return failure('stale', 'scope-mismatch');
      previous = cursor[1]; sequence = cursor[2];
    } catch { return failure('stale', 'scope-mismatch'); }
  }
  let version = 0, resolveWake: (() => void) | undefined, expired = false;
  let stop!: () => void;
  const stopped = new Promise<null>(resolve => { stop = () => resolve(null); });
  const wake = () => { version++; resolveWake?.(); resolveWake = undefined; };
  const unsubscribe = deps.subscribe(wake);
  const onAbort = () => { stop(); wake(); };
  deps.signal?.addEventListener('abort', onAbort, { once: true });
  const timer = request.timeoutMs === 0 ? undefined : setTimeout(() => { expired = true; stop(); wake(); }, request.timeoutMs);
  let page = emptySessionCollaborationPage(request.query, 'unknown', 'source-not-read');
  let cursor: string | null = null;
  const result = (state: SessionCollaborationWatchResult['state'], event: SessionCollaborationWatchEvent | null = null): SessionCollaborationWatchResult =>
    ({ schemaVersion: 'SessionCollaborationWatch/v1', id: request.id, state, cursor, page, event });
  try {
    for (;;) {
      if (deps.signal?.aborted) return result('cancelled');
      const before = version;
      const observation = await Promise.race([deps.read(), stopped]);
      if (!observation) return result(deps.signal?.aborted ? 'cancelled' : 'timeout');
      page = validateSessionCollaborationPage(request.query, observation.page);
      if (deps.signal?.aborted) return result('cancelled');
      if (['stale', 'unavailable', 'unknown'].includes(page.state)) return result(page.state as 'stale' | 'unavailable' | 'unknown');
      const row = page.items[0];
      if (!row) return result('unknown');
      if (request.condition === 'task-receipt' && row.sources.tasks.state !== 'ready') return result('unknown');
      if (request.condition === 'task-receipt' && observation.receiptTruncated && sequence > 0 && sequence < (observation.receiptFloor ?? 0)) return result('unknown');
      const terminal = observation.terminal ?? null;
      let fingerprint: string;
      if (request.materialRef) {
        if (!observation.materialState) return result('unknown');
        fingerprint = hash(observation.materialState);
      } else if (request.condition === 'run-terminal') {
        fingerprint = terminal ? hash(terminal.id) : previous ?? hash(null);
      } else {
        fingerprint = hash(stableFacts(request.condition === 'blocking-changed'
          ? { session: row.sources.session, tasks: row.sources.tasks }
          : { row, terminal: terminal?.id ?? null }));
      }
      const nextReceipt = (observation.receipts ?? []).filter(event => (event.sequence ?? 0) > sequence)
        .sort((a, b) => a.sequence! - b.sequence!)[0];
      let cursorSequence = nextReceipt?.sequence ?? sequence;
      let event: SessionCollaborationWatchEvent | null = null;
      if (request.condition === 'run-terminal' && previous !== fingerprint) event = terminal;
      if (request.condition === 'task-receipt') event = nextReceipt ?? null;
      if (request.materialRef && observation.materialState && previous && previous !== fingerprint) {
        if (sequence >= Number.MAX_SAFE_INTEGER) return failure('stale', 'scope-mismatch');
        cursorSequence = sequence + 1;
        event = { id: `material:${hash([request.materialRef, observation.materialState, cursorSequence])}`, owner: 'TaskSystem',
          kind: 'material-changed', materialRef: request.materialRef, materialState: observation.materialState,
          taskNodeId: request.materialRef.taskNodeId, revision: request.materialRef.taskRevision, sequence: cursorSequence };
      }
      if (request.condition === 'idle' && row.status === 'idle' && (!request.cursor || previous !== fingerprint)) event = { id: `idle:${fingerprint}`, owner: 'sessions', kind: 'idle' };
      if (previous && previous !== fingerprint && ['changed', 'blocking-changed'].includes(request.condition)) {
        event = { id: `${request.condition}:${fingerprint}`, owner: request.condition === 'changed' ? 'sessions' : 'TaskSystem', kind: request.condition };
      }
      cursor = Buffer.from(JSON.stringify([basis, fingerprint, cursorSequence])).toString('base64url');
      if (event) return result(request.condition === 'changed' ? 'changed' : 'satisfied', event);
      previous ??= fingerprint;
      if (expired || request.timeoutMs === 0) return result('timeout');
      if (version !== before) continue;
      await new Promise<void>(resolve => { resolveWake = resolve; });
    }
  } catch { return failure('unavailable', 'owner-unavailable'); }
  finally { if (timer) clearTimeout(timer); unsubscribe(); deps.signal?.removeEventListener('abort', onAbort); resolveWake = undefined; }
}
