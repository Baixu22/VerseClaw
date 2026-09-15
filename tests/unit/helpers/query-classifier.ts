// Phase 1: Query Classifier.
//
// 按 query 类型路由到不同检索策略，避免"temporal 问题跑 graph 浪费，
// multi-hop 问题单路又不够"。这是四家 SOTA（Hindsight/Mem0/Memobase/Zep）
// 都未解决的共同短板。
//
// 策略：LLM 优先分类 + 启发式回退。
// - LLM (DeepSeek) 对模糊 query 给出准确分类
// - 启发式 (regex) 在 LLM 失败时提供零延迟回退
//
// 复用已有组件：
// - extractQueryTimeConstraint (query-time-extractor.ts) → temporal timeWindow
// - decomposeSequentialQuestion (runtime-memory-sequential-self-ask.ts) → multi_hop sub-questions
// - callDeepSeek (runtime-memory-real-llm-client.ts) → LLM 调用

import { callDeepSeek, hasDeepSeekKey } from "./runtime-memory-real-llm-client";
import { extractQueryTimeConstraint } from "./query-time-extractor";
import {
  decomposeSequentialQuestion,
} from "./runtime-memory-sequential-self-ask";

// === Types (与 mem-northstar.md §2.2 一致) ===

export type QueryType =
  | "temporal"        // 时间相关："When did...", "How long ago..."
  | "multi_hop"       // 多跳推理：需要跨实体/跨 session 关联
  | "open_domain"     // 开放域：需要外部知识或宽泛概述
  | "single_hop";     // 单跳：直接事实查询

export type RetrievalStrategy =
  | "temporal_priority"   // temporal arm 权重 ×2, 时间窗过滤
  | "multi_hop_deep"      // self-ask 分解 + sub-question 合并
  | "profile_augment"     // profile/mental 注入 + 外部知识 fallback
  | "standard";           // 标准混合检索（OPTIMAL_HYBRID_FUSION）

export interface QueryPlan {
  readonly type: QueryType;
  readonly strategy: RetrievalStrategy;
  readonly armWeights: {
    readonly bm25: number;
    readonly vector: number;
    readonly entity: number;
    readonly temporal?: number;   // 仅 temporal_priority 时定义
    readonly selfAsk?: number;    // 仅 multi_hop_deep 时定义
  };
  readonly rewriteHint?: string;  // 给 Phase 2 feedback loop 的提示
  readonly timeWindow?: {         // 仅 temporal 时定义
    readonly referenceTime: number;
    readonly beforeDays?: number;
    readonly afterDays?: number;
  };
  readonly subQuestions?: string[]; // 仅 multi_hop_deep 时定义
}

// === 启发式分类模式 ===
// 顺序重要：temporal 最优先（最具体），然后 multi_hop，然后 open_domain。
// 注意："how long" 在 memory-temporal-detector.ts 中被归为 multi_hop，
// 但在 North Star §2.3 中明确为 temporal 信号，这里以 North Star 为准。

const TEMPORAL_PATTERNS: readonly RegExp[] = [
  /\bwhen\b/i,
  /\bwhat date\b/i,
  /\bon what day\b/i,
  /\bwhat year\b/i,
  /\bsince when\b/i,
  /\bhow long\b/i,
  /\bhow old\b/i,
  /\bhow many (years|months|weeks|days|hours)\b/i,
  /\bat the time of\b/i,
  /\bin \d{4}\b/i,
  /\bbefore \d{4}\b/i,
  /\bafter \d{4}\b/i,
  /\byears? ago\b/i,
  /\bmonths? ago\b/i,
  /\bweeks? ago\b/i,
  /\bdays? ago\b/i,
  /\blast (year|month|week|day)\b/i,
  /\b(recently|currently|nowadays|these days|lately)\b/i,
];

const MULTI_HOP_PATTERNS: readonly RegExp[] = [
  /\bbefore\b.*\bafter\b/i,
  /\bcompare\b/i,
  /\brelationship between\b/i,
  /\bdifference between\b/i,
  /\bwhat does .* do for\b/i,
  /\bboth .* and\b/i,
  /\bwho .* and\b/i,
  /\bcaused by\b/i,
  /\blead to\b/i,
  /\bbecause of\b/i,
];

