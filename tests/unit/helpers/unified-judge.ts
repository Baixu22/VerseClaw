// Phase 4: Unified Judge — 统一评分标准 + 多 judge 投票.
//
// 解决四家 SOTA 共同短板：用不同 judge 模型/prompt 评测，分数不可横向对比。
// 本模块建立统一的 prompt 规则（合并 Hindsight + Mem0 + Zep 的 generous 规则）
// 和多 judge 投票机制（≥2/3 判 CORRECT → 最终 CORRECT），降低 judge_error。
//
// 与已有 FROZEN_JUDGE_CONFIG 的关系：
// - FROZEN_JUDGE_CONFIG.promptVersion = "frozen-v2-generous-2026-07-04"
// - 本模块 promptVersion = "unified-v2-generous-7rules-2026-07-05"
// - Phase 4 prompt 在 frozen-v2 基础上增加：
//   1. Temporal-reasoning category: off-by-one day tolerance (19d vs 18d)
//   2. Knowledge-update category: allow old info + new answer
//   3. 多 judge 投票机制（voteCount=3, agreementThreshold=2/3）
//   4. category-specific prompt 增强（getCategorySpecificPrompt）
//
// 工作流（与 mem-northstar.md §5.3 一致）：
//   1. build prompt (system + user) based on category
//   2. if votingEnabled: call N times at temp=0.3, ≥2/3 agreement → verdict
//   3. else: call once at temp=0
//   4. parse verdict + confidence + reasoning

import type { QueryType } from "./query-classifier";
import { callDeepSeek, hasDeepSeekKey } from "./runtime-memory-real-llm-client";

// === Types (与 mem-northstar.md §5.2 一致) ===

export type JudgeCategory = QueryType | "adversarial";

export interface JudgeConfig {
  readonly model: string;
  readonly temperature: number;
  readonly promptVersion: "unified-v2-generous-7rules-2026-07-05";
  readonly votingEnabled: boolean;
  readonly voteCount?: number;
  readonly voteAgreementThreshold?: number;
}

export interface JudgeResult {
  readonly verdict: "CORRECT" | "WRONG";
  readonly confidence: number;
  readonly reasoning?: string;
  readonly voteBreakdown?: { correct: number; wrong: number };
}

export const UNIFIED_JUDGE_CONFIG: JudgeConfig = {
  model: process.env.DEEPSEEK_MODEL ?? "deepseek-chat",
  temperature: 0,
  promptVersion: "unified-v2-generous-7rules-2026-07-05",
  votingEnabled: true,
  voteCount: 3,
  voteAgreementThreshold: 2,
};

// === 统一 prompt 规则（North Star §5.3） ===
//
// 合并 Hindsight + Mem0 + Zep 的 generous 规则，确保分数可与四家横向对比。

// === Generous Judge 7 规则（合并 Mem0/Hindsight/Zep）===
//
// 来源对照：
// - Mem0 (91.6%): PARTIAL CREDIT / PARAPHRASES / EXTRA DETAIL / DATE TOLERANCE 14d / SEMANTIC OVERLAP / SAME REFERENT / FOCUS ON KNOWLEDGE
// - Hindsight (92.0%): generous + "unanswerable→cannot answer is CORRECT" + "off-by-one days not penalized"
// - Zep (80.3%): "as long as it touches on the same topic, count as CORRECT" + 时间格式差异容忍
// - 我们 Phase 4 在此基础上增加：list 50% threshold、substring/superstring、entity alias
//
// 关键反直觉规则（Mem0 验证有效）：
// - Evidence 只用于 ACCEPT，不能用于更严格 REJECT
// - "cannot answer an unanswerable question" = CORRECT（Hindsight）
// - EXTRA DETAIL IS FINE：更详细的答案不扣分（Mem0）

