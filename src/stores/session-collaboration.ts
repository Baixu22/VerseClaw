import { hostApi } from '@/lib/host-api';
import { hostEvents } from '@/lib/host-events';
import { create } from 'zustand';
import type { AutonomySessionScope } from '@shared/types/identity-scope';
import type { SessionCollaborationPurpose } from '@shared/types/session-collaboration-message';
import { emptySessionCollaborationPage } from '@shared/types/session-collaboration';
import { parseSessionCollaborationWatch, validateSessionCollaborationWatch, type SessionCollaborationWatch, type SessionCollaborationWatchResult } from '@shared/types/session-collaboration-watch';

export type SessionCollaborationView = { search: string; selected: AutonomySessionScope | null };
export const EMPTY_COLLABORATION_VIEW: SessionCollaborationView = { search: '', selected: null };
export type CollaborationMessageDraft = { id: string; text: string; purpose: SessionCollaborationPurpose; phase: 'draft' | 'sending' | 'unknown'; replyTo?: string };
export const useSessionCollaborationUi = create<{
  views: Record<string, SessionCollaborationView>;
  messageDrafts: Record<string, CollaborationMessageDraft>;
  updateMessageDraft: (key: string, patch: Partial<CollaborationMessageDraft>) => void;
  updateView: (key: string, patch: Partial<SessionCollaborationView>) => void;
}>((set) => ({ views: {}, messageDrafts: {}, updateMessageDraft: (key, patch) => set(state => ({ messageDrafts: {
  ...state.messageDrafts, [key]: { ...(state.messageDrafts[key] ?? { id: crypto.randomUUID(), text: '', purpose: 'request', phase: 'draft' }), ...patch },
} })), updateView: (key, patch) => set(state => ({ views: {
  ...state.views, [key]: { ...(state.views[key] ?? EMPTY_COLLABORATION_VIEW), ...patch },
} })) }));

/** One selected-session listener; unmount cancels its exact Main-owned wait. */
export function subscribeSessionCollaboration(input: SessionCollaborationWatch, onUpdate: (result: SessionCollaborationWatchResult) => void) {
  const original = parseSessionCollaborationWatch(input);
  let active = true, pending: SessionCollaborationWatch | null = null, cursor = original.cursor;
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
      if (result.cursor) cursor = result.cursor;
      if (!result.event || !events.has(result.event.id)) {
        if (result.event) { events.add(result.event.id); if (events.size > 64) events.delete(events.values().next().value!); }
        onUpdate(result);
      }
      continueWaiting = request.timeoutMs! > 0 && (result.state === 'timeout' || (original.condition === 'changed' && result.state === 'changed'));
    } catch { if (active && pending === request) failed(request, 'unavailable'); }
    finally { if (pending === request) pending = null; }
    if (active && continueWaiting) void run();
  };
  const reconnect = hostEvents.onGatewayStatus(status => { if (status.state === 'running') void run(); });
  void run();
  return () => {
    active = false; reconnect();
    if (pending) void hostApi.sessionActivity.cancelWatch({ id: pending.id, query: pending.query }).catch(() => {});
    pending = null;
  };
}