const OPEN_DOMAIN_PATTERNS: readonly RegExp[] = [
  /\bwhat can you tell me about\b/i,
  /\btell me about\b/i,
  /\bwhat do you know about\b/i,
  /\bdescribe\b/i,
  /\boverview\b/i,
  /\bsummarize\b/i,
];

// === 启发式分类器（同步，零成本） ===
//
// 检查顺序：multi_hop → temporal → open_domain → single_hop
// multi_hop 优先于 temporal 的原因：
//   "Compare X before and after 2023" 同时匹配 multi_hop (`/\bbefore\b.*\bafter\b/`)
//   和 temporal (`/\bafter \d{4}\b/`)。比较型 query 的主意图是多跳推理，
//   时间词只是参照点，所以 multi_hop 应优先匹配。

export function classifyQueryHeuristic(query: string): QueryType {
  if (!query || typeof query !== "string") return "single_hop";

  if (MULTI_HOP_PATTERNS.some((p) => p.test(query))) return "multi_hop";
  if (TEMPORAL_PATTERNS.some((p) => p.test(query))) return "temporal";
  if (OPEN_DOMAIN_PATTERNS.some((p) => p.test(query))) return "open_domain";
  return "single_hop";
}

// === 各策略的 arm 权重 (North Star §2.4) ===

const ARM_WEIGHTS: Record<RetrievalStrategy, QueryPlan["armWeights"]> = {
  temporal_priority: { bm25: 0.5, vector: 1.0, entity: 0.5, temporal: 1.5 },
  multi_hop_deep: { bm25: 0.5, vector: 1.0, entity: 1.0, selfAsk: 0.8 },
  profile_augment: { bm25: 0.3, vector: 0.8, entity: 0.5 },
  standard: { bm25: 0.5, vector: 1.0, entity: 0.5 },
};

const REWRITE_HINTS: Record<QueryType, string> = {
  temporal: "Expand time window (beforeDays/afterDays ×2) and try synonym expansion for time references.",
  multi_hop: "Decompose into sub-questions; retrieve each separately and merge via RRF.",
  open_domain: "Remove entities not present in memory; focus on searchable keywords.",
  single_hop: "Try synonym replacement and stopword removal.",
};

const STRATEGY_BY_TYPE: Record<QueryType, RetrievalStrategy> = {
  temporal: "temporal_priority",
  multi_hop: "multi_hop_deep",
  open_domain: "profile_augment",
  single_hop: "standard",
};

// === 从 QueryType 构建 QueryPlan ===

export function buildQueryPlan(
  type: QueryType,
  query: string,
  referenceTime?: number,
  subQuestions?: readonly string[],
): QueryPlan {
  const strategy = STRATEGY_BY_TYPE[type];
  const armWeights = ARM_WEIGHTS[strategy];
  const rewriteHint = REWRITE_HINTS[type];

  let timeWindow: QueryPlan["timeWindow"] | undefined;
  if (type === "temporal") {
    const constraint = extractQueryTimeConstraint(query, referenceTime);
    if (constraint.referenceTime !== undefined) {
      timeWindow = {
        referenceTime: constraint.referenceTime,
        beforeDays: 30,
        afterDays: 30,
      };
    }
  }

  const plan: QueryPlan = {
    type,
    strategy,
    armWeights,
    rewriteHint,
  };
  if (timeWindow) (plan as { timeWindow?: unknown }).timeWindow = timeWindow;
  if (subQuestions && subQuestions.length > 0) (plan as { subQuestions?: unknown }).subQuestions = [...subQuestions];
  return plan;
}

// === LLM 分类 prompt ===

