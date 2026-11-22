/**
 * Compact workspace audit surface.
 *
 * The audit tab is intentionally a single timeline. Permission decisions and
 * Git reflog entries share the same workspace context, so users can inspect a
 * change from request to repository movement without another nested panel.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Activity,
  ChevronDown,
  GitBranch,
  GitCommitHorizontal,
  RefreshCw,
  ShieldCheck,
  Check,
  Copy,
  Search,
  ShieldAlert,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { hostApi } from '@/lib/host-api';
import { useWorkspacesStore } from '@/stores/workspaces';
import type { GitReflogEntry, GitRepositoryStatus } from '@shared/types/git';
import type { PermissionApprovalEvent } from '@shared/types/workspace';
import { isExternalWriteApproval } from '@/lib/permission-approval-display';
import { useCopyToClipboard } from '@/components/tool-ui/shared/use-copy-to-clipboard';

type T = ReturnType<typeof useTranslation>['t'];
type AuditFilter = 'all' | 'approvals' | 'git' | 'pending';
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
  const [query, setQuery] = useState('');
  const [loadedWorkspace, setLoadedWorkspace] = useState<string>();
  const revision = useRef(0);

  const refreshAudit = useCallback(async () => {
    const request = ++revision.current;
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
    if (request !== revision.current || useWorkspacesStore.getState().activeWorkspace?.id !== workspaceId) return;
    setLoadedWorkspace(workspaceId);
    if (approvalResult.status === 'fulfilled' && Array.isArray(approvalResult.value?.approvals)) setApprovals(approvalResult.value.approvals);
    else { setApprovals([]); setApprovalsError(true); }
    if (statusResult.status === 'fulfilled') setRepositoryStatus(statusResult.value.status);
    else setRepositoryStatus(null);
    if (reflogResult.status === 'fulfilled' && Array.isArray(reflogResult.value?.entries)) {
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
    const owner = revision;
    queueMicrotask(() => {
      void refreshAudit();
    });
    return () => { owner.current++; };
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

  const currentItems = loadedWorkspace === workspaceId ? items : [];
  const search = query.trim().toLocaleLowerCase();
  const visibleItems = currentItems.filter(item => {
    if (filter === 'git' && item.kind !== 'git') return false;
    if (filter === 'approvals' && item.kind !== 'approval') return false;
    if (filter === 'pending' && (item.kind !== 'approval' || item.approval.status !== 'pending')) return false;
    const text = item.kind === 'git' ? `${item.entry.subject} ${item.entry.hash} ${item.entry.selector}`
      : `${sourceLabel(item.approval.source, t)} ${statusLabel(item.approval.status, t)} ${riskLabel(item.approval.risk, t)} ${isExternalWriteApproval(item.approval) ? t('approvals.externalWriteSummary') : [item.approval.command, item.approval.cwd, item.approval.paths?.join(' '), item.approval.reason].filter(Boolean).join(' ')}`;
    return text.toLocaleLowerCase().includes(search);
  });
  const currentStatus = loadedWorkspace === workspaceId ? repositoryStatus : null;
  const branch = currentStatus?.detached
    ? 'HEAD'
    : currentStatus?.branch || t(loading ? 'workspace.git.loading' : 'approvals.notRepository');
  const repositoryReady = Boolean(currentStatus?.isRepository);

  return (
    <div className="git-surface git-audit flex h-full min-h-0 flex-col bg-background" data-testid="workspace-audit-panel" aria-busy={loading}>
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
          <span className="truncate">{currentStatus && repositoryState(currentStatus, t)}</span>
          {repositoryReady && (repositoryStatus?.ahead || repositoryStatus?.behind) ? (
            <span className="shrink-0 tabular-nums">↑{repositoryStatus.ahead} ↓{repositoryStatus.behind}</span>
          ) : null}
        </div>
      </header>

      <div className="git-audit-filters shrink-0">
        <label className="git-search"><Search className="h-3.5 w-3.5 shrink-0 git-muted" aria-hidden="true" />
          <input aria-label={t('gitSurface.searchAudit')} placeholder={t('gitSurface.searchAudit')} value={query} onChange={event => setQuery(event.target.value)} data-testid="workspace-audit-search" />
          {query && <button type="button" onClick={() => setQuery('')} aria-label={t('gitSurface.clearSearch')}><X className="h-3.5 w-3.5" /></button>}
        </label>
        <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="git-segments" role="group" aria-label={t('approvals.title')}>
          {(['all', 'approvals', 'git', 'pending'] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={filter === value}
              data-testid={`workspace-audit-filter-${value}`}
              onClick={() => setFilter(value)}
            >
              {value === 'all' ? t('approvals.filterAll') : value === 'approvals' ? t('approvals.filterApprovals') : value === 'pending' ? t('approvals.status.pending') : t('approvals.filterGit')}
            </button>
          ))}
        </div>
        <span className="shrink-0 text-2xs tabular-nums text-muted-foreground">
          {t('approvals.operationCount', { count: visibleItems.length })}
        </span>
        </div>
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
        {visibleItems.length === 0 && (loading || loadedWorkspace !== workspaceId) ? (
          <p className="px-4 py-8 text-xs text-muted-foreground" role="status">{t('workspace.git.loading')}</p>
        ) : visibleItems.length === 0 && !reflogError && !approvalsError ? (
          <div className="flex min-h-32 items-center justify-center px-4 text-center text-xs text-muted-foreground">
            {search ? t('gitSurface.noMatches') : repositoryStatus && !repositoryReady ? t('approvals.notRepository') : t('approvals.timelineEmpty')}
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
  const { copiedId, copy } = useCopyToClipboard();
  const approval = item.kind === 'approval' ? item.approval : null;
  const externalWrite = approval && isExternalWriteApproval(approval);
  const tone = approval?.status === 'pending' ? 'warning' : approval?.status === 'denied' ? 'danger' : undefined;
  const Icon = item.kind === 'git' ? GitCommitHorizontal : approval?.status === 'pending' ? ShieldAlert : ShieldCheck;
  const title = item.kind === 'git' ? item.entry.subject : sourceLabel(approval!.source, t);
  const summary = item.kind === 'git' ? item.entry.shortHash + ' · ' + item.entry.selector
    : externalWrite ? t('approvals.externalWriteSummary') : approval!.command || approval!.paths?.join(', ') || approval!.reason || approval!.id;
  const details: Array<{ label: string; value: string }> = item.kind === 'git'
    ? [{ label: t('gitSurface.subject'), value: item.entry.subject }, { label: t('approvals.branch'), value: item.entry.selector }, { label: 'SHA', value: item.entry.hash }]
    : [{ label: t('approvals.riskLabel'), value: riskLabel(approval!.risk, t) }, { label: t('approvals.modeLabel'), value: modeLabel(approval!.mode, t) },
      ...(externalWrite ? [{ label: t('gitSurface.effect'), value: t('approvals.externalWriteNoRollback') }] : [
        { label: t('runtimeApprovals.commandLabel'), value: approval!.command || '' },
        { label: t('runtimeApprovals.cwdLabel'), value: approval!.cwd || '' },
        { label: t('gitSurface.paths'), value: approval!.paths?.join('\n') || '' },
        { label: t('gitSurface.reason'), value: approval!.reason || '' },
      ].filter(detail => detail.value))];
  return (
    <details className="group git-audit-row" data-testid={item.kind === 'git' ? 'workspace-audit-git-row' : 'workspace-audit-approval-row'}>
      <summary>
        <span className="git-icon" data-tone={tone}><Icon className="h-3.5 w-3.5" aria-hidden="true" /></span>
        <span className="min-w-0 flex-1">
          <span className="git-audit-title">{title}</span>
          <span className="git-audit-meta">
            {approval && <span className="git-status" data-tone={tone}>{statusLabel(approval.status, t)}</span>}
            <time>{formatAuditTime(item.timestamp, locale)}</time>
          </span>
          <span className="block truncate font-mono text-xs text-muted-foreground" title={summary}>{summary}</span>
        </span>
        <ChevronDown className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="git-detail">
        <dl>{details.map(detail => <div key={detail.label}><dt>{detail.label}</dt><dd className="font-mono">{detail.value}</dd></div>)}</dl>
        <Button variant="ghost" size="sm" className="git-audit-copy gap-1.5" onClick={() => void copy(details.map(detail => detail.label + ': ' + detail.value).join('\n'), item.id)}>
          {copiedId === item.id ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {t(copiedId === item.id ? 'toolUi.actions.copied' : 'gitSurface.copyDetails')}
        </Button>
      </div>
    </details>
  );
}

export default WorkspaceAuditPanel;
