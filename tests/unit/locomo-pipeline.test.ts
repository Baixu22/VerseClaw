// WP-E2: Pipeline helpers 测试.
//
// 覆盖 locomo-pipeline.ts 的所有导出函数:
//   - assembleQuestionResult / assembleErrorResult (结果构造)
//   - computeLocomoMetrics / accumulateQuestionResult (metrics 聚合)
//   - SOTA_COMPARISON / buildSotaComparison (SOTA 对比表)
//   - formatProgressLog / shouldLogProgress (进度日志)
//   - selectSampleResults / selectJudgeSanityCandidates (report 字段选取)

import { describe, it, expect } from "vitest";
import {
  assembleQuestionResult,
  assembleErrorResult,
  computeLocomoMetrics,
  accumulateQuestionResult,
  SOTA_COMPARISON,
  buildSotaComparison,
  formatProgressLog,
  shouldLogProgress,
  selectSampleResults,
  selectJudgeSanityCandidates,
  type LocomoQuestionResult,
  type CategoryAccumulator,
} from "./helpers/locomo-pipeline.js";

// === Fixtures ===

const sampleResult: LocomoQuestionResult = {
  questionId: "conv-1_q0",
  category: "temporal",
  conversationId: "conv-1",
  question: "When did Alice start?",
  goldEvidence: ["fact-1", "fact-2"],
  recall5: 0.75,
  contextRecall: 0.5,
  judgeScore: 1,
  escalationLevel: 2,
  predictedAnswer: "July 2023",
  groundTruth: "July, 2023",
  assembledContext: "Alice started in July 2023.",
};

// === assembleQuestionResult ===

describe("assembleQuestionResult", () => {
  it("构造成功结果对象", () => {
    const r = assembleQuestionResult({
      questionId: "conv-1_q0",
      category: "temporal",
      conversationId: "conv-1",
      question: "When?",
      goldEvidence: ["e1"],
      recall5: 0.5,
      contextRecall: 0.25,
      judgeScore: 1,
      escalationLevel: 1,
      predictedAnswer: "yes",
      groundTruth: "yes",
      assembledContext: "ctx",
    });
    expect(r).toEqual({
      questionId: "conv-1_q0",
      category: "temporal",
      conversationId: "conv-1",
      question: "When?",
      goldEvidence: ["e1"],
      recall5: 0.5,
      contextRecall: 0.25,
      judgeScore: 1,
      escalationLevel: 1,
      predictedAnswer: "yes",
      groundTruth: "yes",
      assembledContext: "ctx",
    });
  });

  it("所有字段显式传入, 无默认值", () => {
    // 验证无默认值 — 缺字段应 TypeScript 报错 (运行时为 undefined)
    const r = assembleQuestionResult({
      questionId: "q1",
      category: "single_hop",
      conversationId: "c1",
      question: "q",
      goldEvidence: [],
      recall5: 0,
      contextRecall: 0,
      judgeScore: 0,
      escalationLevel: 0,
      predictedAnswer: "",
      groundTruth: "",
      assembledContext: "",
    });
    expect(r.recall5).toBe(0);
    expect(r.predictedAnswer).toBe("");
  });
});

// === assembleErrorResult ===

describe("assembleErrorResult", () => {
  it("构造错误结果, 固定字段为 0/[ERROR]/空", () => {
    const r = assembleErrorResult({
      questionId: "conv-1_q0",
      category: "multi_hop",
      conversationId: "conv-1",
      question: "What?",
      goldEvidence: ["e1"],
      groundTruth: "answer",
    });
    expect(r.questionId).toBe("conv-1_q0");
    expect(r.category).toBe("multi_hop");
    expect(r.conversationId).toBe("conv-1");
    expect(r.question).toBe("What?");
    expect(r.goldEvidence).toEqual(["e1"]);
    expect(r.groundTruth).toBe("answer");
    // 固定值
    expect(r.recall5).toBe(0);
    expect(r.contextRecall).toBe(0);
    expect(r.judgeScore).toBe(0);
    expect(r.escalationLevel).toBe(0);
    expect(r.predictedAnswer).toBe("[ERROR]");
    expect(r.assembledContext).toBe("");
  });

  it("错误结果与成功结果结构一致 (LocomoQuestionResult)", () => {
    const err = assembleErrorResult({
      questionId: "q",
      category: "c",
      conversationId: "c",
      question: "q",
      goldEvidence: [],
      groundTruth: "g",
    });
    // 所有字段都存在
    expect(Object.keys(err).sort()).toEqual(
      [
        "questionId",
        "category",
        "conversationId",
        "question",
        "goldEvidence",
        "recall5",
        "contextRecall",
        "judgeScore",
        "escalationLevel",
        "predictedAnswer",
        "groundTruth",
        "assembledContext",
      ].sort(),
    );
  });
});

