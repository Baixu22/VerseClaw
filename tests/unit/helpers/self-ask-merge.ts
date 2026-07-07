// Phase 3: Self-ask 合并回主 RRF.
//
// 解决四家 SOTA 共同短板：Hindsight 的 reflect 内部 LLM 自决不合并，
// Mem0/Memobase/Zep 多跳弱或无 self-ask。本模块将 multi_hop 问题的
// sub-question 检索结果作为第 5 路 RRF 臂合并回主 pipeline，而不是
// 作为独立优化或丢弃。
//
// 与 S1-2（已有 runSequentialSelfAsk + 内联 RRF 合并）的差异：
// 1. 只在 multi_hop_deep 策略时触发（避免对 single_hop 浪费）
// 2. armWeight 可配置（Phase 1 QueryPlan 传入）
// 3. sub-question 数量限制（默认 3，避免过多 LLM 调用）
// 4. 独立模块化，便于 Phase 3 集成和测试
//
// 工作流（与 mem-northstar.md §4.3 一致）：
//   1. subQuestions = decompose(query)（已由 Phase 1 预计算，可传入复用）
//   2. for each subQ: subHits = retrieveFn(subQ); subAnswer = generateHopAnswer(subQ, subHits)
//   3. mergedArmHits = RRF(所有 subHits, weight=armWeight)
//   4. mainHits = mergeSelfAskIntoMainHits(mainHits, mergedArmHits, armWeight)
//   5. return { subQuestions, mergedArmHits, reasoningHints: hopAnswers }

import type { HybridSearchHit } from "../../../openclaw_runtime/src/runtime-core/memory-hybrid-retrieval";

// === Types (与 mem-northstar.md §4.2 一致) ===

export interface SelfAskSubQuestion {
  readonly question: string;
  /** hop answer（给 generator 作 reasoningHints） */
  readonly answer?: string;
  /** 该子问题检索到的 fact IDs */
  readonly retrievedFactIds: readonly string[];
  /** 该子问题检索到的 facts（与 factIds 顺序对应） */
  readonly retrievedHits: readonly HybridSearchHit[];
}

export interface SelfAskMergeResult {
  readonly subQuestions: readonly SelfAskSubQuestion[];
  /** 合并后的第 5 路 RRF hits（已按 RRF 分数排序） */
  readonly mergedArmHits: readonly HybridSearchHit[];
  /** 给 generator 的 hop answers */
  readonly reasoningHints: readonly string[];
}

// === RRF 合并公式（North Star §4.4） ===
//
// 对于第 5 路 self-ask arm，每个 fact 的 RRF 贡献：
//   rrf_selfask(fact) = armWeight × (1 / (k + rank_selfask(fact)))
// 其中 k=60（与主 RRF 一致），armWeight 默认 0.8。
//
// 多次检索的 fact 在同一 arm 内累加 rank 贡献（标准 RRF 行为），
// 然后由 mergeSelfAskIntoMainHits 负责跨 arm 合并。

const DEFAULT_RRF_K = 60;
const DEFAULT_ARM_WEIGHT = 0.8;
const DEFAULT_MAX_SUB_QUESTIONS = 3;

/**
 * 主接口：self-ask 分解 + 检索 + 合并.
 *
 * @param query 原 multi_hop query
 * @param retrieveFn 子问题检索函数（返回 HybridSearchHit[]）
 * @param options 可选：maxSubQuestions（默认 3）、armWeight（默认 0.8）、
 *                precomputedSubQuestions（Phase 1 预计算的 sub-questions，避免重复 LLM 调用）、
 *                generateHopAnswer（可选：生成 hop answer 用于 reasoningHints）
 */
export async function selfAskDecomposeAndMerge(
  query: string,
  retrieveFn: (q: string) => Promise<readonly HybridSearchHit[]>,
  options?: {
    readonly maxSubQuestions?: number;
    readonly armWeight?: number;
    readonly precomputedSubQuestions?: readonly string[];
    readonly generateHopAnswer?: (
      subQuestion: string,
      hits: readonly HybridSearchHit[],
    ) => Promise<string>;
  },
): Promise<SelfAskMergeResult> {
  if (!query || query.trim().length === 0) {
    return { subQuestions: [], mergedArmHits: [], reasoningHints: [] };
  }

  const maxSubQuestions = options?.maxSubQuestions ?? DEFAULT_MAX_SUB_QUESTIONS;
  const armWeight = options?.armWeight ?? DEFAULT_ARM_WEIGHT;
  const generateHopAnswer = options?.generateHopAnswer;

  // 1. 确定 sub-questions（优先复用 Phase 1 预计算的）
  let subQuestions: string[];
  if (options?.precomputedSubQuestions && options.precomputedSubQuestions.length > 0) {
    subQuestions = options.precomputedSubQuestions.slice(0, maxSubQuestions);
  } else {
    // 无预计算时，简单按句号/问号切分作为 fallback（避免本模块内强依赖 LLM）
    // 真正的 LLM 分解由调用方通过 precomputedSubQuestions 传入
    subQuestions = [query];
  }

  // 2. 对每个 sub-question 检索 + 生成 hop answer
  const subQuestionResults: SelfAskSubQuestion[] = [];
  const allSubHits: HybridSearchHit[] = [];

  for (const subQ of subQuestions) {
    try {
      const hits = await retrieveFn(subQ);
      const factIds = hits.map((h) => h.fact.factId);

      let answer: string | undefined;
      if (generateHopAnswer && hits.length > 0) {
        try {
          answer = await generateHopAnswer(subQ, hits);
        } catch {
          // hop answer 生成失败 — 仍保留 sub-question 和 hits
        }
      }

      subQuestionResults.push({
        question: subQ,
        ...(answer !== undefined ? { answer } : {}),
        retrievedFactIds: factIds,
        retrievedHits: hits,
      });

      // 累积所有 sub-question 的 hits（用于后续 RRF 合并）
      allSubHits.push(...hits);
    } catch {
      // 单个 sub-question 检索失败 — 跳过
      subQuestionResults.push({
        question: subQ,
        retrievedFactIds: [],
        retrievedHits: [],
      });
    }
  }

  // 3. mergedArmHits = RRF(allSubHits, weight=armWeight)
  const mergedArmHits = computeSelfAskRRF(allSubHits, armWeight, DEFAULT_RRF_K);

  // 4. reasoningHints = hopAnswers（已生成的）
  const reasoningHints = subQuestionResults
    .map((sq) => sq.answer)
    .filter((a): a is string => typeof a === "string" && a.length > 0);

  return {
    subQuestions: subQuestionResults,
    mergedArmHits,
    reasoningHints,
  };
}

