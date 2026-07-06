import type {
  ObservabilityRuntimeEvent,
  ObservabilitySpan,
  ObservabilitySpanKind,
  ObservabilitySpanStatus,
  ObservabilityTokenUsage,
  ObservabilityTrace,
  ObservabilityTraceEvent,
  ObservabilityTraceStatus,
} from "./types.js";
import { EMPTY_OBSERVABILITY_TOKEN_USAGE, addObservabilityTokenUsage } from "./metrics.js";
import {
  TRACE_SPAN_TRUNCATION_THRESHOLD,
  type ObservabilityAreaPrefix,
  spanDropPriority,
  validateEventNamespace,
} from "./namespace-governance.js";

export type ObservabilityTraceRecorderOptions = {
  idFactory?: (prefix: string) => string;
  now?: () => number;
  /**
   * Stage 3 (criterion 3.10): caller area for namespace governance.
   * When set, event names passed to `recordEvent` must be fully-qualified
   * (`claw.{area}.{...}`) and match this area. Out-of-namespace events are
   * rejected and a `claw.core.trace.namespace_rejected` diagnostic is emitted.
   */
  callerArea?: ObservabilityAreaPrefix;
  /**
   * Stage 3 (criterion 3.13): truncation threshold for span aggregation.
   * When span count exceeds this, low-priority spans (by `spanDropPriority`)
   * are dropped and a `claw.core.trace.truncated` event is emitted.
   * Defaults to `TRACE_SPAN_TRUNCATION_THRESHOLD` (200).
   */
  truncationThreshold?: number;
};

export type StartTraceInput = {
  name: string;
  runId?: string;
  sessionKey?: string;
  task?: string;
  mode?: string;
  tags?: string[];
  metrics?: Record<string, number>;
};

export type StartSpanInput = {
  name: string;
  kind: ObservabilitySpanKind;
  parentSpanId?: string;
  roleName?: string;
  modelRef?: string;
  input?: string;
  tokenUsage?: ObservabilityTokenUsage;
  metrics?: Record<string, number>;
  attributes?: Record<string, unknown>;
  /**
   * Stage 3: area this span belongs to. Used by truncation to decide
   * which spans to drop first. Defaults to the recorder's `callerArea`,
   * or `core` if neither is set.
   */
  area?: ObservabilityAreaPrefix;
};

export type EndSpanInput = {
  status?: ObservabilitySpanStatus;
  output?: string;
  tokenUsage?: ObservabilityTokenUsage;
  metrics?: Record<string, number>;
  attributes?: Record<string, unknown>;
  error?: string;
};

export type ObservabilityTraceListener = (event: ObservabilityRuntimeEvent) => void;

const cloneTrace = (trace: ObservabilityTrace): ObservabilityTrace => ({
  ...trace,
  spans: trace.spans.map((span) => ({ ...span, metrics: { ...span.metrics }, attributes: { ...span.attributes } })),
  events: trace.events.map((event) => ({ ...event, attributes: { ...event.attributes } })),
  tokenUsage: { ...trace.tokenUsage },
  metrics: { ...trace.metrics },
  tags: [...trace.tags],
});

