import type { ReactNode } from 'react';
import { BrainCircuit } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Collapsible } from '@/components/ui/collapsible';
import { AiElementCard } from './card';
import { Shimmer, ShimmerBlock } from './shimmer';

type ReasoningProps = {
  title?: string;
  summary?: string;
  loading?: boolean;
  defaultOpen?: boolean;
  children?: ReactNode;
};

export function Reasoning({ title, summary, loading = false, defaultOpen = false, children }: ReasoningProps) {
  const { t } = useTranslation('chat');
  const label = title ?? t('toolUi.reasoning.label', 'Reasoning');

  return (
    <AiElementCard
      icon={<BrainCircuit className="h-3.5 w-3.5" />}
      label={t('toolUi.reasoning.label', 'Reasoning')}
      data-testid="chat-tool-ui-reasoning"
    >
      <Collapsible
        defaultOpen={defaultOpen || loading}
        title={loading ? <Shimmer>{t('toolUi.reasoning.thinking', 'Thinking')}</Shimmer> : label}
        subtitle={summary}
        className="bg-surface-input"
        contentClassName="space-y-2"
      >
        {loading ? (
          <div className="space-y-2">
            <ShimmerBlock className="h-3 w-2/3" />
            <ShimmerBlock className="h-3 w-11/12" />
            <ShimmerBlock className="h-3 w-1/2" />
          </div>
        ) : (
          <div className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
            {children ?? summary ?? t('toolUi.reasoning.empty', 'No reasoning summary was provided.')}
          </div>
        )}
      </Collapsible>
    </AiElementCard>
  );
}
