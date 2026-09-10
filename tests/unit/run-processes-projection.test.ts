// `projectRunProcesses` is what makes "正在运转的进程" possible: it has to show a
// process between `tool.started` and its completion, which the transcript's
// `projectCommandSurfaces` deliberately does not.
import { describe, expect, it } from 'vitest';
import { projectCommandSurfaces, projectRunProcesses } from '@/components/tool-ui/run-surfaces';
import type { ChatRuntimeEvent } from '@shared/chat-runtime-events';
import type { ChatRuntimeRunState } from '@/stores/chat/types';

function run(events: ChatRuntimeEvent[]): ChatRuntimeRunState {
  return {
    runId: 'run-a',
    sessionKey: 'session-a',
    status: 'running',
    assistantText: '',
    thinkingText: '',
    events,
  } as ChatRuntimeRunState;
}

const START: ChatRuntimeEvent = {
  type: 'tool.started',
  runId: 'run-a',
  sessionKey: 'session-a',
  toolCallId: 'call-1',
  name: 'command',
  args: { command: 'pnpm vitest run tests/unit', cwd: 'C:/mock/workspace' },
  ts: 1_000,
};

describe('projectRunProcesses', () => {
  it('shows a process as running from tool.started, before any output', () => {
    const [process] = projectRunProcesses(run([START]));

    expect(process).toMatchObject({
      id: 'call-1',
      command: 'pnpm vitest run tests/unit',
      cwd: 'C:/mock/workspace',
      status: 'running',
      output: '',
    });
    // The transcript projection stays silent until output lands — that contrast
    // is the reason both functions exist.
    expect(projectCommandSurfaces(run([START]))).toEqual([]);
  });

  it('settles the same row rather than appending a second one', () => {
    const processes = projectRunProcesses(run([
      START,
      {
        type: 'command.output',
        runId: 'run-a',
        toolCallId: 'call-1',
        itemId: 'item-1',
        output: 'Tests  7 passed (7)\n',
        status: 'completed',
        exitCode: 0,
        durationMs: 1_380,
        ts: 2_000,
      },
    ]));

    expect(processes).toHaveLength(1);
    expect(processes[0]).toMatchObject({
      id: 'call-1',
      status: 'completed',
      exitCode: 0,
      durationMs: 1_380,
      command: 'pnpm vitest run tests/unit',
      startedAt: 1_000,
    });
    expect(processes[0].output).toContain('7 passed');
  });

  it('merges streamed output instead of concatenating the overlap', () => {
    const chunk = (output: string, ts: number, status: string): ChatRuntimeEvent => ({
      type: 'command.output', runId: 'run-a', toolCallId: 'call-1', output, status, ts,
    });
    const [process] = projectRunProcesses(run([
      START,
      chunk('Tests  ', 2_000, 'running'),
      chunk('Tests  7 passed', 2_100, 'running'),
      chunk(' (7)\n', 2_200, 'completed'),
    ]));

    expect(process.output).toBe('Tests  7 passed (7)\n');
    expect(process.status).toBe('completed');
  });

  it('reports a non-zero exit as failed', () => {
    const [process] = projectRunProcesses(run([
      START,
      {
        type: 'command.output', runId: 'run-a', toolCallId: 'call-1',
        output: 'error: 2 failed\n', status: 'completed', exitCode: 1, ts: 2_000,
      },
    ]));

    expect(process.status).toBe('failed');
    expect(process.exitCode).toBe(1);
  });

  it('keeps the launch command when later output carries only the tool name', () => {
    // `command.output` commonly arrives with `name: "command"` and no title. If
    // that won over the command recovered from `tool.started`, a known
    // invocation would be relabelled "command" as soon as it printed a line.
    const [process] = projectRunProcesses(run([
      START,
      {
        type: 'command.output', runId: 'run-a', toolCallId: 'call-1',
        name: 'command', output: 'running…\n', status: 'running', ts: 2_000,
      },
    ]));

    expect(process.command).toBe('pnpm vitest run tests/unit');
    expect(process.cwd).toBe('C:/mock/workspace');
  });

  it('settles from tool.completed when the host emits no command.output', () => {
    const [process] = projectRunProcesses(run([
      START,
      {
        type: 'tool.completed', runId: 'run-a', toolCallId: 'call-1', name: 'command',
        result: { exitCode: 0, output: 'done\n', durationMs: 900 }, ts: 2_000,
      },
    ]));

    expect(process).toMatchObject({ status: 'completed', exitCode: 0, durationMs: 900 });
    expect(process.output).toBe('done\n');
  });

  it('ignores tools that are not shell processes', () => {
    const processes = projectRunProcesses(run([
      { type: 'tool.started', runId: 'run-a', toolCallId: 'call-2', name: 'read_file', args: { path: 'a.ts' }, ts: 1_000 },
      { type: 'tool.completed', runId: 'run-a', toolCallId: 'call-2', name: 'read_file', result: { text: 'x' }, ts: 1_100 },
    ]));

    expect(processes).toEqual([]);
  });

  it('keeps concurrent processes apart', () => {
    const processes = projectRunProcesses(run([
      START,
      {
        type: 'tool.started', runId: 'run-a', toolCallId: 'call-9', name: 'command',
        args: { command: 'pnpm vite --port 5273' }, ts: 1_100,
      },
      {
        type: 'command.output', runId: 'run-a', toolCallId: 'call-1',
        output: 'ok\n', status: 'completed', exitCode: 0, ts: 2_000,
      },
    ]));

    expect(processes).toHaveLength(2);
    expect(processes.find((p) => p.id === 'call-1')?.status).toBe('completed');
    expect(processes.find((p) => p.id === 'call-9')?.status).toBe('running');
  });
});