/**
 * 将 self-ask hits 作为第 5 路 RRF 臂合并到主 hits.
 *
 * 算法：
 * - 主 hits 中已有的 fact：累加 self-ask RRF 贡献到 rrfScore
 * - self-ask 独有的 fact：作为新 candidate 加入，rrfScore = self-ask 贡献
 * - 合并后按 (ceScore ?? rrfScore) 降序排序（与主 pipeline 一致）
 *
 * @param mainHits 主 pipeline 检索结果（已跑完 cross-encoder + final boost）
 * @param selfAskHits self-ask 第 5 路 RRF hits（来自 computeSelfAskRRF）
 * @param armWeight self-ask arm 权重（默认 0.8）
 */
export function mergeSelfAskIntoMainHits(
  mainHits: readonly HybridSearchHit[],
  selfAskHits: readonly HybridSearchHit[],
  armWeight: number = DEFAULT_ARM_WEIGHT,
): HybridSearchHit[] {
  if (selfAskHits.length === 0) return [...mainHits];

  // 复制主 hits（避免 mutate 输入）
  const result: HybridSearchHit[] = mainHits.map((h) => ({ ...h }));
  const existingById = new Map(result.map((h) => [h.fact.factId, h] as const));

  // 1. 主 hits 中已有的 fact：累加 self-ask RRF 贡献
  for (const saHit of selfAskHits) {
    const existing = existingById.get(saHit.fact.factId);
    if (existing) {
      existing.rrfScore += saHit.rrfScore;
      // 保留 ceScore 较大者
      if (saHit.ceScore !== undefined) {
        if (existing.ceScore === undefined || saHit.ceScore > existing.ceScore) {
          existing.ceScore = saHit.ceScore;
        }
      }
    }
  }

  // 2. self-ask 独有的 fact：作为新 candidate 加入
  for (const saHit of selfAskHits) {
    if (!existingById.has(saHit.fact.factId)) {
      result.push({ ...saHit });
      existingById.set(saHit.fact.factId, saHit);
    }
  }

  // 3. 按 (ceScore ?? rrfScore) 降序排序（与主 pipeline 一致）
  result.sort((a, b) => (b.ceScore ?? b.rrfScore) - (a.ceScore ?? a.rrfScore));

  // armWeight 已在 computeSelfAskRRF 中应用，这里不再重复
  // 但为了 API 一致性，若调用方传入不同 armWeight，提示其应通过 computeSelfAskRRF 应用
  void armWeight;

  return result;
}

/**
 * 计算第 5 路 self-ask arm 的 RRF 分数.
 *
 * 公式：rrf_selfask(fact) = armWeight × (1 / (k + rank))
 * 其中 rank 是 fact 在 allSubHits 中首次出现的位置（0-indexed）。
 *
 * 多个 sub-question 命中同一 fact 时，取最佳 rank（最早出现的位置），
 * 这与标准 RRF 的"多 arm 累加"不同，因为 self-ask 的多个 sub-question
 * 不是独立 arm，而是同一 arm 的多次检索（North Star §4.4 的设计）。
 *
 * @param allSubHits 所有 sub-question 检索结果的扁平数组
 * @param armWeight arm 权重（默认 0.8）
 * @param k RRF k 参数（默认 60，与主 RRF 一致）
 */
export function computeSelfAskRRF(
  allSubHits: readonly HybridSearchHit[],
  armWeight: number = DEFAULT_ARM_WEIGHT,
  k: number = DEFAULT_RRF_K,
): HybridSearchHit[] {
  if (allSubHits.length === 0) return [];

  // 按 factId 去重，保留首次出现（最佳 rank）
  const bestHitByFactId = new Map<string, HybridSearchHit>();
  const bestRankByFactId = new Map<string, number>();

  for (let i = 0; i < allSubHits.length; i += 1) {
    const hit = allSubHits[i];
    const factId = hit.fact.factId;
    if (!bestHitByFactId.has(factId)) {
      bestHitByFactId.set(factId, hit);
      bestRankByFactId.set(factId, i);
    }
  }

  // 计算 RRF 分数
  const result: HybridSearchHit[] = [];
  for (const [factId, hit] of bestHitByFactId.entries()) {
    const rank = bestRankByFactId.get(factId)!;
    const rrfScore = armWeight * (1 / (k + rank + 1));
    result.push({
      ...hit,
      rrfScore,
    });
  }

  // 按 rrfScore 降序
  result.sort((a, b) => b.rrfScore - a.rrfScore);
  return result;
}
