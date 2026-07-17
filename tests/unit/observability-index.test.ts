import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { ObservabilityTrace } from '../../shared/types/observability';
import {
  clearObservabilityIndex,
  getIndexedObservabilityTrace,
  loadObservabilityIndex,
  persistObservabilityTraceToIndex,
  queryObservabilityTraces,
  resetObservabilityIndexForTests,
} from '../../electron/services/observability-index';
import { buildObservabilityTraceGraph } from '../../electron/services/observability-graph';

const tokenUsage = {
  input: 100,
  output: 50,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 150,
  costUsd: 0.003,
};

function makeTrace(overrides: Partial<ObservabilityTrace> = {}): ObservabilityTrace {
  const startedAt = overrides.startedAt ?? Date.now() - 24 * 60 * 60 * 1000;
  return {
    id: overrides.id ?? 'trace-index-1',
    name: overrides.name ?? 'Index trace',
    status: overrides.status ?? 'completed',
    startedAt,
    updatedAt: overrides.updatedAt ?? startedAt + 1000,
    durationMs: overrides.durationMs ?? 1000,
    runId: overrides.runId ?? 'run-index-1',
    sessionKey: overrides.sessionKey ?? 'agent:main:index',
    task: overrides.task ?? 'RAW_TASK_PROMPT_SHOULD_NOT_LEAK',
    spans: overrides.spans ?? [
      {
        id: 'tool-1',
        traceId: overrides.id ?? 'trace-index-1',
        name: 'shell_command',
        kind: 'tool',
        status: 'completed',
        startedAt,
        durationMs: 500,
        input: 'RAW_TOOL_ARGS_SHOULD_NOT_LEAK',
        output: 'RAW_TOOL_OUTPUT_SHOULD_NOT_LEAK',
        attributes: {
          prompt: 'RAW_ATTRIBUTE_PROMPT_SHOULD_NOT_LEAK',
          output: 'RAW_ATTRIBUTE_OUTPUT_SHOULD_NOT_LEAK',
          exitCode: 0,
          path: 'src/App.tsx',
        },
      },
    ],
    events: overrides.events ?? [
      {
        id: 'event-1',
        traceId: overrides.id ?? 'trace-index-1',
        spanId: 'tool-1',
        type: 'patch.completed',
        name: 'Patch completed',
        timestamp: startedAt + 500,
        attributes: {
          output: 'RAW_EVENT_OUTPUT_SHOULD_NOT_LEAK',
          path: 'src/App.tsx',
        },
      },
    ],
    tokenUsage: overrides.tokenUsage ?? tokenUsage,
    metrics: overrides.metrics ?? {},
    tags: overrides.tags ?? [],
    mode: overrides.mode,
    error: overrides.error,
    endedAt: overrides.endedAt,
  };
}

