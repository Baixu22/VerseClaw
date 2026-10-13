import { afterEach, describe, expect, it, vi } from "vitest";
import { SpanStatusCode } from "@opentelemetry/api";
import { resourceFromAttributes } from "@opentelemetry/resources";
import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace-base";
import type { DiagnosticEventPayload } from "../api.js";
import {
  COST_SAMPLING_POLICY,
  CostSamplingSpanProcessor,
  costSamplingAttributes,
  costSamplingScore,
} from "./cost-sampling.js";

const processors: CostSamplingSpanProcessor[] = [];
afterEach(async () => {
  for (const processor of processors.splice(0)) await processor.shutdown();
  vi.useRealTimers();
});
const prefix = "openclaw.o02.";
function span(
  id: number,
  attrs: Record<string, string | number> = {},
  error = false,
): ReadableSpan {
  return {
    name: "openclaw.model.call",
    kind: 0,
    spanContext: () => ({
      traceId: id.toString(16).padStart(32, "0"),
      spanId: id.toString(16).padStart(16, "0"),
      traceFlags: 1,
    }),
    startTime: [1, 0],
    endTime: [2, 0],
    duration: [1, 0],
    ended: true,
    attributes: { [prefix + "event_kind"]: "model.call.completed", ...attrs },
    status: {
      code: error ? SpanStatusCode.ERROR : SpanStatusCode.UNSET,
      message: "PRIVATE provider body",
    },
    events: [
      {
        name: "PRIVATE prompt",
        time: [1, 0],
        attributes: { text: "PRIVATE prompt" },
        droppedAttributesCount: 0,
      },
    ],
    links: [],
    resource: resourceFromAttributes({ "private.environment": "PRIVATE env" }),
    instrumentationScope: { name: "openclaw" },
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
  };
}
function setup(rate = 1, now: () => number = () => 1000, fail = false) {
  const exported: ReadableSpan[] = [];
  const reports: unknown[] = [];
  const exporter: SpanExporter = {
    export(spans, callback) {
      if (!fail) exported.push(...spans);
      callback({ code: fail ? 1 : 0 });
    },
    async shutdown() {},
  };
  const processor = new CostSamplingSpanProcessor(exporter, {
    sampleRate: rate,
    now,
    onReport: (report) => reports.push(report),
  });
  processors.push(processor);
  return { processor, exported, reports };
}
function event(requestId: string, terminal = false, startedAt = 1000): DiagnosticEventPayload {
  return {
    type: terminal ? "model.call.completed" : "model.call.started",
    ts: startedAt,
    seq: 1,
    runId: "private-run",
    sessionKey: "agent:private-session",
    requestId,
    requestStartedAtMs: startedAt,
    attemptId: "1234567890abcdef",
    callId: "legacy-call",
    provider: "provider",
    model: "model",
    trace: { traceId: "1234567890abcdef1234567890abcdef", spanId: "abcdef1234567890" },
    ...(terminal
      ? {
          durationMs: 5,
          usageSnapshot: {
            terminal: "done",
            usage: { input: 100, output: 20, cacheRead: 50, cacheWrite: 10, total: 180 },
            costUsd: 0.000415,
            price: {
              state: "known",
              currency: "USD",
              unit: "per-million-tokens",
              source: "runtime-model-catalog",
              version: "a".repeat(64),
              rates: { input: 2, output: 8, cacheRead: 0.5, cacheWrite: 3 },
            },
            toolCallIdHashes: [],
            toolCallIdsDropped: 0,
          },
        }
      : {}),
  } as DiagnosticEventPayload;
}

