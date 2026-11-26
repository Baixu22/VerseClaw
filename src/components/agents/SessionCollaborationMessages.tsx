import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { hostApi } from '@/lib/host-api';
import { useSessionCollaborationUi } from '@/stores/session-collaboration';
import { SESSION_COLLABORATION_PURPOSES, type SessionCollaborationMessagePage, type SessionCollaborationMessageReceipt } from '@shared/types/session-collaboration-message';
import type { AutonomySessionScope } from '@shared/types/identity-scope';
import type { SessionActivityTaskReference } from '@shared/types/session-activity';

type MessageTaskReference = Pick<SessionActivityTaskReference, 'authorityId' | 'taskNodeId' | 'revision' | 'digest'>;

export function SessionCollaborationMessages({ requester, target, tasks = [] }: {
  requester: AutonomySessionScope;
  target: AutonomySessionScope;
  tasks?: readonly MessageTaskReference[];
}) {
  const { t } = useTranslation('agents');
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ key: string; taskNodeId?: string; cursor?: string } | null>(null);
  const [page, setPage] = useState<{ key: string; value: SessionCollaborationMessagePage } | null>(null);
  const [receipt, setReceipt] = useState<{ key: string; value: SessionCollaborationMessageReceipt } | null>(null);
  const [sourceRead, setSourceRead] = useState<{ key: string; value: { scope: AutonomySessionScope; name: string } | null } | null>(null), [state, setState] = useState('not_read');
  const readKey = JSON.stringify([requester, target]), active = useRef(readKey); active.current = readKey;
  const listRequest = useRef(0), receiptRequest = useRef(0);
  const view = position?.key === readKey ? position : null;
  const taskNodeId = tasks.some(task => task.taskNodeId === view?.taskNodeId) ? view?.taskNodeId : undefined;
  const cursor = taskNodeId === view?.taskNodeId ? view?.cursor : undefined;
  const listKey = JSON.stringify([readKey, taskNodeId, cursor]);
  const activeList = useRef(listKey); activeList.current = listKey;
  const source = sourceRead?.key === readKey ? sourceRead.value : null;
  const draftKey = source ? JSON.stringify([source.scope, target]) : null;
  const draft = useSessionCollaborationUi(value => draftKey ? value.messageDrafts[draftKey] : undefined);
  const update = useSessionCollaborationUi(value => value.updateMessageDraft);
  const rows = page?.key === listKey ? page.value : null, selected = receipt?.key === readKey ? receipt.value : null;
  const linkedTask = selected?.message.task;
  const taskLink = linkedTask && tasks.some(task => task.authorityId === linkedTask.authorityId
    && task.taskNodeId === linkedTask.taskNodeId && task.revision === linkedTask.revision && task.digest === linkedTask.digest)
    ? `/task-ledger?${new URLSearchParams({ workspaceId: target.workspaceId, nodeId: linkedTask.taskNodeId })}`
    : null;
  const refresh = useCallback(async () => {
    if (!open || activeList.current !== listKey) return;
    const request = ++listRequest.current;
    try {
      const value = await hostApi.sessions.collaborationMessages({ requester, target,
        ...(taskNodeId ? { taskNodeId } : {}), ...(cursor ? { cursor } : {}) });
      if (activeList.current === listKey && listRequest.current === request) {
        setPage({ key: listKey, value: value.messages });
        setState(value.messages.state);
      }
    } catch {
      if (activeList.current === listKey && listRequest.current === request) setState('unavailable');
    }
  }, [open, requester, target, taskNodeId, cursor, listKey]);
  useEffect(() => { void refresh(); return () => { listRequest.current++; }; }, [refresh]);
  useEffect(() => { if (!open) return; let alive = true;
    void hostApi.sessions.collaborationSender().then(value => { if (alive && active.current === readKey) setSourceRead({ key: readKey, value: value.source }); }).catch(() => { if (alive) setSourceRead({ key: readKey, value: null }); });
    return () => { alive = false; };
  }, [open, readKey]);
  useEffect(() => () => { receiptRequest.current++; }, [open, readKey]);
  useEffect(() => { if (open && draftKey && !draft) update(draftKey, {}); }, [open, draftKey, draft, update]);
  const readReceipt = async (id: string) => {
    const request = ++receiptRequest.current;
    try {
      const result = await hostApi.sessions.collaborationMessages({ requester, target, id });
      if (!result.success) throw new Error('COLLABORATION_RECEIPT_UNAVAILABLE');
      const { messages } = result;
      if (active.current !== readKey || receiptRequest.current !== request) return null;
      setReceipt(messages.receipt ? { key: readKey, value: messages.receipt } : null);
      if (!messages.receipt) setState(messages.state);
      return messages;
    } catch {
      if (active.current === readKey && receiptRequest.current === request) {
        setReceipt(null);
        setState('unavailable');
      }
      return null;
    }
  };
  const send = async () => {
    if (!source || !draftKey || !draft?.text.trim() || draft.phase !== 'draft') return;
    update(draftKey, { phase: 'sending' });
    try {
      const result = await hostApi.sessions.sendCollaborationMessage({ id: draft.id, target, purpose: draft.purpose, message: draft.text,
        expectedSource: source.scope, ...(draft.replyTo ? { replyTo: draft.replyTo } : {}) });
      if (useSessionCollaborationUi.getState().messageDrafts[draftKey]?.id === draft.id) {
        if (result.success && ['accepted', 'queued', 'delivered', 'replied'].includes(result.phase)) update(draftKey, { id: crypto.randomUUID(), text: '', phase: 'draft', replyTo: undefined });
        else update(draftKey, { phase: result.phase === 'unknown' ? 'unknown' : 'draft' });
      }
      if (active.current !== readKey) return;
      if (result.receipt) setReceipt({ key: readKey, value: result.receipt });
      await refresh();
      if (active.current === readKey) setState(result.phase);
    } catch { if (useSessionCollaborationUi.getState().messageDrafts[draftKey]?.id === draft.id) update(draftKey, { phase: 'unknown' }); if (active.current === readKey) setState('unknown'); }
  };
  const check = async () => {
    if (!draft || !draftKey) return;
    const messages = await readReceipt(draft.id);
    if (!messages || useSessionCollaborationUi.getState().messageDrafts[draftKey]?.id !== draft.id) return;
    const current = messages.receipt;
    if (!current) {
      if (messages.state === 'empty') update(draftKey, { phase: 'draft' });
      return;
    }
    if (['accepted', 'queued', 'delivered', 'replied'].includes(current.phase)) update(draftKey, { id: crypto.randomUUID(), text: '', phase: 'draft', replyTo: undefined });
    else if (['rejected', 'expired'].includes(current.phase)) update(draftKey, { phase: 'draft' });
  };
  return <details className="rounded-md border border-border p-3" onToggle={event => setOpen(event.currentTarget.open)} data-testid="collaboration-messages">
    <summary className="cursor-pointer text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{t('collaboration.messages.title')}</summary>
    {open && <div className="space-y-3 pt-3">
      <div className="flex items-center justify-between gap-2"><p role="status" aria-atomic="true" className="text-xs text-muted-foreground">{t(`collaboration.messages.states.${state}`)}</p>
        <Button type="button" variant="outline" onClick={() => void refresh()}>{t('collaboration.refresh')}</Button></div>
      {tasks.length > 0 && <label className="block space-y-1 text-xs">{t('collaboration.fields.tasks')}
        <select className="block min-h-9 w-full rounded-md border border-border bg-surface-input px-2" value={taskNodeId ?? ''} data-testid="collaboration-message-task-filter"
          onChange={event => setPosition({ key: readKey, taskNodeId: event.target.value || undefined })}>
          <option value="">{t('collaboration.messages.allTasks')}</option>
          {[...new Set(tasks.map(task => task.taskNodeId))].map(id => <option key={id} value={id}>{id}</option>)}
        </select>
      </label>}
      <div className="max-h-60 divide-y divide-border overflow-y-auto">
        {rows?.items.map(item => <button type="button" key={item.header.id} className="block w-full space-y-1 rounded-sm py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => void readReceipt(item.header.id)}>
          <span className="block text-xs text-muted-foreground">{t(`collaboration.messages.purposes.${item.header.purpose}`)} · {t(`collaboration.messages.states.${item.phase}`)}</span>
          <span className="block break-words text-sm">{item.header.preview}</span>
        </button>)}
      </div>
      {rows?.nextCursor && <Button type="button" variant="outline" onClick={() => setPosition({ key: readKey, taskNodeId, cursor: rows.nextCursor! })}>{t('collaboration.more')}</Button>}
      {selected && <article className="space-y-2 border-t border-border pt-3" data-testid="collaboration-message-receipt">
        <p className="break-all text-xs text-muted-foreground">{t('collaboration.messages.from')}: {selected.message.source.sessionKey} · {selected.message.source.sessionGeneration}</p>
        <p className="break-all text-xs text-muted-foreground">{t('collaboration.messages.to')}: {selected.message.target.sessionKey} · {selected.message.target.sessionGeneration}</p>
        <p className="text-xs text-muted-foreground">{t('collaboration.messages.purpose')}: {t(`collaboration.messages.purposes.${selected.message.purpose}`)}</p>
        {linkedTask && <p className="break-all text-xs text-muted-foreground">{t('collaboration.fields.tasks')}: {taskLink
          ? <Link to={taskLink} className="underline underline-offset-2">{linkedTask.taskNodeId}</Link>
          : linkedTask.taskNodeId}</p>}
        {selected.replyRef && <p className="break-all text-xs text-muted-foreground">{t('collaboration.messages.replyReference')}: {selected.replyRef}</p>}
        <p className="whitespace-pre-wrap break-words text-sm">{selected.message.message}</p>
        <p className="text-xs text-muted-foreground">{t(`collaboration.messages.states.${selected.phase}`)}</p>
        {selected.reply && <div className="space-y-1 rounded-md bg-black/5 p-3 dark:bg-white/10"><h4 className="text-sm font-medium">{t('collaboration.messages.reply')}</h4>
          <p className="whitespace-pre-wrap break-words text-sm">{selected.reply.text}</p><p className="break-all text-xs text-muted-foreground">{selected.reply.sha256}</p></div>}
        {!selected.reply && <p className="text-xs text-muted-foreground">{t('collaboration.messages.replyUnknown')}</p>}
        {source && <Button type="button" variant="outline" disabled={draft?.phase !== 'draft'} onClick={() => {
          if (draftKey && draft?.replyTo !== selected.message.id) update(draftKey, { replyTo: selected.message.id, id: crypto.randomUUID() });
        }}>{t('collaboration.messages.reply')}</Button>}
      </article>}
      <div className="space-y-2 border-t border-border pt-3">
        <p className="text-xs text-muted-foreground">{source ? t('collaboration.messages.sender', { name: source.name }) : t('collaboration.messages.sourceMissing')}</p>
        <label className="block space-y-1 text-xs">{t('collaboration.messages.purpose')}<select className="block min-h-9 w-full rounded-md border border-border bg-surface-input px-2" value={draft?.purpose ?? 'request'} disabled={!draftKey || draft?.phase !== 'draft'}
          onChange={event => { if (draftKey) update(draftKey, { purpose: event.target.value as typeof SESSION_COLLABORATION_PURPOSES[number], id: crypto.randomUUID() }); }}>
          {SESSION_COLLABORATION_PURPOSES.map(purpose => <option key={purpose} value={purpose}>{t(`collaboration.messages.purposes.${purpose}`)}</option>)}</select></label>
        <label className="block space-y-1 text-xs">{t('collaboration.messages.body')}<Textarea value={draft?.text ?? ''} maxLength={16384} disabled={!draftKey || draft?.phase !== 'draft'} data-testid="collaboration-message-draft"
          onChange={event => { if (draftKey) update(draftKey, { text: event.target.value, id: crypto.randomUUID() }); }} /></label>
        <div className="flex flex-wrap gap-2"><Button type="button" onClick={() => void send()} disabled={!draft?.text.trim() || draft.phase !== 'draft'} data-testid="collaboration-message-send">{t('collaboration.messages.send')}</Button>
          {draft?.phase === 'unknown' && <Button type="button" variant="outline" onClick={() => void check()}>{t('collaboration.messages.check')}</Button>}</div>
      </div>
    </div>}
  </details>;
}
