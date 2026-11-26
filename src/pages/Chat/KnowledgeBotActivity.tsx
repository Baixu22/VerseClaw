import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { KnowledgeBot, type KnowledgeBotState } from '@/components/knowledge-bot/KnowledgeBot';
import { AssistantMarkdown } from '@/components/assistant-render/AssistantMarkdown';
import { conversationKey, conversationVersion, knowledgeHistory, notifyConversations, readConversation, subscribeConversations } from '../Knowledge/knowledge-conversations';
import { knowledgeConversationBusy, knowledgeRunActive, startKnowledgeQuestion } from '../Knowledge/knowledge-bot-run';
import { parseLibrarianCheckpoint } from '../Knowledge/knowledge-view-utils';
import type { KnowledgeChatContext } from './KnowledgeChat';

export function useKnowledgeBotMention(workspaceId: string | null, sessionKey: string, generation?: string) {
  const { t } = useTranslation('knowledge');
  const version = useSyncExternalStore(subscribeConversations, conversationVersion);
  const storageKey = 'clawx.knowledge.chat-panel.v1.' + JSON.stringify([workspaceId, sessionKey, generation ?? null]);
  useEffect(() => {
    if (!generation) return;
    const initialKey = 'clawx.knowledge.chat-panel.v1.' + JSON.stringify([workspaceId, sessionKey, null]);
    try {
      const pending = localStorage.getItem(initialKey);
      if (!pending) return;
      if (!localStorage.getItem(storageKey)) localStorage.setItem(storageKey, pending);
      localStorage.removeItem(initialKey);
      notifyConversations();
    } catch { /* Keep the initial record if persistence is unavailable. */ }
  }, [generation, sessionKey, storageKey, workspaceId]);
  const context = useMemo<KnowledgeChatContext | null>(() => {
    void version;
    try {
      const value = JSON.parse(localStorage.getItem(storageKey) ?? 'null');
      return value?.workspaceId === workspaceId ? value : null;
    } catch { return null; }
  }, [storageKey, workspaceId, version]);
  const invoke = useCallback((question: string) => {
    const history = knowledgeHistory(workspaceId);
    const active = history.find(row => knowledgeConversationBusy(row.key) && row.mainSessionKey === sessionKey)
      ?? history.find(row => knowledgeConversationBusy(row.key));
    const selected = (!question && active?.context) || context
      || history.find(row => row.mainSessionKey === sessionKey)?.context || { workspaceId };
    try {
      localStorage.setItem(storageKey, JSON.stringify(selected));
      notifyConversations();
    } catch {
      toast.error(t('conversation.unsaved'));
      return false;
    }
    if (question) {
      const request = startKnowledgeQuestion({ context: selected, workspaceId, mainSessionKey: sessionKey, question,
        emptyCitation: t('librarian.emptyCitation') });
      if (!request) { toast.message(t('mention.busy')); return false; }
    }
    return true;
  }, [context, sessionKey, storageKey, t, workspaceId]);
  return { context, invoke };
}

export function KnowledgeBotActivity({ context, workspaceId, sessionKey, generation, onAsk }: {
  context: KnowledgeChatContext; workspaceId: string | null; sessionKey: string; generation?: string;
  onAsk: (question: string) => boolean;
}) {
  const { t } = useTranslation('knowledge');
  const navigate = useNavigate();
  const location = useLocation();
  const key = conversationKey(workspaceId, context);
  const raw = useSyncExternalStore(subscribeConversations, () => readConversation(key));
  const record = useMemo(() => parseLibrarianCheckpoint(raw), [raw]);
  const question = record?.messages.findLast(message => message.operation);
  const operation = question?.operation;
  const active = !!question && knowledgeRunActive(key, question);
  const ended = operation && ['finished', 'confused', 'failed'].includes(operation.phase);
  const phase = !operation ? 'idle' : !active && !ended ? 'interrupted' : operation.phase;
  const botState: KnowledgeBotState = phase === 'verifying' ? 'working' : phase === 'interrupted' ? 'failed' : phase;
  const answer = record?.messages.find(message => message.id === operation?.answerId);
  const open = () => {
    const search = new URLSearchParams(location.search);
    search.set('knowledge', 'ask');
    navigate({ pathname: '/', search: search.toString() }, { state: { knowledgeContext: {
      ...context, workspaceId, homeSessionKey: sessionKey, homeGeneration: generation,
    } } });
  };

  return <section className="min-w-0 rounded-xl border border-border bg-surface-input p-4"
    data-testid="chat-knowledge-bot-activity" data-phase={phase} aria-label={t('mention.name')}>
    <div className="flex items-center gap-2">
      <KnowledgeBot size={40} state={botState} animated={active} />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{t('mention.name')}{context.sourceSetTitle && <span className="ml-2 font-normal text-muted-foreground">{context.sourceSetTitle}</span>}</div>
        <p className="text-xs text-muted-foreground" role="status" aria-live="polite">{t(`mention.phases.${phase}`)}</p>
      </div>
      <button type="button" onClick={open} className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-black/5 focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-white/10"
        data-testid="chat-knowledge-bot-open">{t('mention.open')}</button>
    </div>
    {question && <p className="mt-2 whitespace-pre-wrap break-words text-sm text-muted-foreground">{question.content}</p>}
    {!!operation?.steps.length && <details className="mt-2 text-xs text-muted-foreground" data-testid="chat-knowledge-bot-steps">
      <summary className="w-fit cursor-pointer">{t('mention.steps')}</summary>
      <ol className="mt-2 list-inside list-decimal space-y-1">
        {operation.steps.map(step => <li key={step}>{t(`mention.phases.${step}`)}</li>)}
      </ol>
    </details>}
    {answer && <div className="mt-3 min-w-0" data-testid="chat-knowledge-bot-answer">
      <AssistantMarkdown text={answer.content} isStreaming={false} />
      {!!answer.citations?.length && <div className="mt-2 flex flex-wrap gap-1">
        {answer.citations.map(citation => <button type="button" key={citation.lookup} onClick={() => {
          const search = new URLSearchParams();
          search.set('lookup', citation.lookup);
          navigate({ pathname: '/knowledge', search: search.toString() }, { state: { knowledgeCitation: citation, knowledgeTitle: citation.title } });
        }} className="max-w-full truncate rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
          title={citation.path || citation.lookup}>{citation.title}</button>)}
      </div>}
    </div>}
    {operation?.error && <p role="alert" className="mt-2 break-words text-sm text-red-700 dark:text-red-400">{operation.error}</p>}
    {(phase === 'failed' || phase === 'interrupted') && question && <button type="button" onClick={() => onAsk(question.content)}
      className="mt-2 rounded-md border border-border px-2 py-1 text-xs hover:bg-black/5 dark:hover:bg-white/10" data-testid="chat-knowledge-bot-retry">{t('librarian.retry')}</button>}
  </section>;
}
