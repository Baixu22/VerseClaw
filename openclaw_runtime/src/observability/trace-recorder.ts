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

export type ObservabilityTraceRecorderOptions = {
  idFactory?: (prefix: string) => string;
  now?: () => number;
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

  constructor(input: StartTraceInput, options: ObservabilityTraceRecorderOptions = {}) {
    this.idFactory = options.idFactory ?? defaultIdFactory;
    this.now = options.now ?? Date.now;
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
      attributes: { ...input.attributes },
    };
    this.trace.spans.push(span);
    if (input.tokenUsage) {
      this.trace.tokenUsage = addObservabilityTokenUsage(this.trace.tokenUsage, input.tokenUsage);
    }
    this.emit({ type: "span.started", traceId: this.trace.id, span: { ...span } });
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

  recordEvent(type: string, name: string, attrs?: { spanId?: string; attributes?: Record<string, unknown> }): ObservabilityTraceEvent {
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
