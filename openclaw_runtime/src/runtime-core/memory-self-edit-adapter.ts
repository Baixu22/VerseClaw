/**
 * Agent-callable memory self-edit tools (COMPASS P3 — Agent Loop 集成).
 *
 * Exposes the runtime memory self-edit interface (memory-self-edit-tools.ts)
 * as AnyAgentTool-compatible tools so an agent can actively manage its own
 * long-term memory during a conversation: recall facts, supersede outdated
 * ones, forget invalid ones, and strengthen useful ones.
 *
 * 设计:
 *   - 门控: runtime.memory.persist 关闭时返回 [] (与 memory_query 一致)。
 *     self-edit 是「持久记忆」的编辑面, 依赖 persist=true 是显式决策:
 *     没有 SQLite 语料库时注册这些工具只会产生假成功。
 *   - store 来源: integration.loadStore() (30s TTL 缓存同源)
 *   - 写操作 (update/forget) 通过 integration.invalidateFact / appendFact /
 *     persistRelation 回放落库; strengthen 通过 integration.recordFactAccess
 *     写 runtime_memory_fact_usage。持久化失败一律返回 ok:false (fail-closed),
 *     绝不「成功但只改内存快照」— store 是每次调用重建的副本, 只改它等于丢弃。
 *   - 与 memory_query 的区别: 后者走 hybrid retrieval (BM25 + 向量 + RRF),
 *     本工具走 RuntimeMemoryStore 直接查询/修改 (fact 层)
 */
import { Type } from "typebox";
import type { AnyAgentTool } from "../agents/tools/common.js";
import { payloadTextResult } from "../agents/tools/common.js";
import { runtimeMemoryFlagEnabled } from "./memory-context.js";
import { createRuntimeMemoryRuntimeIntegration } from "./memory-runtime-integration.js";
import {
  executeMemorySelfEditTool,
  type MemorySelfEditToolContext,
  type MemorySelfEditToolName,
} from "./memory-self-edit-tools.js";

const recallSchema = Type.Object({
  subject: Type.Optional(Type.String({ description: "Filter by subject entity." })),
  predicate: Type.Optional(Type.String({ description: "Filter by predicate." })),
  limit: Type.Optional(
    Type.Number({
      description: "Maximum facts to return. Default 5. Capped at 20.",
    }),
  ),
});

const updateSchema = Type.Object({
  factId: Type.String({ description: "ID of the fact to supersede." }),
  subject: Type.Optional(Type.String({ description: "New subject (defaults to existing)." })),
  predicate: Type.Optional(Type.String({ description: "New predicate (defaults to existing)." })),
  object: Type.Optional(Type.String({ description: "New object summary (defaults to existing)." })),
  confidence: Type.Optional(Type.Number({ description: "New confidence 0-1 (defaults to existing)." })),
});

const forgetSchema = Type.Object({
  factId: Type.String({ description: "ID of the fact to invalidate." }),
  reason: Type.Optional(Type.Literal("retracted", { description: "Agent retraction; never implies human rejection." })),
});

const strengthenSchema = Type.Object({
  factId: Type.String({ description: "ID of the fact to strengthen." }),
});

const TOOL_DEFS: ReadonlyArray<{
  name: MemorySelfEditToolName;
  label: string;
  description: string;
  parameters: ReturnType<typeof Type.Object>;
}> = [
  {
    name: "memory_recall",
    label: "Memory Recall",
    description:
      "Search the agent's long-term memory store for facts matching the given subject or predicate. " +
      "Use this before answering questions about prior decisions, preferences, or past events.",
    parameters: recallSchema,
  },
  {
    name: "memory_update",
    label: "Memory Update",
    description:
      "Supersede an existing memory fact with updated information. The old fact is invalidated " +
      "and the new one is persisted. Use when stored information has changed.",
    parameters: updateSchema,
  },
  {
    name: "memory_forget",
    label: "Memory Forget",
    description:
      "Invalidate a memory fact that is no longer accurate or relevant. The fact is marked invalid " +
      "and will no longer be returned by recall.",
    parameters: forgetSchema,
  },
  {
    name: "memory_strengthen",
    label: "Memory Strengthen",
    description:
      "Boost a memory fact's usage signal (agent-observed usefulness). Does not approve or verify the fact.",
    parameters: strengthenSchema,
  },
];

/**
 * 创建 memory self-edit agent tools.
 *
 * @returns AnyAgentTool[]
 *   - []: runtime.memory.persist 未开启, 调用方跳过注册
 *   - AnyAgentTool[]: 可用工具 (memory_recall/update/forget/strengthen)
 */
export function createMemorySelfEditTools(options: {
  config: unknown;
}): AnyAgentTool[] {
  const cfg = options.config;

  // 门控: persist 必须开启 (需要 facts 语料库)
  if (!runtimeMemoryFlagEnabled(cfg, "persist")) {
    return [];
  }

  const resolveContext = (): MemorySelfEditToolContext => {
    const integration = createRuntimeMemoryRuntimeIntegration({ config: cfg });
    const { store } = integration.loadStore();
    return { store, persistence: integration };
  };

  return TOOL_DEFS.map((def) => ({
    name: def.name,
    label: def.label,
    description: def.description,
    parameters: def.parameters,
    displaySummary: def.description.split(".")[0] ?? def.label,
    async execute(_toolCallId, params) {
      try {
        const context = resolveContext();
        const result = await executeMemorySelfEditTool(def.name, params, context);
        return payloadTextResult(result);
      } catch (error) {
        return payloadTextResult({
          ok: false,
          tool: def.name,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
  }));
}