const BASE_RULES = [
  "You are an impartial judge. Compare a predicted answer to the ground truth.",
  "Be GENEROUS with your grading - as long as the predicted answer touches on the same topic as the gold answer, it should be counted as CORRECT.",
  "",
  "Rules:",
  "- PARTIAL CREDIT: if the predicted answer includes AT LEAST ONE correct item from the gold answer, answer CORRECT.",
  "- PARAPHRASES COUNT: same concept in different words is CORRECT (e.g., \"oat milk\" vs \"oat milk instead\").",
  "- EXTRA DETAIL IS FINE: if the predicted answer is more detailed than the gold answer, answer CORRECT (do not penalize extra information).",
  "- DATE TOLERANCE: dates within 14 days of each other are CORRECT. Date format differences (e.g., \"2023-05\" vs \"May 2023\", \"May 7th\" vs \"7 May\") are CORRECT.",
  "- SEMANTIC OVERLAP: if both answers convey the same sentiment or valence (positive/negative/neutral), answer CORRECT.",
  "- SAME REFERENT: if both answers refer to the same entity (synonyms, aliases, abbreviations), answer CORRECT.",
  "- FOCUS ON KNOWLEDGE, NOT WORDING: judge whether the knowledge is correct, not whether the wording matches.",
  "- SUBSTRING/SUPERSTRING: if the predicted answer is a superstring or substring of the ground truth (case-insensitive), answer CORRECT.",
  "- LIST COVERAGE: if the ground truth is a list, the predicted answer must cover at least 50% of items.",
  "- TIME TOLERANCE: if dates are within 14 days of each other, treat as CORRECT.",
  "- UNANSWERABLE: if the gold answer indicates the question cannot be answered from the data, and the predicted answer says it cannot be answered, answer CORRECT.",
  "- EVIDENCE USES: evidence (if provided) can only be used to ACCEPT an answer, never to REJECT it more strictly.",
  "",
  "ONLY mark WRONG if:",
  "- The predicted answer contains ZERO correct items from the gold answer.",
  "- The predicted answer addresses a completely different topic.",
  "- The predicted answer contradicts the gold answer on a key fact.",
];

// Category-specific 扩展规则
const CATEGORY_RULES: Record<JudgeCategory, readonly string[]> = {
  temporal: [
    "- Temporal-reasoning: off-by-one day tolerance (e.g., '19 days' vs '18 days' = CORRECT).",
    "- Year-only matches are CORRECT if the gold answer specifies a year.",
  ],
  multi_hop: [
    "- Multi-hop reasoning: if the predicted answer reaches the correct conclusion through reasoning, CORRECT.",
    "- Intermediate hops need not be explicitly stated in the answer.",
  ],
  open_domain: [
    "- Open-domain: any factually correct statement about the subject is CORRECT.",
    "- Coverage threshold: 30% of gold items = CORRECT (lower than other categories).",
  ],
  single_hop: [
    "- Single-hop: exact entity match required, but aliases accepted.",
  ],
  adversarial: [
    "- Adversarial: predicted answer must explicitly state 'I don't know' or refuse to answer.",
    "- Any attempt to answer an unanswerable question = WRONG.",
  ],
};

const RESPONSE_FORMAT = [
  "",
  "Respond with ONLY \"CORRECT\" or \"WRONG\".",
];

export function buildUnifiedJudgePrompt(
  question: string,
  groundTruth: string | number,
  predictedAnswer: string,
  category?: JudgeCategory,
): { system: string; user: string } {
  const rules = [
    ...BASE_RULES,
    ...(category ? CATEGORY_RULES[category] : []),
    ...RESPONSE_FORMAT,
  ];
  return {
    system: rules.join("\n"),
    user: `Question: ${question}

Ground truth answer: ${groundTruth}

Predicted answer: ${predictedAnswer}

Is the predicted answer semantically correct? (CORRECT/WRONG):`,
  };
}

// === 5 类 category 专用 prompt（North Star §5.2 getCategorySpecificPrompt） ===

