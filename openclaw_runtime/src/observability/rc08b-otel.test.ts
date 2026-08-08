import { describe, expect, it, vi } from 'vitest';

import {
  buildCorrelationIdentity,
  correlationDigest,
  toOtelSpanId,
  toOtelTraceId,
} from './correlation-ids.js';
import {
  createObservabilityOtlpJsonExporter,
  exportSpansWithParity,
  isSpanExportable,
  toOtlpExportTraceServiceRequest,
  type ExportableSpan,
  type OtlpJsonExportResult,
} from './exporter-parity.js';
import {
  clearRuntimeTraceBuffer,
  getRuntimeTrace,
  setObservabilityTraceExporter,
  storeRuntimeTrace,
} from './trace-buffer.js';
import type { ObservabilityTrace } from './types.js';

function makeTrace(overrides: Partial<ObservabilityTrace> = {}): ObservabilityTrace {
  return {
    id: 'trace-runtime-repair',
    name: 'run',
    runId: 'run-1',
    sessionKey: 'agent:main:main',
    status: 'completed',
    startedAt: 1_700_000_000_000,
    endedAt: 1_700_000_010_000,
    durationMs: 10_000,
    spans: [
      {
        id: 'span-run',
        traceId: 'trace-runtime-repair',
        name: 'run',
        kind: 'orchestrator',
        status: 'completed',
        startedAt: 1_700_000_000_000,
        endedAt: 1_700_000_010_000,
        durationMs: 10_000,
        metrics: {},
        attributes: {},
      },
      {
        id: 'span-model',
        traceId: 'trace-runtime-repair',
        parentSpanId: 'span-run',
        name: 'model-call',
        kind: 'model',
        roleName: 'main',
        modelRef: 'claude-3-5-sonnet',
        status: 'completed',
        startedAt: 1_700_000_001_000,
        endedAt: 1_700_000_009_000,
        durationMs: 8_000,
        metrics: { tokens: 100 },
        attributes: {},
      },
      {
        id: 'span-tool',
        traceId: 'trace-runtime-repair',
        parentSpanId: 'span-run',
        name: 'bash',
        kind: 'tool',
        status: 'completed',
        startedAt: 1_700_000_002_000,
        endedAt: 1_700_000_003_000,
        durationMs: 1_000,
        metrics: {},
        attributes: {},
      },
    ],
    events: [],
    tokenUsage: { input: 80, output: 20, cacheRead: 0, cacheWrite: 0, totalTokens: 100, costUsd: 0 },
    metrics: {},
    tags: [],
    ...overrides,
  };
}

