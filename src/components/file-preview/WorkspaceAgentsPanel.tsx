/**
 * Sub-agent workspace tab.
 *
 * Two halves: the roster of sub-agents this session has spawned, and the
 * selected one's transcript. Everything is live host state — the roster comes
 * from the shared session-activity store, transcripts from `sessions.history`,
 * and dispatch from the `orchestrator.run` RPC. There is no fixture path; a
 * session that has spawned nothing shows the empty arm.
 *
 * The roster is READ from `useSessionActivityStore`, not folded here from
 * `agent:subagent-lifecycle` directly. That store already subscribes to the
 * same channel AND merges the host's `session.activitySnapshot` hydration, so
 * owning a second private copy of the roster meant this tab could sit on its
 * empty arm while the toolbar's status card listed three workers — the two
 * surfaces disagreed about the same fact. One store, one roster. The Chat page
 * owns the store's subscription lifecycle (`load` → `init`), and this tab only
 * ever renders inside it, so there is nothing to subscribe to here.
 *
 * Transcripts are fetched per selected agent rather than prefetched for the
 * whole roster: a fan-out run can spawn a dozen workers, and eagerly loading
 * every transcript would issue a dozen history calls for panes nobody opened.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Loader2, RefreshCw, Send, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { AgentRoleIdentity } from '@/components/agents/AgentAvatar';
import { hostApi } from '@/lib/host-api';
import { cn } from '@/lib/utils';
import { describeUserError, toastUserError } from '@/lib/user-error';
import type { SurfaceErrorState } from '@/lib/async-surface-state';
import { extractText, normalizeMessageRole } from '@/pages/Chat/message-utils';
import { useAgentsStore } from '@/stores/agents';
import { useChatStore } from '@/stores/chat';
import { useArtifactPanel } from '@/stores/artifact-panel';
import { useSessionActivityStore } from '@/stores/session-activity';
import type { RawMessage } from '@shared/chat/types';
import type { SessionActivitySubagent, SessionActivitySubagentStatus } from '@shared/types/session-activity';

type RosterEntry = {
  key: string;
  roleName: string;
  task: string;
  status: SessionActivitySubagentStatus;
  error?: string;
  summary?: string;
  /** Present once the runtime reports the child's own session. */
  childSessionKey?: string;
  agentId?: string;
  ts: number;
};

function rosterEntry(agent: SessionActivitySubagent): RosterEntry {
  return {
    key: agent.id,
    roleName: agent.role || 'agent',
    task: agent.task ?? '',
    status: agent.status,
    error: agent.error,
    summary: agent.summary,
    childSessionKey: agent.childSessionKey,
    agentId: agent.agentId,
    ts: agent.updatedAt,
  };
}

/** `agent:<id>:<session>` — the child's own agent id, for its avatar. */
function agentIdFromSessionKey(sessionKey: string | undefined): string | null {
  if (!sessionKey) return null;
  const parts = sessionKey.split(':');
  return parts.length >= 2 && parts[0] === 'agent' ? parts[1] : null;
}

function statusTone(status: RosterEntry['status']): string {
  if (status === 'started') return 'text-primary';
  if (status === 'error' || status === 'aborted') return 'text-destructive';
  return 'text-muted-foreground';
}

