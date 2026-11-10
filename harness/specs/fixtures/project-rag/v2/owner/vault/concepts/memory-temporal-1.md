---
title: memory-temporal / openclaw_runtime/src/runtime-core/memory-temporal-policy.ts
revision: 1
status: active
trust: confirmed
verifiedAt: "2026-11-09T23:01:31.258Z"
acl:
  read: [operator]
scope:
  workspaceId: rag-corpus-workspace
retention:
  policy: source-coupled
actor: codex/project-rag-corpus-author
driven_by: agent
---

# Repository source snapshot

Origin: openclaw_runtime/src/runtime-core/memory-temporal-policy.ts
Commit: 1a4cc531ee050794b89dc8d7e49ac7c7a1c71ec0

~~~typescript
// Week 2 v2: 时间 policy (三档) + query-intent 启发式 + as_of snapshot.
//
// Source: memory-arch-roadmap.md §B3, §C.5
//
// 决策: 从 soft penalty 改为三档 policy (v2: 避免 hard filter 误伤
//   "以前/曾经/当时" 类问题).
//
//   1. strict_current (默认): 只看当前有效 fact (invalid_at/expired_at < now
//      hard filter), 用于大多数 QA
//   2. include_history_ranked: 允许历史 fact, 但必须标注时间, 且排序低于当前,
//      用于 "以前/曾经/之前/过去/当时/后来" 类问题
//   3. as_of(T): 按指定时间点重建 snapshot (可回放), 用于 "当时 T 时刻" 类
//      问题或回归测试
//
// query-intent 启发式: query 出现 "以前/曾经/之前/过去/当时/后来/现在" 等关键词
//   → 切到 include_history_ranked; 出现明确时间点 → as_of(T)
//
// 与 memory-hybrid-retrieval.ts 现有 temporalMode 的关系:
//   - temporalMode (filter/boost/strict) 是单点过滤开关
//   - temporalPolicy 是更高层的策略选择, 决定使用哪个 temporalMode + 是否降权
//   - temporalPolicy.strict_current ≈ temporalMode=filter
//   - temporalPolicy.as_of(T) ≈ temporalMode=strict + referenceTime=T
//   - temporalPolicy.include_history_ranked = temporalMode=filter (允许
//     invalid_at < now 的 fact 通过) + retrieval-time 排序降权
//
// 这个模块只做 policy 判定 + 过滤函数, 不耦合具体检索实现.

import type {
  RuntimeMemoryQueryableFact,
} from "./memory-context.js";
import type { TemporalPolicy } from "./memory-trace.js";

// === Query-intent 启发式 ===

/**
 * 历史类关键词 (中英双语). 命中任一 → include_history_ranked.
 *
 * 注意 "现在" 不在此列表: "现在" 类问题仍走 strict_current,
 * 但若同时出现 "以前...现在..." 对比模式, 则走 include_history_ranked
 * (因为需要历史 fact 才能完成对比).
 */
const HISTORY_INTENT_PATTERNS: readonly RegExp[] = [
  // 中文
  /以前/i,
  /曾经/i,
  /之前/i,
  /过去/i,
  /当时/i,
  /后来/i,
  /原本/i,
  /原先/i,
  /先前/i,
  /此前/i,
  /从前/i,
  /往昔/i,
  // 英文
  /\bbefore\b/i,
  /\bpreviously\b/i,
  /\bformerly\b/i,
  /\bused to\b/i,
  /\bonce\b/i,
  /\bin the past\b/i,
  /\bago\b/i,
  /\bback then\b/i,
  /\bat that time\b/i,
  /\bduring that period\b/i,
];

/**
 * "以前...现在..." 对比模式. 命中 → include_history_ranked
 * (因为需要历史 fact 才能完成对比).
 */
const COMPARISON_PATTERNS: readonly RegExp[] = [
  /以前.*现在/i,
  /之前.*现在/i,
  /过去.*现在/i,
  /原[本先].*现在/i,
  /\bbefore\b.*\bnow\b/i,
  /\bpreviously\b.*\bnow\b/i,
  /\bused to\b.*\bnow\b/i,
  /\bin the past\b.*\bnow\b/i,
];

/**
 * 明确时间点关键词. 命中 + 可解析时间 → as_of(T).
 *
 * 解析 T 的优先级:
 * 1. 显式数字 (年份 "in 2023", "2023年", 日期 "on Jan 15")
 * 2. 相对时间 ("3 months ago", "last year") — 需 referenceTime 锚点
 *
 * Week 2 v2 只实现显式年份解析, 相对时间留待 Week 6 (event log) 完善.
 */
const AS_OF_YEAR_PATTERN = /\b(?:in|during|of)\s+(\d{4})\b/i;
const AS_OF_YEAR_CN_PATTERN = /(\d{4})\s*年/;

/**
 * query-intent 启发式分类结果.
 */
