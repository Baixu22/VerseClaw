// RC-08B: the diagnostics-otel extension is the single OTLP trace exporter. This
// golden test starts it through the real plugin-service host, drives one
// ingress -> run -> model/tool -> effect -> delivery trace with production
// trace-context helpers, receives the OTLP/protobuf export on a local HTTP
// collector, and decodes it by the public OTLP field numbers.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import zlib from 'node:zlib';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDiagnosticsOtelService } from '../../extensions/diagnostics-otel/src/service.js';
import {
  emitTrustedDiagnosticEvent,
  emitTrustedDiagnosticEventWithPrivateData,
  waitForDiagnosticEventsDrained,
} from '../infra/diagnostic-events.js';
import {
  createChildDiagnosticTraceContext,
  createDiagnosticTraceContext,
} from '../infra/diagnostic-trace-context.js';
import { startPluginServices } from '../plugins/services.js';
import { clearRuntimeTraceBuffer, getRuntimeTrace, storeRuntimeTrace } from './trace-buffer.js';
import type { ObservabilityTrace } from './types.js';

type DecodedSpan = {
  traceId: string;
  spanId: string;
  parentSpanId: string;
  name: string;
  attributes: Record<string, string>;
};

// --- minimal OTLP/protobuf reader (opentelemetry/proto/trace/v1) -------------

function readVarint(buf: Buffer, pos: number): [bigint, number] {
  let result = 0n;
  let shift = 0n;
  for (;;) {
    const byte = buf[pos++]!;
    result |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return [result, pos];
    shift += 7n;
  }
}

/** Length-delimited fields (wire type 2) of one message, by field number. */
function lengthDelimited(buf: Buffer): Array<[number, Buffer]> {
  const out: Array<[number, Buffer]> = [];
  let pos = 0;
  while (pos < buf.length) {
    const [key, next] = readVarint(buf, pos);
    pos = next;
    const field = Number(key >> 3n);
    const wire = Number(key & 7n);
    if (wire === 0) {
      pos = readVarint(buf, pos)[1];
    } else if (wire === 1) {
      pos += 8;
    } else if (wire === 5) {
      pos += 4;
    } else if (wire === 2) {
      const [len, start] = readVarint(buf, pos);
      out.push([field, buf.subarray(start, start + Number(len))]);
      pos = start + Number(len);
    } else {
      throw new Error(`unsupported wire type ${wire}`);
    }
  }
  return out;
}

const children = (buf: Buffer, field: number) =>
  lengthDelimited(buf).filter(([f]) => f === field).map(([, value]) => value);

function decodeSpan(buf: Buffer): DecodedSpan {
  const hex = (field: number) => children(buf, field)[0]?.toString('hex') ?? '';
  const attributes: Record<string, string> = {};
  for (const kv of children(buf, 9)) {
    const key = children(kv, 1)[0]?.toString('utf8') ?? '';
    const stringValue = children(children(kv, 2)[0] ?? Buffer.alloc(0), 1)[0];
    if (stringValue) attributes[key] = stringValue.toString('utf8');
  }
  return {
    traceId: hex(1),
    spanId: hex(2),
    parentSpanId: hex(4),
    name: children(buf, 5)[0]?.toString('utf8') ?? '',
    attributes,
  };
}

function decodeExportTraceServiceRequest(body: Buffer): DecodedSpan[] {
  return children(body, 1) // resource_spans
    .flatMap((resourceSpans) => children(resourceSpans, 2)) // scope_spans
    .flatMap((scopeSpans) => children(scopeSpans, 2)) // spans
    .map(decodeSpan);
}

// --- neutral OTLP collector fixture -----------------------------------------

const received: Array<{ path: string; body: Buffer }> = [];
let collector: http.Server;
let endpoint = '';

