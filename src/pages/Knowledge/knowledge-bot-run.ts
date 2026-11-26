import { isMemorySourceRef } from '@shared/knowledge/memory';
import { isExperienceSourceRef } from '@shared/knowledge/experience';
import type { KnowledgeAnswerMode } from '@shared/knowledge/answer';
import { hostApi } from '@/lib/host-api';
import { hostEvents } from '@/lib/host-events';
import { errorMessageFrom } from '@/lib/user-error';
import type { KnowledgeLibrarianGroundedAnswer } from '@/lib/knowledge-librarian';
import type { KnowledgeChatContext } from '../Chat/KnowledgeChat';
import { conversationKey, readConversation, updateConversation } from './knowledge-conversations';
import { makeLibrarianMessage, parseLibrarianCheckpoint, type KnowledgeLibrarianMessage } from './knowledge-view-utils';

const requests = new Map<string, string>();
export function knowledgeRunActive(key: string, message: KnowledgeLibrarianMessage) {
  return requests.get(key) === message.operation?.requestId;
}
export function knowledgeConversationBusy(key: string) { return requests.has(key); }

/** Both conversation surfaces observe the same request and persisted outcome. */
export function startKnowledgeQuestion({
  context, workspaceId, question, answerMode, mainSessionKey, emptyCitation = '',
}: {
  context: KnowledgeChatContext;
  workspaceId: string | null;
  question: string;
  answerMode?: KnowledgeAnswerMode;
  mainSessionKey: string;
  emptyCitation?: string;
}) {
  const key = conversationKey(workspaceId, context);
  if (requests.has(key)) return null;
  const previous = parseLibrarianCheckpoint(readConversation(key));
  const user = makeLibrarianMessage('user', question);
  const requestId = crypto.randomUUID();
  user.operation = { requestId, phase: 'waiting', steps: [] };
  requests.set(key, requestId);
  updateConversation(key, record => ({
    ...record, version: 1, updatedAt: user.createdAt,
    editorTitle: context.editorTitle ?? record?.editorTitle ?? '',
    editorSource: context.editorSource ?? record?.editorSource ?? '',
    sourceSetTitle: context.sourceSetTitle, sourceRefs: context.sourceRefs ?? [],
    mainSessionKey, messages: [...(record?.messages ?? []), user],
  }));
  const update = (patch: Partial<NonNullable<KnowledgeLibrarianMessage['operation']>>) => {
    updateConversation(key, record => {
      if (!record?.messages.some(message => message.id === user.id)) return record;
      return { ...record, messages: record.messages.map(message => message.id === user.id
        ? { ...message, operation: { ...message.operation!, ...patch } } : message) };
    });
  };
  const steps: NonNullable<KnowledgeLibrarianMessage['operation']>['steps'] = [];
  const unsubscribe = hostEvents.onKnowledgeAnswerProgress(event => {
    if (event.requestId !== requestId || requests.get(key) !== requestId) return;
    if (!steps.includes(event.phase)) steps.push(event.phase);
    update({ phase: event.phase, steps: [...steps] });
  });
  const completion = (async () => {
    try {
      let mode = answerMode;
      if (!mode) {
        try {
          const result = await hostApi.knowledge.operationsStatus();
          if (result.success) mode = result.operations?.config.answerMode;
        } catch { /* Match the conversation's default during recovery. */ }
      }
      mode ??= 'strict';
      const history = (previous?.messages ?? []).slice(-8).flatMap(message => message.role === 'system'
        ? [] : [{ role: message.role, content: message.content }]);
      const result = await hostApi.knowledge.answerFromSourceSet({
        requestId, question, sourceRefs: context.sourceRefs ?? [], synthesis: true, history, answerMode: mode,
        ...(workspaceId ? { workspaceId } : {}),
        ...(context.sourceSetId ? { sourceSetId: context.sourceSetId } : {}),
      });
      if (!result.success) throw new Error(result.error || 'Knowledge request failed');
      const sources = result.sources.map(source => ({ ...source, path: source.path || source.lookup,
        corpus: isExperienceSourceRef(source.citation?.sourceRef) ? 'all' as const : isMemorySourceRef(source.citation?.sourceRef) ? 'memory' as const : 'wiki' as const,
        answerCitation: result.claims?.flatMap(claim => claim.citations).find(citation => citation.sourceId === source.citation?.refId) }));
      const grounded: KnowledgeLibrarianGroundedAnswer = {
        question, answer: result.answer, sources, unknowns: result.unknowns,
        suggestions: result.suggestedNextActions, nextActions: result.suggestedNextActions,
        groundingStatus: result.groundingStatus, answerMode: result.answerMode ?? mode,
        claims: result.claims,
        retrieval: { query: question, corpus: result.retrievalDiagnostics.corpus, roleTag: 'knowledge-librarian',
          resultCount: result.retrievalDiagnostics.resultCount, selectedSources: sources },
      };
      const answer = makeLibrarianMessage('assistant', grounded.answer, sources.map(source => ({
        lookup: source.lookup, title: source.title, path: source.path, excerpt: source.excerpt || emptyCitation,
        sourceRef: source.answerCitation?.sourceRef ?? source.citation?.sourceRef,
      })), grounded);
      const error = result.model && result.model.status !== 'completed' ? result.model.reason
        : result.claimSupport?.status === 'error' ? result.claimSupport.reason : undefined;
      const phase = error ? 'failed' as const : result.groundingStatus === 'missing_sources' ? 'confused' as const : 'finished' as const;
      requests.delete(key);
      updateConversation(key, record => {
        const index = record?.messages.findIndex(message => message.id === user.id) ?? -1;
        if (!record || index < 0) return record;
        const messages = [...record.messages];
        messages[index] = { ...messages[index], operation: { requestId, phase, steps: [...steps], answerId: answer.id, error } };
        messages.splice(index + 1, 0, answer);
        return { ...record, messages };
      });
      return { phase, error };
    } catch (reason) {
      const error = errorMessageFrom(reason);
      requests.delete(key);
      update({ phase: 'failed', error });
      return { phase: 'failed' as const, error };
    } finally {
      unsubscribe();
      if (requests.get(key) === requestId) requests.delete(key);
    }
  })();
  return { key, user, completion };
}
