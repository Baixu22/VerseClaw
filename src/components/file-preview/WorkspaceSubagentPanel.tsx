/**
 * One sub-agent's own page.
 *
 * WHY THIS IS NOT `WorkspaceAgentsPanel`. That tab is the roster: a list on the
 * left, whichever worker you last clicked on the right. Landing there after
 * clicking a specific worker in the status card means arriving at a directory
 * and hunting for the row you already chose. This page is about one worker from
 * the moment it opens — its face and name in the tab chip, its transcript in the
 * body — and the panel opens one instance of it per worker, so two can be read
 * side by side.
 *
 * Its subject is the child's own `sessionKey`, carried on the tab
 * (`PanelTabInstance.subject`). The roster entry is looked up in the shared
 * session-activity store rather than passed down, so the header keeps tracking
 * the worker's status while you read.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Loader2, RefreshCw, Send } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { AgentAvatar } from '@/components/agents/AgentAvatar';
import { RoleBadge } from '@/components/agents/AgentAvatar';
import { hostApi } from '@/lib/host-api';
import { cn } from '@/lib/utils';
import { describeUserError, toastUserError } from '@/lib/user-error';
import type { SurfaceErrorState } from '@/lib/async-surface-state';
import { extractText, normalizeMessageRole } from '@/pages/Chat/message-utils';
import { useChatStore } from '@/stores/chat';
import { useSessionActivityStore } from '@/stores/session-activity';
import { subagentIdentity } from '@shared/subagent-identity';
import type { RawMessage } from '@shared/chat/types';
import type { SessionActivitySubagentStatus } from '@shared/types/session-activity';

/** `agent:<id>:<session>` — the child's own agent id, for the history call. */
function agentIdFromSessionKey(sessionKey: string): string | null {
  const parts = sessionKey.split(':');
  return parts.length >= 2 && parts[0] === 'agent' ? parts[1] : null;
}

function statusTone(status: SessionActivitySubagentStatus | undefined): string {
  if (status === 'started') return 'text-primary';
  if (status === 'error' || status === 'aborted') return 'text-destructive';
  return 'text-muted-foreground';
}

