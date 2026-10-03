/**
 * One shell process's own page: what was run, how it ended, and what it printed.
 *
 * The subject is the launching tool call's id, carried on the tab
 * (`PanelTabInstance.subject`). The process itself is read live from the chat
 * runtime run state via `projectRunProcesses`, so an open page follows a running
 * command's output as it streams rather than showing a snapshot from the moment
 * it was clicked.
 *
 * WHY NOT `SessionActivitySnapshot.processes`. That projection is deliberately
 * redacted — its type says "Never carries raw argv, command, cwd, or env text" —
 * so it can list a process but can never show one. The runtime run state already
 * holds the real command and stdout because the transcript's terminal cards need
 * them, so this page reads from there. No new IPC, and the redaction contract on
 * the snapshot stays intact.
 */
import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { projectRunProcesses, type RunProcessSurface } from '@/components/tool-ui/run-surfaces';
import { useChatStore } from '@/stores/chat';

function formatDuration(durationMs: number | undefined): string | null {
  if (durationMs == null || !Number.isFinite(durationMs)) return null;
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`;
  return `${(durationMs / 1000).toFixed(2)}s`;
}

function statusVariant(status: RunProcessSurface['status']): 'default' | 'outline' | 'destructive' {
  if (status === 'failed') return 'destructive';
  return 'outline';
}

export function WorkspaceProcessPanel({ processId }: { processId: string }) {
  const { t } = useTranslation('chat');
  const sessionKey = useChatStore((s) => s.currentSessionKey);
  const runtimeRuns = useChatStore((s) => s.runtimeRuns);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  /* Scan this session's runs for the process. Keyed by the launching tool call,
   * which is unique per run, so the first match is the right one. */
  const process = useMemo(() => {
    for (const run of Object.values(runtimeRuns)) {
      if (run.sessionKey && run.sessionKey !== sessionKey) continue;
      const match = projectRunProcesses(run).find((entry) => entry.id === processId);
      if (match) return match;
    }
    return null;
  }, [processId, runtimeRuns, sessionKey]);

  /* Pin to the bottom while it streams — a running command's interesting line is
   * the last one. Depends on the output length, not the object, so a re-render
   * that changed nothing does not yank the user's scroll position. */
  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [process?.output.length]);

  if (!process) {
    return (
      <div
        className="flex h-full min-h-0 flex-col items-center justify-center gap-2 p-4 text-center"
        data-testid="workspace-process-empty"
      >
        <p className="text-xs text-muted-foreground">{t('processPanel.gone')}</p>
      </div>
    );
  }

  const duration = formatDuration(process.durationMs);

  return (
    <div className="flex h-full min-h-0 flex-col p-3" data-testid="workspace-process-panel">
      <div className="mb-2 min-w-0">
        <div className="flex items-start gap-2">
          <p
            className="min-w-0 flex-1 break-all font-mono text-xs text-foreground"
            data-testid="workspace-process-command"
          >
            {process.command}
          </p>
          <Badge variant={statusVariant(process.status)} className="shrink-0">
            {process.status === 'running'
              ? <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden="true" />
              : null}
            {t(`processPanel.status.${process.status}`)}
          </Badge>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
          {process.cwd && <span className="truncate font-mono">{process.cwd}</span>}
          {process.exitCode != null && (
            <span
              className={cn('tabular-nums', process.exitCode !== 0 && 'text-destructive')}
              data-testid="workspace-process-exit"
            >
              {t('processPanel.exitCode', { code: process.exitCode })}
            </span>
          )}
          {duration && <span className="tabular-nums">{duration}</span>}
        </div>
      </div>

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-auto rounded-md border border-black/10 bg-surface-input p-2.5 dark:border-white/10"
        data-testid="workspace-process-output"
      >
        {process.truncated && (
          <p className="mb-1.5 text-[11px] text-muted-foreground">{t('processPanel.truncated')}</p>
        )}
        {process.output ? (
          <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-foreground">
            {process.output}
          </pre>
        ) : (
          <p className="text-xs text-muted-foreground">
            {process.status === 'running' ? t('processPanel.waiting') : t('processPanel.noOutput')}
          </p>
        )}
      </div>
    </div>
  );
}

export default WorkspaceProcessPanel;