export type QueryIntentResult = {
  policy: TemporalPolicy;
  /** 命中的 intent 关键词 (审计用, 写入 trace.queryIntentKeywords) */
  intentKeywords: string[];
  /** as_of 的时间点 (仅当 policy = as_of 时定义, Unix ms) */
  asOfTime?: number;
  /** 命中的模式名 (审计用) */
  matchedPattern?: string;
};

/**
 * query-intent 启发式: 从 query 文本推断 temporalPolicy.
 *
 * 判定优先级:
 *   1. as_of(T): query 含明确年份 (in 2023 / 2023年) → as_of(年初)
 *   2. include_history_ranked: query 含历史关键词或对比模式
 *   3. strict_current: 默认
 *
 * @param query 用户问题文本
 * @param _referenceTime 当前参考时间 (Unix ms), 用于相对时间锚点 (Week 2 未用)
 */
export function inferTemporalPolicyFromQuery(
  query: string,
  _referenceTime?: number,
): QueryIntentResult {
  if (!query || typeof query !== "string") {
    return { policy: "strict_current", intentKeywords: [] };
  }

  // 1. as_of: 明确年份
  const yearMatch = query.match(AS_OF_YEAR_PATTERN) ??
    query.match(AS_OF_YEAR_CN_PATTERN);
  if (yearMatch) {
    const yearStr = yearMatch[1] ?? yearMatch[0];
    const year = parseInt(yearStr, 10);
    if (!Number.isNaN(year) && year >= 1900 && year <= 2100) {
      // as_of 时间点 = 该年 1 月 1 日 00:00:00 UTC
      const asOfTime = Date.UTC(year, 0, 1);
      return {
        policy: "as_of",
        intentKeywords: [yearStr],
        asOfTime,
        matchedPattern: "explicit_year",
      };
    }
  }

  // 2. include_history_ranked: 对比模式 (优先, 因为此类问题必需要历史 fact)
  for (const pattern of COMPARISON_PATTERNS) {
    const match = query.match(pattern);
    if (match) {
      return {
        policy: "include_history_ranked",
        intentKeywords: extractKeywords(query, [
          "以前",
          "曾经",
          "之前",
          "过去",
          "后来",
          "现在",
          "before",
          "previously",
          "now",
        ]),
        matchedPattern: `comparison:${pattern.source}`,
      };
    }
  }

  // 3. include_history_ranked: 历史关键词
  for (const pattern of HISTORY_INTENT_PATTERNS) {
    const match = query.match(pattern);
    if (match) {
      return {
        policy: "include_history_ranked",
        intentKeywords: [match[0]],
        matchedPattern: `history:${pattern.source}`,
      };
    }
  }

  // 4. 默认 strict_current
  return { policy: "strict_current", intentKeywords: [] };
}

function extractKeywords(query: string, candidates: string[]): string[] {
  const lower = query.toLowerCase();
  return candidates.filter((k) => lower.includes(k.toLowerCase()));
}

// === 三档 policy 过滤函数 ===

/**
 * 三档 policy 过滤函数. 输入 fact + policy → 是否保留.
 *
 * strict_current:
 *   - valid_at ≤ now (fact 在当前时间已生效)
 *   - invalid_at 未定义 或 > now (未失效)
 *   - expired_at 未定义 或 > now (未过期)
 *
 * include_history_ranked:
 *   - 允许 invalid_at < now / expired_at < now 的历史 fact 通过
 *   - 但仍要求 valid_at ≤ now (不能召回未来 fact)
 *   - 排序降权由 retrieval 层的 temporalPenalty 处理 (本函数只做过滤)
 *
 * as_of(T):
 *   - valid_at ≤ T (T 时刻已生效)
 *   - invalid_at 未定义 或 > T (T 时刻未失效)
 *   - expired_at 未定义 或 > T (T 时刻未过期)
 *   - 即 "T 时刻这个 fact 是有效的吗?"
 *
 * @param fact 待过滤的 fact
 * @param policy 时间策略
 * @param now 当前时间 (Unix ms), strict_current 用
 * @param asOfTime as_of 时间点 (Unix ms), policy=as_of 时用
 */
