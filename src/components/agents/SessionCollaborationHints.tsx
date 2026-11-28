import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { hostApi } from '@/lib/host-api';
import { hostEvents } from '@/lib/host-events';
import type { AutonomySessionScope } from '@shared/types/identity-scope';
import type { SessionCollaborationHints as Hints } from '@shared/types/session-collaboration-hints';
import { SessionCollaborationContinuity } from './SessionCollaborationContinuity';

export function SessionCollaborationHints({ target, openSession }: { target: AutonomySessionScope; openSession?: () => void }) {
  const { t, i18n } = useTranslation('agents');
  const [open, setOpen] = useState(false);
  const [readerRevision, setReaderRevision] = useState(0);
  const [observation, setObservation] = useState<{ key: string; page: Hints } | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const refresh = useRef<() => void>(() => {});
  const { workspaceId, projectId, sessionKey, sessionGeneration } = target;
  const scopeKey = JSON.stringify([workspaceId, projectId, sessionKey, sessionGeneration, readerRevision]);
  const page = observation?.key === scopeKey ? observation.page : null;
  useEffect(() => {
    if (!open) return;
    let active = true, reading = false, dirty = false;
    let readerKey: string | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setObservation(null);
    async function read() {
      if (!active) return;
      if (reading) { dirty = true; return; }
      reading = true; setLoading(true); setFailed(false);
      try {
        const sender = await hostApi.sessions.collaborationSender();
        if (!active) return;
        if (!sender.source) throw new Error('COORDINATION_READER_UNAVAILABLE');
        readerKey = sender.source.scope.sessionKey;
        const result = await hostApi.sessions.collaborationHints({ requester: sender.source.scope,
          target: { workspaceId, projectId, sessionKey, sessionGeneration }, limit: 1 });
        if (!active) return;
        if (!result.success || !result.hints) throw new Error('COORDINATION_UNAVAILABLE');
        setObservation({ key: scopeKey, page: result.hints });
      } catch { if (active) { setFailed(true); setObservation(null); } }
      finally {
        reading = false;
        if (active) { setLoading(false); if (dirty) { dirty = false; schedule(); } }
      }
    }
    function schedule() {
      if (!active) return;
      // Keep the current read publishable; a burst requests at most one follow-up read.
      if (reading) { dirty = true; return; }
      if (timer) return;
      timer = setTimeout(() => { timer = undefined; void read(); }, 150);
    }
    const request = () => { if (timer) { clearTimeout(timer); timer = undefined; } void read(); };
    refresh.current = request;
    const navigation = hostEvents.onWorkspaceNavigationChanged(() => {
      active = false; setObservation(null); setReaderRevision(value => value + 1);
    });
    void read();
    const unsubscribe = hostEvents.onGatewayNotification(event => {
      if (!event.method?.startsWith('sessions.') && !event.method?.startsWith('session.')) return;
      const params = event.params && typeof event.params === 'object' && !Array.isArray(event.params) ? event.params : null;
      const key = typeof params?.sessionKey === 'string' ? params.sessionKey
        : typeof params?.key === 'string' ? params.key : undefined;
      if (key && readerKey && key !== sessionKey && key !== readerKey) return;
      schedule();
    });
    const reconnect = hostEvents.onGatewayStatus(status => { if (status.state === 'running') schedule(); });
    return () => { active = false; navigation(); unsubscribe(); reconnect(); if (timer) clearTimeout(timer); };
  }, [open, workspaceId, projectId, sessionKey, sessionGeneration, scopeKey]);
  const facts = page?.state === 'ready' ? page.task : null;
  const claim = facts?.claim;
  const blocked = facts?.dependencies.filter(item => item.state !== 'done') ?? [];
  const admission = page?.state === 'ready' || page?.state === 'empty' ? page.admission : null;
  const taskLink = (id: string) => `/task-ledger?${new URLSearchParams({ workspaceId: target.workspaceId, nodeId: id })}`;
  return <details className="rounded-md border border-border p-3" data-testid="collaboration-hints" onToggle={event => {
    if (!event.currentTarget.open) setObservation(null);
    setOpen(event.currentTarget.open);
  }}>
    <summary className="cursor-pointer rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{t('collaboration.hints.title')}</summary>
    {open && <div className="space-y-3 pt-3 text-sm">
      <p className="text-xs text-muted-foreground">{t('collaboration.hints.description')}</p>
      <p role="status" className="text-xs text-muted-foreground" data-testid="collaboration-hints-status">
        {loading ? t('collaboration.loading') : failed ? t('collaboration.page.unavailable')
          : page && !['ready', 'empty'].includes(page.state) ? t(`collaboration.page.${page.state}`)
            : page ? t('collaboration.hints.observedAt', { time: new Date(page.capturedAt).toLocaleString(i18n.language) }) : ''}
      </p>
      {facts && <>
        <p data-testid="collaboration-hints-role">{t(`collaboration.hints.role.${facts.referenceOnly ? 'observer' : 'bound'}`)}</p>
        {claim ? <p className="break-all text-xs">{t('collaboration.hints.writer', { session: claim.sessionKey, epoch: claim.epoch,
          state: t(`collaboration.hints.claim.${claim.state}`), time: new Date(claim.expiresAt).toLocaleString(i18n.language) })}</p>
          : <p>{t('collaboration.hints.writerUnknown')}</p>}
        {facts.pendingOperations > 0 && <p>{t('collaboration.hints.pending', { count: facts.pendingOperations })}</p>}
        <p data-testid="collaboration-hints-relation">{t(`collaboration.hints.relation.${facts.relation}`)}</p>
        {facts.sharedArtifacts.length > 0 && <ul className="list-inside list-disc break-all text-xs">{facts.sharedArtifacts.map(path => <li key={path}>{path}</li>)}</ul>}
        {blocked.length > 0 && <div><p>{t('collaboration.hints.dependencies')}</p>
          <ul className="space-y-2 pt-1">{blocked.map(item => <li key={item.taskNodeId} className="break-all text-xs">
            <Link className="inline-flex min-h-9 items-center rounded-sm underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" to={taskLink(item.taskNodeId)}>
              {item.taskNodeId}</Link> · {t(`collaboration.hints.taskState.${item.state}`)}
          </li>)}</ul></div>}
        <Link className="inline-flex min-h-11 items-center rounded-md border border-border px-3 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-testid="collaboration-hints-open-task" to={taskLink(facts.task.taskNodeId)}>{t('collaboration.openTask')}</Link>
      </>}
      {page && ['ready', 'empty'].includes(page.state) && !facts && <p data-testid="collaboration-hints-task-status">
        {t(page.taskReadState === 'unavailable' ? 'collaboration.hints.taskUnavailable' : 'collaboration.hints.noTask')}</p>}
      {admission && <p data-testid="collaboration-hints-admission">{t(`collaboration.hints.admission.${admission.fenced ? 'fenced' : 'observed'}`,
        { active: admission.active, waiting: admission.waiters })}</p>}
      {page && ['ready', 'empty'].includes(page.state) && <SessionCollaborationContinuity key={scopeKey} hints={page} openSession={openSession} />}
      <Button type="button" variant="outline" className="h-11 sm:h-9" disabled={loading} onClick={() => refresh.current()}>{t('collaboration.refresh')}</Button>
    </div>}
  </details>;
}