beforeAll(async () => {
  collector = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks);
      const body = req.headers['content-encoding'] === 'gzip' ? zlib.gunzipSync(raw) : raw;
      received.push({ path: req.url ?? '', body });
      res.writeHead(200, { 'content-type': 'application/x-protobuf' });
      res.end();
    });
  });
  await new Promise<void>((resolve) => collector.listen(0, '127.0.0.1', resolve));
  endpoint = `http://127.0.0.1:${(collector.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => collector.close(() => resolve()));
});

function startOtel(otel: Record<string, unknown>) {
  return startPluginServices({
    registry: {
      services: [
        { pluginId: 'diagnostics-otel', origin: 'bundled', service: createDiagnosticsOtelService() },
      ],
    } as never,
    config: { diagnostics: { enabled: true, otel } } as never,
  });
}

const SECRET_PROMPT = 'rc08b-secret-user-prompt-7f3a';
const SECRET_SYSTEM = 'rc08b-secret-system-prompt-91c2';

// Model, tool, effect and delivery events are dispatched asynchronously; the
// drains stand in for the awaits that separate those segments in a real run.
async function emitGoldenTrace() {
  const ingress = createDiagnosticTraceContext();
  const run = createChildDiagnosticTraceContext(ingress);
  const model = createChildDiagnosticTraceContext(run);
  const tool = createChildDiagnosticTraceContext(run);
  const delivery = createChildDiagnosticTraceContext(ingress);
  const base = { sessionKey: 'agent:main:rc08b', channel: 'rc08b' };

  emitTrustedDiagnosticEvent({ type: 'message.dispatch.started', ...base, source: 'rc08b', trace: ingress });
  emitTrustedDiagnosticEvent({ type: 'run.started', runId: 'run-rc08b', ...base, trace: run });
  emitTrustedDiagnosticEvent({
    type: 'model.call.started', runId: 'run-rc08b', callId: 'call-1', provider: 'openai', model: 'gpt-rc08b',
    trace: model,
  });
  emitTrustedDiagnosticEventWithPrivateData(
    {
      type: 'model.call.completed', runId: 'run-rc08b', callId: 'call-1', provider: 'openai', model: 'gpt-rc08b',
      durationMs: 5, trace: model,
    },
    {
      modelContent: {
        inputMessages: [{ role: 'user', content: SECRET_PROMPT }],
        outputMessages: [{ role: 'assistant', content: 'ok' }],
        systemPrompt: SECRET_SYSTEM,
      },
    },
  );
  await waitForDiagnosticEventsDrained();
  emitTrustedDiagnosticEvent({
    type: 'tool.execution.started', requestId: 'req-1', runId: 'run-rc08b', toolName: 'exec', trace: tool,
  });
  emitTrustedDiagnosticEvent({
    type: 'exec.process.completed', target: 'host', mode: 'child', outcome: 'completed', durationMs: 3,
    commandLength: 12, exitCode: 0, trace: tool,
  });
  emitTrustedDiagnosticEvent({
    type: 'tool.execution.completed', requestId: 'req-1', runId: 'run-rc08b', toolName: 'exec', durationMs: 4,
    trace: tool,
  });
  await waitForDiagnosticEventsDrained();
  emitTrustedDiagnosticEvent({
    type: 'run.completed', runId: 'run-rc08b', ...base, durationMs: 12, outcome: 'completed', trace: run,
  });
  emitTrustedDiagnosticEvent({
    type: 'message.delivery.completed', ...base, deliveryKind: 'text', durationMs: 1, resultCount: 1,
    trace: delivery,
  });
  await waitForDiagnosticEventsDrained();
  emitTrustedDiagnosticEvent({
    type: 'message.dispatch.completed', ...base, source: 'rc08b', durationMs: 15, outcome: 'completed',
    trace: ingress,
  });
  return ingress;
}

const traceRequests = () => received.filter((request) => request.path.endsWith('/v1/traces'));

describe('RC-08B OTel golden trace through the diagnostics-otel exporter', () => {
  it('exporter-off parity: with OTel disabled the same events export nothing', async () => {
    const handle = await startOtel({ enabled: false, endpoint });
    await emitGoldenTrace();
    await waitForDiagnosticEventsDrained();
    await handle.stop();
    expect(traceRequests()).toEqual([]);
  });

  it('exports one golden trace whose segments share one trace and parent chain, with no raw content', async () => {
    const handle = await startOtel({ enabled: true, endpoint, metrics: false, logs: false });
    await emitGoldenTrace();
    await waitForDiagnosticEventsDrained();
    await handle.stop();

    const requests = traceRequests();
    expect(requests.length).toBeGreaterThan(0);
    const spans = requests.flatMap((request) => decodeExportTraceServiceRequest(request.body));
    const byName = (name: string) => spans.filter((span) => span.name === name);
    const one = (name: string) => {
      const found = byName(name);
      expect(found, name).toHaveLength(1);
      return found[0]!;
    };

    const ingressSpan = one('openclaw.message.processed');
    const runSpan = one('openclaw.run');
    const modelSpan = one('openclaw.model.call');
    const toolSpan = one('openclaw.tool.execution');
    const execSpan = one('openclaw.exec');
    const deliverySpan = one('openclaw.message.delivery');

    // Every segment belongs to the ingress span's trace.
    for (const span of spans) expect(span.traceId, span.name).toBe(ingressSpan.traceId);
    // ingress -> run -> {model, tool -> effect}; ingress -> delivery.
    expect(runSpan.parentSpanId).toBe(ingressSpan.spanId);
    expect(modelSpan.parentSpanId).toBe(runSpan.spanId);
    expect(toolSpan.parentSpanId).toBe(runSpan.spanId);
    expect(execSpan.parentSpanId).toBe(toolSpan.spanId);
    expect(deliverySpan.parentSpanId).toBe(ingressSpan.spanId);

    // Default content capture is off: raw prompt text never reaches the wire.
    for (const request of requests) {
      expect(request.body.includes(SECRET_PROMPT)).toBe(false);
      expect(request.body.includes(SECRET_SYSTEM)).toBe(false);
    }
  });
});

describe('RC-08B observability cache', () => {
  it('the in-memory trace buffer is a rebuildable cache and exports nothing itself', async () => {
    const module = await import('./trace-buffer.js');
    expect(Object.keys(module)).not.toContain('setObservabilityTraceExporter');
    clearRuntimeTraceBuffer();
    const trace = { id: 'rc08b-cache', status: 'completed', startedAt: Date.now(), spans: [] } as unknown as ObservabilityTrace;
    storeRuntimeTrace(trace);
    expect(getRuntimeTrace('rc08b-cache')).toBeDefined();
    clearRuntimeTraceBuffer();
    expect(getRuntimeTrace('rc08b-cache')).toBeUndefined();
  });
});
