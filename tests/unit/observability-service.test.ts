import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildObservabilityDashboardSnapshot,
  clearObservabilityTraceBuffer,
  getObservabilityHostDiagnostics,
  getObservabilityTraceBuffer,
  recordObservabilityHostDiagnostic,
  upsertObservabilityTrace,
} from '../../electron/services/observability-service';
import { createObservabilityApi } from '../../electron/services/observability-api';
import { clearObservabilityIndex, resetObservabilityIndexForTests } from '../../electron/services/observability-index';
import type { ObservabilityHostDiagnostic } from '../../shared/types/observability';

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
      startedAt: Date.now(),
      durationMs: 1200,
      runId: 'run-1',
      sessionKey: 'agent:main:main',
      task: 'explain auth flow',
      mode: 'router',
      tokenUsage: { input: 100, output: 50, cacheRead: 10, cacheWrite: 5, totalTokens: 165, costUsd: 0.003 },
      events: [],
      metrics: {},
      spans: [
        { id: 'span-1', traceId: 'trace-1', name: 'role-router', kind: 'role-router', status: 'completed', startedAt: Date.now(), durationMs: 5, roleName: 'implementer' },
        { id: 'span-2', traceId: 'trace-1', name: 'context-pack', kind: 'context-pack', status: 'completed', startedAt: Date.now(), durationMs: 3 },
      ],
      tags: ['role-first'],
    });

    upsertObservabilityTrace({
      id: 'trace-2',
      name: 'security audit',
      status: 'error',
      startedAt: Date.now(),
      durationMs: 3500,
      mode: 'adversarial-review',
      tokenUsage: { input: 500, output: 200, cacheRead: 0, cacheWrite: 0, totalTokens: 700, costUsd: 0.015 },
      events: [],
      metrics: {},
      spans: [
        { id: 'span-3', traceId: 'trace-2', name: 'role-router', kind: 'role-router', status: 'completed', startedAt: Date.now(), durationMs: 4 },
        { id: 'span-4', traceId: 'trace-2', name: 'skeptic', kind: 'verifier', status: 'error', startedAt: Date.now(), durationMs: 50, error: 'refuted' },
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
      upsertObservabilityTrace({
        id: `trace-${index}`,
        name: `run-${index}`,
        status: 'completed',
        startedAt: Date.now(),
        spans: [],
        events: [],
        tokenUsage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, costUsd: 0 },
        metrics: {},
        tags: [],
      });
    }

    const traces = getObservabilityTraceBuffer();
    expect(traces.length).toBeLessThanOrEqual(200);
  });

  it('keeps host diagnostics separate from full traces and rejects raw or malformed input', () => {
    expect(recordObservabilityHostDiagnostic({
      schemaVersion: '1',
      trace: {
        requestId: 'approval-1',
        traceId: '1'.repeat(32),
        spanId: '2'.repeat(16),
        runId: 'run-1',
        correlationDigest: 'a'.repeat(64),
      },
      failureKind: 'runtime',
      suggestedAction: 'retry',
      durationMs: 12,
      exitCode: 1,
      redaction: 'raw-fields-omitted',
    })).toBe(true);
    expect(recordObservabilityHostDiagnostic({
      schemaVersion: '1',
      trace: {
        requestId: 'approval-raw',
        traceId: '3'.repeat(32),
        spanId: '4'.repeat(16),
      },
      failureKind: 'runtime',
      suggestedAction: 'retry',
      command: 'pnpm test --token secret',
      redaction: 'raw-fields-omitted',
    })).toBe(false);

    const diagnostics = getObservabilityHostDiagnostics();
    expect(diagnostics).toHaveLength(1);
    expect(JSON.stringify(diagnostics)).not.toContain('pnpm test');
    expect('hostDiagnostics' in buildObservabilityDashboardSnapshot()).toBe(false);
    expect(Object.isFrozen(diagnostics[0])).toBe(true);
    expect(Object.isFrozen(diagnostics[0]?.trace)).toBe(true);
  });

  it('fails closed for throwing or hostile summary objects', () => {
    const hostile = new Proxy({}, {
      ownKeys() {
        throw new Error('hostile summary');
      },
    });

    expect(recordObservabilityHostDiagnostic(hostile)).toBe(false);
    expect(getObservabilityHostDiagnostics()).toHaveLength(0);
  });

  it('bounds host diagnostics, returns a defensive array, and clears them with traces', () => {
    for (let index = 0; index < 205; index += 1) {
      expect(recordObservabilityHostDiagnostic({
        schemaVersion: '1',
        trace: {
          requestId: `approval-${index}`,
          traceId: `${index + 1}`.padStart(32, '0'),
          spanId: `${index + 1}`.padStart(16, '0'),
        },
        failureKind: 'unknown',
        suggestedAction: 'continue_with_caution',
        redaction: 'raw-fields-omitted',
      })).toBe(true);
    }
    const copy = getObservabilityHostDiagnostics();
    expect(copy).toHaveLength(200);
    expect(copy[0]?.trace.requestId).toBe('approval-5');
    (copy as ObservabilityHostDiagnostic[]).pop();
    expect(getObservabilityHostDiagnostics()).toHaveLength(200);

    clearObservabilityTraceBuffer();
    expect(getObservabilityHostDiagnostics()).toHaveLength(0);
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
        { id: 'span-1', traceId: 'trace-no-verifier', name: 'role-router', kind: 'role-router', status: 'completed', startedAt: Date.now(), roleName: 'security-reviewer' },
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

  it('reports capability management traces into the observability store and runtime stream', async () => {
    clearObservabilityTraceBuffer();
    const onRuntimeEvent = vi.fn();
    const startedAt = Date.parse('2026-06-20T04:00:00.000Z');
    const api = createObservabilityApi({ onRuntimeEvent });

    const result = await api.observability.reportTrace({
      trace: {
        id: 'trace_capability_test',
        name: 'Capability management',
        status: 'completed',
        startedAt,
        endedAt: startedAt + 25,
        updatedAt: startedAt + 25,
        durationMs: 25,
        mode: 'capability-management',
        task: 'Chat-driven Skill/MCP capability management',
        runId: 'trace_capability_test',
        tokenUsage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, costUsd: 0 },
        metrics: { actions: 1, successes: 1, failures: 0 },
        tags: ['capability-management', 'skill-mcp', 'chat-driven'],
        spans: [
          {
            id: 'trace_capability_test:root',
            traceId: 'trace_capability_test',
            name: 'Chat capability management',
            kind: 'orchestrator',
            status: 'completed',
            startedAt,
            endedAt: startedAt + 25,
            durationMs: 25,
          },
          {
            id: 'trace_capability_test:action:mcp.register-filesystem',
            traceId: 'trace_capability_test',
            parentSpanId: 'trace_capability_test:root',
            name: 'mcp.register: filesystem',
            kind: 'tool',
            status: 'completed',
            startedAt,
            endedAt: startedAt + 25,
            durationMs: 25,
          },
        ],
        events: [
          {
            id: 'trace_capability_test:event:register',
            traceId: 'trace_capability_test',
            spanId: 'trace_capability_test:action:mcp.register-filesystem',
            type: 'capability.register.success',
            name: 'MCP server registered',
            timestamp: startedAt + 5,
          },
        ],
      },
    });

    expect(result).toEqual({ success: true, traceId: 'trace_capability_test' });
    expect(onRuntimeEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'trace.completed',
      trace: expect.objectContaining({ id: 'trace_capability_test' }),
    }));
    expect(buildObservabilityDashboardSnapshot().traces).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'trace_capability_test',
        name: 'Capability management',
        status: 'completed',
      }),
    ]));
    await expect(api.observability.traceGraph({ id: 'trace_capability_test' })).resolves.toEqual(expect.objectContaining({
      trace: expect.objectContaining({ id: 'trace_capability_test' }),
      graph: expect.objectContaining({ traceId: 'trace_capability_test' }),
    }));
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
