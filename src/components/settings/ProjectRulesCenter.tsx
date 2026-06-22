import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  FolderOpen,
  Plus,
  RefreshCw,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type {
  ProjectRulesContextPreviewItem,
  ProjectRulesIssue,
  ProjectRulesSnapshotResult,
} from '@shared/host-api/contract';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { hostApi } from '@/lib/host-api';
import { toUserMessage } from '@/lib/error-message';
import { cn } from '@/lib/utils';

function issueTone(issue: ProjectRulesIssue): string {
  if (issue.severity === 'error') return 'border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-300';
  if (issue.severity === 'warning') return 'border-amber-500/20 bg-amber-500/10 text-amber-900 dark:text-amber-200';
  return 'border-blue-500/20 bg-blue-500/10 text-blue-800 dark:text-blue-200';
}

function statusTone(status: string): string {
  if (status === 'present' || status === 'included') return 'text-green-700 dark:text-green-400';
  if (status === 'missing' || status === 'empty' || status === 'tooLarge') return 'text-amber-700 dark:text-amber-400';
  if (status === 'unreadable') return 'text-red-700 dark:text-red-400';
  return 'text-muted-foreground';
}

function contextStatusVariant(status: ProjectRulesContextPreviewItem['status']) {
  return status === 'included' ? 'secondary' : 'outline';
}

