/** O02 opt-in processing inside the existing OTLP export owner; no second store/exporter. */
import { createHash } from "node:crypto";
import type { Context } from "@opentelemetry/api";
import { SpanStatusCode } from "@opentelemetry/api";
import { resourceFromAttributes } from "@opentelemetry/resources";
import type {
  ReadableSpan,
  Span,
  SpanExporter,
  SpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import type { DiagnosticEventPayload } from "../api.js";

export const COST_SAMPLING_POLICY = Object.freeze({
  version: "openclaw.trace.cost-sampling.v1",
  maxQueue: 1024,
  batchSize: 512,
  ttlMs: 300_000,
  maxRequests: 4096,
  exportTimeoutMs: 30_000,
});
const PREFIX = "openclaw.o02.";
const BUCKETS = ["input", "output", "cacheRead", "cacheWrite"] as const;
type Attributes = Record<string, string | number | boolean>;
type ModelEvent = Extract<
  DiagnosticEventPayload,
  { type: "model.call.started" | "model.call.completed" | "model.call.error" }
>;
type Request = { startedAt: number; receivedAt: number; ended: boolean; spanId?: string };
type Queued = { span: ReadableSpan; receivedAt: number; important: boolean };
const SAFE_RESOURCE = resourceFromAttributes({ "service.name": "openclaw" });
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;
const identity = (domain: string, value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 && value.length <= 512
    ? createHash("sha256")
        .update(COST_SAMPLING_POLICY.version + "\0" + domain + "\0" + value)
        .digest("hex")
    : undefined;
const isModel = (event: DiagnosticEventPayload): event is ModelEvent =>
  event.type === "model.call.started" ||
  event.type === "model.call.completed" ||
  event.type === "model.call.error";

const EVENT_KINDS = new Set([
  "model.call.started",
  "model.call.completed",
  "model.call.error",
  "tool.execution.started",
  "tool.execution.completed",
  "tool.execution.error",
  "tool.execution.blocked",
  "session.recovery.requested",
  "session.recovery.completed",
  "run.started",
  "run.completed",
  "model.failover",
  "exec.process.completed",
]);
const SPAN_NAMES = new Set([
  "openclaw.model.call",
  "openclaw.model.usage",
  "openclaw.webhook.processed",
  "openclaw.webhook.error",
  "openclaw.message.processed",
  "openclaw.message.delivery",
  "openclaw.run",
  "openclaw.session.stuck",
  "openclaw.tool.loop",
  "openclaw.memory.pressure",
  "openclaw.harness.run",
  "openclaw.context.assembled",
  "openclaw.model.failover",
  "openclaw.skill.used",
  "openclaw.tool.execution",
  "openclaw.exec",
  "openclaw.liveness.warning",
  "openclaw.diagnostic.phase",
  "openclaw.session.recovery",
]);
function safeAttributes(input: ReadableSpan["attributes"]): Attributes {
  const result: Attributes = {};
  for (const [key, value] of Object.entries(input)) {
    if (!key.startsWith(PREFIX)) continue;
    const name = key.slice(PREFIX.length);
    if (
      /^(?:run|session|request|attempt|provider|model|tool_call|parent_request)_hash$/.test(name) ||
      name === "price_version"
    ) {
      if (typeof value === "string" && /^[a-f0-9]{64}$/.test(value)) result[key] = value;
    } else if (name === "tool_call_hashes") {
      if (
        typeof value === "string" &&
        value.length <= 8320 &&
        value.split(",").every((hash) => /^[a-f0-9]{64}$/.test(hash))
      )
        result[key] = value;
    } else if (
      /^(?:(?:tokens|price)\.(?:input|output|cacheRead|cacheWrite|total)|request_started_at_ms|estimated_cost_usd|tool_links_dropped)$/.test(
        name,
      )
    ) {
      if (finite(value)) result[key] = value;
    } else if (name === "event_kind") {
      if (typeof value === "string" && EVENT_KINDS.has(value)) result[key] = value;
    } else if (
      name === "terminal" &&
      ["done", "error", "aborted", "incomplete", "conflicting"].includes(String(value))
    )
      result[key] = String(value);
    else if (name === "usage_state" && ["measured", "missing"].includes(String(value)))
      result[key] = String(value);
    else if (name === "cost_state" && ["known", "unknown"].includes(String(value)))
      result[key] = String(value);
    else if (name === "price_currency" && value === "USD") result[key] = value;
    else if (name === "price_unit" && value === "per-million-tokens") result[key] = value;
    else if (name === "price_source" && value === "runtime-model-catalog") result[key] = value;
  }
  return result;
}

export function costSamplingScore(traceId: string): number {
  return (
    createHash("sha256")
      .update(COST_SAMPLING_POLICY.version + "\0sample\0" + traceId)
      .digest()
      .readUInt32BE(0) / 0x1_0000_0000
  );
}

/** Hash joins, not cardinality labels. Never copy unknown attributes/content into O02. */
export function costSamplingAttributes(event: DiagnosticEventPayload): Attributes {
  const attrs: Attributes = { [PREFIX + "event_kind"]: event.type };
  const addId = (label: string, domain: string, value: unknown) => {
    const hash = identity(domain, value);
    if (hash) attrs[PREFIX + label] = hash;
  };
  if ("runId" in event) addId("run_hash", "run", event.runId);
  if ("sessionId" in event && event.sessionId) addId("session_hash", "session-id", event.sessionId);
  else if ("sessionKey" in event) addId("session_hash", "session-key", event.sessionKey);
  if ("requestId" in event) addId("request_hash", "request", event.requestId);
  if (isModel(event)) {
    addId("attempt_hash", "attempt", event.attemptId);
    addId("provider_hash", "provider", event.provider);
    addId("model_hash", "model", event.model);
    if (finite(event.requestStartedAtMs))
      attrs[PREFIX + "request_started_at_ms"] = event.requestStartedAtMs;
    const snapshot = event.usageSnapshot;
    if (event.type === "model.call.started") return attrs;
    attrs[PREFIX + "terminal"] = snapshot?.terminal ?? "incomplete";
    attrs[PREFIX + "usage_state"] = snapshot?.usage ? "measured" : "missing";
    attrs[PREFIX + "cost_state"] =
      snapshot?.price.state === "known" && finite(snapshot.costUsd) ? "known" : "unknown";
    if (snapshot?.usage) {
      for (const key of [...BUCKETS, "total"] as const) {
        if (finite(snapshot.usage[key])) attrs[PREFIX + "tokens." + key] = snapshot.usage[key];
      }
    }
    attrs[PREFIX + "price_currency"] = "USD";
    attrs[PREFIX + "price_unit"] = "per-million-tokens";
    attrs[PREFIX + "price_source"] = "runtime-model-catalog";
    if (
      snapshot?.price.state === "known" &&
      /^[a-f0-9]{64}$/.test(snapshot.price.version ?? "") &&
      snapshot.price.rates
    ) {
      attrs[PREFIX + "price_version"] = snapshot.price.version!;
      for (const key of BUCKETS)
        if (finite(snapshot.price.rates[key]))
          attrs[PREFIX + "price." + key] = snapshot.price.rates[key];
      if (finite(snapshot.costUsd)) attrs[PREFIX + "estimated_cost_usd"] = snapshot.costUsd;
    }
    const tools =
      snapshot?.toolCallIdHashes.filter((value) => /^[a-f0-9]{64}$/.test(value)).slice(0, 128) ??
      [];
    if (tools.length) attrs[PREFIX + "tool_call_hashes"] = tools.join(",");
    attrs[PREFIX + "tool_links_dropped"] = snapshot?.toolCallIdsDropped ?? 0;
  } else if (event.type.startsWith("tool.execution.")) {
    if ("toolCallId" in event) addId("tool_call_hash", "tool-call", event.toolCallId);
    addId("attempt_hash", "attempt", event.trace?.parentSpanId);
  }
  return attrs;
}

export class CostSamplingSpanProcessor implements SpanProcessor {
  private queue: Queued[] = [];
  private requests = new Map<string, Request>();
  private retiredBefore = -1;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private flight: Promise<void> | undefined;
  private stopped = false;
  private expiring = false;
  private counters = {
    requests: 0,
    terminals: 0,
    linked: 0,
    missingIdentity: 0,
    missingStart: 0,
    missingTerminal: 0,
    missingUsage: 0,
    unknownCost: 0,
    knownCost: 0,
    knownCostUsd: 0,
    duplicateEvents: 0,
    retiredEvents: 0,
    retiredRequests: 0,
    spans: 0,
    selected: 0,
    sampledOut: 0,
    critical: 0,
    queueDropped: 0,
    criticalDropped: 0,
    expired: 0,
    exported: 0,
    exportFailed: 0,
  };
  private readonly sampleRate: number;
  private readonly interval: number;
  constructor(
    private readonly exporter: SpanExporter,
    private readonly options: {
      sampleRate?: number;
      flushIntervalMs?: number;
      now?: () => number;
      onReport?: (report: ReturnType<CostSamplingSpanProcessor["snapshot"]>) => void;
      onMissingTerminal?: (spanId: string) => void;
    } = {},
  ) {
    this.sampleRate = finite(options.sampleRate) ? Math.min(1, options.sampleRate) : 1;
    this.interval = finite(options.flushIntervalMs)
      ? Math.max(1000, options.flushIntervalMs)
      : 5000;
  }
  private now() {
    return (this.options.now ?? Date.now)();
  }
  snapshot() {
    return {
      policy: COST_SAMPLING_POLICY.version,
      sampleRate: this.sampleRate,
      probabilitySeed: COST_SAMPLING_POLICY.version,
      scope: "process-instance",
      counters: { ...this.counters },
      queued: this.queue.length,
      retainedRequests: this.requests.size,
      retiredBeforeMs: this.retiredBefore,
      ttlMs: COST_SAMPLING_POLICY.ttlMs,
      maxQueue: COST_SAMPLING_POLICY.maxQueue,
      maxRequests: COST_SAMPLING_POLICY.maxRequests,
    };
  }
  private report() {
    try {
      this.options.onReport?.(this.snapshot());
    } catch {
      /* Observer-only. */
    }
  }
  private schedule() {
    if (this.timer || this.stopped || this.flight) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.forceFlush();
    }, this.interval);
    this.timer.unref?.();
  }
  private retire(key: string, value: Request) {
    this.requests.delete(key);
    this.retiredBefore = Math.max(this.retiredBefore, value.startedAt);
    this.counters.retiredRequests++;
    if (!value.ended) {
      this.counters.missingTerminal++;
      if (value.spanId) {
        try {
          this.options.onMissingTerminal?.(value.spanId);
        } catch {
          /* Diagnostics cannot block execution. */
        }
      }
    }
  }
  private expire(now: number) {
    if (this.expiring) return;
    this.expiring = true;
    try {
      for (const [key, request] of this.requests) {
        if (now - request.receivedAt >= COST_SAMPLING_POLICY.ttlMs) this.retire(key, request);
      }
      this.queue = this.queue.filter((entry) => {
        if (now - entry.receivedAt < COST_SAMPLING_POLICY.ttlMs) return true;
        this.counters.expired++;
        if (entry.important) this.counters.criticalDropped++;
        return false;
      });
    } finally {
      this.expiring = false;
    }
  }
  finalizeOpenRequests(): void {
    for (const [key, request] of this.requests) if (!request.ended) this.retire(key, request);
  }
  /** Dedupe before metrics, spans and sampling. Evicted ids cannot be charged again. */
  accept(event: DiagnosticEventPayload): boolean {
    if (this.stopped) return false;
    const now = this.now();
    this.expire(now);
    this.schedule();
    if (!isModel(event)) return true;
    const start = event.type === "model.call.started";
    const attrs = costSamplingAttributes(event);
    const requestId = attrs[PREFIX + "request_hash"];
    const startedAt = event.requestStartedAtMs;
    const identified = typeof requestId === "string" && finite(startedAt) && startedAt <= now;
    const key = identified
      ? requestId
      : identity("unattributed-model", event.trace?.spanId ?? event.callId);
    if (!key) {
      this.counters.missingIdentity++;
      return true;
    }
    let request = this.requests.get(key);
    if (request && (request.ended || start)) {
      this.counters.duplicateEvents++;
      return false;
    }
    if (!request && identified && startedAt <= this.retiredBefore) {
      this.counters.retiredEvents++;
      return false;
    }
    if (!request) {
      while (this.requests.size >= COST_SAMPLING_POLICY.maxRequests) {
        const oldest = this.requests.entries().next().value!;
        this.retire(oldest[0], oldest[1]);
      }
      request = {
        startedAt: identified ? startedAt : now,
        receivedAt: now,
        ended: false,
        spanId: event.trace?.spanId,
      };
      this.requests.set(key, request);
      this.counters.requests++;
      if (!start) this.counters.missingStart++;
    }
    if (start) return true;
    request.ended = true;
    this.counters.terminals++;
    const linked =
      identified &&
      !!attrs[PREFIX + "run_hash"] &&
      !!attrs[PREFIX + "session_hash"] &&
      !!attrs[PREFIX + "attempt_hash"];
    if (linked) this.counters.linked++;
    else this.counters.missingIdentity++;
    if (attrs[PREFIX + "usage_state"] === "missing") this.counters.missingUsage++;
    const cost = attrs[PREFIX + "estimated_cost_usd"];
    if (identified && finite(cost)) {
      this.counters.knownCost++;
      this.counters.knownCostUsd += cost;
    } else this.counters.unknownCost++;
    return true;
  }
  onStart(_span: Span, _parentContext: Context): void {}
  onEnd(span: ReadableSpan): void {
    if (this.stopped) return;
    const now = this.now();
    this.expire(now);
    this.counters.spans++;
    this.schedule();
    const terminal = span.attributes[PREFIX + "terminal"];
    const kind = span.attributes[PREFIX + "event_kind"];
    const important =
      span.status.code === SpanStatusCode.ERROR ||
      ["error", "aborted", "incomplete", "conflicting"].includes(String(terminal)) ||
      /(?:blocked|recovery|failover)/.test(String(kind)) ||
      span.attributes["openclaw.outcome"] === "blocked" ||
      span.attributes["openclaw.outcome"] === "aborted" ||
      /(?:recovery|failover|stuck)/.test(span.name);
    if (important) this.counters.critical++;
    if (!important && costSamplingScore(span.spanContext().traceId) >= this.sampleRate) {
      this.counters.sampledOut++;
      return;
    }
    this.counters.selected++;
    const attributes = safeAttributes(span.attributes);
    const context = span.spanContext();
    attributes[PREFIX + "policy"] = COST_SAMPLING_POLICY.version;
    attributes[PREFIX + "sample_probability"] = important ? 1 : this.sampleRate;
    attributes[PREFIX + "configured_probability"] = this.sampleRate;
    attributes[PREFIX + "sample_reason"] = important ? "critical" : "deterministic-success";
    attributes[PREFIX + "population_scope"] = "selected-spans-not-total-billing";
    if (span.name === "openclaw.exec") {
      attributes[PREFIX + "effect_id"] = context.spanId;
      attributes[PREFIX + "effect_identity_kind"] = "otel-span-not-domain-receipt";
    }
    // Queue only the fixed safe projection: no arbitrary events, content, resource env or status text.
    const safeContext = {
      traceId: context.traceId,
      spanId: context.spanId,
      traceFlags: context.traceFlags,
    };
    const parent = span.parentSpanContext;
    const safe: ReadableSpan = {
      name: SPAN_NAMES.has(span.name) ? span.name : "openclaw.model.call",
      kind: span.kind,
      spanContext: () => ({ ...safeContext }),
      ...(parent
        ? {
            parentSpanContext: {
              traceId: parent.traceId,
              spanId: parent.spanId,
              traceFlags: parent.traceFlags,
            },
          }
        : {}),
      startTime: [...span.startTime],
      endTime: [...span.endTime],
      duration: [...span.duration],
      ended: span.ended,
      attributes,
      events: [],
      links: [],
      resource: SAFE_RESOURCE,
      instrumentationScope: { name: "openclaw" },
      status: { code: span.status.code },
      droppedAttributesCount: span.droppedAttributesCount,
      droppedEventsCount: span.droppedEventsCount,
      droppedLinksCount: span.droppedLinksCount,
    };
    if (this.queue.length >= COST_SAMPLING_POLICY.maxQueue) {
      const expendable = this.queue.findIndex((entry) => !entry.important);
      if (expendable < 0 && !important) {
        this.counters.queueDropped++;
        return;
      }
      const [dropped] = this.queue.splice(expendable < 0 ? 0 : expendable, 1);
      this.counters.queueDropped++;
      if (dropped.important) this.counters.criticalDropped++;
    }
    this.queue.push({ span: safe, receivedAt: now, important });
  }
  private async exportBatch(spans: ReadableSpan[]) {
    await new Promise<void>((resolve) => {
      let completed = false;
      const finish = (ok: boolean) => {
        if (completed) return;
        completed = true;
        clearTimeout(timer);
        if (ok) this.counters.exported += spans.length;
        else {
          this.counters.exportFailed += spans.length;
          this.counters.criticalDropped += spans.filter(
            (span) => span.attributes[PREFIX + "sample_reason"] === "critical",
          ).length;
        }
        resolve();
      };
      const timer = setTimeout(() => finish(false), COST_SAMPLING_POLICY.exportTimeoutMs);
      timer.unref?.();
      try {
        this.exporter.export(spans, (result) => finish(result.code === 0));
      } catch {
        finish(false);
      }
    });
  }
  forceFlush(): Promise<void> {
    if (this.flight) return this.flight;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    const drain = async () => {
      this.expire(this.now());
      let remaining = this.queue.length;
      while (remaining > 0 && this.queue.length) {
        const batch = this.queue
          .splice(0, Math.min(remaining, COST_SAMPLING_POLICY.batchSize))
          .map((entry) => entry.span);
        remaining -= batch.length;
        for (const span of batch)
          Object.assign(span.attributes, {
            [PREFIX + "population_requests"]: this.counters.requests,
            [PREFIX + "population_terminals"]: this.counters.terminals,
            [PREFIX + "population_linked"]: this.counters.linked,
            [PREFIX + "population_spans"]: this.counters.spans,
            [PREFIX + "population_unknown_cost"]: this.counters.unknownCost,
            [PREFIX + "sampled_out"]: this.counters.sampledOut,
            [PREFIX + "retention_dropped"]:
              this.counters.queueDropped + this.counters.expired + this.counters.exportFailed,
          });
        await this.exportBatch(batch);
        this.expire(this.now());
      }
      this.report();
    };
    this.flight = drain().finally(() => {
      this.flight = undefined;
      if (this.queue.length || this.requests.size) this.schedule();
    });
    return this.flight;
  }
  async shutdown(): Promise<void> {
    this.finalizeOpenRequests();
    this.stopped = true;
    await this.forceFlush();
    if (this.queue.length) await this.forceFlush();
    for (const [key, request] of this.requests) this.retire(key, request);
    this.report();
    this.requests.clear();
    await this.exporter.shutdown();
  }
}
