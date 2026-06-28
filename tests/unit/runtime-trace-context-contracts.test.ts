import { describe, expect, it } from "vitest";
import {
  DEFAULT_RUNTIME_TRACE_CONTEXT_FEATURE_FLAGS,
  RUNTIME_TRACE_CONTEXT_FLAG_PATHS,
  RUNTIME_TRACE_LINK_RELATIONSHIPS,
  RUNTIME_TRACE_SPAN_KINDS,
  RUNTIME_TRACE_SPAN_STATUSES,
  buildRuntimeTraceSpanFixture,
  findRuntimeTraceChildren,
  findRuntimeTraceLinkedSpans,
  findRuntimeTraceSpans,
  isRuntimeTraceContextProviderResult,
  isRuntimeTraceQuery,
  isRuntimeTraceSpan,
  isRuntimeTraceSpanEvent,
  isRuntimeTraceSummary,
  rankRuntimeTraceSpans,
  resolveRuntimeTraceContextFeatureFlags,
  runtimeTraceContextFlagEnabled,
  sanitizeExternalRuntimeTraceContext,
  sanitizeRuntimeTraceAttributes,
  summarizeRuntimeTrace,
} from "../../openclaw_runtime/src/runtime-core";

describe("runtime trace context contracts", () => {
  it("defines trace span taxonomy and default-off feature flags", () => {
    expect(RUNTIME_TRACE_SPAN_KINDS).toEqual([
      "task",
      "tool",
      "test",
      "verifier",
      "checkpoint",
      "resume",
      "runtime",
      "other",
    ]);
    expect(RUNTIME_TRACE_SPAN_STATUSES).toEqual(["unset", "ok", "error"]);
    expect(RUNTIME_TRACE_LINK_RELATIONSHIPS).toEqual([
      "resume",
      "evidence",
      "related",
    ]);
    expect(RUNTIME_TRACE_CONTEXT_FLAG_PATHS).toEqual({
      shadow: "runtime.traceContext.shadow",
      provider: "runtime.traceContext.provider",
      propagation: "runtime.traceContext.propagation",
    });
    expect(DEFAULT_RUNTIME_TRACE_CONTEXT_FEATURE_FLAGS).toEqual({
      shadow: false,
      provider: false,
      propagation: false,
    });
    expect(resolveRuntimeTraceContextFeatureFlags({})).toEqual({
      shadow: false,
      provider: false,
      propagation: false,
    });
    expect(resolveRuntimeTraceContextFeatureFlags({
      runtime: {
        traceContext: {
          shadow: true,
          provider: true,
          propagation: true,
          exporter: true,
        },
      },
    })).toEqual({
      shadow: true,
      provider: true,
      propagation: true,
    });
    expect(resolveRuntimeTraceContextFeatureFlags({
      traceContext: { shadow: true, provider: "true", propagation: 1 },
    })).toEqual({
      shadow: true,
      provider: false,
      propagation: false,
    });
    expect(runtimeTraceContextFlagEnabled({}, "shadow")).toBe(false);
  });

  it("validates span, event, link, source ref, and query shapes", () => {
    const span = buildRuntimeTraceSpanFixture({
      traceId: "trace_contract",
      spanId: "span_tool",
      parentSpanId: "span_task",
      name: "tool.call",
      kind: "tool",
      status: "ok",
      statusMessage: "prompt leaked sk-live-secret-token",
      attributes: {
        "task.id": "task_1",
        "tool.name": "read",
        toolArgs: { path: "secret.ts" },
        safeLabel: "bounded",
      },
      links: [
        {
          traceId: "trace_contract",
          spanId: "span_test",
          relationship: "evidence",
          attributes: { output: "raw tool output", safe: "link" },
        },
      ],
      events: [
        {
          name: "tool.output.received",
          timestamp: 3,
          attributes: { output: "full output", bytes: 1024 },
          evidenceRefs: [{ type: "tool", ref: "tool_call_1" }],
        },
      ],
      sourceRefs: [
        {
          file: "openclaw_runtime/src/runtime-core/trace-context.ts",
          startLine: 1,
          endLine: 12,
          symbol: "RuntimeTraceSpan",
        },
      ],
      evidenceRefs: [{ type: "trace", ref: "trace_contract" }],
    });

    expect(isRuntimeTraceSpan(span)).toBe(true);
    expect(isRuntimeTraceSpan({ ...span, events: undefined })).toBe(false);
    expect(isRuntimeTraceSpanEvent(span.events[0])).toBe(true);
    expect(span.attributes.toolArgs).toBe("[redacted]");
    expect(span.statusMessage).toBe("[redacted]");
    expect(span.links[0]?.attributes?.output).toBe("[redacted]");
    expect(span.events[0]?.attributes?.output).toBe("[redacted]");
    expect(isRuntimeTraceQuery({
      traceId: "trace_contract",
      parentSpanId: "span_task",
      taskId: "task_1",
      toolName: "read",
      status: "ok",
      timeRange: { start: 1, end: 10 },
    })).toBe(true);
    expect(isRuntimeTraceQuery({ status: "failed" })).toBe(false);
  });

  it("queries parent, child, linked, source, status, task, tool, and time dimensions", () => {
    const root = buildRuntimeTraceSpanFixture({
      traceId: "trace_query",
      spanId: "span_task",
      name: "task.run",
      kind: "task",
      startedAt: 1,
      endedAt: 50,
      attributes: { "task.id": "task_query" },
    });
    const tool = buildRuntimeTraceSpanFixture({
      traceId: "trace_query",
      spanId: "span_tool",
      parentSpanId: "span_task",
      name: "tool.call",
      kind: "tool",
      startedAt: 10,
      endedAt: 20,
      attributes: { "task.id": "task_query", "tool.name": "read_file" },
      sourceRefs: [{ file: "src/example.ts", symbol: "runExample" }],
    });
    const test = buildRuntimeTraceSpanFixture({
      traceId: "trace_query",
      spanId: "span_test",
      parentSpanId: "span_task",
      name: "test.run",
      kind: "test",
      startedAt: 21,
      endedAt: 30,
      status: "error",
      attributes: { "task.id": "task_query" },
      sourceRefs: [{ file: "tests/example.test.ts", symbol: "example test" }],
    });
    const resume = buildRuntimeTraceSpanFixture({
      traceId: "trace_resume",
      spanId: "span_resume",
      name: "task.resume",
      kind: "resume",
      startedAt: 60,
      endedAt: 61,
      links: [
        {
          traceId: "trace_query",
          spanId: "span_task",
          relationship: "resume",
        },
      ],
      attributes: { "task.id": "task_query" },
      sourceRefs: [{ file: "runtime-research/checkpoint.md", symbol: "checkpoint" }],
    });
    const spans = [root, tool, test, resume];

    expect(findRuntimeTraceChildren(spans, "trace_query", "span_task").map((span) => span.spanId))
      .toEqual(["span_tool", "span_test"]);
    expect(findRuntimeTraceSpans(spans, {
      taskId: "task_query",
      toolName: "read_file",
      file: "src/example.ts",
      symbol: "runExample",
    })).toEqual([tool]);
    expect(findRuntimeTraceSpans(spans, {
      traceId: "trace_query",
      status: "error",
      kind: "test",
    })).toEqual([test]);
    expect(findRuntimeTraceSpans(spans, {
      traceId: "trace_query",
      timeRange: { start: 15, end: 15 },
    }).map((span) => span.spanId)).toEqual(["span_task", "span_tool"]);
    expect(findRuntimeTraceSpans(spans, { linkedSpanId: "span_task" }))
      .toEqual([resume]);
    expect(findRuntimeTraceLinkedSpans(spans, root)).toEqual([resume]);
    expect(resume.parentSpanId).toBeUndefined();
  });

  it("prioritizes error, test, verifier, and evidence-linked spans in budgeted summaries", () => {
    const ok = buildRuntimeTraceSpanFixture({
      traceId: "trace_summary",
      spanId: "span_ok",
      kind: "runtime",
      name: "runtime.step",
      status: "ok",
      startedAt: 1,
      endedAt: 2,
      evidenceRefs: [],
      events: [],
    });
    const verifier = buildRuntimeTraceSpanFixture({
      traceId: "trace_summary",
      spanId: "span_verifier",
      kind: "verifier",
      name: "verifier.decision",
      status: "ok",
      startedAt: 4,
      endedAt: 5,
      evidenceRefs: [{ type: "trace", ref: "verifier_span" }],
    });
    const test = buildRuntimeTraceSpanFixture({
      traceId: "trace_summary",
      spanId: "span_test",
      kind: "test",
      name: "test.run",
      status: "ok",
      startedAt: 3,
      endedAt: 4,
      evidenceRefs: [{ type: "test", ref: "tests/unit/runtime-trace-context-contracts.test.ts" }],
    });
    const error = buildRuntimeTraceSpanFixture({
      traceId: "trace_summary",
      spanId: "span_error",
      kind: "tool",
      name: "tool.call",
      status: "error",
      statusMessage: "The tool failed with a bounded diagnostic.",
      startedAt: 2,
      endedAt: 3,
      links: [
        {
          traceId: "trace_summary",
          spanId: "span_test",
          relationship: "evidence",
          attributes: { stdout: "full command output", safe: "kept" },
        },
      ],
      events: [
        {
          name: "tool.output.received",
          timestamp: 2.5,
          attributes: { output: "full raw output", code: "E_TOOL" },
          evidenceRefs: [
            {
              type: "tool",
              ref: "tool_error",
              metadata: { apiKey: "sk-live", safe: "metadata" },
            },
          ],
        },
      ],
      evidenceRefs: [
        {
          type: "trace",
          ref: "error_span",
          metadata: { prompt: "raw prompt", safe: "trace" },
        },
      ],
    });

    const ranked = rankRuntimeTraceSpans([ok, verifier, test, error], {});
    expect(ranked.map((span) => span.spanId)).toEqual([
      "span_error",
      "span_test",
      "span_verifier",
      "span_ok",
    ]);

    const summary = summarizeRuntimeTrace([ok, verifier, test, error], {
      traceId: "trace_summary",
      tokenBudget: 80,
    });
    expect(isRuntimeTraceSummary(summary)).toBe(true);
    expect(summary.readonly).toBe(true);
    expect(summary.items[0]).toMatchObject({
      spanId: "span_error",
      status: "error",
      eventCount: 1,
    });
    expect(summary.estimatedTokens).toBeLessThanOrEqual(summary.tokenBudget);
    expect(JSON.stringify(summary)).not.toContain("raw prompt");
    expect(JSON.stringify(summary)).not.toContain("full command output");
    expect(JSON.stringify(summary)).not.toContain("full raw output");
    expect(JSON.stringify(summary)).not.toContain("sk-live");
    expect(JSON.stringify(summary)).toContain("[redacted]");

    const tinySummary = summarizeRuntimeTrace([error, test], {
      traceId: "trace_summary",
      tokenBudget: 1,
    });
    expect(tinySummary.items).toHaveLength(1);
    expect(tinySummary.estimatedTokens).toBeLessThanOrEqual(1);
    expect(tinySummary.omittedSpanCount).toBe(1);
  });

  it("marks valid external traceparent untrusted and rejects malformed or invalid carriers", () => {
    const valid = sanitizeExternalRuntimeTraceContext({
      traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
      tracestate: "vendor=value,other=state",
      baggage: "user=alice,token=secret",
    });

    expect(valid).toEqual({
      action: "marked_untrusted",
      context: {
        source: "external",
        traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
        parentSpanId: "00f067aa0ba902b7",
        traceFlags: "01",
        trusted: false,
        tracestateKeys: ["vendor", "other"],
        baggageKeys: ["user", "token"],
      },
    });
    expect(sanitizeExternalRuntimeTraceContext({}).action).toBe("rejected");
    expect(sanitizeExternalRuntimeTraceContext({ traceparent: "not-a-traceparent" }))
      .toEqual({ action: "rejected", reason: "malformed" });
    expect(sanitizeExternalRuntimeTraceContext({
      traceparent: "00-00000000000000000000000000000000-00f067aa0ba902b7-01",
    })).toEqual({ action: "rejected", reason: "invalid" });
    expect(sanitizeExternalRuntimeTraceContext({
      traceparent: "ff-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
    })).toEqual({ action: "rejected", reason: "invalid" });
  });

  it("validates readonly provider result shape without registering a default provider", () => {
    const span = buildRuntimeTraceSpanFixture({
      traceId: "trace_provider",
      spanId: "span_provider",
      evidenceRefs: [{ type: "trace", ref: "trace_provider" }],
    });
    const summary = summarizeRuntimeTrace([span], {
      traceId: "trace_provider",
      tokenBudget: 128,
    });
    const result = {
      contextItems: [
        {
          id: "runtime-trace-context:span_provider",
          kind: "trace",
          text: summary.items[0]?.summary ?? "",
          source: "runtime-trace-context",
          priority: "P1",
          evidenceRefs: summary.items[0]?.evidenceRefs ?? [],
          metadata: { traceId: "trace_provider", spanId: "span_provider" },
        },
      ],
      summary,
      evidenceRefs: summary.items.flatMap((item) => item.evidenceRefs),
      readonly: true,
    };

    expect(isRuntimeTraceContextProviderResult(result)).toBe(true);
    expect(isRuntimeTraceContextProviderResult({ ...result, readonly: false }))
      .toBe(false);
  });

  it("redacts sensitive trace attributes while preserving bounded safe fields", () => {
    const sanitized = sanitizeRuntimeTraceAttributes({
      prompt: "raw prompt",
      message: "full message",
      toolArgs: { command: "rm -rf" },
      stdout: "unbounded output",
      env: { OPENAI_API_KEY: "sk-live" },
      apiKey: "sk-live",
      baggage: "session=secret",
      traceState: "vendor=secret",
      safe: "kept",
      nested: { safeNumber: 1, privateKey: "secret" },
    });

    expect(sanitized).toMatchObject({
      prompt: "[redacted]",
      message: "[redacted]",
      toolArgs: "[redacted]",
      stdout: "[redacted]",
      env: "[redacted]",
      apiKey: "[redacted]",
      baggage: "[redacted]",
      traceState: "[redacted]",
      safe: "kept",
      nested: { safeNumber: 1, privateKey: "[redacted]" },
    });
  });
});
