// @vitest-environment node
// WP2 (Week 7-8): EntityResolver 接入 bridge discovery 单元测试.
//
// 覆盖 memory-bridge-discovery.ts 的 WP2 扩展:
//   - discoverBridges() 接受 options.resolver, canonicalize e1/e2 + 候选 fact entities
//   - checkPathExistence() 接受 resolver, canonicalize 路径上的 entities
//   - BridgeDiagnostics.entityResolutionApplied / entityResolutionMappings trace
//
// 注意: AliasTable 的 canonical 形式是 normalizeEntityName() 后的小写形式
// (见 memory-entity-resolver.ts), 因此 resolve("Jon") 返回 "jonathan" (小写),
// resolve("New York") 返回 "new york"。surface 字段保留输入原大小写。
import { describe, expect, it } from "vitest";
import {
  checkPathExistence,
  discoverBridges,
} from "../../openclaw_runtime/src/runtime-core/memory-bridge-discovery.js";
import {
  AliasTable,
  type EntityOccurrence,
} from "../../openclaw_runtime/src/runtime-core/memory-entity-resolver.js";
import type { RuntimeMemoryQueryableFact } from "../../openclaw_runtime/src/runtime-core/memory-context.js";

// === Helpers ===

function makeFact(
  factId: string,
  subject: string,
  objectSummary: string,
  entityIds: string[],
  validAt = 1000,
): RuntimeMemoryQueryableFact {
  return {
    factId,
    subject,
    predicate: "relates_to",
    objectSummary,
    confidence: 0.9,
    valid_at: validAt,
    invalid_at: undefined,
    expired_at: undefined,
    reference_time: validAt,
    memoryType: "semantic",
    entities: entityIds,
    proofCount: 1,
    sourceMemoryIds: [],
    topic: "test",
    subTopic: "test",
    attributes: [],
    // bridge discovery 通过 (fact as { entityIds?: string[] }).entityIds 访问,
    // 需要把 entityIds 放到对象上 (类型 cast 不会在运行时添加属性).
    entityIds,
  } as unknown as RuntimeMemoryQueryableFact;
}

function buildResolver(occurrences: EntityOccurrence[]): AliasTable {
  const table = new AliasTable();
  table.buildFromOccurrences(occurrences);
  return table;
}

// Jon / John / Jonathan 共现, 合并到 canonical "jonathan" (小写规范化形式).
// - "jon" ⊂ "jonathan" → nameSimilarity ≈ 1.0 + cooccurrence(f1) + temporal → merge
// - "john" vs "jonathan" → nameSimilarity ≈ 0.80 + cooccurrence(f2) + temporal → merge
//   (sessionDate 相同 → temporalScore = 1.0, 把 total 推过 0.6 阈值)
const JON_JONATHAN_OCCURRENCES: EntityOccurrence[] = [
  { entity: "Jon", factId: "f1", sessionDate: 1000 },
  { entity: "Jonathan", factId: "f1", sessionDate: 1000 },
  { entity: "Jonathan", factId: "f2", sessionDate: 1000 },
  { entity: "John", factId: "f2", sessionDate: 1000 },
  { entity: "Jonathan", factId: "f3", sessionDate: 1000 },
];

// NYC / "New York" 共现, 合并到 canonical "new york".
// nameSimilarity("nyc","new york") ≈ 0.54 (低), 需要 2+ cooccurrence + temporal
// 才能把 total 推过 0.6 阈值.
const NYC_NEWYORK_OCCURRENCES: EntityOccurrence[] = [
  { entity: "NYC", factId: "f1", sessionDate: 1000 },
  { entity: "New York", factId: "f1", sessionDate: 1000 },
  { entity: "NYC", factId: "f2", sessionDate: 1000 },
  { entity: "New York", factId: "f2", sessionDate: 1000 },
  { entity: "New York", factId: "f3", sessionDate: 1000 },
];

