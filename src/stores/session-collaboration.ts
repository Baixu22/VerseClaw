import { hostApi } from '@/lib/host-api';
import { hostEvents } from '@/lib/host-events';
import { create } from 'zustand';
import { normalizeAutonomySessionScope, type AutonomySessionScope } from '@shared/types/identity-scope';
import { SESSION_COLLABORATION_PURPOSES, type SessionCollaborationPurpose } from '@shared/types/session-collaboration-message';
import { emptySessionCollaborationPage } from '@shared/types/session-collaboration';
import { parseSessionCollaborationWatch, validateSessionCollaborationWatch, type SessionCollaborationWatch, type SessionCollaborationWatchResult } from '@shared/types/session-collaboration-watch';

export type SessionCollaborationView = { search: string; selected: AutonomySessionScope | null };
export const EMPTY_COLLABORATION_VIEW: SessionCollaborationView = { search: '', selected: null };
export type CollaborationMessageDraft = { id: string; text: string; purpose: SessionCollaborationPurpose; phase: 'draft' | 'sending' | 'unknown' | 'retry'; replyTo?: string };
type RecoveryState = {
  views: Record<string, SessionCollaborationView>;
  messageDrafts: Record<string, CollaborationMessageDraft>;
  watchCursors: Record<string, string>;
};
const RECOVERY_KEY = 'clawx.sessionCollaboration.recovery.v1';
function recover(): RecoveryState {
  const state: RecoveryState = { views: {}, messageDrafts: {}, watchCursors: {} };
  try {
    const raw = sessionStorage.getItem(RECOVERY_KEY);
    if (!raw || raw.length > 2_500_000) return state;
    const saved = JSON.parse(raw) as RecoveryState;
    for (const [key, draft] of Object.entries(saved.messageDrafts ?? {}).slice(0, 64)) {
      const scopes = JSON.parse(key);
      if (!Array.isArray(scopes) || scopes.length !== 2) continue;
      for (const scope of scopes) normalizeAutonomySessionScope(scope, scope);
      if (!draft || typeof draft.id !== 'string' || !/^[A-Za-z0-9._:-]{1,160}$/.test(draft.id)
        || typeof draft.text !== 'string' || draft.text.length > 16384 || !SESSION_COLLABORATION_PURPOSES.includes(draft.purpose)
        || !['draft','sending','unknown','retry'].includes(draft.phase)
        || (draft.replyTo !== undefined && (typeof draft.replyTo !== 'string' || draft.replyTo.length > 160))) continue;
      state.messageDrafts[key] = { id: draft.id, text: draft.text, purpose: draft.purpose,
        phase: draft.phase === 'sending' ? 'unknown' : draft.phase, ...(draft.replyTo ? { replyTo: draft.replyTo } : {}) };
    }
    for (const [key, view] of Object.entries(saved.views ?? {}).slice(-64)) {
      if (key.length > 4096 || !view || typeof view.search !== 'string' || view.search.length > 512) continue;
      if (view.selected) normalizeAutonomySessionScope(view.selected, view.selected);
      state.views[key] = { search: view.search, selected: view.selected ?? null };
    }
    for (const [key, cursor] of Object.entries(saved.watchCursors ?? {}).slice(-64)) {
      if (key.length <= 4096 && typeof cursor === 'string' && cursor.length > 0 && cursor.length <= 256) state.watchCursors[key] = cursor;
    }
  } catch { /* Corrupt or unavailable window recovery data never supplies owner facts. */ }
  return state;
}
function persist(state: RecoveryState): boolean {
  try {
    const drafts = Object.entries(state.messageDrafts).filter(([, draft]) => draft.text || draft.phase !== 'draft');
    if (drafts.length > 64) return false; // Keep unresolved intents; do not evict an unknown send to make space.
    sessionStorage.setItem(RECOVERY_KEY, JSON.stringify({
      messageDrafts: Object.fromEntries(drafts.map(([key, draft]) => [key, { ...draft, phase: draft.phase === 'sending' ? 'unknown' : draft.phase }])),
      views: Object.fromEntries(Object.entries(state.views).slice(-64)),
      watchCursors: Object.fromEntries(Object.entries(state.watchCursors).slice(-64)),
    }));
    return true;
  } catch { return false; }
}
export const useSessionCollaborationUi = create<RecoveryState & {
  persistenceFailed: boolean;
  updateMessageDraft: (key: string, patch: Partial<CollaborationMessageDraft>) => boolean;
  discardMessageDraft: (key: string) => boolean;
  updateView: (key: string, patch: Partial<SessionCollaborationView>) => void;
  acknowledgeWatch: (key: string, cursor: string | null) => boolean;
}>((set, get) => {
  const update = (patch: Partial<RecoveryState>) => {
    const state = { ...get(), ...patch };
    const saved = persist(state);
    set({ ...patch, persistenceFailed: !saved });
    return saved;
  };
  return { ...recover(), persistenceFailed: false,
    updateMessageDraft: (key, patch) => update({ messageDrafts: { ...get().messageDrafts,
      [key]: { ...(get().messageDrafts[key] ?? { id: crypto.randomUUID(), text: '', purpose: 'request', phase: 'draft' }), ...patch } } }),
    discardMessageDraft: key => {
      if (get().messageDrafts[key]?.phase === 'sending') return false;
      const messageDrafts = { ...get().messageDrafts }; delete messageDrafts[key];
      if (Object.values(messageDrafts).filter(draft => draft.text || draft.phase !== 'draft').length > 64) {
        try {
          // Remove only the requested persisted copy while excess drafts still await storage.
          const saved = JSON.parse(sessionStorage.getItem(RECOVERY_KEY) ?? '{}');
          if (saved.messageDrafts) delete saved.messageDrafts[key];
          sessionStorage.setItem(RECOVERY_KEY, JSON.stringify(saved));
          set({ messageDrafts, persistenceFailed: true }); return true;
        } catch { set({ persistenceFailed: true }); return false; }
      }
      if (!persist({ ...get(), messageDrafts })) { set({ persistenceFailed: true }); return false; }
      set({ messageDrafts, persistenceFailed: false }); return true;
    },
    updateView: (key, patch) => { update({ views: { ...get().views, [key]: { ...(get().views[key] ?? EMPTY_COLLABORATION_VIEW), ...patch } } }); },
    acknowledgeWatch: (key, cursor) => {
      const next = { ...get().watchCursors }; delete next[key]; if (cursor) next[key] = cursor;
      if (!persist({ ...get(), watchCursors: next })) return false;
      set({ watchCursors: next, persistenceFailed: false }); return true;
    },
  };
});

