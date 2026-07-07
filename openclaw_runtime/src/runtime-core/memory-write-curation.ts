// Module A: Write-time AUDN curation (v2: 四层决策 + semanticMatchScore).
// Inserts between Proposal Shadow (layer 5) output and Persistence (layer 3) write.
//
// AUDN = Add / Update / Delete / None. For each incoming memory candidate we
// evaluate it against existing stored facts and decide, BEFORE writing, whether
// to add it as new, update (supersede) a semantically-equivalent lower-confidence
// fact, drop it as an exact/semantic duplicate, or do nothing. This is the
// architectural answer to append-only "retrieval pollution": resolve conflicts
// at write time instead of leaving them for read time.
//
// v2 决策层级 (memory-arch-roadmap.md §B2):
//   1. 规则层 (cheap): negation pattern + subject+predicate 字面匹配 → SUPERSEDE
//   2. 语义判定层 (moderate, v2 新增):
//      - 候选集生成: subject+predicate match + entity overlap
//      - 等价判定: semanticMatchScore ≥ equivalentThreshold → 取 support_count 高的
//      - 矛盾判定: negation_pattern || (sim ≥ contradictThreshold && antonym/number mismatch)
//      - 边界区间 [boundaryLow, equivalentThreshold) → 进入 LLM 层
//   3. 信号层 (v2 新增): 四信号投票
//      epistemic_confidence / support_count / validity / provenance
//      - 新 fact 3/4 信号更高 → SUPERSEDE
//      - 新 fact 2/4 信号更高 → ADD (补充信息)
//      - 新 fact ≤1/4 信号更高 → NONE (丢弃新 fact)
//   4. LLM 层 (边界): sim ∈ [boundaryLow, equivalentThreshold) 或信号 tie
//      Week 1 留接口, 默认走 fallback (信号层决策)
//
// v2 关键修复:
// - 旧版 confidence 全 0.9 导致 tiebreaker 失效 (155/155 UPDATE 误判)
// - 新版用四信号 + semanticMatchScore 多维度决策, 不再依赖单一 confidence
// - 语义判定层用 char 3-gram cosine (不依赖外部 embedding API)

import type {
  RuntimeMemoryInvalidationReason,
  RuntimeMemoryTemporalFact,
  RuntimeMemoryTemporalFactCandidate,
} from "./memory-context.js";

export type AUDNAction = "ADD" | "UPDATE" | "SUPERSEDE" | "DELETE" | "NONE";

export type SupersessionReason = "contradiction" | "outdated" | "refined";

/**
 * v2: 决策层标识. 写入 decision reason 用于审计.
 */
export type AUDNDecisionLayer =
  | "rule" // 规则层 (cheap, 确定性)
  | "semantic" // 语义判定层 (moderate, embedding/3-gram)
  | "signal" // 信号层 (四信号投票)
  | "llm" // LLM 层 (边界情况, Week 1 留接口)
  | "fallback"; // 兜底 (无候选冲突 → ADD)

/**
 * v2: 冲突解决信号 (从单一 confidence 拆分).
 * Source: memory-arch-roadmap.md §B2 加分项 1.
 */
export type ConflictSignal = {
  /** 认识论不确定性: LLM 抽取 fact 时的置信度 (0-1). 来源: candidate.confidence */
  epistemic_confidence: number;
  /** 支持数量: 支持该 fact 的 evidence 数量. 来源: proofCount + evidenceRefs.length */
  support_count: number;
  /** 时间有效性: valid_at ≤ now ≤ expired_at → 1, 否则 0. */
  validity: 0 | 1;
  /** 来源可靠性: human (1.0) > verifier (0.8) > tool (0.6) > other (0.4) */
  provenance: number;
  /** 语义匹配分数 (0-1): char 3-gram cosine + (可选) embedding cosine 取大值 */
  semanticMatchScore: number;
};

