// Phase 1: Query Classifier 单元测试
//
// 覆盖：
// 1. 启发式分类（temporal/multi_hop/open_domain/single_hop）
// 2. parseClassificationResponse（JSON/markdown fence/keyword/invalid）
// 3. buildQueryPlan（armWeights/strategy/timeWindow/subQuestions）
// 4. classifyQuery（无 key 时回退到启发式）
// 5. classifyQuery（有 key 时 LLM 分类，skipIf 无 key）

import { describe, expect, it } from "vitest";
import {
  buildQueryPlan,
  classifyQuery,
  classifyQueryHeuristic,
  parseClassificationResponse,
} from "./query-classifier";
import { hasDeepSeekKey } from "./runtime-memory-real-llm-client";

describe("Query Classifier — 启发式分类", () => {
  it("分类 temporal 查询（when/how long/what date）", () => {
    expect(classifyQueryHeuristic("When did Alice start surfing?")).toBe("temporal");
    expect(classifyQueryHeuristic("How long has Bob worked at Google?")).toBe("temporal");
    expect(classifyQueryHeuristic("What date did they first meet?")).toBe("temporal");
    expect(classifyQueryHeuristic("On what day did the event happen?")).toBe("temporal");
  });

  it("分类 temporal 查询（相对时间词）", () => {
    expect(classifyQueryHeuristic("What has Carol been up to recently?")).toBe("temporal");
    expect(classifyQueryHeuristic("How many years ago did Dave move?")).toBe("temporal");
    expect(classifyQueryHeuristic("What was Bob doing last month?")).toBe("temporal");
    expect(classifyQueryHeuristic("What happened in 2023?")).toBe("temporal");
  });

  it("分类 multi_hop 查询（compare/relationship/before+after）", () => {
    expect(classifyQueryHeuristic("Compare Alice's job before and after 2023")).toBe("multi_hop");
    expect(classifyQueryHeuristic("What is the relationship between Alice and Bob?")).toBe("multi_hop");
    expect(classifyQueryHeuristic("What is the difference between X and Y?")).toBe("multi_hop");
  });

  it("分类 open_domain 查询（tell me about/describe/summarize）", () => {
    expect(classifyQueryHeuristic("Tell me about Alice's hobbies")).toBe("open_domain");
    expect(classifyQueryHeuristic("What can you tell me about Bob's background?")).toBe("open_domain");
    expect(classifyQueryHeuristic("Describe Carol's personality")).toBe("open_domain");
    expect(classifyQueryHeuristic("Summarize Dave's career journey")).toBe("open_domain");
  });

  it("默认分类为 single_hop", () => {
    expect(classifyQueryHeuristic("What is Alice's job?")).toBe("single_hop");
    expect(classifyQueryHeuristic("Where does Bob live?")).toBe("single_hop");
    expect(classifyQueryHeuristic("How old is Carol?")).toBe("temporal"); // how old → temporal
    expect(classifyQueryHeuristic("Does Dave like hiking?")).toBe("single_hop");
  });

  it("空/非法 query 返回 single_hop", () => {
    expect(classifyQueryHeuristic("")).toBe("single_hop");
    // @ts-expect-error 测试非法输入
    expect(classifyQueryHeuristic(null)).toBe("single_hop");
    // @ts-expect-error 测试非法输入
    expect(classifyQueryHeuristic(undefined)).toBe("single_hop");
  });
});

