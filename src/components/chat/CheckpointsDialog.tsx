import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, History, Loader2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { hostApi } from '@/lib/host-api';
import type { LongTaskCheckpointRecord, SessionCheckpointDiffFile } from '@shared/host-api/contract';

type CheckpointsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionKey: string;
  agentId?: string | null;
  generation?: string | null;
};

function formatCheckpointTime(createdAt: string): string {
  try {
    return new Date(createdAt).toLocaleString();
  } catch {
    return createdAt;
  }
}

export function CheckpointsDialog({ open, onOpenChange, sessionKey, agentId, generation }: CheckpointsDialogProps) {
  const { t } = useTranslation('chat');
  const scope = useMemo(() => ({ open, sessionKey, agentId, generation }), [open, sessionKey, agentId, generation]);
  const scopeRef = useRef<typeof scope | null>(scope); scopeRef.current = scope;
  const isCurrent = useCallback(() => scope.open && scopeRef.current === scope, [scope]);
  const [checkpoints, setCheckpoints] = useState<LongTaskCheckpointRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restored, setRestored] = useState<string | null>(null);
  const [diffExpandedId, setDiffExpandedId] = useState<string | null>(null);
  const [diffLoadingId, setDiffLoadingId] = useState<string | null>(null);
  const [diffByCheckpoint, setDiffByCheckpoint] = useState<Record<string, SessionCheckpointDiffFile[]>>({});

  const load = useCallback(async (preserveFeedback = false) => {
    if (!isCurrent() || !sessionKey) return;
    setLoading(true);
    if (!preserveFeedback) setError(null);
    setDiffByCheckpoint({}); setDiffExpandedId(null);
    try {
      const result = await hostApi.sessions.resumeCheckpoints({
        sessionKey,
        ...(agentId ? { agentId } : {}),
        limit: 20,
      });
      if (!isCurrent()) return;
      if (result.success) {
        setCheckpoints(result.checkpoints ?? []);
      } else {
        setError(result.error || t('checkpoints.loadFailed'));
      }
    } catch (err) {
      if (isCurrent()) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [isCurrent, sessionKey, agentId, t]);

  useEffect(() => {
    scopeRef.current = scope;
    setCheckpoints([]); setRestored(null); setRestoringId(null); setError(null);
    setDiffByCheckpoint({}); setDiffExpandedId(null); setDiffLoadingId(null);
    if (open) void load();
    return () => { if (scopeRef.current === scope) scopeRef.current = null; };
  }, [scope, open, load]);

  const handleRestore = useCallback(async (checkpointId: string) => {
    if (!isCurrent() || restoringId !== null) return;
    setRestoringId(checkpointId);
    setError(null);
    setRestored(null);
    try {
      const result = await hostApi.sessions.restoreCheckpoint({
        sessionKey,
        ...(agentId ? { agentId } : {}),
        checkpointId,
      });
      if (!isCurrent()) return;
      if ((result.key && result.key !== sessionKey) || result.checkpointId !== checkpointId) {
        setError(t('checkpoints.restoreFailed')); return;
      }
      if (result.success) {
        const partialNotice =
          result.mode === 'legacy_checkpoint_fallback'
            ? ` ${t('checkpoints.partialRestoreNotice')}`
            : '';
        setRestored(`${result.evidenceSummary || t('checkpoints.restoreSucceeded')}${partialNotice}`);
        await load();
      } else {
        setError(result.error || t('checkpoints.restoreFailed'));
      }
    } catch (err) {
      if (isCurrent()) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (isCurrent()) setRestoringId(null);
    }
  }, [isCurrent, restoringId, sessionKey, agentId, t, load]);

  const handleToggleDiff = useCallback(async (checkpointId: string) => {
    if (!isCurrent()) return;
    setError(null);
    if (diffExpandedId === checkpointId) {
      setDiffExpandedId(null);
      return;
    }
    setDiffExpandedId(checkpointId);
    if (diffByCheckpoint[checkpointId]) {
      return; // already loaded
    }
    setDiffLoadingId(checkpointId);
    try {
      const result = await hostApi.sessions.checkpointDiff({
        sessionKey,
        ...(agentId ? { agentId } : {}),
        checkpointId,
      });
      if (!isCurrent()) return;
      if (result.success) {
        setDiffByCheckpoint((prev) => ({ ...prev, [checkpointId]: result.files }));
      } else {
        setError(result.error || t('checkpoints.diffFailed'));
        setDiffExpandedId(null);
      }
    } catch (err) {
      if (!isCurrent()) return;
      setError(err instanceof Error ? err.message : String(err));
      setDiffExpandedId(null);
    } finally {
      if (isCurrent()) setDiffLoadingId(null);
    }
  }, [isCurrent, sessionKey, agentId, diffExpandedId, diffByCheckpoint, t]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="chat-checkpoints-dialog" aria-busy={loading || restoringId !== null} className="max-h-[70vh] overflow-y-auto sm:max-w-lg">
        <div className="flex items-center gap-2">
          <DialogTitle className="flex items-center gap-2">
            <History className="h-4 w-4" />
            {t('checkpoints.title')}
          </DialogTitle>
          <DialogDescription>{t('checkpoints.description')}</DialogDescription>
        </div>
        <div className="flex flex-col gap-2 py-2">
          {loading && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {t('checkpoints.loading')}
            </div>
          )}
          {!loading && checkpoints.length === 0 && !error && (
            <p className="text-xs text-muted-foreground">{t('checkpoints.empty')}</p>
          )}
          {checkpoints.map((checkpoint) => {
            const summary = checkpoint.checkpoint;
            const files = summary.filesTouched?.length ?? 0;
            const tests = summary.testsRun?.length ?? 0;
            return (
              <div
                key={checkpoint.id}
                className="rounded-md border border-black/10 dark:border-white/10"
              >
                <div className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-foreground">
                    {summary.objective || summary.activeTask || checkpoint.trigger}
                  </p>
                  <p className="mt-0.5 truncate text-2xs text-muted-foreground">
                    {formatCheckpointTime(summary.createdAt)}
                    {' · '}
                    {t('checkpoints.filesTouched', { count: files })}
                    {' · '}
                    {t('checkpoints.testsRun', { count: tests })}
                  </p>
                  {summary.decisions && summary.decisions.length > 0 && (
                    <p className="mt-0.5 line-clamp-1 text-2xs text-muted-foreground">
                      {summary.decisions.join('; ')}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={diffLoadingId !== null}
                    onClick={() => void handleToggleDiff(checkpoint.id)}
                    data-testid={`chat-checkpoint-diff-${checkpoint.id}`}
                  >
                    {diffLoadingId === checkpoint.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : diffExpandedId === checkpoint.id ? (
                      <ChevronDown className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5" />
                    )}
                    {diffExpandedId === checkpoint.id
                      ? t('checkpoints.hideDiff')
                      : t('checkpoints.showDiff')}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={restoringId !== null}
                    onClick={() => void handleRestore(checkpoint.id)}
                    data-testid={`chat-checkpoint-restore-${checkpoint.id}`}
                  >
                    {restoringId === checkpoint.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RotateCcw className="h-3.5 w-3.5" />
                    )}
                    {t('checkpoints.restore')}
                  </Button>
                </div>
                </div>
              {diffExpandedId === checkpoint.id && (
                <div
                  className="rounded-md border border-black/10 bg-surface-input px-3 py-2 dark:border-white/10"
                  data-testid={`chat-checkpoint-diff-panel-${checkpoint.id}`}
                >
                  {diffLoadingId === checkpoint.id && (
                    <p className="text-2xs text-muted-foreground">{t('checkpoints.diffLoading')}</p>
                  )}
                  {diffLoadingId !== checkpoint.id && diffByCheckpoint[checkpoint.id]?.length === 0 && (
                    <p className="text-2xs text-muted-foreground">{t('checkpoints.diffEmpty')}</p>
                  )}
                  {diffByCheckpoint[checkpoint.id]?.map((file) => (
                    <div key={file.filePath} className="mb-2 last:mb-0">
                      <p className="mb-1 truncate text-2xs font-medium text-foreground">
                        {file.status === 'created' ? '[+]' : file.status === 'deleted' ? '[-]' : '[~]'} {file.filePath}
                      </p>
                      <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded border border-black/5 bg-black/5 p-2 text-2xs leading-relaxed text-foreground dark:border-white/5 dark:bg-white/5">
                        {file.unifiedDiff}
                      </pre>
                    </div>
                  ))}
                </div>
              )}
              </div>
            );
          })}
          {error && (
            <div data-testid="chat-checkpoints-error" role="alert" className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
          {restored && (
            <div data-testid="chat-checkpoints-restored" role="status" className="flex items-start gap-2 rounded-md border border-emerald-600/30 bg-emerald-600/5 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{restored}</span>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" data-testid="chat-checkpoints-refresh"
            disabled={loading || restoringId !== null} onClick={() => void load(true)}>{t('workspace.actions.refresh')}</Button>
          <Button type="button" variant="ghost" size="sm" data-testid="chat-checkpoints-close" onClick={() => onOpenChange(false)}>
            {t('checkpoints.close')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
