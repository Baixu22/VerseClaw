import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createObservabilityApi, setRuntimeTraceFetcher } from '../../electron/services/observability-api';
import { clearObservabilityTraceBuffer } from '../../electron/services/observability-service';
import { clearObservabilityIndex, resetObservabilityIndexForTests } from '../../electron/services/observability-index';

function trajectoryLine(event: Record<string, unknown>): string {
  return JSON.stringify({
    traceSchema: 'openclaw-trajectory',
    schemaVersion: 1,
    traceId: 'trace-runtime-repair',
    sessionKey: 'agent:main:main',
    runId: 'run-runtime-repair',
    ...event,
  });
}

function transcriptLine(record: Record<string, unknown>): string {
  return JSON.stringify({
    type: 'message',
    id: crypto.randomUUID(),
    parentId: null,
    ...record,
  });
}

describe('observability trajectory-backed trace indexing', () => {
  let tempRoot: string;
  let previousUserData: string | undefined;
  let previousIndexDir: string | undefined;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'clawx-observability-trajectory-index-'));
    previousUserData = process.env.VERSE_CLAW_USER_DATA_DIR;
    previousIndexDir = process.env.VERSE_CLAW_OBSERVABILITY_INDEX_DIR;
    process.env.VERSE_CLAW_USER_DATA_DIR = tempRoot;
    process.env.VERSE_CLAW_OBSERVABILITY_INDEX_DIR = join(tempRoot, 'observability-index');
    setRuntimeTraceFetcher(async () => ({ traces: [], scorecards: [] }));
    clearObservabilityTraceBuffer();
    resetObservabilityIndexForTests();
    await clearObservabilityIndex();
  });

  afterEach(async () => {
    clearObservabilityTraceBuffer();
    resetObservabilityIndexForTests();
    if (previousUserData == null) delete process.env.VERSE_CLAW_USER_DATA_DIR;
    else process.env.VERSE_CLAW_USER_DATA_DIR = previousUserData;
    if (previousIndexDir == null) delete process.env.VERSE_CLAW_OBSERVABILITY_INDEX_DIR;
    else process.env.VERSE_CLAW_OBSERVABILITY_INDEX_DIR = previousIndexDir;
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('makes transcript-adjacent runtime trajectory queryable by workspace, sessionKey, and runId', async () => {
    const sessionsDir = join(tempRoot, 'openclaw-source-state', 'agents', 'main', 'sessions');
    const workspaceRoot = join(tempRoot, 'workspaces', 'round-2');
    await mkdir(sessionsDir, { recursive: true });
    await writeFile(join(sessionsDir, 'main.jsonl'), '{"type":"session.placeholder"}\n', 'utf8');
    await writeFile(join(sessionsDir, 'main.trajectory.jsonl'), [
      trajectoryLine({
        type: 'prompt.received',
        ts: '2026-07-04T09:45:55.000Z',
        seq: 1,
        data: {
          workspaceRoot,
          prompt: `Validation repair task.\nWorkspace root: ${workspaceRoot}`,
        },
      }),
      trajectoryLine({
        type: 'model.started',
        ts: '2026-07-04T09:45:56.000Z',
        seq: 2,
        modelId: 'deepseek/deepseek-v4-flash',
        provider: 'deepseek',
        data: { workspaceRoot },
      }),
      trajectoryLine({
        type: 'tool.completed',
        ts: '2026-07-04T09:45:58.000Z',
        seq: 3,
        data: {
          toolName: 'edit',
          path: join(workspaceRoot, 'src', 'math.js'),
          workspaceRoot,
        },
      }),
      trajectoryLine({
        type: 'tool.completed',
        ts: '2026-07-04T09:46:01.000Z',
        seq: 4,
        data: {
          toolName: 'exec',
          command: 'node test/run-tests.mjs',
          cwd: workspaceRoot,
          exitCode: 0,
        },
      }),
      trajectoryLine({
        type: 'assistant.final',
        ts: '2026-07-04T09:46:02.000Z',
        seq: 5,
        data: { summary: 'changed src/math.js and math tests passed' },
      }),
    ].join('\n'), 'utf8');

    const api = createObservabilityApi();
    const byWorkspace = await api.observability.queryTraces({ keyword: workspaceRoot, pageSize: 10 });
    const bySession = await api.observability.queryTraces({ sessionKey: 'agent:main:main', pageSize: 10 });
    const byRun = await api.observability.queryTraces({ runId: 'run-runtime-repair', pageSize: 10 });

    expect(byWorkspace.total).toBe(1);
    expect(bySession.items.map((item) => item.id)).toEqual([byWorkspace.items[0].id]);
    expect(byRun.items.map((item) => item.id)).toEqual([byWorkspace.items[0].id]);
    expect(byWorkspace.items[0]).toEqual(expect.objectContaining({
      runId: 'run-runtime-repair',
      sessionKey: 'agent:main:main',
      hasToolCalls: true,
      model: 'deepseek/deepseek-v4-flash',
    }));
    expect(byWorkspace.items[0].correlation.filePaths).toEqual(expect.arrayContaining([
      workspaceRoot,
      join(workspaceRoot, 'src', 'math.js'),
    ]));

    const graph = await api.observability.traceGraph({ id: byWorkspace.items[0].id });
    expect(graph?.graph.nodes.map((node) => node.label)).toEqual(expect.arrayContaining([
      'edit',
      'exec',
      'deepseek/deepseek-v4-flash',
      'Assistant Final',
    ]));
  });

  it('extracts the workspace path from prompt-only trajectory events', async () => {
    const sessionsDir = join(tempRoot, 'openclaw-source-state', 'agents', 'main', 'sessions');
    const workspaceRoot = join(tempRoot, 'workspaces', 'round-3');
    await mkdir(sessionsDir, { recursive: true });
    await writeFile(join(sessionsDir, 'main.jsonl'), '{"type":"session.placeholder"}\n', 'utf8');
    await writeFile(join(sessionsDir, 'main.trajectory.jsonl'), [
      trajectoryLine({
        type: 'prompt.submitted',
        ts: '2026-07-04T09:46:10.000Z',
        seq: 1,
        data: {
          prompt: [
            'Validation repair task.',
            `Workspace root: ${workspaceRoot}`,
            'Fix the failing math test by editing only src/math.js.',
          ].join('\n'),
        },
      }),
      trajectoryLine({
        type: 'model.completed',
        ts: '2026-07-04T09:46:18.000Z',
        seq: 2,
        modelId: 'deepseek/deepseek-v4-flash',
        provider: 'deepseek',
        data: { output: 'Changed src/math.js and tests passed.' },
      }),
    ].join('\n'), 'utf8');

    const api = createObservabilityApi();
    const byWorkspace = await api.observability.queryTraces({ keyword: workspaceRoot, pageSize: 10 });

    expect(byWorkspace.total).toBe(1);
    expect(byWorkspace.items[0].correlation.filePaths).toContain(workspaceRoot);
  });

  it('splits a session trajectory into separate queryable runId traces', async () => {
    const sessionsDir = join(tempRoot, 'openclaw-source-state', 'agents', 'main', 'sessions');
    const workspaceA = join(tempRoot, 'workspaces', 'round-a');
    const workspaceB = join(tempRoot, 'workspaces', 'round-b');
    await mkdir(sessionsDir, { recursive: true });
    await writeFile(join(sessionsDir, 'main.jsonl'), '{"type":"session.placeholder"}\n', 'utf8');
    await writeFile(join(sessionsDir, 'main.trajectory.jsonl'), [
      trajectoryLine({
        traceId: 'shared-session-trace',
        runId: 'run-a',
        type: 'prompt.submitted',
        ts: '2026-07-04T09:47:00.000Z',
        seq: 1,
        data: { prompt: `Workspace root: ${workspaceA}` },
      }),
      trajectoryLine({
        traceId: 'shared-session-trace',
        runId: 'run-a',
        type: 'model.completed',
        ts: '2026-07-04T09:47:02.000Z',
        seq: 2,
        modelId: 'deepseek/deepseek-v4-flash',
      }),
      trajectoryLine({
        traceId: 'shared-session-trace',
        runId: 'run-b',
        type: 'prompt.submitted',
        ts: '2026-07-04T09:48:00.000Z',
        seq: 3,
        data: { prompt: `Workspace root: ${workspaceB}` },
      }),
      trajectoryLine({
        traceId: 'shared-session-trace',
        runId: 'run-b',
        type: 'model.completed',
        ts: '2026-07-04T09:48:02.000Z',
        seq: 4,
        modelId: 'deepseek/deepseek-v4-flash',
      }),
    ].join('\n'), 'utf8');

    const api = createObservabilityApi();
    const byRunB = await api.observability.queryTraces({ runId: 'run-b', pageSize: 10 });
    const byWorkspaceB = await api.observability.queryTraces({ keyword: workspaceB, pageSize: 10 });

    expect(byRunB.total).toBe(1);
    expect(byRunB.items[0]).toEqual(expect.objectContaining({ runId: 'run-b' }));
    expect(byRunB.items[0].correlation.filePaths).toContain(workspaceB);
    expect(byRunB.items[0].correlation.filePaths).not.toContain(workspaceA);
    expect(byWorkspaceB.items.map((item) => item.runId)).toEqual(['run-b']);
  });

  it('projects transcript prompt, tool calls, tool results, and final answer into the run trace graph', async () => {
    const sessionsDir = join(tempRoot, 'openclaw-source-state', 'agents', 'main', 'sessions');
    const workspaceRoot = join(tempRoot, 'workspaces', 'round-transcript');
    const nextWorkspaceRoot = join(tempRoot, 'workspaces', 'round-next');
    const mathPath = join(workspaceRoot, 'src', 'math.js');
    const nextMathPath = join(nextWorkspaceRoot, 'src', 'math.js');
    await mkdir(sessionsDir, { recursive: true });
    await writeFile(join(sessionsDir, 'main.jsonl'), [
      transcriptLine({
        timestamp: '2026-07-04T09:49:00.000Z',
        message: {
          role: 'user',
          content: `Validation repair task.\nWorkspace root: ${workspaceRoot}\nFix src/math.js.`,
        },
      }),
      transcriptLine({
        timestamp: '2026-07-04T09:49:01.000Z',
        message: {
          role: 'assistant',
          content: {
            type: 'toolCall',
            id: 'call-edit',
            name: 'edit',
            arguments: { path: mathPath },
          },
        },
      }),
      transcriptLine({
        timestamp: '2026-07-04T09:49:02.000Z',
        message: {
          role: 'toolResult',
          toolCallId: 'call-edit',
          toolName: 'edit',
          content: { type: 'text', text: `Successfully replaced 1 block(s) in ${mathPath}.` },
        },
      }),
      transcriptLine({
        timestamp: '2026-07-04T09:49:03.000Z',
        message: {
          role: 'assistant',
          content: {
            type: 'toolCall',
            id: 'call-exec',
            name: 'exec',
            arguments: { command: 'node test/run-tests.mjs', workdir: workspaceRoot },
          },
        },
      }),
      transcriptLine({
        timestamp: '2026-07-04T09:49:04.000Z',
        message: {
          role: 'toolResult',
          toolCallId: 'call-exec',
          toolName: 'exec',
          content: { type: 'text', text: 'math tests passed' },
        },
      }),
      transcriptLine({
        timestamp: '2026-07-04T09:49:05.000Z',
        message: {
          role: 'assistant',
          content: { type: 'text', text: 'Changed src/math.js and tests passed.' },
        },
      }),
      transcriptLine({
        timestamp: '2026-07-04T09:49:07.000Z',
        message: {
          role: 'user',
          content: `Validation repair task.\nWorkspace root: ${nextWorkspaceRoot}\nFix src/math.js.`,
        },
      }),
      transcriptLine({
        timestamp: '2026-07-04T09:49:08.000Z',
        message: {
          role: 'assistant',
          content: {
            type: 'toolCall',
            id: 'call-next-edit',
            name: 'edit',
            arguments: { path: nextMathPath },
          },
        },
      }),
    ].join('\n'), 'utf8');
    await writeFile(join(sessionsDir, 'main.trajectory.jsonl'), [
      trajectoryLine({
        traceId: 'trace-transcript',
        runId: 'run-transcript',
        type: 'prompt.submitted',
        ts: '2026-07-04T09:49:00.000Z',
        seq: 1,
        data: { prompt: `Workspace root: ${workspaceRoot}` },
      }),
      trajectoryLine({
        traceId: 'trace-transcript',
        runId: 'run-transcript',
        type: 'model.completed',
        ts: '2026-07-04T09:49:05.000Z',
        seq: 2,
        modelId: 'deepseek/deepseek-v4-flash',
      }),
    ].join('\n'), 'utf8');

    const api = createObservabilityApi();
    const byWorkspace = await api.observability.queryTraces({ keyword: workspaceRoot, pageSize: 10 });
    const graph = await api.observability.traceGraph({ id: byWorkspace.items[0].id });
    const labels = graph?.graph.nodes.map((node) => node.label) ?? [];

    expect(byWorkspace.total).toBe(1);
    expect(byWorkspace.items[0].hasToolCalls).toBe(true);
    expect(byWorkspace.items[0].correlation.filePaths).toEqual(expect.arrayContaining([workspaceRoot, mathPath]));
    expect(byWorkspace.items[0].correlation.filePaths).not.toContain(nextWorkspaceRoot);
    expect(byWorkspace.items[0].correlation.filePaths).not.toContain(nextMathPath);
    expect(labels).toEqual(expect.arrayContaining([
      'User Prompt',
      'edit',
      'Tool Result: edit',
      'exec',
      'Tool Result: exec',
      'Assistant Final',
    ]));
  });
});
