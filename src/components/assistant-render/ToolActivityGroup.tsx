import { useId, type ReactNode } from 'react';
import { Archive, Bot, BrainCircuit, Camera, ChevronDown, Database, Download, FileCode2, FileCog, FilePenLine, FilePlus2, FileText, FileType2, FlaskConical, FolderOpen, GitBranch, GitCommitHorizontal, GitCompareArrows, GitMerge, Globe, Hammer, Image, ImagePlus, ListTodo, Mouse, MousePointerClick, Network, Package, Presentation, Search, Table2, Terminal, Trash2, Upload, Wrench } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Shimmer } from '@/components/ai-elements/shimmer';
import { ExecutionGraphCard } from '@/pages/Chat/ExecutionGraphCard';
import { cn } from '@/lib/utils';
import type { ToolActivityGroupModel, ToolActivityKind, ToolActivityIconId } from '@/pages/Chat/tool-activity-groups';

const ICONS = { read: FileText, write: FilePlus2, edit: FilePenLine, search: Search, web: Globe, command: Terminal, other: Wrench,
  folder: FolderOpen, code: FileCode2, image: Image, pdf: FileType2, table: Table2, config: FileCog,
  'browser-click': MousePointerClick, 'browser-screenshot': Camera, 'browser-scroll': Mouse,
  git: GitBranch, 'git-diff': GitCompareArrows, 'git-commit': GitCommitHorizontal, 'git-merge': GitMerge,
  test: FlaskConical, build: Hammer, package: Package, network: Network, database: Database,
  memory: BrainCircuit, agent: Bot, plan: ListTodo, 'generate-image': ImagePlus, presentation: Presentation,
  download: Download, upload: Upload, archive: Archive, delete: Trash2 };

export function ToolActivityIcon({ kind, iconId = kind, animated = false }: { kind: ToolActivityKind; iconId?: ToolActivityIconId; animated?: boolean }) {
  const Icon = ICONS[iconId];
  return (
    <span className="tool-activity-icon" data-kind={kind} data-icon={iconId} data-animated={animated ? 'true' : 'false'} aria-hidden="true">
      <Icon strokeWidth={1.5} className="tool-activity-icon-base" />
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
  const active = Boolean(current) && group.status === 'running';
  const isRunning = active && Boolean(group.isCurrent);
  const kinds = [...new Set(group.entries.map(entry => entry.kind))];
  const completed = new Intl.ListFormat(i18n?.language, { style: 'long', type: 'conjunction' })
    .format(kinds.map(kind => t(`toolActivity.completed.${kind}`)));
  const action = current ? t(`toolActivity.running.${current.kind}`) : completed;
  const target = current?.target ?? current?.name;
  const label = group.status === 'error' ? t('toolActivity.failed', { action: group.pendingResult ? t('toolActivity.pendingResult') : action })
    : group.status === 'aborted' ? t('toolActivity.stopped') : group.pendingResult ? t('toolActivity.pendingResult') : action;
  const summaryText = target ? `${label} ${target}` : label;
  const summaryEntry = current ?? group.entries[0];

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
        className={cn('tool-activity-toggle', group.status === 'error' && 'text-destructive')}
        data-testid="chat-tool-activity-toggle"
        aria-expanded={expanded}
        aria-controls={expanded ? contentId : undefined}
        onClick={() => onExpandedChange(!expanded)}
        title={target ?? label}
      >
        <ToolActivityIcon key={isRunning && !expanded ? current?.id : 'idle'} kind={summaryEntry?.kind ?? 'other'} iconId={summaryEntry?.iconId} animated={isRunning && !expanded} />
        <span className="tool-activity-label" data-testid="chat-tool-activity-label">
          {isRunning && !expanded ? <span key={current?.id} className="tool-activity-text-enter" data-testid="chat-tool-activity-text-enter" data-tool-id={current?.id}>
            <Shimmer className="tool-activity-shimmer">{summaryText}</Shimmer>
          </span> : <span>{summaryText}</span>}
        </span>
        <ChevronDown strokeWidth={1.5} className={cn('tool-activity-chevron', expanded && 'is-expanded')} />
      </button>
      {expanded && (
        <div id={contentId} className="tool-activity-details" data-testid="chat-tool-activity-details">
          <ExecutionGraphCard
            agentLabel={group.agentLabel}
            steps={group.steps}
            terminals={group.terminals}
            traceId={group.traceId}
            active={active}
            suppressThinking
            appearance="activity"
            currentToolId={isRunning ? current?.id : undefined}
            expandedStepIds={expandedStepIds}
            onStepExpandedChange={onStepExpandedChange}
            renderToolIcon={(kind, _reveal, iconId) => <ToolActivityIcon kind={kind} iconId={iconId} />}
          />
          {children}
        </div>
      )}
    </section>
  );
}