export type AUDNDecision =
  | { action: "ADD"; candidate: RuntimeMemoryTemporalFactCandidate }
  | {
      action: "UPDATE";
      candidate: RuntimeMemoryTemporalFactCandidate;
      supersedes: string;
    }
  | {
      action: "SUPERSEDE";
      candidate: RuntimeMemoryTemporalFactCandidate;
      supersedes: string;
      supersessionReason: SupersessionReason;
    }
  | {
      action: "DELETE";
      targetFactId: string;
      reason: RuntimeMemoryInvalidationReason;
    }
  | { action: "NONE"; reason: string };

/**
 * v2: 带审计信息的决策结果. 评测流水线仍用 AUDNDecision,
 * 内部测试用 AuditedAUDNDecision 检查决策层 + 信号.
 */
export type AuditedAUDNDecision = AUDNDecision & {
  /** 决策层 (审计用) */
  decisionLayer: AUDNDecisionLayer;
  /** 语义匹配分数 (审计用, 0-1) */
  semanticMatchScore?: number;
  /** 信号对比 (审计用) */
  signalComparison?: {
    candidate: ConflictSignal;
    existing: ConflictSignal;
    candidateWins: number; // 0-4
  };
  /** 命中的规则名 (审计用) */
  matchedRule?: string;
};

export type WriteCurationConfig = {
  semanticDedupeThreshold: number;
  keywordOverlapThreshold: number;
  /**
   * Minimum token-difference ratio (1 - Jaccard) required to flag a
   * contradiction. Combined with a negation/change signal, this distinguishes
   * genuine contradictions (different value tokens) from refinements (near-
   * identical text). Default 0.3.
   */
  contradictionOverlapThreshold?: number;
  /**
   * v2 新增: 语义判定层阈值.
   * - sim ≥ equivalentThreshold → 等价 (取 support_count 高的)
   * - sim ≥ contradictThreshold + antonym/number → 矛盾 (SUPERSEDE)
   * - sim ∈ [boundaryLow, equivalentThreshold) → LLM 层 (Week 1 fallback)
   */
  equivalentThreshold?: number; // 默认 0.88
  contradictThreshold?: number; // 默认 0.80
  boundaryLow?: number; // 默认 0.75
  /**
   * v2 新增: 是否启用语义判定层. 默认 true.
   * 关闭时退回旧版三阶段决策 (向后兼容).
   */
  enableSemanticLayer?: boolean;
  /**
   * v2 新增: 是否启用信号层. 默认 true.
   * 关闭时退回旧版 confidence tiebreaker.
   */
  enableSignalLayer?: boolean;
};

export const DEFAULT_WRITE_CURATION_CONFIG: WriteCurationConfig = {
  semanticDedupeThreshold: 0.85,
  keywordOverlapThreshold: 0.6,
  contradictionOverlapThreshold: 0.3,
  // v2 新增
  equivalentThreshold: 0.88,
  contradictThreshold: 0.80,
  boundaryLow: 0.75,
  enableSemanticLayer: true,
  enableSignalLayer: true,
};

const NEGATION_PATTERN =
  /(?:\bnot\b|\bno\s+longer\b|\bswitched\b|\bchanged\b|\bupdated\b|\bnow\b|\breplaced\b|\bmoved\s+to\b|\bprefers?\s+\w+\s+over\b)/i;

/**
 * v2: 隐式否定模式. 用于语义判定层识别 "我搬走了" 这类无显式 not 的否定.
 * 匹配 moving/switching/quitting/leaving 等动作词.
 */
const IMPLICIT_NEGATION_PATTERN =
  /(?:\bmoved\b|\bswitched\b|\bquit\b|\bleft\b|\bstopped\b|\bgave\s+up\b|\bdropped\b|\bcancelled?\b|\breturned\b)/i;

/**
 * v2: 数字/枚举不匹配检测. 用于语义判定层识别 "lives in NYC" vs "lives in LA".
 * 返回 true 当两个 summary 包含不同的专有名词/数字.
 */