const CLASSIFICATION_SYSTEM_PROMPT =
  "You classify a user question into one of four types for memory retrieval routing.\n\n" +
  "Question types:\n" +
  "- temporal: Time-related queries (when, how long ago, what date, relative time references like \"recently\", \"last month\")\n" +
  "- multi_hop: Multi-hop reasoning requiring cross-entity or cross-session inference (e.g., \"What job did X have before Y?\")\n" +
  "- open_domain: Open-domain queries requiring broad summaries or external knowledge (\"tell me about\", \"describe\")\n" +
  "- single_hop: Direct single-fact queries (default fallback)\n\n" +
  "Rules:\n" +
  "- If the question mentions a specific date, year, or relative time, classify as temporal.\n" +
  "- If the question requires linking two or more entities/events across sessions, classify as multi_hop.\n" +
  "- If the question asks for a broad overview or summary, classify as open_domain.\n" +
  "- Otherwise, classify as single_hop.\n\n" +
  'Output format: JSON object {"type": "...", "reasoning": "..."}. No preamble, no markdown.';

// === 解析 LLM 分类响应 ===

export function parseClassificationResponse(content: string): QueryType | null {
  if (!content || typeof content !== "string") return null;

  // 1. 尝试 JSON 解析（含 markdown fence）
  const fenceMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  const cleaned = fenceMatch ? fenceMatch[1].trim() : content.trim();
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);

  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as { type?: string };
      if (parsed.type && isValidQueryType(parsed.type)) {
        return parsed.type as QueryType;
      }
    } catch {
      // JSON 解析失败，继续关键词扫描
    }
  }

  // 2. 回退：关键词扫描
  const lower = content.toLowerCase();
  if (lower.includes("temporal")) return "temporal";
  if (lower.includes("multi_hop") || lower.includes("multi-hop") || lower.includes("multihop")) return "multi_hop";
  if (lower.includes("open_domain") || lower.includes("open-domain") || lower.includes("opendomain")) return "open_domain";
  if (lower.includes("single_hop") || lower.includes("single-hop") || lower.includes("singlehop")) return "single_hop";

  return null;
}

function isValidQueryType(s: string): boolean {
  return s === "temporal" || s === "multi_hop" || s === "open_domain" || s === "single_hop";
}

// === callDeepSeek 适配器（匹配 decomposeSequentialQuestion 的 callLLM 签名） ===

async function callLLMForDecompose(
  system: string,
  user: string,
  options?: { temperature?: number; maxTokens?: number },
): Promise<{ content: string }> {
  const res = await callDeepSeek(system, user, options);
  return { content: res.content };
}

// === 主接口：分类 + 规划 (LLM 优先 + 启发式回退) ===

export async function classifyQuery(
  query: string,
  options?: {
    conversationContext?: string;
    referenceTime?: number;
  },
): Promise<QueryPlan> {
  const referenceTime = options?.referenceTime;

  // 空 query 直接走 single_hop
  if (!query || query.trim().length === 0) {
    return buildQueryPlan("single_hop", query, referenceTime);
  }

  // LLM 优先分类
  if (hasDeepSeekKey()) {
    try {
      const userPrompt = options?.conversationContext
        ? `Context: ${options.conversationContext}\n\nQuestion: ${query}`
        : `Question: ${query}`;

      const response = await callDeepSeek(
        CLASSIFICATION_SYSTEM_PROMPT,
        userPrompt,
        { temperature: 0, maxTokens: 120 },
      );

      const type = parseClassificationResponse(response.content);
      if (type) {
        // multi_hop 时分解 sub-questions（额外 LLM 调用）
        let subQuestions: string[] | undefined;
        if (type === "multi_hop") {
          try {
            const decomposition = await decomposeSequentialQuestion(
              query,
              callLLMForDecompose,
            );
            subQuestions = decomposition.subQuestions;
          } catch {
            // 分解失败 — 仍按 multi_hop 策略继续（检索时可懒分解）
          }
        }
        return buildQueryPlan(type, query, referenceTime, subQuestions);
      }
    } catch {
      // LLM 失败 — 回退到启发式
    }
  }

  // 启发式回退
  const heuristicType = classifyQueryHeuristic(query);
  return buildQueryPlan(heuristicType, query, referenceTime);
}
