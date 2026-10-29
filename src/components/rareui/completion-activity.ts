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
