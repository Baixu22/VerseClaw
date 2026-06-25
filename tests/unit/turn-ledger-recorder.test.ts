import { describe, expect, it, vi } from 'vitest';
import {
  buildTurnLedgerEvents,
  extractTurnSummary,
  type TurnLedgerSummary,
} from '@/stores/chat/turn-ledger-recorder';
import type { RawMessage } from '@/stores/chat/types';
import type { ChatRuntimeEvent } from '../../shared/chat-runtime-events';

function user(content: string): RawMessage {
  return { role: 'user', content };
}

function assistant(content: RawMessage['content']): RawMessage {
  return { role: 'assistant', content };
}

describe('turn ledger recorder', () => {
  it('prefers fenced task-ledger JSON when the assistant provides it', () => {
    const summary = extractTurnSummary(user('ship it'), [
      assistant('```task-ledger\n{"outcome":"completed","summary":"Implemented the recorder.","decisions":["Reuse Task Ledger"],"filesTouched":["src/a.ts"],"toolsUsed":["apply_patch"],"reviewNeeded":true}\n```'),
    ]);

    expect(summary).toEqual({
      outcome: 'completed',
      summary: 'Implemented the recorder.',
      decisions: ['Reuse Task Ledger'],
      filesTouched: ['src/a.ts'],
      toolsUsed: ['apply_patch'],
      reviewNeeded: true,
    });
  });

  it('falls back to assistant sections, tool calls, and file paths', () => {
    const summary = extractTurnSummary(user('fix the thing'), [
      assistant([
        { type: 'tool_use', name: 'shell_command', input: {} },
        { type: 'text', text: 'Working in src/stores/chat.ts' },
      ]),
      assistant('## Summary\n- Fixed auto ledger recording\n\n## Decisions\n- Keep writes fire-and-forget\n\nTouched tests/unit/turn-ledger-recorder.test.ts'),
    ]);

    expect(summary.outcome).toBe('completed');
    expect(summary.summary).toBe('Fixed auto ledger recording');
    expect(summary.decisions).toEqual(expect.arrayContaining(['Keep writes fire-and-forget']));
    expect(summary.toolsUsed).toEqual(['shell_command']);
    expect(summary.filesTouched).toEqual(
      expect.arrayContaining(['src/stores/chat.ts', 'tests/unit/turn-ledger-recorder.test.ts']),
    );
  });

  it('projects structured runtime tool, file, and approval evidence into the turn', () => {
    const runtimeEvents: ChatRuntimeEvent[] = [
      {
        type: 'tool.started',
        runId: 'run-1',
        toolCallId: 'tool-read-1',
        name: 'read',
        args: { filePath: 'src/stores/chat.ts' },
      },
      {
        type: 'patch.completed',
        runId: 'run-1',
        toolCallId: 'tool-patch-1',
        name: 'apply_patch',
        summary: 'modified tests/unit/turn-ledger-recorder.test.ts',
      },
      {
        type: 'approval.updated',
        runId: 'run-1',
        itemId: 'approval-1',
        kind: 'command',
        status: 'approved',
        message: 'Allowed test command',
      },
    ];

    const summary = extractTurnSummary(
      user('record structured events'),
      [assistant('Done.')],
      null,
      runtimeEvents,
    );

    expect(summary.toolsUsed).toEqual(expect.arrayContaining(['read', 'apply_patch']));
    expect(summary.filesTouched).toEqual(
      expect.arrayContaining(['src/stores/chat.ts', 'tests/unit/turn-ledger-recorder.test.ts']),
    );
    expect(summary.approvals).toEqual(expect.arrayContaining(['command: approved: Allowed test command']));
    expect(summary.evidenceRefs).toEqual(
      expect.arrayContaining([
        { type: 'tool', ref: 'tool-read-1', label: 'read' },
        { type: 'tool', ref: 'tool-patch-1', label: 'apply_patch' },
        { type: 'other', ref: 'approval-1', label: 'command: approved: Allowed test command' },
        { type: 'file', ref: 'src/stores/chat.ts' },
      ]),
    );
  });

  it('links selected knowledge references from the user turn into ledger evidence', () => {
    const summary = extractTurnSummary({
      role: 'user',
      content: 'Use known context',
      _knowledgeRefs: [
        {
          id: 'wiki-1',
          title: 'Architecture decision',
          lookup: 'wiki/architecture.md',
          corpus: 'wiki',
        },
        {
          id: 'memory-1',
          title: 'User preference',
          lookup: 'memory/user-preference',
          corpus: 'memory',
        },
      ],
    }, [
      assistant('Used the selected context.'),
    ]);

    expect(summary.evidenceRefs).toEqual(expect.arrayContaining([
      { type: 'other', ref: 'wiki/architecture.md', label: 'Architecture decision' },
      { type: 'memory', ref: 'memory/user-preference', label: 'User preference' },
    ]));
    const events = buildTurnLedgerEvents('workspace-a', 'agent:main:abc', summary);
    expect(events[0].payload.node?.evidenceRefs).toEqual(expect.arrayContaining([
      { type: 'other', ref: 'wiki/architecture.md', label: 'Architecture decision' },
      { type: 'memory', ref: 'memory/user-preference', label: 'User preference' },
    ]));
  });

  it('marks heuristic summaries as error when an error is supplied', () => {
    const summary = extractTurnSummary(user('send'), [
      assistant('The turn failed while sending src/app.ts'),
    ], 'Gateway unavailable');

    expect(summary.outcome).toBe('error');
    expect(summary.summary).toContain('send');
  });

  it('builds check node, session link, and review events', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-23T12:00:00.000Z'));
    const summary: TurnLedgerSummary = {
      outcome: 'completed',
      summary: 'Validated the task ledger turn.',
      decisions: [],
      filesTouched: ['src/stores/chat.ts'],
      toolsUsed: ['vitest', 'playwright'],
      reviewNeeded: true,
    };

    const events = buildTurnLedgerEvents('workspace-a', 'agent:main:abc', summary, 'task-1');

    expect(events).toHaveLength(3);
    expect(events[0]).toMatchObject({
      type: 'node_created',
      actor: 'assistant',
      taskId: 'agent:main:abc:turn:1782216000000',
      sessionId: 'agent:main:abc',
      payload: {
        node: {
          id: 'agent:main:abc:turn:1782216000000',
          kind: 'check',
          parentId: 'task-1',
          status: 'done',
          tags: ['vitest', 'playwright'],
        },
      },
    });
    expect(events[0].payload.node?.evidenceRefs).toEqual(
      expect.arrayContaining([
        { type: 'session', ref: 'agent:main:abc', label: 'Turn transcript' },
        { type: 'file', ref: 'src/stores/chat.ts' },
      ]),
    );
    expect(events[1]).toMatchObject({
      type: 'session_linked',
      payload: {
        sessionLink: {
          sessionKey: 'agent:main:abc',
          nodeId: 'agent:main:abc:turn:1782216000000',
          relation: 'related',
        },
      },
    });
    expect(events[2]).toMatchObject({
      type: 'review_requested',
      payload: {
        nodeId: 'agent:main:abc:turn:1782216000000',
        status: 'review',
      },
    });
    vi.useRealTimers();
  });

  it('builds deviation nodes for error outcomes', () => {
    const events = buildTurnLedgerEvents('workspace-a', 'agent:main:abc', {
      outcome: 'error',
      summary: 'Gateway send failed.',
      filesTouched: [],
      toolsUsed: [],
      reviewNeeded: false,
    });

    expect(events[0].payload.node).toMatchObject({
      kind: 'deviation',
      parentId: null,
      status: 'blocked',
    });
  });

  it('uses provided stable turn id and timestamp for reload-safe rebuilds', () => {
    const events = buildTurnLedgerEvents('workspace-a', 'agent:main:abc', {
      outcome: 'completed',
      summary: 'Rebuilt from history.',
      filesTouched: [],
      toolsUsed: [],
      reviewNeeded: false,
    }, null, {
      turnId: 'agent:main:abc:turn:stable',
      timestamp: '2026-06-23T13:00:00.000Z',
    });

    expect(events[0]).toMatchObject({
      taskId: 'agent:main:abc:turn:stable',
      payload: {
        node: {
          id: 'agent:main:abc:turn:stable',
          createdAt: '2026-06-23T13:00:00.000Z',
          updatedAt: '2026-06-23T13:00:00.000Z',
          completedAt: '2026-06-23T13:00:00.000Z',
        },
      },
    });
    expect(events[1].payload.sessionLink?.id).toBe('agent:main:abc:turn:stable');
  });

  it('deduplicates structured evidence refs when building ledger events', () => {
    const events = buildTurnLedgerEvents('workspace-a', 'agent:main:abc', {
      outcome: 'completed',
      summary: 'Structured projection.',
      filesTouched: ['src/stores/chat.ts'],
      toolsUsed: ['read'],
      evidenceRefs: [
        { type: 'tool', ref: 'tool-read-1', label: 'read' },
        { type: 'file', ref: 'src/stores/chat.ts' },
      ],
      approvals: ['command: approved'],
      reviewNeeded: false,
    });

    const evidenceRefs = events[0].payload.node?.evidenceRefs ?? [];
    expect(evidenceRefs.filter((ref) => ref.type === 'file' && ref.ref === 'src/stores/chat.ts')).toHaveLength(1);
    expect(evidenceRefs).toEqual(expect.arrayContaining([{ type: 'tool', ref: 'tool-read-1', label: 'read' }]));
    expect(events[0].payload.node?.metadata).toMatchObject({
      sourceWorkspaceId: 'workspace-a',
      approvals: ['command: approved'],
    });
  });
});
