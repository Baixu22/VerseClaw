import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Ellipsis, Minus, Sparkles, Trash2 } from 'lucide-react';
import { KnowledgeBot, KnowledgeBotCompanion, type KnowledgeBotState } from '@/components/knowledge-bot/KnowledgeBot';
import { useKnowledgeBotActivity } from '@/components/knowledge-bot/use-knowledge-bot-activity';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { hostApi, type KnowledgeDraftType, type KnowledgeSearchResult, type KnowledgeSourceSet, type KnowledgeStatusResult, type KnowledgeStewardReviewResult } from '@/lib/host-api';
import { errorMessageFrom } from '@/lib/user-error';
import { createDraftPayloadFromGroundedAnswer, createErrorExperienceInboxPayloadFromGroundedAnswer, type KnowledgeLibrarianGroundedAnswer } from '@/lib/knowledge-librarian';
import { type SearchRow, parseLibrarianCheckpoint, KNOWLEDGE_LIBRARIAN_STORAGE_KEY, type KnowledgeLibrarianMessage, type KnowledgeLibrarianCitation } from '../Knowledge/knowledge-view-utils';
import { knowledgeConversationBusy, startKnowledgeQuestion } from '../Knowledge/knowledge-bot-run';
import { conversationKey, conversationUnsaved, readConversation, subscribeConversations, updateConversation } from '../Knowledge/knowledge-conversations';
import { useChatStore } from '@/stores/chat';
import { activateWorkspaceScopedSession, workspaceOwnsSession } from '@/lib/workspace-session';
import { KnowledgeAssistantMessage, KnowledgeAssistantPromptInput, KnowledgeAssistantErrorCard } from '../Knowledge/KnowledgeAssistant';
import type { KnowledgeAnswerMode } from '@shared/knowledge/answer';
import { useWorkspacesStore } from '@/stores/workspaces';

