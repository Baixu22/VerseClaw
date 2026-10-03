/**
 * Compact workspace audit surface.
 *
 * The audit tab is intentionally a single timeline. Permission decisions and
 * Git reflog entries share the same workspace context, so users can inspect a
 * change from request to repository movement without another nested panel.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Activity,
  ChevronDown,
  GitBranch,
  GitCommitHorizontal,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { hostApi } from '@/lib/host-api';
import { useWorkspacesStore } from '@/stores/workspaces';
import type { GitReflogEntry, GitRepositoryStatus } from '@shared/types/git';
import type { PermissionApprovalEvent } from '@shared/types/workspace';
import { isExternalWriteApproval } from '@/lib/permission-approval-display';

type T = ReturnType<typeof useTranslation>['t'];
type AuditFilter = 'all' | 'approvals' | 'git';
type AuditItem =
  | { kind: 'approval'; id: string; timestamp: number; approval: PermissionApprovalEvent }
  | { kind: 'git'; id: string; timestamp: number; entry: GitReflogEntry };

function modeLabel(mode: string | undefined, t: T): string {
  switch (mode) {
    case 'readOnly': return t('approvals.mode.readOnly');
    case 'acceptEdits': return t('approvals.mode.acceptEdits');
    case 'plan': return t('approvals.mode.plan');
    case 'fullAccess': return t('approvals.mode.fullAccess');
    default: return t('approvals.mode.acceptEdits');
  }
}

function sourceLabel(source: PermissionApprovalEvent['source'], t: T): string {
  switch (source) {
    case 'terminal': return t('approvals.source.terminal');
    case 'gateway': return t('approvals.source.gateway');
    case 'mcp': return t('approvals.source.mcp');
    case 'file': return t('approvals.source.file');
    case 'remoteControl': return t('approvals.source.remoteControl');
    case 'git': return t('approvals.source.git');
    case 'cleaner': return t('approvals.source.cleaner');
    default: return source;
  }
}

function riskLabel(risk: PermissionApprovalEvent['risk'], t: T): string {
  switch (risk) {
    case 'write': return t('approvals.risk.write');
    case 'network': return t('approvals.risk.network');
    case 'external-write': return t('approvals.risk.external-write');
    case 'destructive': return t('approvals.risk.destructive');
    case 'dangerous': return t('approvals.risk.dangerous');
    default: return risk;
  }
}

function statusLabel(status: PermissionApprovalEvent['status'], t: T): string {
  switch (status) {
    case 'pending': return t('approvals.status.pending');
    case 'approved': return t('approvals.status.approved');
    case 'denied': return t('approvals.status.denied');
    case 'expired': return t('approvals.status.expired');
    default: return status;
  }
}

function formatAuditTime(value: number | undefined, locale: string): string {
  if (!value) return '';
  return new Date(value).toLocaleString(locale, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function repositoryState(status: GitRepositoryStatus | null, t: T): string {
  if (!status?.isRepository) return t('approvals.notRepository');
  if (status.hasConflicts) return t('approvals.conflicts', { count: status.conflictedCount });
  if (status.clean) return t('approvals.clean');
  return t('approvals.dirty', { count: status.changes.length });
}

export function WorkspaceAuditPanel() {
  const { t, i18n } = useTranslation('chat');
  const activeWorkspace = useWorkspacesStore((s) => s.activeWorkspace);
  const workspaceId = activeWorkspace?.id;
  const [approvals, setApprovals] = useState<PermissionApprovalEvent[]>([]);
  const [reflog, setReflog] = useState<GitReflogEntry[]>([]);
  const [repositoryStatus, setRepositoryStatus] = useState<GitRepositoryStatus | null>(null);
  const [filter, setFilter] = useState<AuditFilter>('all');
  const [loading, setLoading] = useState(false);
  const [reflogError, setReflogError] = useState(false);
  const [approvalsError, setApprovalsError] = useState(false);
  const [truncated, setTruncated] = useState(false);

  const refreshAudit = useCallback(async () => {
    if (!workspaceId) {
      setApprovals([]);
      setReflog([]);
      setRepositoryStatus(null);
      setReflogError(false);
      setApprovalsError(false);
      setTruncated(false);
      return;
    }
    setLoading(true);
    setReflogError(false);
    setApprovalsError(false);
    const [approvalResult, statusResult, reflogResult] = await Promise.allSettled([
      hostApi.permissions.approvals({ workspaceId, includeExpired: true, limit: 200 }),
      hostApi.git.status(),
      hostApi.git.reflog({ limit: 300 }),
    ]);
    if (approvalResult.status === 'fulfilled') setApprovals(approvalResult.value.approvals);
    else { setApprovals([]); setApprovalsError(true); }
    if (statusResult.status === 'fulfilled') setRepositoryStatus(statusResult.value.status);
    else setRepositoryStatus(null);
    if (reflogResult.status === 'fulfilled') {
      setReflog(reflogResult.value.entries);
      setReflogError(false);
      setTruncated(reflogResult.value.truncated === true);
    } else {
      setReflog([]);
      setReflogError(true);
      setTruncated(false);
    }
    setLoading(false);
  }, [workspaceId]);

  useEffect(() => {
    queueMicrotask(() => {
      void refreshAudit();
    });
  }, [refreshAudit]);

  const items = useMemo<AuditItem[]>(() => [
    ...approvals.map((approval) => ({
      kind: 'approval' as const,
      id: `approval:${approval.id}`,
      timestamp: approval.resolvedAt ?? approval.requestedAt,
      approval,
    })),
    ...reflog.map((entry, index) => ({
      kind: 'git' as const,
      id: `git:${entry.hash}:${entry.selector}:${index}`,
      timestamp: entry.date ?? 0,
      entry,
    })),
  ].sort((left, right) => right.timestamp - left.timestamp), [approvals, reflog]);

  const visibleItems = filter === 'all'
    ? items
    : items.filter((item) => item.kind === (filter === 'git' ? 'git' : 'approval'));
  const branch = repositoryStatus?.detached
    ? 'HEAD'
    : repositoryStatus?.branch || t('approvals.notRepository');
  const repositoryReady = Boolean(repositoryStatus?.isRepository);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background" data-testid="workspace-audit-panel">
      <header className="shrink-0 border-b border-black/[0.07] px-3 py-2 dark:border-white/[0.09]">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <Activity className="h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">{t('approvals.title')}</p>
              <p className="truncate text-2xs text-muted-foreground">{activeWorkspace?.name || t('approvals.repository')}</p>
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            onClick={() => void refreshAudit()}
            disabled={loading}
            title={t('common:actions.refresh')}
            aria-label={t('common:actions.refresh')}
          >
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
          </Button>
        </div>
        <div className="mt-2 flex min-w-0 items-center gap-2 text-2xs text-muted-foreground">
          <span className="inline-flex min-w-0 items-center gap-1.5 truncate font-mono text-foreground">
            <GitBranch className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            {branch}
          </span>
          <span className="truncate">{repositoryState(repositoryStatus, t)}</span>
          {repositoryReady && (repositoryStatus?.ahead || repositoryStatus?.behind) ? (
            <span className="shrink-0 tabular-nums">↑{repositoryStatus.ahead} ↓{repositoryStatus.behind}</span>
          ) : null}
        </div>
      </header>

      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-black/[0.07] px-3 py-2 dark:border-white/[0.09]">
        <div className="inline-flex min-w-0 items-center rounded-md bg-surface-input p-0.5" role="tablist" aria-label={t('approvals.title')}>
          {(['all', 'approvals', 'git'] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={filter === value}
              data-testid={`workspace-audit-filter-${value}`}
              className={cn(
                'h-6 rounded px-2.5 text-2xs text-muted-foreground transition-colors',
                filter === value && 'bg-background text-foreground shadow-sm dark:bg-white/10',
              )}
              onClick={() => setFilter(value)}
            >
              {value === 'all' ? t('approvals.filterAll') : value === 'approvals' ? t('approvals.filterApprovals') : t('approvals.filterGit')}
            </button>
          ))}
        </div>
        <span className="shrink-0 text-2xs tabular-nums text-muted-foreground">
          {t('approvals.operationCount', { count: visibleItems.length })}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="border-b border-black/[0.07] px-3 py-2 dark:border-white/[0.09]">
          <p className="text-xs font-medium text-foreground">{t('approvals.timeline')}</p>
          <p className="mt-0.5 text-2xs text-muted-foreground">{t('approvals.timelineDescription')}</p>
        </div>
        {(reflogError || approvalsError) ? (
          <div className="border-b border-black/[0.07] px-3 py-1.5 text-2xs text-amber-700 dark:border-white/[0.09] dark:text-amber-400">
            {reflogError && approvalsError
              ? t('approvals.timelineUnavailable')
              : reflogError ? t('approvals.reflogUnavailable') : t('approvals.approvalsUnavailable')}
            {' · '}
            {t('approvals.partialFailure')}
          </div>
        ) : null}
        {truncated ? (
          <p className="border-b border-black/[0.07] px-3 py-1.5 text-2xs text-muted-foreground dark:border-white/[0.09]">
            {t('approvals.truncated')}
          </p>
        ) : null}
        {visibleItems.length === 0 && !loading && !reflogError && !approvalsError ? (
          <div className="flex min-h-32 items-center justify-center px-4 text-center text-xs text-muted-foreground">
            {loading ? t('workspace.git.loading') : repositoryStatus && !repositoryReady ? t('approvals.notRepository') : t('approvals.timelineEmpty')}
          </div>
        ) : (
          <div className="divide-y divide-black/[0.07] dark:divide-white/[0.09]">
            {visibleItems.map((item) => (
              <AuditRow key={item.id} item={item} locale={i18n.language} t={t} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AuditRow({ item, locale, t }: { item: AuditItem; locale: string; t: T }) {
  if (item.kind === 'git') {
    return (
      <details className="group px-3 py-2.5" data-testid="workspace-audit-git-row">
        <summary className="flex cursor-pointer list-none items-start gap-2 outline-none">
          <GitCommitHorizontal className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1">
            <span className="flex items-start justify-between gap-2">
              <span className="min-w-0 truncate text-xs text-foreground" title={item.entry.subject}>{item.entry.subject}</span>
              <span className="shrink-0 text-2xs tabular-nums text-muted-foreground">{formatAuditTime(item.entry.date, locale)}</span>
            </span>
            <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-2xs text-muted-foreground">
              <span className="font-mono">{item.entry.shortHash}</span>
              <span className="truncate">{item.entry.selector}</span>
            </span>
          </span>
          <ChevronDown className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
        </summary>
        <div className="ml-5 mt-2 grid gap-1 border-l border-black/10 pl-2.5 text-2xs text-muted-foreground dark:border-white/10">
          <p><span className="text-foreground">{t('approvals.branch')}:</span> {item.entry.selector}</p>
          <p className="break-all font-mono"><span className="font-sans text-foreground">SHA:</span> {item.entry.hash}</p>
        </div>
      </details>
    );
  }

  const approval = item.approval;
  const externalWrite = isExternalWriteApproval(approval);
  return (
    <details className="group px-3 py-2.5" data-testid="workspace-audit-approval-row">
      <summary className="flex cursor-pointer list-none items-start gap-2 outline-none">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <span className="flex items-start justify-between gap-2">
            <span className="min-w-0 truncate text-xs text-foreground">{sourceLabel(approval.source, t)}</span>
            <Badge variant={approval.status === 'pending' ? 'warning' : 'outline'} className="shrink-0 px-1.5 py-0 text-2xs">
              {statusLabel(approval.status, t)}
            </Badge>
          </span>
          <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-2xs text-muted-foreground">
            <span className="truncate font-mono">{externalWrite ? t('approvals.externalWriteSummary') : approval.command || approval.paths?.join(', ') || approval.reason || approval.id}</span>
            <span className="shrink-0">{formatAuditTime(item.timestamp, locale)}</span>
          </span>
        </span>
        <ChevronDown className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="ml-5 mt-2 grid gap-1 border-l border-black/10 pl-2.5 text-2xs text-muted-foreground dark:border-white/10">
        <p><span className="text-foreground">{t('approvals.riskLabel')}:</span> {riskLabel(approval.risk, t)}</p>
        <p><span className="text-foreground">{t('approvals.modeLabel')}:</span> {modeLabel(approval.mode, t)}</p>
        {externalWrite ? <p>{t('approvals.externalWriteNoRollback')}</p> : null}
        {!externalWrite && approval.cwd ? <p className="truncate font-mono">{approval.cwd}</p> : null}
        {!externalWrite && approval.paths?.length ? <p className="break-words font-mono">{approval.paths.join(', ')}</p> : null}
        {!externalWrite && approval.reason ? <p>{approval.reason}</p> : null}
      </div>
    </details>
  );
}

export default WorkspaceAuditPanel;
