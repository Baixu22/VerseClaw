import { describe, expect, it } from "vitest";
import {
  ObservabilityTraceRecorder,
} from "../../openclaw_runtime/src/observability/trace-recorder.js";
import type { ObservabilityRuntimeEvent } from "../../openclaw_runtime/src/observability/types.js";

/**
 * Stage 3, criterion 3.10: Trace namespace enforced.
 *
 * When a recorder is constructed with `callerArea: 'a1'`, an event with a
 * wrong-namespace type (`claw.a4.tool.choice`) is rejected — i.e. it is not
 * stored in `trace.events` as its original type, and a
 * `claw.core.trace.namespace_rejected` diagnostic event is emitted instead.
 */
describe("Stage 3 / 3.10: trace namespace enforcement", () => {
  it("rejects an out-of-namespace event (claw.a4.tool.choice on an a1 recorder)", () => {
    const recorder = new ObservabilityTraceRecorder(
      { name: "test-trace" },
      { callerArea: "a1", idFactory: (prefix) => `${prefix}_1` },
    );

    const result = recorder.recordEvent("claw.a4.tool.choice", "Tool Choice");

    // The returned event is the rejection diagnostic, not the original.
    expect(result.type).toBe("claw.core.trace.namespace_rejected");
    expect(result.attributes?.rejectedType).toBe("claw.a4.tool.choice");
    expect(result.attributes?.rejectedName).toBe("Tool Choice");
    expect(result.attributes?.reason).toContain('"claw.a4.tool.choice"');
    expect(result.attributes?.reason).toContain('"a1"');

    const trace = recorder.snapshot();
    // The original event must NOT be present.
    const originalEvents = trace.events.filter((e) => e.type === "claw.a4.tool.choice");
    expect(originalEvents).toHaveLength(0);
    // The rejection diagnostic MUST be present.
    const rejectedEvents = trace.events.filter((e) => e.type === "claw.core.trace.namespace_rejected");
    expect(rejectedEvents).toHaveLength(1);
  });

  it("accepts an in-namespace event (claw.a1.tool.choice on an a1 recorder)", () => {
    const recorder = new ObservabilityTraceRecorder(
      { name: "test-trace" },
      { callerArea: "a1", idFactory: (prefix) => `${prefix}_1` },
    );

    const result = recorder.recordEvent("claw.a1.tool.choice", "Tool Choice");

    expect(result.type).toBe("claw.a1.tool.choice");
    expect(result.name).toBe("Tool Choice");

    const trace = recorder.snapshot();
    const matched = trace.events.filter((e) => e.type === "claw.a1.tool.choice");
    expect(matched).toHaveLength(1);
    // No rejection diagnostic should be emitted.
    const rejected = trace.events.filter((e) => e.type === "claw.core.trace.namespace_rejected");
    expect(rejected).toHaveLength(0);
  });

  it("emits an event.recorded runtime event for the rejection", () => {
    const recorder = new ObservabilityTraceRecorder(
      { name: "test-trace" },
      { callerArea: "core", idFactory: (prefix) => `${prefix}_1` },
    );

    const received: ObservabilityRuntimeEvent[] = [];
    const unsub = recorder.subscribe((e) => {
      received.push(e);
    });

    // `core` recorder: claw.a4.tool.choice is out-of-namespace (only claw.core.* allowed).
    recorder.recordEvent("claw.a4.tool.choice", "Tool Choice");

    unsub();

    const recordedEvents = received.filter((e) => e.type === "event.recorded");
    expect(recordedEvents.length).toBeGreaterThanOrEqual(1);
    const last = recordedEvents[recordedEvents.length - 1];
    if (last.type === "event.recorded") {
      expect(last.event.type).toBe("claw.core.trace.namespace_rejected");
    }
  });

  it("allows claw.core.* events on a core recorder", () => {
    const recorder = new ObservabilityTraceRecorder(
      { name: "test-trace" },
      { callerArea: "core", idFactory: (prefix) => `${prefix}_1` },
    );

    const result = recorder.recordEvent("claw.core.trace.truncated", "Trace Truncated");

    expect(result.type).toBe("claw.core.trace.truncated");
    const rejected = recorder
      .snapshot()
      .events.filter((e) => e.type === "claw.core.trace.namespace_rejected");
    expect(rejected).toHaveLength(0);
  });

  it("skips validation when callerArea is not set (legacy mode)", () => {
    const recorder = new ObservabilityTraceRecorder(
      { name: "test-trace" },
      { idFactory: (prefix) => `${prefix}_1` },
    );

    // No callerArea → no validation; any event type accepted.
    const result = recorder.recordEvent("claw.a4.tool.choice", "Tool Choice");
    expect(result.type).toBe("claw.a4.tool.choice");
    const rejected = recorder
      .snapshot()
      .events.filter((e) => e.type === "claw.core.trace.namespace_rejected");
    expect(rejected).toHaveLength(0);
  });

  it("rejects multiple out-of-namespace events independently", () => {
    const recorder = new ObservabilityTraceRecorder(
      { name: "test-trace" },
      { callerArea: "a1", idFactory: (prefix) => `${prefix}_${Math.random().toString(36).slice(2, 6)}` },
    );

    recorder.recordEvent("claw.a4.tool.choice", "A4 Choice");
    recorder.recordEvent("claw.a2.spawn.subagent", "A2 Spawn");
    recorder.recordEvent("claw.a1.tool.invoke", "A1 Invoke");

    const trace = recorder.snapshot();
    const rejected = trace.events.filter((e) => e.type === "claw.core.trace.namespace_rejected");
    const accepted = trace.events.filter((e) => e.type === "claw.a1.tool.invoke");

    expect(rejected).toHaveLength(2);
    expect(accepted).toHaveLength(1);
  });

  it("preserves spanId in the rejection diagnostic", () => {
    const recorder = new ObservabilityTraceRecorder(
      { name: "test-trace" },
      { callerArea: "a1", idFactory: (prefix) => `${prefix}_1` },
    );

    const result = recorder.recordEvent("claw.a4.tool.choice", "Tool Choice", {
      spanId: "span_xyz",
      attributes: { detail: "extra" },
    });

    expect(result.spanId).toBe("span_xyz");
  });
});
