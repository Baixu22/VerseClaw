import { memo, useMemo } from 'react';
import { Coins } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { RawMessage } from '@/stores/chat';
import { extractMessageUsage } from '@/components/assistant-render/model';
import { computeCacheHitRate } from '../../../shared/types/usage';
import { NumberRoll } from '@/components/assistant-ui/number-roll';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export const TokenUsageBadge = memo(function TokenUsageBadge({
  message,
  liveUsage,
  isStreaming,
  className,
}: {
  message: RawMessage;
  liveUsage?: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    totalTokens: number;
    estimatedCostUsd?: number;
  } | null;
  isStreaming?: boolean;
  className?: string;
}) {
  const { t, i18n } = useTranslation('chat');
  const usage = useMemo(() => {
    if (isStreaming && liveUsage) {
      return {
        inputTokens: liveUsage.inputTokens,
        outputTokens: liveUsage.outputTokens,
        // Keep the combined figure for compatibility and carry the split beside it.
        cacheTokens: liveUsage.cacheReadTokens + liveUsage.cacheWriteTokens,
        cacheReadTokens: liveUsage.cacheReadTokens,
        cacheWriteTokens: liveUsage.cacheWriteTokens,
        cacheHitRate: computeCacheHitRate({
          inputTokens: liveUsage.inputTokens,
          cacheReadTokens: liveUsage.cacheReadTokens,
          cacheWriteTokens: liveUsage.cacheWriteTokens,
        }),
        totalTokens: liveUsage.totalTokens,
        estimatedCostUsd: liveUsage.estimatedCostUsd,
      };
    }
    return extractMessageUsage(message);
  }, [message, isStreaming, liveUsage]);

  if (!usage || usage.totalTokens === 0) return null;
  const showCost = typeof usage.estimatedCostUsd === 'number' && usage.estimatedCostUsd > 0;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className={cn(
            'inline-flex h-6 items-center gap-1 rounded-full px-1.5 text-xs text-muted-foreground/75',
            'hover:bg-foreground/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
            className,
          )}
          data-testid="token-usage-badge"
          aria-label={t('toolUi.tokenUsage.total', 'Total tokens')}
        >
          <Coins className="h-3 w-3" aria-hidden="true" />
          <NumberRoll
            value={usage.totalTokens}
            locales={i18n.language}
            format={{ notation: 'compact', maximumFractionDigits: 1 }}
          />
        </button>
      </TooltipTrigger>
      <TooltipContent className="min-w-48">
        <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-xs tabular-nums">
          <dt>{t('toolUi.tokenUsage.input', 'Input tokens')}</dt>
          <dd>{usage.inputTokens.toLocaleString(i18n.language)}</dd>
          <dt>{t('toolUi.tokenUsage.output', 'Output tokens')}</dt>
          <dd>{usage.outputTokens.toLocaleString(i18n.language)}</dd>
          {usage.cacheReadTokens > 0 && (
            <>
              <dt>{t('toolUi.tokenUsage.cacheRead', 'Cache read (hit)')}</dt>
              <dd>{usage.cacheReadTokens.toLocaleString(i18n.language)}</dd>
            </>
          )}
          {usage.cacheWriteTokens > 0 && (
            <>
              <dt>{t('toolUi.tokenUsage.cacheWrite', 'Cache write')}</dt>
              <dd>{usage.cacheWriteTokens.toLocaleString(i18n.language)}</dd>
            </>
          )}
          {usage.cacheTokens > 0 && (
            <>
              <dt>{t('toolUi.tokenUsage.cache', 'Cache tokens')}</dt>
              <dd>{usage.cacheTokens.toLocaleString(i18n.language)}</dd>
            </>
          )}
          {typeof usage.cacheHitRate === 'number' && (
            <>
              <dt>{t('toolUi.tokenUsage.cacheHitRate', 'Cache hit rate')}</dt>
              <dd>{(usage.cacheHitRate * 100).toFixed(1)}%</dd>
            </>
          )}
          <dt className="font-medium text-foreground">{t('toolUi.tokenUsage.total', 'Total tokens')}</dt>
          <dd className="font-medium text-foreground">{usage.totalTokens.toLocaleString(i18n.language)}</dd>
          {showCost && (
            <>
              <dt>{t('toolUi.tokenUsage.cost', 'Estimated cost')}</dt>
              <dd>${usage.estimatedCostUsd!.toFixed(4)}</dd>
            </>
          )}
        </dl>
      </TooltipContent>
    </Tooltip>
  );
});