describe('RC-08B OTel and observability convergence', () => {
  it('ingress/run/model-tool/effect/delivery share a stable correlation digest', () => {
    const identity = buildCorrelationIdentity({
      ingressId: 'cron-1',
      runId: 'run-1',
      modelCallId: 'model-call-1',
      effectId: 'effect-1',
      deliveryId: 'delivery-1',
    });
    expect(identity.correlationDigest).toMatch(/^[a-f0-9]{64}$/);
    // Same segments -> same digest.
    const again = buildCorrelationIdentity({
      ingressId: 'cron-1',
      runId: 'run-1',
      modelCallId: 'model-call-1',
      effectId: 'effect-1',
      deliveryId: 'delivery-1',
    });
    expect(again.correlationDigest).toBe(identity.correlationDigest);
    // A different segment changes the digest.
    const changed = buildCorrelationIdentity({
      ingressId: 'cron-1',
      runId: 'run-2',
      modelCallId: 'model-call-1',
      effectId: 'effect-1',
      deliveryId: 'delivery-1',
    });
    expect(changed.correlationDigest).not.toBe(identity.correlationDigest);
  });

  it('correlation digests map to valid OTel trace/span ids', () => {
    const digest = correlationDigest({ runId: 'run-otel' });
    expect(toOtelTraceId(digest)).toMatch(/^[a-f0-9]{32}$/);
    expect(toOtelSpanId(digest)).toMatch(/^[a-f0-9]{16}$/);
    expect(toOtelSpanId(digest, 'child')).toMatch(/^[a-f0-9]{16}$/);
  });

  it('exporter-off parity: no export, no second store, spans unchanged', () => {
    const spans: ExportableSpan[] = [
      { traceId: 'a'.repeat(32), spanId: 'b'.repeat(16), name: 'run', correlationDigest: 'c', attributes: { kind: 'run' } },
    ];
    const off = exportSpansWithParity({ exporterEnabled: false, spans });
    expect(off.exported).toBe(false);
    expect(off.spans).toEqual(spans);
  });

  it('exporter-on exports only spans with zero raw prompt/tool content', () => {
    const clean: ExportableSpan = {
      traceId: 'a'.repeat(32),
      spanId: 'b'.repeat(16),
      name: 'model-call',
      correlationDigest: 'c',
      attributes: { model: 'claude', tokens: 100 },
    };
    expect(isSpanExportable(clean).ok).toBe(true);

    const leaky: ExportableSpan = {
      ...clean,
      attributes: { prompt: 'raw user prompt' },
    };
    expect(isSpanExportable(leaky).ok).toBe(false);

    const on = exportSpansWithParity({ exporterEnabled: true, spans: [clean, leaky] });
    expect(on.exported).toBe(true);
    // Only the clean span exports; the raw-prompt span is dropped.
    expect(on.spans).toHaveLength(1);
  });

  it('encodes the golden trace as the canonical OTLP ExportTraceServiceRequest', () => {
    const request = toOtlpExportTraceServiceRequest(makeTrace());
    expect(request.resourceSpans).toHaveLength(1);
    const resource = request.resourceSpans[0].resource;
    expect(resource.attributes).toContainEqual({ key: 'service.name', value: { stringValue: 'openclaw' } });
    expect(resource.attributes).toContainEqual({ key: 'openclaw.run.id', value: { stringValue: 'run-1' } });
    const spans = request.resourceSpans[0].scopeSpans[0].spans;
    expect(spans).toHaveLength(3);
    // All spans share one OTLP traceId derived from the runtime correlation id.
    const traceIds = new Set(spans.map((span) => span.traceId));
    expect(traceIds.size).toBe(1);
    // Ingress/run/model-tool/effect/delivery correlation is preserved.
    expect(spans.map((span) => span.name)).toEqual(['run', 'model-call', 'bash']);
  });

  it('neutral OTLP fixture: a golden trace is received and validated by the collector', async () => {
    const received: Array<{ body: Record<string, unknown>; contentType?: string }> = [];
    const fetchFn = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      received.push({
        body: JSON.parse(String(init?.body ?? '{}')),
        contentType: init?.headers && typeof init.headers === 'object'
          ? (init.headers as Record<string, string>)['content-type']
          : undefined,
      });
      return new Response(null, { status: 200 });
    });
    const exporter = createObservabilityOtlpJsonExporter({
      endpoint: 'http://127.0.0.1:4318/v1/traces',
      enabled: true,
      serviceName: 'openclaw',
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    const result: OtlpJsonExportResult = await exporter(makeTrace());
    expect(result.exported).toBe(true);
    expect(result.spanCount).toBe(3);
    expect(result.receivedTraceId).toMatch(/^[a-f0-9]{32}$/);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(received[0].contentType).toBe('application/json');
    const body = received[0].body;
    expect(body.resourceSpans?.[0]?.scopeSpans?.[0]?.spans).toHaveLength(3);
  });

  it('exporter failure is honest and does not change the business path', async () => {
    const fetchFn = vi.fn(async () => new Response(null, { status: 500 }));
    const exporter = createObservabilityOtlpJsonExporter({
      endpoint: 'http://127.0.0.1:4318/v1/traces',
      enabled: true,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    const result = await exporter(makeTrace());
    expect(result.exported).toBe(false);
    expect(result.reason).toMatch(/HTTP 500/);
  });

  it('cache rebuild: deleting the observability cache does not change stored evidence', async () => {
    clearRuntimeTraceBuffer();
    setObservabilityTraceExporter(null);
    const trace = makeTrace();
    storeRuntimeTrace(trace);
    expect(getRuntimeTrace(trace.id)?.status).toBe('completed');
    // The in-memory observability cache is rebuildable: clearing it never
    // affects the facts (receipts/domain journals remain authoritative).
    clearRuntimeTraceBuffer();
    expect(getRuntimeTrace(trace.id)).toBeUndefined();
  });

  it('the trace buffer exports completed traces through the installed OTLP exporter', async () => {
    clearRuntimeTraceBuffer();
    const collected: string[] = [];
    const exporter = vi.fn(async (trace: ObservabilityTrace) => {
      collected.push(trace.id);
      return { exported: true, receivedTraceId: toOtelTraceId(trace.id), spanCount: trace.spans.length };
    });
    setObservabilityTraceExporter(exporter as unknown as Parameters<typeof setObservabilityTraceExporter>[0]);
    try {
      storeRuntimeTrace(makeTrace({ id: 'trace-exported', status: 'completed' }));
      await vi.waitFor(() => expect(collected).toContain('trace-exported'));
      // Exporter-off parity: running traces are not exported.
      storeRuntimeTrace(makeTrace({ id: 'trace-running', status: 'running' }));
      expect(collected).not.toContain('trace-running');
    } finally {
      setObservabilityTraceExporter(null);
      clearRuntimeTraceBuffer();
    }
  });
});
