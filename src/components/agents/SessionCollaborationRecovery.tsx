import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { hostApi } from '@/lib/host-api';
import { hostEvents } from '@/lib/host-events';
import { useSessionCollaborationUi } from '@/stores/session-collaboration';
import { normalizeAutonomySessionScope, type AutonomySessionScope } from '@shared/types/identity-scope';

/** Window-local intents remain inspectable after their original session generations retire. */
export function SessionCollaborationRecovery() {
  const { t } = useTranslation('agents');
  const drafts = useSessionCollaborationUi(state => state.messageDrafts);
  const discard = useSessionCollaborationUi(state => state.discardMessageDraft);
  const [failed, setFailed] = useState(false);
  const [checking, setChecking] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<{ key: string; id: string; state: string } | null>(null);
  const revision = useRef(0);
  useEffect(() => {
    const invalidate = () => { revision.current++; setReceipt(null); setChecking(null); };
    const navigation = hostEvents.onWorkspaceNavigationChanged(invalidate);
    const reconnect = hostEvents.onGatewayStatus(status => { if (status.state === 'running') invalidate(); });
    return () => { revision.current++; navigation(); reconnect(); };
  }, []);
  const check = async (key: string, target: AutonomySessionScope, id: string) => {
    const token = ++revision.current;
    setReceipt(null); setChecking(key);
    try {
      const reader = await hostApi.sessions.collaborationSender();
      if (token !== revision.current) return;
      if (!reader.source) throw new Error('RECOVERY_READER_UNAVAILABLE');
      const result = await hostApi.sessions.collaborationMessages({ requester: reader.source.scope, target, id });
      if (token !== revision.current || useSessionCollaborationUi.getState().messageDrafts[key]?.id !== id) return;
      if (!result.success || (result.messages.receipt && result.messages.receipt.message.id !== id)) throw new Error('RECOVERY_RECEIPT_UNAVAILABLE');
      setReceipt({ key, id, state: result.messages.receipt?.phase ?? result.messages.state });
    } catch { if (token === revision.current) setReceipt({ key, id, state: 'unavailable' }); }
    finally { if (token === revision.current) setChecking(null); }
  };
  const saved = Object.entries(drafts).filter(([, draft]) => draft.text || draft.phase !== 'draft');
  if (!saved.length) return null;
  return <details className="rounded-md border border-border p-3" data-testid="collaboration-recovery">
    <summary className="cursor-pointer rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {t('collaboration.recovery.title', { count: saved.length })}
    </summary>
    <p className="py-2 text-xs text-muted-foreground">{t('collaboration.recovery.description')}</p>
    {failed && <p role="alert" className="text-xs text-red-700 dark:text-red-400">{t('collaboration.messages.recoverySaveFailed')}</p>}
    <ul className="max-h-80 space-y-3 overflow-y-auto">
      {saved.map(([key, draft]) => {
        let scopes: AutonomySessionScope[];
        try { scopes = (JSON.parse(key) as AutonomySessionScope[]).map(scope => normalizeAutonomySessionScope(scope, scope)); }
        catch { return null; }
        return <li key={key} className="space-y-2 border-t border-border pt-2 text-xs" data-testid="collaboration-saved-draft">
          {scopes.map((scope, index) => <p key={index} className="break-all text-muted-foreground">
            {t(index ? 'collaboration.messages.to' : 'collaboration.messages.from')}: {scope.workspaceId} · {scope.projectId} · {scope.sessionKey} · {scope.sessionGeneration}
          </p>)}
          <p className="break-all">{draft.id} · {t(`collaboration.recovery.phases.${draft.phase}`)}</p>
          <p className="whitespace-pre-wrap break-words">{draft.text}</p>
          {receipt?.key === key && receipt.id === draft.id && <p role="status" aria-atomic="true">{t('collaboration.recovery.receipt', {
            state: t(`collaboration.messages.states.${receipt.state}`),
          })}</p>}
          <div className="flex flex-wrap gap-2">
            {(draft.phase === 'unknown' || draft.phase === 'retry') && <Button type="button" variant="outline" disabled={Boolean(checking)}
              onClick={() => void check(key, scopes[1], draft.id)}>{t('collaboration.messages.check')}</Button>}
            <Button type="button" variant="outline" disabled={draft.phase === 'sending'}
              onClick={() => setFailed(!discard(key))}>{t('collaboration.recovery.discard')}</Button>
          </div>
        </li>;
      })}
    </ul>
  </details>;
}
