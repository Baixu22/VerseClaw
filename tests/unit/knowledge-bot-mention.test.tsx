import { beforeEach, expect, it, vi } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';
import { useKnowledgeBotMention } from '@/pages/Chat/KnowledgeBotActivity';
import type { KnowledgeAnswerProgress } from '@shared/host-events/contract';
import { knowledgeBotQuestion } from '@/pages/Chat/knowledge-bot-mention';
import { knowledgeConversationBusy, startKnowledgeQuestion } from '@/pages/Knowledge/knowledge-bot-run';
import { conversationKey, readConversation, updateConversation } from '@/pages/Knowledge/knowledge-conversations';
import { parseLibrarianCheckpoint } from '@/pages/Knowledge/knowledge-view-utils';

const host = vi.hoisted(() => ({
  answer: vi.fn(),
  listeners: new Set<(event: KnowledgeAnswerProgress) => void>(),
}));
vi.mock('@/lib/host-api', () => ({ hostApi: { knowledge: { answerFromSourceSet: host.answer } } }));
vi.mock('@/lib/host-events', () => ({ hostEvents: {
  onKnowledgeAnswerProgress: (listener: (event: KnowledgeAnswerProgress) => void) => {
    host.listeners.add(listener);
    return () => host.listeners.delete(listener);
  },
} }));
const result = { success: true, answer: 'Thursday', sources: [], unknowns: [], suggestedNextActions: [],
  groundingStatus: 'grounded', retrievalDiagnostics: { resultCount: 0 } };
beforeEach(() => { cleanup(); localStorage.clear(); vi.clearAllMocks(); host.listeners.clear(); });

it('keeps an initial chat panel when the first runtime generation arrives and isolates later resets', () => {
  const initialKey = 'clawx.knowledge.chat-panel.v1.["project","chat",null]';
  localStorage.setItem(initialKey, JSON.stringify({ workspaceId: 'project', sourceSetId: 'release' }));
  const initialProps: { generation?: string } = {};
  const { result, rerender } = renderHook(({ generation }: { generation?: string }) =>
    useKnowledgeBotMention('project', 'chat', generation), { initialProps });
  expect(result.current.context?.sourceSetId).toBe('release');
  rerender({ generation: 'first' });
  expect(result.current.context?.sourceSetId).toBe('release');
  expect(localStorage.getItem(initialKey)).toBeNull();
  rerender({ generation: 'reset' });
  expect(result.current.context).toBeNull();
});

it('recognizes explicit leading recipients and preserves ordinary text', () => {
  expect(knowledgeBotQuestion('@知识库助手 查一下发布日期')).toBe('查一下发布日期');
  expect(knowledgeBotQuestion('@knowledge: check the date')).toBe('check the date');
  expect(knowledgeBotQuestion('@知识库bot')).toBe('');
  for (const text of ['Explain @knowledge', 'name@knowledge.com', '`@knowledge`', '@knowledgeable hello']) {
    expect(knowledgeBotQuestion(text)).toBeNull();
  }
});

it('correlates observed stages, rejects a second send and keeps late results in their originating record', async () => {
  let finish!: (value: unknown) => void;
  host.answer.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const input = { context: {}, workspaceId: 'project-a', mainSessionKey: 'chat-a', question: 'When?', answerMode: 'strict' as const };
  const request = startKnowledgeQuestion(input)!;
  expect(startKnowledgeQuestion(input)).toBeNull();
  expect(knowledgeConversationBusy(request.key)).toBe(true);
  const progress = (event: KnowledgeAnswerProgress) => host.listeners.forEach(listener => listener(event));
  const snapshot = () => parseLibrarianCheckpoint(readConversation(request.key))!;
  progress({ requestId: 'another-request', phase: 'reading' });
  expect(snapshot().messages[0].operation?.phase).toBe('waiting');
  const requestId = snapshot().messages[0].operation!.requestId;
  progress({ requestId, phase: 'searching' });
  progress({ requestId, phase: 'reading' });
  expect(snapshot().messages[0].operation?.steps).toEqual(['searching', 'reading']);
  expect(readConversation(conversationKey('project-b', {}))).toBeNull();
  finish(result);
  await request.completion;
  expect(snapshot().messages.map(message => message.content)).toEqual(['When?', 'Thursday']);
  expect(snapshot().messages[0].operation?.phase).toBe('finished');
  expect(knowledgeConversationBusy(request.key)).toBe(false);
  expect(host.listeners.size).toBe(0);
  progress({ requestId, phase: 'thinking' });
  expect(snapshot().messages[0].operation?.phase).toBe('finished');
});

it('keeps cleared conversations cleared when a pending answer arrives', async () => {
  let finish!: (value: unknown) => void;
  host.answer.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const request = startKnowledgeQuestion({ context: {}, workspaceId: null, mainSessionKey: 'chat', question: 'When?', answerMode: 'strict' })!;
  updateConversation(request.key, () => null);
  finish(result);
  await request.completion;
  expect(readConversation(request.key)).toBeNull();
});

it('shows a model failure even when the host returns a partial answer successfully', async () => {
  host.answer.mockResolvedValue({ ...result, answer: 'Only the source excerpts are available.',
    model: { status: 'error', reason: 'Provider unavailable' } });
  const request = startKnowledgeQuestion({ context: {}, workspaceId: null, mainSessionKey: 'chat', question: 'When?', answerMode: 'strict' })!;
  await request.completion;
  const record = parseLibrarianCheckpoint(readConversation(request.key))!;
  expect(record.messages[0].operation).toMatchObject({ phase: 'failed', error: 'Provider unavailable' });
  expect(record.messages[1].content).toBe('Only the source excerpts are available.');
});
