// Phase 2: Retrieval Feedback Loop.
//
// 解决 Zep/Mem0/Memobase 共同短板：评估了 completeness 但不反馈到检索。
// 本模块在初始检索后用 `computeContextCompletenessDeterministic` 评估 context
// completeness，当 level != COMPLETE 时触发 query rewrite + 重检索，合并结果后
// 返回。这是与四家 SOTA 的根本差异之一。
//
// 工作流（与 mem-northstar.md §3.3 一致）：
//   1. initialResult = retrieveFn(query)
//   2. completeness = computeContextCompletenessDeterministic(context, goldEvidence)
//   3. if level == COMPLETE || iterations >= maxIterations: 返回
//   4. else: rewriteQuery → retrieveFn(rewritten) → merge → goto 2
//
// 复用已有组件：
// - computeContextCompletenessDeterministic (runtime-memory-context-completeness.ts)
// - callDeepSeek (runtime-memory-real-llm-client.ts) — 可选 LLM 重写
// - QueryPlan (query-classifier.ts) — 来自 Phase 1

import type { HybridSearchHit } from "../../../openclaw_runtime/src/runtime-core/memory-hybrid-retrieval";
import type { RuntimeMemoryQueryableFact } from "../../../openclaw_runtime/src/runtime-core/memory-context";
import type { EpisodicHit } from "./episodic-memory";
import type { QueryPlan } from "./query-classifier";
import {
  computeContextCompletenessDeterministic,
  type CompletenessLevel,
} from "./runtime-memory-context-completeness";
import { callDeepSeek, hasDeepSeekKey } from "./runtime-memory-real-llm-client";

// === Types (与 mem-northstar.md §3.2 一致) ===

export interface RetrievalResult {
  readonly hits: readonly HybridSearchHit[];
  readonly episodicHits: readonly EpisodicHit[];
  readonly assembledContext: string;
  readonly retrievedFacts: readonly RuntimeMemoryQueryableFact[];
}

export interface FeedbackLoopOptions {
  /** 最大迭代次数（含初始检索）。默认 2。 */
  readonly maxIterations?: number;
  /**
   * 触发重检索的阈值。
   * - "COMPLETE"：仅 COMPLETE 不重检索（PARTIAL/INSUFFICIENT 触发）
   * - "PARTIAL"：仅 INSUFFICIENT 触发（更保守，省 LLM 调用）
   * 默认 "COMPLETE"。
   */
  readonly completenessThreshold?: "COMPLETE" | "PARTIAL";
  /** 来自 Phase 1 的 QueryPlan，决定重写策略。 */
  readonly queryPlan: QueryPlan;
  /** Gold evidence，用于 completeness 评估。可选（缺失时不触发重检索）。 */
  readonly goldEvidence?: readonly string[];
}

export interface FeedbackLoopResult extends RetrievalResult {
  /** 实际执行的迭代数（含初始检索，最小 1）。 */
  readonly iterations: number;
  /** 最终 completeness level。 */
  readonly finalCompleteness: CompletenessLevel;
  /** 重写过的 query 历史（不含 original query）。 */
  readonly rewriteHistory: readonly string[];
  /** 每次迭代的 completeness level（含初始）。 */
  readonly completenessHistory: readonly CompletenessLevel[];
}

// === 主接口：带 feedback loop 的检索 ===

/**
 * 执行带 feedback loop 的检索。
 *
 * 算法：
 *   1. 评估 initialResult 的 completeness
 *   2. 若 level 满足阈值 或已达 maxIterations，返回
 *   3. 否则：rewriteQueryForRetrieval → retrieveFn → mergeRetrievalResults → 回到 1
 *
 * 注意：调用方负责构造 initialResult（首次检索由主 pipeline 完成）。
 * 本函数只负责"评估 → 重写 → 重检索 → 合并"循环。
 */
