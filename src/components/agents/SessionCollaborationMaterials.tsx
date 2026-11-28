import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { hostApi } from '@/lib/host-api';
import { subscribeSessionCollaboration } from '@/stores/session-collaboration';
import type { AutonomySessionScope } from '@shared/types/identity-scope';
import type {
  SessionCollaborationMaterialPage, SessionCollaborationMaterialQuery, SessionCollaborationMaterialState, SessionCollaborationMaterialSummary,
} from '@shared/types/session-collaboration-material';

export function SessionCollaborationMaterials({ target, reference }: { target?: AutonomySessionScope;
  reference?: Pick<SessionCollaborationMaterialSummary, 'source' | 'ref'> }) {
  const { t } = useTranslation('agents');
  const searchId = useId();
  const sequence = useRef(0);
  const [input, setInput] = useState('');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(Boolean(reference));
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState(false);
  const [page, setPage] = useState<SessionCollaborationMaterialPage | null>(null);
  const [reader, setReader] = useState<AutonomySessionScope | null>(null);
  const [selected, setSelected] = useState<Pick<SessionCollaborationMaterialSummary, 'source' | 'ref'> | null>(null);
  const [detail, setDetail] = useState<SessionCollaborationMaterialPage['detail']>(null);
  const [observedState, setObservedState] = useState<SessionCollaborationMaterialState | null>(null);
  useEffect(() => () => { sequence.current++; }, []);
  useEffect(() => {
    if (!open || !selected || !detail || !reader) return;
    void hostApi.sessions.presentCollaborationMaterial({
      id: crypto.randomUUID(), requester: reader, target: selected.source, ref: selected.ref,
    }).catch(() => {});
    return subscribeSessionCollaboration({
      id: crypto.randomUUID(), condition: 'material-changed', materialRef: selected.ref, observedMaterialState: detail.state,
      query: { requester: reader, target: selected.source, limit: 1 },
    }, result => {
      if (result.event?.materialState) setObservedState(result.event.materialState);
      else if (result.state === 'unknown' || result.state === 'stale' || result.state === 'unavailable') setObservedState('unknown');
    });
  }, [open, selected, detail, reader]);

  const request = useCallback(async (query: Omit<SessionCollaborationMaterialQuery, 'requester'>) => {
    const revision = ++sequence.current;
    setLoading(true);
    setFailure(false);
    try {
      const active = await hostApi.sessions.collaborationSender();
      if (sequence.current !== revision) return;
      if (!active.source) throw new Error('MATERIAL_READER_UNAVAILABLE');
      const result = await hostApi.sessions.collaborationMaterials({ ...query, requester: active.source.scope });
      if (sequence.current !== revision) return;
      if (!result.success || !result.materials) throw new Error('MATERIAL_QUERY_UNAVAILABLE');
      setReader(active.source.scope);
      if (query.ref) {
        setDetail(result.materials.detail);
        setFailure(result.materials.state !== 'ready');
      } else setPage(result.materials);
    } catch {
      if (sequence.current === revision) setFailure(true);
    } finally {
      if (sequence.current === revision) setLoading(false);
    }
  }, []);
  const list = (text: string, cursor?: string) => {
    setSelected(null);
    setDetail(null);
    setObservedState(null);
    setSearch(text);
    if (!cursor) setPage(null);
    void request({ target, ...(text ? { search: text } : {}), cursor });
  };
  const openMaterial = useCallback((item: Pick<SessionCollaborationMaterialSummary, 'source' | 'ref'>) => {
    setSelected(item);
    setDetail(null);
    setObservedState(null);
    void request({ target: item.source, ref: item.ref });
  }, [request]);
  useEffect(() => { if (reference) openMaterial(reference); }, [reference, openMaterial]); // Exact inherited version, read through the current owner.
  const status = loading ? t('collaboration.loading') : failure ? t('collaboration.materials.unavailable')
    : page?.state === 'empty' ? t('collaboration.materials.empty')
    : page?.reason ? t('collaboration.materials.unavailable')
    : page?.state === 'unknown' ? t('collaboration.materials.moreToRead') : '';
  const material = detail?.material;
  const stateLabel = (state: SessionCollaborationMaterialState) => t(`collaboration.materials.states.${state}`);

  return <details open={reference ? true : undefined} data-testid="collaboration-materials" className="min-w-0 rounded-md border border-border p-3"
    onToggle={event => {
      setOpen(event.currentTarget.open);
      if (event.currentTarget.open) {
        if (!reference && !page && !loading) list(search);
      }
      // Collapsing only hides the view; the pending selection still belongs to this scope.
    }}>
    <summary className="cursor-pointer rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {t('collaboration.materials.title')}
    </summary>
    <div className="space-y-3 pt-3">
      <form className="flex flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); list(input.trim()); }}>
        <div className="min-w-0 grow space-y-1">
          <label htmlFor={searchId} className="text-xs text-muted-foreground">{t('collaboration.materials.filter')}</label>
          <Input id={searchId} type="search" className="h-11 sm:h-9" value={input} maxLength={300}
            onChange={event => setInput(event.target.value)} data-testid="collaboration-material-search" />
        </div>
        <Button type="submit" variant="outline" className="h-11 sm:h-9">{t('collaboration.materials.search')}</Button>
      </form>
      <p role="status" aria-atomic="true" className="text-xs text-muted-foreground" data-testid="collaboration-material-status">
        {status || (observedState ? t('collaboration.materials.changed', { state: stateLabel(observedState) }) : '')}
      </p>
      {page?.items.length ? <ul className="divide-y divide-border rounded-md border border-border">
        {page.items.map(item => <li key={JSON.stringify(item.ref)}>
          <button type="button" className="block w-full space-y-1 p-3 text-left hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring dark:hover:bg-white/5 aria-pressed:bg-black/5 dark:aria-pressed:bg-white/10"
            aria-pressed={item === selected} onClick={() => openMaterial(item)}>
            <span className="block break-words text-sm">{item.summary}{item.truncated ? '…' : ''}</span>
            <span className="block break-all text-xs text-muted-foreground">{item.source.sessionKey} · {stateLabel(item === selected && observedState ? observedState : item.state)}</span>
          </button>
        </li>)}
      </ul> : null}
      {page?.nextCursor && <Button type="button" variant="outline" className="h-11 sm:h-9" disabled={loading}
        onClick={() => list(search, page.nextCursor!)}>{t('collaboration.more')}</Button>}
      {material && detail && selected && <div className="space-y-2 rounded-md border border-border p-3 text-sm"
        data-testid="collaboration-material-detail" data-material-state={observedState ?? detail.state}>
        <p className="whitespace-pre-wrap break-words">{material.summary}</p>
        <p className="break-all text-xs text-muted-foreground">{t('collaboration.materials.version', { version: material.version, revision: material.taskRevision })} · {stateLabel(observedState ?? detail.state)}</p>
        {material.applicability?.length ? <ul className="list-inside list-disc break-words">{material.applicability.map((condition, index) => <li key={index}>{condition}</li>)}</ul> : null}
        {material.artifactRefs?.length ? <ul className="space-y-1 break-all text-xs">{material.artifactRefs.map(({ path, sha256 }) => <li key={path + sha256}>{path} · {sha256}</li>)}</ul> : null}
        {material.evidenceRefs.length > 0 && <p className="break-all text-xs">{t('collaboration.materials.evidence')} · {material.evidenceRefs.join(' · ')}</p>}
        {(detail.related ?? material.conflictsWith ?? (material.supersedes ? [material.supersedes] : [])).map(ref =>
          <p key={ref.id} className="break-all text-xs">{t('collaboration.materials.related')} · {ref.id} · {ref.contentDigest}</p>)}
        {detail.retainedEvidence?.map(ref => <p key={ref.receiptId} className="break-all text-xs">
          {t('collaboration.materials.retained')} · {ref.receiptId} · {ref.sha256}
        </p>)}
        <Link className="inline-flex min-h-9 items-center rounded-md border border-border px-3 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          to={`/task-ledger?${new URLSearchParams({ workspaceId: selected.source.workspaceId, nodeId: material.taskNodeId })}`}>
          {t('collaboration.openTask')}
        </Link>
      </div>}
    </div>
  </details>;
}
