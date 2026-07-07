// @vitest-environment node
// Week 2 v2: 时间 policy 三档过滤 + query-intent 启发式 + as_of snapshot 单元测试.
//
// 覆盖 memory-arch-roadmap.md §B3 + §C.5 + Week 2 完成定义:
//   1. query-intent 启发式: "以前/曾经/before/previously" → include_history_ranked
//   2. query-intent 启发式: "in 2023" → as_of(T)
//   3. strict_current 过滤: invalid_at/expired_at < now hard filter
//   4. include_history_ranked 过滤: 允许历史 fact, 降权 (×0.5)
//   5. as_of(T) snapshot: T 时刻有效的 fact 集合
//   6. 集成: hybridSearchFacts 用 temporalPolicy 覆盖 temporalMode
import { describe, expect, it } from "vitest";
import {
  asOfSnapshot,
  computeHistoryPenalty,
  inferTemporalPolicyFromQuery,
  passesTemporalPolicy,
  policyToTemporalMode,
} from "../../openclaw_runtime/src/runtime-core/memory-temporal-policy";
import {
  hybridSearchFacts,
  type HybridSearchQuery,
} from "../../openclaw_runtime/src/runtime-core/memory-hybrid-retrieval";
import {
  buildRuntimeMemoryTemporalFactFixture,
} from "../../openclaw_runtime/src/runtime-core/memory-context";

// === Helpers ===

const NOW = Date.UTC(2024, 5, 15); // 2024-06-15

function makeFact(overrides: {
  factId: string;
  subject?: string;
  predicate?: string;
  objectSummary?: string;
  valid_at?: number;
  invalid_at?: number;
  expired_at?: number;
}): ReturnType<typeof buildRuntimeMemoryTemporalFactFixture> {
  return buildRuntimeMemoryTemporalFactFixture({
    factId: overrides.factId,
    subject: overrides.subject ?? "Jon",
    predicate: overrides.predicate ?? "lives_in",
    objectSummary: overrides.objectSummary ?? "lives in Boston",
    valid_at: overrides.valid_at ?? Date.UTC(2020, 0, 1),
    reference_time: overrides.valid_at ?? Date.UTC(2020, 0, 1),
    ...(overrides.invalid_at !== undefined
      ? { invalid_at: overrides.invalid_at }
      : {}),
    ...(overrides.expired_at !== undefined
      ? { expired_at: overrides.expired_at }
      : {}),
  });
}

