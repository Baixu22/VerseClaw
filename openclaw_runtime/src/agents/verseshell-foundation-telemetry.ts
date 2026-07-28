export type VerseShellFoundationTelemetryEvent =
  | {
      type: "process.lifecycle";
      action: "start" | "restart" | "crash";
      processVersion?: string;
      protocolVersion?: string;
      errorCode?: string;
    }
  | {
      type: "runtime.handshake";
      outcome: "ok" | "error" | "incompatible";
      latencyMs: number;
      protocolVersion?: string;
    }
  | {
      type: "operation.completed";
      operation: string;
      latencyMs: number;
      outcome: "ok" | "error" | "denied" | "unavailable";
      effect: "read" | "write" | "exec" | "network" | "none";
      capabilityDecision: "allow" | "deny" | "approval-required" | "not-applicable";
    }
  | {
      type: "artifact.activity";
      action: "write" | "query" | "expiry";
      bytes?: number;
      outcome: "ok" | "miss" | "error" | "expired";
    }
  | {
      type: "result.recovery";
      action: "truncation" | "recovery";
      bytes?: number;
      outcome: "ok" | "error" | "partial";
    }
  | {
      type: "tools.surface";
      visibleCount: number;
      deferredCount: number;
      schemaBytes: number;
    }
  | {
      type: "compatibility.use";
      surface: "legacy-eval" | "mcp" | "native-fallback";
      outcome: "ok" | "error" | "denied";
    }
  | {
      type: "shadow.mismatch";
      operation: string;
      mismatchCount: number;
      evidenceBytes: number;
    };

export type RecordedVerseShellFoundationTelemetryEvent = VerseShellFoundationTelemetryEvent & {
  sequence: number;
  timestampMs: number;
};

export type VerseShellFoundationTelemetrySink = (
  event: RecordedVerseShellFoundationTelemetryEvent,
) => void;

export type VerseShellFoundationTelemetrySnapshot = {
  schemaVersion: 1;
  recordedEvents: number;
  droppedEvents: number;
  events: RecordedVerseShellFoundationTelemetryEvent[];
  metrics: Record<string, number>;
};

export type VerseShellFoundationTelemetryRecorderOptions = {
  maxEvents?: number;
  now?: () => number;
  sink?: VerseShellFoundationTelemetrySink;
};

function finiteNonNegative(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

function boundedString(value: string | undefined, max = 96): string | undefined {
  if (value === undefined) return undefined;
  return value.replace(/[\r\n\t]/g, " ").slice(0, max);
}

function sanitizeEvent(
  event: VerseShellFoundationTelemetryEvent,
): VerseShellFoundationTelemetryEvent {
  switch (event.type) {
    case "process.lifecycle":
      return {
        ...event,
        processVersion: boundedString(event.processVersion),
        protocolVersion: boundedString(event.protocolVersion),
        errorCode: boundedString(event.errorCode),
      };
    case "runtime.handshake":
      return {
        ...event,
        latencyMs: finiteNonNegative(event.latencyMs),
        protocolVersion: boundedString(event.protocolVersion),
      };
    case "operation.completed":
      return {
        ...event,
        operation: boundedString(event.operation) ?? "unknown",
        latencyMs: finiteNonNegative(event.latencyMs),
      };
    case "artifact.activity":
    case "result.recovery":
      return { ...event, bytes: finiteNonNegative(event.bytes) };
    case "tools.surface":
      return {
        ...event,
        visibleCount: finiteNonNegative(event.visibleCount),
        deferredCount: finiteNonNegative(event.deferredCount),
        schemaBytes: finiteNonNegative(event.schemaBytes),
      };
    case "shadow.mismatch":
      return {
        ...event,
        operation: boundedString(event.operation) ?? "unknown",
        mismatchCount: finiteNonNegative(event.mismatchCount),
        evidenceBytes: finiteNonNegative(event.evidenceBytes),
      };
    case "compatibility.use":
      return event;
  }
}

function add(metrics: Map<string, number>, name: string, amount = 1): void {
  metrics.set(name, (metrics.get(name) ?? 0) + amount);
}

/** Bounded process-local hooks. No arguments, content, command output, or secrets are accepted. */
export class VerseShellFoundationTelemetryRecorder {
  private readonly maxEvents: number;
  private readonly now: () => number;
  private readonly sink?: VerseShellFoundationTelemetrySink;
  private readonly events: RecordedVerseShellFoundationTelemetryEvent[] = [];
  private readonly metrics = new Map<string, number>();
  private sequence = 0;
  private droppedEvents = 0;

  constructor(options: VerseShellFoundationTelemetryRecorderOptions = {}) {
    this.maxEvents = Math.max(1, Math.min(options.maxEvents ?? 256, 4_096));
    this.now = options.now ?? Date.now;
    this.sink = options.sink;
  }

  record(event: VerseShellFoundationTelemetryEvent): RecordedVerseShellFoundationTelemetryEvent {
    const recorded = {
      ...sanitizeEvent(event),
      sequence: this.sequence++,
      timestampMs: this.now(),
    } as RecordedVerseShellFoundationTelemetryEvent;

    if (this.events.length >= this.maxEvents) {
      this.events.shift();
      this.droppedEvents++;
      add(this.metrics, "events.dropped");
    }
    this.events.push(recorded);
    this.accumulate(recorded);
    this.sink?.({ ...recorded });
    return { ...recorded };
  }

  snapshot(): VerseShellFoundationTelemetrySnapshot {
    return {
      schemaVersion: 1,
      recordedEvents: this.events.length,
      droppedEvents: this.droppedEvents,
      events: this.events.map((event) => ({ ...event })),
      metrics: Object.fromEntries(
        [...this.metrics.entries()].sort(([a], [b]) => a.localeCompare(b)),
      ),
    };
  }

  private accumulate(event: RecordedVerseShellFoundationTelemetryEvent): void {
    add(this.metrics, `events.${event.type}`);
    switch (event.type) {
      case "process.lifecycle":
        add(this.metrics, `process.${event.action}`);
        return;
      case "runtime.handshake":
        add(this.metrics, `handshake.${event.outcome}`);
        add(this.metrics, "handshake.latency_ms", event.latencyMs);
        return;
      case "operation.completed":
        add(this.metrics, `operation.outcome.${event.outcome}`);
        add(this.metrics, `operation.effect.${event.effect}`);
        add(this.metrics, `operation.capability.${event.capabilityDecision}`);
        add(this.metrics, "operation.latency_ms", event.latencyMs);
        return;
      case "artifact.activity":
        add(this.metrics, `artifact.${event.action}`);
        add(this.metrics, `artifact.${event.action}.bytes`, event.bytes ?? 0);
        return;
      case "result.recovery":
        add(this.metrics, `result.${event.action}`);
        add(this.metrics, `result.${event.action}.bytes`, event.bytes ?? 0);
        return;
      case "tools.surface":
        add(this.metrics, "tools.visible", event.visibleCount);
        add(this.metrics, "tools.deferred", event.deferredCount);
        add(this.metrics, "tools.schema_bytes", event.schemaBytes);
        return;
      case "compatibility.use":
        add(this.metrics, `compatibility.${event.surface}.${event.outcome}`);
        return;
      case "shadow.mismatch":
        add(this.metrics, "shadow.mismatch");
        add(this.metrics, "shadow.mismatch.fields", event.mismatchCount);
        return;
    }
  }
}
