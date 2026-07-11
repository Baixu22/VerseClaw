import { describe, expect, it } from 'vitest';
import type { ChatRuntimeRunState, RawMessage, ToolStatus } from '@/stores/chat';
import {
  createRunKey,
  deriveExecutionStreamState,
  deriveNextUserMessageIndexes,
  deriveUserRunProjection,
  type GraphStepCacheEntry,
  type UserRunProjection,
} from '@/pages/Chat/execution-projection';

const SESSION_KEY = 'agent:main:main';

function project({
  messages,
  sending = false,
  pendingFinal = false,
  streamingMessage = null,
  streamingTools = [],
  activeRunId = null,
  runtimeRuns = {},
  graphStepCache = {},
}: {
  messages: RawMessage[];
  sending?: boolean;
  pendingFinal?: boolean;
  streamingMessage?: unknown | null;
  streamingTools?: ToolStatus[];
  activeRunId?: string | null;
  runtimeRuns?: Record<string, ChatRuntimeRunState>;
  graphStepCache?: Record<string, GraphStepCacheEntry>;
}): UserRunProjection {
  const subagentCompletionInfos = messages.map(() => null);
  const nextUserMessageIndexes = deriveNextUserMessageIndexes(messages, subagentCompletionInfos);
  const stream = deriveExecutionStreamState({ streamingMessage, streamingTools, sending });
  return deriveUserRunProjection({
    messages,
    subagentCompletionInfos,
    currentSessionKey: SESSION_KEY,
    currentAgentId: 'main',
    agents: [{ id: 'main', name: 'Main' }],
    sessionLabels: { [SESSION_KEY]: 'Main session' },
    nextUserMessageIndexes,
    streamingMessage,
    streamingTools,
    pendingFinal,
    sending,
    stream,
    childTranscripts: {},
    graphStepCache,
    runError: null,
    activeRunId,
    runtimeRuns,
  });
}

