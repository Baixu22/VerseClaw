import { describe, expect, it } from 'vitest';
import type { ChatRuntimeRunState, RawMessage, ToolStatus } from '@/stores/chat';
import {
  assistantOutputPhase,
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
  workspaceId = null,
}: {
  messages: RawMessage[];
  sending?: boolean;
  pendingFinal?: boolean;
  streamingMessage?: unknown | null;
  streamingTools?: ToolStatus[];
  activeRunId?: string | null;
  runtimeRuns?: Record<string, ChatRuntimeRunState>;
  graphStepCache?: Record<string, GraphStepCacheEntry>;
  workspaceId?: string | null;
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
    workspaceId,
  });
}

describe('execution projection', () => {
  it('retains a settled tool receipt through an answer-only refresh of its own turn', () => {
    const user: RawMessage = { id: 'owner', role: 'user', content: 'Read my config', timestamp: 1800000000000 };
    const reply: RawMessage = { id: 'answer', role: 'assistant', content: 'Using the backup.', stopReason: 'stop' };
    const cache: Record<string, GraphStepCacheEntry> = { 'msg-owner': { steps: [
      { kind: 'tool', id: 'read', label: 'read_file', depth: 1, status: 'error', inputDetail: '{"path":"config"}', outputDetail: 'ENOENT' },
    ], triggerIndex: 0, replyIndex: null, segmentEnd: 0, agentLabel: 'Main', sessionLabel: 'Main' } };
    const projected = project({ messages: [user, reply], graphStepCache: cache });
    expect(projected.cards[0]).toMatchObject({ status: 'completed', steps: expect.arrayContaining([expect.objectContaining({ id: 'read', status: 'error', outputDetail: 'ENOENT' })]) });
    const other = project({ messages: [{ ...user, id: 'other' }, reply], graphStepCache: cache });
    expect(other.cards.flatMap(card => card.steps).some(step => step.id === 'read')).toBe(false);
  });
  it('recognizes resumed gateway text after the last runtime tool receipt', () => {
    const at = 1_800_000_000_000;
    const run: ChatRuntimeRunState = { runId: 'r', sessionKey: SESSION_KEY, status: 'running', assistantText: '', thinkingText: '',
      events: [{ type: 'tool.completed', runId: 'r', name: 'read_file', toolCallId: 'a', ts: at }] };
    const stream = deriveExecutionStreamState({ sending: true, streamingTools: [],
      streamingMessage: { role: 'assistant', content: 'Resuming.', timestamp: (at + 1000) / 1000 } });
    expect(assistantOutputPhase(run, stream, 'Resuming.', true)).toBe('streaming');
    expect(assistantOutputPhase(run, { ...stream, streamTimestamp: (at - 1000) / 1000 }, 'Earlier text', true)).toBe('syncing');
  });
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
    expect(result.cards[0]).toMatchObject({
      active: false,
      status: 'completed',
      replyIndex: 2,
      hasVisibleReply: true,
    });
    expect(result.cards[0].steps).toEqual([
      expect.objectContaining({
        id: 'search-1',
        label: 'web_fetch',
        status: 'completed',
        kind: 'tool',
        url: 'https://example.test',
      }),
    ]);
    expect(result.cards[0].steps).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Assistant Final' }),
    ]));
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


  it("scopes a runtime chat run only when the owning workspace is known", () => {
    const messages: RawMessage[] = [{ role: "user", content: "Keep the run scoped" }];
    const runtimeRuns: Record<string, ChatRuntimeRunState> = {
      "run-chat": {
        runId: "run-chat",
        sessionKey: SESSION_KEY,
        status: "running",
        assistantText: "",
        thinkingText: "",
        events: [{ type: "run.started", runId: "run-chat", sessionKey: SESSION_KEY }],
      },
    };
    const scoped = project({ messages, sending: true, activeRunId: "run-chat", runtimeRuns, workspaceId: "workspace-a" });
    expect(scoped.cards[0].scopedRunId).toEqual({
      runId: "run-chat",
      scope: { workspaceId: "workspace-a", projectId: "workspace-a", sessionKey: SESSION_KEY },
    });
    expect(scoped.cards[0].codingRunView).toMatchObject({
      codingRunId: scoped.cards[0].runKey,
      scope: { workspaceId: "workspace-a", projectId: "workspace-a", sessionKey: SESSION_KEY },
      runIds: [{ runId: "run-chat" }],
    });
    const unscoped = project({ messages, sending: true, activeRunId: "run-chat", runtimeRuns });
    expect(unscoped.cards[0].active).toBe(true);
    expect(unscoped.cards[0].scopedRunId).toBeUndefined();
    expect(unscoped.cards[0].completionAuthority).toBeUndefined();
    expect(unscoped.cards[0].codingRunView?.scope).toBeNull();
    expect(unscoped.cards[0].codingRunView?.sessionIds).toEqual([]);
  });
});
