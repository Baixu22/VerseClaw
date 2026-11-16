import { useTranslation } from 'react-i18next';
import { AlertTriangle, ArrowLeft, ChevronRight } from 'lucide-react';
import type { ChatSession } from '@shared/chat/types';
import { classifyDerivation, deriveSessionLineage, type SessionDerivation } from '@shared/types/session-derivation';

// Source and ancestry share the conversation picker; descendants are listed by its owner.
const ROW = 'codex-header-menu__item';

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
  const problem = derivation?.hops.find((hop) => hop.status !== 'resolved')?.status;
  const hops = (derivation ?? deriveSessionLineage({ rootSessionKey: session.key,
    readEntry: (key) => sessions.find((entry) => entry.key === key) ?? null })).hops;
  if (!relation.parentSessionKey && !relation.diagnostics?.length) return null;
  const name = (entry: ChatSession) => entry.displayName || entry.label || entry.derivedTitle || entry.key;
  const kind = t(`sessionFamily.kind.${relation.kind}`);
  const showRelations = hops.length > 1 || Boolean(problem);
  return <nav aria-label={t('sessionFamily.navigation')} data-testid="session-family-navigation"
    className="session-family-nav mb-1 flex min-w-0 flex-col border-b border-border/50 pb-1">
    {relation.parentSessionKey && (parent
      ? <button type="button" data-testid="session-family-source" onClick={() => onNavigate(parent.key)}
          title={`${kind} · ${name(parent)}`} aria-label={`${t('session.navigation.source')}: ${name(parent)}`} className={ROW}>
          <ArrowLeft className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className="block text-2xs text-muted-foreground">{t('session.navigation.source')} · {kind}</span>
            <span className="block truncate">{name(parent)}</span>
          </span>
        </button>
      : <button type="button" data-testid="session-family-source-unloaded" onClick={onRefresh} className={ROW}>
          <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">{t(problem === 'parent-missing' ? 'sessionFamily.missing' : 'sessionFamily.unloaded')}</span>
        </button>)}
    {relation.diagnostics?.length ? <span role="status" data-testid="session-family-conflict" className="flex items-center gap-2 px-2 py-1 text-xs text-amber-700 dark:text-amber-400">
      <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />{t('sessionFamily.conflict')}
    </span> : null}
    {problem && problem !== 'parent-missing' && <span role="status" className="flex items-center gap-2 px-2 py-1 text-xs text-amber-700 dark:text-amber-400">
      <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />{t(`sessionFamily.${problem}`)}
    </span>}
    {showRelations && hops.length > 0 && <details className="group/relations min-w-0" data-testid="session-family-relations">
      <summary className={`${ROW} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}>
        {t('sessionFamily.relations')}<ChevronRight className="ml-auto size-3 shrink-0 group-open/relations:rotate-90" aria-hidden="true" />
      </summary>
      <ol className="max-h-48 space-y-1 overflow-auto px-2 pb-2 text-xs text-muted-foreground">
        {hops.map((hop) => {
          const child = sessions.find((entry) => entry.key === hop.childSessionKey);
          const source = sessions.find((entry) => entry.key === hop.parentSessionKey);
          return <li key={hop.childSessionKey} className="flex min-w-0 flex-wrap items-center gap-1 rounded-md px-1.5 py-1">
            <span className="max-w-full truncate text-foreground" title={hop.childSessionKey}>{child ? name(child) : hop.childSessionKey}</span>
            <span>→ {t(`sessionFamily.kind.${hop.kind}`)} →</span>
            {source ? <button type="button" className="max-w-full truncate underline underline-offset-2" title={source.key}
              onClick={() => onNavigate(source.key)}>{name(source)}</button>
              : <span>{t(derivation && hop.status === 'parent-missing' ? 'sessionFamily.missing' : 'sessionFamily.unloaded')}</span>}
            {hop.status !== 'resolved' && hop.status !== 'parent-missing' && <span>{t(`sessionFamily.${hop.status}`)}</span>}
          </li>;
        })}
      </ol>
    </details>}
  </nav>;
}