// === query-intent 启发式 ===
describe("inferTemporalPolicyFromQuery", () => {
  describe("as_of (明确年份)", () => {
    it("English 'in 2023' → as_of(2023-01-01)", () => {
      const result = inferTemporalPolicyFromQuery(
        "What was Jon's job in 2023?",
        NOW,
      );
      expect(result.policy).toBe("as_of");
      expect(result.asOfTime).toBe(Date.UTC(2023, 0, 1));
      expect(result.intentKeywords).toContain("2023");
      expect(result.matchedPattern).toBe("explicit_year");
    });

    it("Chinese '2023年' → as_of(2023-01-01)", () => {
      const result = inferTemporalPolicyFromQuery(
        "Jon 2023年的工作是什么？",
        NOW,
      );
      expect(result.policy).toBe("as_of");
      expect(result.asOfTime).toBe(Date.UTC(2023, 0, 1));
    });

    it("English 'during 2022' → as_of(2022-01-01)", () => {
      const result = inferTemporalPolicyFromQuery(
        "Where did Mary live during 2022?",
        NOW,
      );
      expect(result.policy).toBe("as_of");
      expect(result.asOfTime).toBe(Date.UTC(2022, 0, 1));
    });

    it("invalid year (1800) → falls through to other policies", () => {
      const result = inferTemporalPolicyFromQuery(
        "What happened in 1800?",
        NOW,
      );
      // 1800 < 1900, 不算明确年份 → 检查历史关键词
      // "happened" 不含历史关键词 → strict_current
      expect(result.policy).toBe("strict_current");
    });
  });

  describe("include_history_ranked (历史关键词)", () => {
    it("Chinese '以前' → include_history_ranked", () => {
      const result = inferTemporalPolicyFromQuery(
        "Jon 以前住在哪里？",
        NOW,
      );
      expect(result.policy).toBe("include_history_ranked");
      expect(result.intentKeywords).toContain("以前");
    });

    it("Chinese '曾经' → include_history_ranked", () => {
      const result = inferTemporalPolicyFromQuery(
        "Mary 曾经在哪里工作？",
        NOW,
      );
      expect(result.policy).toBe("include_history_ranked");
    });

    it("English 'before' → include_history_ranked", () => {
      const result = inferTemporalPolicyFromQuery(
        "Where did Jon live before?",
        NOW,
      );
      expect(result.policy).toBe("include_history_ranked");
      expect(result.intentKeywords).toContain("before");
    });

    it("English 'previously' → include_history_ranked", () => {
      const result = inferTemporalPolicyFromQuery(
        "What was Jon's previously known address?",
        NOW,
      );
      expect(result.policy).toBe("include_history_ranked");
    });

    it("English 'used to' → include_history_ranked", () => {
      const result = inferTemporalPolicyFromQuery(
        "Jon used to live in NYC.",
        NOW,
      );
      expect(result.policy).toBe("include_history_ranked");
    });
  });

  describe("include_history_ranked (对比模式)", () => {
    it("'以前...现在' 对比 → include_history_ranked", () => {
      const result = inferTemporalPolicyFromQuery(
        "Jon 以前住哪，现在住哪？",
        NOW,
      );
      expect(result.policy).toBe("include_history_ranked");
      expect(result.matchedPattern).toContain("comparison:");
    });

    it("'before...now' 对比 → include_history_ranked", () => {
      const result = inferTemporalPolicyFromQuery(
        "Where did Jon live before and where now?",
        NOW,
      );
      expect(result.policy).toBe("include_history_ranked");
      expect(result.matchedPattern).toContain("comparison:");
    });
  });

  describe("strict_current (默认)", () => {
    it("普通查询 → strict_current", () => {
      const result = inferTemporalPolicyFromQuery(
        "Where does Jon live?",
        NOW,
      );
      expect(result.policy).toBe("strict_current");
      expect(result.intentKeywords).toEqual([]);
    });

    it("空查询 → strict_current", () => {
      const result = inferTemporalPolicyFromQuery("", NOW);
      expect(result.policy).toBe("strict_current");
    });

    it("'现在' 单独出现 (无历史关键词) → strict_current", () => {
      // "现在" 不在 HISTORY_INTENT_PATTERNS 中, 因为单独的"现在"问题不需要历史 fact
      const result = inferTemporalPolicyFromQuery(
        "Jon 现在住在哪里？",
        NOW,
      );
      expect(result.policy).toBe("strict_current");
    });
  });

  describe("优先级", () => {
    it("as_of 优先于 include_history_ranked", () => {
      // "in 2023" 同时含 "in" 不含历史关键词, 但 as_of 优先判定
      const result = inferTemporalPolicyFromQuery(
        "What was Jon's job previously in 2023?",
        NOW,
      );
      // as_of (明确年份) 优先
      expect(result.policy).toBe("as_of");
    });

    it("对比模式优先于单历史关键词", () => {
      // "以前...现在" 对比模式优先于单独的 "以前"
      const result = inferTemporalPolicyFromQuery(
        "Jon 以前住哪，现在住哪？",
        NOW,
      );
      expect(result.policy).toBe("include_history_ranked");
      expect(result.matchedPattern).toContain("comparison:");
    });
  });
});