export function passesTemporalPolicy(
  fact: RuntimeMemoryQueryableFact,
  policy: TemporalPolicy,
  now: number,
  asOfTime?: number,
): { passes: boolean; reason?: string } {
  const validAt = fact.valid_at;
  const invalidAt = fact.invalid_at;
  const expiredAt = fact.expired_at;

  switch (policy) {
    case "strict_current": {
      if (validAt > now) {
        return { passes: false, reason: "future_fact" };
      }
      if (invalidAt !== undefined && invalidAt <= now) {
        return { passes: false, reason: "invalidated" };
      }
      if (expiredAt !== undefined && expiredAt <= now) {
        return { passes: false, reason: "expired" };
      }
      return { passes: true };
    }

    case "include_history_ranked": {
      // 允许历史 fact (invalid_at/expired_at < now), 但仍过滤未来 fact
      if (validAt > now) {
        return { passes: false, reason: "future_fact" };
      }
      // 历史 fact 通过过滤, 由 retrieval 层降权
      return { passes: true };
    }

    case "as_of": {
      if (asOfTime === undefined) {
        // as_of 无时间点 → 退化为 strict_current
        if (validAt > now) {
          return { passes: false, reason: "future_fact" };
        }
        if (invalidAt !== undefined && invalidAt <= now) {
          return { passes: false, reason: "invalidated" };
        }
        if (expiredAt !== undefined && expiredAt <= now) {
          return { passes: false, reason: "expired" };
        }
        return { passes: true };
      }
      // as_of(T): T 时刻这个 fact 是否有效
      if (validAt > asOfTime) {
        return { passes: false, reason: "not_yet_valid_at_T" };
      }
      if (invalidAt !== undefined && invalidAt <= asOfTime) {
        return { passes: false, reason: "invalidated_before_T" };
      }
      if (expiredAt !== undefined && expiredAt <= asOfTime) {
        return { passes: false, reason: "expired_before_T" };
      }
      return { passes: true };
    }
  }
}

// === include_history_ranked 排序降权 ===

/**
 * 计算 include_history_ranked policy 下的 fact 时间惩罚系数.
 *
 * 已失效/已过期的 fact 获得 penalty 倍降权 (0-1, 默认 0.5).
 * 当前有效 fact 无降权 (1.0).
 *
 * 调用方应在 RRF/cross-encoder 分数上乘以这个系数:
 *   finalScore = baseScore * temporalPenalty
 *
 * @param fact 待降权的 fact
 * @param now 当前时间 (Unix ms)
 * @param penaltyRatio 失效 fact 的降权比例, 默认 0.5
 */
export function computeHistoryPenalty(
  fact: RuntimeMemoryQueryableFact,
  now: number,
  penaltyRatio = 0.5,
): number {
  const invalidAt = fact.invalid_at;
  const expiredAt = fact.expired_at;

  if (invalidAt !== undefined && invalidAt <= now) return penaltyRatio;
  if (expiredAt !== undefined && expiredAt <= now) return penaltyRatio;
  return 1.0;
}

// === as_of snapshot 重建 ===

/**
 * as_of snapshot: 重建 T 时刻的 fact 列表.
 *
 * 算法:
 *   1. 过滤掉 T 时刻尚未生效的 fact (valid_at > T)
 *   2. 过滤掉 T 时刻已失效的 fact (invalid_at ≤ T)
 *   3. 过滤掉 T 时刻已过期的 fact (expired_at ≤ T)
 *   4. 返回的 fact 列表即为 "T 时刻的记忆快照"
 *
 * 与 passesTemporalPolicy(as_of) 的区别:
 *   - passesTemporalPolicy 是单个 fact 的过滤判定
 *   - asOfSnapshot 是批量重建, 用于 "回放 T 时刻的完整记忆状态"
 *
 * @param facts 完整 fact 列表
 * @param asOfTime T 时间点 (Unix ms)
 */
export function asOfSnapshot<T extends RuntimeMemoryQueryableFact>(
  facts: readonly T[],
  asOfTime: number,
): T[] {
  return facts.filter((fact) => {
    const result = passesTemporalPolicy(fact, "as_of", asOfTime, asOfTime);
    return result.passes;
  });
}

// === 与 memory-hybrid-retrieval.ts temporalMode 的映射 ===

/**
 * 将 temporalPolicy 映射到 memory-hybrid-retrieval.ts 的 temporalMode.
 *
 * 用于在集成层把高层 policy 翻译成现有检索 API 的参数.
 *
 * - strict_current → "filter" (默认 hard filter)
 * - include_history_ranked → "filter" (允许历史 fact, 但降权由调用方处理)
 * - as_of(T) → "strict" + referenceTime=T (T 时刻严格过滤)
 *
 * 注意: include_history_ranked 下 temporalMode="filter" 会过滤掉
 * invalid_at ≤ now 的 fact — 这与 passesTemporalPolicy 行为不一致.
 * 因此 include_history_ranked 应该用 temporalMode="boost" 或自定义过滤,
 * 调用方应在 preFilter 之后用 passesTemporalPolicy 二次过滤.
 */
export function policyToTemporalMode(
  policy: TemporalPolicy,
): "filter" | "boost" | "strict" {
  switch (policy) {
    case "strict_current":
      return "filter";
    case "include_history_ranked":
      // boost 模式不过滤 invalid_at, 由 retrieval 层降权
      // 但 boost 仍会过滤 valid_at > refTime 的未来 fact
      return "boost";
    case "as_of":
      return "strict";
  }
}

~~~
