import { useId, type ReactNode } from 'react';
import { ChevronDown, PencilLine, Wrench } from 'lucide-react';
import { FileText, File, Search, Globe, Terminal } from '@/components/icons/codex-icons';
import { useTranslation } from 'react-i18next';
import { Shimmer } from '@/components/ai-elements/shimmer';
import { CallChip } from '@/components/tool-ui/shared/call-chip';
import { ExecutionGraphCard } from '@/pages/Chat/ExecutionGraphCard';
import { cn } from '@/lib/utils';
import type { ToolActivityGroupModel, ToolActivityKind } from '@/pages/Chat/tool-activity-groups';

const ICONS = { read: FileText, write: File, edit: PencilLine, search: Search, web: Globe, command: Terminal, other: Wrench };

export function ToolActivityIcon({ kind, reveal = false }: { kind: ToolActivityKind; reveal?: boolean }) {
  const Icon = ICONS[kind];
  return (
    <span className="tool-activity-icon" data-kind={kind} aria-hidden="true">
      <Icon strokeWidth={1.5} className="tool-activity-icon-base" />
      {reveal && <Icon strokeWidth={1.5} className="tool-activity-icon-glint" />}
    </span>
  );
}

export function ToolActivityGroup({ group, expanded, onExpandedChange, expandedStepIds, onStepExpandedChange, children }: {
  group: ToolActivityGroupModel;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  children?: ReactNode;
  expandedStepIds?: ReadonlySet<string>;
  onStepExpandedChange?: (stepId: string, expanded: boolean) => void;
}) {
  const { t, i18n } = useTranslation('chat');
  const contentId = useId();
  const current = group.current;
  const isRunning = Boolean(current) && group.isCurrent && group.status !== 'error' && group.status !== 'aborted';
  const kinds = [...new Set(group.entries.map(entry => entry.kind))];
  const completed = new Intl.ListFormat(i18n?.language, { style: 'long', type: 'conjunction' })
    .format(kinds.map(kind => t(`toolActivity.completed.${kind}`)));
  const action = current ? t(`toolActivity.running.${current.kind}`) : completed;
  const target = current?.target ?? current?.name;
  const label = group.status === 'error' ? t('toolActivity.failed', { action: group.pendingResult ? t('toolActivity.pendingResult') : action })
    : group.status === 'aborted' ? t('toolActivity.stopped') : group.pendingResult ? t('toolActivity.pendingResult') : action;
  const timing = current ? group.steps.find(step => step.id === current.id)
    ?? group.terminals.find(surface => (surface.toolCallId ?? surface.id) === current.id) : undefined;
  const chipStatus = group.status === 'error' ? 'error' : isRunning ? 'running'
    : group.status === 'completed' && !group.pendingResult ? 'done' : 'idle';

  return (
    <section
      className="tool-activity-group"
      data-testid="chat-tool-activity-group"
      data-group-id={group.id}
      data-status={group.status}
      data-expanded={expanded ? 'true' : 'false'}
      data-running={isRunning ? 'true' : 'false'}
    >
      <button
        type="button"
        className={cn('tool-activity-toggle tool-activity-strip-toggle', group.status === 'error' && 'text-destructive')}
        data-testid="chat-tool-activity-toggle"
        aria-expanded={expanded}
        aria-controls={expanded ? contentId : undefined}
        onClick={() => onExpandedChange(!expanded)}
        title={target ?? label}
      >
        <span className="tool-activity-label" data-testid="chat-tool-activity-label">
          <CallChip
            key={current?.id ?? group.id}
            name={label}
            argument={target}
            status={chipStatus}
            icon={<ToolActivityIcon kind={current?.kind ?? kinds[0] ?? 'other'} reveal={isRunning && !expanded} />}
            startedAt={timing?.startedAt}
            durationMs={timing?.durationMs}
            showTimer={isRunning && !expanded}
            className="tool-activity-call-chip"
            trailing={<ChevronDown strokeWidth={1.5} className={cn('tool-activity-chevron', expanded && 'is-expanded')} />}
          >
            {isRunning && !expanded ? <Shimmer className="tool-activity-shimmer">{label}</Shimmer> : undefined}
          </CallChip>
        </span>
      </button>
      {expanded && (
        <div id={contentId} className="tool-activity-details" data-testid="chat-tool-activity-details">
          <ExecutionGraphCard
            agentLabel={group.agentLabel}
            steps={group.steps}
            terminals={group.terminals}
            traceId={group.traceId}
            active={Boolean(current)}
            suppressThinking
            appearance="activity"
            currentToolId={isRunning ? current?.id : undefined}
            expandedStepIds={expandedStepIds}
            onStepExpandedChange={onStepExpandedChange}
            renderToolIcon={(kind, reveal) => <ToolActivityIcon kind={kind} reveal={reveal} />}
          />
          {children}
        </div>
      )}
    </section>
  );
}