export function WorkspaceSubagentPanel({ childSessionKey }: { childSessionKey: string }) {
  const { t } = useTranslation('chat');
  const parentSessionKey = useChatStore((s) => s.currentSessionKey);
  const anchorAgentId = useChatStore((s) => s.currentAgentId);
  const subagents = useSessionActivityStore((s) => s.snapshots[parentSessionKey]?.subagents);

  const [transcript, setTranscript] = useState<RawMessage[]>([]);
  const [transcriptError, setTranscriptError] = useState<SurfaceErrorState | null>(null);
  const [loading, setLoading] = useState(false);
  const [dispatchTask, setDispatchTask] = useState('');
  const [dispatching, setDispatching] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  /* Live roster entry, so the header's status keeps up with the run while the
   * transcript is being read. Absent once retention drops a finished worker —
   * the page still shows its transcript, just without a live status. */
  const entry = useMemo(
    () => (subagents ?? []).find((agent) => agent.childSessionKey === childSessionKey) ?? null,
    [subagents, childSessionKey],
  );
  const identity = useMemo(() => subagentIdentity(childSessionKey), [childSessionKey]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await hostApi.sessions.history({
        sessionKey: childSessionKey,
        agentId: agentIdFromSessionKey(childSessionKey) ?? anchorAgentId,
      });
      setTranscript(result.messages ?? []);
      setTranscriptError(null);
    } catch (error) {
      // R2: a failed history query is NOT an empty transcript — surface it.
      setTranscript([]);
      setTranscriptError({
        messageKey: 'agentsPanel.transcriptFailed',
        errorId: describeUserError(error).errorId,
        retry: () => void load(),
      });
    } finally {
      setLoading(false);
    }
  }, [anchorAgentId, childSessionKey]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [transcript]);

  const handleDispatch = useCallback(async () => {
    const task = dispatchTask.trim();
    if (!task || dispatching) return;
    const roleName = entry?.role || 'planner';
    setDispatching(true);
    try {
      const response = await hostApi.gateway.rpc('orchestrator.run', {
        task,
        sessionKey: parentSessionKey,
        agentId: anchorAgentId,
        workers: [{ roleName, task }],
        includeVerifier: false,
        workerCommunication: 'none',
      });
      const rejected = response && typeof response === 'object'
        && (response as { success?: boolean }).success === false;
      if (rejected) {
        const message = (response as { error?: unknown }).error;
        throw new Error(typeof message === 'string' ? message : t('agentsPanel.dispatchFailed'));
      }
      setDispatchTask('');
      toast.success(t('agentsPanel.dispatchStarted', { role: identity.name }));
    } catch (error) {
      toastUserError(error, { fallback: t('agentsPanel.dispatchFailed') });
    } finally {
      setDispatching(false);
    }
  }, [anchorAgentId, dispatchTask, dispatching, entry?.role, identity.name, parentSessionKey, t]);

  const statusLabel = entry
    ? t(`sessionActivity.subagentStatus.${entry.status}`, { defaultValue: entry.status })
    : null;

  return (
    <div className="flex h-full min-h-0 flex-col p-3" data-testid="workspace-subagent-panel">
      <div className="mb-3 flex items-start gap-2.5">
        <span className="relative inline-flex shrink-0">
          <AgentAvatar
            agentId={identity.avatarId}
            name={identity.name}
            avatar={identity.avatar}
            size={32}
          />
          {entry?.role && (
            <RoleBadge roleName={entry.role} size={15} className="absolute -bottom-0.5 -right-0.5" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-semibold text-foreground">{identity.name}</p>
            {entry?.role && (
              <span className="shrink-0 truncate text-xs text-muted-foreground">{entry.role}</span>
            )}
            {statusLabel && (
              <Badge variant={entry?.status === 'error' ? 'destructive' : 'outline'} className="shrink-0">
                {statusLabel}
              </Badge>
            )}
          </div>
          {entry?.task && (
            <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{entry.task}</p>
          )}
          {entry?.error && (
            <p className="mt-0.5 text-xs text-destructive">{entry.error}</p>
          )}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 shrink-0"
          disabled={loading}
          onClick={() => void load()}
          data-testid="workspace-subagent-refresh"
        >
          <RefreshCw className={cn('mr-1.5 h-3.5 w-3.5', loading && 'animate-spin')} />
          {t('common:actions.refresh')}
        </Button>
      </div>

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto rounded-md border border-black/10 dark:border-white/10"
        data-testid="workspace-subagent-transcript"
      >
        {transcriptError ? (
          <div
            className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center"
            data-testid="workspace-subagent-transcript-failed"
          >
            <p className="text-xs text-destructive">{t(transcriptError.messageKey)}</p>
            {transcriptError.errorId ? (
              <p className="text-[11px] text-muted-foreground">
                {t('common:errorBoundary.errorReference')} {transcriptError.errorId}
              </p>
            ) : null}
            {transcriptError.retry ? (
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={transcriptError.retry}
                data-testid="workspace-subagent-transcript-retry"
              >
                {t('retry')}
              </Button>
            ) : null}
          </div>
        ) : loading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" />
          </div>
        ) : transcript.length === 0 ? (
          <div className="flex h-full items-center justify-center px-4 text-center text-xs text-muted-foreground">
            {t('agentsPanel.transcriptEmpty')}
          </div>
        ) : (
          <div className="divide-y divide-black/5 dark:divide-white/10">
            {transcript.map((message, index) => {
              const role = normalizeMessageRole(message.role);
              const text = extractText(message);
              if (!text.trim()) return null;
              return (
                <div key={message.id ?? `${role}-${index}`} className="p-2.5">
                  <p className={cn(
                    'text-[10px] font-medium uppercase tracking-wide',
                    role === 'assistant' ? statusTone(entry?.status) : 'text-muted-foreground',
                  )}>
                    {role === 'assistant'
                      ? identity.name
                      : t(`agentsPanel.role.${role}`, { defaultValue: role })}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap break-words text-xs text-foreground">{text}</p>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="mt-2 flex items-end gap-2">
        <Textarea
          value={dispatchTask}
          onChange={(event) => setDispatchTask(event.target.value)}
          placeholder={t('agentsPanel.dispatchPlaceholder', { role: identity.name })}
          rows={2}
          className="min-h-0 flex-1 resize-none text-xs"
          data-testid="workspace-subagent-dispatch-input"
        />
        <Button
          type="button"
          size="sm"
          className="h-8 shrink-0"
          disabled={!dispatchTask.trim() || dispatching}
          onClick={() => void handleDispatch()}
          data-testid="workspace-subagent-dispatch"
        >
          {dispatching
            ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            : <Send className="h-3.5 w-3.5" aria-hidden="true" />}
        </Button>
      </div>
    </div>
  );
}

export default WorkspaceSubagentPanel;
