import { useDeferredValue, useEffect, useId, useMemo, useRef, useState, type KeyboardEventHandler, type ReactNode } from 'react';
import { ChevronDown, Code2, Eye, Link2, Lock, PencilLine } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AssistantMarkdown } from '@/components/assistant-render/AssistantMarkdown';
import { GitHubCard } from '@/components/assistant-render/GitHubCard';
import { SessionReference, useDraftSessions } from '@/components/assistant-render/MessageReferences';
import { WebsiteLink } from '@/components/assistant-render/WebsiteLink';
import { collectDraftReferences, type DraftReference } from '@/lib/composer-references';
import { maskChatSecrets } from '@/lib/chat-display-text';
import { DraftReferenceRow } from './DraftReferenceRow';

const richBlock =
  /^ {0,3}(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|>|\x60{3,}|~{3,}|\|.*\||[-:| ]*\|[-:| ]+$|={3,}$|\$\$)/m;
const richInline =
  /\[[^\]\n]+\]\(|\*\*[^*\n]+\*\*|\*[^*\n]+\*|__[^_\n]+__|~~[^~\n]+~~|\x60[^\x60\n]+\x60|\$[^$\n]+\$|\\\(.+?\\\)|\\\[[\s\S]+?\\\]/;

const formatNames = { json: 'JSON', diff: 'Git diff', markdown: 'Markdown' };

function asCodeBlock(language: string, code: string): string {
  let length = 3;
  for (const marker of code.matchAll(/^ {0,3}(~{3,})/gm)) length = Math.max(length, marker[1].length + 1);
  const fence = '~'.repeat(length);
  return fence + language + '\n' + code + '\n' + fence;
}

function draftContent(text: string, render: boolean): { format: keyof typeof formatNames | 'text'; source: string } {
  const trimmed = text.trim();
  if (/^(?:diff --git [^\n]+|--- [^\n]+\n\+\+\+ [^\n]+)/.test(trimmed)) {
    return { format: 'diff', source: render ? asCodeBlock('diff', text) : text };
  }
  if (/^\{[\s\S]*\}$|^\[[\s\S]*\]$/.test(trimmed)) {
    try {
      const value: unknown = JSON.parse(trimmed);
      if (!render) return { format: 'json', source: text };
      // Preserve original literals when serialization changes integers, duplicate keys or escapes.
      const compact = trimmed.replace(/"(?:\\.|[^"\\])*"|\s+/g, token => token[0] === '"' ? token : '');
      const formatted = JSON.stringify(value) === compact ? JSON.stringify(value, null, 2) : text;
      return { format: 'json', source: asCodeBlock('json', formatted) };
    } catch {
      /* Incomplete JSON is ordinary editable text. */
    }
  }
  return { format: richBlock.test(text) || richInline.test(text) ? 'markdown' : 'text', source: text };
}

const initialReferenceLimit = 6;
type ReferenceView = 'closed' | 'open' | 'all';
type LinkReference = DraftReference & { kind: 'repo' | 'website' | 'docs' };
type DraftView = 'source' | 'rich' | 'link';

function isPreviewLink(reference?: DraftReference): reference is LinkReference {
  return reference?.kind === 'repo' || reference?.kind === 'website' || reference?.kind === 'docs';
}

function DraftLink({ reference }: { reference: LinkReference }) {
  return reference.kind === 'repo'
    ? <GitHubCard url={reference.target} />
    : <WebsiteLink url={reference.target} />;
}