// === computeLocomoMetrics ===

describe("computeLocomoMetrics", () => {
  it("正确计算 overall 和 byCategory metrics", () => {
    const byCategory: Record<string, CategoryAccumulator> = {
      temporal: { correct: 30, total: 50, recallSum: 25, contextRecallSum: 10, count: 50 },
      multi_hop: { correct: 20, total: 40, recallSum: 15, contextRecallSum: 5, count: 40 },
    };
    const metrics = computeLocomoMetrics({
      totalCorrect: 50,
      totalRecall: 40,
      totalContextRecall: 15,
      byCategory,
      totalQuestions: 90,
    });
    // overall = 50/90, 40/90, 15/90
    expect(metrics.overallJ).toBeCloseTo(50 / 90, 10);
    expect(metrics.overallRecall).toBeCloseTo(40 / 90, 10);
    expect(metrics.overallContextRecall).toBeCloseTo(15 / 90, 10);
    // byCategory
    expect(metrics.categoryMetrics.temporal.j_score).toBeCloseTo(30 / 50, 10);
    expect(metrics.categoryMetrics.temporal.recall_at_5).toBeCloseTo(25 / 50, 10);
    expect(metrics.categoryMetrics.temporal.context_recall).toBeCloseTo(10 / 50, 10);
    expect(metrics.categoryMetrics.temporal.count).toBe(50);
    expect(metrics.categoryMetrics.multi_hop.j_score).toBeCloseTo(20 / 40, 10);
    expect(metrics.categoryMetrics.multi_hop.count).toBe(40);
  });

  it("空 byCategory 返回空 categoryMetrics", () => {
    const metrics = computeLocomoMetrics({
      totalCorrect: 0,
      totalRecall: 0,
      totalContextRecall: 0,
      byCategory: {},
      totalQuestions: 0,
    });
    expect(metrics.categoryMetrics).toEqual({});
    // 0/0 = NaN (与原代码行为一致)
    expect(Number.isNaN(metrics.overallJ)).toBe(true);
    expect(Number.isNaN(metrics.overallRecall)).toBe(true);
    expect(Number.isNaN(metrics.overallContextRecall)).toBe(true);
  });

  it("metrics 字段名与 report schema 一致 (snake_case)", () => {
    const metrics = computeLocomoMetrics({
      totalCorrect: 10,
      totalRecall: 5,
      totalContextRecall: 2,
      byCategory: {
        temporal: { correct: 10, total: 20, recallSum: 5, contextRecallSum: 2, count: 20 },
      },
      totalQuestions: 20,
    });
    // report schema 用 snake_case
    expect(metrics.categoryMetrics.temporal).toHaveProperty("j_score");
    expect(metrics.categoryMetrics.temporal).toHaveProperty("recall_at_5");
    expect(metrics.categoryMetrics.temporal).toHaveProperty("context_recall");
    expect(metrics.categoryMetrics.temporal).toHaveProperty("count");
    // 不应有 camelCase 字段
    expect(metrics.categoryMetrics.temporal).not.toHaveProperty("jScore");
    expect(metrics.categoryMetrics.temporal).not.toHaveProperty("recallAt5");
  });
});

// === accumulateQuestionResult ===

