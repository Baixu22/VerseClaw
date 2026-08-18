// ---------------------------------------------------------------------------
// Round 2 / Stage 3: Observability Event Namespace Governance
//
// Each area owns a namespace (`claw.{area}.`). Events outside an area's
// namespace are rejected at recording time. This prevents cross-area event
// pollution and makes traces human-readable.
//
// See: docs/runtime-design/development-manual.md §1.1, Stage 3 (criterion 3.10/3.13)
// Mirrors: shared/types/observability.ts (renderer-side copy)
// ---------------------------------------------------------------------------

/** The area prefix of the observability namespace. */
export type ObservabilityAreaPrefix = "a1" | "a2" | "a3" | "a4" | "a5" | "a6" | "core";

/** A fully-qualified event name in the `claw.{area}.{category}.{event}` format. */
export type ObservabilityEventName = `claw.${ObservabilityAreaPrefix}.${string}`;

/** Retention/decay policy for an event category. */
export type ObservabilityRetentionPolicy = {
  /** How long to retain spans of this category, in milliseconds. */
  retentionMs: number;
  /** Sampling rate when throughput exceeds `thresholdPerMinute`. */
  highThroughputSamplingRate: number;
  /** Spans per minute above which sampling kicks in. */
  thresholdPerMinute: number;
};

/** Default retention policies by event category. */
export const OBSERVABILITY_RETENTION_POLICIES = {
  decision: { retentionMs: 7 * 24 * 60 * 60 * 1000, highThroughputSamplingRate: 1.0, thresholdPerMinute: Infinity },
  diagnostic: { retentionMs: 3 * 24 * 60 * 60 * 1000, highThroughputSamplingRate: 0.1, thresholdPerMinute: 100 },
  error: { retentionMs: 30 * 24 * 60 * 60 * 1000, highThroughputSamplingRate: 1.0, thresholdPerMinute: Infinity },
  shadow: { retentionMs: 7 * 24 * 60 * 60 * 1000, highThroughputSamplingRate: 0.01, thresholdPerMinute: 50 },
} as const satisfies Record<string, ObservabilityRetentionPolicy>;

/** Trace truncation threshold. Above this, low-priority spans are dropped. */
export const TRACE_SPAN_TRUNCATION_THRESHOLD = 200;

/**
 * Validate that an event name is within the caller's area namespace.
 * Returns `null` if valid, or an error message.
 *
 * @param eventName fully-qualified event name like `claw.a1.tool.choice`
 * @param callerArea the area the recorder belongs to
 */
export function validateEventNamespace(
  eventName: string,
  callerArea: ObservabilityAreaPrefix,
): string | null {
  const prefix = `claw.${callerArea}.`;
  if (eventName.startsWith(prefix)) return null;
  // `core.` namespace is reserved for Mission Control and infrastructure diagnostics
  // (e.g. `claw.core.trace.truncated`, `claw.core.trace.namespace_rejected`).
  if (callerArea === "core" && eventName.startsWith("claw.core.")) return null;
  return `Event name "${eventName}" does not match caller area "${callerArea}" (expected prefix "claw.${callerArea}.")`;
}

/**
 * Determine the drop priority for a span during trace truncation.
 * Lower number = higher importance = kept longer.
 * Priority order (highest first): core > a6 > a1 > a2 > a5 > a3 > a4.
 * A4 spans are dropped first; A6 spans are dropped last (after core).
 */
export function spanDropPriority(area: ObservabilityAreaPrefix): number {
  const priority: Record<ObservabilityAreaPrefix, number> = {
    core: 0,
    a6: 1,
    a1: 2,
    a2: 3,
    a5: 4,
    a3: 5,
    a4: 6,
  };
  return priority[area];
}
