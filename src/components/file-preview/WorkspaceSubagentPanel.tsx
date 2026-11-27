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
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { ChevronDown, Loader2, RefreshCw, Send } from 'lucide-react';
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
import { useSessionActivityStore, selectSessionActivitySnapshot } from '@/stores/session-activity';
import { useWorkspacesStore } from '@/stores/workspaces';
import { isSessionIntentFresh, useSessionIntentStore } from '@/stores/session-intent';
import { SessionDelegationStatus } from '@/components/chat/SessionDelegationStatus';
import { subagentIdentity } from '@shared/subagent-identity';
import type { RawMessage } from '@shared/chat/types';
import type { SessionActivitySubagentStatus } from '@shared/types/session-activity';
import type { TaskEvidence, TaskView } from '@shared/task-system/types';
const EMPTY_TRANSCRIPT: RawMessage[] = [];

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
  const { t: tAgents } = useTranslation('agents');
  const navigate = useNavigate();
  const dispatchInputId = useId();
  const parentSessionKey = useChatStore((s) => s.currentSessionKey);
  const anchorAgentId = useChatStore((s) => s.currentAgentId);
  const workspace = useWorkspacesStore((s) => s.activeWorkspace);
  const snapshot = useSessionActivityStore((s) => selectSessionActivitySnapshot(s, workspace?.id, parentSessionKey));
  const subagents = snapshot?.subagents;
  const scopeKey = JSON.stringify([workspace?.id, parentSessionKey, childSessionKey, snapshot?.session.sessionId]);
  const viewScope = useMemo(() => ({ key: scopeKey }), [scopeKey]);
  const scopeRef = useRef(viewScope); scopeRef.current = viewScope;
  const loadVersion = useRef(0);
  const [childGeneration, setChildGeneration] = useState<string | null>(null);
  const controlIntent = useSessionIntentStore(state => state.intent);
  const consumeControl = useSessionIntentStore(state => state.consume);
  const pendingSteer = controlIntent?.kind === 'collaboration-control' && controlIntent.action === 'interruptSend' &&
    controlIntent.scope.workspaceId === workspace?.id && controlIntent.sessionKey === childSessionKey ? controlIntent : null;
  const [armedSteer, setArmedSteer] = useState<{ scopeKey: string; generation: string; runId: string } | null>(null);
  const steerTarget = armedSteer?.scopeKey === scopeKey ? armedSteer : null;
  const dispatchInputRef = useRef<HTMLTextAreaElement | null>(null);
  const [sendPhase, setSendPhase] = useState<'accepted' | 'queued' | 'steered' | 'rejected' | 'unknown' | null>(null);
  const sendIntent = useRef<{ text: string; scope: string; id: string; generation: string } | null>(null);
  useEffect(() => { setSendPhase(null); setDispatching(false); }, [scopeKey]);

  const [loadedTranscript, setLoadedTranscript] = useState<{ scope: object; messages: RawMessage[]; model?: string; costUsd?: number | null; task?: TaskView | null; verificationReceipts?: TaskEvidence[] } | null>(null);
  const transcript = loadedTranscript?.scope === viewScope ? loadedTranscript.messages : EMPTY_TRANSCRIPT;
  const [transcriptError, setTranscriptError] = useState<SurfaceErrorState | null>(null);
  const [loading, setLoading] = useState(false);
  const [dispatchTask, setDispatchTask] = useState('');
  const [dispatching, setDispatching] = useState(false);
  useEffect(() => {
    if (!pendingSteer || !childGeneration || !snapshot?.session.sessionId || sendPhase === 'unknown') return;
    if (!consumeControl(pendingSteer)) return;
    if (!isSessionIntentFresh(pendingSteer) || !pendingSteer.runId || pendingSteer.scope.sessionGeneration !== childGeneration) {
      toast.error(t('operationGenerationUnavailable'));
      return;
    }
    setArmedSteer({ scopeKey, generation: childGeneration, runId: pendingSteer.runId });
    dispatchInputRef.current?.focus();
  }, [childGeneration, consumeControl, pendingSteer, scopeKey, sendPhase, snapshot?.session.sessionId, t]);
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
    const version = ++loadVersion.current;
    setLoading(true);
    setLoadedTranscript(null);
    setChildGeneration(null);
    try {
      const result = await hostApi.sessions.history({
        sessionKey: childSessionKey,
        agentId: agentIdFromSessionKey(childSessionKey) ?? anchorAgentId,
        expectedParentSessionKey: parentSessionKey,
        ...(sendIntent.current?.scope === scopeKey ? { expectedSessionGeneration: sendIntent.current.generation,
          workerSendIdempotencyKey: sendIntent.current.id } : {}),
      });
      if (scopeRef.current !== viewScope || version !== loadVersion.current) return;
      if (!result.success || !result.sessionGeneration) throw new Error(result.error ?? 'Worker transcript unavailable');
      setLoadedTranscript({ scope: viewScope, messages: result.messages ?? [], model: result.model, costUsd: result.costUsd });
      setChildGeneration(result.sessionGeneration);
      const intent = sendIntent.current;
      const receiptPhase = intent?.scope === scopeKey
        ? result.workerSendReceipt?.idempotencyKey === intent.id ? result.workerSendReceipt.phase
          : result.messages?.some((message) => (message as RawMessage & { idempotencyKey?: string }).idempotencyKey === `${intent.id}:user`) ? 'accepted' : null
        : null;
      if (receiptPhase && intent) {
        setSendPhase(receiptPhase);
        setDispatchTask((current) => current === intent.text ? '' : current);
        sendIntent.current = null;
        setArmedSteer(current => current?.scopeKey === scopeKey ? null : current);
      }
      setTranscriptError(null);
      setLoading(false);
      if (workspace?.id) {
        const owner = await hostApi.taskLedger.sessionTask({ workspaceId: workspace.id, sessionKey: childSessionKey,
          expectedSessionGeneration: result.sessionGeneration }).catch(() => null);
        if (scopeRef.current !== viewScope || version !== loadVersion.current) return;
        setLoadedTranscript(current => current?.scope === viewScope ? { ...current, task: owner?.success ? owner.task : null,
          verificationReceipts: owner?.success ? owner.verificationReceipts : undefined } : current);
      }
    } catch (error) {
      if (scopeRef.current !== viewScope || version !== loadVersion.current) return;
      // R2: a failed history query is NOT an empty transcript — surface it.
      setLoadedTranscript(null);
      setTranscriptError({
        messageKey: 'agentsPanel.transcriptFailed',
        errorId: describeUserError(error).errorId,
        retry: () => void load(),
      });
    } finally {
      if (scopeRef.current === viewScope && version === loadVersion.current) setLoading(false);
    }
  }, [anchorAgentId, childSessionKey, parentSessionKey, scopeKey, viewScope, workspace?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (loading) return;
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [transcript, loading]);

  const handleDispatch = useCallback(async () => {
    const task = dispatchTask.trim();
    if (!task || dispatching) return;
    setDispatching(true);
    try {
      if (!workspace?.id || !snapshot?.session.sessionId || !childGeneration) throw new Error(t('agentsPanel.transcriptUnavailable'));
      if (sendIntent.current?.text !== task || sendIntent.current.scope !== scopeKey) sendIntent.current = { text: task, scope: scopeKey, id: crypto.randomUUID(), generation: childGeneration };
      if (steerTarget && steerTarget.generation !== childGeneration) {
        sendIntent.current = null;
        throw new Error(t('operationGenerationUnavailable'));
      }
      const response = await hostApi.sessions.sendWorker({ workspaceId: workspace.id, parentSessionKey,
        expectedParentGeneration: snapshot.session.sessionId, childSessionKey, expectedChildGeneration: childGeneration,
        message: task, mode: steerTarget ? 'steer' : 'send',
        ...(steerTarget ? { expectedRunId: steerTarget.runId } : {}),
        idempotencyKey: sendIntent.current.id });
      if (scopeRef.current !== viewScope) return;
      setSendPhase(response.phase);
      if (response.phase === 'rejected') sendIntent.current = null;
      if (!response.success) throw new Error(response.error ?? t('agentsPanel.dispatchFailed'));
      sendIntent.current = null;
      setArmedSteer(current => current === steerTarget ? null : current);
      setDispatchTask((current) => current === task ? '' : current);
      toast.success(t(`delegationStages.status.${response.phase}`));
    } catch (error) {
      if (scopeRef.current === viewScope) toastUserError(error, { fallback: t('agentsPanel.dispatchFailed') });
    } finally {
      if (scopeRef.current === viewScope) setDispatching(false);
    }
  }, [dispatchTask, dispatching, parentSessionKey, t, childGeneration, childSessionKey,
    snapshot?.session.sessionId, steerTarget, workspace?.id, scopeKey, viewScope]);

  const statusLabel = entry
    ? t(`sessionActivity.subagentStatus.${entry.status}`, { defaultValue: entry.status })
    : null;

  return (
    <div className="flex h-full min-h-0 flex-col p-3" data-testid="workspace-subagent-panel">
      <header className="mb-2 shrink-0 rounded-xl border border-border/60 bg-surface-input p-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="relative inline-flex shrink-0">
            <AgentAvatar agentId={identity.avatarId} name={identity.name} avatar={identity.avatar} size={34} />
            {entry?.role && <RoleBadge roleName={entry.role} size={15} className="absolute -bottom-0.5 -right-0.5" />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <p className="truncate text-sm font-semibold text-foreground">{identity.name}</p>
              {entry?.role && <span className="truncate text-xs text-muted-foreground">{entry.role}</span>}
              {statusLabel && (
                <Badge variant={entry?.status === 'error' ? 'destructive' : 'outline'} className={cn(
                  'shrink-0',
                  entry?.status === 'started' && 'border-primary/30 bg-primary/5 text-primary',
                  entry?.status === 'aborted' && 'border-destructive/30 text-destructive',
                )}>
                  {statusLabel}
                </Badge>
              )}
            </div>
            {entry?.task && <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground" title={entry.task}>{entry.task}</p>}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 shrink-0"
            disabled={loading}
            onClick={() => void load()}
            aria-label={t('common:actions.refresh')}
            title={t('common:actions.refresh')}
            data-testid="workspace-subagent-refresh"
          >
            <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} aria-hidden="true" />
          </Button>
        </div>
        <div className="mt-2 flex min-w-0 flex-wrap gap-x-3 gap-y-1 border-t border-border/50 pt-2 text-2xs text-muted-foreground">
          <span data-testid="workspace-subagent-model" className="min-w-0 break-words">
            {t('delegationStages.model', { model: loadedTranscript?.scope === viewScope && loadedTranscript.model
              ? loadedTranscript.model : t('delegationStages.status.unavailable') })}
          </span>
          <span data-testid="workspace-subagent-cost" className="break-words">
            {t('delegationStages.cost', { cost: loadedTranscript?.scope === viewScope && typeof loadedTranscript.costUsd === 'number'
              && Number.isFinite(loadedTranscript.costUsd) && loadedTranscript.costUsd >= 0
              ? new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 6 }).format(loadedTranscript.costUsd)
              : t('delegationStages.costUnknown') })}
          </span>
        </div>
        {entry?.error && <p className="mt-2 rounded-md border border-destructive/20 bg-destructive/5 px-2 py-1.5 text-xs text-destructive">{entry.error}</p>}
      </header>

      {sendPhase && (
        <p role="status" data-testid="worker-send-phase" className="mb-2 shrink-0 rounded-lg border border-border/60 bg-surface-input px-3 py-2 text-xs">
          {t(`delegationStages.status.${sendPhase}`)}
        </p>
      )}

      <details className="group/delegation mb-2 shrink-0" data-testid="workspace-subagent-details">
        <summary className="flex min-h-8 cursor-pointer list-none items-center gap-2 rounded-lg px-2 text-xs text-muted-foreground hover:bg-muted/50 hover:text-foreground [&::-webkit-details-marker]:hidden">
          <span className="min-w-0 flex-1">{t('agentsPanel.lifecycleDetails')}</span>
          <ChevronDown className="size-3.5 shrink-0 transition-transform group-open/delegation:rotate-180" aria-hidden="true" />
        </summary>
        <div className="pt-2">
          <SessionDelegationStatus workspaceId={workspace?.id} sessionKey={parentSessionKey}
            generation={snapshot?.session.sessionId} snapshot={snapshot} worker={entry ?? undefined}
            childSessionKey={childSessionKey}
            task={loadedTranscript?.scope === viewScope ? loadedTranscript.task : null}
            verificationReceipts={loadedTranscript?.scope === viewScope ? loadedTranscript.verificationReceipts : undefined}
            onOpenResources={workspace?.id ? () => navigate('/settings/storage?' + new URLSearchParams({
              workspaceId: workspace.id, sessionKey: parentSessionKey,
            }).toString()) : undefined} />
        </div>
      </details>

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-border/60 bg-background/60"
        data-testid="workspace-subagent-transcript"
      >
        {transcriptError ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center" data-testid="workspace-subagent-transcript-failed">
            <p className="text-xs text-destructive">{t(transcriptError.messageKey)}</p>
            {transcriptError.errorId ? (
              <p className="text-[11px] text-muted-foreground">
                {t('common:errorBoundary.errorReference')} {transcriptError.errorId}
              </p>
            ) : null}
            {transcriptError.retry ? (
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={transcriptError.retry} data-testid="workspace-subagent-transcript-retry">
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
          <div role="log" aria-label={t('agentsPanel.transcriptLabel')} aria-live="polite" className="flex min-h-full flex-col gap-3 p-3">
            {transcript.map((message, index) => {
              const role = normalizeMessageRole(message.role);
              const text = extractText(message);
              if (!text.trim()) return null;
              const userMessage = role === 'user';
              const systemMessage = role === 'system' || role === 'toolresult';
              return (
                <div key={message.id ?? `${role}-${index}`} className={cn('flex min-w-0', userMessage ? 'justify-end' : systemMessage ? 'justify-center' : 'justify-start')} data-message-role={role}>
                  <article className={cn(
                    'min-w-0 max-w-[92%] rounded-2xl px-3 py-2',
                    userMessage && 'bg-primary/10 text-foreground',
                    role === 'assistant' && 'border border-border/50 bg-surface-input text-foreground',
                    systemMessage && 'max-w-full rounded-lg border border-border/50 bg-muted/40 text-muted-foreground',
                  )}>
                    <p className={cn('mb-1 text-2xs font-medium', role === 'assistant' ? statusTone(entry?.status) : systemMessage ? 'text-muted-foreground' : 'text-foreground/70')}>
                      {role === 'assistant' ? identity.name : t(`agentsPanel.role.${role}`, { defaultValue: role })}
                    </p>
                    <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed">{text}</p>
                  </article>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="mt-2 shrink-0 border-t border-border/60 pt-2">
        <label htmlFor={dispatchInputId} className="mb-1 block text-2xs font-medium text-muted-foreground">
          {steerTarget ? tAgents('collaboration.controls.interruptSend') : t('agentsPanel.dispatchLabel')}
        </label>
        <div className="flex items-end gap-2">
          <Textarea
            id={dispatchInputId}
            ref={dispatchInputRef}
            value={dispatchTask}
            onChange={(event) => setDispatchTask(event.target.value)}
            placeholder={t('agentsPanel.dispatchPlaceholder', { role: identity.name })}
            rows={2}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229
                || dispatching || !childGeneration || sendPhase === 'unknown') return;
              event.preventDefault();
              void handleDispatch();
            }}
            className="min-h-0 flex-1 resize-none text-xs"
            data-testid="workspace-subagent-dispatch-input"
          />
          <Button
            type="button"
            size="sm"
            className="h-9 shrink-0 gap-1.5 px-3"
            disabled={!dispatchTask.trim() || dispatching || !childGeneration || sendPhase === 'unknown'}
            aria-label={steerTarget ? tAgents('collaboration.controls.interruptSend') : t('composer.send')}
            onClick={() => void handleDispatch()}
            data-testid="workspace-subagent-dispatch"
          >
            {dispatching
              ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              : <Send className="size-3.5" aria-hidden="true" />}
            <span>{steerTarget ? tAgents('collaboration.controls.interruptSend') : t('composer.send')}</span>
          </Button>
          {steerTarget && <Button type="button" variant="ghost" size="sm" disabled={dispatching || sendPhase === 'unknown'}
            onClick={() => { sendIntent.current = null; setArmedSteer(null); }}>
            {t('common:actions.cancel')}
          </Button>}
        </div>
      </div>
    </div>
  );
}

export default WorkspaceSubagentPanel;
