import { describe, expect, it } from "vitest";
import {
  buildGroundingRefFixture,
  buildRuntimeTraceSpanFixture,
  findGroundingRefs,
  groundingQueryFromEventLogSearchQuery,
  groundingQueryFromRuntimeTraceQuery,
  groundingRefsFromRuntimeTraceSourceRefs,
  groundingRefsFromRuntimeTraceSpan,
  isGroundingResult,
  rankGroundingRefs,
  summarizeGroundingRefs,
  type GroundingQuery,
  type GroundingRef,
} from "../../openclaw_runtime/src/runtime-core";

describe("runtime grounding query helpers", () => {
  it("projects runtime trace spans into trace, source, and evidence grounding refs", () => {
    const sourceRef = {
      file: "src/feature.ts",
      startLine: 10,
      endLine: 20,
      symbol: "runFeature",
      commit: "abc123",
      diffHash: "diff456",
    };
    const span = buildRuntimeTraceSpanFixture({
      traceId: "trace_query",
      spanId: "span_source",
      name: "tool.run",
      kind: "tool",
      status: "ok",
      startedAt: 100,
      endedAt: 150,
      attributes: {
        "task.id": "task_query",
        "tool.name": "shell",
        toolCallId: "tool_1",
        checkpointId: "checkpoint_1",
      },
      sourceRefs: [sourceRef],
      evidenceRefs: [
        { type: "file", ref: "src/feature.ts", label: "Feature file" },
        { type: "test", ref: "pnpm test -- feature", label: "Feature test" },
      ],
      events: [
        {
          name: "verification",
          timestamp: 125,
          attributes: { ok: true },
          evidenceRefs: [{ type: "tool", ref: "tool_1" }],
        },
      ],
    });

    const refs = groundingRefsFromRuntimeTraceSpan(span);

    expect(refs.map((ref) => ref.kind)).toEqual(expect.arrayContaining([
      "trace",
      "source",
      "file",
      "test",
      "tool",
    ]));
    expect(refs.every((ref) => ref.authority === "none")).toBe(true);
    expect(refs.every((ref) => ref.rawRetained === false)).toBe(true);
    expect(refs.find((ref) => ref.kind === "trace")).toMatchObject({
      taskId: "task_query",
      traceId: "trace_query",
      spanId: "span_source",
      toolCallId: "tool_1",
      metadata: {
        spanName: "tool.run",
        spanKind: "tool",
        spanStatus: "ok",
        noVerifierAuthority: true,
      },
    });
    expect(refs.find((ref) => ref.kind === "source")).toMatchObject({
      sourceRef,
      metadata: {
        file: "src/feature.ts",
        symbol: "runFeature",
        startLine: 10,
        endLine: 20,
        commit: "abc123",
        diffHash: "diff456",
        sourceRefsAreEvidenceLinksOnly: true,
        sourceRefsAreRelevanceAnchorsOnly: true,
        noVerifierAuthority: true,
      },
    });

    const projected = groundingRefsFromRuntimeTraceSourceRefs([sourceRef], {
      taskId: "task_query",
      traceId: "trace_query",
      spanId: "span_source",
    });
    expect(projected).toHaveLength(1);
    expect(projected[0]?.sourceRef).toEqual(sourceRef);
  });

  it("maps trace and event-log queries into bounded readonly grounding queries", () => {
    expect(groundingQueryFromRuntimeTraceQuery({
      traceId: "trace_1",
      spanId: "span_1",
      parentSpanId: "parent_1",
      linkedSpanId: "linked_1",
      taskId: "task_1",
      toolName: "shell",
      file: "src/a.ts",
      symbol: "runA",
      name: "task.run",
      kind: "task",
      status: "error",
      timeRange: { start: 1, end: 2 },
    })).toMatchObject({
      readonly: true,
      traceId: "trace_1",
      spanId: "span_1",
      parentSpanId: "parent_1",
      linkedSpanId: "linked_1",
      taskId: "task_1",
      toolName: "shell",
      file: "src/a.ts",
      symbol: "runA",
      spanName: "task.run",
      spanKind: "task",
      spanStatus: "error",
      timeRange: { start: 1, end: 2 },
      includeRaw: false,
    });

    expect(groundingQueryFromEventLogSearchQuery({
      taskId: "task_1",
      kind: ["error", "checkpoint"],
      timestampGte: 10,
      timestampLt: 20,
      sortOrder: "desc",
      page: 2,
      limit: 4,
    })).toMatchObject({
      readonly: true,
      taskId: "task_1",
      eventKind: ["error", "checkpoint"],
      timeRange: { start: 10, end: 20 },
      sortOrder: "desc",
      page: 2,
      limit: 4,
      includeRaw: false,
    });
  });

  it("filters by task, trace, span, source, status, and evidence anchors", () => {
    const target = groundingRefsFromRuntimeTraceSpan(buildRuntimeTraceSpanFixture({
      traceId: "trace_target",
      spanId: "span_target",
      kind: "test",
      status: "error",
      startedAt: 10,
      attributes: { "task.id": "task_target" },
      sourceRefs: [{ file: "tests/target.test.ts", symbol: "targetTest" }],
      evidenceRefs: [
        { type: "test", ref: "pnpm test -- target" },
        { type: "trace", ref: "trace_target" },
      ],
    }));
    const other = groundingRefsFromRuntimeTraceSpan(buildRuntimeTraceSpanFixture({
      traceId: "trace_other",
      spanId: "span_other",
      status: "ok",
      attributes: { "task.id": "task_other" },
      sourceRefs: [{ file: "src/other.ts", symbol: "other" }],
      evidenceRefs: [{ type: "file", ref: "src/other.ts" }],
    }));
    const refs = [...target, ...other];

    expect(findGroundingRefs(refs, query({ taskId: "task_target" }))
      .every((ref) => ref.taskId === "task_target")).toBe(true);
    expect(findGroundingRefs(refs, query({ traceId: "trace_target" }))
      .every((ref) => ref.traceId === "trace_target")).toBe(true);
    expect(findGroundingRefs(refs, query({ spanId: "span_target" }))
      .every((ref) => ref.spanId === "span_target")).toBe(true);
    expect(findGroundingRefs(refs, query({ file: "tests/target.test.ts" }))
      .map((ref) => ref.sourceRef?.file)).toEqual(["tests/target.test.ts"]);
    expect(findGroundingRefs(refs, query({ symbol: "targetTest" }))
      .map((ref) => ref.sourceRef?.symbol)).toEqual(["targetTest"]);
    expect(findGroundingRefs(refs, query({ spanStatus: "error" }))
      .every((ref) => ref.metadata?.spanStatus === "error")).toBe(true);
    expect(findGroundingRefs(refs, query({ evidenceType: "test" }))
      .map((ref) => ref.evidenceRef?.ref)).toEqual(["pnpm test -- target"]);
  });

  it("prioritizes error, test, verifier, and evidence-linked refs without changing authority", () => {
    const refs = [
      rankedRef("plain", 5, "source", {}),
      rankedRef("evidence", 4, "trace", {
        evidenceRef: { type: "trace", ref: "trace_link" },
      }),
      rankedRef("verifier", 3, "trace", {
        metadata: { spanKind: "verifier", spanStatus: "ok" },
      }),
      rankedRef("test", 2, "trace", {
        metadata: { spanKind: "test", spanStatus: "ok" },
      }),
      rankedRef("error", 1, "trace", {
        metadata: { spanKind: "tool", spanStatus: "error" },
      }),
    ];

    const ranked = rankGroundingRefs(refs, query());

    expect(ranked.map((ref) => ref.id)).toEqual([
      "error",
      "test",
      "verifier",
      "evidence",
      "plain",
    ]);
    expect(ranked.every((ref) => ref.authority === "none")).toBe(true);
    expect(ranked.map((ref) => ref.trust)).toEqual(refs.map((ref) => ref.trust).reverse());
  });

  it("excludes untrusted refs by default and keeps external trace context untrusted", () => {
    const refs = groundingRefsFromRuntimeTraceSpan(buildRuntimeTraceSpanFixture({
      traceId: "trace_external",
      spanId: "span_external",
      events: [
        {
          name: "trace_context.external",
          timestamp: 2,
          attributes: {
            action: "marked_untrusted",
            trusted: false,
            vendorStateKeyCount: 1,
            contextMetadataKeyCount: 1,
          },
        },
      ],
    }));
    const external = refs.find((ref) =>
      ref.metadata?.spanEventName === "trace_context.external"
    );

    expect(external).toMatchObject({
      trust: "untrusted",
      authority: "none",
      metadata: {
        externalTraceContextAction: "marked_untrusted",
        trusted: false,
      },
    });
    expect(findGroundingRefs([
      ...refs,
      buildGroundingRefFixture({
        id: "untrusted_fixture",
        canonicalKey: "untrusted:fixture",
        ref: "untrusted:fixture",
        trust: "untrusted",
      }),
    ], query()).some((ref) => ref.trust === "untrusted")).toBe(false);
  });

  it("rejects includeRaw as false and does not return retained raw data", () => {
    const result = summarizeGroundingRefs([
      buildGroundingRefFixture({
        id: "safe_ref",
        canonicalKey: "trace:safe_ref",
        ref: "trace:safe_ref",
        summary: "Safe bounded summary.",
      }),
    ], {
      readonly: true,
      includeRaw: true,
      tokenBudget: 32,
    } as unknown as GroundingQuery);

    expect(isGroundingResult(result)).toBe(true);
    expect(result.query.includeRaw).toBe(false);
    expect(result.refs.every((ref) => ref.rawRetained === false)).toBe(true);
    expect(result.items.every((item) => item.authority === "none")).toBe(true);
    expect(result.metadata?.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "includeRaw_rejected",
        includeRaw: false,
        rawRetained: false,
      }),
    ]));
  });

  it("truncates summaries to token budget and reports omitted refs", () => {
    const result = summarizeGroundingRefs([
      rankedRef("long_1", 1, "trace", { summary: "A".repeat(100) }),
      rankedRef("long_2", 2, "trace", { summary: "B".repeat(100) }),
    ], query({ limit: 2, tokenBudget: 3 }));

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.summary.length).toBeLessThanOrEqual(12);
    expect(result.estimatedTokens).toBeLessThanOrEqual(result.tokenBudget);
    expect(result.omittedRefCount).toBe(1);
  });

  it("applies deterministic pagination after ranking", () => {
    const refs = [1, 2, 3, 4, 5].map((timestamp) =>
      rankedRef(`page_${timestamp}`, timestamp, "trace", {
        evidenceRef: undefined,
      })
    );

    expect(findGroundingRefs(refs, query({ limit: 2, page: 1 }))
      .map((ref) => ref.id)).toEqual(["page_3", "page_4"]);
  });
});

function query(overrides: Partial<GroundingQuery> = {}): GroundingQuery {
  return {
    readonly: true,
    ...overrides,
  } as GroundingQuery;
}

function rankedRef(
  id: string,
  timestamp: number,
  kind: GroundingRef["kind"],
  overrides: Partial<GroundingRef>,
): GroundingRef {
  return buildGroundingRefFixture({
    kind,
    id,
    canonicalKey: `${kind}:${id}`,
    ref: `${kind}:${id}`,
    label: id,
    summary: `${id} summary.`,
    timestamp,
    taskId: "task_rank",
    traceId: "trace_rank",
    spanId: `span_${id}`,
    trust: "supplied",
    evidenceRef: undefined,
    sourceRef: undefined,
    metadata: {},
    ...overrides,
  });
}