describe('execution projection', () => {
  it('promotes active runtime assistant text into the latest streaming reply', () => {
    const messages: RawMessage[] = [
      { role: 'user', content: 'Stream through runtime events' },
    ];
    const runtimeRuns: Record<string, ChatRuntimeRunState> = {
      'run-live': {
        runId: 'run-live',
        sessionKey: SESSION_KEY,
        status: 'running',
        assistantText: 'First line of streamed output.',
        thinkingText: '',
        events: [
          {
            type: 'run.started',
            runId: 'run-live',
            sessionKey: SESSION_KEY,
          },
          {
            type: 'assistant.delta',
            runId: 'run-live',
            sessionKey: SESSION_KEY,
            text: 'First line of streamed output.',
          },
        ],
      },
    };

    const result = project({
      messages,
      sending: true,
      activeRunId: 'run-live',
      runtimeRuns,
    });

    expect(result.streamingReplyText).toBe('First line of streamed output.');
    expect(result.cards).toHaveLength(1);
    expect(result.cards[0]).toMatchObject({
      active: true,
      streamingReplyText: 'First line of streamed output.',
    });
  });

  it('keeps a new active runtime run visible when history already has a prior reply', () => {
    const messages: RawMessage[] = [
      { role: 'user', content: 'Earlier request' },
      { role: 'assistant', content: 'Earlier reply.' },
    ];
    const runtimeRuns: Record<string, ChatRuntimeRunState> = {
      'run-new': {
        runId: 'run-new',
        sessionKey: SESSION_KEY,
        status: 'running',
        assistantText: '',
        thinkingText: '',
        events: [
          {
            type: 'run.started',
            runId: 'run-new',
            sessionKey: SESSION_KEY,
          },
        ],
      },
    };

    const result = project({
      messages,
      activeRunId: 'run-new',
      runtimeRuns,
    });

    expect(result.inputRunActive).toBe(true);
    expect(result.runSettledInHistory).toBe(false);
    expect(result.cards).toHaveLength(1);
    expect(result.cards[0]).toMatchObject({
      active: true,
      streamingReplyText: null,
    });
  });

  it('turns active runtime events into a running tool step', () => {
    const messages: RawMessage[] = [
      { role: 'user', content: 'Read the file' },
    ];
    const runtimeRuns: Record<string, ChatRuntimeRunState> = {
      'run-live': {
        runId: 'run-live',
        sessionKey: SESSION_KEY,
        status: 'running',
        assistantText: '',
        thinkingText: '',
        events: [{
          type: 'tool.started',
          runId: 'run-live',
          sessionKey: SESSION_KEY,
          toolCallId: 'read-1',
          name: 'read_file',
          args: { path: '/tmp/demo.md' },
        }],
      },
    };

    const result = project({
      messages,
      sending: true,
      activeRunId: 'run-live',
      runtimeRuns,
    });

    expect(result.cards).toHaveLength(1);
    expect(result.cards[0]).toMatchObject({ active: true, traceId: 'trace_run-live' });
    expect(result.cards[0].steps).toEqual([
      expect.objectContaining({
        id: 'read-1',
        label: 'read_file',
        status: 'running',
        kind: 'tool',
      }),
    ]);
  });

  it('uses history fallback to build a completed graph card', () => {
    const messages: RawMessage[] = [
      { role: 'user', content: 'Search and summarize' },
      {
        role: 'assistant',
        id: 'tool-turn',
        content: [
          { type: 'tool_use', id: 'search-1', name: 'web_fetch', input: { url: 'https://example.test' } },
        ],
      },
      {
        role: 'assistant',
        id: 'final-turn',
        content: [{ type: 'text', text: 'Summary complete.' }],
      },
    ];

    const result = project({ messages });

    expect(result.cards).toHaveLength(1);
    expect(result.cards[0]).toMatchObject({ active: false, replyIndex: 2 });
    expect(result.cards[0].steps).toEqual([
      expect.objectContaining({
        id: 'search-1',
        label: 'web_fetch',
        status: 'completed',
        kind: 'tool',
        url: 'https://example.test',
      }),
      expect.objectContaining({
        id: 'assistant-final-final-turn',
        label: 'Assistant Final',
        status: 'completed',
        kind: 'system',
      }),
    ]);
  });

  it('suppresses trailing thinking when streaming text is folded into the graph', () => {
    const messages: RawMessage[] = [
      { role: 'user', content: 'Inspect the repository' },
    ];

    const result = project({
      messages,
      sending: true,
      activeRunId: 'run-stream',
      streamingMessage: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'I will inspect the file first.' },
          { type: 'tool_use', id: 'read-1', name: 'read_file', input: { path: 'src/index.ts' } },
        ],
      },
    });

    expect(result.cards).toHaveLength(1);
    expect(result.cards[0].streamingReplyText).toBeNull();
    expect(result.cards[0].suppressThinking).toBe(true);
    expect(result.cards[0].steps).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'message', detail: 'I will inspect the file first.' }),
      expect.objectContaining({ kind: 'tool', label: 'read_file', status: 'running' }),
    ]));
  });

  it('shows cached graph steps after history reload drops transient graph messages', () => {
    const userMessage: RawMessage = { role: 'user', id: 'user-1', content: 'Reloaded run' };
    const runKey = createRunKey(SESSION_KEY, 0, userMessage);
    const graphStepCache: Record<string, GraphStepCacheEntry> = {
      [runKey]: {
        steps: [{
          id: 'cached-read',
          label: 'read_file',
          status: 'completed',
          kind: 'tool',
          detail: '{"path":"README.md"}',
          depth: 1,
        }],
        agentLabel: 'Main',
        sessionLabel: 'Main session',
        segmentEnd: 1,
        replyIndex: 1,
        triggerIndex: 0,
      },
    };

    const result = project({
      messages: [userMessage],
      graphStepCache,
    });

    expect(result.cards).toHaveLength(1);
    expect(result.cards[0]).toMatchObject({
      runKey,
      active: false,
      agentLabel: 'Main',
    });
    expect(result.cards[0].steps).toEqual([
      expect.objectContaining({ id: 'cached-read', label: 'read_file', status: 'completed' }),
    ]);
  });
});