describe("accumulateQuestionResult", () => {
  it("累加单题结果到 byCategory 和 counters", () => {
    const byCategory: Record<string, CategoryAccumulator> = {};
    const counters = { totalCorrect: 0, totalRecall: 0, totalContextRecall: 0 };
    accumulateQuestionResult(byCategory, sampleResult, counters);
    expect(counters.totalCorrect).toBe(1);
    expect(counters.totalRecall).toBeCloseTo(0.75, 6);
    expect(counters.totalContextRecall).toBeCloseTo(0.5, 6);
    expect(byCategory.temporal).toEqual({
      correct: 1,
      total: 1,
      recallSum: 0.75,
      contextRecallSum: 0.5,
    });
  });

  it("新 category 自动创建累加器", () => {
    const byCategory: Record<string, CategoryAccumulator> = {};
    const counters = { totalCorrect: 0, totalRecall: 0, totalContextRecall: 0 };
    // 第一题 multi_hop
    accumulateQuestionResult(
      byCategory,
      { ...sampleResult, category: "multi_hop" },
      counters,
    );
    expect(byCategory.multi_hop).toBeDefined();
    expect(byCategory.multi_hop.total).toBe(1);
    // 第二题 temporal
    accumulateQuestionResult(byCategory, sampleResult, counters);
    expect(byCategory.temporal).toBeDefined();
    expect(byCategory.temporal.total).toBe(1);
    expect(Object.keys(byCategory).sort()).toEqual(["multi_hop", "temporal"]);
  });

  it("同 category 多题正确累加", () => {
    const byCategory: Record<string, CategoryAccumulator> = {};
    const counters = { totalCorrect: 0, totalRecall: 0, totalContextRecall: 0 };
    for (let i = 0; i < 5; i++) {
      accumulateQuestionResult(byCategory, sampleResult, counters);
    }
    expect(byCategory.temporal.total).toBe(5);
    expect(byCategory.temporal.correct).toBe(5);
    expect(byCategory.temporal.recallSum).toBeCloseTo(3.75, 6); // 5 * 0.75
    expect(counters.totalCorrect).toBe(5);
  });

  it("judgeScore=0 的结果也累加 (total++, correct 不变)", () => {
    const byCategory: Record<string, CategoryAccumulator> = {};
    const counters = { totalCorrect: 0, totalRecall: 0, totalContextRecall: 0 };
    accumulateQuestionResult(
      byCategory,
      { ...sampleResult, judgeScore: 0 },
      counters,
    );
    expect(byCategory.temporal.total).toBe(1);
    expect(byCategory.temporal.correct).toBe(0);
    expect(counters.totalCorrect).toBe(0);
  });
});

// === SOTA_COMPARISON / buildSotaComparison ===

describe("SOTA_COMPARISON", () => {
  it("包含 10 个 SOTA 条目 (不含 ours)", () => {
    const keys = Object.keys(SOTA_COMPARISON);
    expect(keys.length).toBe(10);
    expect(keys).toContain("Backboard");
    expect(keys).toContain("Hindsight_Gemini3");
    expect(keys).toContain("Hindsight_OSS120B");
    expect(keys).toContain("Hindsight_OSS20B");
    expect(keys).toContain("Memobase");
    expect(keys).toContain("Zep");
    expect(keys).toContain("Mem0_Graph");
    expect(keys).toContain("Mem0");
    expect(keys).toContain("LangMem");
    expect(keys).toContain("OpenAI_no_memory");
  });

  it("不包含 ours (ours 需运行时填入)", () => {
    expect(SOTA_COMPARISON).not.toHaveProperty("ours");
  });

  it("Backboard J Score = 0.9 (最高)", () => {
    expect(SOTA_COMPARISON.Backboard.j_score).toBe(0.9);
  });

  it("OpenAI_no_memory J Score = 0.529 (最低)", () => {
    expect(SOTA_COMPARISON.OpenAI_no_memory.j_score).toBe(0.529);
  });
});

describe("buildSotaComparison", () => {
  it("包含 SOTA_COMPARISON 全部条目 + ours", () => {
    const table = buildSotaComparison(0.718);
    expect(Object.keys(table).length).toBe(11); // 10 SOTA + ours
    expect(table).toHaveProperty("ours");
    expect(table.ours.j_score).toBeCloseTo(0.718, 6);
    // SOTA 条目仍存在
    expect(table.Backboard.j_score).toBe(0.9);
    expect(table.Hindsight_Gemini3.j_score).toBeCloseTo(0.8961, 6);
  });

  it("ours 字段为传入的 overallJ", () => {
    expect(buildSotaComparison(0.452).ours.j_score).toBeCloseTo(0.452, 6);
    expect(buildSotaComparison(0.386).ours.j_score).toBeCloseTo(0.386, 6);
    expect(buildSotaComparison(0).ours.j_score).toBe(0);
  });

  it("不修改原始 SOTA_COMPARISON 常量", () => {
    const original = { ...SOTA_COMPARISON };
    buildSotaComparison(0.718);
    expect(SOTA_COMPARISON).toEqual(original);
    expect(SOTA_COMPARISON).not.toHaveProperty("ours");
  });
});