// === 三档 policy 过滤函数 ===
describe("passesTemporalPolicy", () => {
  describe("strict_current", () => {
    it("当前有效 fact 通过", () => {
      const fact = makeFact({
        factId: "f1",
        valid_at: Date.UTC(2020, 0, 1),
      });
      const result = passesTemporalPolicy(fact, "strict_current", NOW);
      expect(result.passes).toBe(true);
    });

    it("已失效 fact 被过滤", () => {
      const fact = makeFact({
        factId: "f2",
        valid_at: Date.UTC(2020, 0, 1),
        invalid_at: Date.UTC(2023, 0, 1), // < NOW
      });
      const result = passesTemporalPolicy(fact, "strict_current", NOW);
      expect(result.passes).toBe(false);
      expect(result.reason).toBe("invalidated");
    });

    it("已过期 fact 被过滤", () => {
      const fact = makeFact({
        factId: "f3",
        valid_at: Date.UTC(2020, 0, 1),
        expired_at: Date.UTC(2023, 0, 1), // < NOW
      });
      const result = passesTemporalPolicy(fact, "strict_current", NOW);
      expect(result.passes).toBe(false);
      expect(result.reason).toBe("expired");
    });

    it("未来 fact 被过滤", () => {
      const fact = makeFact({
        factId: "f4",
        valid_at: Date.UTC(2025, 0, 1), // > NOW
      });
      const result = passesTemporalPolicy(fact, "strict_current", NOW);
      expect(result.passes).toBe(false);
      expect(result.reason).toBe("future_fact");
    });
  });

  describe("include_history_ranked", () => {
    it("当前有效 fact 通过", () => {
      const fact = makeFact({
        factId: "f1",
        valid_at: Date.UTC(2020, 0, 1),
      });
      const result = passesTemporalPolicy(
        fact,
        "include_history_ranked",
        NOW,
      );
      expect(result.passes).toBe(true);
    });

    it("已失效 fact 通过 (允许历史)", () => {
      const fact = makeFact({
        factId: "f2",
        valid_at: Date.UTC(2020, 0, 1),
        invalid_at: Date.UTC(2023, 0, 1), // < NOW
      });
      const result = passesTemporalPolicy(
        fact,
        "include_history_ranked",
        NOW,
      );
      expect(result.passes).toBe(true);
    });

    it("已过期 fact 通过 (允许历史)", () => {
      const fact = makeFact({
        factId: "f3",
        valid_at: Date.UTC(2020, 0, 1),
        expired_at: Date.UTC(2023, 0, 1),
      });
      const result = passesTemporalPolicy(
        fact,
        "include_history_ranked",
        NOW,
      );
      expect(result.passes).toBe(true);
    });

    it("未来 fact 仍被过滤", () => {
      const fact = makeFact({
        factId: "f4",
        valid_at: Date.UTC(2025, 0, 1), // > NOW
      });
      const result = passesTemporalPolicy(
        fact,
        "include_history_ranked",
        NOW,
      );
      expect(result.passes).toBe(false);
      expect(result.reason).toBe("future_fact");
    });
  });

  describe("as_of", () => {
    const T = Date.UTC(2022, 5, 15); // 2022-06-15

    it("T 时刻有效 fact 通过", () => {
      const fact = makeFact({
        factId: "f1",
        valid_at: Date.UTC(2020, 0, 1), // < T
      });
      const result = passesTemporalPolicy(fact, "as_of", NOW, T);
      expect(result.passes).toBe(true);
    });

    it("T 时刻已失效 fact 被过滤", () => {
      const fact = makeFact({
        factId: "f2",
        valid_at: Date.UTC(2020, 0, 1),
        invalid_at: Date.UTC(2022, 0, 1), // < T
      });
      const result = passesTemporalPolicy(fact, "as_of", NOW, T);
      expect(result.passes).toBe(false);
      expect(result.reason).toBe("invalidated_before_T");
    });

    it("T 时刻尚未生效 fact 被过滤", () => {
      const fact = makeFact({
        factId: "f3",
        valid_at: Date.UTC(2023, 0, 1), // > T
      });
      const result = passesTemporalPolicy(fact, "as_of", NOW, T);
      expect(result.passes).toBe(false);
      expect(result.reason).toBe("not_yet_valid_at_T");
    });

    it("T 之后失效 fact 通过 (T 时刻仍有效)", () => {
      const fact = makeFact({
        factId: "f4",
        valid_at: Date.UTC(2020, 0, 1),
        invalid_at: Date.UTC(2023, 0, 1), // > T
      });
      const result = passesTemporalPolicy(fact, "as_of", NOW, T);
      expect(result.passes).toBe(true);
    });

    it("as_of 无 T 参数 → 退化为 strict_current", () => {
      const fact = makeFact({
        factId: "f5",
        valid_at: Date.UTC(2020, 0, 1),
        invalid_at: Date.UTC(2023, 0, 1), // < NOW
      });
      const result = passesTemporalPolicy(fact, "as_of", NOW);
      expect(result.passes).toBe(false);
      expect(result.reason).toBe("invalidated");
    });
  });
});

