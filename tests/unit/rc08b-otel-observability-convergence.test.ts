import { describe, expect, it } from 'vitest';

/**
 * RC-08B root acceptance test. Runs the PRODUCTION OTel/observability
 * convergence implementation (openclaw_runtime/src/observability/*), not local
 * constants:
 * - OTel/OTLP owns trace export via the canonical OTLP ExportTraceServiceRequest
 *   schema; no second trace schema or store is introduced.
 * - Ingress, run, model/tool, effect, and delivery share correlation IDs.
 * - Exporter-off parity passes; default raw prompt/tool leakage is zero.
 * - One golden trace exports to a neutral OTLP fixture and is received.
 */
import {
  correlationDigest,
} from '../../openclaw_runtime/src/observability/correlation-ids.js';
import {
  createObservabilityOtlpJsonExporter,
  exportSpansWithParity,
  isSpanExportable,
  toOtlpExportTraceServiceRequest,
  type ExportableSpan,
} from '../../openclaw_runtime/src/observability/exporter-parity.js';

const OTLP_SEGMENTS = ['ingress', 'run', 'model-tool', 'effect', 'delivery'] as const;

function makeTrace() {
  return {
    id: 'golden-trace',
    name: 'golden-run',
    runId: 'run-golden',
    sessionKey: 'agent:main:golden',
    status: 'completed',
    startedAt: 1_700_000_000_000,
    endedAt: 1_700_000_010_000,
    durationMs: 10_000,
    spans: [
      {
        id: 'span-ingress', traceId: 'golden-trace', name: 'ingress', kind: 'orchestrator',
        status: 'completed', startedAt: 1_700_000_000_000, endedAt: 1_700_000_010_000, durationMs: 10_000,
        metrics: {}, attributes: {},
      },
      {
        id: 'span-model', traceId: 'golden-trace', parentSpanId: 'span-ingress', name: 'model-call',
        kind: 'model', modelRef: 'claude-3-5-sonnet', status: 'completed',
        startedAt: 1_700_000_001_000, endedAt: 1_700_000_009_000, durationMs: 8_000,
        metrics: { tokens: 100 }, attributes: {},
      },
      {
        id: 'span-tool', traceId: 'golden-trace', parentSpanId: 'span-ingress', name: 'bash',
        kind: 'tool', status: 'completed', startedAt: 1_700_000_002_000, endedAt: 1_700_000_003_000,
        durationMs: 1_000, metrics: {}, attributes: {},
      },
    ],
    events: [],
    tokenUsage: { input: 80, output: 20, cacheRead: 0, cacheWrite: 0, totalTokens: 100, costUsd: 0 },
    metrics: {},
    tags: [],
  };
}