export function WorkspaceAgentsPanel() {
  const { t } = useTranslation('chat');
  const sessionKey = useChatStore((s) => s.currentSessionKey);
  const anchorAgentId = useChatStore((s) => s.currentAgentId);
  const agents = useAgentsStore((s) => s.agents);
  const focusedSessionKey = useArtifactPanel((s) => s.agentsSessionKey);
  const setAgentsSessionKey = useArtifactPanel((s) => s.setAgentsSessionKey);
  const openWorkspacePanel = useArtifactPanel((s) => s.openWorkspacePanel);
  const subagents = useSessionActivityStore((s) => s.snapshots[sessionKey]?.subagents);

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<{ key: string; messages: RawMessage[] } | null>(null);
  const [transcriptError, setTranscriptError] = useState<SurfaceErrorState | null>(null);
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const [dispatchTask, setDispatchTask] = useState('');
  const [dispatching, setDispatching] = useState(false);
  const transcriptScrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setSelectedKey(null);
    setTranscript(null);
    setTranscriptError(null);
  }, [sessionKey]);

  const entries = useMemo(
    () => (subagents ?? []).map(rosterEntry).sort((left, right) => {
      const leftRunning = left.status === 'started' ? 0 : 1;
      const rightRunning = right.status === 'started' ? 0 : 1;
      if (leftRunning !== rightRunning) return leftRunning - rightRunning;
      return right.ts - left.ts;
    }),
    [subagents],
  );

  /* The status card hands over a child session key; resolve it to a roster row
   * so clicking a row there lands on that agent rather than the newest one. */
  useEffect(() => {
    if (!focusedSessionKey) return;
    const match = entries.find((entry) => entry.childSessionKey === focusedSessionKey);
    if (match) {
      setSelectedKey(match.key);
      setAgentsSessionKey(null);
      return;
    }
    /* The roster can arrive a tick after the intent (fresh mount, restored
     * layout). Hold the intent until there is something to resolve it against,
     * or the tab quietly lands on the newest agent instead of the one clicked. */
    if (entries.length > 0) setAgentsSessionKey(null);
  }, [entries, focusedSessionKey, setAgentsSessionKey]);

  const selected = useMemo(
    () => entries.find((entry) => entry.key === selectedKey) ?? entries[0] ?? null,
    [entries, selectedKey],
  );

  /* Takes the two identifiers rather than the roster entry: the roster is
   * rebuilt from the store on every activity event, so an object-identity
   * dependency below would refetch the same transcript each time an unrelated
   * task or terminal event landed. */
  const loadTranscript = useCallback(async (
    rosterKey: string | null,
    childSessionKey: string | undefined,
    childAgentIdHint: string | undefined,
  ) => {
    if (!rosterKey || !childSessionKey) {
      setTranscript(null);
      setTranscriptError(null);
      return;
    }
    const childAgentId = childAgentIdHint ?? agentIdFromSessionKey(childSessionKey) ?? anchorAgentId;
    setTranscriptLoading(true);
    try {
      const result = await hostApi.sessions.history({
        sessionKey: childSessionKey,
        agentId: childAgentId,
      });
      setTranscript({ key: rosterKey, messages: result.messages ?? [] });
      setTranscriptError(null);
    } catch (error) {
      // R2: a failed history query is NOT an empty transcript — surface it.
      setTranscript({ key: rosterKey, messages: [] });
      setTranscriptError({
        messageKey: 'agentsPanel.transcriptFailed',
        errorId: describeUserError(error).errorId,
        retry: () => void loadTranscript(rosterKey, childSessionKey, childAgentIdHint),
      });
    } finally {
      setTranscriptLoading(false);
    }
  }, [anchorAgentId]);

  useEffect(() => {
    void loadTranscript(selected?.key ?? null, selected?.childSessionKey, selected?.agentId);
  }, [loadTranscript, selected?.key, selected?.childSessionKey, selected?.agentId]);

  useEffect(() => {
    const node = transcriptScrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [transcript]);

  const handleDispatch = useCallback(async () => {
    const task = dispatchTask.trim();
    if (!task || dispatching) return;
    const roleName = selected?.roleName || 'planner';
    setDispatching(true);
    try {
      const response = await hostApi.gateway.rpc('orchestrator.run', {
        task,
        sessionKey,
        agentId: anchorAgentId,
        workers: [{ roleName, task }],
        includeVerifier: false,
        workerCommunication: 'none',
      });
      const rejected = response && typeof response === 'object' && (response as { success?: boolean }).success === false;
      if (rejected) {
        const message = (response as { error?: unknown }).error;
        throw new Error(typeof message === 'string' ? message : t('agentsPanel.dispatchFailed'));
      }
      setDispatchTask('');
      toast.success(t('agentsPanel.dispatchStarted', { role: roleName }));
    } catch (error) {
      toastUserError(error, { fallback: t('agentsPanel.dispatchFailed') });
    } finally {
      setDispatching(false);
    }
  }, [anchorAgentId, dispatchTask, dispatching, selected?.roleName, sessionKey, t]);

  // null-safe: with an empty roster both sides are null and `?.` equality
  // would still evaluate to true, crashing on the property read (R2).
  const selectedTranscript = transcript && transcript.key === selected?.key ? transcript.messages : [];

  return (
    <div className="flex h-full min-h-0 flex-col p-3" data-testid="workspace-agents-panel">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">{t('agentsPanel.title')}</p>
          <p className="truncate text-xs text-muted-foreground">{t('agentsPanel.description')}</p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 shrink-0"
          disabled={!selected?.childSessionKey || transcriptLoading}
          onClick={() => void loadTranscript(selected?.key ?? null, selected?.childSessionKey, selected?.agentId)}
          data-testid="workspace-agents-refresh"
        >
          <RefreshCw className={cn('mr-1.5 h-3.5 w-3.5', transcriptLoading && 'animate-spin')} />
          {t('common:actions.refresh')}
        </Button>
      </div>

      {entries.length === 0 ? (
        <div
          className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 rounded-md border border-black/10 px-4 text-center dark:border-white/10"
          data-testid="workspace-agents-empty"
        >
          <Users className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
          <p className="text-xs text-muted-foreground">{t('agentsPanel.empty')}</p>
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,13rem)_minmax(0,1fr)] gap-3">
          <div
            className="min-h-0 overflow-y-auto rounded-md border border-black/10 dark:border-white/10"
            data-testid="workspace-agents-roster"
          >
            <div className="divide-y divide-black/5 dark:divide-white/10">
              {entries.map((entry) => {
                const childAgentId = entry.agentId ?? agentIdFromSessionKey(entry.childSessionKey) ?? entry.roleName;
                const avatar = agents.find((agent) => agent.id === childAgentId)?.avatar;
                const active = entry.key === selected?.key;
                return (
                  <button
                    key={entry.key}
                    type="button"
                    className={cn(
                      'flex w-full items-center gap-2 p-2.5 text-left transition-colors',
                      active ? 'bg-foreground/[0.06]' : 'hover:bg-foreground/[0.04]',
                    )}
                    onClick={() => setSelectedKey(entry.key)}
                    /* Double-click promotes the worker to its own tab. The roster
                     * is a directory; a worker you intend to read for a while
                     * belongs in a chip of its own, next to the others. */
                    onDoubleClick={() => {
                      if (entry.childSessionKey) {
                        openWorkspacePanel({
                          panel: 'subagent',
                          sessionKey: entry.childSessionKey,
                          roleName: entry.roleName,
                        });
                      }
                    }}
                    title={entry.childSessionKey ? t('agentsPanel.openOwnTab') : entry.task}
                    data-testid={`workspace-agents-row-${entry.key.replace(/[^a-zA-Z0-9_-]/g, '-')}`}
                    aria-current={active}
                  >
                    <AgentRoleIdentity
                      agentId={childAgentId}
                      name={entry.roleName}
                      avatar={avatar}
                      roleName={entry.roleName}
                      size={28}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium text-foreground">{entry.roleName}</span>
                      <span className={cn('block truncate text-[11px]', statusTone(entry.status))}>
                        {t(`sessionRail.agents.status.${entry.status}`, { defaultValue: entry.status })}
                      </span>
                    </span>
                    {entry.status === 'started' && (
                      <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" aria-hidden="true" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex min-h-0 flex-col gap-2">
            {selected && (
              <div className="rounded-md border border-black/10 p-2.5 dark:border-white/10">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs font-medium text-foreground">{selected.roleName}</span>
                  <Badge variant={selected.status === 'error' ? 'destructive' : 'outline'}>
                    {t(`sessionRail.agents.status.${selected.status}`, { defaultValue: selected.status })}
                  </Badge>
                </div>
                {selected.task && (
                  <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{selected.task}</p>
                )}
                {selected.error && (
                  <p className="mt-1 text-[11px] text-destructive">{selected.error}</p>
                )}
              </div>
            )}

            <div
              ref={transcriptScrollRef}
              className="min-h-0 flex-1 overflow-y-auto rounded-md border border-black/10 dark:border-white/10"
              data-testid="workspace-agents-transcript"
            >
              {transcriptError ? (
                <div
                  className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center"
                  data-testid="workspace-agents-transcript-failed"
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
                      data-testid="workspace-agents-transcript-retry"
                    >
                      {t('retry')}
                    </Button>
                  ) : null}
                </div>
              ) : transcriptLoading ? (
                <div className="flex h-full items-center justify-center">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" />
                </div>
              ) : selectedTranscript.length === 0 ? (
                <div className="flex h-full items-center justify-center px-4 text-center text-xs text-muted-foreground">
                  {selected?.childSessionKey
                    ? t('agentsPanel.transcriptEmpty')
                    : t('agentsPanel.transcriptUnavailable')}
                </div>
              ) : (
                <div className="divide-y divide-black/5 dark:divide-white/10">
                  {selectedTranscript.map((message, index) => {
                    const role = normalizeMessageRole(message.role);
                    const text = extractText(message);
                    if (!text.trim()) return null;
                    return (
                      <div key={message.id ?? `${role}-${index}`} className="p-2.5">
                        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                          {t(`agentsPanel.role.${role}`, { defaultValue: role })}
                        </p>
                        <p className="mt-1 whitespace-pre-wrap break-words text-xs text-foreground">{text}</p>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex items-end gap-2">
              <Textarea
                value={dispatchTask}
                onChange={(event) => setDispatchTask(event.target.value)}
                placeholder={t('agentsPanel.dispatchPlaceholder', { role: selected?.roleName ?? 'planner' })}
                rows={2}
                className="min-h-0 flex-1 resize-none text-xs"
                data-testid="workspace-agents-dispatch-input"
              />
              <Button
                type="button"
                size="sm"
                className="h-8 shrink-0"
                disabled={!dispatchTask.trim() || dispatching}
                onClick={() => void handleDispatch()}
                data-testid="workspace-agents-dispatch"
              >
                {dispatching
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  : <Send className="h-3.5 w-3.5" aria-hidden="true" />}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default WorkspaceAgentsPanel;