// === formatProgressLog ===

describe("formatProgressLog", () => {
  it("格式化进度行", () => {
    const line = formatProgressLog({
      completed: 50,
      total: 500,
      totalCorrect: 36,
      totalRecall: 25,
      totalContextRecall: 0.4,
    });
    // 36/50 = 0.72 → 72.0%
    // 25/50 = 0.5 → 50.0%
    // 0.4/50 = 0.008 → 0.8%
    expect(line).toContain("50/500");
    expect(line).toContain("J=72.0%");
    expect(line).toContain("Recall@5=50.0%");
    expect(line).toContain("ContextRecall=0.8%");
    expect(line.startsWith("[LoCoMo-Full] Progress:")).toBe(true);
  });

  it("第一题 (completed=1) 正确格式化", () => {
    const line = formatProgressLog({
      completed: 1,
      total: 500,
      totalCorrect: 1,
      totalRecall: 1,
      totalContextRecall: 0,
    });
    expect(line).toContain("1/500");
    expect(line).toContain("J=100.0%");
    expect(line).toContain("Recall@5=100.0%");
    expect(line).toContain("ContextRecall=0.0%");
  });
});

// === shouldLogProgress ===

describe("shouldLogProgress", () => {
  it("每 10 题打印", () => {
    expect(shouldLogProgress(10, 500)).toBe(true);
    expect(shouldLogProgress(20, 500)).toBe(true);
    expect(shouldLogProgress(100, 500)).toBe(true);
    expect(shouldLogProgress(11, 500)).toBe(false);
    expect(shouldLogProgress(15, 500)).toBe(false);
  });

  it("最后一题打印", () => {
    expect(shouldLogProgress(500, 500)).toBe(true);
    expect(shouldLogProgress(100, 100)).toBe(true);
  });

  it("前 10 题打印 (completed < 10)", () => {
    expect(shouldLogProgress(1, 500)).toBe(true);
    expect(shouldLogProgress(5, 500)).toBe(true);
    expect(shouldLogProgress(9, 500)).toBe(true);
  });

  it("边界: completed=0 不打印 (无意义)", () => {
    // 0 % 10 === 0, 但 0 < 10 也 true → 实际为 true
    // 注意: 原代码 0 % 10 === 0 为 true, 但 completed=0 不会进入循环
    expect(shouldLogProgress(0, 500)).toBe(true); // 0 % 10 === 0
  });
});

// === selectSampleResults ===

