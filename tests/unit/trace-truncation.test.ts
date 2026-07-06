import { describe, expect, it } from "vitest";
import {
  ObservabilityTraceRecorder,
  type StartSpanInput,
} from "../../openclaw_runtime/src/observability/trace-recorder.js";
import type { ObservabilityAreaPrefix } from "../../openclaw_runtime/src/observability/namespace-governance.js";

/**
 * Stage 3, criterion 3.13: Trace aggregation at >50 spans.
 *
 * When the span count exceeds the truncation threshold, low-priority spans
 * (by `spanDropPriority`: a4 dropped first, core dropped last) are dropped
 * and a `claw.core.trace.truncated` event is emitted.
 *
 * The acceptance criterion specifies a 60-span trace producing aggregation
 * at the >50 threshold. The production default threshold is 200
 * (`TRACE_SPAN_TRUNCATION_THRESHOLD`); for this test we inject a lower
 * threshold (50) to verify the truncation logic with a 60-span trace.
 */
describe("Stage 3 / 3.13: trace truncation at >threshold spans", () => {
  function makeSpan(area: ObservabilityAreaPrefix, name: string): StartSpanInput {
    return { name, kind: "custom", area };
  }

  it("60-span trace with threshold=50 → aggregated, claw.core.trace.truncated emitted", () => {
    const recorder = new ObservabilityTraceRecorder(
      { name: "truncation-trace" },
      {
        callerArea: "core",
        truncationThreshold: 50,
        idFactory: (prefix) => `${prefix}_${Math.random().toString(36).slice(2, 8)}`,
      },
    );

    // 60 spans: 10 each of a1, a2, a3, a4, a5, a6.
    const areas: ObservabilityAreaPrefix[] = ["a1", "a2", "a3", "a4", "a5", "a6"];
    for (let i = 0; i < 60; i++) {
      const area = areas[i % areas.length];
      recorder.startSpan(makeSpan(area, `span-${area}-${i}`));
    }

    const trace = recorder.snapshot();
    // Span count must be reduced to the threshold (50).
    expect(trace.spans.length).toBe(50);

    // The truncation event must be present.
    const truncated = trace.events.filter((e) => e.type === "claw.core.trace.truncated");
    expect(truncated).toHaveLength(1);
    const event = truncated[0];
    expect(event.attributes?.originalSpanCount).toBe(60);
    expect(event.attributes?.retainedSpanCount).toBe(50);
    expect(event.attributes?.droppedSpanCount).toBe(10);
    expect(event.attributes?.threshold).toBe(50);
  });

  it("drops lowest-priority spans first (a4 before a6 before core)", () => {
    const recorder = new ObservabilityTraceRecorder(
      { name: "priority-trace" },
      {
        callerArea: "core",
        truncationThreshold: 3, // keep only 3 spans
        idFactory: (prefix) => `${prefix}_${Math.random().toString(36).slice(2, 8)}`,
      },
    );

    // Add 6 spans, one per area. Threshold=3 means 3 are dropped.
    // Drop order (highest priority value first): a4(6), a3(5), a5(4), a2(3), a1(2), a6(1), core(0).
    // So a4, a3, a5 should be dropped; a2, a1, a6 retained.
    recorder.startSpan(makeSpan("a4", "a4-span"));
    recorder.startSpan(makeSpan("a3", "a3-span"));
    recorder.startSpan(makeSpan("a5", "a5-span"));
    recorder.startSpan(makeSpan("a2", "a2-span"));
    recorder.startSpan(makeSpan("a1", "a1-span"));
    recorder.startSpan(makeSpan("a6", "a6-span"));

    const trace = recorder.snapshot();
    expect(trace.spans.length).toBe(3);

    const retainedNames = trace.spans.map((s) => s.name).sort();
    expect(retainedNames).toEqual(["a1-span", "a2-span", "a6-span"]);

    const truncated = trace.events.filter((e) => e.type === "claw.core.trace.truncated");
    expect(truncated).toHaveLength(1);
    expect(truncated[0].attributes?.droppedSpanCount).toBe(3);
  });

  it("does not truncate when span count equals threshold", () => {
    const recorder = new ObservabilityTraceRecorder(
      { name: "boundary-trace" },
      { truncationThreshold: 5, idFactory: (prefix) => `${prefix}_1` },
    );

    for (let i = 0; i < 5; i++) {
      recorder.startSpan(makeSpan("a1", `span-${i}`));
    }

    const trace = recorder.snapshot();
    expect(trace.spans.length).toBe(5);
    const truncated = trace.events.filter((e) => e.type === "claw.core.trace.truncated");
    expect(truncated).toHaveLength(0);
  });

  it("does not truncate when span count is below threshold", () => {
    const recorder = new ObservabilityTraceRecorder(
      { name: "below-trace" },
      { truncationThreshold: 50, idFactory: (prefix) => `${prefix}_1` },
    );

    for (let i = 0; i < 10; i++) {
      recorder.startSpan(makeSpan("a1", `span-${i}`));
    }

    const trace = recorder.snapshot();
    expect(trace.spans.length).toBe(10);
    expect(trace.events.filter((e) => e.type === "claw.core.trace.truncated")).toHaveLength(0);
  });

  it("emits the truncation event at most once per trace", () => {
    const recorder = new ObservabilityTraceRecorder(
      { name: "once-trace" },
      { truncationThreshold: 5, idFactory: (prefix) => `${prefix}_1` },
    );

    // Push 10 spans (2 truncations worth), but only 1 event should be emitted.
    for (let i = 0; i < 10; i++) {
      recorder.startSpan(makeSpan("a4", `a4-span-${i}`));
    }

    const trace = recorder.snapshot();
    expect(trace.spans.length).toBe(5); // still bounded
    const truncated = trace.events.filter((e) => e.type === "claw.core.trace.truncated");
    expect(truncated).toHaveLength(1);
  });

  it("uses default threshold (200) when not specified", () => {
    const recorder = new ObservabilityTraceRecorder(
      { name: "default-threshold-trace" },
      { idFactory: (prefix) => `${prefix}_1` },
    );

    // 150 spans: below default 200 → no truncation.
    for (let i = 0; i < 150; i++) {
      recorder.startSpan(makeSpan("a1", `span-${i}`));
    }
    expect(recorder.snapshot().spans.length).toBe(150);

    // Push to 205: truncation triggers.
    for (let i = 150; i < 205; i++) {
      recorder.startSpan(makeSpan("a1", `span-${i}`));
    }
    const trace = recorder.snapshot();
    expect(trace.spans.length).toBe(200);
    expect(trace.events.filter((e) => e.type === "claw.core.trace.truncated")).toHaveLength(1);
  });

  it("records droppedAreas in the truncation event", () => {
    const recorder = new ObservabilityTraceRecorder(
      { name: "dropped-areas-trace" },
      { truncationThreshold: 2, idFactory: (prefix) => `${prefix}_1` },
    );

    // 4 spans: 1 a4 (dropped), 1 a3 (dropped), 1 a1 (kept), 1 a6 (kept).
    recorder.startSpan(makeSpan("a4", "a4-span"));
    recorder.startSpan(makeSpan("a3", "a3-span"));
    recorder.startSpan(makeSpan("a1", "a1-span"));
    recorder.startSpan(makeSpan("a6", "a6-span"));

    const trace = recorder.snapshot();
    const truncated = trace.events.filter((e) => e.type === "claw.core.trace.truncated");
    expect(truncated).toHaveLength(1);
    const droppedAreas = truncated[0].attributes?.droppedAreas as string[];
    expect(droppedAreas).toContain("a4");
    expect(droppedAreas).toContain("a3");
  });

  it("defaults span area to callerArea when not explicitly set", () => {
    const recorder = new ObservabilityTraceRecorder(
      { name: "caller-area-default-trace" },
      {
        callerArea: "a4",
        truncationThreshold: 2,
        idFactory: (prefix) => `${prefix}_1`,
      },
    );

    // No explicit area on spans → they default to callerArea (a4).
    // a4 has the highest drop priority, so they are dropped first.
    recorder.startSpan({ name: "span-0", kind: "custom" });
    recorder.startSpan({ name: "span-1", kind: "custom" });
    recorder.startSpan({ name: "span-2", kind: "custom" });
    recorder.startSpan({ name: "span-3", kind: "custom" });

    const trace = recorder.snapshot();
    expect(trace.spans.length).toBe(2);
    // All spans are a4 (callerArea default), so the latest 2 are dropped.
    expect(trace.spans.map((s) => s.name).sort()).toEqual(["span-0", "span-1"]);
  });
});
