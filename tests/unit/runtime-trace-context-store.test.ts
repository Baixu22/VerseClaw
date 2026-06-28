import { describe, expect, it } from "vitest";
import {
  buildRuntimeTraceSpanFixture,
  createRuntimeTraceSpanStore,
  type RuntimeTraceSpan,
} from "../../openclaw_runtime/src/runtime-core";

describe("runtime trace context store", () => {
  it("sanitizes spans on append, rejects malformed input, clones stored data, and enforces bounds", () => {
    const store = createRuntimeTraceSpanStore({
      maxSpans: 3,
      maxSpansPerTrace: 2,
    });
    const raw = span({
      traceId: "trace_a",
      spanId: "a1",
      startedAt: 1,
      endedAt: 2,
      statusMessage: "prompt leaked sk-live-secret-token",
      attributes: {
        "task.id": "task_a",
        prompt: "raw prompt",
        safe: "kept",
      },
      events: [
        {
          name: "tool.output.received",
          timestamp: 1.5,
          attributes: {
            stdout: "raw command output",
            code: "E_TOOL",
          },
          evidenceRefs: [
            {
              type: "tool",
              ref: "tool_1",
              metadata: { apiKey: "sk-live", safe: "metadata" },
            },
          ],
        },
      ],
      evidenceRefs: [
        {
          type: "trace",
          ref: "trace_a",
          summary: "x".repeat(600),
          metadata: { secret: "hidden", safe: "trace" },
        },
      ],
    });

    expect(store.append({})).toMatchObject({
      accepted: false,
      rejectedReason: "invalid_span",
      readonly: true,
    });
    expect(store.append(raw)).toMatchObject({
      accepted: true,
      totalSpanCount: 1,
      traceSpanCount: 1,
      evictedSpanCount: 0,
      readonly: true,
    });

    raw.attributes.safe = "mutated";
    const stored = store.findSpan("trace_a", "a1");
    expect(stored).toMatchObject({
      statusMessage: "[redacted]",
      attributes: {
        "task.id": "task_a",
        prompt: "[redacted]",
        safe: "kept",
      },
    });
    expect(JSON.stringify(stored)).not.toContain("raw prompt");
    expect(JSON.stringify(stored)).not.toContain("raw command output");
    expect(JSON.stringify(stored)).not.toContain("sk-live");
    expect(JSON.stringify(stored)).toContain("[redacted]");

    const exposed = store.findSpan("trace_a", "a1");
    if (exposed) {
      exposed.attributes.safe = "changed outside store";
    }
    expect(store.findSpan("trace_a", "a1")?.attributes.safe).toBe("kept");

    store.append(span({ traceId: "trace_a", spanId: "a2", startedAt: 2 }));
    store.append(span({ traceId: "trace_a", spanId: "a3", startedAt: 3 }));
    expect(store.findTrace("trace_a").map((item) => item.spanId)).toEqual([
      "a2",
      "a3",
    ]);
    store.append(span({ traceId: "trace_b", spanId: "b1", startedAt: 4 }));
    store.append(span({ traceId: "trace_b", spanId: "b2", startedAt: 5 }));
    expect(store.snapshot().map((item) => item.spanId)).toEqual([
      "a3",
      "b1",
      "b2",
    ]);
    expect(store.stats()).toMatchObject({
      totalSpanCount: 3,
      traceCount: 2,
      maxSpans: 3,
      maxSpansPerTrace: 2,
      evictedSpanCount: 2,
      readonly: true,
    });
  });

  it("queries by trace, span, parent, task, tool, source, status, and overlapping time range", () => {
    const store = createRuntimeTraceSpanStore();
    const root = span({
      traceId: "trace_query",
      spanId: "span_root",
      name: "task.run",
      kind: "task",
      startedAt: 1,
      endedAt: 50,
      attributes: { "task.id": "task_query" },
      sourceRefs: [{ file: "src/root.ts", symbol: "rootTask" }],
    });
    const tool = span({
      traceId: "trace_query",
      spanId: "span_tool",
      parentSpanId: "span_root",
      name: "tool.call",
      kind: "tool",
      startedAt: 10,
      endedAt: 20,
      attributes: { "task.id": "task_query", "tool.name": "read_file" },
      sourceRefs: [{ file: "src/example.ts", symbol: "runExample" }],
    });
    const test = span({
      traceId: "trace_query",
      spanId: "span_test",
      parentSpanId: "span_root",
      name: "test.run",
      kind: "test",
      status: "error",
      startedAt: 30,
      endedAt: 40,
      attributes: { "task.id": "task_query" },
      sourceRefs: [{ file: "tests/example.test.ts", symbol: "example test" }],
    });
    store.appendMany([root, tool, test]);

    expect(store.findTrace("trace_query").map((item) => item.spanId)).toEqual([
      "span_root",
      "span_tool",
      "span_test",
    ]);
    expect(store.findSpan("trace_query", "span_tool")).toEqual(tool);
    expect(store.findChildren("trace_query", "span_root").map((item) => item.spanId))
      .toEqual(["span_tool", "span_test"]);
    expect(store.query({
      traceId: "trace_query",
      taskId: "task_query",
      toolName: "read_file",
      file: "src/example.ts",
      symbol: "runExample",
      status: "ok",
      timeRange: { start: 15, end: 15 },
    })).toEqual([tool]);
    expect(store.query({
      traceId: "trace_query",
      status: "error",
      timeRange: { start: 35, end: 35 },
    })).toEqual([test]);
  });

  it("queries resume and evidence links without treating links as parentage", () => {
    const store = createRuntimeTraceSpanStore();
    const root = span({
      traceId: "trace_link",
      spanId: "span_root",
      kind: "task",
      startedAt: 1,
      endedAt: 10,
    });
    const child = span({
      traceId: "trace_link",
      spanId: "span_child",
      parentSpanId: "span_root",
      kind: "tool",
      startedAt: 2,
      endedAt: 3,
    });
    const test = span({
      traceId: "trace_link",
      spanId: "span_test",
      parentSpanId: "span_root",
      kind: "test",
      startedAt: 4,
      endedAt: 5,
    });
    const resume = span({
      traceId: "trace_resume",
      spanId: "span_resume",
      kind: "resume",
      startedAt: 20,
      endedAt: 21,
      links: [
        {
          traceId: "trace_link",
          spanId: "span_root",
          relationship: "resume",
        },
      ],
    });
    const verifier = span({
      traceId: "trace_link",
      spanId: "span_verifier",
      kind: "verifier",
      startedAt: 6,
      endedAt: 7,
      links: [
        {
          traceId: "trace_link",
          spanId: "span_test",
          relationship: "evidence",
        },
      ],
    });
    store.appendMany([root, child, test, resume, verifier]);

    expect(store.findChildren("trace_link", "span_root").map((item) => item.spanId))
      .toEqual(["span_child", "span_test"]);
    expect(store.findLinkedSpans({
      traceId: "trace_link",
      spanId: "span_root",
      relationship: "resume",
    }).map((item) => item.spanId)).toEqual(["span_resume"]);
    expect(store.findLinkedSpans({
      traceId: "trace_link",
      spanId: "span_test",
      relationship: "evidence",
    }).map((item) => item.spanId)).toEqual(["span_verifier"]);
    expect(store.findLinkedSpans({
      traceId: "trace_link",
      spanId: "span_root",
    }).map((item) => item.spanId)).not.toContain("span_child");
  });

  it("summarizes a trace with error, test, verifier, evidence-link, match, then sibling priority", () => {
    const store = createRuntimeTraceSpanStore();
    const sibling = span({
      traceId: "trace_summary",
      spanId: "span_sibling",
      kind: "runtime",
      startedAt: 1,
      endedAt: 2,
      evidenceRefs: [],
      events: [],
    });
    const matching = span({
      traceId: "trace_summary",
      spanId: "span_match",
      kind: "tool",
      name: "tool.call",
      startedAt: 5,
      endedAt: 6,
      attributes: { "task.id": "task_focus", "tool.name": "focus_tool" },
      sourceRefs: [{ file: "src/focus.ts", symbol: "focusSymbol" }],
      evidenceRefs: [],
      events: [],
    });
    const evidenceLinked = span({
      traceId: "trace_summary",
      spanId: "span_evidence_link",
      kind: "runtime",
      startedAt: 4,
      endedAt: 5,
      links: [
        {
          traceId: "trace_summary",
          spanId: "span_test",
          relationship: "evidence",
        },
      ],
      evidenceRefs: [],
      events: [],
    });
    const test = span({
      traceId: "trace_summary",
      spanId: "span_test",
      kind: "test",
      name: "test.run",
      startedAt: 2,
      endedAt: 3,
      evidenceRefs: [],
      events: [],
    });
    const verifier = span({
      traceId: "trace_summary",
      spanId: "span_verifier",
      kind: "verifier",
      name: "verifier.decision",
      startedAt: 3,
      endedAt: 4,
      evidenceRefs: [],
      events: [],
    });
    const error = span({
      traceId: "trace_summary",
      spanId: "span_error",
      kind: "tool",
      name: "tool.call",
      status: "error",
      statusMessage: "prompt leaked sk-live-secret-token",
      startedAt: 6,
      endedAt: 7,
      attributes: { "tool.name": "broken_tool", output: "raw output" },
      evidenceRefs: [],
      events: [],
    });
    store.appendMany([sibling, matching, evidenceLinked, test, verifier, error]);

    const summary = store.summarizeTrace("trace_summary", 512, {
      taskId: "task_focus",
      toolName: "focus_tool",
      file: "src/focus.ts",
      symbol: "focusSymbol",
    });

    expect(summary.readonly).toBe(true);
    expect(summary.items.map((item) => item.spanId)).toEqual([
      "span_error",
      "span_test",
      "span_verifier",
      "span_evidence_link",
      "span_match",
      "span_sibling",
    ]);
    expect(summary.items[0]?.summary).toContain("message=[redacted]");
    expect(summary.estimatedTokens).toBeLessThanOrEqual(summary.tokenBudget);
    expect(JSON.stringify(summary)).not.toContain("sk-live");
    expect(JSON.stringify(summary)).not.toContain("raw output");

    const tiny = store.summarizeTrace("trace_summary", 1);
    expect(tiny.items).toHaveLength(1);
    expect(tiny.estimatedTokens).toBeLessThanOrEqual(1);
    expect(tiny.omittedSpanCount).toBe(5);
  });

  it("clears in-memory data without persistence side effects", () => {
    const store = createRuntimeTraceSpanStore();
    store.append(span({ traceId: "trace_clear", spanId: "span_clear" }));
    expect(store.stats().totalSpanCount).toBe(1);

    store.clear();

    expect(store.snapshot()).toEqual([]);
    expect(store.stats()).toMatchObject({
      totalSpanCount: 0,
      traceCount: 0,
      readonly: true,
    });
  });
});

function span(overrides: Partial<RuntimeTraceSpan> = {}): RuntimeTraceSpan {
  return {
    ...buildRuntimeTraceSpanFixture({
      evidenceRefs: [],
      events: [],
      sourceRefs: [{ file: "src/default.ts", symbol: "defaultSymbol" }],
    }),
    ...overrides,
  };
}