function hasValueMismatch(newSummary: string, existingSummary: string): boolean {
  const newTokens = tokenize(newSummary);
  const existTokens = tokenize(existingSummary);
  // 找出 new 独有的 token (新值)
  const newOnly = [...newTokens].filter((t) => !existTokens.has(t));
  // 找出 exist 独有的 token (旧值)
  const existOnly = [...existTokens].filter((t) => !newTokens.has(t));
  // 两边都有独有 token = 值不同
  return newOnly.length > 0 && existOnly.length > 0;
}

/**
 * Detect semantic contradiction between a new fact's objectSummary and an
 * existing fact's objectSummary. Returns true when ALL of:
 *   1. The new summary contains an explicit negation/change signal.
 *   2. The new summary has at least one token not present in the existing
 *      summary (the new value or negation word itself).
 *   3. The token-difference ratio (1 - Jaccard) meets the threshold, ensuring
 *      the statements differ enough to be a contradiction rather than a
 *      refinement.
 *
 * Contradictory statements about the same subject naturally share most content
 * words (e.g. "prefers dark theme" → "now prefers light theme"), so a high
 * Jaccard overlap does NOT rule out contradiction. The difference ratio is the
 * meaningful signal.
 */
export function detectConflict(
  newSummary: string,
  existingSummary: string,
  overlapThreshold = 0.3,
): boolean {
  if (!NEGATION_PATTERN.test(newSummary)) return false;

  const newTokens = tokenize(newSummary);
  const existTokens = tokenize(existingSummary);

  const hasNewTokens = [...newTokens].some((t) => !existTokens.has(t));
  if (!hasNewTokens) return false;

  const intersection = [...newTokens].filter((t) => existTokens.has(t)).length;
  const union = new Set([...newTokens, ...existTokens]).size;
  const jaccard = union === 0 ? 0 : intersection / union;
  const differenceRatio = 1 - jaccard;

  return differenceRatio >= overlapThreshold;
}

/**
 * v2: 计算 char 3-gram cosine 相似度 (不依赖外部 embedding API).
 * 复用 memory-hybrid-retrieval.ts 的 char 3-gram 思路, 但本模块独立实现
 * 以避免循环依赖.
 *
 * 用于语义判定层的 semanticMatchScore.
 */
export function computeSemanticMatchScore(
  newSummary: string,
  existingSummary: string,
): number {
  const newGrams = characterNgrams(newSummary);
  const existGrams = characterNgrams(existingSummary);
  if (newGrams.length === 0 || existGrams.length === 0) return 0;

  const newVec = tfidfVector(newGrams);
  const existVec = tfidfVector(existGrams);
  return cosine(newVec, existVec);
}

function characterNgrams(text: string): string[] {
  // 标准化: 小写 + 去多余空格
  const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();
  if (normalized.length < 3) return normalized.length > 0 ? [normalized] : [];

  const grams: string[] = [];
  // 用空格分隔的单词内做 3-gram, 避免跨词产生噪声
  for (const word of normalized.split(" ")) {
    if (word.length < 3) {
      grams.push(word);
      continue;
    }
    for (let i = 0; i <= word.length - 3; i++) {
      grams.push(word.slice(i, i + 3));
    }
  }
  return grams;
}

function tfidfVector(grams: string[]): Map<string, number> {
  const vec = new Map<string, number>();
  for (const g of grams) vec.set(g, (vec.get(g) ?? 0) + 1);
  return vec;
}

function cosine(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0;
  let aSq = 0;
  let bSq = 0;
  for (const [k, v] of a) {
    aSq += v * v;
    const bv = b.get(k);
    if (bv !== undefined) dot += v * bv;
  }
  for (const [, v] of b) bSq += v * v;
  if (aSq === 0 || bSq === 0) return 0;
  return dot / (Math.sqrt(aSq) * Math.sqrt(bSq));
}

/**
 * v2: 计算 ConflictSignal (四信号 + semanticMatchScore).
 */