export function ProjectRulesCenter() {
  const { t } = useTranslation('settings');
  const [snapshot, setSnapshot] = useState<ProjectRulesSnapshotResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setSnapshot(await hostApi.projectRules.snapshot());
    } catch (error) {
      toast.error(t('projectRules.toast.loadFailed', { error: toUserMessage(error) }));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const createTemplate = async () => {
    setCreating(true);
    try {
      const result = await hostApi.projectRules.createAgentsTemplate();
      setSnapshot(result);
      toast.success(result.templateCreated
        ? t('projectRules.toast.created')
        : t('projectRules.toast.alreadyPresent'));
    } catch (error) {
      toast.error(t('projectRules.toast.createFailed', { error: toUserMessage(error) }));
    } finally {
      setCreating(false);
    }
  };

  const issueCounts = useMemo(() => {
    const issues = snapshot?.issues ?? [];
    return {
      errors: issues.filter((issue) => issue.severity === 'error').length,
      warnings: issues.filter((issue) => issue.severity === 'warning').length,
      info: issues.filter((issue) => issue.severity === 'info').length,
    };
  }, [snapshot]);

  const healthLabel = issueCounts.errors > 0
    ? t('projectRules.health.errors', { count: issueCounts.errors })
    : issueCounts.warnings > 0
      ? t('projectRules.health.warnings', { count: issueCounts.warnings })
      : t('projectRules.health.ready');

  return (
    <div
      data-testid="settings-project-rules-center"
      className="space-y-5 rounded-2xl border border-black/10 bg-black/[0.03] p-5 dark:border-white/10 dark:bg-white/[0.04]"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <FileText className="h-4 w-4 text-foreground/70" />
            <Label className="text-sm font-medium text-foreground">{t('projectRules.title')}</Label>
            <Badge variant="outline" className="rounded-full">
              {healthLabel}
            </Badge>
          </div>
          <p className="mt-1 max-w-2xl text-meta text-muted-foreground">
            {t('projectRules.description')}
          </p>
          <p className="mt-2 truncate font-mono text-tiny text-muted-foreground">
            {snapshot?.workspace?.rootPath ?? t('projectRules.noWorkspace')}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => void refresh()}
            disabled={loading}
            data-testid="project-rules-refresh"
            className="h-9 rounded-xl border-black/10 bg-transparent px-4 dark:border-white/10"
          >
            <RefreshCw className={cn('mr-2 h-4 w-4', loading && 'animate-spin')} />
            {t('projectRules.actions.refresh')}
          </Button>
          {snapshot?.agentsFile?.exists === false && (
            <Button
              type="button"
              onClick={() => void createTemplate()}
              disabled={creating}
              data-testid="project-rules-create-agents"
              className="h-9 rounded-xl px-4"
            >
              <Plus className="mr-2 h-4 w-4" />
              {creating ? t('projectRules.actions.creating') : t('projectRules.actions.createAgents')}
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-xl bg-black/[0.03] p-3 dark:bg-white/[0.04]">
          <p className="text-tiny text-muted-foreground">{t('projectRules.agentsFile')}</p>
          <p className={cn('mt-1 text-sm font-medium', statusTone(snapshot?.agentsFile?.status ?? 'missing'))}>
            {t(`projectRules.status.${snapshot?.agentsFile?.status ?? 'missing'}`)}
          </p>
        </div>
        <div className="rounded-xl bg-black/[0.03] p-3 dark:bg-white/[0.04]">
          <p className="text-tiny text-muted-foreground">{t('projectRules.ruleFileCount')}</p>
          <p className="mt-1 text-sm font-medium text-foreground">
            {snapshot?.ruleFiles.length ?? 0}
          </p>
        </div>
        <div className="rounded-xl bg-black/[0.03] p-3 dark:bg-white/[0.04]">
          <p className="text-tiny text-muted-foreground">{t('projectRules.validation')}</p>
          <p className="mt-1 text-sm font-medium text-foreground">
            {t('projectRules.issueSummary', issueCounts)}
          </p>
        </div>
      </div>

      {snapshot?.agentsFile?.exists === false && (
        <div
          data-testid="project-rules-missing"
          className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-200"
        >
          {t('projectRules.missingAgents')}
        </div>
      )}

      {snapshot?.agentsFile?.content != null && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-foreground">{t('projectRules.previewTitle')}</p>
            <span className="truncate font-mono text-tiny text-muted-foreground">
              {snapshot.agentsFile.relativePath}
            </span>
          </div>
          <pre
            data-testid="project-rules-agents-preview"
            className="max-h-64 overflow-auto rounded-xl border border-black/5 bg-surface-input p-4 font-mono text-xs text-muted-foreground shadow-inner dark:border-white/5"
          >
            {snapshot.agentsFile.content || t('projectRules.emptyPreview')}
          </pre>
        </div>
      )}

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <FolderOpen className="h-4 w-4 text-foreground/70" />
          <p className="text-sm font-medium text-foreground">{t('projectRules.localRulesTitle')}</p>
        </div>
        {snapshot?.ruleFiles.length ? (
          <div className="grid gap-2">
            {snapshot.ruleFiles.map((file) => (
              <div
                key={file.relativePath}
                data-testid="project-rules-file"
                className="flex items-center justify-between gap-3 rounded-xl border border-black/5 bg-black/[0.02] px-3 py-2 dark:border-white/5 dark:bg-white/[0.03]"
              >
                <span className="min-w-0 truncate font-mono text-xs text-foreground">{file.relativePath}</span>
                <span className={cn('shrink-0 text-tiny font-medium', statusTone(file.status))}>
                  {t(`projectRules.status.${file.status}`)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="rounded-xl border border-black/5 bg-black/[0.02] px-3 py-2 text-sm text-muted-foreground dark:border-white/5 dark:bg-white/[0.03]">
            {t('projectRules.noLocalRules')}
          </p>
        )}
      </div>

      <div data-testid="project-rules-context-preview" className="space-y-2">
        <p className="text-sm font-medium text-foreground">{t('projectRules.contextPreviewTitle')}</p>
        <div className="grid gap-2">
          {(snapshot?.contextPreview.items ?? []).map((item) => (
            <div
              key={item.id}
              className="rounded-xl border border-black/5 bg-black/[0.02] p-3 dark:border-white/5 dark:bg-white/[0.03]"
            >
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-foreground">{t(`projectRules.context.${item.id}.title`)}</p>
                <Badge variant={contextStatusVariant(item.status)} className="rounded-full">
                  {t(`projectRules.contextStatus.${item.status}`)}
                </Badge>
              </div>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {t(`projectRules.context.${item.id}.description`, { count: item.fileCount ?? 0 })}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          {issueCounts.errors || issueCounts.warnings ? (
            <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-300" />
          ) : (
            <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
          )}
          <p className="text-sm font-medium text-foreground">{t('projectRules.issuesTitle')}</p>
        </div>
        {snapshot?.issues.length ? (
          <div className="space-y-2">
            {snapshot.issues.map((item, index) => (
              <div
                key={`${item.id}-${item.path ?? index}`}
                data-testid="project-rules-issue"
                className={cn('rounded-xl border p-3 text-sm', issueTone(item))}
              >
                <p className="font-medium">
                  {t(`projectRules.issues.${item.id}.title`, { defaultValue: item.id, ...(item.params ?? {}) })}
                </p>
                <p className="mt-1 text-xs leading-5 opacity-90">
                  {t(`projectRules.issues.${item.id}.description`, {
                    defaultValue: item.path ?? item.id,
                    path: item.path,
                    relatedPaths: item.relatedPaths?.join(', '),
                    ...(item.params ?? {}),
                  })}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="rounded-xl border border-green-500/20 bg-green-500/10 px-3 py-2 text-sm text-green-700 dark:text-green-300">
            {t('projectRules.noIssues')}
          </p>
        )}
      </div>
    </div>
  );
}