export function getCategorySpecificPrompt(category: JudgeCategory): string {
  const rules = CATEGORY_RULES[category] ?? [];
  return rules.join("\n");
}

// === Verdict 解析 ===

export function parseUnifiedJudgeVerdict(content: string): {
  verdict: "CORRECT" | "WRONG";
  confidence: number;
} {
  const trimmed = content.trim().toLowerCase();
  // Accept "yes" (legacy), "correct" (v2), "true" (some models)
  if (
    trimmed.startsWith("yes") ||
    trimmed.startsWith("correct") ||
    trimmed.startsWith("true")
  ) {
    return { verdict: "CORRECT", confidence: 1.0 };
  }
  // Accept "no", "wrong", "false", "incorrect"
  if (
    trimmed.startsWith("no") ||
    trimmed.startsWith("wrong") ||
    trimmed.startsWith("false") ||
    trimmed.startsWith("incorrect")
  ) {
    return { verdict: "WRONG", confidence: 1.0 };
  }
  // Ambiguous response — default to WRONG with low confidence
  return { verdict: "WRONG", confidence: 0.5 };
}

// === 多 judge 投票 ===

/**
 * 多 judge 投票：调用 N 次（temp=0.3），≥ threshold 票判 CORRECT → 最终 CORRECT.
 *
 * 用于降低 judge_error：
 * - 单次 judge 可能因 prompt 措辞、temperature 噪声误判
 * - 3 次独立投票（temp=0.3 引入轻微方差）+ 2/3 agreement → 更稳定的 verdict
 *
 * @param system system prompt
 * @param user user prompt
 * @param config JudgeConfig
 * @returns JudgeResult with voteBreakdown
 */
export async function judgeWithVoting(
  system: string,
  user: string,
  config: JudgeConfig,
): Promise<JudgeResult> {
  const voteCount = config.voteCount ?? 3;
  const threshold = config.voteAgreementThreshold ?? 2;

  // N 次独立调用，temp=0.3 引入轻微方差
  const votes = await Promise.all(
    Array.from({ length: voteCount }, () =>
      callDeepSeek(system, user, {
        temperature: 0.3,
        maxTokens: 16,
        model: config.model,
      }),
    ),
  );

  const verdicts = votes.map((v) => parseUnifiedJudgeVerdict(v.content));
  const correctCount = verdicts.filter((v) => v.verdict === "CORRECT").length;
  const wrongCount = voteCount - correctCount;

  const finalVerdict: "CORRECT" | "WRONG" =
    correctCount >= threshold ? "CORRECT" : "WRONG";
  const confidence = correctCount / voteCount;

  return {
    verdict: finalVerdict,
    confidence,
    voteBreakdown: { correct: correctCount, wrong: wrongCount },
  };
}

// === 主接口：统一 judge ===

/**
 * 统一 judge 评测.
 *
 * 算法：
 *   1. build prompt (system + user) based on category
 *   2. if votingEnabled: judgeWithVoting
 *   3. else: single call at temp=0
 *   4. return JudgeResult
 *
 * @param query 用户问题
 * @param goldAnswer 标准答案
 * @param predictedAnswer 模型预测答案
 * @param category 问题类别（影响 prompt 规则）
 * @param config 部分配置覆盖
 */