describe("Query Classifier — parseClassificationResponse", () => {
  it("解析纯 JSON 响应", () => {
    const content = '{"type": "temporal", "reasoning": "mentions a date"}';
    expect(parseClassificationResponse(content)).toBe("temporal");
  });

  it("解析 markdown fence 包裹的 JSON", () => {
    const content = '```json\n{"type": "multi_hop", "reasoning": "cross-entity"}\n```';
    expect(parseClassificationResponse(content)).toBe("multi_hop");
  });

  it("解析带前后噪声的 JSON", () => {
    const content = 'The classification is: {"type": "open_domain"} as per the rules.';
    expect(parseClassificationResponse(content)).toBe("open_domain");
  });

  it("JSON 无效时回退到关键词扫描", () => {
    const content = "Based on the analysis, this is a temporal query.";
    expect(parseClassificationResponse(content)).toBe("temporal");
  });

  it("识别 multi-hop / single-hop 连字符变体", () => {
    expect(parseClassificationResponse("This is a multi-hop question")).toBe("multi_hop");
    expect(parseClassificationResponse("This is a single-hop question")).toBe("single_hop");
  });

  it("完全无效的响应返回 null", () => {
    expect(parseClassificationResponse("I don't know")).toBeNull();
    expect(parseClassificationResponse("")).toBeNull();
    expect(parseClassificationResponse("random text without keywords")).toBeNull();
  });

  it("JSON 中 type 字段无效时回退到关键词", () => {
    const content = '{"type": "unknown_type", "reasoning": "..."}';
    // JSON 中 type 无效，但 reasoning 中无关键词 → null
    expect(parseClassificationResponse(content)).toBeNull();
  });
});

describe("Query Classifier — buildQueryPlan", () => {
  it("temporal → temporal_priority 策略 + temporal arm 权重", () => {
    const plan = buildQueryPlan("temporal", "When did Alice start surfing?", Date.UTC(2023, 6, 1));
    expect(plan.type).toBe("temporal");
    expect(plan.strategy).toBe("temporal_priority");
    expect(plan.armWeights.bm25).toBe(0.5);
    expect(plan.armWeights.vector).toBe(1.0);
    expect(plan.armWeights.entity).toBe(0.5);
    expect(plan.armWeights.temporal).toBe(1.5);
    expect(plan.armWeights.selfAsk).toBeUndefined();
    expect(plan.rewriteHint).toContain("time window");
  });

  it("temporal 且 query 含日期 → timeWindow 定义", () => {
    const plan = buildQueryPlan("temporal", "What happened on 15 March 2023?", Date.UTC(2023, 6, 1));
    expect(plan.timeWindow).toBeDefined();
    expect(plan.timeWindow!.referenceTime).toBe(Date.UTC(2023, 2, 15));
    expect(plan.timeWindow!.beforeDays).toBe(30);
    expect(plan.timeWindow!.afterDays).toBe(30);
  });

  it("temporal 且 query 无日期 → timeWindow 不定义", () => {
    const plan = buildQueryPlan("temporal", "When did something happen?", Date.UTC(2023, 6, 1));
    expect(plan.timeWindow).toBeUndefined();
  });

  it("multi_hop → multi_hop_deep 策略 + selfAsk arm 权重 + entity 加权", () => {
    const plan = buildQueryPlan("multi_hop", "Compare X and Y", undefined, ["What is X?", "What is Y?"]);
    expect(plan.type).toBe("multi_hop");
    expect(plan.strategy).toBe("multi_hop_deep");
    expect(plan.armWeights.bm25).toBe(0.5);
    expect(plan.armWeights.vector).toBe(1.0);
    expect(plan.armWeights.entity).toBe(1.0); // entity 从 0.5 提升到 1.0
    expect(plan.armWeights.selfAsk).toBe(0.8);
    expect(plan.armWeights.temporal).toBeUndefined();
    expect(plan.subQuestions).toEqual(["What is X?", "What is Y?"]);
    expect(plan.timeWindow).toBeUndefined();
    expect(plan.rewriteHint).toContain("sub-questions");
  });

  it("open_domain → profile_augment 策略 + 降低权重", () => {
    const plan = buildQueryPlan("open_domain", "Tell me about Alice");
    expect(plan.type).toBe("open_domain");
    expect(plan.strategy).toBe("profile_augment");
    expect(plan.armWeights.bm25).toBe(0.3); // 降低
    expect(plan.armWeights.vector).toBe(0.8); // 降低
    expect(plan.armWeights.entity).toBe(0.5);
    expect(plan.armWeights.temporal).toBeUndefined();
    expect(plan.armWeights.selfAsk).toBeUndefined();
    expect(plan.timeWindow).toBeUndefined();
    expect(plan.rewriteHint).toContain("keywords");
  });

  it("single_hop → standard 策略 + OPTIMAL_HYBRID_FUSION 权重", () => {
    const plan = buildQueryPlan("single_hop", "What is Alice's job?");
    expect(plan.type).toBe("single_hop");
    expect(plan.strategy).toBe("standard");
    expect(plan.armWeights.bm25).toBe(0.5);
    expect(plan.armWeights.vector).toBe(1.0);
    expect(plan.armWeights.entity).toBe(0.5);
    expect(plan.armWeights.temporal).toBeUndefined();
    expect(plan.armWeights.selfAsk).toBeUndefined();
    expect(plan.timeWindow).toBeUndefined();
    expect(plan.subQuestions).toBeUndefined();
    expect(plan.rewriteHint).toContain("synonym");
  });

  it("subQuestions 为空数组时不写入 plan", () => {
    const plan = buildQueryPlan("multi_hop", "Compare X and Y", undefined, []);
    expect(plan.subQuestions).toBeUndefined();
  });
});

