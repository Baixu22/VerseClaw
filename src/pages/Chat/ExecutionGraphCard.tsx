import { Activity, ChevronRight, GitBranch, Link as LinkIcon, Wrench, XCircle } from 'lucide-react';
import { MessageSquare } from '@/components/icons/codex-icons';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { OrbStatus } from '@/components/assistant-ui/orb-status';
import { Shimmer } from '@/components/ai-elements/shimmer';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { TaskStep } from './task-visualization';

interface ExecutionGraphCardProps {
  agentLabel: string;
  steps: TaskStep[];
  active: boolean;
  suppressThinking?: boolean;
  traceId?: string;
  expandedStepIds?: ReadonlySet<string>;
  onStepExpandedChange?: (stepId: string, expanded: boolean) => void;
}

const TOOL_ROW_EXTRA_INDENT_PX = 8;

function StepDetailRow({
  step,
  expanded: controlledExpanded,
  onExpandedChange,
}: {
  step: TaskStep;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
}) {
  const { t } = useTranslation('chat');
  const [localExpanded, setLocalExpanded] = useState(false);
  const expanded = controlledExpanded ?? localExpanded;
  const hasDetail = Boolean(step.detail);
  const isNarration = step.kind === 'message';
  const isTool = step.kind === 'tool';
  const isSystem = step.kind === 'system';
  const displayToolLabel = isTool && step.label === 'image_generate'
    ? t('executionGraph.imageGenerateLabel')
    : step.label;
  const displayLabel = displayToolLabel;
  const detailPreview = step.detail?.replace(/\s+/g, ' ').trim();
  const summary = isNarration && detailPreview ? detailPreview : displayLabel;
  const showRunning = step.status === 'running' && (isTool || isSystem);
  const showError = step.status === 'error';

  let formattedDetail = step.detail;
  if (formattedDetail && (isTool || isSystem)) {
    try {
      formattedDetail = JSON.stringify(JSON.parse(formattedDetail), null, 2);
    } catch {
      // Keep non-JSON tool and system details unchanged.
    }
  }

  const toggleExpanded = () => {
    if (!hasDetail) return;
    const nextExpanded = !expanded;
    if (controlledExpanded === undefined) setLocalExpanded(nextExpanded);
    onExpandedChange?.(nextExpanded);
  };

  return (
    <div className="group/execution-step min-w-0 flex-1">
      <div className="relative flex min-w-0 items-start gap-1.5">
        <button
          type="button"
          className={cn(
            'flex min-w-0 flex-1 items-start gap-1.5 rounded-sm text-left text-sm leading-6',
            'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1',
            hasDetail ? 'cursor-pointer hover:text-foreground' : 'cursor-default',
          )}
          onClick={toggleExpanded}
          aria-expanded={hasDetail ? expanded : undefined}
          data-testid="chat-execution-step-toggle"
        >
          <span className={cn(
            'min-w-0 truncate text-muted-foreground',
            showError && 'text-destructive',
            !isNarration && 'font-medium',
          )}>
            {summary}
          </span>
          {!expanded && !isNarration && detailPreview && (
            <span className="min-w-0 flex-1 truncate text-xs font-normal text-muted-foreground/75">
              {detailPreview}
            </span>
          )}
          {showRunning && (
            <OrbStatus state="syncing" label={displayLabel} className="mt-1 size-3.5 shrink-0 text-primary" />
          )}
          {showError && (
            <span className="shrink-0 whitespace-nowrap text-xs font-normal text-destructive">
              {t('taskPanel.stepStatus.error')}
            </span>
          )}
          {hasDetail && (
            <ChevronRight
              className={cn(
                'mt-1 h-3.5 w-3.5 shrink-0 opacity-0 transition-[transform,opacity] duration-150',
                'group-hover/execution-step:opacity-100 group-focus-within/execution-step:opacity-100',
                expanded && 'rotate-90 opacity-100',
              )}
              aria-hidden="true"
            />
          )}
        </button>
        {isTool && step.label === 'web_fetch' && step.url && (
          <a
            href={step.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 shrink-0 rounded-sm text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring group-hover/execution-step:opacity-100"
            title={step.url}
            data-agent-activity-file-link
          >
            <LinkIcon className="h-3.5 w-3.5" />
          </a>
        )}
      </div>
      {formattedDetail && expanded && (
        <div className="mt-1 border-l border-border/70 pl-3" data-testid="chat-execution-step-detail">
          <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-5 text-muted-foreground/80">
            {formattedDetail}
          </pre>
        </div>
      )}
    </div>
  );
}

function StepIcon({ step }: { step: TaskStep }) {
  if (step.status === 'error') return <XCircle className="h-3.5 w-3.5 text-destructive" />;
  if (step.kind === 'tool') return <Wrench className="h-3.5 w-3.5" />;
  if (step.kind === 'message') return <MessageSquare className="h-3.5 w-3.5" />;
  return <GitBranch className="h-3.5 w-3.5" />;
}

export function ExecutionGraphCard({
  agentLabel,
  steps,
  active,
  suppressThinking = false,
  traceId,
  expandedStepIds,
  onStepExpandedChange,
}: ExecutionGraphCardProps) {
  const { t } = useTranslation('chat');
  const shouldShowTrailingThinking = active && !suppressThinking;
  const traceHref = traceId ? `#/observability?traceId=${encodeURIComponent(traceId)}` : null;

  // A run whose rows were all promoted to rich cards (a plan-only or
  // command-only turn) has nothing left to draw. Rendering anyway leaves a bare
  // "Main execution" header with an empty tree under it. The sibling surfaces
  // — RunTerminalSurfaces, RunMutationDiffs, PendingRunApprovals — all guard
  // their empty state; this was the one that did not.
  //
  // The trailing thinking shimmer is real content, so an active run without
  // steps yet still renders.
  if (steps.length === 0 && !shouldShowTrailingThinking) return null;

  return (
    <div
      data-testid="chat-execution-graph"
      data-collapsed="false"
      className="w-full min-w-0 text-muted-foreground"
    >
      <div className="group/execution-header flex min-w-0 items-center gap-1.5 py-0.5">
        <GitBranch className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {t('executionGraph.agentRun', { agent: agentLabel })}
        </span>
        {traceHref && (
          <Button asChild variant="ghost" size="icon" className="h-6 w-6 shrink-0 opacity-0 transition-opacity group-hover/execution-header:opacity-100 focus-within:opacity-100">
            <a
              href={traceHref}
              aria-label={t('executionGraph.viewTrace')}
              title={t('executionGraph.viewTrace')}
              data-testid="chat-view-trace-link"
            >
              <Activity className="h-3.5 w-3.5" />
            </a>
          </Button>
        )}
      </div>

      <div className="mt-0.5">
        {steps.map((step) => {
          const alignedIndentOffset = (
            step.kind === 'tool'
            || step.kind === 'message'
          ) ? TOOL_ROW_EXTRA_INDENT_PX : 0;
          const rowMarginLeft = (Math.max(step.depth - 1, 0) * 24) + alignedIndentOffset;
          return (
            <div key={step.id} className="relative mt-0.5">
              <div
                className="flex min-w-0 items-start gap-1.5"
                data-testid="chat-execution-step"
                style={{ marginLeft: `${rowMarginLeft}px` }}
              >
                <div className="relative flex h-6 w-5 shrink-0 items-center justify-center text-muted-foreground">
                  {step.depth > 1 && (
                    <div className="absolute -left-3 top-1/2 h-px w-3 -translate-y-1/2 bg-border/70" />
                  )}
                  <StepIcon step={step} />
                </div>
                <StepDetailRow
                  step={step}
                  expanded={expandedStepIds?.has(step.id)}
                  onExpandedChange={(expanded) => onStepExpandedChange?.(step.id, expanded)}
                />
              </div>
            </div>
          );
        })}
        {shouldShowTrailingThinking && (
          <div
            className="mt-0.5 flex min-w-0 items-center gap-1.5"
            data-testid="chat-execution-step-thinking-trailing"
            style={{ marginLeft: `${TOOL_ROW_EXTRA_INDENT_PX}px` }}
          >
            <div className="h-6 w-5 shrink-0" />
            <Shimmer className="min-w-0 truncate text-sm font-medium">
              {t('executionGraph.thinkingLabel')}
            </Shimmer>
          </div>
        )}
      </div>
    </div>
  );
}