function defaultIdFactory(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export class ObservabilityTraceRecorder {
  private trace: ObservabilityTrace;
  private readonly idFactory: (prefix: string) => string;
  private readonly now: () => number;
  private readonly listeners = new Set<ObservabilityTraceListener>();
  private readonly callerArea?: ObservabilityAreaPrefix;
  private readonly truncationThreshold: number;
  /** Cumulative count of spans ever added (before truncation). */
  private totalSpansAdded = 0;

  constructor(input: StartTraceInput, options: ObservabilityTraceRecorderOptions = {}) {
    this.idFactory = options.idFactory ?? defaultIdFactory;
    this.now = options.now ?? Date.now;
    this.callerArea = options.callerArea;
    this.truncationThreshold = options.truncationThreshold ?? TRACE_SPAN_TRUNCATION_THRESHOLD;
    this.trace = {
      id: this.idFactory("trace"),
      name: input.name,
      runId: input.runId,
      sessionKey: input.sessionKey,
      task: input.task,
      mode: input.mode,
      status: "running",
      startedAt: this.now(),
      spans: [],
      events: [],
      tokenUsage: { ...EMPTY_OBSERVABILITY_TOKEN_USAGE },
      metrics: { ...input.metrics },
      tags: [...(input.tags ?? [])],
    };
  }

  subscribe(listener: ObservabilityTraceListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  start(): ObservabilityTrace {
    this.emit({ type: "trace.started", trace: this.snapshot() });
    return this.snapshot();
  }

  snapshot(): ObservabilityTrace {
    return cloneTrace(this.trace);
  }

  startSpan(input: StartSpanInput): ObservabilitySpan {
    const span: ObservabilitySpan = {
      id: this.idFactory("span"),
      traceId: this.trace.id,
      parentSpanId: input.parentSpanId,
      name: input.name,
      kind: input.kind,
      roleName: input.roleName,
      modelRef: input.modelRef,
      status: "running",
      startedAt: this.now(),
      input: input.input,
      tokenUsage: input.tokenUsage,
      metrics: { ...input.metrics },
      attributes: { ...input.attributes, ...(input.area ? { __area: input.area } : {}) },
    };
    this.trace.spans.push(span);
    this.totalSpansAdded++;
    if (input.tokenUsage) {
      this.trace.tokenUsage = addObservabilityTokenUsage(this.trace.tokenUsage, input.tokenUsage);
    }
    this.emit({ type: "span.started", traceId: this.trace.id, span: { ...span } });
    // Stage 3 (criterion 3.13): truncate if over threshold.
    this.maybeTruncate();
    return { ...span };
  }

  endSpan(spanId: string, input: EndSpanInput = {}): ObservabilitySpan {
    const span = this.trace.spans.find((candidate) => candidate.id === spanId);
    if (!span) {
      throw new Error(`Unknown observability span: ${spanId}`);
    }
    const endedAt = this.now();
    span.status = input.status ?? (input.error ? "error" : "completed");
    span.endedAt = endedAt;
    span.durationMs = Math.max(0, endedAt - span.startedAt);
    span.output = input.output ?? span.output;
    span.error = input.error ?? span.error;
    span.metrics = { ...span.metrics, ...input.metrics };
    span.attributes = { ...span.attributes, ...input.attributes };
    if (input.tokenUsage) {
      span.tokenUsage = span.tokenUsage
        ? addObservabilityTokenUsage(span.tokenUsage, input.tokenUsage)
        : input.tokenUsage;
      this.trace.tokenUsage = addObservabilityTokenUsage(this.trace.tokenUsage, input.tokenUsage);
    }
    this.emit({ type: "span.completed", traceId: this.trace.id, span: { ...span } });
    this.emit({ type: "trace.updated", trace: this.snapshot() });
    return { ...span };
  }

  /**
   * Record a trace event.
   *
   * Stage 3 (criterion 3.10): when `callerArea` is set on the recorder, the
   * `type` parameter MUST be a fully-qualified event name
   * (`claw.{area}.{category}.{event}`). Out-of-namespace events are rejected:
   * they are not added to `trace.events`, and a `claw.core.trace.namespace_rejected`
   * diagnostic event is emitted in their place.
   *
   * @returns the recorded event, or the rejection diagnostic if rejected.
   */
  recordEvent(
    type: string,
    name: string,
    attrs?: { spanId?: string; attributes?: Record<string, unknown> },
  ): ObservabilityTraceEvent {
    // Stage 3 (criterion 3.10): namespace enforcement.
    if (this.callerArea) {
      const error = validateEventNamespace(type, this.callerArea);
      if (error) {
        const rejected: ObservabilityTraceEvent = {
          id: this.idFactory("event"),
          traceId: this.trace.id,
          spanId: attrs?.spanId,
          type: "claw.core.trace.namespace_rejected",
          name: "Namespace Rejected",
          timestamp: this.now(),
          attributes: {
            reason: error,
            rejectedType: type,
            rejectedName: name,
          },
        };
        this.trace.events.push(rejected);
        this.emit({ type: "event.recorded", traceId: this.trace.id, event: { ...rejected } });
        return { ...rejected };
      }
    }
    const event: ObservabilityTraceEvent = {
      id: this.idFactory("event"),
      traceId: this.trace.id,
      spanId: attrs?.spanId,
      type,
      name,
      timestamp: this.now(),
      attributes: { ...attrs?.attributes },
    };
    this.trace.events.push(event);
    this.emit({ type: "event.recorded", traceId: this.trace.id, event: { ...event } });
    return { ...event };
  }

  complete(status: Exclude<ObservabilityTraceStatus, "running"> = "completed", error?: string): ObservabilityTrace {
    const endedAt = this.now();
    this.trace.status = status;
    this.trace.endedAt = endedAt;
    this.trace.durationMs = Math.max(0, endedAt - this.trace.startedAt);
    this.trace.error = error;
    for (const span of this.trace.spans) {
      if (span.status === "running") {
        span.status = status;
        span.endedAt = endedAt;
        span.durationMs = Math.max(0, endedAt - span.startedAt);
        span.error = error ?? span.error;
      }
    }
    this.emit({ type: "trace.completed", trace: this.snapshot() });
    return this.snapshot();
  }

  async withSpan<T>(input: StartSpanInput, fn: (span: ObservabilitySpan) => Promise<T> | T): Promise<T> {
    const span = this.startSpan(input);
    try {
      const result = await fn(span);
      this.endSpan(span.id, { status: "completed" });
      return result;
    } catch (error) {
      this.endSpan(span.id, { status: "error", error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  /**
   * Stage 3 (criterion 3.13): when the span count exceeds the truncation
   * threshold, drop the lowest-priority spans (highest `spanDropPriority`
   * value first: a4 > a3 > a5 > a2 > a1 > a6 > core) and emit a single
   * `claw.core.trace.truncated` event recording what was dropped.
   *
   * The truncation event is emitted once on first truncation, then its
   * cumulative attributes are updated on subsequent truncations (so the
   * final event reflects the total spans added/dropped across the trace).
   */
  private maybeTruncate(): void {
    if (this.trace.spans.length <= this.truncationThreshold) return;
    const dropped = this.dropExcessSpans();
    if (dropped.length === 0) return;

    // Find the existing truncation event (at most one per trace).
    let truncationEvent = this.trace.events.find(
      (e) => e.type === "claw.core.trace.truncated",
    );
    if (!truncationEvent) {
      truncationEvent = {
        id: this.idFactory("event"),
        traceId: this.trace.id,
        type: "claw.core.trace.truncated",
        name: "Trace Truncated",
        timestamp: this.now(),
        attributes: {
          originalSpanCount: this.totalSpansAdded,
          retainedSpanCount: this.trace.spans.length,
          droppedSpanCount: 0,
          droppedAreas: [] as string[],
          threshold: this.truncationThreshold,
        },
      };
      this.trace.events.push(truncationEvent);
      this.emit({ type: "event.recorded", traceId: this.trace.id, event: { ...truncationEvent } });
    }
    // Update cumulative stats (covers both first and subsequent truncations).
    const attrs = truncationEvent.attributes!;
    attrs.originalSpanCount = this.totalSpansAdded;
    attrs.retainedSpanCount = this.trace.spans.length;
    attrs.droppedSpanCount = (attrs.droppedSpanCount as number) + dropped.length;
    (attrs.droppedAreas as string[]).push(...dropped.map((d) => d.area));
  }

  private dropExcessSpans(): Array<{ id: string; area: string }> {
    const excess = this.trace.spans.length - this.truncationThreshold;
    if (excess <= 0) return [];
    // Sort spans by drop priority descending (a4=6 first to drop, core=0 last).
    const indexed = this.trace.spans.map((span, index) => ({
      index,
      area: this.extractArea(span),
      priority: spanDropPriority(this.extractArea(span)),
    }));
    // Stable sort: highest priority value dropped first; ties broken by
    // recency (later spans dropped first to preserve early history).
    indexed.sort((a, b) => {
      if (a.priority !== b.priority) return b.priority - a.priority;
      return b.index - a.index;
    });
    const droppedIndices = new Set(indexed.slice(0, excess).map((d) => d.index));
    const dropped: Array<{ id: string; area: string }> = [];
    const kept: ObservabilitySpan[] = [];
    for (let i = 0; i < this.trace.spans.length; i++) {
      if (droppedIndices.has(i)) {
        const span = this.trace.spans[i];
        dropped.push({ id: span.id, area: this.extractArea(span) });
      } else {
        kept.push(this.trace.spans[i]);
      }
    }
    this.trace.spans = kept;
    return dropped;
  }

  private extractArea(span: ObservabilitySpan): ObservabilityAreaPrefix {
    const fromAttr = span.attributes?.__area;
    if (
      typeof fromAttr === "string" &&
      (fromAttr === "a1" || fromAttr === "a2" || fromAttr === "a3" ||
        fromAttr === "a4" || fromAttr === "a5" || fromAttr === "a6" || fromAttr === "core")
    ) {
      return fromAttr;
    }
    return this.callerArea ?? "core";
  }

  private emit(event: ObservabilityRuntimeEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

export function createObservabilityTraceRecorder(
  input: StartTraceInput,
  options?: ObservabilityTraceRecorderOptions,
): ObservabilityTraceRecorder {
  return new ObservabilityTraceRecorder(input, options);
}