// === include_history_ranked 降权 ===
describe("computeHistoryPenalty", () => {
  it("当前有效 fact → 1.0 (无降权)", () => {
    const fact = makeFact({
      factId: "f1",
      valid_at: Date.UTC(2020, 0, 1),
    });
    expect(computeHistoryPenalty(fact, NOW)).toBe(1.0);
  });

  it("已失效 fact → 0.5 (默认降权)", () => {
    const fact = makeFact({
      factId: "f2",
      valid_at: Date.UTC(2020, 0, 1),
      invalid_at: Date.UTC(2023, 0, 1),
    });
    expect(computeHistoryPenalty(fact, NOW)).toBe(0.5);
  });

  it("已过期 fact → 0.5 (默认降权)", () => {
    const fact = makeFact({
      factId: "f3",
      valid_at: Date.UTC(2020, 0, 1),
      expired_at: Date.UTC(2023, 0, 1),
    });
    expect(computeHistoryPenalty(fact, NOW)).toBe(0.5);
  });

  it("自定义降权比例", () => {
    const fact = makeFact({
      factId: "f4",
      valid_at: Date.UTC(2020, 0, 1),
      invalid_at: Date.UTC(2023, 0, 1),
    });
    expect(computeHistoryPenalty(fact, NOW, 0.3)).toBe(0.3);
  });
});

// === as_of snapshot 重建 ===
describe("asOfSnapshot", () => {
  const T = Date.UTC(2022, 5, 15); // 2022-06-15

  it("重建 T 时刻的 fact 列表", () => {
    const facts = [
      makeFact({
        factId: "f_before_valid", // T 时刻有效 (valid 2020, 无失效)
        valid_at: Date.UTC(2020, 0, 1),
      }),
      makeFact({
        factId: "f_invalidated_before_T", // T 时刻已失效
        valid_at: Date.UTC(2020, 0, 1),
        invalid_at: Date.UTC(2022, 0, 1),
      }),
      makeFact({
        factId: "f_not_yet_valid", // T 时刻尚未生效
        valid_at: Date.UTC(2023, 0, 1),
      }),
      makeFact({
        factId: "f_invalidated_after_T", // T 时刻仍有效 (2023 才失效)
        valid_at: Date.UTC(2020, 0, 1),
        invalid_at: Date.UTC(2023, 0, 1),
      }),
    ];

    const snapshot = asOfSnapshot(facts, T);
    expect(snapshot.map((f) => f.factId).sort()).toEqual(
      ["f_before_valid", "f_invalidated_after_T"].sort(),
    );
  });

  it("空输入 → 空输出", () => {
    expect(asOfSnapshot([], T)).toEqual([]);
  });
});

// === policyToTemporalMode 映射 ===
describe("policyToTemporalMode", () => {
  it("strict_current → filter", () => {
    expect(policyToTemporalMode("strict_current")).toBe("filter");
  });

  it("include_history_ranked → boost", () => {
    expect(policyToTemporalMode("include_history_ranked")).toBe("boost");
  });

  it("as_of → strict", () => {
    expect(policyToTemporalMode("as_of")).toBe("strict");
  });
});