export function ComposerDraftPreview({
  text,
  singleReference,
  sessionKey,
  children,
  secretCount,
  viewMode,
  onViewModeChange,
  onLinkEnter,
  onOpenFile,
}: {
  text: string;
  singleReference?: DraftReference;
  sessionKey: string;
  children: ReactNode;
  secretCount: number;
  viewMode: DraftView;
  onViewModeChange: (mode: DraftView) => void;
  onLinkEnter: KeyboardEventHandler<HTMLDivElement>;
  onOpenFile?: (path: string) => void;
}) {
  const { t } = useTranslation('chat');
  const id = useId();
  const draft = useDeferredValue(text);
  const sessions = useDraftSessions();
  const linkViewRef = useRef<HTMLDivElement>(null);
  const hasText = Boolean(text.trim());
  const referenceScope = hasText ? sessionKey : null;
  const [referencePanel, setReferencePanel] = useState<{
    scope: string | null;
    view: ReferenceView;
  }>({
    scope: referenceScope,
    view: 'closed',
  });
  if (referencePanel.scope !== referenceScope) {
    setReferencePanel({ scope: referenceScope, view: 'closed' });
  }
  const setReferenceView = (view: ReferenceView) => setReferencePanel({ scope: referenceScope, view });

  const { format, source } = useMemo(() => draftContent(text, viewMode === 'rich'), [text, viewMode]);
  const literal = format === 'json' || format === 'diff';
  const standalone = hasText && secretCount === 0
    && (isPreviewLink(singleReference) || (singleReference?.kind === 'session' && sessions.open))
    ? singleReference
    : undefined;
  const references = useMemo(
    () => hasText && !literal && !standalone ? collectDraftReferences(draft, sessions.index) : [],
    [draft, hasText, literal, standalone, sessions.index],
  );
  const canPreview = !standalone && (format !== 'text' || text.length > 2400 || text.split('\n', 25).length === 25);
  const showRich = canPreview && viewMode === 'rich';
  const showLink = standalone && viewMode === 'link';
  useEffect(() => {
    if (showLink) linkViewRef.current?.focus({ preventScroll: true });
  }, [showLink]);

  const hasReferences = references.length > 0;
  const expanded = referencePanel.view !== 'closed';
  const showAll = referencePanel.view === 'all';
  const visibleReferences = showAll ? references : references.slice(0, initialReferenceLimit);
  const viewLabel = showRich ? t('composer.editSource')
    : format === 'text' ? t('composer.previewFullDraft')
      : t('composer.previewFormat', { format: formatNames[format] });
  const ViewIcon = showRich ? Code2 : Eye;
  const editLabel = t(standalone?.kind === 'session' ? 'composer.editSource' : 'composer.editLink');
  const editAction = (
    <button type="button" className="composer-reference-action" data-testid="composer-edit-link"
      aria-label={editLabel} title={editLabel}
      onClick={() => onViewModeChange('source')}>
      <PencilLine size={12} aria-hidden="true" />
    </button>
  );

  return <>
    <div hidden={showRich || showLink} className="composer-draft-editor" data-single-link={standalone ? 'true' : undefined}>
      <div className="relative min-w-0">{children}</div>
      {standalone && (
        <button type="button" className="composer-reference-action" data-testid="composer-show-link-card"
          aria-label={t('composer.showReference')} title={t('composer.showReference')}
          onClick={() => onViewModeChange('link')}>
          <Eye size={14} aria-hidden="true" />
        </button>
      )}
    </div>
    {showLink && (
      <div ref={linkViewRef} className="composer-standalone-link" data-testid="composer-standalone-link"
        role="group" aria-label={standalone.label} tabIndex={-1}
        onKeyDown={event => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            onViewModeChange('source');
          } else if (event.key === 'Enter' && event.target === event.currentTarget) {
            onLinkEnter(event);
          }
        }}>
        <div className={standalone.kind === 'session' ? 'composer-session-reference' : 'composer-reference-line'}>
          {isPreviewLink(standalone)
            ? <DraftLink reference={standalone} />
            : <SessionReference id={standalone.detail ?? standalone.target} />}
          {editAction}
        </div>
      </div>
    )}
    {hasText && (canPreview || secretCount > 0 || hasReferences) && (
      <section className="composer-draft-preview" data-testid="composer-draft-preview" data-format={format} data-rich-mode={showRich ? 'rich' : 'source'}>
        {showRich && (
          <div
            className="composer-draft-document"
            data-testid="composer-rendered-draft"
            role="region"
            aria-label={format === 'text' ? t('composer.previewFullDraft') : formatNames[format]}
            tabIndex={0}
            onDoubleClick={event => {
              if (!(event.target as Element).closest('a, button, input')) onViewModeChange('source');
            }}
          >
            {format === 'text' ? (
              <pre className="composer-draft-text">{maskChatSecrets(source)}</pre>
            ) : (
              <AssistantMarkdown
                text={source}
                isStreaming={false}
                foldLongText={false}
              />
            )}
          </div>
        )}

        {(hasReferences || secretCount > 0 || canPreview) && <div className="composer-draft-toolbar">
          {hasReferences && (
            <button
              type="button"
              className="composer-draft-preview-toggle"
              aria-expanded={expanded}
              aria-controls={id}
              aria-label={t('composer.draftReferencesCount', { count: references.length })}
              onClick={() => setReferenceView(expanded ? 'closed' : 'open')}
            >
              <Link2 size={14} aria-hidden="true" />
              <span>{t('composer.draftReferences')}</span>
              <span className="composer-draft-count" aria-hidden="true">{references.length}</span>
              <ChevronDown size={13} aria-hidden="true" className="composer-draft-chevron" />
              {!expanded && (
                <span className="composer-draft-excerpt" aria-hidden="true">
                  {references.slice(0, 2).map(reference => reference.label).join(' · ')}
                </span>
              )}
            </button>
          )}

          <div className="composer-draft-tools">
            {secretCount > 0 && (
              <span className="composer-secret-shield" data-testid="composer-secret-shield" title={t('composer.secretMaskedHint')}>
                <Lock size={12} aria-hidden="true" />
                {t('composer.secretMaskedCount', { count: secretCount })}
              </span>
            )}
            {canPreview && (
              <button
                type="button"
                className="composer-mode-switch"
                data-testid="composer-rich-mode-toggle"
                onClick={() => onViewModeChange(showRich ? 'source' : 'rich')}
              >
                <ViewIcon size={14} aria-hidden="true" />
                {viewLabel}
              </button>
            )}
          </div>
        </div>}

        {hasReferences && (
          <div id={id} hidden={!expanded}>
            {expanded && <>
              <div className="composer-draft-references">
                <ul className="draft-reference-list" aria-label={t('composer.draftReferences')}>
                  {visibleReferences.map(reference => (
                    <li className="draft-reference-entry" key={reference.kind + ':' + reference.target + ':' + reference.label}>
                      {isPreviewLink(reference)
                        ? <DraftLink reference={reference} />
                        : <DraftReferenceRow reference={reference} openSession={sessions.open} openFile={onOpenFile} />}
                    </li>
                  ))}
                </ul>
                {references.length > initialReferenceLimit && (
                  <button
                    type="button"
                    className="draft-more"
                    aria-expanded={showAll}
                    onClick={() => setReferenceView(showAll ? 'open' : 'all')}
                  >
                    {t(showAll ? 'markdown.showLess' : 'composer.draftMore', { count: references.length - initialReferenceLimit })}
                  </button>
                )}
              </div>
            </>}
          </div>
        )}
      </section>
    )}
  </>;
}