describe('observability local trace index', () => {
  let tempRoot: string;
  let previousIndexDir: string | undefined;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'clawx-observability-index-'));
    previousIndexDir = process.env.VERSE_CLAW_OBSERVABILITY_INDEX_DIR;
    process.env.VERSE_CLAW_OBSERVABILITY_INDEX_DIR = tempRoot;
    resetObservabilityIndexForTests();
    await clearObservabilityIndex();
  });

  afterEach(async () => {
    resetObservabilityIndexForTests();
    if (previousIndexDir == null) delete process.env.VERSE_CLAW_OBSERVABILITY_INDEX_DIR;
    else process.env.VERSE_CLAW_OBSERVABILITY_INDEX_DIR = previousIndexDir;
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('persists sanitized trace envelopes and rehydrates graph data', async () => {
    await persistObservabilityTraceToIndex(makeTrace());

    const rawIndex = await readFile(join(tempRoot, 'trace-index.jsonl'), 'utf8');
    expect(rawIndex).not.toContain('RAW_TASK_PROMPT_SHOULD_NOT_LEAK');
    expect(rawIndex).not.toContain('RAW_TOOL_ARGS_SHOULD_NOT_LEAK');
    expect(rawIndex).not.toContain('RAW_TOOL_OUTPUT_SHOULD_NOT_LEAK');
    expect(rawIndex).not.toContain('RAW_ATTRIBUTE_PROMPT_SHOULD_NOT_LEAK');
    expect(rawIndex).not.toContain('RAW_EVENT_OUTPUT_SHOULD_NOT_LEAK');
    expect(rawIndex).toContain('promptHash');
    expect(rawIndex).toContain('outputHash');

    resetObservabilityIndexForTests();
    const loaded = await loadObservabilityIndex();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].sourceStatus).toBe('rehydrated');
    expect(loaded[0].hasArtifacts).toBe(true);
    expect(loaded[0].correlation.filePaths).toContain('src/App.tsx');

    const indexed = await getIndexedObservabilityTrace('trace-index-1');
    expect(indexed?.trace.spans[0].input).toMatch(/^redacted-preview:\d+(?::[a-f0-9]+)?$/u);
    const graph = buildObservabilityTraceGraph(indexed!.trace, [], { sourceStatus: 'rehydrated' });
    expect(graph.graph.summary?.sourceStatus).toBe('rehydrated');
    expect(graph.graph.summary?.coverage?.redacted).toBe(true);
    expect(JSON.stringify(graph)).not.toContain('RAW_TOOL_OUTPUT_SHOULD_NOT_LEAK');
  });

  it('queries status, tool calls, artifacts, keyword, pagination, and sort order', async () => {
    const now = Date.now();
    await persistObservabilityTraceToIndex(makeTrace({ id: 'trace-ok', name: 'Alpha run', status: 'completed', updatedAt: now - 1000 }));
    await persistObservabilityTraceToIndex(makeTrace({
      id: 'trace-error',
      name: 'Beta failure',
      status: 'error',
      updatedAt: now,
      error: 'command failed',
      spans: [
        {
          id: 'tool-error',
          traceId: 'trace-error',
          name: 'shell_command',
          kind: 'tool',
          status: 'error',
          startedAt: 1000,
          durationMs: 2500,
          error: 'exit code 1',
        },
      ],
      events: [
        {
          id: 'retry',
          traceId: 'trace-error',
          spanId: 'tool-error',
          type: 'tool.retry',
          name: 'Tool retry',
          timestamp: 1200,
        },
      ],
    }));

    const failures = await queryObservabilityTraces({ hasErrors: true, pageSize: 10 });
    expect(failures.items.map((item) => item.id)).toEqual(['trace-error']);
    expect(failures.items[0].issues.some((issue) => issue.category === 'error-root-cause')).toBe(true);

    const toolRuns = await queryObservabilityTraces({ hasToolCalls: true, sortBy: 'updatedAt', sortDir: 'asc', pageSize: 1 });
    expect(toolRuns.total).toBe(2);
    expect(toolRuns.items).toHaveLength(1);
    expect(toolRuns.items[0].id).toBe('trace-ok');

    const keyword = await queryObservabilityTraces({ keyword: 'Beta', pageSize: 10 });
    expect(keyword.items.map((item) => item.id)).toEqual(['trace-error']);

    const artifacts = await queryObservabilityTraces({ hasArtifacts: true, pageSize: 10 });
    expect(artifacts.items.map((item) => item.id)).toContain('trace-ok');
    expect(artifacts.facets.status.some((facet) => facet.value === 'error')).toBe(true);
  });

  it('applies time retention and ignores corrupt JSONL records', async () => {
    const oldStartedAt = Date.now() - 31 * 24 * 60 * 60 * 1000;
    await persistObservabilityTraceToIndex(makeTrace({ id: 'trace-old', startedAt: oldStartedAt, updatedAt: oldStartedAt }));
    await persistObservabilityTraceToIndex(makeTrace({ id: 'trace-new', startedAt: Date.now(), updatedAt: Date.now() }));

    resetObservabilityIndexForTests();
    const retained = await loadObservabilityIndex();
    expect(retained.map((entry) => entry.id)).toEqual(['trace-new']);

    const validLine = await readFile(join(tempRoot, 'trace-index.jsonl'), 'utf8');
    await writeFile(join(tempRoot, 'trace-index.jsonl'), `not json\n${validLine}{bad json\n`, 'utf8');
    resetObservabilityIndexForTests();
    const recovered = await loadObservabilityIndex();
    expect(recovered.map((entry) => entry.id)).toEqual(['trace-new']);
  });
});
