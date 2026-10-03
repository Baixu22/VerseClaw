import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Bot, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { hostApi, type KnowledgeDraftType, type KnowledgeSearchResult, type KnowledgeSourceSet, type KnowledgeStatusResult, type KnowledgeStewardReviewResult } from '@/lib/host-api';
import { errorMessageFrom } from '@/lib/user-error';
import { buildGroundedLibrarianAnswer, createDraftPayloadFromGroundedAnswer, createErrorExperienceInboxPayloadFromGroundedAnswer, type KnowledgeLibrarianGroundedAnswer } from '@/lib/knowledge-librarian';
import { getSearchRows, getLookup, getTitle, getSnippet, getScore, getPageBody, getString, markdownSummary, readableExcerpt, type SearchRow, makeLibrarianMessage, parseLibrarianCheckpoint, KNOWLEDGE_LIBRARIAN_STORAGE_KEY, type KnowledgeLibrarianMessage, type KnowledgeLibrarianCitation, type KnowledgeLibrarianCheckpoint } from '../Knowledge/knowledge-view-utils';
import { KnowledgeAssistantMessage, KnowledgeAssistantPromptInput, KnowledgeAssistantErrorCard } from '../Knowledge/KnowledgeAssistant';

export type KnowledgeChatContext = {
  editorTitle?: string;
  editorBody?: string;
  editorSource?: string;
  editorType?: KnowledgeDraftType;
  editorTags?: string;
  editorMode?: 'edit' | 'preview' | 'split';
  query?: string;
  sourceRefs?: KnowledgeSourceSet['sourceRefs'];
  sourceSetId?: string | null;
  sourceSetTitle?: string;
  searchResult?: KnowledgeSearchResult | null;
  selectedRow?: SearchRow | null;
  selectedPage?: Record<string, unknown> | null;
};
type KnowledgeLibrarianPromptSuggestion = { id: string; label: string; prompt: string };

