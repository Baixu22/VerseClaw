import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ObservabilityTrace } from '../../shared/types/observability';

const { getTranscriptPathForSessionKeyMock } = vi.hoisted(() => ({
  getTranscriptPathForSessionKeyMock: vi.fn(),
}));

vi.mock('../../electron/utils/token-usage', () => ({
  getTranscriptPathForSessionKey: getTranscriptPathForSessionKeyMock,
}));

import { readTrajectoryEventsForTrace } from '../../electron/services/observability-trajectory';

const tokenUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, costUsd: 0 };

function trace(overrides: Partial<ObservabilityTrace> = {}): ObservabilityTrace {
  return {
    id: 'trace-history',
    name: 'history trace',
    runId: 'run-history',
    sessionKey: 'agent:main:session-1',
    status: 'completed',
    startedAt: Date.parse('2026-06-16T10:00:00.000Z'),
    durationMs: 1000,
    spans: [],
    events: [],
    tokenUsage,
    metrics: {},
    tags: [],
    ...overrides,
  };
}

function trajectoryLine(event: Record<string, unknown>): string {
  return JSON.stringify({
    traceSchema: 'openclaw-trajectory',
    schemaVersion: 1,
    traceId: 'trace-history',
    sessionKey: 'agent:main:session-1',
    runId: 'run-history',
    ...event,
  });
}

describe('observability trajectory reader', () => {
  let tempRoot: string;
  let sessionFilePath: string;
  let sessionDir: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'clawx-observability-trajectory-'));
    sessionDir = join(tempRoot, 'sessions');
    sessionFilePath = join(sessionDir, 'session-1.jsonl');
    await mkdir(sessionDir, { recursive: true });
    getTranscriptPathForSessionKeyMock.mockReturnValue({
      filePath: sessionFilePath,
      sessionId: 'session-1',
      agentId: 'main',
    });
  });

  afterEach(async () => {
    getTranscriptPathForSessionKeyMock.mockReset();
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('restores sorted trajectory events from session-adjacent and pointer files', async () => {
    const adjacentTrajectoryPath = join(sessionDir, 'session-1.trajectory.jsonl');
    const pointerTrajectoryPath = join(tempRoot, 'runtime-flight-recorder.jsonl');
    const pointerPath = join(sessionDir, 'session-1.trajectory-path.json');

    await writeFile(adjacentTrajectoryPath, [
      trajectoryLine({
        type: 'tool.completed',
        ts: '2026-06-16T10:00:03.000Z',
        seq: 3,
        data: { toolName: 'shell_command' },
      }),
      '{not-json',
      JSON.stringify({ traceSchema: 'other', type: 'ignored' }),
      trajectoryLine({
        runId: 'other-run',
        type: 'tool.completed',
        ts: '2026-06-16T10:00:04.000Z',
        seq: 4,
      }),
    ].join('\n'), 'utf8');

    await writeFile(pointerPath, JSON.stringify({
      traceSchema: 'openclaw-trajectory-pointer',
      runtimeFile: pointerTrajectoryPath,
    }), 'utf8');
    await writeFile(pointerTrajectoryPath, [
      trajectoryLine({
        type: 'model.started',
        ts: '2026-06-16T10:00:01.000Z',
        seq: 1,
        modelId: 'openai:gpt-5',
      }),
      trajectoryLine({
        type: 'patch.completed',
        ts: '2026-06-16T10:00:02.000Z',
        seq: 2,
        data: { path: 'src/App.tsx' },
      }),
    ].join('\n'), 'utf8');

    const events = await readTrajectoryEventsForTrace(trace());

    expect(getTranscriptPathForSessionKeyMock).toHaveBeenCalledWith('agent:main:session-1');
    expect(events.map((event) => event.type)).toEqual([
      'model.started',
      'patch.completed',
      'tool.completed',
    ]);
    expect(events.map((event) => event.seq)).toEqual([1, 2, 3]);
  });

  it('keeps only the newest trajectory events when the history exceeds the display cap', async () => {
    const adjacentTrajectoryPath = join(dirname(sessionFilePath), 'session-1.trajectory.jsonl');
    const lines = Array.from({ length: 350 }, (_, index) => trajectoryLine({
      type: 'tool.progress',
      ts: new Date(Date.parse('2026-06-16T10:00:00.000Z') + index * 1000).toISOString(),
      seq: index,
      data: { step: index },
    }));
    await writeFile(adjacentTrajectoryPath, lines.join('\n'), 'utf8');

    const events = await readTrajectoryEventsForTrace(trace());

    expect(events).toHaveLength(300);
    expect(events[0]?.seq).toBe(50);
    expect(events.at(-1)?.seq).toBe(349);
  });

  it('returns no trajectory events when the trace has no session key', async () => {
    await expect(readTrajectoryEventsForTrace(trace({ sessionKey: undefined }))).resolves.toEqual([]);
    expect(getTranscriptPathForSessionKeyMock).not.toHaveBeenCalled();
  });
});
