import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { RefreshCw, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { hostApi } from '@/lib/host-api';
import { hostEvents } from '@/lib/host-events';
import { readSessionCollaborationPage } from '@/lib/session-read-model';
import { activateWorkspaceScopedSession } from '@/lib/workspace-session';
import { openWorkspacePanel } from '@/stores/artifact-panel';
import { EMPTY_COLLABORATION_VIEW, subscribeSessionCollaboration, useSessionCollaborationUi } from '@/stores/session-collaboration';
import { parseSessionCollaborationQuery, type SessionCollaborationPage, type SessionCollaborationRow } from '@shared/types/session-collaboration';
import type { AutonomyProjectScope, AutonomySessionScope } from '@shared/types/identity-scope';
import type { SessionActivitySnapshot } from '@shared/types/session-activity';
import { SessionCollaborationMessages } from './SessionCollaborationMessages';
import { invokeSessionCollaborationControl } from '@/lib/session-collaboration-control';
import { SESSION_COLLABORATION_CONTROLS, type SessionCollaborationControl } from '@shared/types/session-collaboration-control';

export const collaborationScopeKey = (scope: AutonomySessionScope) => JSON.stringify([scope.workspaceId, scope.projectId, scope.sessionKey, scope.sessionGeneration]);

export function SessionCollaborationPanel({ requester, workspace }: { requester?: AutonomySessionScope; workspace?: AutonomyProjectScope }) {
  const { t, i18n } = useTranslation('agents');
  const navigate = useNavigate();
  const viewKey = JSON.stringify([requester, workspace]);
  const view = useSessionCollaborationUi(state => state.views[viewKey]) ?? EMPTY_COLLABORATION_VIEW;
  const updateView = useSessionCollaborationUi(state => state.updateView);
  const [cursor, setCursor] = useState<string>();
  const [observed, setObserved] = useState<{ key: string; page: SessionCollaborationPage; stale: boolean } | null>(null);
  const [selectedRow, setSelectedRow] = useState<{ key: string; row: SessionCollaborationRow } | null>(null);
  const [detail, setDetail] = useState<{ key: string; snapshot: SessionActivitySnapshot } | null>(null);
  const [detailState, setDetailState] = useState<{ key: string; state: SessionCollaborationPage['state'] } | null>(null);
  const [loading, setLoading] = useState(false), [readState, setReadState] = useState('not_read');
  const revision = useRef(0);
  const query = useMemo(() => requester ? parseSessionCollaborationQuery({ requester, ...(workspace ? { workspace } : {}),
    ...(view.search ? { search: view.search } : {}), ...(cursor ? { cursor } : {}) }) : null, [requester, workspace, view.search, cursor]);
  const queryKey = JSON.stringify(query);
  const selectedKey = view.selected ? collaborationScopeKey(view.selected) : null;
  const detailKey = `${viewKey}:${selectedKey}`;
  const current = useRef({ viewKey, selectedKey }); current.current = { viewKey, selectedKey };
  const page = observed?.key === queryKey ? observed.page : null;
  const row = selectedRow?.key === detailKey ? selectedRow.row : null;
  const snapshot = detail?.key === detailKey ? detail.snapshot : null;
  const detailIssue = detailState?.key === detailKey && detailState.state !== 'ready' ? detailState.state : null;

  const refresh = useCallback(async () => {
    if (!query) return;
    const token = ++revision.current;
    setLoading(true);
    const value = await readSessionCollaborationPage(query, hostApi.sessionActivity.query);
    if (token !== revision.current || current.current.viewKey !== viewKey) return;
    setLoading(false); setReadState(value.state);
    setObserved(previous => value.state === 'ready' || value.state === 'empty'
      ? { key: queryKey, page: value, stale: false }
      : previous?.key === queryKey ? { ...previous, stale: true } : { key: queryKey, page: value, stale: true });
  }, [query, viewKey, queryKey]);
  useEffect(() => { const timer = setTimeout(() => void refresh(), 120); return () => { clearTimeout(timer); revision.current++; }; }, [refresh]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => { if (timer) return; timer = setTimeout(() => { timer = undefined; void refresh(); }, 150); };
    const notification = hostEvents.onGatewayNotification(value => { if (value.method?.startsWith('sessions.') || value.method?.startsWith('session.')) schedule(); });
    const gateway = hostEvents.onGatewayStatus(status => { if (status.state === 'running') schedule(); });
    return () => { notification(); gateway(); if (timer) clearTimeout(timer); };
  }, [refresh]);
  useEffect(() => { setCursor(undefined); }, [viewKey, view.search]);

  useEffect(() => {
    if (!requester || !view.selected) return;
    const scope = view.selected;
    let active = true;
    let detailRevision = 0;
    const target = parseSessionCollaborationQuery({ requester, target: scope, limit: 1 });
    const isCurrent = () => active && current.current.viewKey === viewKey && current.current.selectedKey === selectedKey;
    const observe = (value: SessionCollaborationPage) => {
      if (!isCurrent()) return false;
      setDetailState({ key: detailKey, state: value.state });
      const observedRow = value.items[0];
      if (value.state === 'ready' && observedRow) {
        setSelectedRow({ key: detailKey, row: observedRow });
        return true;
      }
      if (value.state === 'empty' || value.state === 'stale' || value.reason === 'not-visible'
        || value.reason === 'scope-mismatch' || value.reason === 'owner-missing') {
        detailRevision++;
        setSelectedRow(null);
        setDetail(null);
      }
      return false;
    };
    void readSessionCollaborationPage(target, hostApi.sessionActivity.query).then(async value => {
      if (!observe(value)) return;
      const revision = detailRevision;
      const result = await hostApi.sessionActivity.read({ scope });
      if (isCurrent() && revision === detailRevision && result.success && result.snapshot)
        setDetail({ key: detailKey, snapshot: result.snapshot });
    }).catch(() => {});
    const unsubscribe = subscribeSessionCollaboration({ id: crypto.randomUUID(), query: target, condition: 'changed' }, value => {
      observe(value.page);
    });
    return () => { active = false; unsubscribe(); };
  }, [requester, view.selected, viewKey, selectedKey, detailKey]);

  const openSession = async (worker = false) => {
    if (!requester || !row?.detail) return;
    const isCurrent = () => current.current.viewKey === viewKey && current.current.selectedKey === selectedKey;
    const fresh = await readSessionCollaborationPage(parseSessionCollaborationQuery({ requester, target: row.detail.scope, limit: 1 }), hostApi.sessionActivity.query);
    if (!isCurrent()) return;
    if (fresh.state !== 'ready') { setReadState(fresh.state); return; }
    const origin = fresh.items[0].sources.origin.state === 'ready' ? fresh.items[0].sources.origin.value : null;
    const key = worker ? origin?.spawnedBy ?? origin?.parentSessionKey : row.sessionKey;
    if (!key) return;
    try {
      if (!await activateWorkspaceScopedSession(row.detail.scope.workspaceId, key, isCurrent)) return;
      navigate('/chat');
      if (worker) openWorkspacePanel({ panel: 'subagent', sessionKey: row.sessionKey });
    } catch { setReadState('unavailable'); }
  };
  const sourceText = (state: string) => t(`collaboration.sources.${state}`);

  return <section className="min-w-0 space-y-3 rounded-lg border border-border bg-background p-3" data-testid="session-collaboration">
    <header className="flex flex-wrap items-start justify-between gap-2">
      <div><h2 className="font-serif text-lg font-normal tracking-tight">{t('collaboration.title')}</h2><p className="text-xs text-muted-foreground">{t('collaboration.description')}</p></div>
      <Button type="button" variant="outline" className="h-11 sm:h-9" onClick={() => void refresh()} disabled={!requester || loading} data-testid="collaboration-refresh">
        <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />{t('collaboration.refresh')}
      </Button>
    </header>
    {!requester ? <p className="text-sm text-muted-foreground">{t('collaboration.requesterMissing')}</p> : <>
      <label className="block space-y-1 text-xs text-muted-foreground">{t('collaboration.search')}
        <Input className="h-11 sm:h-9" value={view.search} maxLength={512} onChange={event => { setCursor(undefined); updateView(viewKey, { search: event.target.value }); }} data-testid="collaboration-search" />
      </label>
      <p role="status" aria-atomic="true" className="text-xs text-muted-foreground" data-testid="collaboration-state">
        {loading ? t('collaboration.loading') : observed?.key === queryKey && observed.stale && observed.page.items.length > 0
          ? t('collaboration.stale') : t(`collaboration.page.${observed?.key === queryKey ? readState : 'not_read'}`, { count: page?.items.length ?? 0 })}
      </p>
      <div className="max-h-80 divide-y divide-border overflow-y-auto rounded-md border border-border" data-testid="collaboration-list">
        {page?.items.map(item => {
          const scope = item.detail?.scope, active = scope && selectedKey === collaborationScopeKey(scope);
          return <button key={scope ? collaborationScopeKey(scope) : item.sessionKey} type="button" className={`block w-full space-y-1 p-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${active ? 'bg-black/5 dark:bg-white/10' : 'hover:bg-black/5 dark:hover:bg-white/5'}`}
            disabled={!scope} aria-pressed={Boolean(active)} data-session-key={item.sessionKey} data-testid={`collaboration-row-${encodeURIComponent(item.sessionKey)}`}
            onClick={() => { if (scope) { updateView(viewKey, { selected: scope }); setSelectedRow({ key: `${viewKey}:${collaborationScopeKey(scope)}`, row: item }); setDetailState(null); } }}>
            <span className="flex flex-wrap items-center justify-between gap-2"><span className="break-words text-sm font-medium">{item.label}</span><span className="text-xs text-muted-foreground">{t(`collaboration.status.${item.status}`)}</span></span>
            <span className="block break-words text-sm">{item.sources.goal.state === 'ready' ? item.sources.goal.value?.text : sourceText(item.sources.goal.state)}</span>
            <span className="block break-words text-xs text-muted-foreground">{item.sources.actions.state === 'ready' ? item.sources.actions.value.map(action => action.label).join(' · ') : sourceText(item.sources.actions.state)}</span>
            <span className="block text-xs text-muted-foreground">{t('collaboration.results')}: {sourceText('not_read')} · {t('collaboration.resources')}: {sourceText('not_read')}</span>
          </button>;
        })}
      </div>
      {page?.unknownMatches ? <p className="text-xs text-muted-foreground">{t('collaboration.unknownMatches', { count: page.unknownMatches })}</p> : null}
      {page?.nextCursor && <Button type="button" variant="outline" onClick={() => setCursor(page.nextCursor!)} disabled={loading} data-testid="collaboration-more">{t('collaboration.more')}</Button>}
      {view.selected && <div className="space-y-3 border-t border-border pt-3" data-testid="collaboration-detail">
        <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="break-words text-sm font-medium">
          {row?.label ?? (detailIssue ? t(`collaboration.page.${detailIssue}`, { count: 0 }) : t('collaboration.loading'))}
        </h3>
          <Button type="button" variant="ghost" onClick={() => updateView(viewKey, { selected: null })}>{t('collaboration.close')}</Button></div>
        {row && detailIssue && <p role="status" aria-atomic="true" className="text-sm text-muted-foreground">
          {t('collaboration.stale')} {t(`collaboration.page.${detailIssue}`, { count: 0 })}
        </p>}
        {row && <>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" className="h-9" onClick={() => void openSession()}><ExternalLink className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />{t('collaboration.openSession')}</Button>
            {row.sources.origin.state === 'ready' && (row.sources.origin.value.spawnedBy || row.sources.origin.value.parentSessionKey)
              && <Button type="button" variant="outline" className="h-9" onClick={() => void openSession(true)}>{t('collaboration.openWorker')}</Button>}
            {row.sources.tasks.value?.map(task => <Link key={task.taskNodeId} className="inline-flex min-h-9 items-center rounded-md border border-border px-3 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              to={`/task-ledger?${new URLSearchParams({ workspaceId: row.detail!.scope.workspaceId, nodeId: task.taskNodeId })}`}>{t('collaboration.openTask')}</Link>)}
          </div>
          <p className="break-words text-sm">{row.sources.goal.state === 'ready' ? row.sources.goal.value?.text : sourceText(row.sources.goal.state)}</p>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 text-xs">
            <dt>{t('collaboration.resources')}</dt><dd>{sourceText(snapshot?.resources ? 'ready' : 'not_read')}</dd>
            <dt>{t('collaboration.results')}</dt><dd>{sourceText('not_read')}</dd>
          </dl>
          {requester && row.detail && <SessionCollaborationMessages requester={requester} target={row.detail.scope} />}
          {requester && row.detail && <details className="rounded-md border border-border p-3 text-xs"><summary className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{t('collaboration.controls.title')}</summary>
            <div className="flex flex-wrap gap-2 pt-3">{(Object.keys(SESSION_COLLABORATION_CONTROLS) as SessionCollaborationControl[]).filter(action => action !== 'message').map(action => <Button type="button" key={action} variant="outline"
              disabled={SESSION_COLLABORATION_CONTROLS[action].requiresRun && !row.sources.run.value}
              onClick={() => void invokeSessionCollaborationControl({ action, requester, target: row.detail!.scope, run: row.sources.run.value }, () => openSession()).catch(() => setReadState('unavailable'))}>
              {t(`collaboration.controls.${action}`)}</Button>)}</div>
          </details>}
          <details className="rounded-md border border-border p-2 text-xs text-muted-foreground"><summary className="cursor-pointer rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{t('collaboration.sourcesTitle')}</summary>
            <div className="space-y-1 break-all pt-2"><p>{view.selected.workspaceId} · {view.selected.projectId}</p><p>{view.selected.sessionKey} · {view.selected.sessionGeneration}</p>
              <p>{row.sources.session.readAt === null ? sourceText('unknown') : new Date(row.sources.session.readAt).toLocaleString(i18n.language)}</p>
              {Object.entries(row.sources).map(([name, source]) => <p key={name}>{t(`collaboration.fields.${name}`)}: {source.owner} · {sourceText(source.state)}</p>)}
            </div></details>
        </>}
      </div>}
    </>}
  </section>;
}
