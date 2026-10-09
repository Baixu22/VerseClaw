import { FROZEN_JUDGE_CONFIG, FROZEN_JUDGE_INTERPRETATION } from "./runtime-memory-judge-freeze";

// WP-E2: Pipeline 阶段拆分 — 共享 helper 函数 + 类型定义.
//
// Source: 500q 评测代码优化 (WP-E2)
//
// 设计目标:
//   - 提取 cached/fresh 两条路径共用的纯函数 (降低重复, 提升可维护性)
//   - 类型化 processQuestion 的返回结构 (LocomoQuestionResult)
//   - 纯函数化 metrics 聚合 (computeLocomoMetrics)
//   - 常量化 SOTA 对比表 (SOTA_COMPARISON)
//
// 范围说明:
//   本文件只提取 **低风险纯函数**, 不修改 runtime-memory-locomo-full-500.test.ts 的
//   cached/fresh 镜像结构. 镜像合并 (cached path line 2160-2626 vs fresh path
//   line 2628-3475 ~1300 行) 需 A/B 验证, 留待后续 session.
//
// 约束:
//   - 所有函数必须为纯函数或仅依赖显式参数 (无闭包状态)
//   - 不引入新依赖
//   - 严格保持结果不变 (默认配置下 LLM 调用/report 字段完全一致)

// === Types ===

/**
 * 单题评测结果 (processQuestion 的返回结构).
 *
 * cached path (line 2612-2625) 和 fresh path (line 3460-3473) 都返回此结构.
 * 错误路径用 assembleErrorResult() 构造, 字段值固定为 0 / "[ERROR]" / "".
 */
export type LocomoQuestionResult = {
  questionId: string;
  category: string;
  conversationId: string;
  question: string;
  goldEvidence: string[];
  recall5: number;
  contextRecall: number;
  judgeScore: number;
  escalationLevel: number;
  predictedAnswer: string;
  groundTruth: string;
  assembledContext: string;
};

/**
 * byCategory 累加器 (运行时状态, 非 report 字段).
 *
 * 在 batch 循环中逐题累加, 最终传给 computeLocomoMetrics() 计算 categoryMetrics.
 */
export type CategoryAccumulator = {
  correct: number;
  total: number;
  recallSum: number;
  contextRecallSum: number;
};

/**
 * computeLocomoMetrics 的输入 — batch 循环结束后的运行时累加值.
 */
export type LocomoRunAccumulators = {
  totalCorrect: number;
  totalRecall: number;
  totalContextRecall: number;
  byCategory: Record<string, CategoryAccumulator>;
  totalQuestions: number;
};

/**
 * computeLocomoMetrics 的输出 — 可直接嵌入 report.metrics.
 */
export type LocomoComputedMetrics = {
  overallJ: number;
  overallRecall: number;
  overallContextRecall: number;
  categoryMetrics: Record<
    string,
    { j_score: number; recall_at_5: number; context_recall: number; count: number }
  >;
};

// === Result assembly ===

/**
 * 构造单题成功结果.
 *
 * 替代 cached path (line 2612-2625) 和 fresh path 中的重复对象字面量.
 * 所有字段显式传入, 无默认值, 确保调用方明确每个字段的来源.
 */
export function assembleQuestionResult(args: {
  questionId: string;
  category: string;
  conversationId: string;
  question: string;
  goldEvidence: string[];
  recall5: number;
  contextRecall: number;
  judgeScore: number;
  escalationLevel: number;
  predictedAnswer: string;
  groundTruth: string;
  assembledContext: string;
}): LocomoQuestionResult {
  return {
    questionId: args.questionId,
    category: args.category,
    conversationId: args.conversationId,
    question: args.question,
    goldEvidence: args.goldEvidence,
    recall5: args.recall5,
    contextRecall: args.contextRecall,
    judgeScore: args.judgeScore,
    escalationLevel: args.escalationLevel,
    predictedAnswer: args.predictedAnswer,
    groundTruth: args.groundTruth,
    assembledContext: args.assembledContext,
  };
}