export async function retrieveWithFeedbackLoop(
  query: string,
  initialResult: RetrievalResult,
  options: FeedbackLoopOptions,
  retrieveFn: (q: string) => Promise<RetrievalResult>,
): Promise<FeedbackLoopResult> {
  const maxIterations = options.maxIterations ?? 2;
  const threshold: CompletenessLevel = options.completenessThreshold ?? "COMPLETE";
  const goldEvidence = options.goldEvidence ?? [];

  // 无 gold evidence 时无法评估 completeness，直接返回（避免误触发）
  if (goldEvidence.length === 0) {
    return {
      ...initialResult,
      iterations: 1,
      finalCompleteness: "COMPLETE",
      rewriteHistory: [],
      completenessHistory: ["COMPLETE"],
    };
  }

  let currentResult: RetrievalResult = initialResult;
  let currentQuery = query;
  const rewriteHistory: string[] = [];
  const completenessHistory: CompletenessLevel[] = [];
  let iterations = 0;
  let finalCompleteness: CompletenessLevel = "INSUFFICIENT";

  for (let i = 0; i < maxIterations; i += 1) {
    iterations += 1;
    const completeness = computeContextCompletenessDeterministic(
      currentResult.assembledContext,
      goldEvidence,
    );
    completenessHistory.push(completeness.level);
    finalCompleteness = completeness.level;

    // 满足阈值 → 返回
    if (meetsThreshold(completeness.level, threshold)) {
      return finalize(currentResult, iterations, finalCompleteness, rewriteHistory, completenessHistory);
    }

    // 已达 maxIterations → 返回（不再重检索）
    if (iterations >= maxIterations) {
      return finalize(currentResult, iterations, finalCompleteness, rewriteHistory, completenessHistory);
    }

    // 触发重检索：rewrite → retrieve → merge
    const missingEvidence = completeness.missingEvidence;
    const rewrittenQuery = await rewriteQueryForRetrieval(
      currentQuery,
      missingEvidence,
      options.queryPlan,
    );
    rewriteHistory.push(rewrittenQuery);
    currentQuery = rewrittenQuery;

    const newResult = await retrieveFn(rewrittenQuery);
    currentResult = mergeRetrievalResults([currentResult, newResult]);
  }

  return finalize(currentResult, iterations, finalCompleteness, rewriteHistory, completenessHistory);
}

function finalize(
  result: RetrievalResult,
  iterations: number,
  finalCompleteness: CompletenessLevel,
  rewriteHistory: readonly string[],
  completenessHistory: readonly CompletenessLevel[],
): FeedbackLoopResult {
  return {
    ...result,
    iterations,
    finalCompleteness,
    rewriteHistory,
    completenessHistory,
  };
}

/**
 * 判断 level 是否满足阈值。
 * - threshold="COMPLETE"：仅 COMPLETE 满足
 * - threshold="PARTIAL"：COMPLETE 或 PARTIAL 满足
 */
function meetsThreshold(level: CompletenessLevel, threshold: CompletenessLevel): boolean {
  if (threshold === "COMPLETE") return level === "COMPLETE";
  // threshold === "PARTIAL"
  return level === "COMPLETE" || level === "PARTIAL";
}

// === Query 重写 ===

/**
 * 基于缺失证据和 QueryPlan 重写 query。
 *
 * 策略（North Star §3.4）：
 * - temporal：扩展时间窗 + 同义词扩展
 * - multi_hop：聚焦关键实体（不在此处再分解，由 Phase 3 处理）
 * - open_domain：移除宽泛词，聚焦可检索关键词
 * - single_hop：同义词替换 + 去停用词
 *
 * 优先 LLM 重写（DeepSeek），失败时回退到确定性策略。
 */
export async function rewriteQueryForRetrieval(
  originalQuery: string,
  missingEvidence: readonly string[],
  queryPlan: QueryPlan,
): Promise<string> {
  if (!originalQuery || originalQuery.trim().length === 0) {
    return originalQuery;
  }

  // LLM 优先（可选）
  if (hasDeepSeekKey() && missingEvidence.length > 0) {
    try {
      const rewritten = await rewriteQueryWithLLM(originalQuery, missingEvidence, queryPlan);
      if (rewritten && rewritten.trim().length > 0 && rewritten !== originalQuery) {
        return rewritten;
      }
    } catch {
      // LLM 失败 — 回退到确定性策略
    }
  }

  // 确定性回退策略
  return rewriteQueryDeterministic(originalQuery, missingEvidence, queryPlan);
}

const REWRITE_SYSTEM_PROMPT =
  "You rewrite a retrieval query to better find missing evidence.\n\n" +
  "Rules:\n" +
  "- Preserve the original intent.\n" +
  "- Add synonyms or related terms for the missing evidence.\n" +
  "- Remove broad stopword phrases (\"tell me about\", \"what do you know\").\n" +
  "- For temporal queries, expand the time range vocabulary (year, month, date, recently, ago).\n" +
  "- For multi_hop queries, include both entities explicitly.\n" +
  "- Output ONLY the rewritten query, no explanation, no quotes.";

