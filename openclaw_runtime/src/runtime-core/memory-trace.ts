/**
 * Recall trace schema and helpers (Week 1 v2: 可观测性最小集;
 * Week 7-8 v3: runtimeFingerprint + entityResolution + selectedEdges + evidenceDiscipline).
 *
 * 设计目标:
 * - 每次回答输出结构化 recall trace, 用于组件级 A/B 定位
 * - 避免无 trace 的集成 (集成退步找不到原因的根因)
 * - 字段覆盖: recalledFacts / invalidatedFiltered / bridgeDiscovery /
 *   agentSteps (含 state delta) / cost indicators / temporalPolicy
 * - Week 7-8 新增: runtimeFingerprint (configHash + featureFlags + hashAlg) /
 *   entityResolution (WP2) / selectedEdges (WP3) / evidenceDiscipline (WP4)
 *
 * 这个模块只定义 schema + 输出工具, 不耦合具体检索/生成实现,
 * 任何组件 (AUDN / hybrid retrieval / bridge discovery / reflect) 都可以
 * 通过 RecallTraceBuilder 往 trace 里追加字段.
 *
 * Source: memory-arch-roadmap.md §E.3 (recall trace v2 增强) +
 *         Week 7-8 DEV PROMPT (WP0/WP2/WP3/WP4 trace 字段).
 */

import type { RuntimeFingerprint } from "./memory-runtime-config.js";

/**
 * 单个召回 fact 的 trace 条目.
 */
export type RecallTraceFact = {
  factId: string;
  observationId?: string;
  isCanonical?: boolean;
  armRanks: {
    bm25?: number;
    vector?: number;
    entity?: number;
    temporal?: number;
  };
  finalScore: number;
  ceScore?: number;
  recencyBoost?: number;
  temporalBoost?: number;
  proofCount?: number;
};

/**
 * 被时间窗/失效过滤剔除的 fact.
 */
export type InvalidatedFilteredEntry = {
  factId: string;
  reason: string;
  invalid_at?: number;
  expired_at?: number;
};

/**
 * WP2: Entity resolution 在 bridge 路径上的应用记录.
 *
 * 当 enableEntityResolverInBridge=true 时, 记录 e1/e2 的 canonicalize 过程.
 */
export type EntityResolutionTrace = {
  /** 是否启用 entity resolver */
  applied: boolean;
  /** 输入的原始 entity (e1, e2) */
  input: { e1: string; e2: string };
  /** Canonicalize 后的 entity (可能等于 input) */
  canonical: { e1: string; e2: string };
  /** 匹配的 alias mappings (输入→canonical) */
  mappings: Array<{
    surface: string;
    canonical: string;
    /** 匹配分数 (0-1) */
    score: number;
    /** 匹配方式: name / cooccurrence / temporal / exact */
    matchedBy: string;
  }>;
};

/**
 * WP3: Weighted expansion 选中的边 (best-first traversal).
 *
 * 当 enableWeightedTraversalInExpansion=true 时, 记录扩张路径的边选择.
 */
export type SelectedEdge = {
  fromFactId: string;
  toFactId: string;
  relationType: string;
  /** 分数明细 (便于调试和 A/B 对比) */
  scoreBreakdown: {
    relationWeight: number;
    temporalPass: 0 | 1;
    entityOverlap: number;
    cePrior?: number;
    total: number;
  };
};

/**
 * WP4: Evidence discipline 校验结果.
 *
 * 当 enableEvidenceDiscipline=true 时, 记录 usedFactIds 的校验过程.
 */
export type EvidenceDisciplineTrace = {
  /** 是否启用 evidence discipline */
  enabled: boolean;
  /** 模型输出引用的 fact IDs */
  usedFactIds: string[];
  /** 校验是否通过 (usedFactIds ⊆ recalledFacts ∪ supportFactIdsExpanded) */
  validated: boolean;
  /** 失败原因 (validated=false 时) */
  failureReason?: string;
  /** 是否触发了重新生成 */
  regenerated: boolean;
  /** 重新生成次数 (受 budget 限制) */
  regenerateCount?: number;
};

/**
 * 桥发现 diagnostics (Week 4 用, Week 1 先占位; Week 7-8 扩展 entityResolution/selectedEdges).
 */
export type BridgeDiscoveryTrace = {
  entityPair: [string, string] | null;
  bridgeFactId?: string;
  betweennessScore?: number;
  pathLength?: number;
  timeFilteredOutCount?: number;
  bridgeLiftAtK?: number;
  pathExistence?: boolean;
  /** WP2: entity resolution 应用记录 */
  entityResolution?: EntityResolutionTrace;
  /** WP3: weighted expansion 选中的边 */
  selectedEdges?: SelectedEdge[];
  /** WP3: relationType 直方图 (causes/enables/related_to 各多少条) */
  relationTypeHistogram?: Record<string, number>;
};

/**
 * Agent state-machine 每步的状态增量 (Week 5 用, Week 1 先占位).
 */
export type AgentStepTrace = {
  step: string;
  stateDelta?: {
    hypotheses?: string[];
    constraints?: Record<string, unknown>;
    missingInfo?: string | null;
    nextAction?: string;
  };
};

/**
 * 时间策略 (Week 2 用, Week 1 先占位).
 */
export type TemporalPolicy = "strict_current" | "include_history_ranked" | "as_of";

/**
 * 完整 recall trace.
 */