export function computeConflictSignal(
  fact: RuntimeMemoryTemporalFactCandidate | RuntimeMemoryTemporalFact,
  now: number = Date.now(),
  semanticMatchScore: number = 0,
): ConflictSignal {
  const validity: 0 | 1 =
    fact.valid_at <= now &&
    (fact.expired_at === undefined || fact.expired_at >= now) &&
    fact.invalid_at === undefined
      ? 1
      : 0;

  const support_count =
    (fact.proofCount ?? 0) + (fact.evidenceRefs?.length ?? 0);

  const provenance = computeProvenance(fact.source);

  return {
    epistemic_confidence: fact.confidence,
    support_count,
    validity,
    provenance,
    semanticMatchScore,
  };
}

function computeProvenance(source: string): number {
  switch (source) {
    case "human_confirmation":
      return 1.0;
    case "verifier_summary":
      return 0.8;
    case "tool_result":
      return 0.6;
    default:
      return 0.4;
  }
}

/**
 * v2: 信号层投票. 返回 candidate 信号高于 existing 的数量 (0-4).
 */
export function compareSignals(
  candidate: ConflictSignal,
  existing: ConflictSignal,
): number {
  let candidateWins = 0;
  if (candidate.epistemic_confidence > existing.epistemic_confidence)
    candidateWins += 1;
  if (candidate.support_count > existing.support_count) candidateWins += 1;
  if (candidate.validity > existing.validity) candidateWins += 1;
  if (candidate.provenance > existing.provenance) candidateWins += 1;
  return candidateWins;
}

/**
 * v2: 带审计信息的决策. 测试用此函数检查决策层 + 信号.
 * 评测流水线仍用 decideAUDN (向下兼容).
 */