/**
 * 构造单题错误结果 (try/catch 兜底).
 *
 * 替代 fresh path line 3460-3473 的错误返回对象.
 * recall5/contextRecall/judgeScore/escalationLevel 固定为 0,
 * predictedAnswer 固定为 "[ERROR]", assembledContext 固定为 "".
 */
export function assembleErrorResult(args: {
  questionId: string;
  category: string;
  conversationId: string;
  question: string;
  goldEvidence: string[];
  groundTruth: string;
}): LocomoQuestionResult {
  return {
    questionId: args.questionId,
    category: args.category,
    conversationId: args.conversationId,
    question: args.question,
    goldEvidence: args.goldEvidence,
    recall5: 0,
    contextRecall: 0,
    judgeScore: 0,
    escalationLevel: 0,
    predictedAnswer: "[ERROR]",
    groundTruth: args.groundTruth,
    assembledContext: "",
  };
}

// === Metrics aggregation ===

/**
 * 从 batch 循环累加值计算最终 metrics.
 *
 * 替代 500q 文件 line 3516-3533 的内联计算.
 * 纯函数, 不依赖外部状态.
 *
 * @param acc batch 循环结束后的累加值
 * @returns overall J/Recall/ContextRecall + byCategory metrics (可直接嵌入 report)
 */
export function computeLocomoMetrics(acc: LocomoRunAccumulators): LocomoComputedMetrics {
  const { totalCorrect, totalRecall, totalContextRecall, byCategory, totalQuestions } = acc;

  // 与原代码一致: 除以 totalQuestions (若 totalQuestions=0 则 NaN, 与原行为一致)
  const overallJ = totalCorrect / totalQuestions;
  const overallRecall = totalRecall / totalQuestions;
  const overallContextRecall = totalContextRecall / totalQuestions;

  const categoryMetrics: Record<
    string,
    { j_score: number; recall_at_5: number; context_recall: number; count: number }
  > = {};
  for (const [cat, m] of Object.entries(byCategory)) {
    categoryMetrics[cat] = {
      j_score: m.correct / m.total,
      recall_at_5: m.recallSum / m.total,
      context_recall: m.contextRecallSum / m.total,
      count: m.total,
    };
  }

  return {
    overallJ,
    overallRecall,
    overallContextRecall,
    categoryMetrics,
  };
}

/**
 * 累加单题结果到 byCategory 累加器.
 *
 * 替代 batch 循环中 line 3483-3498 的内联累加逻辑.
 * 纯函数 (mutates the provided accumulator object in-place, 与原代码一致).
 */
export function accumulateQuestionResult(
  byCategory: Record<string, CategoryAccumulator>,
  result: LocomoQuestionResult,
  counters: { totalCorrect: number; totalRecall: number; totalContextRecall: number },
): void {
  counters.totalCorrect += result.judgeScore;
  counters.totalRecall += result.recall5;
  counters.totalContextRecall += result.contextRecall;
  if (!byCategory[result.category]) {
    byCategory[result.category] = {
      correct: 0,
      total: 0,
      recallSum: 0,
      contextRecallSum: 0,
    };
  }
  byCategory[result.category].correct += result.judgeScore;
  byCategory[result.category].total += 1;
  byCategory[result.category].recallSum += result.recall5;
  byCategory[result.category].contextRecallSum += result.contextRecall;
}

// === SOTA comparison (constant) ===

/**
 * External reported reference scores only (Hindsight paper Table 4, arXiv:2512.12818).
 * Different/unknown judge protocols: these values do not establish a ranking.
 *
 * 替代 500q 文件 line 3625-3638 的硬编码字面量.
 * `ours` 字段需运行时填入 overallJ.
 */
export const SOTA_COMPARISON: Record<string, { j_score: number }> = {
  Backboard: { j_score: 0.9 },
  Hindsight_Gemini3: { j_score: 0.8961 },
  Hindsight_OSS120B: { j_score: 0.8567 },
  Hindsight_OSS20B: { j_score: 0.8318 },
  Memobase: { j_score: 0.7578 },
  Zep: { j_score: 0.7514 },
  Mem0_Graph: { j_score: 0.6844 },
  Mem0: { j_score: 0.6688 },
  LangMem: { j_score: 0.581 },
  OpenAI_no_memory: { j_score: 0.529 },
};

