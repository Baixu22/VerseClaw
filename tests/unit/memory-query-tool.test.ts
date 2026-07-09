// @vitest-environment node
// memory_query agent tool 单元测试.
import { describe, expect, it, beforeEach, vi } from "vitest";
import type { RuntimeMemoryQueryableFact } from "../../openclaw_runtime/src/runtime-core/memory-context";

// === Mock facts (复用 compass-experience-validation 的 fact 结构) ===
function makeFact(opts: {
  factId: string;
  subject: string;
  predicate: string;
  objectSummary: string;
  confidence?: number;
  validAt?: number;
}): RuntimeMemoryQueryableFact {
  const ts = opts.validAt ?? 1000;
  return {
    schemaVersion: 1 as const,
    factId: opts.factId,
    subject: opts.subject,
    predicate: opts.predicate,
    objectSummary: opts.objectSummary,
    confidence: opts.confidence ?? 0.9,
    source: "tool_result" as const,
    verificationStatus: "verified" as const,
    sourceEpisodeRefs: [{ episodeId: "ep-test" }],
    evidenceRefs: [{ type: "manual" as const, ref: "test-evidence" }],
    proposedAt: ts,
    validAt: ts,
    reference_time: ts,
    acceptedAt: ts,
    promotion: {
      promotedBy: "verifier" as const,
      evidenceRefs: [{ type: "manual" as const, ref: "test-evidence" }],
    },
  };
}

const MOCK_FACTS: RuntimeMemoryQueryableFact[] = [
  makeFact({ factId: "f1", subject: "alice", predicate: "lives_in", objectSummary: "lives in Boston, Massachusetts", validAt: 1000 }),
  makeFact({ factId: "f2", subject: "alice", predicate: "works_at", objectSummary: "works as a software engineer at Google", validAt: 1100 }),
  makeFact({ factId: "f3", subject: "alice", predicate: "hobby", objectSummary: "enjoys hiking on weekends in the White Mountains", validAt: 1200 }),
  makeFact({ factId: "f4", subject: "bob", predicate: "lives_in", objectSummary: "lives in Seattle, Washington", validAt: 2000 }),
  makeFact({ factId: "f5", subject: "bob", predicate: "works_at", objectSummary: "is a product manager at Microsoft", validAt: 2100 }),
];

// === Mock loadCompassFacts (隔离, 不依赖真实 SQLite) ===
let mockFacts: RuntimeMemoryQueryableFact[] = [];

vi.mock("../../openclaw_runtime/src/runtime-core/memory-pre-reply-injection", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../openclaw_runtime/src/runtime-core/memory-pre-reply-injection")>();
  return {
    ...actual,
    loadCompassFacts: () => mockFacts,
    resolveCompassConfig: () => ({
      featureFlags: {
        enableSessionStatePage: true,
        enablePreReplyRetrieval: true,
        enableUDecisionRanking: false,
        enableCostAwareEvictionV2: false,
        enableConfigVersionTree: false,
        enableEntityResolverInBridge: false,
        enableWeightedTraversalInExpansion: false,
        enableEvidenceDiscipline: false,
        eventLogHashAlg: "sha256",
      },
      runtimeFingerprint: "test",
      configHash: "test",
    }),
  };
});

