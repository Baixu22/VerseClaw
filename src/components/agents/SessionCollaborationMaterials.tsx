import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { hostApi } from '@/lib/host-api';
import type { AutonomySessionScope } from '@shared/types/identity-scope';
import type {
  SessionCollaborationMaterialPage, SessionCollaborationMaterialQuery, SessionCollaborationMaterialSummary,
} from '@shared/types/session-collaboration-material';

export function SessionCollaborationMaterials({ requester, target }: { requester: AutonomySessionScope; target?: AutonomySessionScope }) {
  const { t } = useTranslation('agents');
  const searchId = useId();
  const sequence = useRef(0);
  const [input, setInput] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState(false);
  const [page, setPage] = useState<SessionCollaborationMaterialPage | null>(null);
  const [selected, setSelected] = useState<SessionCollaborationMaterialSummary | null>(null);
  const [detail, setDetail] = useState<SessionCollaborationMaterialPage['detail']>(null);
  useEffect(() => () => { sequence.current++; }, []);

  const request = async (query: SessionCollaborationMaterialQuery) => {
    const revision = ++sequence.current;
    setLoading(true);
    setFailure(false);
    try {
      const result = await hostApi.sessions.collaborationMaterials(query);
      if (sequence.current !== revision) return;
      if (!result.success || !result.materials) throw new Error('MATERIAL_QUERY_UNAVAILABLE');
      if (query.ref) {
        setDetail(result.materials.detail);
        setFailure(result.materials.state !== 'ready');
      } else setPage(result.materials);
    } catch {
      if (sequence.current === revision) setFailure(true);
    } finally {
      if (sequence.current === revision) setLoading(false);
    }
  };
  const list = (text: string, cursor?: string) => {
    setSelected(null);
    setDetail(null);
    setSearch(text);
    if (!cursor) setPage(null);
    void request({ requester, target, ...(text ? { search: text } : {}), cursor });
  };
  const openMaterial = (item: SessionCollaborationMaterialSummary) => {
    setSelected(item);
    setDetail(null);
    void request({ requester, target: item.source, ref: item.ref });
  };
  const status = loading ? t('collaboration.loading') : failure ? t('collaboration.materials.unavailable')
    : page?.state === 'empty' ? t('collaboration.materials.empty')
    : page?.reason ? t('collaboration.materials.unavailable')
    : page?.state === 'unknown' ? t('collaboration.materials.moreToRead') : '';
  const material = detail?.material;

  return <details data-testid="collaboration-materials" className="min-w-0 rounded-md border border-border p-3"
    onToggle={event => {
      if (event.currentTarget.open) {
        if (!page && !loading) list(search);
      } else {
        sequence.current++;
        setLoading(false);
      }
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
      <p role="status" aria-atomic="true" className="text-xs text-muted-foreground" data-testid="collaboration-material-status">{status}</p>
      {page?.items.length ? <ul className="divide-y divide-border rounded-md border border-border">
        {page.items.map(item => <li key={JSON.stringify(item.ref)}>
          <button type="button" className="block w-full space-y-1 p-3 text-left hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring dark:hover:bg-white/5 aria-pressed:bg-black/5 dark:aria-pressed:bg-white/10"
            aria-pressed={item === selected} onClick={() => openMaterial(item)}>
            <span className="block break-words text-sm">{item.summary}{item.truncated ? '…' : ''}</span>
            <span className="block break-all text-xs text-muted-foreground">{item.source.sessionKey} · {t(`collaboration.materials.states.${item.state}`)}</span>
          </button>
        </li>)}
      </ul> : null}
      {page?.nextCursor && <Button type="button" variant="outline" className="h-11 sm:h-9" disabled={loading}
        onClick={() => list(search, page.nextCursor!)}>{t('collaboration.more')}</Button>}
      {material && detail && selected && <div className="space-y-2 rounded-md border border-border p-3 text-sm" data-testid="collaboration-material-detail">
        <p className="whitespace-pre-wrap break-words">{material.summary}</p>
        <p className="break-all text-xs text-muted-foreground">{t('collaboration.materials.version', { version: material.version, revision: material.taskRevision })} · {t(`collaboration.materials.states.${detail.state}`)}</p>
        {material.applicability?.length ? <ul className="list-inside list-disc break-words">{material.applicability.map((condition, index) => <li key={index}>{condition}</li>)}</ul> : null}
        {material.artifactRefs?.length ? <ul className="space-y-1 break-all text-xs">{material.artifactRefs.map(({ path, sha256 }) => <li key={path + sha256}>{path} · {sha256}</li>)}</ul> : null}
        {material.evidenceRefs.length > 0 && <p className="break-all text-xs">{t('collaboration.materials.evidence')} · {material.evidenceRefs.join(' · ')}</p>}
        <Link className="inline-flex min-h-9 items-center rounded-md border border-border px-3 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          to={`/task-ledger?${new URLSearchParams({ workspaceId: selected.source.workspaceId, nodeId: material.taskNodeId })}`}>
          {t('collaboration.openTask')}
        </Link>
      </div>}
    </div>
  </details>;
}