async function rewriteQueryWithLLM(
  originalQuery: string,
  missingEvidence: readonly string[],
  queryPlan: QueryPlan,
): Promise<string> {
  const evidenceList = missingEvidence.slice(0, 3).map((e, i) => `  ${i + 1}. ${e}`).join("\n");
  const userPrompt =
    `Original query: ${originalQuery}\n` +
    `Query type: ${queryPlan.type}\n` +
    `Retrieval strategy: ${queryPlan.strategy}\n` +
    (queryPlan.rewriteHint ? `Hint: ${queryPlan.rewriteHint}\n` : "") +
    `Missing evidence (need to find these):\n${evidenceList}\n\n` +
    "Rewritten query:";

  const response = await callDeepSeek(REWRITE_SYSTEM_PROMPT, userPrompt, {
    temperature: 0,
    maxTokens: 96,
  });
  return response.content.trim().replace(/^["']|["']$/g, "");
}

// === 确定性 query 重写（无 LLM 也可用，用于回退和测试） ===

const STOPWORDS_REWRITE = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "do", "does", "did", "will", "would", "could", "should", "can",
  "to", "of", "in", "for", "on", "with", "at", "by", "from",
  "and", "or", "not", "no", "that", "this",
  "they", "them", "their", "he", "she", "his", "her", "we", "us", "you",
  "what", "who", "when", "where", "why", "how",
]);

export function rewriteQueryDeterministic(
  originalQuery: string,
  missingEvidence: readonly string[],
  queryPlan: QueryPlan,
): string {
  const trimmed = originalQuery.trim();
  if (trimmed.length === 0) return originalQuery;

  // 从 missing evidence 提取关键 token
  const evidenceTokens = extractEvidenceTokens(missingEvidence);

  // 按 query 类型应用不同重写策略
  switch (queryPlan.type) {
    case "temporal":
      return rewriteTemporal(trimmed, evidenceTokens);
    case "multi_hop":
      return rewriteMultiHop(trimmed, evidenceTokens);
    case "open_domain":
      return rewriteOpenDomain(trimmed, evidenceTokens);
    case "single_hop":
    default:
      return rewriteSingleHop(trimmed, evidenceTokens);
  }
}

function rewriteTemporal(query: string, evidenceTokens: readonly string[]): string {
  // 时间相关同义词扩展
  const temporalSynonyms: Array<[RegExp, string]> = [
    [/\bwhen\b/i, "when date time"],
    [/\bhow long\b/i, "duration how long"],
    [/\brecently\b/i, "recent recently last"],
    [/\blast (year|month|week)\b/i, "$1 ago previous"],
    [/\b(in|before|after) (\d{4})\b/i, "$1 $2 year"],
  ];

  let rewritten = query;
  for (const [pattern, replacement] of temporalSynonyms) {
    rewritten = rewritten.replace(pattern, replacement);
  }
  // 追加缺失证据中的实体词
  const additions = pickMissingTokens(rewritten, evidenceTokens, 2);
  return additions.length > 0 ? `${rewritten} ${additions.join(" ")}` : rewritten;
}

function rewriteMultiHop(
  query: string,
  evidenceTokens: readonly string[],
): string {
  // multi_hop: 保留所有实体（不大写过滤的，简单认为是实体候选）
  // 追加缺失证据中的非停用词
  const additions = pickMissingTokens(query, evidenceTokens, 3);
  return additions.length > 0 ? `${query} ${additions.join(" ")}` : query;
}

function rewriteOpenDomain(query: string, evidenceTokens: readonly string[]): string {
  // 移除宽泛词
  const broadPhrases: RegExp[] = [
    /\bwhat can you tell me about\b/i,
    /\bwhat do you know about\b/i,
    /\btell me about\b/i,
    /\bplease describe\b/i,
    /\bcan you (describe|summarize|overview)\b/i,
  ];

  let rewritten = query;
  for (const phrase of broadPhrases) {
    rewritten = rewritten.replace(phrase, "").trim();
  }
  // 追加缺失证据中的关键 token
  const additions = pickMissingTokens(rewritten, evidenceTokens, 3);
  return additions.length > 0 ? `${rewritten} ${additions.join(" ")}` : rewritten;
}

function rewriteSingleHop(query: string, evidenceTokens: readonly string[]): string {
  // 同义词替换 + 去停用词
  const synonyms: Array<[RegExp, string]> = [
    [/\bjob\b/i, "job work occupation profession"],
    [/\bwork\b/i, "work job employment"],
    [/\bcompany\b/i, "company firm organization"],
    [/\bcity\b/i, "city location place"],
  ];

  let rewritten = query;
  for (const [pattern, replacement] of synonyms) {
    rewritten = rewritten.replace(pattern, replacement);
  }
  const additions = pickMissingTokens(rewritten, evidenceTokens, 2);
  return additions.length > 0 ? `${rewritten} ${additions.join(" ")}` : rewritten;
}

