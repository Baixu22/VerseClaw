import { beforeEach, describe, expect, it } from 'vitest';
import { buildObservabilityDashboardSnapshot, clearObservabilityTraceBuffer, getObservabilityTraceBuffer, upsertObservabilityTrace } from '../../electron/services/observability-service';
import { createObservabilityApi } from '../../electron/services/observability-api';
import { clearObservabilityIndex, resetObservabilityIndexForTests } from '../../electron/services/observability-index';

describe('observability service in-memory trace buffer', () => {
  beforeEach(async () => {
    clearObservabilityTraceBuffer();
    resetObservabilityIndexForTests();
    await clearObservabilityIndex();
  });

  it('records traces and produces a dashboard snapshot with metric cards', () => {
    clearObservabilityTraceBuffer();

    upsertObservabilityTrace({
      id: 'trace-1',
      name: 'role-first-runtime',
      status: 'completed',
      durationMs: 1200,
      runId: 'run-1',
      sessionKey: 'agent:main:main',
      task: 'explain auth flow',
      mode: 'router',
      tokenUsage: { input: 100, output: 50, cacheRead: 10, cacheWrite: 5, totalTokens: 165, costUsd: 0.003 },
      spans: [
        { id: 'span-1', name: 'role-router', kind: 'role-router', status: 'completed', durationMs: 5, roleName: 'implementer' },
        { id: 'span-2', name: 'context-pack', kind: 'context-pack', status: 'completed', durationMs: 3 },
      ],
      tags: ['role-first'],
    });

    upsertObservabilityTrace({
      id: 'trace-2',
      name: 'security audit',
      status: 'error',
      durationMs: 3500,
      mode: 'adversarial-review',
      tokenUsage: { input: 500, output: 200, totalTokens: 700, costUsd: 0.015 },
      spans: [
        { id: 'span-3', name: 'role-router', kind: 'role-router', status: 'completed', durationMs: 4 },
        { id: 'span-4', name: 'skeptic', kind: 'verifier', status: 'error', durationMs: 50, error: 'refuted' },
      ],
      tags: ['role-first'],
    });

    const traces = getObservabilityTraceBuffer();
    expect(traces).toHaveLength(2);

    const snapshot = buildObservabilityDashboardSnapshot();
    expect(snapshot.traces).toHaveLength(2);
    expect(snapshot.cards.find((card) => card.id === 'traces')?.value).toBe(2);
    expect(snapshot.cards.find((card) => card.id === 'errors')?.value).toBeGreaterThan(0);

    const errorTrace = snapshot.traces.find((trace) => trace.status === 'error');
    expect(errorTrace?.errorCount).toBeGreaterThan(0);

    clearObservabilityTraceBuffer();
    expect(getObservabilityTraceBuffer()).toHaveLength(0);
  });

  it('enforces max trace buffer size', () => {
    clearObservabilityTraceBuffer();

    for (let index = 0; index < 250; index++) {
      upsertObservabilityTrace({ id: `trace-${index}`, name: `run-${index}` });
    }

    const traces = getObservabilityTraceBuffer();
    expect(traces.length).toBeLessThanOrEqual(200);
  });

  it('alerts on missing verifier span for adversarial review traces', () => {
    clearObservabilityTraceBuffer();

    upsertObservabilityTrace({
      id: 'trace-no-verifier',
      name: 'security audit without skeptic',
      status: 'completed',
      mode: 'adversarial-review',
      startedAt: Date.now(),
      spans: [
        { id: 'span-1', name: 'role-router', kind: 'role-router', status: 'completed', roleName: 'security-reviewer' },
      ],
      events: [],
      tokenUsage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, costUsd: 0 },
      metrics: {},
      tags: [],
    });

    const snapshot = buildObservabilityDashboardSnapshot();
    expect(snapshot.alerts.some((alert) => alert.includes('verifier'))).toBe(true);
  });

  it('returns null graph data for an unknown trace id', async () => {
    clearObservabilityTraceBuffer();

    const api = createObservabilityApi();
    await expect(api.observability.traceGraph({ id: 'missing-trace' })).resolves.toBeNull();
  });

  it('returns null diagnostics for unknown trace or node ids', async () => {
    clearObservabilityTraceBuffer();

    upsertObservabilityTrace({
      id: 'trace-diagnostics-null',
      name: 'diagnostics trace',
      status: 'completed',
      startedAt: Date.now(),
      durationMs: 10,
      spans: [],
      events: [],
      tokenUsage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, costUsd: 0 },
      metrics: {},
      tags: [],
    });

    const api = createObservabilityApi();
    await expect(api.observability.traceNodeDiagnostics({ traceId: 'missing-trace', nodeId: 'trace:missing-trace' })).resolves.toBeNull();
    await expect(api.observability.traceNodeDiagnostics({ traceId: 'trace-diagnostics-null', nodeId: 'span:missing' })).resolves.toBeNull();
  });

  it('redacts raw prompt and output content from node diagnostics payloads', async () => {
    clearObservabilityTraceBuffer();
    const startedAt = Date.parse('2026-06-16T10:00:00.000Z');

    upsertObservabilityTrace({
      id: 'trace-redaction',
      name: 'redaction trace',
      status: 'completed',
      startedAt,
      durationMs: 100,
      spans: [
        {
          id: 'model-raw',
          traceId: 'trace-redaction',
          name: 'model.call',
          kind: 'model',
          status: 'completed',
          startedAt,
          durationMs: 80,
          input: 'RAW_PROMPT_SHOULD_NOT_LEAK with private instructions',
          output: 'RAW_OUTPUT_SHOULD_NOT_LEAK with final answer body',
          attributes: {
            prompt: 'ATTRIBUTE_PROMPT_SHOULD_NOT_LEAK',
            rawOutput: 'ATTRIBUTE_RAW_OUTPUT_SHOULD_NOT_LEAK',
            modelId: 'openai:gpt-5',
          },
        },
      ],
      events: [
        {
          id: 'event-output',
          traceId: 'trace-redaction',
          spanId: 'model-raw',
          type: 'tool.output',
          name: 'Tool output',
          timestamp: startedAt + 10,
          attributes: { output: 'EVENT_OUTPUT_SHOULD_NOT_LEAK', bytes: 64 },
        },
      ],
      tokenUsage: { input: 5, output: 7, cacheRead: 0, cacheWrite: 0, totalTokens: 12, costUsd: 0.001 },
      metrics: {},
      tags: [],
    });

    const api = createObservabilityApi();
    const diagnostics = await api.observability.traceNodeDiagnostics({ traceId: 'trace-redaction', nodeId: 'span:model-raw' });
    const payload = JSON.stringify(diagnostics);

    expect(diagnostics?.redacted).toBe(true);
    expect(diagnostics?.inputPreview).toMatch(/^redacted-preview:\d+(?::[a-f0-9]+)?$/u);
    expect(diagnostics?.outputPreview).toMatch(/^redacted-preview:\d+(?::[a-f0-9]+)?$/u);
    expect(payload).not.toContain('RAW_PROMPT_SHOULD_NOT_LEAK');
    expect(payload).not.toContain('RAW_OUTPUT_SHOULD_NOT_LEAK');
    expect(payload).not.toContain('ATTRIBUTE_PROMPT_SHOULD_NOT_LEAK');
    expect(payload).not.toContain('ATTRIBUTE_RAW_OUTPUT_SHOULD_NOT_LEAK');
    expect(payload).not.toContain('EVENT_OUTPUT_SHOULD_NOT_LEAK');
  });
});