export function decideAUDNAudited(
  candidate: RuntimeMemoryTemporalFactCandidate,
  existingFacts: readonly RuntimeMemoryTemporalFact[],
  config: WriteCurationConfig = DEFAULT_WRITE_CURATION_CONFIG,
  now: number = Date.now(),
): AuditedAUDNDecision {
  const equivalentThreshold = config.equivalentThreshold ?? 0.88;
  const contradictThreshold = config.contradictThreshold ?? 0.80;
  const boundaryLow = config.boundaryLow ?? 0.75;
  const enableSemantic = config.enableSemanticLayer !== false;
  const enableSignal = config.enableSignalLayer !== false;

  // === Stage 1: 规则层 - exact subject+predicate match ===
  const exactMatch = existingFacts.find(
    (f) =>
      f.subject === candidate.subject &&
      f.predicate === candidate.predicate &&
      (!f.taskId || !candidate.taskId || f.taskId === candidate.taskId),
  );

  if (exactMatch) {
    const normalizedExisting = normalizeObjectSummary(exactMatch.objectSummary);
    const normalizedNew = normalizeObjectSummary(candidate.objectSummary);

    if (normalizedExisting === normalizedNew) {
      return {
        action: "NONE",
        reason: "exact_duplicate",
        decisionLayer: "rule",
        matchedRule: "exact_match",
      };
    }

    // 规则层: 显式 negation pattern → SUPERSEDE
    if (
      detectConflict(
        candidate.objectSummary,
        exactMatch.objectSummary,
        config.contradictionOverlapThreshold ?? 0.3,
      )
    ) {
      return {
        action: "SUPERSEDE",
        candidate,
        supersedes: exactMatch.factId,
        supersessionReason: "contradiction",
        decisionLayer: "rule",
        matchedRule: "negation_pattern",
      };
    }

    // === Stage 2: 语义判定层 (v2 新增) ===
    if (enableSemantic) {
      const sim = computeSemanticMatchScore(
        candidate.objectSummary,
        exactMatch.objectSummary,
      );

      // 等价: sim ≥ equivalentThreshold → 取 support_count 高的
      if (sim >= equivalentThreshold) {
        const candidateSignal = computeConflictSignal(
          candidate,
          now,
          sim,
        );
        const existingSignal = computeConflictSignal(
          exactMatch,
          now,
          sim,
        );

        if (candidateSignal.support_count >= existingSignal.support_count) {
          return {
            action: "SUPERSEDE",
            candidate,
            supersedes: exactMatch.factId,
            supersessionReason: "refined",
            decisionLayer: "semantic",
            semanticMatchScore: sim,
            signalComparison: {
              candidate: candidateSignal,
              existing: existingSignal,
              candidateWins: compareSignals(candidateSignal, existingSignal),
            },
            matchedRule: "semantic_equivalent_higher_support",
          };
        }
        return {
          action: "NONE",
          reason: "semantic_equivalent_lower_support",
          decisionLayer: "semantic",
          semanticMatchScore: sim,
          signalComparison: {
            candidate: candidateSignal,
            existing: existingSignal,
            candidateWins: compareSignals(candidateSignal, existingSignal),
          },
          matchedRule: "semantic_equivalent_lower_support",
        };
      }

      // 矛盾: sim ≥ contradictThreshold + (negation || value mismatch || implicit negation)
      const hasNegation =
        NEGATION_PATTERN.test(candidate.objectSummary) ||
        IMPLICIT_NEGATION_PATTERN.test(candidate.objectSummary);
      const hasMismatch = hasValueMismatch(
        candidate.objectSummary,
        exactMatch.objectSummary,
      );
      if (sim >= contradictThreshold && (hasNegation || hasMismatch)) {
        return {
          action: "SUPERSEDE",
          candidate,
          supersedes: exactMatch.factId,
          supersessionReason: "contradiction",
          decisionLayer: "semantic",
          semanticMatchScore: sim,
          matchedRule: "semantic_contradiction",
        };
      }

      // 边界区间 [boundaryLow, equivalentThreshold) → 进入 LLM 层 (Week 1 fallback)
      if (sim >= boundaryLow && sim < equivalentThreshold) {
        // Week 1: LLM 层未集成, fallback 到信号层决策
        if (enableSignal) {
          return decideBySignal(
            candidate,
            exactMatch,
            sim,
            now,
            "llm_fallback_to_signal",
          );
        }
        // 信号层也关闭: fallback 到旧版 confidence tiebreaker
        return fallbackConfidenceTiebreaker(candidate, exactMatch, sim);
      }
    }

    // === Stage 3: 信号层 (v2 新增, 当语义判定层未触发时) ===
    if (enableSignal) {
      // sim < boundaryLow: 不是等价/矛盾/边界, 用信号层判断是否补充信息
      const sim = enableSemantic
        ? computeSemanticMatchScore(
            candidate.objectSummary,
            exactMatch.objectSummary,
          )
        : 0;
      return decideBySignal(candidate, exactMatch, sim, now, "signal_vote");
    }

    // === Stage 4: 旧版 confidence tiebreaker (向后兼容) ===
    if (candidate.confidence >= exactMatch.confidence) {
      return {
        action: "UPDATE",
        candidate,
        supersedes: exactMatch.factId,
        decisionLayer: "fallback",
        matchedRule: "confidence_tiebreaker",
      };
    }
    return {
      action: "NONE",
      reason: "lower_confidence_than_existing",
      decisionLayer: "fallback",
      matchedRule: "lower_confidence",
    };
  }

  // === Stage 2 (无 exactMatch): BM25 keyword overlap detection ===
  if (existingFacts.length > 0) {
    const overlap = computeBM25Overlap(
      `${candidate.subject} ${candidate.predicate} ${candidate.objectSummary}`,
      existingFacts,
    );

    if (overlap.maxScore > config.keywordOverlapThreshold && overlap.topFact) {
      const jaccardScore = computeJaccard(
        tokenize(candidate.objectSummary),
        tokenize(overlap.topFact.objectSummary),
      );

      if (jaccardScore > config.semanticDedupeThreshold) {
        // v2: 用信号层替代 confidence tiebreaker
        if (enableSignal) {
          const sim = computeSemanticMatchScore(
            candidate.objectSummary,
            overlap.topFact.objectSummary,
          );
          return decideBySignal(
            candidate,
            overlap.topFact,
            sim,
            now,
            "bm25_signal_vote",
          );
        }
        if (candidate.confidence > overlap.topFact.confidence) {
          return {
            action: "UPDATE",
            candidate,
            supersedes: overlap.topFact.factId,
            decisionLayer: "fallback",
            matchedRule: "bm25_confidence_tiebreaker",
          };
        }
        return {
          action: "NONE",
          reason: "semantic_duplicate_lower_confidence",
          decisionLayer: "fallback",
          matchedRule: "bm25_lower_confidence",
        };
      }
    }
  }

  // === Stage 5: passed all checks → ADD ===
  return {
    action: "ADD",
    candidate,
    decisionLayer: "fallback",
    matchedRule: "no_conflict",
  };
}