export type RecallTrace = {
  questionId: string;
  query: string;
  category?: string;
  temporalPolicy?: TemporalPolicy;
  queryIntentKeywords?: string[];
  recalledFacts: RecallTraceFact[];
  invalidatedFiltered: InvalidatedFilteredEntry[];
  bridgeDiscovery: BridgeDiscoveryTrace | null;
  expansionFacts: string[];
  agentSteps: AgentStepTrace[];
  llmCalls: number;
  tokensUsed: number;
  /** Week 7-8 WP0: runtime fingerprint (configHash + featureFlags + hashAlg) */
  runtimeFingerprint?: RuntimeFingerprint;
  /** Week 7-8 WP4: evidence discipline 校验结果 */
  evidenceDiscipline?: EvidenceDisciplineTrace;
};

/**
 * Builder 模式, 让组件按顺序追加字段, 避免一次性构造大对象.
 *
 * 用法:
 *   const builder = createRecallTraceBuilder({ questionId: "Q1", query: "..." });
 *   builder.addRecalledFact({ factId: "f1", finalScore: 0.87, ... });
 *   builder.setBridgeDiscovery({ entityPair: ["Jon","Boston"], ... });
 *   const trace = builder.build();
 */
export type RecallTraceBuilder = {
  setCategory(category: string): void;
  setTemporalPolicy(policy: TemporalPolicy, intentKeywords?: string[]): void;
  setRuntimeFingerprint(fingerprint: RuntimeFingerprint): void;
  addRecalledFact(fact: RecallTraceFact): void;
  addInvalidatedFiltered(entry: InvalidatedFilteredEntry): void;
  setBridgeDiscovery(bridge: BridgeDiscoveryTrace): void;
  addExpansionFact(factId: string): void;
  addExpansionFacts(factIds: readonly string[]): void;
  addAgentStep(step: AgentStepTrace): void;
  addLLMCall(tokens: number): void;
  setEvidenceDiscipline(ed: EvidenceDisciplineTrace): void;
  build(): RecallTrace;
};

export function createRecallTraceBuilder(init: {
  questionId: string;
  query: string;
}): RecallTraceBuilder {
  const trace: RecallTrace = {
    questionId: init.questionId,
    query: init.query,
    recalledFacts: [],
    invalidatedFiltered: [],
    bridgeDiscovery: null,
    expansionFacts: [],
    agentSteps: [],
    llmCalls: 0,
    tokensUsed: 0,
  };

  return {
    setCategory(category) {
      trace.category = category;
    },
    setTemporalPolicy(policy, intentKeywords) {
      trace.temporalPolicy = policy;
      if (intentKeywords) trace.queryIntentKeywords = intentKeywords;
    },
    setRuntimeFingerprint(fingerprint) {
      trace.runtimeFingerprint = fingerprint;
    },
    addRecalledFact(fact) {
      trace.recalledFacts.push(fact);
    },
    addInvalidatedFiltered(entry) {
      trace.invalidatedFiltered.push(entry);
    },
    setBridgeDiscovery(bridge) {
      trace.bridgeDiscovery = bridge;
    },
    addExpansionFact(factId) {
      trace.expansionFacts.push(factId);
    },
    addExpansionFacts(factIds) {
      for (const id of factIds) trace.expansionFacts.push(id);
    },
    addAgentStep(step) {
      trace.agentSteps.push(step);
    },
    addLLMCall(tokens) {
      trace.llmCalls += 1;
      trace.tokensUsed += tokens;
    },
    setEvidenceDiscipline(ed) {
      trace.evidenceDiscipline = ed;
    },
    build() {
      return trace;
    },
  };
}

/**
 * 将 trace 序列化为 JSON 字符串. 用于写入日志或文件.
 */
export function serializeRecallTrace(trace: RecallTrace): string {
  return JSON.stringify(trace);
}

/**
 * 校验 trace 字段完整性. 返回缺失字段列表 (空数组 = 完整).
 *
 * Week 1 验收门槛: trace 覆盖率 100% = 必填字段全部存在.
 * Week 7-8: runtimeFingerprint/evidenceDiscipline 为可选 (feature flag 关闭时不存在).
 */
export function validateRecallTrace(trace: RecallTrace): string[] {
  const missing: string[] = [];

  if (!trace.questionId) missing.push("questionId");
  if (!trace.query) missing.push("query");
  if (!Array.isArray(trace.recalledFacts)) missing.push("recalledFacts");
  if (!Array.isArray(trace.invalidatedFiltered))
    missing.push("invalidatedFiltered");
  if (!Array.isArray(trace.expansionFacts)) missing.push("expansionFacts");
  if (!Array.isArray(trace.agentSteps)) missing.push("agentSteps");
  if (typeof trace.llmCalls !== "number") missing.push("llmCalls");
  if (typeof trace.tokensUsed !== "number") missing.push("tokensUsed");

  return missing;
}

/**
 * 统计 trace 的可观测指标 (用于 A/B 对比).
 *
 * Week 7-8 扩展: 包含 evidenceDiscipline 通过率 (若有).
 */
export function summarizeRecallTrace(trace: RecallTrace): {
  recalledCount: number;
  invalidatedCount: number;
  expansionCount: number;
  agentStepCount: number;
  hasBridge: boolean;
  llmCalls: number;
  tokensUsed: number;
  hasRuntimeFingerprint: boolean;
  hasEvidenceDiscipline: boolean;
  evidenceValidated: boolean | null;
} {
  return {
    recalledCount: trace.recalledFacts.length,
    invalidatedCount: trace.invalidatedFiltered.length,
    expansionCount: trace.expansionFacts.length,
    agentStepCount: trace.agentSteps.length,
    hasBridge: trace.bridgeDiscovery !== null,
    llmCalls: trace.llmCalls,
    tokensUsed: trace.tokensUsed,
    hasRuntimeFingerprint: trace.runtimeFingerprint !== undefined,
    hasEvidenceDiscipline: trace.evidenceDiscipline !== undefined,
    evidenceValidated: trace.evidenceDiscipline?.validated ?? null,
  };
}