// === Tests ===
describe("memory_query agent tool", () => {
  beforeEach(() => {
    mockFacts = [...MOCK_FACTS];
  });

  it("createMemoryQueryTool 在 persist=false 时返回 null", async () => {
    const { createMemoryQueryTool } = await import("../../openclaw_runtime/src/runtime-core/memory-query-tool");
    const tool = createMemoryQueryTool({
      config: { runtime: { memory: { persist: false } } },
    });
    expect(tool).toBeNull();
  });

  it("createMemoryQueryTool 在 persist=true 时返回有效 tool", async () => {
    const { createMemoryQueryTool } = await import("../../openclaw_runtime/src/runtime-core/memory-query-tool");
    const tool = createMemoryQueryTool({
      config: { runtime: { memory: { persist: true } } },
    });
    expect(tool).not.toBeNull();
    expect(tool!.name).toBe("memory_query");
    expect(tool!.label).toBe("memory_query");
    expect(typeof tool!.execute).toBe("function");
  });

  it("tool.execute 在 facts 为空时返回 { ok: false }", async () => {
    mockFacts = [];
    const { createMemoryQueryTool } = await import("../../openclaw_runtime/src/runtime-core/memory-query-tool");
    const tool = createMemoryQueryTool({
      config: { runtime: { memory: { persist: true } } },
    });
    const result = await tool!.execute("call-1", { query: "Alice" }, undefined, undefined);

    const payload = JSON.parse(result.content[0]!.text) as { ok: boolean; message: string; count: number };
    expect(payload.ok).toBe(false);
    expect(payload.count).toBe(0);
  });

  it("tool.execute 在有 facts 时返回 { ok: true, count, facts }", async () => {
    const { createMemoryQueryTool } = await import("../../openclaw_runtime/src/runtime-core/memory-query-tool");
    const tool = createMemoryQueryTool({
      config: { runtime: { memory: { persist: true } } },
    });
    const result = await tool!.execute("call-2", { query: "Alice Boston" }, undefined, undefined);

    const payload = JSON.parse(result.content[0]!.text) as {
      ok: boolean;
      count: number;
      facts: Array<{ factId: string; subject: string }>;
    };
    expect(payload.ok).toBe(true);
    expect(payload.count).toBeGreaterThan(0);
    expect(payload.facts.length).toBe(payload.count);
    // Alice 相关 facts 应排在前
    expect(payload.facts.some((f) => f.subject === "alice")).toBe(true);
  });

  it("tool.execute 的 subject 过滤生效", async () => {
    const { createMemoryQueryTool } = await import("../../openclaw_runtime/src/runtime-core/memory-query-tool");
    const tool = createMemoryQueryTool({
      config: { runtime: { memory: { persist: true } } },
    });
    const result = await tool!.execute(
      "call-3",
      { query: "lives in", subject: "bob" },
      undefined,
      undefined,
    );

    const payload = JSON.parse(result.content[0]!.text) as {
      ok: boolean;
      facts: Array<{ subject: string }>;
    };
    expect(payload.ok).toBe(true);
    // subject=bob 过滤后只应有 bob 的 facts
    expect(payload.facts.every((f) => f.subject === "bob")).toBe(true);
  });

  it("tool.execute 的 topK 参数生效", async () => {
    const { createMemoryQueryTool } = await import("../../openclaw_runtime/src/runtime-core/memory-query-tool");
    const tool = createMemoryQueryTool({
      config: { runtime: { memory: { persist: true } } },
    });
    const result = await tool!.execute(
      "call-4",
      { query: "lives works hobby", topK: 2 },
      undefined,
      undefined,
    );

    const payload = JSON.parse(result.content[0]!.text) as { count: number };
    expect(payload.count).toBeLessThanOrEqual(2);
  });

  it("tool.execute 在 query 为空时返回 { ok: false }", async () => {
    const { createMemoryQueryTool } = await import("../../openclaw_runtime/src/runtime-core/memory-query-tool");
    const tool = createMemoryQueryTool({
      config: { runtime: { memory: { persist: true } } },
    });
    const result = await tool!.execute("call-5", { query: "" }, undefined, undefined);

    const payload = JSON.parse(result.content[0]!.text) as { ok: boolean; count: number };
    expect(payload.ok).toBe(false);
    expect(payload.count).toBe(0);
  });

  it("tool 参数 schema 包含 query (required), topK 和 subject (optional)", async () => {
    const { createMemoryQueryTool } = await import("../../openclaw_runtime/src/runtime-core/memory-query-tool");
    const tool = createMemoryQueryTool({
      config: { runtime: { memory: { persist: true } } },
    });
    const schema = tool!.parameters as { properties: Record<string, unknown>; required?: string[] };
    expect(schema.properties.query).toBeDefined();
    expect(schema.properties.topK).toBeDefined();
    expect(schema.properties.subject).toBeDefined();
    expect(schema.required).toContain("query");
  });
});
