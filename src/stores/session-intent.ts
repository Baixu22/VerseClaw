/**
 * One-shot session intents — a hand-off channel between the sidebar and the
 * chat page.
 *
 * The sidebar's conversation context menu can start flows that only the chat
 * page owns the UI for (the handoff draft dialog lives in `pages/Chat`). Rather
 * than duplicate that dialog, the sidebar switches to the target session and
 * parks an intent here; the chat page consumes it once the switch has landed.
 *
 * Intents are deliberately single-shot and time-boxed: if the session switch
 * never completes, a stale intent must not fire minutes later on an unrelated
 * conversation.
 */
import { create } from 'zustand';
import type { AutonomySessionScope } from '@shared/types/identity-scope';
import type { SessionCollaborationControl } from '@shared/types/session-collaboration-control';

export type SessionIntentKind = 'handoff';

export type CollaborationControlIntent = {
  kind: 'collaboration-control';
  action: SessionCollaborationControl;
  requester: AutonomySessionScope;
  scope: AutonomySessionScope;
  runId?: string;
  sessionKey: string;
  requestedAt: number;
};

export type SessionIntent = CollaborationControlIntent | {
  kind: SessionIntentKind;
  sessionKey: string;
  requestedAt: number;
};

/** How long a parked intent stays actionable while waiting for the switch. */
export const SESSION_INTENT_TTL_MS = 15_000;

interface SessionIntentState {
  intent: SessionIntent | null;
  request: (kind: SessionIntentKind, sessionKey: string) => void;
  /** Take the intent and clear it in one step, so it can only fire once. */
  requestCollaborationControl: (input: Pick<CollaborationControlIntent, 'action' | 'requester' | 'scope' | 'runId'>) => void;
  consume: (expected?: SessionIntent) => SessionIntent | null;
  clear: () => void;
}

export const useSessionIntentStore = create<SessionIntentState>((set, get) => ({
  intent: null,
  request: (kind, sessionKey) => set({ intent: { kind, sessionKey, requestedAt: Date.now() } }),
  requestCollaborationControl: (input) => set({
    intent: { kind: 'collaboration-control', ...input, sessionKey: input.scope.sessionKey, requestedAt: Date.now() },
  }),
  consume: (expected) => {
    const { intent } = get();
    if (!intent || (expected && expected !== intent)) return null;
    set({ intent: null });
    return intent;
  },
  clear: () => set({ intent: null }),
}));

export function isSessionIntentFresh(intent: SessionIntent, nowMs = Date.now()): boolean {
  return nowMs - intent.requestedAt <= SESSION_INTENT_TTL_MS;
}
