import { isMemorySourceRef } from '@shared/knowledge/memory';
import { isExperienceSourceRef } from '@shared/knowledge/experience';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Ellipsis, Minus, Sparkles, Trash2 } from 'lucide-react';
import { KnowledgeBot } from '@/components/knowledge-bot/KnowledgeBot';
import { useKnowledgeBotActivity } from '@/components/knowledge-bot/use-knowledge-bot-activity';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { hostApi, type KnowledgeDraftType, type KnowledgeSearchResult, type KnowledgeSourceSet, type KnowledgeStatusResult, type KnowledgeStewardReviewResult } from '@/lib/host-api';
import { errorMessageFrom } from '@/lib/user-error';
import { createDraftPayloadFromGroundedAnswer, createErrorExperienceInboxPayloadFromGroundedAnswer, type KnowledgeLibrarianGroundedAnswer } from '@/lib/knowledge-librarian';
import { type SearchRow, makeLibrarianMessage, parseLibrarianCheckpoint, KNOWLEDGE_LIBRARIAN_STORAGE_KEY, type KnowledgeLibrarianMessage, type KnowledgeLibrarianCitation, type KnowledgeLibrarianCheckpoint } from '../Knowledge/knowledge-view-utils';
import { KnowledgeAssistantMessage, KnowledgeAssistantPromptInput, KnowledgeAssistantErrorCard } from '../Knowledge/KnowledgeAssistant';
import type { KnowledgeAnswerMode } from '@shared/knowledge/answer';
import { useWorkspacesStore } from '@/stores/workspaces';

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

