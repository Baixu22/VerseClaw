import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import type { LiveTokenUsage, WorkspaceContextRange } from '@/../shared/types/workspace';

/**
 * TF-0450: session-level context pressure readout.
 *
 * VS Code and JetBrains converged on the same conclusion from user demand:
 * people cannot tell how full the context window is, and cannot tell whether a
 * turn was cheap or expensive. Verse Claw already had per-turn and compaction
 * readouts, but nothing that answered "what has this session cost so far".
 *
 * This is display only. It reads values that already exist on LiveTokenUsage
 * and WorkspaceContextRange; it adds no collection path, no polling, and no
 * authority. The cache hit-rate it surfaces is accounting, never routing.
 */

export type ChatContextPressureProps = {
  liveUsage?: LiveTokenUsage | null;
  contextRange?: WorkspaceContextRange | null;
};

function formatCompactNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value % 1_000 === 0 ? 0 : 1)}k`;
  return String(value);
}

function formatHitRate(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/**
 * Resolve what the indicator can honestly show right now.
 *
 * Each field is independently nullable: the runtime may know usage but not the
 * window ceiling, or know the ceiling but not have a rate yet. Showing "—"
 * for one field is better than hiding the whole readout.
 */
export function resolveContextPressure(input: ChatContextPressureProps): {
  usedTokens: number | null;
  maxTokens: number | null;
  cacheReadTokens: number | null;
  warmTurnHitRate: number | null;
  lastTurnHitRate: number | null;
  estimatedCostUsd: number | null;
  utilisation: number | null;
} {
  const { liveUsage, contextRange } = input;
  const usedTokens = liveUsage?.totalTokens ?? contextRange?.usedTokens ?? null;
  // The window ceiling is a property of the range, not of live usage. Gating it
  // on liveUsage being present would drop the ceiling whenever only the range
  // knows the used count.
  const maxTokens = contextRange?.maxTokens ?? null;
  const utilisation =
    usedTokens != null && maxTokens != null && maxTokens > 0 ? usedTokens / maxTokens : null;
  return {
    usedTokens,
    maxTokens,
    cacheReadTokens: liveUsage?.cacheReadTokens ?? null,
    warmTurnHitRate: liveUsage?.warmTurnHitRate ?? null,
    lastTurnHitRate: liveUsage?.lastTurnHitRate ?? null,
    estimatedCostUsd: liveUsage?.estimatedCostUsd ?? null,
    utilisation,
  };
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="flex items-center justify-between gap-4 rounded-md bg-surface-input px-3 py-2"
      data-testid="chat-context-pressure-row"
    >
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  );
}

function ChatContextPressureImpl({ liveUsage, contextRange }: ChatContextPressureProps) {
  const { t } = useTranslation('chat');
  const pressure = resolveContextPressure({ liveUsage, contextRange });

  // Nothing measured yet: render nothing rather than an empty panel.
  if (pressure.usedTokens == null && pressure.cacheReadTokens == null) return null;

  const used = pressure.usedTokens != null ? formatCompactNumber(pressure.usedTokens) : '—';
  const limit =
    pressure.usedTokens != null
      ? pressure.maxTokens != null
        ? t('composer.tokenUsageWithLimit', {
          used,
          max: formatCompactNumber(pressure.maxTokens),
        })
        : t('composer.tokenUsage', { tokens: used })
      : t('composer.contextPressure.unknown');

  return (
    <div
      className="grid gap-2 text-sm"
      data-testid="chat-context-pressure"
      role="group"
      aria-label={t('composer.contextPressure.title')}
    >
      <Row label={t('composer.contextPressure.title')} value={limit} />
      {pressure.cacheReadTokens != null && (
        <Row
          label={t('composer.contextPressure.cacheRead')}
          value={formatCompactNumber(pressure.cacheReadTokens)}
        />
      )}
      {pressure.warmTurnHitRate != null && (
        <Row
          label={t('composer.contextPressure.warmHitRate')}
          value={formatHitRate(pressure.warmTurnHitRate)}
        />
      )}
      {pressure.lastTurnHitRate != null && (
        <Row
          label={t('composer.contextPressure.lastTurnHitRate')}
          value={formatHitRate(pressure.lastTurnHitRate)}
        />
      )}
      {pressure.estimatedCostUsd != null && (
        <Row
          label={t('composer.contextPressure.estimatedCost')}
          value={`$${pressure.estimatedCostUsd.toFixed(4)}`}
        />
      )}
    </div>
  );
}

export const ChatContextPressure = memo(ChatContextPressureImpl);
ChatContextPressure.displayName = 'ChatContextPressure';
