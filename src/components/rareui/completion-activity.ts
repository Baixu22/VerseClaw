import type { ChatRuntimeRunState } from '@/stores/chat';
import type { UserRunCard } from '@/pages/Chat/execution-projection';

export type CompletionActivityKind = 'completed' | 'error' | 'action-required';
export type CompletionActivity = {
  id: string;
  sessionKey: string;
  runId?: string;
  index?: number;
  completedAt: number;
  preview: string;
  kind: CompletionActivityKind;
};

/**
 * A session with a run in flight, derived by the sidebar from the same runtime
 * state that drives its row status orbs — never from timers or guesses.
 */
export type LiveSessionActivity = {
  sessionKey: string;
  label: string;
  /** `waiting` = the run is blocked on the user (approval / input). */
  state: 'running' | 'waiting';
  /** Start of the run in flight; null when the runtime has not reported one. */
  startedAt: number | null;
};

/** Minimal shape the activity feed groups by; the store's nudge satisfies it. */
type SessionScopedEntry = { sessionKey: string };

export type ActivityGroup<T extends SessionScopedEntry> = { sessionKey: string; entries: T[] };

/**
 * Consecutive entries from one session share a heading, so five finished turns
 * of the same conversation read as one conversation with five results instead
 * of five copies of its name. Only CONSECUTIVE entries merge: the feed stays
 * strictly newest-first across sessions.
 */
export function groupConsecutiveBySession<T extends SessionScopedEntry>(entries: T[]): ActivityGroup<T>[] {
  const groups: ActivityGroup<T>[] = [];
  for (const entry of entries) {
    const last = groups.at(-1);
    if (last && last.sessionKey === entry.sessionKey) last.entries.push(entry);
    else groups.push({ sessionKey: entry.sessionKey, entries: [entry] });
  }
  return groups;
}

/** `0:42`, `12:05`, `1:02:09` — a running clock with tabular digits. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

type CompletedTurn = { index: number; response?: string; completedAt?: number };

function normalizeTimestamp(value: unknown): number | undefined {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return undefined;
  return numeric > 1_000_000_000_000 ? numeric : numeric * 1000;
}

/**
 * Terminal run cards, failed runs and completed assistant replies share one
 * bounded activity feed. Action-required approvals are merged by the store
 * owner because their source is the permission ledger, not a run card.
 */
export function buildCompletionActivity(
  sessionKey: string,
  cards: UserRunCard[],
  runs: Record<string, ChatRuntimeRunState>,
  previews: Map<number, string>,
  turns: CompletedTurn[] = [],
  activeTriggerIndex?: number | null,
): CompletionActivity[] {
  const entries: CompletionActivity[] = cards
    .filter((card) => !card.active && (
      (card.status === 'completed' && card.hasVisibleReply)
      || card.status === 'error'
    ))
    .map((card) => ({
      id: `${sessionKey}:${card.runId ?? card.runKey}`,
      sessionKey,
      runId: card.runId,
      index: card.triggerIndex,
      completedAt: card.endedAt ?? card.startedAt ?? 0,
      preview: previews.get(card.triggerIndex) ?? '',
      kind: card.status === 'error' ? 'error' : 'completed',
    }));
  const known = new Set(entries.map((entry) => entry.id));
  for (const run of Object.values(runs)) {
    if ((run.status !== 'completed' && run.status !== 'error') || !run.sessionKey || !run.endedAt) continue;
    const id = `${run.sessionKey}:${run.runId}`;
    if (known.has(id)) continue;
    const runtimeError = run.events.findLast((event) => event.type === 'run.ended' && event.status === 'error');
    entries.push({
      id,
      sessionKey: run.sessionKey,
      runId: run.runId,
      index: undefined,
      completedAt: run.endedAt,
      preview: runtimeError?.type === 'run.ended' ? runtimeError.error ?? '' : '',
      kind: run.status === 'error' ? 'error' : 'completed',
    });
  }
  const cardIndices = new Set(entries.flatMap((entry) => entry.index == null ? [] : [entry.index]));
  for (const turn of turns) {
    if (turn.index === activeTriggerIndex || cardIndices.has(turn.index) || !turn.response?.trim()) continue;
    const completedAt = normalizeTimestamp(turn.completedAt);
    if (completedAt == null) continue;
    entries.push({
      id: `${sessionKey}:message:${turn.index}`,
      sessionKey,
      index: turn.index,
      completedAt,
      preview: turn.response.trim(),
      kind: 'completed',
    });
  }
  return entries.sort((left, right) => right.completedAt - left.completedAt || right.id.localeCompare(left.id)).slice(0, 50);
}