describe("O02 bounded terminal sampling in the existing OTLP owner", () => {
  it("selects the same success set for a fixed seed and keeps the population denominator", async () => {
    const a = setup(0.5),
      b = setup(0.5);
    for (let i = 1; i <= 80; i++) {
      a.processor.onEnd(span(i));
      b.processor.onEnd(span(i));
    }
    await a.processor.forceFlush();
    await b.processor.forceFlush();
    const ids = (values: ReadableSpan[]) => values.map((value) => value.spanContext().traceId);
    expect(ids(a.exported)).toEqual(ids(b.exported));
    expect(a.exported.length).toBeGreaterThan(0);
    expect(a.exported.length).toBeLessThan(80);
    expect(a.processor.snapshot().counters.spans).toBe(80);
    expect(a.processor.snapshot().counters.sampledOut + a.exported.length).toBe(80);
    for (const exported of a.exported)
      expect(costSamplingScore(exported.spanContext().traceId)).toBeLessThan(0.5);
  });
  it("retains error, blocked, incomplete, aborted and recovery at probability zero", async () => {
    const { processor, exported } = setup(0);
    processor.onEnd(span(1));
    processor.onEnd(span(2, {}, true));
    processor.onEnd(span(3, { [prefix + "event_kind"]: "tool.execution.blocked" }));
    processor.onEnd(span(4, { [prefix + "terminal"]: "incomplete" }));
    processor.onEnd(span(5, { [prefix + "terminal"]: "aborted" }));
    processor.onEnd(span(6, { [prefix + "event_kind"]: "session.recovery.completed" }));
    await processor.forceFlush();
    expect(exported).toHaveLength(5);
    expect(processor.snapshot().counters).toMatchObject({ spans: 6, critical: 5, sampledOut: 1 });
    expect(exported.every((value) => value.attributes[prefix + "sample_probability"] === 1)).toBe(
      true,
    );
  });
  it("removes content, credential-bearing resources, free-form status and unknown prefixed attributes", async () => {
    const { processor, exported } = setup();
    processor.onEnd(
      span(1, {
        [prefix + "raw_prompt"]: "PRIVATE prompt",
        authorization: "PRIVATE key",
        [prefix + "request_hash"]: "PRIVATE id",
      }),
    );
    await processor.forceFlush();
    const exportedText = JSON.stringify(exported);
    expect(exportedText).not.toContain("PRIVATE");
    expect(exported[0].attributes).not.toHaveProperty(prefix + "raw_prompt");
    expect(exported[0].events).toEqual([]);
    expect(exported[0].status).toEqual({ code: SpanStatusCode.UNSET });
    expect(exported[0].resource.attributes).toEqual({ "service.name": "openclaw" });
  });
  it("preserves ReadableSpan getter fields without retaining the raw SDK object", async () => {
    const { processor, exported } = setup();
    const original = span(1);
    Object.defineProperty(original, "duration", { enumerable: false, get: () => [1, 0] });
    Object.defineProperty(original, "ended", { enumerable: false, get: () => true });
    Object.defineProperty(original, "privateRaw", { enumerable: true, value: "PRIVATE raw span" });
    processor.onEnd(original);
    await processor.forceFlush();
    expect(exported[0].duration).toEqual([1, 0]);
    expect(exported[0].ended).toBe(true);
    expect(JSON.stringify(exported)).not.toContain("PRIVATE");
  });
  it("bounds queue capacity, evicts success first and reports finite critical retention loss", async () => {
    const { processor, exported } = setup();
    for (let i = 1; i <= COST_SAMPLING_POLICY.maxQueue; i++) processor.onEnd(span(i));
    processor.onEnd(span(2000, {}, true));
    expect(processor.snapshot()).toMatchObject({
      queued: 1024,
      counters: { queueDropped: 1, criticalDropped: 0 },
    });
    await processor.forceFlush();
    expect(exported.some((value) => value.status.code === SpanStatusCode.ERROR)).toBe(true);
    for (let i = 3000; i < 4025; i++) processor.onEnd(span(i, {}, true));
    expect(processor.snapshot().counters.criticalDropped).toBe(1);
  });
  it("expires retained samples instead of exporting stale evidence", async () => {
    let now = 1000;
    const { processor, exported } = setup(1, () => now);
    processor.onEnd(span(1, {}, true));
    now += 300000;
    await processor.forceFlush();
    expect(exported).toEqual([]);
    expect(processor.snapshot().counters).toMatchObject({ expired: 1, criticalDropped: 1 });
  });
  it("counts terminal usage once across duplicate and out-of-order lifecycle events", () => {
    const { processor } = setup();
    expect(processor.accept(event("r1"))).toBe(true);
    expect(processor.accept(event("r1", true))).toBe(true);
    expect(processor.accept(event("r1", true))).toBe(false);
    expect(processor.accept(event("r1"))).toBe(false);
    expect(processor.accept(event("r2", true))).toBe(true);
    expect(processor.accept(event("r2"))).toBe(false);
    expect(processor.snapshot().counters).toMatchObject({
      requests: 2,
      terminals: 2,
      linked: 2,
      knownCost: 2,
      knownCostUsd: 0.00083,
      duplicateEvents: 3,
      missingStart: 1,
    });
  });
  it("does not recharge a retired request and reports never-terminated requests", () => {
    let now = 1000;
    const { processor } = setup(1, () => now);
    processor.accept(event("r1"));
    now += 300000;
    expect(processor.accept(event("r1", true))).toBe(false);
    expect(processor.snapshot().counters).toMatchObject({
      requests: 1,
      terminals: 0,
      missingTerminal: 1,
      retiredEvents: 1,
      knownCostUsd: 0,
    });
  });
  it("bounds request history and separates new identities from repeated legacy call ids", () => {
    const { processor } = setup();
    for (let i = 0; i < 4100; i++) {
      const start = event("r" + i);
      processor.accept(start);
      processor.accept(event("r" + i, true));
    }
    expect(processor.snapshot().retainedRequests).toBeLessThanOrEqual(4096);
    expect(processor.accept(event("r0", true))).toBe(false);
    expect(
      processor.snapshot().counters.duplicateEvents + processor.snapshot().counters.retiredEvents,
    ).toBeGreaterThan(0);
  });
  it("reports exporter failure without throwing into tool/model execution", async () => {
    const { processor } = setup(1, () => 1000, true);
    processor.onEnd(span(1));
    await expect(processor.forceFlush()).resolves.toBeUndefined();
    expect(processor.snapshot().counters).toMatchObject({ exportFailed: 1, exported: 0 });
  });
  it("reports the denominator even when every success is sampled out", async () => {
    vi.useFakeTimers();
    const { processor, reports } = setup(0, () => Date.now());
    processor.onEnd(span(1));
    await vi.advanceTimersByTimeAsync(5000);
    expect(reports.length).toBeGreaterThan(0);
  });
  it("exports batches serially and does not duplicate on concurrent flush", async () => {
    const callbacks: Array<(result: { code: number }) => void> = [];
    let active = 0,
      maxActive = 0,
      total = 0;
    const exporter: SpanExporter = {
      export(spans, callback) {
        active++;
        maxActive = Math.max(maxActive, active);
        total += spans.length;
        callbacks.push((result) => {
          active--;
          callback(result);
        });
      },
      async shutdown() {},
    };
    const processor = new CostSamplingSpanProcessor(exporter);
    processors.push(processor);
    processor.onEnd(span(1));
    const a = processor.forceFlush(),
      b = processor.forceFlush(),
      c = processor.forceFlush();
    callbacks.shift()!({ code: 0 });
    await Promise.all([a, b, c]);
    expect(maxActive).toBe(1);
    expect(total).toBe(1);
  });
  it("hashes request/run/session identity and keeps unknown price explicit", () => {
    const raw = event("PRIVATE-request", true);
    if (raw.type !== "model.call.completed") throw new Error("fixture");
    raw.usageSnapshot!.price = {
      state: "unknown",
      currency: "USD",
      unit: "per-million-tokens",
      source: "runtime-model-catalog",
      version: null,
      rates: null,
    };
    raw.usageSnapshot!.costUsd = null;
    const attrs = costSamplingAttributes(raw);
    expect(attrs[prefix + "cost_state"]).toBe("unknown");
    expect(attrs).not.toHaveProperty(prefix + "estimated_cost_usd");
    expect(attrs[prefix + "request_hash"]).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(attrs)).not.toContain("PRIVATE");
  });
});