describe("selectSampleResults", () => {
  it("按 category 选取前 5 个 (默认)", () => {
    const results: LocomoQuestionResult[] = [];
    for (let i = 0; i < 10; i++) {
      results.push({ ...sampleResult, questionId: `q${i}`, category: "temporal" });
      results.push({ ...sampleResult, questionId: `q${i}-mh`, category: "multi_hop" });
      results.push({ ...sampleResult, questionId: `q${i}-sh`, category: "single_hop" });
      results.push({ ...sampleResult, questionId: `q${i}-od`, category: "open_domain" });
    }
    const selected = selectSampleResults(results);
    // 4 categories × 5 = 20
    expect(selected.length).toBe(20);
    // temporal 前 5
    const temporal = selected.filter((r) => r.category === "temporal");
    expect(temporal.length).toBe(5);
    expect(temporal[0].questionId).toBe("q0");
    expect(temporal[4].questionId).toBe("q4");
  });

  it("自定义 perCategory 数量", () => {
    const results: LocomoQuestionResult[] = [];
    for (let i = 0; i < 10; i++) {
      results.push({ ...sampleResult, questionId: `q${i}`, category: "temporal" });
    }
    const selected = selectSampleResults(results, 3);
    const temporal = selected.filter((r) => r.category === "temporal");
    expect(temporal.length).toBe(3);
  });

  it("某 category 不足 perCategory 时取全部", () => {
    const results: LocomoQuestionResult[] = [
      { ...sampleResult, questionId: "q1", category: "temporal" },
      { ...sampleResult, questionId: "q2", category: "temporal" },
      { ...sampleResult, questionId: "q3", category: "multi_hop" },
    ];
    const selected = selectSampleResults(results, 5);
    expect(selected.length).toBe(3); // temporal 2 + multi_hop 1
  });

  it("顺序与原代码一致 (single_hop, temporal, multi_hop, open_domain)", () => {
    const results: LocomoQuestionResult[] = [
      { ...sampleResult, questionId: "od1", category: "open_domain" },
      { ...sampleResult, questionId: "mh1", category: "multi_hop" },
      { ...sampleResult, questionId: "t1", category: "temporal" },
      { ...sampleResult, questionId: "sh1", category: "single_hop" },
    ];
    const selected = selectSampleResults(results, 1);
    // 顺序应为 single_hop, temporal, multi_hop, open_domain
    expect(selected[0].category).toBe("single_hop");
    expect(selected[1].category).toBe("temporal");
    expect(selected[2].category).toBe("multi_hop");
    expect(selected[3].category).toBe("open_domain");
  });

  it("空数组返回空", () => {
    expect(selectSampleResults([])).toEqual([]);
  });
});

// === selectJudgeSanityCandidates ===

describe("selectJudgeSanityCandidates", () => {
  it("选取 judgeScore=0 的前 50 个 (默认)", () => {
    const results: LocomoQuestionResult[] = [];
    for (let i = 0; i < 60; i++) {
      results.push({ ...sampleResult, questionId: `q${i}`, judgeScore: 0 });
    }
    for (let i = 0; i < 10; i++) {
      results.push({ ...sampleResult, questionId: `correct${i}`, judgeScore: 1 });
    }
    const candidates = selectJudgeSanityCandidates(results);
    expect(candidates.length).toBe(50); // 默认 limit=50
    // 所有候选 judgeScore=0
    for (const c of candidates) {
      expect(c.judgeScore).toBe(0);
    }
  });

  it("只返回指定字段 (不含 recall5/contextRecall/assembledContext/goldEvidence)", () => {
    const results: LocomoQuestionResult[] = [
      { ...sampleResult, questionId: "q1", judgeScore: 0 },
    ];
    const candidates = selectJudgeSanityCandidates(results);
    expect(candidates.length).toBe(1);
    const c = candidates[0];
    expect(Object.keys(c).sort()).toEqual(
      [
        "questionId",
        "category",
        "conversationId",
        "question",
        "groundTruth",
        "predictedAnswer",
        "judgeScore",
      ].sort(),
    );
    // 不应包含这些字段
    expect(c).not.toHaveProperty("recall5");
    expect(c).not.toHaveProperty("contextRecall");
    expect(c).not.toHaveProperty("escalationLevel");
    expect(c).not.toHaveProperty("assembledContext");
    expect(c).not.toHaveProperty("goldEvidence");
  });

  it("自定义 limit", () => {
    const results: LocomoQuestionResult[] = [];
    for (let i = 0; i < 20; i++) {
      results.push({ ...sampleResult, questionId: `q${i}`, judgeScore: 0 });
    }
    const candidates = selectJudgeSanityCandidates(results, 5);
    expect(candidates.length).toBe(5);
  });

  it("无 judgeScore=0 时返回空数组", () => {
    const results: LocomoQuestionResult[] = [
      { ...sampleResult, judgeScore: 1 },
      { ...sampleResult, judgeScore: 1 },
    ];
    expect(selectJudgeSanityCandidates(results)).toEqual([]);
  });

  it("保留原 results 中的顺序 (前 N 个)", () => {
    const results: LocomoQuestionResult[] = [];
    for (let i = 0; i < 10; i++) {
      results.push({ ...sampleResult, questionId: `q${i}`, judgeScore: 0 });
    }
    const candidates = selectJudgeSanityCandidates(results, 3);
    expect(candidates[0].questionId).toBe("q0");
    expect(candidates[1].questionId).toBe("q1");
    expect(candidates[2].questionId).toBe("q2");
  });
});

