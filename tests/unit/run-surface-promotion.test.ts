import { describe, expect, it } from 'vitest';
import { promoteRunSurfaces, isPlanToolName } from '@/pages/Chat/run-surface-promotion';
import { sanitizeGraphSteps } from '@/pages/Chat/execution-projection';
import { deriveRuntimeTaskSteps } from '@/pages/Chat/task-visualization';
import type { ChatRuntimeEvent } from '@shared/chat-runtime-events';
import type { ChatRuntimeRunState } from '@/stores/chat/types';

function runState(events: Array<Partial<ChatRuntimeEvent> & { type: string }>): ChatRuntimeRunState {
  return {
    runId: 'run-1',
    sessionKey: 'agent:main:main',
    status: 'running',
    startedAt: 1,
    assistantText: '',
    thinkingText: '',
    events: events.map((event) => ({ runId: 'run-1', sessionKey: 'agent:main:main', ...event })),
  } as unknown as ChatRuntimeRunState;
}

const PLAN_ARGS = {
  explanation: 'three steps',
  plan: [
    { step: 'audit', status: 'completed' },
    { step: 'wire', status: 'in_progress' },
    { step: 'verify', status: 'pending' },
  ],
};

describe('run surface promotion', () => {
  it('recognises the runtime plan tool names', () => {
    expect(isPlanToolName('update_plan')).toBe(true);
    expect(isPlanToolName('TodoWrite')).toBe(true);
    expect(isPlanToolName('bash')).toBe(false);
    expect(isPlanToolName(undefined)).toBe(false);
  });

  it('promotes command output into a terminal surface', () => {
    const state = runState([
      { type: 'tool.started', toolCallId: 'call-1', name: 'bash', args: { command: 'pnpm test', cwd: '/repo' } },
      { type: 'command.output', itemId: 'cmd-1', toolCallId: 'call-1', name: 'bash', output: 'ok\n', phase: 'end', exitCode: 0 },
    ]);
    const surfaces = promoteRunSurfaces({ runState: state });

    expect(surfaces.terminals).toHaveLength(1);
    expect(surfaces.terminals[0]).toMatchObject({ command: 'pnpm test', cwd: '/repo', status: 'completed', eventOrder: 0 });
    expect(surfaces.promotedStepIds.has('cmd-1')).toBe(true);
  });

  it('parses the runtime update_plan payload into a plan surface', () => {
    const surfaces = promoteRunSurfaces({
      runState: runState([
        { type: 'tool.started', toolCallId: 'call-plan', name: 'update_plan', args: PLAN_ARGS },
      ]),
    });

    expect(surfaces.plan?.description).toBe('three steps');
    expect(surfaces.plan?.todos.map((todo) => [todo.label, todo.status])).toEqual([
      ['audit', 'completed'],
      ['wire', 'in_progress'],
      ['verify', 'pending'],
    ]);
    expect(surfaces.promotedStepIds.has('call-plan')).toBe(true);
  });

  it('recovers the plan from transcript tool calls once the run is no longer active', () => {
    const surfaces = promoteRunSurfaces({
      runState: null,
      segmentMessages: [{
        content: [{ type: 'tool_use', id: 'call-plan', name: 'update_plan', input: PLAN_ARGS }],
      }],
    });

    expect(surfaces.plan?.todos).toHaveLength(3);
  });

  it('marks approvals as promoted so the graph does not show a dead row', () => {
    const surfaces = promoteRunSurfaces({
      runState: runState([
        { type: 'approval.updated', itemId: 'approval-1', toolCallId: 'call-2', title: 'Permission required', status: 'pending' },
      ]),
    });

    expect(surfaces.promotedStepIds.has('approval-1')).toBe(true);
  });

  it('keeps an approval row that carries the only rendering of the runtime warning', () => {
    // `approval.updated` comes from the runtime exec approval path, while
    // PendingRunApprovals renders the ClawX host permission store — disjoint
    // planes. So no card stands behind this event, and its `message` (the exec
    // `warningText`, which carries VerseShell's static no-rollback notice) is
    // shown nowhere else. Dropping the row dropped the text.
    const warning = 'External process write: this command may write outside the ClawX write journal;'
      + ' those changes have no automatic rollback.';
    const state = runState([
      {
        type: 'approval.updated',
        itemId: 'approval-warned',
        toolCallId: 'call-exec',
        title: 'Command approval requested',
        status: 'pending',
        message: warning,
      },
    ]);
    const surfaces = promoteRunSurfaces({ runState: state });
    expect(surfaces.promotedStepIds.has('approval-warned')).toBe(false);

    const steps = sanitizeGraphSteps(deriveRuntimeTaskSteps(state), surfaces.promotedStepIds);
    expect(steps.map((step) => step.id)).toContain('approval-warned');
    expect(steps.find((step) => step.id === 'approval-warned')?.detail).toContain('no automatic rollback');
  });

  it('still drops a message-less approval row', () => {
    const surfaces = promoteRunSurfaces({
      runState: runState([
        { type: 'approval.updated', itemId: 'approval-bare', toolCallId: 'call-2', title: 'Approval', status: 'pending', message: '   ' },
      ]),
    });

    expect(surfaces.promotedStepIds.has('approval-bare')).toBe(true);
  });

  it('leaves no promoted event visible in the execution graph', () => {
    const state = runState([
      { type: 'tool.started', toolCallId: 'call-plan', name: 'update_plan', args: PLAN_ARGS },
      { type: 'tool.started', toolCallId: 'call-bash', name: 'bash', args: { command: 'pnpm test' } },
      { type: 'command.output', itemId: 'cmd-1', toolCallId: 'call-bash', name: 'bash', output: 'ok\n', phase: 'end' },
      { type: 'approval.updated', itemId: 'approval-1', toolCallId: 'call-bash', title: 'Permission required', status: 'pending' },
      { type: 'patch.completed', itemId: 'patch-1', toolCallId: 'call-edit', name: 'Edit', title: 'a.ts', summary: '+1 -0' },
    ]);
    const surfaces = promoteRunSurfaces({ runState: state });
    const steps = sanitizeGraphSteps(deriveRuntimeTaskSteps(state), surfaces.promotedStepIds);
    const stepIds = steps.map((step) => step.id);

    // Promoted rows are gone …
    expect(stepIds).not.toContain('cmd-1');
    expect(stepIds).not.toContain('approval-1');
    expect(stepIds).not.toContain('call-plan');
    // F8b: the launching tool call goes with the output it produced. This
    // assertion used to read `toContain` — that was the double-render.
    expect(stepIds).not.toContain('call-bash');
    // … and everything else survives.
    expect(stepIds).toContain('patch-1');
    for (const id of surfaces.promotedStepIds) {
      expect(stepIds).not.toContain(id);
    }
  });

  /**
   * F8b: a `bash` tool call and the `command.output` it produced are one action.
   * The graph row's detail is the command string and the Terminal card's header
   * is the same string, so keeping both printed the command twice per card.
   */
  describe('F8b · command tool call promoted with its output', () => {
    it('promotes the tool call that produced the output', () => {
      const surfaces = promoteRunSurfaces({
        runState: runState([
          { type: 'tool.started', toolCallId: 'call-1', name: 'bash', args: { command: 'pnpm test' } },
          { type: 'command.output', itemId: 'cmd-1', toolCallId: 'call-1', name: 'bash', output: 'ok\n', phase: 'end', exitCode: 0 },
        ]),
      });

      expect(surfaces.promotedStepIds.has('call-1')).toBe(true);
      expect(surfaces.promotedStepIds.has('cmd-1')).toBe(true);
      // The command still reaches the user exactly once — via the card.
      expect(surfaces.terminals).toHaveLength(1);
      expect(surfaces.terminals[0].command).toBe('pnpm test');
    });

    it('keeps the row of a command that never produced output', () => {
      const state = runState([
        { type: 'tool.started', toolCallId: 'call-silent', name: 'bash', args: { command: 'pnpm build' } },
      ]);
      const surfaces = promoteRunSurfaces({ runState: state });
      const stepIds = sanitizeGraphSteps(deriveRuntimeTaskSteps(state), surfaces.promotedStepIds)
        .map((step) => step.id);

      // No Terminal card exists to carry it, so the graph row is the only trace.
      expect(surfaces.terminals).toHaveLength(0);
      expect(surfaces.promotedStepIds.has('call-silent')).toBe(false);
      expect(stepIds).toContain('call-silent');
    });

    it('only promotes the matching call when several commands interleave', () => {
      const surfaces = promoteRunSurfaces({
        runState: runState([
          { type: 'tool.started', toolCallId: 'call-a', name: 'bash', args: { command: 'pnpm test' } },
          { type: 'tool.started', toolCallId: 'call-b', name: 'bash', args: { command: 'pnpm lint' } },
          { type: 'command.output', itemId: 'cmd-a', toolCallId: 'call-a', name: 'bash', output: 'ok\n', phase: 'end' },
        ]),
      });

      expect(surfaces.promotedStepIds.has('call-a')).toBe(true);
      expect(surfaces.promotedStepIds.has('call-b')).toBe(false);
    });
  });

  it('keeps the previous plan and the failed call diagnostics across live and history', () => {
    const proposal = (id: string) => ({ type: 'tool.started' as const, toolCallId: id, name: 'update_plan', args: PLAN_ARGS });
    const failed = { type: 'tool.completed' as const, toolCallId: 'bad', name: 'update_plan', isError: true, result: { status: 'error', error: 'TASK_CLAIM_REQUIRED' } };
    const history = [{ role: 'assistant', content: [{ type: 'toolCall', id: 'bad', name: 'update_plan', arguments: PLAN_ARGS }] }];
    const receipt = { role: 'toolResult', toolCallId: 'bad', details: failed.result };
    for (const state of [null, runState([proposal('bad')]), runState([proposal('bad'), failed])]) {
      const actual = promoteRunSurfaces({ runState: state, segmentMessages: [...history, receipt] });
      expect(actual.plan).toBeNull();
      expect(actual.promotedStepIds.has('bad')).toBe(false);
    }
    const folded = { ...history[0], _toolResults: [{ toolCallId: 'bad', isError: true, result: [] }] };
    expect(promoteRunSurfaces({ runState: null, segmentMessages: [folded] }).plan).toBeNull();
    const state = runState([proposal('good'), proposal('bad'), failed]);
    const actual = promoteRunSurfaces({ runState: state, segmentMessages: history });
    expect(actual.plan?.id).toBe('good');
    expect(sanitizeGraphSteps(deriveRuntimeTaskSteps(state), actual.promotedStepIds)).toContainEqual(expect.objectContaining({ id: 'bad', status: 'error' }));
  });

  it('drops plan tool rows from message-derived graphs too', () => {
    const steps = sanitizeGraphSteps([
      { id: 'history-tool-1', label: 'update_plan', status: 'completed', kind: 'tool', depth: 1 },
      { id: 'history-tool-2', label: 'bash', status: 'completed', kind: 'tool', depth: 1 },
    ]);

    expect(steps.map((step) => step.label)).toEqual(['bash']);
  });
});