/**
 * 构建 SOTA 对比表 (含 ours 字段).
 *
 * @param overallJ 当前 run 的 overall J Score
 * @returns 完整对比表, 可直接嵌入 report.comparison
 */
export function buildSotaComparison(overallJ: number) {
  return {
    judgeComparable: false,
    rankingAllowed: false,
    note: "External paper scores use different or unknown judges, datasets and pipelines; they are reference values only, not a ranking against this run.",
    source: "Hindsight paper Table 4, arXiv:2512.12818 (externally reported; not reproduced here)",
    references: SOTA_COMPARISON,
    ours: {
      j_score: overallJ,
      judgeConfig: FROZEN_JUDGE_CONFIG,
      interpretation: FROZEN_JUDGE_INTERPRETATION,
    },
  };
}

// === Progress logging ===

/**
 * 格式化进度日志行.
 *
 * 替代 500q 文件 line 3503-3510 的内联 console.log.
 * 纯函数, 返回格式化字符串, 由调用方决定是否打印.
 *
 * @param completed 已完成题数
 * @param total 总题数
 * @param totalCorrect 累计正确数
 * @param totalRecall 累计 recall5
 * @param totalContextRecall 累计 context_recall
 * @returns 格式化日志行 (例如 "[LoCoMo-Full] Progress: 50/500 | J=72.0% | Recall@5=49.8% | ContextRecall=0.8%")
 */
export function formatProgressLog(args: {
  completed: number;
  total: number;
  totalCorrect: number;
  totalRecall: number;
  totalContextRecall: number;
}): string {
  const { completed, total, totalCorrect, totalRecall, totalContextRecall } = args;
  const runningJ = ((totalCorrect / completed) * 100).toFixed(1);
  const recall5Pct = ((totalRecall / completed) * 100).toFixed(1);
  const contextRecallPct = ((totalContextRecall / completed) * 100).toFixed(1);
  return (
    `[LoCoMo-Full] Progress: ${completed}/${total} | J=${runningJ}% | ` +
    `Recall@5=${recall5Pct}% | ContextRecall=${contextRecallPct}%`
  );
}

/**
 * 判断当前进度是否应该打印日志.
 *
 * 替代 500q 文件 line 3503 的条件判断.
 * 每 10 题、最后一题、前 10 题打印.
 */
export function shouldLogProgress(completed: number, total: number): boolean {
  return completed % 10 === 0 || completed === total || completed < 10;
}

// === Sample results selection (for report.sampleResults) ===

/**
 * 从 results 中按 category 选取前 N 个作为 report.sampleResults.
 *
 * 替代 500q 文件 line 3639-3644 的内联 filter+slice.
 * 默认每 category 取 5 个, 与原代码一致.
 */
export function selectSampleResults(
  results: readonly LocomoQuestionResult[],
  perCategory: number = 5,
): LocomoQuestionResult[] {
  const categories: readonly string[] = ["single_hop", "temporal", "multi_hop", "open_domain"];
  const out: LocomoQuestionResult[] = [];
  for (const cat of categories) {
    out.push(...results.filter((r) => r.category === cat).slice(0, perCategory));
  }
  return out;
}

/**
 * 选取 judge sanity 候选 (judgeScore=0 的前 N 个).
 *
 * 替代 500q 文件 line 3645-3656 的内联 filter+slice+map.
 * 默认取前 50 个, 与原代码一致.
 */
export function selectJudgeSanityCandidates(
  results: readonly LocomoQuestionResult[],
  limit: number = 50,
): Array<{
  questionId: string;
  category: string;
  conversationId: string;
  question: string;
  groundTruth: string;
  predictedAnswer: string;
  judgeScore: number;
}> {
  return results
    .filter((r) => r.judgeScore === 0)
    .slice(0, limit)
    .map((r) => ({
      questionId: r.questionId,
      category: r.category,
      conversationId: r.conversationId,
      question: r.question,
      groundTruth: r.groundTruth,
      predictedAnswer: r.predictedAnswer,
      judgeScore: r.judgeScore,
    }));
}
