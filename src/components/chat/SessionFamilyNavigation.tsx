import { useTranslation } from 'react-i18next';
import { CornerUpLeft } from 'lucide-react';
import type { ChatSession } from '@shared/chat/types';
import { classifyDerivation, deriveSessionLineage, type SessionDerivation } from '@shared/types/session-derivation';

export function SessionFamilyNavigation({ session, sessions, derivation, onNavigate, onRefresh }: {
  session: ChatSession;
  sessions: ChatSession[];
  derivation?: SessionDerivation;
  onNavigate: (key: string) => void;
  onRefresh: () => void;
}) {
  const { t } = useTranslation('chat');
  const relation = classifyDerivation(session);
  const parent = sessions.find((entry) => entry.key === relation.parentSessionKey);
  const children = sessions.filter((entry) => classifyDerivation(entry).parentSessionKey === session.key && entry.key !== session.key);
  const problem = derivation?.hops.find((hop) => hop.status !== 'resolved')?.status;
  const hops = (derivation ?? deriveSessionLineage({ rootSessionKey: session.key,
    readEntry: (key) => sessions.find((entry) => entry.key === key) ?? null })).hops;
  if (!relation.parentSessionKey && !relation.diagnostics?.length && !children.length) return null;
  const name = (entry: ChatSession) => entry.displayName || entry.label || entry.derivedTitle || entry.key;
  return <nav aria-label={t('sessionFamily.navigation')} data-testid="session-family-navigation"
    className="relative flex min-w-0 shrink-0 items-center gap-2 border-b border-border/40 px-4 py-1 text-xs text-muted-foreground">
    {relation.parentSessionKey && <>
      <span className="shrink-0">{t(`sessionFamily.kind.${relation.kind}`)}</span>
      {parent ? <button type="button" data-testid="session-family-source" onClick={() => onNavigate(parent.key)}
        className="flex min-w-0 items-center gap-1 truncate rounded px-1 py-1 hover:bg-black/5 dark:hover:bg-white/10">
        <CornerUpLeft className="size-3 shrink-0" /><span className="truncate">{name(parent)}</span>
      </button> : <button type="button" data-testid="session-family-source-unloaded" onClick={onRefresh} className="underline underline-offset-2">
        {t(problem === 'parent-missing' ? 'sessionFamily.missing' : 'sessionFamily.unloaded')}
      </button>}
    </>}
    {relation.diagnostics?.length ? <span data-testid="session-family-conflict">{t('sessionFamily.conflict')}</span> : null}
    {problem && problem !== 'parent-missing' && <span>{t(`sessionFamily.${problem}`)}</span>}
    {hops.length > 0 && <details className="relative shrink-0" data-testid="session-family-relations">
      <summary className="cursor-pointer rounded px-1 py-1">{t('sessionFamily.relations')}</summary>
      <ol className="absolute left-0 top-full z-40 mt-1 max-h-60 w-72 max-w-[80vw] space-y-2 overflow-auto rounded border border-border bg-surface-modal p-3 shadow-lg">
        {hops.map((hop) => {
          const child = sessions.find((entry) => entry.key === hop.childSessionKey);
          const source = sessions.find((entry) => entry.key === hop.parentSessionKey);
          return <li key={hop.childSessionKey} className="flex min-w-0 flex-wrap items-center gap-1">
            <span className="max-w-full truncate" title={hop.childSessionKey}>{child ? name(child) : hop.childSessionKey}</span>
            <span>→ {t(`sessionFamily.kind.${hop.kind}`)} →</span>
            {source ? <button type="button" className="max-w-full truncate underline underline-offset-2" title={source.key}
              onClick={() => onNavigate(source.key)}>{name(source)}</button>
              : <span>{t(derivation && hop.status === 'parent-missing' ? 'sessionFamily.missing' : 'sessionFamily.unloaded')}</span>}
            {hop.status !== 'resolved' && hop.status !== 'parent-missing' && <span>{t(`sessionFamily.${hop.status}`)}</span>}
          </li>;
        })}
      </ol>
    </details>}
    {children.length > 0 && <select aria-label={t('sessionFamily.children', { count: children.length })} value=""
      data-testid="session-family-children" className="ml-auto min-w-0 max-w-48 rounded bg-surface-input px-2 py-1 text-foreground"
      onChange={(event) => { if (event.target.value) onNavigate(event.target.value); }}>
      <option value="">{t('sessionFamily.children', { count: children.length })}</option>
      {children.map((entry) => <option key={entry.key} value={entry.key}>{name(entry)}</option>)}
    </select>}
  </nav>;
}