// === WP2: EntityResolver 接入 bridge discovery ===
describe("WP2 EntityResolver bridge discovery", () => {
  // 1. resolver 提供时, e1/e2 被 canonicalize, trace 记录映射
  it("should_canonicalize_e1_e2_when_resolver_provided", () => {
    const resolver = buildResolver(JON_JONATHAN_OCCURRENCES);
    // 确认 resolver 确实把 "Jon" 合并到 "jonathan"
    expect(resolver.resolve("Jon")).toBe("jonathan");

    const facts = [
      makeFact("f1", "Jonathan", "the person profile", ["Jonathan"]),
    ];

    const { diagnostics } = discoverBridges(
      { e1: "Jon", e2: "Conference" },
      facts,
      "strict_current",
      2000,
      { resolver },
    );

    // resolver 被应用
    expect(diagnostics.entityResolutionApplied).toBe(true);

    // mappings 包含 Jon → jonathan (canonical 为小写规范化形式)
    const jonMapping = diagnostics.entityResolutionMappings?.find(
      (m) => m.surface === "Jon",
    );
    expect(jonMapping).toBeDefined();
    expect(jonMapping?.canonical).toBe("jonathan");

    // entityPair.e1 被 canonicalize 为 "jonathan"
    expect(diagnostics.entityPair.e1).toBe("jonathan");
  });

  // 2. resolver 为 null 时, 不做 canonicalize, mappings 为空
  it("should_not_canonicalize_when_resolver_null", () => {
    const facts = [
      makeFact("f1", "Jonathan", "the person profile", ["Jonathan"]),
    ];

    const { diagnostics } = discoverBridges(
      { e1: "Jon", e2: "Conference" },
      facts,
      "strict_current",
      2000,
      // 不传 resolver
    );

    expect(diagnostics.entityResolutionApplied).toBe(false);
    expect(diagnostics.entityResolutionMappings).toEqual([]);
    // e1 保持原样
    expect(diagnostics.entityPair.e1).toBe("Jon");
  });

  // 3. resolver 提升桥候选数量 (John 经 canonicalize 后也变成 e1 的候选)
  it("should_improve_pathExistence_with_resolver", () => {
    const resolver = buildResolver(JON_JONATHAN_OCCURRENCES);
    // Jon / John 都合并到 jonathan
    expect(resolver.resolve("Jon")).toBe("jonathan");
    expect(resolver.resolve("John")).toBe("jonathan");

    const facts = [
      makeFact("f1", "Jon works at company", "company info", ["Jon"]),
      makeFact("f2", "John likes pizza", "food preference", ["John"]),
      makeFact("f3", "Conference in Boston", "event venue", [
        "Conference",
        "Boston",
      ]),
    ];

    // 不传 resolver: f2 ("John") 与 e1="Jon" 不匹配 (john ≠ jon, 文本也不含 jon),
    //   所以 f2 不入候选. 候选只有 f1 (含 Jon) + f3 (含 Conference) = 2.
    const withoutResolver = discoverBridges(
      { e1: "Jon", e2: "Conference" },
      facts,
      "strict_current",
      2000,
    );

    // 传 resolver: f2 的 entityIds ["John"] canonicalize 为 ["jonathan"],
    //   与 canonicalE1="jonathan" 匹配 → f2 也入候选. 候选 = 3.
    const withResolver = discoverBridges(
      { e1: "Jon", e2: "Conference" },
      facts,
      "strict_current",
      2000,
      { resolver },
    );

    // with resolver 的桥候选数 >= without resolver
    expect(withResolver.diagnostics.bridgeCandidateCount).toBeGreaterThanOrEqual(
      withoutResolver.diagnostics.bridgeCandidateCount,
    );
    // 且确实有提升 (这是 WP2 接入的价值所在)
    expect(withResolver.diagnostics.bridgeCandidateCount).toBeGreaterThan(
      withoutResolver.diagnostics.bridgeCandidateCount,
    );
    // with resolver 应用了 entity resolution
    expect(withResolver.diagnostics.entityResolutionApplied).toBe(true);
    expect(withoutResolver.diagnostics.entityResolutionApplied).toBe(false);
  });

  // 4. resolver canonicalize 候选 fact 的 entities (NYC → new york)
  it("should_canonicalize_candidate_fact_entities", () => {
    const resolver = buildResolver(NYC_NEWYORK_OCCURRENCES);
    // 确认 NYC 合并到 "new york"
    expect(resolver.resolve("NYC")).toBe("new york");
    expect(resolver.resolve("New York")).toBe("new york");

    // f1 用 "NYC" 表面形式; objectSummary 不含 "new york"/"boston" 文本
    const facts = [
      makeFact("f1", "NYC", "the city location", ["NYC"]),
    ];

    // 不传 resolver: f1 entityIds=["NYC"], e1="New York" → "nyc" ≠ "new york",
    //   文本也不含 "new york" → f1 不入候选. bridgeCandidateCount === 0.
    const withoutResolver = discoverBridges(
      { e1: "New York", e2: "Boston" },
      facts,
      "strict_current",
      2000,
    );
    expect(withoutResolver.diagnostics.bridgeCandidateCount).toBe(0);

    // 传 resolver: f1 entityIds canonicalize 为 ["new york"],
    //   canonicalE1 = resolve("New York") = "new york" → 匹配 → f1 入候选.
    const withResolver = discoverBridges(
      { e1: "New York", e2: "Boston" },
      facts,
      "strict_current",
      2000,
      { resolver },
    );
    expect(withResolver.diagnostics.bridgeCandidateCount).toBeGreaterThanOrEqual(
      1,
    );
    expect(withResolver.diagnostics.entityResolutionApplied).toBe(true);
  });

  // 5. entityResolutionMappings trace 字段完整性
  it("should_record_entity_resolution_mappings_in_trace", () => {
    const resolver = buildResolver(JON_JONATHAN_OCCURRENCES);

    const facts = [
      makeFact("f1", "Jonathan", "the person profile", ["Jonathan"]),
    ];

    const { diagnostics } = discoverBridges(
      { e1: "Jon", e2: "Mary" },
      facts,
      "strict_current",
      2000,
      { resolver },
    );

    expect(diagnostics.entityResolutionMappings).toBeInstanceOf(Array);
    expect(diagnostics.entityResolutionMappings?.length).toBeGreaterThanOrEqual(
      1,
    );

    const mapping = diagnostics.entityResolutionMappings?.[0];
    expect(mapping).toBeDefined();
    // surface 保留输入原大小写
    expect(mapping?.surface).toBe("Jon");
    // canonical 为小写规范化形式
    expect(mapping?.canonical).toBe("jonathan");
    // score > 0 (合并置信度)
    expect(mapping?.score).toBeGreaterThan(0);
    // matchedBy 是字符串 (alias_table / exact)
    expect(typeof mapping?.matchedBy).toBe("string");
  });

  // 6. checkPathExistence 也接受 resolver (WP2 路径完整性)
  it("checkPathExistence accepts resolver and canonicalizes path entities", () => {
    const resolver = buildResolver(JON_JONATHAN_OCCURRENCES);

    // f1 含 "Jon", f2 含 "John" (与 Jon 同义但未 canonicalize 时是不同实体),
    // f3 含 "Conference". 无 resolver 时 Jon 与 John 不连通.
    const facts = [
      makeFact("f1", "Jon works at company", "company info", ["Jon"]),
      makeFact("f2", "John likes pizza", "food preference", ["John"]),
      makeFact("f3", "Conference in Boston", "event venue", [
        "Conference",
        "Boston",
      ]),
    ];

    // 无 resolver: "Jon" 与 "Conference" 之间无连通路径 (Jon/John 不合并)
    const withoutResolver = checkPathExistence(
      { e1: "Jon", e2: "Conference" },
      facts,
      3,
      "strict_current",
      2000,
      null,
    );

    // 有 resolver: "Jon" canonicalize 为 "jonathan", 路径上 "John" 也 canonicalize
    //   为 "jonathan" → Jon ↔ John 连通, 但仍需 John 能到达 Conference.
    //   这里只验证 with resolver 不会比 without resolver 更差 (>=).
    const withResolver = checkPathExistence(
      { e1: "Jon", e2: "Conference" },
      facts,
      3,
      "strict_current",
      2000,
      resolver,
    );

    // with resolver 的路径存在性 >= without resolver (不会更差)
    expect(withResolver || !withoutResolver).toBe(true);
  });
});
