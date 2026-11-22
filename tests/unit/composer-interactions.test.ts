import { describe, expect, it } from 'vitest';
import { collectComposerInteractions } from '@/pages/Chat/composer-interactions';
import { parseToolUiContent } from '@/components/tool-ui/agent-interactions';
import { projectMessageRender } from '@/pages/Chat/message-render-projection';
import type { RawMessage } from '@/stores/chat/types';

const question = { type: 'question-flow', id: 'request-1', steps: [{ id: 'scope', title: 'Which environment?', options: [{ id: 'staging', label: 'Staging' }] }] };
const fence = '```tool-ui\n' + JSON.stringify(question) + '\n```';
const message: RawMessage = { role: 'assistant', content: fence };
const response = 'Tool UI response:\n' + JSON.stringify({ type: question.type, id: question.id, action: 'complete', value: { scope: ['staging'] } });

describe('composer request ownership', () => {
  it('docks only plans that request approval and retires the selected proposal', () => {
    const proposed = { type: 'plan', id: 'plan-1', requiresApproval: true, todos: [{ id: 'step-1', label: 'Review', status: 'pending' }] };
    const planMessage: RawMessage = { role: 'assistant', content: '```tool-ui\n' + JSON.stringify(proposed) + '\n```' };
    expect(collectComposerInteractions([planMessage])).toHaveLength(1);
    expect(collectComposerInteractions([{ ...planMessage, content: String(planMessage.content).replace('true', 'false') }])).toEqual([]);
    expect(collectComposerInteractions([planMessage, { role: 'user', content: 'Tool UI response:\n{"type":"plan","id":"plan-1","action":"approve"}' }])).toEqual([]);
  });
  it('keeps one request through streaming/history overlap and unrelated follow-ups', () => {
    expect(collectComposerInteractions([message, message, { role: 'user', content: 'Keep the existing plan' }])).toHaveLength(1);
    expect(collectComposerInteractions([message, { role: 'user', content: response }])).toEqual([]);
  });
  it('retains a request while sending or retrying its answer', () => {
    const history: RawMessage[] = [message, { role: 'user', content: response }];
    expect(collectComposerInteractions(history, response)).toHaveLength(1);
    expect(collectComposerInteractions(history)).toEqual([]);
  });
  it('does not retire a different request or render a second actionable timeline copy', () => {
    expect(collectComposerInteractions([message, { role: 'user', content: response.replace('request-1', 'request-2') }])).toHaveLength(1);
    const projection = projectMessageRender(message, { isUser: false, suppressAssistantText: false, suppressToolCards: false, suppressComposerInteractions: true });
    expect(projection.hasRenderableContent).toBe(false);
    expect(collectComposerInteractions([message])).toHaveLength(1);
  });
});

describe('streamed structured output', () => {
  it('holds every partial JSON body until the card is complete', () => {
    for (let i = '```tool-ui\n'.length; i < fence.length; i++) {
      const projected = parseToolUiContent('Before\n' + fence.slice(0, i), { streaming: true });
      expect(projected.displayText).toBe('Before');
      expect(projected.interactions).toEqual([]);
    }
    const parsed = parseToolUiContent('Before\n' + fence + '\nAfter', { streaming: true });
    expect(parsed.interactions).toHaveLength(1);
    expect(parsed.displayText).toContain('After');
  });
  it('keeps ordinary code and malformed final output available', () => {
    const code = '```json\n{"example":';
    expect(parseToolUiContent(code, { streaming: true }).displayText).toBe(code);
    expect(parseToolUiContent('```tool-ui\n{broken').displayText).toContain('{broken');
  });
});