/** One selected-session listener; unmount cancels its exact Main-owned wait. */
export function subscribeSessionCollaboration(input: SessionCollaborationWatch, onUpdate: (result: SessionCollaborationWatchResult) => void,
  onRecoveryFailure?: (failed: boolean) => void) {
  const original = parseSessionCollaborationWatch(input);
  onRecoveryFailure?.(false);
  const recoveryKey = JSON.stringify([original.query, original.condition, original.run ?? null, original.materialRef ?? null]);
  let active = true, pending: SessionCollaborationWatch | null = null,
    cursor = original.cursor ?? useSessionCollaborationUi.getState().watchCursors[recoveryKey];
  let reconnectPending = false;
  const events = new Set<string>();
  const failed = (request: SessionCollaborationWatch, state: 'unknown' | 'unavailable') => onUpdate({
    schemaVersion: 'SessionCollaborationWatch/v1', id: request.id, state, cursor: null, event: null,
    page: emptySessionCollaborationPage(request.query, state, state === 'unknown' ? 'protocol-unverified' : 'owner-unavailable'),
  });
  const run = async () => {
    if (!active || pending) return;
    const request = { ...original, id: crypto.randomUUID(), ...(cursor ? { cursor } : {}) };
    pending = request;
    let continueWaiting = false;
    try {
      const response = await hostApi.sessionActivity.watch(request);
      if (!active || pending !== request) return;
      const result = response.success ? validateSessionCollaborationWatch(request, response.watch) : null;
      if (!result) { failed(request, 'unknown'); return; }
      if (!result.event || !events.has(result.event.id)) {
        // Synchronous consumer errors jump to catch before any cursor is acknowledged.
        onUpdate(result);
        if (result.event) { events.add(result.event.id); if (events.size > 64) events.delete(events.values().next().value!); }
      }
      if (result.cursor || result.state === 'stale') {
        const saved = useSessionCollaborationUi.getState().acknowledgeWatch(recoveryKey, result.cursor);
        onRecoveryFailure?.(!saved);
        if (!saved) { reconnectPending = false; return; }
        cursor = result.cursor ?? undefined;
      }
      continueWaiting = request.timeoutMs! > 0 && (result.state === 'timeout' ||
        (original.condition === 'changed' && result.state === 'changed') ||
        (original.condition === 'material-changed' && result.state === 'satisfied'));
    } catch { if (active && pending === request) failed(request, 'unavailable'); }
    finally {
      if (pending === request) pending = null;
      if (active && (continueWaiting || reconnectPending)) {
        reconnectPending = false;
        void run();
      }
    }
  };
  const reconnect = hostEvents.onGatewayStatus(status => {
    if (status.state !== 'running') return;
    if (pending) reconnectPending = true;
    else void run();
  });
  void run();
  return () => {
    active = false; reconnect();
    if (pending) void hostApi.sessionActivity.cancelWatch({ id: pending.id, query: pending.query }).catch(() => {});
    pending = null;
  };
}
