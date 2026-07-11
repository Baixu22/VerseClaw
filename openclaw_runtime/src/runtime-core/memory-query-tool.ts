/**
 * Agent-callable `memory_query` tool (COMPASS P3 — Agent Loop 集成).
 *
 * 让 agent 在对话中主动查询 memory, 支持随时插入.
 * agent 缺信息时可调用此工具检索 facts, 结果作为 ToolResultMessage 回到对话.
 *
 * 设计:
 *   - 复用 hybridSearchFactsWithEmbedding (BM25 + 实体 RRF)
 *   - 使用 NO_EMBEDDING_PROVIDER 降级为 BM25 + 3-gram TF-IDF, 延迟 < 10ms
 *   - 复用 loadCompassFacts 的 30s TTL 缓存
 *   - 受 runtime.memory.persist 门控 (persist 关闭时 factory 返回 null)
 *
 * 与 memory-self-edit-tools.ts 的区别:
 *   - 后者用 RuntimeMemoryStore (内存层直接查询), 不走 hybrid retrieval
 *   - 本工具走 hybridSearchFactsWithEmbedding (BM25 + 向量 + 实体 RRF)
 *   - 后者用 MemorySelfEditTool 类型 (handler 签名不兼容 AnyAgentTool)
 */

import { Type } from "typebox";
import type { AnyAgentTool } from "../agents/tools/common.js";
import { payloadTextResult } from "../agents/tools/common.js";
import {
  hybridSearchFactsWithEmbedding,
  type HybridSearchHit,
} from "./memory-hybrid-retrieval.js";
import { NO_EMBEDDING_PROVIDER } from "./memory-embedding-provider.js";
import { runtimeMemoryFlagEnabled } from "./memory-context.js";
import {
  loadCompassFacts,
  resolveCompassConfig,
} from "./memory-pre-reply-injection.js";

// === Tool Schema ===

const memoryQuerySchema = Type.Object({
  query: Type.String({
    description:
      "Natural language query to search the memory store. Use entity names or topic keywords for best results.",
  }),
  topK: Type.Optional(
    Type.Number({
      description: "Maximum number of facts to return. Default 5. Capped at 20 to prevent context overflow.",
    }),
  ),
  subject: Type.Optional(
    Type.String({
      description: "Filter results by subject entity (e.g. 'alice', 'project_alpha').",
    }),
  ),
});

// === Tool Result Types ===

interface MemoryQueryFactItem {
  factId: string;
  subject: string;
  predicate: string;
  objectSummary: string;
  confidence: number;
  validAt: number;
}

interface MemoryQueryResult {
  ok: boolean;
  message: string;
  count: number;
  facts: MemoryQueryFactItem[];
}

// === Tool Factory ===

/**
 * 创建 memory_query agent tool.
 *
 * @returns AnyAgentTool | null
 *   - null: runtime.memory.persist 未开启或 COMPASS disabled, 调用方跳过注册
 *   - AnyAgentTool: 可用工具
 */
export function createMemoryQueryTool(options: {
  config: unknown;
}): AnyAgentTool | null {
  const cfg = options.config;

  // 门控: persist 必须开启 (需要 facts 语料库)
  if (!runtimeMemoryFlagEnabled(cfg, "persist")) {
    return null;
  }

  // 门控: COMPASS 不能被全局禁用 (OPENCLAW_COMPASS_DISABLE=1)
  const compassConfig = resolveCompassConfig(cfg);
  if (!compassConfig.featureFlags.enableSessionStatePage) {
    return null;
  }

  return {
    name: "memory_query",
    label: "memory_query",
    description:
      "Search the agent's long-term memory store for facts about people, projects, " +
      "preferences, or past events. Use this when you need information that was mentioned " +
      "in earlier conversations or stored as a fact. Returns matching facts with confidence " +
      "scores. If you don't find what you need, try refining your query with more specific " +
      "entity names.",
    parameters: memoryQuerySchema,
    displaySummary: "Search long-term memory for facts",
    async execute(toolCallId, params, _signal, _onUpdate) {
      const args = params as { query?: string; topK?: number; subject?: string };
      const queryText = args.query?.trim();
      if (!queryText) {
        return payloadTextResult({
          ok: false,
          message: "Missing required parameter: query.",
          count: 0,
          facts: [],
        } satisfies MemoryQueryResult);
      }

      // ── Payload 大小边界 (文档化) ─────────────────────────────────────────────
      // topK 默认 5, 最大 20 (防御性上限, 防止 context 溢出).
      // 单 fact.objectSummary 无长度限制; 最坏情况 topK=20 × 500 chars ≈ 2500 tokens.
      // 缓解建议 (深度设计阶段): 对 hits.objectSummary 截断到 300 chars, 或纳入 Pressure Controller 预算.
      const effectiveTopK = Math.min(
        typeof args.topK === "number" && args.topK > 0 ? args.topK : 5,
        20,
      );
      const subjectFilter = args.subject?.trim() || undefined;

      // 加载 facts 语料库 (复用 30s TTL 缓存)
      const facts = loadCompassFacts(cfg);
      if (facts.length === 0) {
        return payloadTextResult({
          ok: false,
          message: "Memory store is empty or not enabled.",
          count: 0,
          facts: [],
        } satisfies MemoryQueryResult);
      }

      try {
        const hits = await hybridSearchFactsWithEmbedding(
          facts,
          {
            queryText,
            topK: effectiveTopK,
            referenceTime: Date.now(),
            ...(subjectFilter ? { subject: subjectFilter } : {}),
          },
          NO_EMBEDDING_PROVIDER,
        );

        const factItems: MemoryQueryFactItem[] = hits.map((hit) => mapHitToItem(hit));
        const result: MemoryQueryResult = {
          ok: true,
          message: `Found ${factItems.length} fact(s) matching "${queryText}".`,
          count: factItems.length,
          facts: factItems,
        };
        return payloadTextResult(result);
      } catch (err) {
        return payloadTextResult({
          ok: false,
          message: `Memory query failed: ${String(err)}`,
          count: 0,
          facts: [],
        } satisfies MemoryQueryResult);
      }
    },
  };
}

// === Helpers ===

function mapHitToItem(hit: HybridSearchHit): MemoryQueryFactItem {
  const fact = hit.fact;
  return {
    factId: fact.factId,
    subject: fact.subject,
    predicate: fact.predicate,
    objectSummary: fact.objectSummary,
    confidence: typeof fact.confidence === "number" ? fact.confidence : 0,
    validAt: fact.valid_at,
  };
}