export function KnowledgeChat({ context: suppliedContext, embedded = false, onClose, onOpenCitation }: {
  context?: KnowledgeChatContext;
  embedded?: boolean;
  onClose?: () => void;
  onOpenCitation?: (citation: KnowledgeLibrarianCitation) => void;
} = {}) {
  const { t } = useTranslation(['knowledge', 'common']);
  const navigate = useNavigate();
  const location = useLocation();
  const context = useMemo<KnowledgeChatContext>(() => suppliedContext ?? (location.state as { knowledgeContext?: KnowledgeChatContext } | null)?.knowledgeContext ?? {}, [suppliedContext, location.state]);
  const previous = useMemo(() => parseLibrarianCheckpoint(window.localStorage.getItem(KNOWLEDGE_LIBRARIAN_STORAGE_KEY)), []);
  const editorTitle = typeof context.editorTitle === 'string' ? context.editorTitle : previous?.editorTitle || t('workspace.untitled');
  const editorSource = typeof context.editorSource === 'string' ? context.editorSource : previous?.editorSource || '';
  const currentSourceRefs = useMemo(() => Array.isArray(context.sourceRefs) ? context.sourceRefs : [], [context.sourceRefs]);
  const currentSourceSetId = context.sourceSetId ?? null;
  const [status, setStatus] = useState<KnowledgeStatusResult['status'] | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [answerMode, setAnswerMode] = useState<KnowledgeAnswerMode>('strict');
  const answerModeEdited = useRef(false);
  const workspaceId = useWorkspacesStore(state => state.activeWorkspaceId);
  useEffect(() => {
    let active = true;
    answerModeEdited.current = false;
    void (async () => {
      try {
        const result = await hostApi.knowledge.operationsStatus();
        if (active && !answerModeEdited.current && result.success && result.operations)
          setAnswerMode(result.operations.config.answerMode);
      } catch { /* The existing strict default remains available during Gateway recovery. */ }
    })();
    return () => { active = false; };
  }, [workspaceId]);
  const [error, setError] = useState<string | null>(null);
  const { state: botState, setActivity, setComposing, reset: resetBot } = useKnowledgeBotActivity();
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
    if (onOpenCitation) { onOpenCitation(citation); return; }
    if (!editorSource && citation.lookup.startsWith('manual:')) {
      backToLibrary();
      return;
    }
    const search = routeSearch(); search.set('lookup', citation.lookup);
    navigate({ pathname: '/knowledge', search: search.toString() }, { state: { knowledgeContext: context, knowledgeTitle: citation.title, knowledgeCitation: citation } });
  };
  const openQueue = useCallback((kind: 'draft' | 'inbox', id?: string, stewardReview?: KnowledgeStewardReviewResult) => {
    onClose?.();
    const search = routeSearch(); search.set('view', 'review-queue'); search.set('kind', kind);
    if (id) search.set('id', id);
    navigate({ pathname: '/knowledge', search: search.toString() }, { state: { knowledgeContext: context, stewardReview } });
  }, [context, navigate, routeSearch, onClose]);

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
  const threadRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Append/request outcomes reveal the latest turn; unrelated state updates
    // do not pull the reader away from earlier sources.
    const thread = threadRef.current;
    if (thread) thread.scrollTop = thread.scrollHeight;
  }, [librarianMessages.length, running, librarianError]);

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
    resetBot();
    setLibrarianMessages([]);
    setLibrarianQuestion('');
    setLibrarianError(null);
    setLastLibrarianQuestion('');
    setLibrarianCheckpointAt(null);
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(KNOWLEDGE_LIBRARIAN_STORAGE_KEY);
    }
  }, [resetBot]);

  const askLibrarian = useCallback(async (questionOverride?: string) => {
    const question = (questionOverride ?? librarianQuestion).trim();
    if (!question || running) return;
    const userMessage = makeLibrarianMessage('user', question);
    setLibrarianMessages((messages) => [...messages, userMessage].slice(-30));
    setLibrarianQuestion('');
    setLastLibrarianQuestion(question);
    setLibrarianError(null);
    setRunning('librarianAsk');
    setActivity(currentSourceRefs.length > 0 ? 'waiting' : 'searching');
    setError(null);
    try {
      const history = librarianMessages.slice(-8).flatMap(message => message.role === 'system' ? [] : [{ role: message.role, content: message.content }]);
      const result = await hostApi.knowledge.answerFromSourceSet({
        question, sourceRefs: currentSourceRefs, synthesis: true, history, answerMode,
        ...(currentSourceSetId ? { sourceSetId: currentSourceSetId } : {}),
      });
      if (!result.success) throw new Error(result.error || t('errors.search'));
      const citations: KnowledgeLibrarianCitation[] = result.sources.map(source => ({
        lookup: source.lookup, title: source.title, path: source.path || source.lookup,
        excerpt: source.excerpt || t('librarian.emptyCitation'),
        sourceRef: result.claims?.flatMap(claim => claim.citations).find(citation => citation.sourceId === source.citation?.refId)?.sourceRef ?? source.citation?.sourceRef,
      }));
      const sources = result.sources.map(source => ({ ...source, path: source.path || source.lookup, corpus: isExperienceSourceRef(source.citation?.sourceRef) ? 'all' as const : isMemorySourceRef(source.citation?.sourceRef) ? 'memory' as const : 'wiki' as const,
        answerCitation: result.claims?.flatMap(claim => claim.citations).find(citation => citation.sourceId === source.citation?.refId) }));
      const groundedAnswer: KnowledgeLibrarianGroundedAnswer = {
        question, answer: result.answer, sources, unknowns: result.unknowns,
        suggestions: result.suggestedNextActions, nextActions: result.suggestedNextActions,
        groundingStatus: result.groundingStatus,
        answerMode: result.answerMode ?? answerMode, claims: result.claims,
        retrieval: { query: question, corpus: result.retrievalDiagnostics.corpus, roleTag: 'knowledge-librarian', resultCount: result.retrievalDiagnostics.resultCount, selectedSources: sources },
      };
      setLibrarianMessages(messages => [...messages, makeLibrarianMessage('assistant', groundedAnswer.answer, citations, groundedAnswer)].slice(-30));
      setActivity(groundedAnswer.groundingStatus === 'missing_sources' ? 'confused' : 'finished');
    } catch (err) {
      const message = errorMessageFrom(err);
      setError(message);
      setLibrarianError(message);
      setActivity('failed');
      toast.error(message);
    } finally {
      setRunning(null);
    }
  }, [answerMode, currentSourceRefs, currentSourceSetId, librarianMessages, librarianQuestion, running, setActivity, t]);

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
    setActivity('writing');
    setError(null);
    try {
      const result = await hostApi.knowledge.createDraft(createDraftPayloadFromGroundedAnswer(answer, {
        titlePrefix: t('librarian.candidate.draftTitlePrefix'),
      }));
      if (!result.success) throw new Error(result.error || t('errors.action'));
      toast.success(t('toasts.librarianDraft'));
      setActivity('finished');
      openQueue('draft', result.draft?.id);
    } catch (err) {
      const message = errorMessageFrom(err);
      setError(message);
      setActivity('failed');
      toast.error(message);
    } finally {
      setRunning(null);
    }
  }, [openQueue, setActivity, t]);

  const createGroundedAnswerErrorExperience = useCallback(async (answer: KnowledgeLibrarianGroundedAnswer) => {
    setRunning('librarianErrorExperience');
    setActivity('writing');
    setError(null);
    try {
      const result = await hostApi.knowledge.createInboxItem(createErrorExperienceInboxPayloadFromGroundedAnswer(answer, {
        titlePrefix: t('librarian.candidate.errorExperienceTitlePrefix'),
        createdFromId: answer.question,
      }));
      if (!result.success) throw new Error(result.error || t('errors.action'));
      toast.success(t('toasts.librarianErrorExperience'));
      setActivity('finished');
      openQueue('inbox', result.item?.id);
    } catch (err) {
      const message = errorMessageFrom(err);
      setError(message);
      setActivity('failed');
      toast.error(message);
    } finally {
      setRunning(null);
    }
  }, [openQueue, setActivity, t]);

  const sendGroundedAnswerToSteward = useCallback(async (answer: KnowledgeLibrarianGroundedAnswer) => {
    setRunning('librarianSteward');
    setActivity('writing');
    setError(null);
    try {
      const created = await hostApi.knowledge.createDraft(createDraftPayloadFromGroundedAnswer(answer, {
        titlePrefix: t('librarian.candidate.stewardTitlePrefix'),
      }));
      if (!created.success || !created.draft) throw new Error(created.error || t('errors.action'));
      setActivity('working');
      const reviewed = await hostApi.knowledge.stewardReview({ draftId: created.draft.id });
      if (!reviewed.success) throw new Error(reviewed.error || t('errors.action'));
      toast.success(t('toasts.librarianSteward'));
      setActivity('finished');
      openQueue('draft', created.draft.id, reviewed);
    } catch (err) {
      const message = errorMessageFrom(err);
      setError(message);
      setActivity('failed');
      toast.error(message);
    } finally {
      setRunning(null);
    }
  }, [openQueue, setActivity, t]);

  return (<div className="mx-auto flex h-full min-h-0 w-full max-w-5xl flex-col bg-background" data-testid="knowledge-chat-page" data-bot-state={botState} data-compact={embedded}>
          <header className={`flex shrink-0 items-center gap-3 text-left ${embedded ? 'justify-end px-3 py-1.5' : 'justify-between border-b border-black/10 px-4 py-3 dark:border-white/10'}`}>
            <select data-testid="knowledge-answer-mode" aria-label={t('librarian.answerMode.label')} value={answerMode}
              disabled={busy} onChange={event => { answerModeEdited.current = true; setAnswerMode(event.target.value as KnowledgeAnswerMode); }}
              className="rounded-md border border-border bg-surface-input px-2 py-1 text-xs text-foreground">
              <option value="strict">{t('librarian.answerMode.strict')}</option>
              <option value="open">{t('librarian.answerMode.open')}</option>
            </select>
            <div className={embedded ? 'sr-only' : 'flex min-w-0 items-center gap-2.5'}>
              {!embedded && <KnowledgeBot size={44} state={botState} />}
              <div className="min-w-0">
                <h1 className={`truncate font-serif font-normal tracking-tight ${embedded ? 'text-base' : 'text-xl'}`}>{t('librarian.chatTitle')}</h1>
                <p className="text-xs text-muted-foreground" role="status" data-testid="knowledge-bot-status">{t(`librarian.bot.states.${botState}`)}</p>
              </div>
              <p className="sr-only">{t('librarian.modalSubtitle')}</p>
            </div>
            <div className={embedded ? 'knowledge-bot-toolbar' : 'flex items-center gap-1'}>
            {embedded ? <DropdownMenu.Root modal={false}>
              <DropdownMenu.Trigger asChild><button type="button" className="knowledge-bot-toolbar__more" aria-label={t('librarian.bot.more')} title={t('librarian.bot.more')} data-testid="knowledge-bot-menu"><Ellipsis size={18} /></button></DropdownMenu.Trigger>
              <DropdownMenu.Portal><DropdownMenu.Content className="knowledge-bot-menu" align="end" sideOffset={8}>
                <DropdownMenu.Item className="knowledge-bot-menu__item" disabled={busy || librarianMessages.length === 0} onSelect={clearLibrarianThread} data-testid="knowledge-librarian-clear"><Trash2 size={14} />{t('librarian.clearThread')}</DropdownMenu.Item>
              </DropdownMenu.Content></DropdownMenu.Portal>
            </DropdownMenu.Root> : <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 shrink-0 rounded-md px-2 text-[11px] font-normal text-muted-foreground hover:text-foreground"
              onClick={clearLibrarianThread}
              disabled={busy || librarianMessages.length === 0}
              data-testid="knowledge-librarian-clear"
            >
              {t('librarian.clearThread')}
            </Button>}
            {embedded && <button type="button" className="knowledge-bot-toolbar__collapse" aria-label={t('librarian.bot.collapse')} title={t('librarian.bot.collapse')} onClick={onClose} data-testid="knowledge-bot-close"><Minus size={16} strokeWidth={2} /></button>}
            </div>
          </header>

          {!embedded && <div className="flex shrink-0 gap-2 border-b border-border px-4 py-2">
            <Button variant="ghost" size="sm" className="h-8" onClick={backToChat} data-testid="knowledge-chat-back">{t('librarian.backToChat')}</Button>
            <Button variant="ghost" size="sm" className="h-8" onClick={backToLibrary} data-testid="knowledge-chat-library">{t('tabs.library')}</Button>
          </div>}
          {error && error !== librarianError && <p role="alert" className="px-4 py-2 text-sm text-red-700 dark:text-red-400">{error}</p>}

          {/* Restraint: the thread is the panel. Capability cards, the current-note
              card, the quick-action grid and the write-boundary banner were resident
              chrome that squeezed the conversation; their functions all remain
              reachable from the workbench tabs and per-answer actions. */}
          <div ref={threadRef} className="min-h-0 flex-1 overflow-auto px-4 py-3" data-testid="knowledge-librarian-thread">
            <div className="mx-auto max-w-3xl space-y-5">
              {librarianMessages.length === 0 ? (
                <div className="flex flex-col items-center gap-3 px-1 py-10">
                  <KnowledgeBot size={embedded ? 84 : 132} state={botState} follow />
                  <p className="max-w-sm text-center text-sm leading-6 text-muted-foreground">{t(embedded ? 'librarian.bot.empty' : 'librarian.threadEmpty')}</p>
                </div>
              ) : librarianMessages.map((message, index) => (
                <KnowledgeAssistantMessage
                  key={message.id}
                  message={message}
                  compact={embedded}
                  botState={index === librarianMessages.length - 1 && message.role === 'assistant' ? botState : 'idle'}
                  animateAvatar={index === librarianMessages.length - 1 && message.role === 'assistant' && botState !== 'idle' && botState !== 'listening'}
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
                    retrieval: t(embedded ? 'librarian.bot.details' : 'librarian.sections.retrieval'),
                    query: t('librarian.retrieval.query'),
                    corpus: t('librarian.retrieval.corpus'),
                    roleTag: t('librarian.retrieval.roleTag'),
                    resultCount: t('librarian.retrieval.resultCount'),
                    selectedSources: t('librarian.retrieval.selectedSources'),
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
                  <KnowledgeBot size={48} state={botState} />
                  {t(`librarian.bot.states.${botState}`)}
                </div>
              ) : null}
              {librarianError ? (
                <KnowledgeAssistantErrorCard
                  error={librarianError}
                  title={t('librarian.errorTitle')}
                  retryLabel={t('librarian.retry')}
                  dismissLabel={t('librarian.dismissError')}
                  onRetry={() => void askLibrarian(lastLibrarianQuestion)}
                  onDismiss={() => { setLibrarianError(null); setError(null); resetBot(); }}
                />
              ) : null}
            </div>
          </div>

          <div className={`mx-auto w-full max-w-3xl shrink-0 ${embedded ? 'knowledge-bot-composer-wrap' : 'px-4 pb-5 pt-3'}`}>
            {!embedded && <div className="mb-2 flex flex-wrap gap-1.5" data-testid="knowledge-librarian-suggestions">
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
            </div>}
            <KnowledgeAssistantPromptInput
              value={librarianQuestion}
              onChange={setLibrarianQuestion}
              onSubmit={() => void askLibrarian()}
              disabled={busy}
              running={running === 'librarianAsk'}
              placeholder={t(embedded ? 'librarian.bot.placeholder' : 'librarian.askPlaceholder')}
              askLabel={t('librarian.askButton')}
              hint={librarianCheckpointAt ? t('librarian.checkpointSaved', { time: new Date(librarianCheckpointAt).toLocaleTimeString() }) : t('librarian.askHint')}
              onFocusChange={setComposing}
              compact={embedded}
            >
              {embedded && <DropdownMenu.Root modal={false}>
                <DropdownMenu.Trigger asChild><button type="button" className="knowledge-bot-prompt-trigger" disabled={busy} aria-label={t('librarian.bot.prompts')} title={t('librarian.bot.prompts')} data-testid="knowledge-bot-prompts"><Sparkles size={15} /></button></DropdownMenu.Trigger>
                <DropdownMenu.Portal><DropdownMenu.Content className="knowledge-bot-menu" align="start" side="top" sideOffset={8} data-testid="knowledge-librarian-suggestions">
                  {librarianPromptSuggestions.map((suggestion) => <DropdownMenu.Item key={suggestion.id} className="knowledge-bot-menu__item" onSelect={() => void askLibrarian(suggestion.prompt)} data-testid={`knowledge-librarian-suggestion-${suggestion.id}`}>{suggestion.label}</DropdownMenu.Item>)}
                </DropdownMenu.Content></DropdownMenu.Portal>
              </DropdownMenu.Root>}
            </KnowledgeAssistantPromptInput>
          </div>
        </div>);
}