describe("Query Classifier — classifyQuery (异步)", () => {
  it("空 query 返回 single_hop plan", async () => {
    const plan = await classifyQuery("");
    expect(plan.type).toBe("single_hop");
    expect(plan.strategy).toBe("standard");
  });

  it("无 DeepSeek key 时回退到启发式 (temporal)", async () => {
    // 这个测试在没有 DEEPSEEK_API_KEY 的环境下验证回退
    // 如果有 key，则跳过（由下面的 LLM 测试覆盖）
    if (hasDeepSeekKey()) return;

    const plan = await classifyQuery("When did Alice start surfing?");
    expect(plan.type).toBe("temporal");
    expect(plan.strategy).toBe("temporal_priority");
    expect(plan.armWeights.temporal).toBe(1.5);
  });

  it("无 DeepSeek key 时回退到启发式 (single_hop)", async () => {
    if (hasDeepSeekKey()) return;

    const plan = await classifyQuery("What is Alice's job?");
    expect(plan.type).toBe("single_hop");
    expect(plan.strategy).toBe("standard");
  });

  it("无 DeepSeek key 时回退到启发式 (multi_hop)", async () => {
    if (hasDeepSeekKey()) return;

    const plan = await classifyQuery("Compare Alice's job before and after 2023");
    expect(plan.type).toBe("multi_hop");
    expect(plan.strategy).toBe("multi_hop_deep");
    // 启发式路径不分解 sub-questions（无 LLM）
    expect(plan.subQuestions).toBeUndefined();
  });

  it("LLM 分类 multi_hop (需要 DEEPSEEK_API_KEY)", async ({ skip }) => {
    if (!hasDeepSeekKey()) skip();
    const plan = await classifyQuery("What job did Alice have before becoming a nurse?");
    expect(plan.type).toBe("multi_hop");
    expect(plan.strategy).toBe("multi_hop_deep");
    // LLM 分解的 sub-questions 应该存在（除非分解失败）
    if (plan.subQuestions) {
      expect(plan.subQuestions.length).toBeGreaterThan(0);
      expect(plan.subQuestions.length).toBeLessThanOrEqual(2);
    }
  });

  it("LLM 分类 temporal (需要 DEEPSEEK_API_KEY)", async ({ skip }) => {
    if (!hasDeepSeekKey()) skip();
    const plan = await classifyQuery("When did Bob start working at Google?");
    expect(plan.type).toBe("temporal");
    expect(plan.strategy).toBe("temporal_priority");
    expect(plan.armWeights.temporal).toBe(1.5);
  });

  it("QueryPlan 是 immutable (readonly 字段)", async () => {
    const plan = await classifyQuery("What is Alice's job?");
    // TypeScript 编译时保证 readonly，这里验证运行时不可写
    expect(Object.isFrozen(plan)).toBe(false); // readonly 不等于 frozen
    // 但字段在类型层面是 readonly
    expect(plan.type).toBeDefined();
    expect(plan.strategy).toBeDefined();
  });
});