// === 集成: hybridSearchFacts 用 temporalPolicy ===
describe("hybridSearchFacts integration with temporalPolicy", () => {
  const facts = [
    makeFact({
      factId: "f_current",
      subject: "Jon",
      predicate: "lives_in",
      objectSummary: "lives in Boston currently",
      valid_at: Date.UTC(2020, 0, 1),
    }),
    makeFact({
      factId: "f_old_invalidated",
      subject: "Jon",
      predicate: "lives_in",
      objectSummary: "lives in NYC old address",
      valid_at: Date.UTC(2018, 0, 1),
      invalid_at: Date.UTC(2019, 0, 1), // 已失效
    }),
    makeFact({
      factId: "f_future",
      subject: "Jon",
      predicate: "lives_in",
      objectSummary: "lives in Chicago future address",
      valid_at: Date.UTC(2025, 0, 1), // 未来 fact
    }),
  ];

  it("strict_current 过滤已失效 fact", () => {
    const query: HybridSearchQuery = {
      queryText: "where does Jon live",
      referenceTime: NOW,
      temporalPolicy: "strict_current",
    };
    const hits = hybridSearchFacts(facts, query);
    const factIds = hits.map((h) => h.fact.factId);
    expect(factIds).toContain("f_current");
    expect(factIds).not.toContain("f_old_invalidated");
    expect(factIds).not.toContain("f_future");
  });

  it("include_history_ranked 允许历史 fact 但降权", () => {
    const query: HybridSearchQuery = {
      queryText: "where does Jon live",
      referenceTime: NOW,
      temporalPolicy: "include_history_ranked",
    };
    const hits = hybridSearchFacts(facts, query);
    const factIds = hits.map((h) => h.fact.factId);
    // 历史 fact 通过过滤
    expect(factIds).toContain("f_old_invalidated");
    // 未来 fact 仍被过滤
    expect(factIds).not.toContain("f_future");

    // 历史 fact 的 rrfScore 应被降权 (×0.5)
    const oldHit = hits.find((h) => h.fact.factId === "f_old_invalidated");
    const currentHit = hits.find((h) => h.fact.factId === "f_current");
    if (oldHit && currentHit) {
      // 不比较绝对分数 (取决于 BM25/vector), 只验证 oldHit 被降权过
      // 由于降权是在 search 之后应用的, 我们检查 oldHit.rrfScore 是否小于其原始分数
      // 这里只能间接验证: oldHit 应该比 currentHit 排名低 (因为降权)
      const oldIdx = hits.findIndex((h) => h.fact.factId === "f_old_invalidated");
      const currentIdx = hits.findIndex((h) => h.fact.factId === "f_current");
      expect(oldIdx).toBeGreaterThan(currentIdx); // current 排在前面
    }
  });

  it("as_of(T) 重建 T 时刻 snapshot", () => {
    const T = Date.UTC(2022, 5, 15);
    const query: HybridSearchQuery = {
      queryText: "where does Jon live",
      referenceTime: NOW,
      temporalPolicy: "as_of",
      asOfTime: T,
    };
    const hits = hybridSearchFacts(facts, query);
    const factIds = hits.map((h) => h.fact.factId);
    // T 时刻: f_current (valid 2020, 未失效) + f_old_invalidated (2019 失效 < T, 被过滤)
    expect(factIds).toContain("f_current");
    expect(factIds).not.toContain("f_old_invalidated");
    expect(factIds).not.toContain("f_future");
  });

  it("temporalPolicy 优先于 temporalMode", () => {
    // 同时设置 temporalPolicy=include_history_ranked 和 temporalMode=filter
    // 应该走 temporalPolicy 路径 (允许历史 fact)
    const query: HybridSearchQuery = {
      queryText: "where does Jon live",
      referenceTime: NOW,
      temporalPolicy: "include_history_ranked",
      temporalMode: "filter", // 应该被 temporalPolicy 覆盖
    };
    const hits = hybridSearchFacts(facts, query);
    const factIds = hits.map((h) => h.fact.factId);
    expect(factIds).toContain("f_old_invalidated"); // temporalPolicy 允许历史
  });

  it("无 temporalPolicy 时保持 temporalMode 行为 (向后兼容)", () => {
    const query: HybridSearchQuery = {
      queryText: "where does Jon live",
      referenceTime: NOW,
      temporalMode: "filter", // 旧版行为
    };
    const hits = hybridSearchFacts(facts, query);
    const factIds = hits.map((h) => h.fact.factId);
    expect(factIds).not.toContain("f_old_invalidated"); // filter 过滤历史
  });
});
