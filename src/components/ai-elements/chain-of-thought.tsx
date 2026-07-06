import { CheckCircle2, Circle, Clock3, ExternalLink, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Collapsible } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { AiElementCard } from './card';

export type ChainOfThoughtStepStatus = 'complete' | 'active' | 'pending';

export type ChainOfThoughtStep = {
  title: string;
  description?: string;
  status?: ChainOfThoughtStepStatus;
  icon?: string;
  results?: Array<{ label: string; url?: string }>;
};

export type ChainOfThoughtProps = {
  title?: string;
  defaultOpen?: boolean;
  steps: ChainOfThoughtStep[];
};

function StepIcon({ status }: { status: ChainOfThoughtStepStatus }) {
  if (status === 'complete') return <CheckCircle2 className="h-4 w-4 text-green-700 dark:text-green-400" />;
  if (status === 'active') return <Clock3 className="h-4 w-4 text-blue-700 dark:text-blue-400" />;
  return <Circle className="h-4 w-4 text-muted-foreground/60" />;
}

export function ChainOfThought({ title, defaultOpen = true, steps }: ChainOfThoughtProps) {
  const { t } = useTranslation('chat');
  const activeCount = steps.filter((step) => (step.status ?? 'pending') === 'active').length;
  const completeCount = steps.filter((step) => (step.status ?? 'pending') === 'complete').length;

  return (
    <AiElementCard
      icon={<Search className="h-3.5 w-3.5" />}
      label={t('toolUi.chainOfThought.label', 'Reasoning steps')}
      data-testid="chat-tool-ui-chain-of-thought"
    >
      <Collapsible
        defaultOpen={defaultOpen}
        title={title ?? t('toolUi.chainOfThought.title', 'Reasoning')}
        subtitle={t('toolUi.chainOfThought.progress', '{{complete}} complete, {{active}} active', { complete: completeCount, active: activeCount })}
        className="bg-surface-input"
      >
        {steps.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t('toolUi.chainOfThought.empty', 'No reasoning steps were reported.')}</p>
        ) : (
          <ol className="space-y-3">
            {steps.map((step, index) => {
              const status = step.status ?? 'pending';
              return (
                <li key={`${step.title}-${index}`} className="relative flex gap-3" data-testid="ai-cot-step">
                  <div className="flex flex-col items-center">
                    <StepIcon status={status} />
                    {index < steps.length - 1 ? <span className="mt-1 h-full min-h-5 w-px bg-border" /> : null}
                  </div>
                  <div className="min-w-0 flex-1 pb-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <p className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{step.title}</p>
                      <span className={cn(
                        'shrink-0 rounded px-1.5 py-0.5 text-2xs',
                        status === 'complete' && 'bg-green-500/10 text-green-700 dark:text-green-400',
                        status === 'active' && 'bg-blue-500/10 text-blue-700 dark:text-blue-400',
                        status === 'pending' && 'bg-muted text-muted-foreground',
                      )}>
                        {t(`toolUi.chainOfThought.status.${status}`, status)}
                      </span>
                    </div>
                    {step.description ? <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">{step.description}</p> : null}
                    {step.results?.length ? (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {step.results.map((result, resultIndex) => (
                          result.url ? (
                            <a
                              key={`${result.label}-${resultIndex}`}
                              href={result.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex max-w-full items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
                            >
                              <span className="truncate">{result.label}</span>
                              <ExternalLink className="h-3 w-3 shrink-0" />
                            </a>
                          ) : (
                            <span key={`${result.label}-${resultIndex}`} className="inline-flex max-w-full rounded-md border border-border bg-background px-2 py-1 text-xs text-muted-foreground">
                              <span className="truncate">{result.label}</span>
                            </span>
                          )
                        ))}
                      </div>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </Collapsible>
    </AiElementCard>
  );
}
