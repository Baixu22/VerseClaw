import { useTranslation } from 'react-i18next';
import { AlertTriangle, ChevronDown, CornerUpLeft, GitFork } from 'lucide-react';
import type { ChatSession } from '@shared/chat/types';
import { classifyDerivation, deriveSessionLineage, type SessionDerivation } from '@shared/types/session-derivation';

/*
 * Lineage lives inline in the chat header as quiet chips instead of a strip
 * pinned over the transcript: a source link for derived sessions, a picker
 * when there are descendants, and relation details only where the direct
 * parent is not the whole story (multi-generation chains or broken links).
 * Healthy roots without children render nothing.
 */
const CHIP = 'inline-flex h-7 min-w-0 shrink-0 items-center gap-1 rounded-md px-1.5 text-xs text-muted-foreground transition-colors hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10';

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
  const kind = t(`sessionFamily.kind.${relation.kind}`);
  const showRelations = hops.length > 1 || Boolean(problem);
  return <nav aria-label={t('sessionFamily.navigation')} data-testid="session-family-navigation"
    className="session-family-nav flex min-w-0 items-center gap-0.5">
    {relation.parentSessionKey && (parent
      ? <button type="button" data-testid="session-family-source" onClick={() => onNavigate(parent.key)}
          title={`${kind} · ${name(parent)}`} className={CHIP}>
          <CornerUpLeft className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="session-family-nav__kind shrink-0">{kind}</span>
          <span className="session-family-nav__name max-w-[160px] truncate text-foreground/80">{name(parent)}</span>
        </button>
      : <button type="button" data-testid="session-family-source-unloaded" onClick={onRefresh} className={CHIP}>
          <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">{t(problem === 'parent-missing' ? 'sessionFamily.missing' : 'sessionFamily.unloaded')}</span>
        </button>)}
    {relation.diagnostics?.length ? <span data-testid="session-family-conflict" className={CHIP}>
      <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />{t('sessionFamily.conflict')}
    </span> : null}
    {problem && problem !== 'parent-missing' && <span className={CHIP}>
      <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />{t(`sessionFamily.${problem}`)}
    </span>}
    {showRelations && hops.length > 0 && <details className="relative shrink-0" data-testid="session-family-relations">
      <summary className={`${CHIP} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}>
        {t('sessionFamily.relations')}<ChevronDown className="size-3 shrink-0" aria-hidden="true" />
      </summary>
      <ol className="absolute left-0 top-full z-40 mt-1 max-h-60 w-72 max-w-[80vw] space-y-1 overflow-auto rounded-lg border border-border bg-surface-modal p-2 text-xs text-muted-foreground shadow-lg">
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
    {children.length > 0 && <span className="relative inline-flex min-w-0 shrink-0 items-center">
      <GitFork className="pointer-events-none absolute left-1.5 size-3.5 text-muted-foreground" aria-hidden="true" />
      <select aria-label={t('sessionFamily.children', { count: children.length })} value=""
        data-testid="session-family-children"
        className={`${CHIP} max-w-[176px] cursor-pointer appearance-none bg-transparent pl-6 pr-5 outline-none focus-visible:ring-2 focus-visible:ring-ring`}
        onChange={(event) => { if (event.target.value) onNavigate(event.target.value); }}>
        <option value="">{t('sessionFamily.children', { count: children.length })}</option>
        {children.map((entry) => <option key={entry.key} value={entry.key}>{name(entry)}</option>)}
      </select>
      <ChevronDown className="pointer-events-none absolute right-1.5 size-3 text-muted-foreground" aria-hidden="true" />
    </span>}
  </nav>;
}