/**
 * 从 evidence tokens 中挑选 query 中尚未出现的 token。
 */
function pickMissingTokens(
  query: string,
  evidenceTokens: readonly string[],
  maxCount: number,
): string[] {
  const queryLower = query.toLowerCase();
  const queryTokenSet = new Set(queryLower.split(/\W+/).filter(Boolean));
  const result: string[] = [];
  const seen = new Set<string>();
  for (const token of evidenceTokens) {
    const lower = token.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    // 跳过 query 中已出现的 token
    if (queryTokenSet.has(lower)) continue;
    // 跳过纯数字或过短
    if (lower.length < 3) continue;
    if (/^\d+$/.test(lower)) continue;
    result.push(token);
    if (result.length >= maxCount) break;
  }
  return result;
}

function extractEvidenceTokens(evidence: readonly string[]): string[] {
  const tokens: string[] = [];
  for (const e of evidence) {
    const words = e
      .toLowerCase()
      .split(/\W+/)
      .filter((w) => w.length > 2 && !STOPWORDS_REWRITE.has(w));
    tokens.push(...words);
  }
  return tokens;
}

// === 合并多次检索结果（去重 + RRF 融合） ===

/**
 * 合并多次 RetrievalResult：
 * - hits: 按 factId 去重，RRF 分数累加（同 fact 在多次检索中出现 → 分数提升）
 * - episodicHits: 按 sentence_id 去重，rrfScore 取最大值
 * - retrievedFacts: 按 factId 去重，保留首次出现
 * - assembledContext: 拼接（去重事实文本）
 */
export function mergeRetrievalResults(
  results: readonly RetrievalResult[],
): RetrievalResult {
  if (results.length === 0) {
    return {
      hits: [],
      episodicHits: [],
      assembledContext: "",
      retrievedFacts: [],
    };
  }
  if (results.length === 1) return results[0];

  // 合并 hits：按 factId 累加 rrfScore
  const hitByFactId = new Map<string, HybridSearchHit>();
  for (const result of results) {
    for (const hit of result.hits) {
      const factId = hit.fact.factId;
      const existing = hitByFactId.get(factId);
      if (existing) {
        // RRF 分数累加（多次检索命中 → 提升）
        hitByFactId.set(factId, {
          ...existing,
          rrfScore: existing.rrfScore + hit.rrfScore,
          // 保留 ceScore 较大者（更准确的 cross-encoder 评分）
          ceScore: existing.ceScore !== undefined && hit.ceScore !== undefined
            ? Math.max(existing.ceScore, hit.ceScore)
            : existing.ceScore ?? hit.ceScore,
        });
      } else {
        hitByFactId.set(factId, hit);
      }
    }
  }

  // 按 rrfScore 降序
  const mergedHits = Array.from(hitByFactId.values()).sort((a, b) => b.rrfScore - a.rrfScore);

  // 合并 episodicHits：按 sentence_id 去重
  const episodicBySentenceKey = new Map<string, EpisodicHit>();
  for (const result of results) {
    for (const eh of result.episodicHits) {
      const key = eh.sentence.sentence_id;
      const existing = episodicBySentenceKey.get(key);
      if (!existing || eh.rrfScore > existing.rrfScore) {
        episodicBySentenceKey.set(key, eh);
      }
    }
  }
  const mergedEpisodic = Array.from(episodicBySentenceKey.values()).sort(
    (a, b) => b.rrfScore - a.rrfScore,
  );

  // 合并 retrievedFacts：按 factId 去重
  const factById = new Map<string, RuntimeMemoryQueryableFact>();
  for (const result of results) {
    for (const fact of result.retrievedFacts) {
      if (!factById.has(fact.factId)) {
        factById.set(fact.factId, fact);
      }
    }
  }
  const mergedFacts = Array.from(factById.values());

  // 拼接 assembledContext：去重事实文本
  // 简单策略：用 mergedHits 的 fact 重新拼装（避免重复事实文本）
  const contextParts: string[] = [];
  const seenContextText = new Set<string>();
  for (const result of results) {
    const parts = result.assembledContext.split(/\n+/);
    for (const part of parts) {
      const trimmed = part.trim();
      if (trimmed.length === 0) continue;
      const key = trimmed.toLowerCase();
      if (seenContextText.has(key)) continue;
      seenContextText.add(key);
      contextParts.push(trimmed);
    }
  }

  return {
    hits: mergedHits,
    episodicHits: mergedEpisodic,
    assembledContext: contextParts.join("\n"),
    retrievedFacts: mergedFacts,
  };
}