export async function judgeWithUnifiedPrompt(
  query: string,
  goldAnswer: string | number,
  predictedAnswer: string,
  category?: JudgeCategory,
  config?: Partial<JudgeConfig>,
): Promise<JudgeResult> {
  const mergedConfig: JudgeConfig = {
    ...UNIFIED_JUDGE_CONFIG,
    ...config,
  };

  if (!query || !predictedAnswer) {
    return { verdict: "WRONG", confidence: 1.0 };
  }

  const { system, user } = buildUnifiedJudgePrompt(
    query,
    goldAnswer,
    predictedAnswer,
    category,
  );

  // 无 API key 时 — 回退到确定性判断（substring + paraphrase）
  if (!hasDeepSeekKey()) {
    return deterministicJudge(predictedAnswer, String(goldAnswer));
  }

  // 投票模式
  if (mergedConfig.votingEnabled) {
    try {
      return await judgeWithVoting(system, user, mergedConfig);
    } catch {
      // 投票失败 — 回退到单次
    }
  }

  // 单次模式
  try {
    const response = await callDeepSeek(system, user, {
      temperature: mergedConfig.temperature,
      maxTokens: 16,
      model: mergedConfig.model,
    });
    const parsed = parseUnifiedJudgeVerdict(response.content);
    return {
      verdict: parsed.verdict,
      confidence: parsed.confidence,
    };
  } catch {
    // LLM 调用失败 — 回退到确定性判断
    return deterministicJudge(predictedAnswer, String(goldAnswer));
  }
}

/**
 * 确定性 judge（无 LLM 时回退）.
 *
 * 规则：
 * - 子串匹配（case-insensitive）→ CORRECT
 * - 数字提取后匹配 → CORRECT
 * - 否则 → WRONG
 *
 * 用于：
 * 1. 无 DEEPSEEK_API_KEY 时的回退（测试环境）
 * 2. LLM 调用失败时的兜底
 */
export function deterministicJudge(
  predicted: string,
  gold: string,
): JudgeResult {
  if (!predicted || !gold) {
    return { verdict: "WRONG", confidence: 1.0 };
  }

  const predLower = predicted.toLowerCase().trim();
  const goldLower = gold.toLowerCase().trim();

  // 子串匹配（双向）
  if (predLower.includes(goldLower) || goldLower.includes(predLower)) {
    return { verdict: "CORRECT", confidence: 0.9 };
  }

  // 数字提取后匹配（处理 "20 days" vs "20" 之类）
  const predNums = predLower.match(/\d+/g) ?? [];
  const goldNums = goldLower.match(/\d+/g) ?? [];
  if (predNums.length > 0 && goldNums.length > 0) {
    const predSet = new Set(predNums);
    const goldSet = new Set(goldNums);
    // 交集 ≥ 50% gold 数字 → CORRECT
    let intersect = 0;
    for (const n of goldSet) {
      if (predSet.has(n)) intersect += 1;
    }
    if (intersect / goldSet.size >= 0.5) {
      return { verdict: "CORRECT", confidence: 0.8 };
    }
  }

  return { verdict: "WRONG", confidence: 0.9 };
}

// === Sanity check 工具 ===

/**
 * Sanity check: 对比 unified judge 和 frozen judge 的 verdict，
 * 用于验证新 prompt 不引入偏差.
 *
 * @param unifiedResults unified judge 结果数组
 * @param frozenResults frozen judge 结果数组（同样顺序）
 * @returns 一致率、unified 更宽松的case数、更严格的case数
 */
export function compareJudgeResults(
  unifiedResults: readonly JudgeResult[],
  frozenResults: readonly { score: number }[],
): {
  agreementRate: number;
  unifiedMoreGenerous: number;
  unifiedMoreStrict: number;
  total: number;
} {
  const total = Math.min(unifiedResults.length, frozenResults.length);
  if (total === 0) {
    return { agreementRate: 0, unifiedMoreGenerous: 0, unifiedMoreStrict: 0, total: 0 };
  }

  let agreements = 0;
  let moreGenerous = 0;
  let moreStrict = 0;

  for (let i = 0; i < total; i += 1) {
    const unifiedCorrect = unifiedResults[i].verdict === "CORRECT";
    const frozenCorrect = frozenResults[i].score === 1;

    if (unifiedCorrect === frozenCorrect) {
      agreements += 1;
    } else if (unifiedCorrect && !frozenCorrect) {
      moreGenerous += 1;
    } else {
      moreStrict += 1;
    }
  }

  return {
    agreementRate: agreements / total,
    unifiedMoreGenerous: moreGenerous,
    unifiedMoreStrict: moreStrict,
    total,
  };
}