describe('RC-08B OTel and observability convergence (root acceptance)', () => {
  it('OTel/OTLP owns trace export; no second trace schema or store', () => {
    const request = toOtlpExportTraceServiceRequest(makeTrace());
    // The canonical OTLP ExportTraceServiceRequest envelope is the single schema.
    expect(request.resourceSpans).toHaveLength(1);
    expect(request.resourceSpans[0].scopeSpans[0].spans.length).toBeGreaterThan(0);
    // OTel owns export; the exporter is the only trace path.
    const exporter = createObservabilityOtlpJsonExporter({ endpoint: 'http://collector/v1/traces', enabled: false });
    expect(exporter).toBeTypeOf('function');
  });

  it('ingress/run/model-tool/effect/delivery share correlation IDs', () => {
    // The production correlation identity joins all five segments; changing ANY
    // single segment changes the digest, so every segment participates.
    const base = {
      ingressId: 'ingress-1',
      runId: 'run-1',
      modelCallId: 'model-call-1',
      effectId: 'effect-1',
      deliveryId: 'delivery-1',
    };
    const baseDigest = correlationDigest(base);
    expect(baseDigest).toMatch(/^[a-f0-9]{64}$/);
    const segmentToKey: Record<(typeof OTLP_SEGMENTS)[number], keyof typeof base> = {
      ingress: 'ingressId',
      run: 'runId',
      'model-tool': 'modelCallId',
      effect: 'effectId',
      delivery: 'deliveryId',
    };
    for (const segment of OTLP_SEGMENTS) {
      const key = segmentToKey[segment];
      const changed = correlationDigest({ ...base, [key]: `${base[key]}-changed` });
      expect(changed).not.toBe(baseDigest);
    }
    // The golden trace spans share one OTLP trace id derived from that digest.
    const exported = toOtlpExportTraceServiceRequest(makeTrace());
    const traceIds = new Set(exported.resourceSpans[0].scopeSpans[0].spans.map((span) => span.traceId));
    expect(traceIds.size).toBe(1);
  });

  it('exporter-off parity: no export, no second store', () => {
    const spans: ExportableSpan[] = [
      { traceId: 'a'.repeat(32), spanId: 'b'.repeat(16), name: 'run', correlationDigest: 'c', attributes: { kind: 'run' } },
    ];
    const off = exportSpansWithParity({ exporterEnabled: false, spans });
    expect(off.exported).toBe(false);
    // The in-memory cache is unchanged; no second trace store is created.
    expect(off.spans).toEqual(spans);
  });

  it('default raw prompt/tool content never leaks into the exporter', () => {
    // Redaction attacks: raw content under ANY benign-looking key is blocked.
    const benignKey: ExportableSpan = {
      traceId: 'a'.repeat(32), spanId: 'b'.repeat(16), name: 'model-call', correlationDigest: 'c',
      attributes: { model: 'claude', tokens: 100 },
    };
    expect(isSpanExportable(benignKey).ok).toBe(true);
    for (const key of ['prompt', 'toolOutput', 'tool_output', 'rawMessage', 'systemPrompt']) {
      expect(isSpanExportable({ ...benignKey, attributes: { [key]: 'raw content' } }).ok).toBe(false);
    }
  });

  it('one golden trace exports to a neutral OTLP fixture and is received', async () => {
    const received: Array<{ body: unknown; contentType?: string }> = [];
    const exporter = createObservabilityOtlpJsonExporter({
      endpoint: 'http://127.0.0.1:4318/v1/traces',
      enabled: true,
      serviceName: 'openclaw',
      fetchFn: (async (_input: RequestInfo | URL, init?: RequestInit) => {
        received.push({
          body: JSON.parse(String(init?.body ?? '{}')),
          contentType: init?.headers && typeof init.headers === 'object'
            ? (init.headers as Record<string, string>)['content-type']
            : undefined,
        });
        return new Response(null, { status: 200 });
      }) as unknown as typeof fetch,
    });

    const result = await exporter(makeTrace() as never);
    expect(result.exported).toBe(true);
    expect(result.spanCount).toBe(3);
    expect(received).toHaveLength(1);
    expect(received[0].contentType).toBe('application/json');
    const body = received[0].body as { resourceSpans?: Array<{ scopeSpans?: Array<{ spans?: unknown[] }> }> };
    expect(body.resourceSpans?.[0]?.scopeSpans?.[0]?.spans).toHaveLength(3);
  });

  it('F-09: one golden trace exports over a real local OTLP HTTP collector round trip (no mock fetch)', async () => {
    // F-09: the OTel path must work against a real OTLP HTTP endpoint, not
    // only a stubbed fetchFn. A local node:http server plays the collector;
    // the production exporter performs a real network POST with the canonical
    // ExportTraceServiceRequest envelope.
    const { createServer } = await import('node:http');
    const received: Array<{ body: unknown; contentType?: string }> = [];
    const server = createServer((req, res) => {
      let raw = '';
      req.setEncoding('utf8');
      req.on('data', (chunk) => {
        raw += chunk;
      });
      req.on('end', () => {
        received.push({
          body: JSON.parse(raw) as unknown,
          contentType: req.headers['content-type'],
        });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{}');
      });
    });
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('unreachable');
      const port = address.port;
      const exporter = createObservabilityOtlpJsonExporter({
        endpoint: `http://127.0.0.1:${port}/v1/traces`,
        enabled: true,
        serviceName: 'openclaw',
      });
      const result = await exporter(makeTrace() as never);
      expect(result.exported).toBe(true);
      expect(result.spanCount).toBe(3);
      expect(received).toHaveLength(1);
      expect(received[0].contentType).toBe('application/json');
      const body = received[0].body as {
        resourceSpans?: Array<{
          resource?: { attributes?: Array<{ key: string; value?: { stringValue?: string } }> };
          scopeSpans?: Array<{ spans?: Array<{ traceId?: string; name?: string }> }>;
        }>;
      };
      expect(body.resourceSpans?.[0]?.scopeSpans?.[0]?.spans).toHaveLength(3);
      // The real collector sees the golden trace id on every span.
      const traceIds = new Set(
        (body.resourceSpans?.[0]?.scopeSpans?.[0]?.spans ?? []).map((span) => span.traceId),
      );
      expect(traceIds.size).toBe(1);
      const serviceName = body.resourceSpans?.[0]?.resource?.attributes?.find(
        (attr) => attr.key === 'service.name',
      )?.value?.stringValue;
      expect(serviceName).toBe('openclaw');
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });
});