/**
 * v2: 信号层决策. 四信号投票.
 */
function decideBySignal(
  candidate: RuntimeMemoryTemporalFactCandidate,
  existing: RuntimeMemoryTemporalFact,
  sim: number,
  now: number,
  rulePrefix: string,
): AuditedAUDNDecision {
  const candidateSignal = computeConflictSignal(candidate, now, sim);
  const existingSignal = computeConflictSignal(existing, now, sim);
  const candidateWins = compareSignals(candidateSignal, existingSignal);

  const signalComparison = {
    candidate: candidateSignal,
    existing: existingSignal,
    candidateWins,
  };

  // 3/4 信号更高 → SUPERSEDE
  if (candidateWins >= 3) {
    return {
      action: "SUPERSEDE",
      candidate,
      supersedes: existing.factId,
      supersessionReason: "refined",
      decisionLayer: "signal",
      semanticMatchScore: sim,
      signalComparison,
      matchedRule: `${rulePrefix}_supersede`,
    };
  }

  // 2/4 信号更高 → ADD (补充信息)
  if (candidateWins >= 2) {
    return {
      action: "ADD",
      candidate,
      decisionLayer: "signal",
      semanticMatchScore: sim,
      signalComparison,
      matchedRule: `${rulePrefix}_add_supplement`,
    };
  }

  // ≤1/4 信号更高 → NONE (丢弃新 fact)
  return {
    action: "NONE",
    reason: `${rulePrefix}_lower_signal`,
    decisionLayer: "signal",
    semanticMatchScore: sim,
    signalComparison,
    matchedRule: `${rulePrefix}_drop`,
  };
}

/**
 * v2: 旧版 confidence tiebreaker (语义层 + 信号层都关闭时的 fallback).
 */
function fallbackConfidenceTiebreaker(
  candidate: RuntimeMemoryTemporalFactCandidate,
  existing: RuntimeMemoryTemporalFact,
  sim: number,
): AuditedAUDNDecision {
  if (candidate.confidence >= existing.confidence) {
    return {
      action: "UPDATE",
      candidate,
      supersedes: existing.factId,
      decisionLayer: "fallback",
      semanticMatchScore: sim,
      matchedRule: "confidence_tiebreaker",
    };
  }
  return {
    action: "NONE",
    reason: "lower_confidence_than_existing",
    decisionLayer: "fallback",
    semanticMatchScore: sim,
    matchedRule: "lower_confidence",
  };
}

/**
 * Decide AUDN action for a candidate against existing facts.
 * existingFacts should already be scoped to relevant facts (e.g. same subject)
 * by the caller to keep the BM25 scan cheap.
 *
 * 向下兼容: 返回 AUDNDecision (不带审计信息).
 * 测试用 decideAUDNAudited 检查决策层 + 信号.
 */
export function decideAUDN(
  candidate: RuntimeMemoryTemporalFactCandidate,
  existingFacts: readonly RuntimeMemoryTemporalFact[],
  config: WriteCurationConfig = DEFAULT_WRITE_CURATION_CONFIG,
): AUDNDecision {
  return decideAUDNAudited(candidate, existingFacts, config);
}