export type KnowledgeChatContext = {
  homeSessionKey?: string;
  homeGeneration?: string;
  workspaceId?: string | null;
  initialQuestion?: string;
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

type KnowledgeChatProps = {
  context?: KnowledgeChatContext;
  embedded?: boolean;
  onClose?: () => void;
  onOpenCitation?: (citation: KnowledgeLibrarianCitation) => void;
  onActivityChange?: (state: KnowledgeBotState) => void;
};

export function KnowledgeChat(props: KnowledgeChatProps = {}) {
  const location = useLocation();
  const workspaceId = useWorkspacesStore(state => state.activeWorkspaceId);
  const { t } = useTranslation('knowledge');
  const context: KnowledgeChatContext = props.context ?? location.state?.knowledgeContext ?? {};
  if (context.workspaceId !== undefined && context.workspaceId !== workspaceId) {
    return <p role="status" className="p-4 text-sm">{t('libraryFlow.workspaceChanged')}</p>;
  }
  const checkpointKey = conversationKey(workspaceId, context);
  return <KnowledgeChatThread key={JSON.stringify([checkpointKey, context.homeSessionKey])} {...props} context={context} workspaceId={workspaceId} checkpointKey={checkpointKey} />;
}

function KnowledgeChatThread({ context, workspaceId, checkpointKey, embedded = false, onClose, onOpenCitation, onActivityChange }: KnowledgeChatProps & {
  context: KnowledgeChatContext;
  workspaceId: string | null;
  checkpointKey: string;
}) {
  const { t } = useTranslation(['knowledge', 'common']);
  const activeThread = useRef(true);
  useEffect(() => { activeThread.current = true; return () => { activeThread.current = false; }; }, []);
  const navigate = useNavigate();
  const location = useLocation();
  const raw = useSyncExternalStore(subscribeConversations, () => readConversation(checkpointKey));
  const previous = useMemo(() => parseLibrarianCheckpoint(raw), [raw]);
  const [home] = useState(() => {
    const chat = useChatStore.getState();
    const workspace = useWorkspacesStore.getState().activeWorkspace;
    const key = context.homeSessionKey ?? (previous?.mainSessionKey && workspaceOwnsSession(workspace, previous.mainSessionKey)
      ? previous.mainSessionKey : workspace?.activeSessionKey ?? chat.currentSessionKey);
    const session = chat.sessions.find(row => row.key === key);
    return { key, generation: context.homeGeneration ?? session?.sessionId,
      label: chat.sessionLabels[key] || session?.displayName || session?.label || session?.derivedTitle || key };
  });
  const legacy = useMemo(() => parseLibrarianCheckpoint(window.localStorage.getItem(KNOWLEDGE_LIBRARIAN_STORAGE_KEY)), []);
  const editorTitle = typeof context.editorTitle === 'string' ? context.editorTitle : previous?.editorTitle || t('workspace.untitled');
  const editorSource = typeof context.editorSource === 'string' ? context.editorSource : previous?.editorSource || '';
  const currentSourceRefs = useMemo(() => Array.isArray(context.sourceRefs) ? context.sourceRefs : [], [context.sourceRefs]);
  const currentSourceSetId = context.sourceSetId ?? null;
  const [status, setStatus] = useState<KnowledgeStatusResult['status'] | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [answerMode, setAnswerMode] = useState<KnowledgeAnswerMode>('strict');
  const answerModeEdited = useRef(false);
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
  useEffect(() => {
    onActivityChange?.(botState === 'listening' ? 'idle' : botState);
    return () => onActivityChange?.('idle');
  }, [botState, onActivityChange]);
  const questionRunning = knowledgeConversationBusy(checkpointKey);
  const busy = Boolean(running) || questionRunning;
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
    if (!activeThread.current) return;
    onClose?.();
    const search = routeSearch(); search.set('view', 'review-queue'); search.set('kind', kind);
    if (id) search.set('id', id);
    navigate({ pathname: '/knowledge', search: search.toString() }, { state: { knowledgeContext: context, stewardReview } });
  }, [context, navigate, routeSearch, onClose]);

  const draftKey = 'knowledge-draft:' + checkpointKey;
  const [librarianQuestion, setLibrarianQuestion] = useState(() => {
    let draft = '';
    let consumed: string | undefined;
    try {
      const saved = JSON.parse(sessionStorage.getItem(draftKey) ?? 'null');
      if (typeof saved?.text === 'string') draft = saved.text;
      consumed = saved?.entry;
    } catch { /* An unavailable draft never blocks the conversation. */ }
    const incoming = context.initialQuestion?.trim();
    return incoming && consumed !== location.key && draft !== incoming ? [draft, incoming].filter(Boolean).join('\n\n') : draft;
  });
  useEffect(() => {
    try { sessionStorage.setItem(draftKey, JSON.stringify({ text: librarianQuestion, entry: location.key })); }
    catch { /* The mounted editor still owns its draft. */ }
  }, [draftKey, librarianQuestion, location.key]);
  const [librarianError, setLibrarianError] = useState<string | null>(null);
  const [lastLibrarianQuestion, setLastLibrarianQuestion] = useState('');
  const [copiedLibrarianMessageId, setCopiedLibrarianMessageId] = useState<string | null>(null);
  const librarianMessages = previous?.messages ?? [];
  const librarianCheckpointAt = previous?.updatedAt;
  const latestQuestion = librarianMessages.findLast(message => message.operation);
  const latestPhase = latestQuestion?.operation?.phase;
  useEffect(() => {
    if (!latestPhase) return;
    setActivity(latestPhase === 'verifying' ? 'working' : latestPhase);
    setLibrarianError(latestQuestion?.operation?.error ?? null);
    setLastLibrarianQuestion(latestQuestion?.content ?? '');
  }, [latestPhase, latestQuestion?.id, latestQuestion?.operation?.error, latestQuestion?.content, setActivity]);
  const threadRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Append/request outcomes reveal the latest turn; unrelated state updates
    // do not pull the reader away from earlier sources.
    const thread = threadRef.current;
    if (thread) thread.scrollTop = thread.scrollHeight;
  }, [librarianMessages.length, running, librarianError]);

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
    updateConversation(checkpointKey, () => null);
    setLibrarianQuestion('');
    setLibrarianError(null);
    setLastLibrarianQuestion('');
  }, [checkpointKey, resetBot]);

  const askLibrarian = useCallback(async (questionOverride?: string) => {
    const question = (questionOverride ?? librarianQuestion).trim();
    if (!question || busy) return;
    const request = startKnowledgeQuestion({ context: { ...context, editorTitle, editorSource },
      workspaceId, question, answerMode, mainSessionKey: home.key, emptyCitation: t('librarian.emptyCitation') });
    if (!request) return;
    setLibrarianQuestion('');
    setLastLibrarianQuestion(question);
    setLibrarianError(null);
    setError(null);
    const result = await request.completion;
    if (activeThread.current && result.error) toast.error(result.error);
  }, [workspaceId, answerMode, busy, context, editorSource, editorTitle, home.key, librarianQuestion, t]);

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

  const deliveryLock = useRef(false);
  const [approval, setApproval] = useState<{ id: string; answerId: string } | null>(null);
  const wasDelivered = (answer: KnowledgeLibrarianMessage) => answer.mainChatDeliveries?.some(delivery =>
    delivery.sessionKey === home.key && (!delivery.generation || !home.generation || delivery.generation === home.generation));
  const sendOrOpen = async (answer: KnowledgeLibrarianMessage, question?: string) => {
    if (deliveryLock.current || busy) return;
    deliveryLock.current = true;
    setRunning(answer.id);
    setError(null);
    try {
      const workspace = useWorkspacesStore.getState();
      if (workspace.activeWorkspaceId !== workspaceId || (workspaceId ? !workspaceOwnsSession(workspace.activeWorkspace, home.key)
        : useChatStore.getState().currentSessionKey !== home.key)) {
        throw new Error(t('conversation.targetChanged'));
      }
      if (wasDelivered(answer)) {
        if (await activateWorkspaceScopedSession(workspaceId, home.key, () => activeThread.current)) {
          backToChat();
          void useChatStore.getState().loadHistory(true);
        }
        return;
      }
      const citations = answer.citations?.map(citation => `- ${citation.title} (${citation.lookup})`).join('\n');
      const message = [t('conversation.fromKnowledge'), question, answer.content, citations].filter(Boolean).join('\n\n');
      const idempotencyKey = [answer.id, workspaceId ?? '', home.key].join('/');
      let runId: string | undefined;
      let queued = false;
      if (home.generation || home.key.endsWith(':main')) {
        const approvalId = approval?.answerId === answer.id ? approval.id : undefined;
        if (approvalId) {
          const decision = await hostApi.permissions.decideApproval({ id: approvalId, decision: 'approved' });
          if (!decision.success) throw new Error(decision.error || t('conversation.unconfirmed'));
          if (!activeThread.current) return;
          setApproval(null);
        }
        const result = await hostApi.sessions.sendToChat({ key: home.key, expectedSessionId: home.generation,
          workspaceId: workspaceId ?? undefined, message, idempotencyKey }, approvalId);
        if (result?.approvalRequired && result.approval?.id) {
          if (activeThread.current) setApproval({ id: result.approval.id, answerId: answer.id });
          return;
        }
        if (result?.success === false) throw new Error(result.error || t('conversation.unconfirmed'));
        runId = result?.runId;
        queued = result?.queued === true;
      } else {
        // A new custom chat has no runtime row until its first normal turn.
        const result = await hostApi.chat.sendWithMedia({ sessionKey: home.key, workspaceId, message, idempotencyKey, deliver: false });
        if (!result.success) throw new Error(result.error || t('conversation.unconfirmed'));
        runId = result.result?.runId;
      }
      if (!runId && !queued) throw new Error(t('conversation.unconfirmed'));
      const receipt = { sessionKey: home.key, generation: home.generation, runId, idempotencyKey };
      updateConversation(checkpointKey, record => record && ({ ...record, mainSessionKey: home.key, messages: record.messages.map(row =>
        row.id === answer.id ? { ...row, mainChatDeliveries: [...(row.mainChatDeliveries ?? []).filter(item => item.idempotencyKey !== idempotencyKey), receipt] } : row) }));
      if (activeThread.current) toast.success(t('conversation.sent', { name: home.label }));
    } catch (reason) {
      if (activeThread.current) setError(errorMessageFrom(reason));
    } finally {
      deliveryLock.current = false;
      if (activeThread.current) setRunning(null);
    }
  };

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
      if (!activeThread.current) return;
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
      if (!activeThread.current) return;
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
      if (!activeThread.current) return;
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
            {currentSourceRefs.length > 0 && <span className="mr-auto min-w-0 truncate text-xs font-medium" data-testid="knowledge-active-source-set">
              {context.sourceSetTitle || t('sourceSet.title')} · {currentSourceRefs.length}
            </span>}
            {!currentSourceSetId && currentSourceRefs.length === 0 && legacy?.messages.length &&
              (!legacy.vaultPath || legacy.vaultPath === status?.vaultPath) ? <details className="relative text-xs">
                <summary className="cursor-pointer">{t('libraryFlow.archive')}</summary>
                <div className="absolute left-0 top-full z-10 mt-1 max-h-60 w-64 space-y-2 overflow-auto rounded-md border border-border bg-surface-modal p-3 shadow">
                  {legacy.messages.map(message => <p key={message.id} className="whitespace-pre-wrap break-words"><strong>{t(message.role === 'user' ? 'librarian.you' : 'librarian.roleId')}</strong> · {message.content}</p>)}
                </div>
              </details> : null}
            <select data-testid="knowledge-answer-mode" aria-label={t('librarian.answerMode.label')} value={answerMode}
              disabled={busy} onChange={event => { answerModeEdited.current = true; setAnswerMode(event.target.value as KnowledgeAnswerMode); }}
              className="rounded-md border border-border bg-surface-input px-2 py-1 text-xs text-foreground">
              <option value="strict">{t('librarian.answerMode.strict')}</option>
              <option value="open">{t('librarian.answerMode.open')}</option>
            </select>
            <div className={embedded ? 'sr-only' : 'flex min-w-0 items-center gap-2.5'}>
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
          {conversationUnsaved(checkpointKey) && <p role="alert" className="px-4 py-2 text-xs text-amber-700 dark:text-amber-400">{t('conversation.unsaved')}</p>}

          {/* Restraint: the thread is the panel. Capability cards, the current-note
              card, the quick-action grid and the write-boundary banner were resident
              chrome that squeezed the conversation; their functions all remain
              reachable from the workbench tabs and per-answer actions. */}
          <div ref={threadRef} className="min-h-0 flex-1 overflow-auto px-4 py-3" data-testid="knowledge-librarian-thread">
            <div className="mx-auto max-w-3xl space-y-5">
              {librarianMessages.length === 0 ? (
                <div className="flex flex-col items-center gap-3 px-1 py-10">
                  {(botState === 'idle' || botState === 'listening')
                    ? <KnowledgeBotCompanion size={embedded ? 84 : 132} state={botState} />
                    : <KnowledgeBot size={embedded ? 84 : 132} state={botState} />}
                  <p className="max-w-sm text-center text-sm leading-6 text-muted-foreground">{t(embedded ? 'librarian.bot.empty' : 'librarian.threadEmpty')}</p>
                </div>
              ) : librarianMessages.map((message, index) => (
                <KnowledgeAssistantMessage
                  key={message.id}
                  message={message}
                  compact={embedded}
                  botState={index === librarianMessages.length - 1 && message.role === 'assistant' ? botState : 'idle'}
                  active={index === librarianMessages.length - 1 && message.role === 'assistant'}
                  copied={copiedLibrarianMessageId === message.id}
                  onRelay={message.role === 'assistant' ? () => void sendOrOpen(message, message.groundedAnswer?.question
                    ?? (librarianMessages[index - 1]?.role === 'user' ? librarianMessages[index - 1].content : undefined)) : undefined}
                  relayLabel={t(wasDelivered(message) ? 'conversation.openHome'
                    : approval?.answerId === message.id ? 'conversation.approve' : 'conversation.sendHome', { name: home.label })}
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
              {questionRunning ? (
                <div className="flex items-center gap-2 px-1 text-xs text-muted-foreground" data-testid="knowledge-librarian-loading">
                  <KnowledgeBot size={48} state={botState} />
                  {t(latestPhase === 'verifying' ? 'mention.phases.verifying' : `librarian.bot.states.${botState}`)}
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
              running={questionRunning}
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
