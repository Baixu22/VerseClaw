import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDown, ArrowUp, Database, Coins } from 'lucide-react';
import type { RawMessage } from '@/stores/chat';
import { extractMessageUsage } from '@/components/assistant-render/model';
import { NumberRoll } from '@/components/assistant-render/NumberRoll';
import { cn } from '@/lib/utils';

/**
 * Token usage badge rendered at the end of assistant messages.
 *
 * Shows input / output / cache token counts with an animated NumberRoll,
 * mirroring Claude Desktop's end-of-message token counter.
 *
 * - For finalized messages: extracts usage from the message metadata.
 * - For the streaming message: receives `liveUsage` from the parent.
 *
 * Renders nothing when no usage data is available, so it degrades gracefully
 * for messages that predate usage tracking.
 */
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
  const { t } = useTranslation('chat');

  const usage = useMemo(() => {
    if (isStreaming && liveUsage) {
      return {
        inputTokens: liveUsage.inputTokens,
        outputTokens: liveUsage.outputTokens,
        cacheTokens: liveUsage.cacheReadTokens + liveUsage.cacheWriteTokens,
        totalTokens: liveUsage.totalTokens,
        estimatedCostUsd: liveUsage.estimatedCostUsd,
      };
    }
    return extractMessageUsage(message);
  }, [message, isStreaming, liveUsage]);

  if (!usage || usage.totalTokens === 0) return null;

  const showCost = typeof usage.estimatedCostUsd === 'number' && usage.estimatedCostUsd > 0;

  return (
    <div
      className={cn(
        'mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-muted-foreground/70',
        'select-none',
        className,
      )}
      data-testid="token-usage-badge"
    >
      <span className="inline-flex items-center gap-1" title={t('toolUi.tokenUsage.input', 'Input tokens')}>
        <ArrowDown className="h-3 w-3" aria-hidden />
        <NumberRoll value={usage.inputTokens} />
      </span>
      <span className="inline-flex items-center gap-1" title={t('toolUi.tokenUsage.output', 'Output tokens')}>
        <ArrowUp className="h-3 w-3" aria-hidden />
        <NumberRoll value={usage.outputTokens} />
      </span>
      {usage.cacheTokens > 0 && (
        <span className="inline-flex items-center gap-1" title={t('toolUi.tokenUsage.cache', 'Cache tokens')}>
          <Database className="h-3 w-3" aria-hidden />
          <NumberRoll value={usage.cacheTokens} />
        </span>
      )}
      <span
        className="inline-flex items-center gap-1 font-medium text-muted-foreground"
        title={t('toolUi.tokenUsage.total', 'Total tokens')}
      >
        <Coins className="h-3 w-3" aria-hidden />
        <NumberRoll value={usage.totalTokens} />
      </span>
      {showCost && (
        <span className="text-muted-foreground/60" title={t('toolUi.tokenUsage.cost', 'Estimated cost')}>
          ${usage.estimatedCostUsd!.toFixed(4)}
        </span>
      )}
    </div>
  );
});