function normalizeObjectSummary(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.,!?]/g, "");
}

function tokenize(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .split(/\W+/)
      .filter((w) => w.length > 2),
  );
}

function computeJaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  const intersection = [...a].filter((x) => b.has(x)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Lightweight BM25-style overlap score. Not a full BM25 implementation —
 * a TF-normalized overlap ratio. At 512-fact scale this is < 1ms.
 * Returns maxScore in [0,1] and the best-matching fact.
 */
function computeBM25Overlap(
  query: string,
  facts: readonly RuntimeMemoryTemporalFact[],
): {
  maxScore: number;
  topFact: RuntimeMemoryTemporalFact | undefined;
} {
  const queryTokens = tokenize(query);
  if (queryTokens.size === 0 || facts.length === 0) {
    return { maxScore: 0, topFact: undefined };
  }

  let maxScore = 0;
  let topFact: RuntimeMemoryTemporalFact | undefined;

  for (const fact of facts) {
    const factTokens = tokenize(
      `${fact.subject} ${fact.predicate} ${fact.objectSummary}`,
    );
    if (factTokens.size === 0) continue;
    const overlap = [...queryTokens].filter((t) => factTokens.has(t)).length;
    // Cosine-normalized overlap: overlap / sqrt(|q| * |d|)
    const score = overlap / Math.sqrt(queryTokens.size * factTokens.size);
    if (score > maxScore) {
      maxScore = score;
      topFact = fact;
    }
  }

  return { maxScore, topFact };
}

/**
 * Apply an AUDN decision against an in-memory fact list, returning the
 * resulting fact list and any invalidation that should be recorded.
 * This is the pure helper the runtime-integration layer calls; tests can
 * exercise it directly without a database.
 */
export type AUDNApplyResult = {
  action: AUDNAction;
  /** Facts to persist after applying the decision (existing minus superseded). */
  remainingFacts: RuntimeMemoryTemporalFact[];
  /** Fact to append (for ADD/UPDATE), or undefined. */
  toAppend: RuntimeMemoryTemporalFactCandidate | undefined;
  /** FactId to invalidate (for UPDATE/DELETE), or undefined. */
  toInvalidateFactId: string | undefined;
  invalidateReason: RuntimeMemoryInvalidationReason | undefined;
};

export function applyAUDNDecision(
  decision: AUDNDecision,
  existingFacts: readonly RuntimeMemoryTemporalFact[],
): AUDNApplyResult {
  switch (decision.action) {
    case "ADD":
      return {
        action: "ADD",
        remainingFacts: [...existingFacts],
        toAppend: decision.candidate,
        toInvalidateFactId: undefined,
        invalidateReason: undefined,
      };
    case "UPDATE":
      return {
        action: "UPDATE",
        remainingFacts: existingFacts.filter(
          (f) => f.factId !== decision.supersedes,
        ),
        toAppend: decision.candidate,
        toInvalidateFactId: decision.supersedes,
        invalidateReason: "superseded",
      };
    case "SUPERSEDE":
      return {
        action: "SUPERSEDE",
        remainingFacts: existingFacts.filter(
          (f) => f.factId !== decision.supersedes,
        ),
        toAppend: decision.candidate,
        toInvalidateFactId: decision.supersedes,
        invalidateReason: "contradicted",
      };
    case "DELETE":
      return {
        action: "DELETE",
        remainingFacts: existingFacts.filter(
          (f) => f.factId !== decision.targetFactId,
        ),
        toAppend: undefined,
        toInvalidateFactId: decision.targetFactId,
        invalidateReason: decision.reason,
      };
    case "NONE":
      return {
        action: "NONE",
        remainingFacts: [...existingFacts],
        toAppend: undefined,
        toInvalidateFactId: undefined,
        invalidateReason: undefined,
      };
  }
}
