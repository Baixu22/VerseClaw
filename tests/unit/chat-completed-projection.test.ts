import { describe, expect, it } from 'vitest';
import { deriveExecutionStreamState, deriveNextUserMessageIndexes, deriveUserRunProjection } from '../../src/pages/Chat/execution-projection';
import type { RawMessage } from '../../src/stores/chat/types';

function fixture() {
  const messages: RawMessage[] = [
    { id: 'old-user', role: 'user', content: 'Read file' },
    { id: 'old-tool', role: 'assistant', content: [{ type: 'tool_use', id: 'read', name: 'read', input: { path: 'test.ts' } }] },
    { id: 'old-result', role: 'toolResult', toolCallId: 'read', content: 'file contents' },
    { id: 'old-answer', role: 'assistant', content: 'Completed answer' },
    { id: 'new-user', role: 'user', content: 'Continue' },
  ];
  const subagentCompletionInfos = messages.map(() => null);
  const input: Parameters<typeof deriveUserRunProjection>[0] = {
    messages, subagentCompletionInfos, nextUserMessageIndexes: deriveNextUserMessageIndexes(messages, subagentCompletionInfos),
    currentSessionKey: 'agent:main:projection', currentAgentId: 'main', agents: [{ id: 'main', name: 'Main' }],
    sessionLabels: {}, streamingMessage: null, streamingTools: [], pendingFinal: false, sending: true,
    stream: deriveExecutionStreamState({ streamingMessage: null, streamingTools: [], sending: true }),
    childTranscripts: {}, graphStepCache: {}, runError: null, activeRunId: 'live', runtimeRuns: {}, workspaceId: 'workspace',
  };
  return input;
}

describe('completed history projections during streaming', () => {
  it('reuses the completed card and its steps when only the live text grows', () => {
    const input = fixture(); const first = deriveUserRunProjection(input);
    expect(first.cards[0].active).toBe(false);
    const streamingMessage = { role: 'assistant', content: 'new text' };
    const second = deriveUserRunProjection({ ...input, streamingMessage,
      stream: deriveExecutionStreamState({ streamingMessage, streamingTools: [], sending: true }) });
    expect(second.cards[0]).toBe(first.cards[0]);
    expect(second.cards[0].steps).toBe(first.cards[0].steps);
    expect(second.streamingReplyText).toBe('new text');
  });
  it('invalidates a completed card when its label or history changes', () => {
    const input = fixture(); const first = deriveUserRunProjection(input);
    const renamed = deriveUserRunProjection({ ...input, sessionLabels: { [input.currentSessionKey]: 'Renamed' } });
    expect(renamed.cards[0]).not.toBe(first.cards[0]); expect(renamed.cards[0].sessionLabel).toBe('Renamed');
    const messages = input.messages.map(message => message.id === 'old-answer' ? { ...message, content: 'Corrected answer' } : message);
    const changed = deriveUserRunProjection({ ...input, messages });
    expect(changed.cards[0]).not.toBe(first.cards[0]);
  });
});