export function KnowledgeChat() {
  const { t } = useTranslation(['knowledge', 'common']);
  const navigate = useNavigate();
  const location = useLocation();
  const context = useMemo<KnowledgeChatContext>(() => (location.state as { knowledgeContext?: KnowledgeChatContext } | null)?.knowledgeContext ?? {}, [location.state]);
  const previous = useMemo(() => parseLibrarianCheckpoint(window.localStorage.getItem(KNOWLEDGE_LIBRARIAN_STORAGE_KEY)), []);
  const editorTitle = typeof context.editorTitle === 'string' ? context.editorTitle : previous?.editorTitle || t('workspace.untitled');
  const editorBody = typeof context.editorBody === 'string' ? context.editorBody : '';
  const editorSource = typeof context.editorSource === 'string' ? context.editorSource : previous?.editorSource || '';
  const currentSourceRefs = useMemo(() => Array.isArray(context.sourceRefs) ? context.sourceRefs : [], [context.sourceRefs]);
  const currentSourceSetId = context.sourceSetId ?? null;
  const [status, setStatus] = useState<KnowledgeStatusResult['status'] | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = Boolean(running);
  useEffect(() => { void hostApi.knowledge.status().then((result) => setStatus(result.status ?? null)).catch(() => undefined); }, []);
  const routeSearch = useCallback(() => {
    const search = new URLSearchParams();
    const version = new URLSearchParams(location.search).get('uiVersion');
    if (version) search.set('uiVersion', version);
    return search;
  }, [location.search]);
  const backToChat = () => navigate({ pathname: '/', search: routeSearch().toString() });
  const backToLibrary = () => navigate({ pathname: '/knowledge', search: routeSearch().toString() }, { state: { knowledgeContext: context } });
  const openCitation = (citation: KnowledgeLibrarianCitation) => {
    if (!editorSource && citation.lookup.startsWith('manual:')) {
      backToLibrary();
      return;
    }
    const search = routeSearch(); search.set('lookup', citation.lookup);
    navigate({ pathname: '/knowledge', search: search.toString() }, { state: { knowledgeContext: context, knowledgeTitle: citation.title } });
  };
  const openQueue = useCallback((kind: 'draft' | 'inbox', id?: string, stewardReview?: KnowledgeStewardReviewResult) => {
    const search = routeSearch(); search.set('view', 'review-queue'); search.set('kind', kind);
    if (id) search.set('id', id);
    navigate({ pathname: '/knowledge', search: search.toString() }, { state: { knowledgeContext: context, stewardReview } });
  }, [context, navigate, routeSearch]);

  const [librarianQuestion, setLibrarianQuestion] = useState('');
  const [librarianError, setLibrarianError] = useState<string | null>(null);
  const [lastLibrarianQuestion, setLastLibrarianQuestion] = useState('');
  const [copiedLibrarianMessageId, setCopiedLibrarianMessageId] = useState<string | null>(null);
  const [librarianMessages, setLibrarianMessages] = useState<KnowledgeLibrarianMessage[]>(() => {
    if (typeof window === 'undefined') return [];
    return parseLibrarianCheckpoint(window.localStorage.getItem(KNOWLEDGE_LIBRARIAN_STORAGE_KEY))?.messages ?? [];
  });
  const [librarianCheckpointAt, setLibrarianCheckpointAt] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return parseLibrarianCheckpoint(window.localStorage.getItem(KNOWLEDGE_LIBRARIAN_STORAGE_KEY))?.updatedAt ?? null;
  });
  const editorSummary = useMemo(() => markdownSummary(editorBody), [editorBody]);
  const editorSourceIds = useMemo(() => {
    const explicit = editorSource.trim();
    if (explicit) return [explicit];
    const slug = editorTitle.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return [`manual:${slug || 'untitled'}`];
  }, [editorSource, editorTitle]);

  useEffect(() => {
    if (typeof window === 'undefined' || librarianMessages.length === 0) return;
    const updatedAt = new Date().toISOString();
    const checkpoint: KnowledgeLibrarianCheckpoint = {
      version: 1,
      updatedAt,
      vaultPath: status?.vaultPath,
      editorTitle,
      editorSource,
      messages: librarianMessages.slice(-30),
    };
    try {
      window.localStorage.setItem(KNOWLEDGE_LIBRARIAN_STORAGE_KEY, JSON.stringify(checkpoint));
      setLibrarianCheckpointAt(updatedAt);
    } catch {
      // Best-effort checkpoint only; never block the knowledge workspace.
    }
  }, [editorSource, editorTitle, librarianMessages, status?.vaultPath]);

  const librarianPromptSuggestions = useMemo<KnowledgeLibrarianPromptSuggestion[]>(() => {
    const currentTitle = editorTitle.trim() || t('workspace.untitled');
    return [
      {
        id: 'summarize-current',
        label: t('librarian.suggestions.summarize.label'),
        prompt: t('librarian.suggestions.summarize.prompt', { title: currentTitle }),
      },
      {
        id: 'find-related',
        label: t('librarian.suggestions.related.label'),
        prompt: t('librarian.suggestions.related.prompt', { title: currentTitle }),
      },
      {
        id: 'review-gaps',
        label: t('librarian.suggestions.gaps.label'),
        prompt: t('librarian.suggestions.gaps.prompt', { title: currentTitle }),
      },
    ];
  }, [editorTitle, t]);

  const clearLibrarianThread = useCallback(() => {
    setLibrarianMessages([]);
    setLibrarianQuestion('');
    setLibrarianError(null);
    setLastLibrarianQuestion('');
    setLibrarianCheckpointAt(null);
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(KNOWLEDGE_LIBRARIAN_STORAGE_KEY);
    }
  }, []);

  const askLibrarian = useCallback(async (questionOverride?: string) => {
    const question = (questionOverride ?? librarianQuestion).trim();
    if (!question || running) return;
    const userMessage = makeLibrarianMessage('user', question);
    setLibrarianMessages((messages) => [...messages, userMessage].slice(-30));
    setLibrarianQuestion('');
    setLastLibrarianQuestion(question);
    setLibrarianError(null);
    setRunning('librarianAsk');
    setError(null);
    try {
      if (currentSourceRefs.length > 0) {
        const result = await hostApi.knowledge.answerFromSourceSet({
          question,
          sourceRefs: currentSourceRefs,
          ...(currentSourceSetId ? { sourceSetId: currentSourceSetId } : {}),
        });
        if (!result.success) throw new Error(result.error || t('errors.search'));
        const citations: KnowledgeLibrarianCitation[] = result.sources.map((source) => ({
          lookup: source.lookup,
          title: source.title,
          path: source.path || source.lookup,
          excerpt: source.excerpt || t('librarian.emptyCitation'),
        }));
        const groundedAnswer: KnowledgeLibrarianGroundedAnswer = {
          question,
          answer: result.answer,
          sources: result.sources.map((source) => ({
            id: source.id,
            lookup: source.lookup,
            title: source.title,
            path: source.path || source.lookup,
            excerpt: source.excerpt,
            corpus: 'wiki',
            reason: t('sourceSet.answerBoundary'),
          })),
          unknowns: result.unknowns,
          suggestions: result.suggestedNextActions,
          nextActions: result.suggestedNextActions,
          confidence: result.confidence,
          groundingStatus: result.groundingStatus,
          retrieval: {
            query: result.retrievalDiagnostics.query,
            corpus: result.retrievalDiagnostics.corpus,
            roleTag: 'knowledge-librarian',
            resultCount: result.retrievalDiagnostics.resultCount,
            selectedSources: result.sources.map((source) => ({
              id: source.id,
              lookup: source.lookup,
              title: source.title,
              path: source.path || source.lookup,
              excerpt: source.excerpt,
              corpus: 'wiki',
            })),
          },
        };
        setLibrarianMessages((messages) => [...messages, makeLibrarianMessage('assistant', groundedAnswer.answer, citations, groundedAnswer)].slice(-30));
        return;
      }
      const result = await hostApi.knowledge.search({
        query: question,
        maxResults: 4,
        corpus: 'wiki',
        roleTag: 'knowledge-librarian',
      });
      if (!result.success) throw new Error(result.error || t('errors.search'));
      const matches = getSearchRows(result).slice(0, 3);
      const citations: KnowledgeLibrarianCitation[] = [];
      for (const row of matches) {
        const lookup = getLookup(row);
        if (!lookup) continue;
        let body = getSnippet(row);
        try {
          const page = await hostApi.knowledge.get({ lookup, lineCount: 80, corpus: 'wiki' });
          if (page.success) body = getPageBody(page as Record<string, unknown>) || body;
        } catch {
          // Search snippets are still useful if a page preview fails.
        }
        const excerpt = readableExcerpt(body, getSnippet(row));
        citations.push({
          lookup,
          title: getTitle(row),
          path: getString(row, ['sourcePath', 'pagePath', 'path']) || lookup,
          score: getScore(row),
          excerpt: excerpt || t('librarian.emptyCitation'),
        });
        void hostApi.knowledge.recordKnowledgeReference({
          targetId: lookup,
          targetKind: 'wiki-page',
          title: getTitle(row),
          sourceRefs: [{ id: lookup, kind: 'wiki', path: lookup }],
          reference: { kind: 'search', lookup, query: question },
        }).catch(() => undefined);
      }

      if (citations.length === 0 && editorBody.trim()) {
        citations.push({
          lookup: editorSource || editorSourceIds[0],
          title: editorTitle.trim() || t('workspace.untitled'),
          path: editorSource || editorSourceIds[0],
          excerpt: readableExcerpt(editorBody, editorSummary) || t('librarian.emptyCitation'),
        });
      }

      const groundedAnswer = buildGroundedLibrarianAnswer({
        question,
        resultCount: getSearchRows(result).length,
        corpus: 'wiki',
        roleTag: 'knowledge-librarian',
        sources: citations.map((citation) => ({
          id: citation.lookup,
          lookup: citation.lookup,
          title: citation.title,
          path: citation.path || citation.lookup,
          excerpt: citation.excerpt,
          corpus: 'wiki',
          ...(typeof citation.score === 'number' ? { score: citation.score } : {}),
          reason: t('librarian.retrieval.selectedReason'),
        })),
        messages: {
          answerIntro: t('librarian.answerIntro', { count: citations.length }),
          answerBoundary: t('librarian.answerBoundary'),
          noAnswer: t('librarian.noAnswer'),
          missingSources: t('librarian.unknowns.noSources'),
          pageSnippetGrounding: t('librarian.unknowns.pageSnippetLevel'),
          suggestionSaveDraft: t('librarian.suggestions.next.saveDraft'),
          suggestionCreateErrorExperience: t('librarian.suggestions.next.createErrorExperience'),
          suggestionSendToSteward: t('librarian.suggestions.next.sendToSteward'),
          suggestionBroadenSearch: t('librarian.suggestions.next.broadenSearch'),
        },
      });
      setLibrarianMessages((messages) => [...messages, makeLibrarianMessage('assistant', groundedAnswer.answer, citations, groundedAnswer)].slice(-30));
    } catch (err) {
      const message = errorMessageFrom(err);
      setError(message);
      setLibrarianError(message);
      toast.error(message);
    } finally {
      setRunning(null);
    }
  }, [currentSourceRefs, currentSourceSetId, editorBody, editorSource, editorSourceIds, editorSummary, editorTitle, librarianQuestion, running, t]);

  const copyLibrarianMessage = useCallback(async (messageId: string, content: string) => {
    if (!content.trim()) return;
    try {
      await navigator.clipboard.writeText(content);
      setCopiedLibrarianMessageId(messageId);
      window.setTimeout(() => setCopiedLibrarianMessageId((current) => (current === messageId ? null : current)), 1600);
    } catch {
      toast.error(t('librarian.copyFailed'));
    }
  }, [t]);

  const saveGroundedAnswerDraft = useCallback(async (answer: KnowledgeLibrarianGroundedAnswer) => {
    setRunning('librarianDraft');
    setError(null);
    try {
      const result = await hostApi.knowledge.createDraft(createDraftPayloadFromGroundedAnswer(answer, {
        titlePrefix: t('librarian.candidate.draftTitlePrefix'),
      }));
      if (!result.success) throw new Error(result.error || t('errors.action'));
      toast.success(t('toasts.librarianDraft'));
      openQueue('draft', result.draft?.id);
    } catch (err) {
      const message = errorMessageFrom(err);
      setError(message);
      toast.error(message);
    } finally {
      setRunning(null);
    }
  }, [openQueue, t]);

  const createGroundedAnswerErrorExperience = useCallback(async (answer: KnowledgeLibrarianGroundedAnswer) => {
    setRunning('librarianErrorExperience');
    setError(null);
    try {
      const result = await hostApi.knowledge.createInboxItem(createErrorExperienceInboxPayloadFromGroundedAnswer(answer, {
        titlePrefix: t('librarian.candidate.errorExperienceTitlePrefix'),
        createdFromId: answer.question,
      }));
      if (!result.success) throw new Error(result.error || t('errors.action'));
      toast.success(t('toasts.librarianErrorExperience'));
      openQueue('inbox', result.item?.id);
    } catch (err) {
      const message = errorMessageFrom(err);
      setError(message);
      toast.error(message);
    } finally {
      setRunning(null);
    }
  }, [openQueue, t]);

  const sendGroundedAnswerToSteward = useCallback(async (answer: KnowledgeLibrarianGroundedAnswer) => {
    setRunning('librarianSteward');
    setError(null);
    try {
      const created = await hostApi.knowledge.createDraft(createDraftPayloadFromGroundedAnswer(answer, {
        titlePrefix: t('librarian.candidate.stewardTitlePrefix'),
      }));
      if (!created.success || !created.draft) throw new Error(created.error || t('errors.action'));
      const reviewed = await hostApi.knowledge.stewardReview({ draftId: created.draft.id });
      if (!reviewed.success) throw new Error(reviewed.error || t('errors.action'));
      toast.success(t('toasts.librarianSteward'));
      openQueue('draft', created.draft.id, reviewed);
    } catch (err) {
      const message = errorMessageFrom(err);
      setError(message);
      toast.error(message);
    } finally {
      setRunning(null);
    }
  }, [openQueue, t]);

  return (<div className="mx-auto flex h-full min-h-0 w-full max-w-5xl flex-col bg-background" data-testid="knowledge-chat-page">
          <header className="flex shrink-0 items-center justify-between gap-3 border-b border-black/10 px-4 py-3 text-left dark:border-white/10">
            <div className="flex min-w-0 items-center gap-2.5">
              <Bot className="h-4 w-4 shrink-0 text-muted-foreground" />
              <h1 className="truncate font-serif text-xl font-normal tracking-tight">{t('librarian.chatTitle')}</h1>
              <p className="sr-only">{t('librarian.modalSubtitle')}</p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 shrink-0 rounded-md px-2 text-[11px] font-normal text-muted-foreground hover:text-foreground"
              onClick={clearLibrarianThread}
              disabled={busy || librarianMessages.length === 0}
              data-testid="knowledge-librarian-clear"
            >
              {t('librarian.clearThread')}
            </Button>
          </header>

          <div className="flex shrink-0 gap-2 border-b border-border px-4 py-2">
            <Button variant="ghost" size="sm" className="h-8" onClick={backToChat} data-testid="knowledge-chat-back">{t('librarian.backToChat')}</Button>
            <Button variant="ghost" size="sm" className="h-8" onClick={backToLibrary} data-testid="knowledge-chat-library">{t('tabs.library')}</Button>
          </div>
          {error && error !== librarianError && <p role="alert" className="px-4 py-2 text-sm text-red-700 dark:text-red-400">{error}</p>}

          {/* Restraint: the thread is the panel. Capability cards, the current-note
              card, the quick-action grid and the write-boundary banner were resident
              chrome that squeezed the conversation; their functions all remain
              reachable from the workbench tabs and per-answer actions. */}
          <div className="min-h-0 flex-1 overflow-auto px-4 py-3" data-testid="knowledge-librarian-thread">
            <div className="space-y-3">
              {librarianMessages.length === 0 ? (
                <p className="px-1 py-8 text-center text-xs leading-5 text-muted-foreground">
                  {t('librarian.threadEmpty')}
                </p>
              ) : librarianMessages.map((message) => (
                <KnowledgeAssistantMessage
                  key={message.id}
                  message={message}
                  copied={copiedLibrarianMessageId === message.id}
                  busy={busy}
                  copyLabel={t('librarian.copy')}
                  copiedLabel={t('librarian.copied')}
                  roleLabel={t('librarian.roleId')}
                  userLabel={t('librarian.you')}
                  citationsLabel={t('librarian.citations')}
                  sectionLabels={{
                    answer: t('librarian.sections.answer'),
                    sources: t('librarian.sections.sources'),
                    unknowns: t('librarian.sections.unknowns'),
                    nextAction: t('librarian.sections.nextAction'),
                    retrieval: t('librarian.sections.retrieval'),
                    query: t('librarian.retrieval.query'),
                    corpus: t('librarian.retrieval.corpus'),
                    roleTag: t('librarian.retrieval.roleTag'),
                    resultCount: t('librarian.retrieval.resultCount'),
                    selectedSources: t('librarian.retrieval.selectedSources'),
                    confidence: t('librarian.confidence'),
                    groundingStatus: {
                      grounded: t('librarian.groundingStatus.grounded'),
                      partial: t('librarian.groundingStatus.partial'),
                      missing_sources: t('librarian.groundingStatus.missingSources'),
                    },
                  }}
                  actionLabels={{
                    saveDraft: t('librarian.actions.saveDraft'),
                    createErrorExperience: t('librarian.actions.createErrorExperience'),
                    sendToSteward: t('librarian.actions.sendToSteward'),
                  }}
                  onCopy={(content) => void copyLibrarianMessage(message.id, content)}
                  onOpenCitation={openCitation}
                  onSaveDraft={(answer) => void saveGroundedAnswerDraft(answer)}
                  onCreateErrorExperience={(answer) => void createGroundedAnswerErrorExperience(answer)}
                  onSendToSteward={(answer) => void sendGroundedAnswerToSteward(answer)}
                />
              ))}
              {running === 'librarianAsk' ? (
                <div className="flex items-center gap-2 px-1 text-xs text-muted-foreground" data-testid="knowledge-librarian-loading">
                  <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
                  {t('librarian.searching')}
                </div>
              ) : null}
              {librarianError ? (
                <KnowledgeAssistantErrorCard
                  error={librarianError}
                  title={t('librarian.errorTitle')}
                  retryLabel={t('librarian.retry')}
                  dismissLabel={t('librarian.dismissError')}
                  onRetry={() => void askLibrarian(lastLibrarianQuestion)}
                  onDismiss={() => setLibrarianError(null)}
                />
              ) : null}
            </div>
          </div>

          <div className="shrink-0 border-t border-black/10 px-4 pb-3 pt-2.5 dark:border-white/10">
            <div className="mb-2 flex flex-wrap gap-1.5" data-testid="knowledge-librarian-suggestions">
              {librarianPromptSuggestions.map((suggestion) => (
                <button
                  key={suggestion.id}
                  type="button"
                  className="rounded-full border border-black/10 px-2.5 py-1 text-[11px] font-normal text-muted-foreground transition-colors hover:bg-black/5 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none dark:border-white/10 dark:hover:bg-white/5"
                  onClick={() => void askLibrarian(suggestion.prompt)}
                  disabled={busy}
                  data-testid={`knowledge-librarian-suggestion-${suggestion.id}`}
                >
                  {suggestion.label}
                </button>
              ))}
            </div>
            <KnowledgeAssistantPromptInput
              value={librarianQuestion}
              onChange={setLibrarianQuestion}
              onSubmit={() => void askLibrarian()}
              disabled={busy}
              running={running === 'librarianAsk'}
              placeholder={t('librarian.askPlaceholder')}
              askLabel={t('librarian.askButton')}
              hint={librarianCheckpointAt ? t('librarian.checkpointSaved', { time: new Date(librarianCheckpointAt).toLocaleTimeString() }) : t('librarian.askHint')}
            />
          </div>
        </div>);
}
