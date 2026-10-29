import { Activity, ChevronRight, GitBranch, Link as LinkIcon, Wrench, XCircle } from 'lucide-react';
import { MessageSquare } from '@/components/icons/codex-icons';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { OrbStatus } from '@/components/assistant-ui/orb-status';
import { Shimmer } from '@/components/ai-elements/shimmer';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { TaskStep } from './task-visualization';
import { CallChip, inferCallChipIcon } from '@/components/tool-ui/shared/call-chip';

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
  const detailId = useId();
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
  let detailPreview = step.detail?.replace(/\s+/g, ' ').trim();
  const summary = isNarration && detailPreview ? detailPreview : displayLabel;
  const showRunning = step.status === 'running' && (isTool || isSystem);
  const showError = step.status === 'error';

  let formattedDetail = step.detail;
  if (formattedDetail && (isTool || isSystem)) {
    try {
      const parsed: unknown = JSON.parse(formattedDetail);
      formattedDetail = JSON.stringify(parsed, null, 2);
      if (isTool && parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const input = parsed as Record<string, unknown>;
        const target = ['file_path', 'filePath', 'path', 'command', 'cmd', 'pattern', 'query', 'url']
          .map((key) => input[key])
          .find((value): value is string => typeof value === 'string' && value.trim().length > 0);
        detailPreview = target?.replace(/\s+/g, ' ').trim();
      }
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

  const statusLabel = step.status === 'error'
    ? t('taskPanel.stepStatus.error')
    : step.status === 'running'
      ? t('taskPanel.stepStatus.running')
      : t('taskPanel.stepStatus.completed');
  const chipStatus = step.status === 'error'
    ? 'error' as const
    : step.status === 'running'
      ? 'running' as const
      : 'done' as const;

  const detail = formattedDetail && expanded ? (
    <div
      id={detailId}
      role="region"
      aria-label={displayLabel}
      tabIndex={0}
      className="mt-1 max-h-72 overflow-auto rounded-r-md border-l border-border/70 bg-surface-input px-3 py-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      data-testid="chat-execution-step-detail"
    >
      <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-5 text-foreground/85 [overflow-wrap:anywhere]">
        {formattedDetail}
      </pre>
    </div>
  ) : null;

  const riskBadge = step.risk === 'external-write' ? (
    <span
      className="mt-1.5 shrink-0 whitespace-nowrap rounded-md bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-medium leading-4 text-amber-700 dark:text-amber-400"
      data-testid="chat-execution-step-external-write"
      title={t('approvals.externalWriteNoRollback')}
    >
      {t('approvals.risk.externalWrite')}
    </span>
  ) : null;

  const urlLink = step.url ? (
    <a
      href={step.url}
      target="_blank"
      rel="noreferrer"
      className="mt-1.5 shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring group-hover/execution-step:opacity-100"
      title={step.url}
      data-agent-activity-file-link
    >
      <LinkIcon className="h-3.5 w-3.5" />
    </a>
  ) : null;

  if (isTool) {
    return (
      <div className="group/execution-step min-w-0 flex-1">
        <div className="relative flex min-w-0 items-start gap-1.5">
          <button
            type="button"
            className={cn(
              'inline-flex min-w-0 max-w-full rounded-lg text-left',
              'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1',
              hasDetail ? 'cursor-pointer' : 'cursor-default',
            )}
            onClick={toggleExpanded}
            aria-expanded={hasDetail ? expanded : undefined}
            aria-controls={hasDetail ? detailId : undefined}
            aria-label={`${displayLabel}${detailPreview ? `, ${detailPreview}` : ''}, ${statusLabel}`}
            data-testid="chat-execution-step-toggle"
          >
            <CallChip
              name={displayLabel}
              argument={detailPreview}
              status={chipStatus}
              icon={inferCallChipIcon(displayLabel)}
              startedAt={step.startedAt}
              durationMs={step.durationMs}
              statusLabel={statusLabel}
              trailing={<ChevronRight className={cn('h-3.5 w-3.5 text-muted-foreground/60 transition-transform', expanded && 'rotate-90')} />}
            />
          </button>
          {riskBadge}
          {urlLink}
        </div>
        {detail}
      </div>
    );
  }

  return (
    <div className="group/execution-step min-w-0 flex-1">
      <div className="relative flex min-w-0 items-start gap-1.5">
        <button
          type="button"
          className={cn(
            'flex min-w-0 flex-1 items-start gap-2 rounded-md px-1.5 py-1 text-left text-sm leading-5',
            'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1',
            hasDetail ? 'cursor-pointer hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10' : 'cursor-default',
          )}
          onClick={toggleExpanded}
          aria-expanded={hasDetail ? expanded : undefined}
          aria-controls={hasDetail ? detailId : undefined}
          aria-label={`${displayLabel}${detailPreview ? `, ${detailPreview}` : ''}`}
          data-testid="chat-execution-step-toggle"
        >
          <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
            <span className={cn(
              'min-w-0 truncate',
              showError ? 'text-destructive' : 'text-foreground/80',
              !isNarration && 'font-medium',
            )}>
              {summary}
            </span>
            {!expanded && !isNarration && detailPreview && (
              <span className="min-w-0 flex-1 basis-32 truncate font-mono text-xs font-normal text-muted-foreground" title={detailPreview}>
                {detailPreview}
              </span>
            )}
          </span>
          {showRunning && (
            <OrbStatus state="syncing" label={displayLabel} className="mt-1 size-3.5 shrink-0 text-primary" />
          )}
          {showError && (
            <span className="shrink-0 whitespace-nowrap text-xs font-normal text-destructive">
              {t('taskPanel.stepStatus.error')}
            </span>
          )}
        </button>
        {riskBadge}
        {urlLink}
      </div>
      {detail}
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
        <span className="min-w-0 flex-1 truncate text-xs font-medium">
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
                {step.kind === 'tool' ? (
                  step.depth > 1 ? (
                    <div className="mt-3 h-px w-3 shrink-0 bg-border/70" aria-hidden="true" />
                  ) : null
                ) : (
                  <div className="relative flex h-6 w-5 shrink-0 items-center justify-center text-muted-foreground">
                    {step.depth > 1 && (
                      <div className="absolute -left-3 top-1/2 h-px w-3 -translate-y-1/2 bg-border/70" />
                    )}
                    <StepIcon step={step} />
                  </div>
                )}
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