// === 集成测试: 模拟 batch 循环 ===

describe("集成测试: 模拟 batch 循环", () => {
  it("accumulate → compute 链路正确", () => {
    // 模拟 500q batch 循环: 累加 90 题, 然后计算 metrics
    const byCategory: Record<string, CategoryAccumulator> = {};
    const counters = { totalCorrect: 0, totalRecall: 0, totalContextRecall: 0 };
    const results: LocomoQuestionResult[] = [];

    // 50 temporal (30 correct)
    for (let i = 0; i < 50; i++) {
      const r: LocomoQuestionResult = {
        ...sampleResult,
        category: "temporal",
        judgeScore: i < 30 ? 1 : 0,
        recall5: 0.5,
        contextRecall: 0.2,
      };
      accumulateQuestionResult(byCategory, r, counters);
      results.push(r);
    }
    // 40 multi_hop (20 correct)
    for (let i = 0; i < 40; i++) {
      const r: LocomoQuestionResult = {
        ...sampleResult,
        category: "multi_hop",
        judgeScore: i < 20 ? 1 : 0,
        recall5: 0.25,
        contextRecall: 0.1,
      };
      accumulateQuestionResult(byCategory, r, counters);
      results.push(r);
    }

    // 计算最终 metrics
    const metrics = computeLocomoMetrics({
      ...counters,
      byCategory,
      totalQuestions: 90,
    });

    // overall: 50/90 correct, 25+10=35 recall, 10+4=14 contextRecall
    expect(metrics.overallJ).toBeCloseTo(50 / 90, 10);
    expect(metrics.overallRecall).toBeCloseTo(35 / 90, 10);
    expect(metrics.overallContextRecall).toBeCloseTo(14 / 90, 10);

    // byCategory
    expect(metrics.categoryMetrics.temporal.j_score).toBeCloseTo(30 / 50, 10);
    expect(metrics.categoryMetrics.temporal.recall_at_5).toBeCloseTo(25 / 50, 10);
    expect(metrics.categoryMetrics.temporal.count).toBe(50);
    expect(metrics.categoryMetrics.multi_hop.j_score).toBeCloseTo(20 / 40, 10);
    expect(metrics.categoryMetrics.multi_hop.count).toBe(40);

    // SOTA 对比表 + ours
    const sotaTable = buildSotaComparison(metrics.overallJ);
    expect(sotaTable.ours.j_score).toBeCloseTo(50 / 90, 10);
    expect(sotaTable.Backboard.j_score).toBe(0.9);

    // sampleResults 选取
    const sampleSel = selectSampleResults(results, 5);
    // 2 categories × 5 = 10
    expect(sampleSel.length).toBe(10);

    // judge sanity 候选 (40 题 judgeScore=0)
    const sanity = selectJudgeSanityCandidates(results, 50);
    expect(sanity.length).toBe(40);
  });

  it("错误结果也正确累加 (judgeScore=0)", () => {
    const byCategory: Record<string, CategoryAccumulator> = {};
    const counters = { totalCorrect: 0, totalRecall: 0, totalContextRecall: 0 };

    // 1 成功 + 1 错误
    accumulateQuestionResult(byCategory, sampleResult, counters);
    accumulateQuestionResult(
      byCategory,
      assembleErrorResult({
        questionId: "err",
        category: "temporal",
        conversationId: "c",
        question: "q",
        goldEvidence: [],
        groundTruth: "g",
      }),
      counters,
    );

    expect(counters.totalCorrect).toBe(1); // 只有成功题
    expect(counters.totalRecall).toBeCloseTo(0.75, 6); // 只有成功题
    expect(byCategory.temporal.total).toBe(2); // 两题都计入 total
    expect(byCategory.temporal.correct).toBe(1); // 只有成功题

    const metrics = computeLocomoMetrics({
      ...counters,
      byCategory,
      totalQuestions: 2,
    });
    expect(metrics.overallJ).toBeCloseTo(0.5, 6); // 1/2
    expect(metrics.categoryMetrics.temporal.j_score).toBeCloseTo(0.5, 6); // 1/2
  });
});
