// Week 4 v2 + Week 7-8 WP2/WP3: 桥发现 (bridge discovery) + 可观测指标.
//
// Source: memory-arch-roadmap.md §B4, §C.4, Week 4 + Week 7-8 DEV PROMPT WP2/WP3
//
// 两阶段 multi-hop:
//   Stage 1: bridge discovery — 从 query 抽取 entity pair (e1, e2),
//            找同时连接 e1 和 e2 的桥 fact (high betweenness)
//   Stage 2: constrained expansion — 从桥 fact 出发, 沿 causal/enables 边
//            扩张 1 跳 (memory-chained-retrieval.ts maxDepth=1, cap=5)
//
// 可观测指标 (v2, 必须有严格定义):
//   1. Bridge Lift@K: 桥 discovery 返回的 bridge fact, 能否让第二阶段
//      constrained expansion 的最终 top-N 中出现 "answer-supporting fact"
//   2. Path Existence Rate: bridge candidate 的 entityPair (e1, e2) 在当前
//      memory graph 中是否存在长度 ≤ L 的路径, 且路径上的 facts 都满足时间窗
//   3. timeFilteredOutCount: 因 invalid_at < now 被剔除的桥候选数量
//
// Week 7-8 WP2: EntityResolver 接入 (enableEntityResolverInBridge flag)
//   - extractEntityPairFromQuery() 后 canonicalize e1/e2
//   - discoverBridges() / checkPathExistence() 候选 fact entities canonicalize
//   - BridgeDiagnostics 增加 entityResolutionApplied / entityResolutionMappings
//
// Week 7-8 WP3: Weighted traversal 接入 (enableWeightedTraversalInExpansion flag)
//   - constrainedExpansionFromBridge() 改 best-first 排序 (偏向 causal 边)
//   - score = relationWeight (causes=2.0/enables=1.5/related_to=1.0)
//             + temporalPass + entityOverlap + cePrior (tie-breaker)
//   - BridgeDiagnostics 增加 selectedEdges / relationTypeHistogram
//
// 与 Hindsight 区别:
//   - Hindsight Reflect: LLM 多轮 (成本高)
//   - ClawX 桥发现: 确定性图算法 (zero LLM cost) + EntityResolver + Weighted
//   - Hindsight BFS: 无方向
//   - ClawX 桥发现: 有明确目标 (e1 → bridge → e2) + causal 边优先

import type {
  RuntimeMemoryQueryableFact,
} from "./memory-context.js";
import { passesTemporalPolicy } from "./memory-temporal-policy.js";
import type { TemporalPolicy } from "./memory-trace.js";
// Week 7-8 WP2: EntityResolver (canonicalize e1/e2 + 候选 fact entities)
import type { AliasTable } from "./memory-entity-resolver.js";
// Week 7-8 WP3: Weighted traversal 排序 (best-first, 偏向 causal 边)
import { CAUSAL_EDGE_WEIGHT } from "./memory-weighted-traversal.js";
import type { SelectedEdge } from "./memory-trace.js";

// === Schema ===

/**
 * 桥候选: multi-hop 查询的桥接 fact.
 *
 * 一个桥 fact 同时连接 e1 和 e2 (即 subject/object 包含 e1 和 e2, 或通过
 * observation 的 entityIds 同时包含 e1 和 e2).
 */
export type BridgeCandidate = {
  /** 桥 ID (deterministic: hash of factId + entityPair) */
  bridgeId: string;
  /** 桥 fact ID */
  factId: string;
  /** 实体对 (e1, e2) */
  entityPair: { e1: string; e2: string };
  /** 中介中心性分数 (0-1, 越高越适合做桥) */
  betweennessScore: number;
  /** 因果可达性 (0-1, 沿 causal 边能到达 e2 的概率) */
  causalReachability: number;
  /** 时间有效性 (1 = 当前有效, 0 = 已失效) */
  validity: 0 | 1;
  /** 桥 fact 本身 */
  fact: RuntimeMemoryQueryableFact;
};

/**
 * 桥发现可观测指标 (写入 recall trace).
 *
 * Week 7-8 WP2/WP3 扩展:
 *   - entityResolutionApplied / entityResolutionMappings (WP2)
 *   - selectedEdges / relationTypeHistogram (WP3)
 */
export type BridgeDiagnostics = {
  /** 输入的实体对 (e1, e2) */
  entityPair: { e1: string; e2: string };
  /** 找到的桥候选数量 */
  bridgeCandidateCount: number;
  /** 因时间过滤被剔除的桥候选数量 */
  timeFilteredOutCount: number;
  /** 最终选定的桥 fact ID (null = 未找到桥) */
  selectedBridgeFactId: string | null;
  /** 桥到 e2 的路径长度 (跳数) */
  pathLength: number;
  /**
   * Bridge Lift@K: 桥 discovery 后, constrained expansion 的最终 top-N 中
   * 是否出现 "answer-supporting fact" (1 = 是, 0 = 否).
   * 调用方在第二阶段后回填.
   */
  bridgeLiftAtK: 0 | 1;
  /**
   * Path Existence: bridge candidate 的 entityPair (e1, e2) 在当前 memory graph
   * 中是否存在长度 ≤ L 的路径, 且路径上的 facts 都满足时间窗.
   */
  pathExistence: boolean;
  /**
   * Week 7-8 WP2: 是否应用了 entity resolver.
   * false = flag 关闭或无 resolver; true = e1/e2/候选 fact entities 已 canonicalize.
   */
  entityResolutionApplied?: boolean;
  /**
   * Week 7-8 WP2: entity resolution 的映射记录 (输入→canonical).
   * 仅当 entityResolutionApplied=true 时填充.
   */
  entityResolutionMappings?: Array<{
    surface: string;
    canonical: string;
    score: number;
    matchedBy: string;
  }>;
  /**
   * Week 7-8 WP3: weighted expansion 选中的边 (best-first traversal).
   * 仅当 enableWeightedTraversalInExpansion=true 时填充.
   */
  selectedEdges?: SelectedEdge[];
  /**
   * Week 7-8 WP3: relationType 直方图 (causes/enables/related_to 各多少条).
   * 仅当 enableWeightedTraversalInExpansion=true 时填充.
   */
  relationTypeHistogram?: Record<string, number>;
};

// === 桥发现主算法 ===

/**
 * Stage 1: 桥发现 — 从 query 抽取 entity pair (e1, e2), 找同时连接 e1 和 e2 的桥 fact.
 *
 * 算法:
 *   1. 从 query 抽取 entity pair (e1, e2) (调用方提供, 或用 extractEntityPairFromQuery)
 *   2. 遍历所有 fact, 找同时包含 e1 和 e2 的 fact (subject/object/entityIds 包含)
 *      → 这些是桥候选
 *   3. 对每个桥候选计算 betweennessScore:
 *      - 同时包含 e1+e2: 1.0
 *      - 仅包含 e1, 但通过 observation 链接到 e2: 0.6
 *      - 仅包含 e2, 但通过 observation 链接到 e1: 0.6
 *   4. 用 temporalPolicy 过滤 (invalid_at < now 剔除, 计入 timeFilteredOutCount)
 *   5. 按 betweennessScore 降序排序
 *   6. 返回 top-K 桥候选 + diagnostics
 *
 * @param entityPair 实体对 (e1, e2)
 * @param facts 全部 fact 列表 (含 entityIds 字段)
 * @param temporalPolicy 时间策略 (默认 strict_current)
 * @param now 当前时间 (Unix ms)
 * @param options topK / maxPathLength
 */
export function discoverBridges(
  entityPair: { e1: string; e2: string },
  facts: readonly RuntimeMemoryQueryableFact[],
  temporalPolicy: TemporalPolicy = "strict_current",
  now: number = Date.now(),
  options: {
    topK?: number;
    maxPathLength?: number;
    /**
     * Week 7-8 WP2: Entity resolver (AliasTable). 当传入时, e1/e2/候选 fact
     * entities 会被 canonicalize, 提升同义实体 (Jon/John) 的命中率.
     * 由 enableEntityResolverInBridge flag 控制.
     */
    resolver?: AliasTable | null;
  } = {},
): { candidates: BridgeCandidate[]; diagnostics: BridgeDiagnostics } {
  const topK = options.topK ?? 5;
  const maxPathLength = options.maxPathLength ?? 3;
  const resolver = options.resolver ?? null;

  // Week 7-8 WP2: canonicalize e1/e2 (若有 resolver)
  let canonicalE1 = entityPair.e1;
  let canonicalE2 = entityPair.e2;
  const resolutionMappings: Array<{
    surface: string;
    canonical: string;
    score: number;
    matchedBy: string;
  }> = [];

  if (resolver) {
    const resolvedE1 = resolver.resolve(entityPair.e1);
    const resolvedE2 = resolver.resolve(entityPair.e2);
    if (resolvedE1 !== entityPair.e1) {
      const entry = resolver.getEntry(resolvedE1);
      resolutionMappings.push({
        surface: entityPair.e1,
        canonical: resolvedE1,
        score: entry?.confidence ?? 1.0,
        matchedBy: entry ? "alias_table" : "exact",
      });
    }
    if (resolvedE2 !== entityPair.e2) {
      const entry = resolver.getEntry(resolvedE2);
      resolutionMappings.push({
        surface: entityPair.e2,
        canonical: resolvedE2,
        score: entry?.confidence ?? 1.0,
        matchedBy: entry ? "alias_table" : "exact",
      });
    }
    canonicalE1 = resolvedE1;
    canonicalE2 = resolvedE2;
  }

  const canonicalPair = { e1: canonicalE1, e2: canonicalE2 };

  const candidates: BridgeCandidate[] = [];
  let timeFilteredOutCount = 0;

  // 遍历所有 fact, 找桥候选
  for (const fact of facts) {
    const rawEntityIds = (fact as { entityIds?: string[] }).entityIds ?? [];
    // Week 7-8 WP2: canonicalize 候选 fact 的 entities (若有 resolver)
    const entityIds = resolver
      ? rawEntityIds.map((e) => resolver.resolve(e))
      : rawEntityIds;
    const allText = `${fact.subject} ${fact.predicate} ${fact.objectSummary}`.toLowerCase();
    const e1Lower = canonicalPair.e1.toLowerCase();
    const e2Lower = canonicalPair.e2.toLowerCase();

    const hasE1 =
      entityIds.some((e) => e.toLowerCase() === e1Lower) ||
      allText.includes(e1Lower);
    const hasE2 =
      entityIds.some((e) => e.toLowerCase() === e2Lower) ||
      allText.includes(e2Lower);

    if (!hasE1 && !hasE2) continue;

    // 时间过滤
    const temporalResult = passesTemporalPolicy(fact, temporalPolicy, now);
    if (!temporalResult.passes) {
      timeFilteredOutCount += 1;
      continue;
    }

    // 计算 betweennessScore
    let betweennessScore = 0;
    if (hasE1 && hasE2) {
      betweennessScore = 1.0; // 直接桥
    } else if (hasE1 || hasE2) {
      betweennessScore = 0.6; // 间接桥 (需 expansion 验证)
    }

    // causalReachability: 暂用 0.5 (Week 4 不实现完整因果图, 留 Week 5)
    const causalReachability = 0.5;

    const candidate: BridgeCandidate = {
      bridgeId: computeBridgeId(fact.factId, canonicalPair),
      factId: fact.factId,
      entityPair: canonicalPair,
      betweennessScore,
      causalReachability,
      validity: 1,
      fact,
    };
    candidates.push(candidate);
  }

  // 按 betweennessScore 降序排序
  candidates.sort((a, b) => b.betweennessScore - a.betweennessScore);
  const topCandidates = candidates.slice(0, topK);

  // Path Existence: 检查 e1 → e2 是否存在长度 ≤ maxPathLength 的路径
  // Week 7-8 WP2: 用 canonicalPair 和 resolver 做路径检查
  const pathExistence = checkPathExistence(
    canonicalPair,
    facts,
    maxPathLength,
    temporalPolicy,
    now,
    resolver,
  );

  const diagnostics: BridgeDiagnostics = {
    entityPair: canonicalPair,
    bridgeCandidateCount: topCandidates.length,
    timeFilteredOutCount,
    selectedBridgeFactId: topCandidates[0]?.factId ?? null,
    pathLength: topCandidates[0] ? 1 : 0, // 直接桥 pathLength=1
    bridgeLiftAtK: 0, // 调用方在第二阶段后回填
    pathExistence,
    // Week 7-8 WP2: entity resolution trace
    entityResolutionApplied: resolver !== null,
    entityResolutionMappings: resolutionMappings,
  };

  return { candidates: topCandidates, diagnostics };
}

/**
 * Stage 2 后处理: 回填 Bridge Lift@K.
 *
 * 调用方在 constrained expansion 完成后, 检查 top-N 中是否包含
 * answer-supporting fact, 然后调用此函数回填 diagnostics.bridgeLiftAtK.
 *
 * @param diagnostics 桥发现阶段的 diagnostics
 * @param expansionTopFactIds 第二阶段 expansion 的 top-N fact IDs
 * @param answerSupportingFactIds LoCoMo judge 标注的 supporting facts (ground truth)
 */
export function backfillBridgeLiftAtK(
  diagnostics: BridgeDiagnostics,
  expansionTopFactIds: readonly string[],
  answerSupportingFactIds: readonly string[],
): BridgeDiagnostics {
  const expansionSet = new Set(expansionTopFactIds);
  const supportSet = new Set(answerSupportingFactIds);
  const hasOverlap = [...expansionSet].some((id) => supportSet.has(id));
  return {
    ...diagnostics,
    bridgeLiftAtK: hasOverlap ? 1 : 0,
  };
}

// === Entity pair 抽取 ===

/**
 * 从 query 文本抽取 entity pair (e1, e2).
 *
 * 启发式:
 *   1. 从 query 中提取所有 capitalized words / 引号包围的字符串
 *   2. 取前两个作为 (e1, e2)
 *   3. 若不足两个, 返回 null (无法做桥发现)
 *
 * 调用方也可直接提供 entityPair (例如从 LLM 抽取), 跳过此函数.
 *
 * Week 4 v2: 简化版, 仅做 capitalized word 抽取.
 * Week 5 可增强为 LLM-based entity linking.
 */
export function extractEntityPairFromQuery(query: string): {
  e1: string;
  e2: string;
} | null {
  if (!query || typeof query !== "string") return null;

  // 1. 引号包围的字符串
  const quoted = query.match(/[""']([^""']{2,30})[""']/g);
  const quotedEntities = quoted?.map((s) =>
    s.replace(/[""']/g, "").trim(),
  ) ?? [];

  // 2. Capitalized words (英文) + 中文专有名词 (简化: 2-4 字连续中文)
  const capitalized = query.match(/\b[A-Z][a-z]{2,15}\b/g) ?? [];
  const chineseProperNouns = query.match(/[\u4e00-\u9fa5]{2,4}/g) ?? [];

  // 合并候选, 去重, 过滤常见停用词
  const stopWords = new Set([
    "The", "What", "How", "Why", "When", "Where", "Who",
    "Did", "Does", "Is", "Are", "Was", "Were",
  ]);
  const candidates: string[] = [];
  const seen = new Set<string>();
  for (const e of [...quotedEntities, ...capitalized, ...chineseProperNouns]) {
    const trimmed = e.trim();
    if (trimmed.length < 2) continue;
    if (stopWords.has(trimmed)) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push(trimmed);
  }

  if (candidates.length < 2) return null;
  return { e1: candidates[0], e2: candidates[1] };
}

// === Path Existence 检查 ===

/**
 * 检查 e1 → e2 是否存在长度 ≤ maxPathLength 的路径, 且路径上的 facts 都满足时间窗.
 *
 * 算法: BFS, 从 e1 出发, 沿 fact 的 subject/object/entityIds 边扩张,
 * 每跳检查 fact 是否满足 temporalPolicy, 直到找到 e2 或达到 maxPathLength.
 *
 * @returns true = 存在满足条件的路径
 */
export function checkPathExistence(
  entityPair: { e1: string; e2: string },
  facts: readonly RuntimeMemoryQueryableFact[],
  maxPathLength: number,
  temporalPolicy: TemporalPolicy,
  now: number,
  /**
   * Week 7-8 WP2: Entity resolver. 当传入时, 路径上的 entities 会被
   * canonicalize, 使 "Jon → fact → John" 能被识别为路径存在.
   */
  resolver: AliasTable | null = null,
): boolean {
  const e1Lower = entityPair.e1.toLowerCase();
  const e2Lower = entityPair.e2.toLowerCase();

  // 构建实体 → facts 索引 (Week 7-8 WP2: canonicalize entities 若有 resolver)
  const entityToFacts = new Map<string, string[]>();
  for (const fact of facts) {
    const rawEntityIds = (fact as { entityIds?: string[] }).entityIds ?? [];
    const entityIds = resolver
      ? rawEntityIds.map((e) => resolver.resolve(e))
      : rawEntityIds;
    const allText = `${fact.subject} ${fact.objectSummary}`.toLowerCase();
    const factEntities: string[] = [];

    // 从 entityIds 收集
    for (const e of entityIds) {
      factEntities.push(e.toLowerCase());
    }
    // 从 subject/objectSummary 文本提取 (简化: 包含关系)
    for (const word of allText.split(/\s+/)) {
      const w = word.replace(/[^a-z0-9\u4e00-\u9fa5]/g, "");
      if (w.length >= 2) factEntities.push(w);
    }

    for (const e of factEntities) {
      const arr = entityToFacts.get(e) ?? [];
      arr.push(fact.factId);
      entityToFacts.set(e, arr);
    }
  }

  // BFS: 从 e1 出发, 找 e2
  const visited = new Set<string>([e1Lower]);
  let frontier: string[] = [e1Lower];

  for (let depth = 0; depth < maxPathLength; depth++) {
    const nextFrontier: string[] = [];
    for (const entity of frontier) {
      const factIds = entityToFacts.get(entity) ?? [];
      for (const factId of factIds) {
        // 找到 fact, 检查时间有效性
        const fact = facts.find((f) => f.factId === factId);
        if (!fact) continue;
        const temporalResult = passesTemporalPolicy(fact, temporalPolicy, now);
        if (!temporalResult.passes) continue;

        // 从 fact 提取所有实体 (Week 7-8 WP2: canonicalize), 加入 frontier
        const factEntities = extractEntitiesFromFact(fact, resolver);
        for (const e of factEntities) {
          if (e === e2Lower) return true; // 找到路径!
          if (!visited.has(e)) {
            visited.add(e);
            nextFrontier.push(e);
          }
        }
      }
    }
    frontier = nextFrontier;
    if (frontier.length === 0) break;
  }

  return false;
}

/**
 * 从 fact 提取实体 (subject + entityIds + objectSummary 中的词).
 *
 * Week 7-8 WP2: 若传入 resolver, entities 会被 canonicalize.
 */
function extractEntitiesFromFact(
  fact: RuntimeMemoryQueryableFact,
  resolver: AliasTable | null = null,
): string[] {
  const rawEntityIds = (fact as { entityIds?: string[] }).entityIds ?? [];
  const entityIds = resolver
    ? rawEntityIds.map((e) => resolver.resolve(e))
    : rawEntityIds;
  const result: string[] = [];
  for (const e of entityIds) {
    result.push(e.toLowerCase());
  }
  // subject (Week 7-8 WP2: canonicalize 若有 resolver)
  const subject = resolver ? resolver.resolve(fact.subject) : fact.subject;
  result.push(subject.toLowerCase());
  // objectSummary 中的词 (简化)
  const words = fact.objectSummary
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/[^a-z0-9\u4e00-\u9fa5]/g, ""))
    .filter((w) => w.length >= 2);
  result.push(...words);
  return result;
}

// === 工具函数 ===

/**
 * 计算桥 ID: hash of factId + entityPair.
 */
export function computeBridgeId(
  factId: string,
  entityPair: { e1: string; e2: string },
): string {
  const input = `${factId}|${entityPair.e1}|${entityPair.e2}`;
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) & 0xffffffff;
  }
  const hex = (hash >>> 0).toString(16);
  return `bridge_${hex}`;
}

// === Week 7-8 WP3: Weighted expansion (best-first, 偏向 causal 边) ===

/**
 * WP3: Weighted expansion 从桥 fact 出发, 按 best-first 排序扩张.
 *
 * 与原 constrainedExpansionFromBridge (memory-chained-retrieval.ts) 区别:
 *   - 原版: 简单 BFS slice (无排序)
 *   - WP3: 按 score 排序, score = relationWeight + temporalPass + entityOverlap + cePrior
 *
 * score 组成:
 *   - relationWeight: causes/caused_by=2.0, enables/prevents=1.5, related_to=1.0
 *   - temporalPass: 通过 temporalPolicy=1, 否则剔除 (不入候选)
 *   - entityOverlap: 与桥 fact 的 canonicalized entity overlap count
 *   - cePrior (可选): cross-encoder 分数 (tie-breaker)
 *
 * 由 enableWeightedTraversalInExpansion flag 控制. 默认 false, 调用原版.
 *
 * @param bridgeFactIds 桥 fact IDs (Stage 1 输出)
 * @param relationMap factId → factId[] 邻接表 (含 relationType 信息)
 * @param factsById fact ID → fact 映射
 * @param relations 显式 fact relations (含 relationType), 用于 score 计算
 * @param temporalPolicy 时间策略
 * @param now 当前时间
 * @param options maxDepth=1 / maxExpansion=5 / resolver / ceScores
 * @returns expansionFactIds + selectedEdges (trace) + relationTypeHistogram
 */
export function weightedExpansionFromBridge(
  bridgeFactIds: readonly string[],
  relationMap: Map<string, string[]>,
  factsById: Map<string, RuntimeMemoryQueryableFact>,
  relations: ReadonlyArray<{
    sourceFactId: string;
    targetFactId: string;
    relationType: string;
    confidence: number;
  }>,
  temporalPolicy: TemporalPolicy = "strict_current",
  now: number = Date.now(),
  options: {
    maxDepth?: number;
    maxExpansion?: number;
    resolver?: AliasTable | null;
    /** 可选: factId → ceScore 映射 (tie-breaker) */
    ceScores?: Map<string, number>;
  } = {},
): {
  expansionFactIds: string[];
  selectedEdges: SelectedEdge[];
  relationTypeHistogram: Record<string, number>;
} {
  const maxDepth = options.maxDepth ?? 1;
  const maxExpansion = options.maxExpansion ?? 5;
  const resolver = options.resolver ?? null;
  const ceScores = options.ceScores ?? new Map<string, number>();

  if (bridgeFactIds.length === 0) {
    return { expansionFactIds: [], selectedEdges: [], relationTypeHistogram: {} };
  }

  // 构建 fact pair → relationType/confidence 索引
  const relationByPair = new Map<
    string,
    { relationType: string; confidence: number }
  >();
  for (const rel of relations) {
    const key =
      rel.sourceFactId < rel.targetFactId
        ? `${rel.sourceFactId}|${rel.targetFactId}`
        : `${rel.targetFactId}|${rel.sourceFactId}`;
    // 若多 relation 取最高 confidence
    const existing = relationByPair.get(key);
    if (!existing || rel.confidence > existing.confidence) {
      relationByPair.set(key, {
        relationType: rel.relationType,
        confidence: rel.confidence,
      });
    }
  }

  // 桥 fact 的 canonicalized entity 集合
  const bridgeEntitySets = new Map<string, Set<string>>();
  for (const bridgeId of bridgeFactIds) {
    const fact = factsById.get(bridgeId);
    if (!fact) continue;
    const rawEntities = (fact as { entityIds?: string[] }).entityIds ?? [];
    const entities = resolver
      ? rawEntities.map((e) => resolver.resolve(e).toLowerCase())
      : rawEntities.map((e) => e.toLowerCase());
    bridgeEntitySets.set(bridgeId, new Set(entities));
  }

  // 候选边: (fromBridge, toFact, relationType, score)
  type CandidateEdge = {
    fromFactId: string;
    toFactId: string;
    relationType: string;
    relationWeight: number;
    temporalPass: 0 | 1;
    entityOverlap: number;
    cePrior: number;
    total: number;
  };

  const bridgeSet = new Set(bridgeFactIds);
  const candidates: CandidateEdge[] = [];

  for (const bridgeId of bridgeFactIds) {
    const related = getRelatedFactIdsFromMap(bridgeId, relationMap, maxDepth);
    for (const rId of related) {
      if (bridgeSet.has(rId) || !factsById.has(rId)) continue;

      const fact = factsById.get(rId)!;

      // 时间过滤: 不通过则剔除 (不入候选)
      const temporalResult = passesTemporalPolicy(fact, temporalPolicy, now);
      if (!temporalResult.passes) continue;

      // 查找 relationType
      const pairKey =
        bridgeId < rId ? `${bridgeId}|${rId}` : `${rId}|${bridgeId}`;
      const relInfo = relationByPair.get(pairKey);
      const relationType = relInfo?.relationType ?? "related_to";
      const relationWeight = CAUSAL_EDGE_WEIGHT[relationType] ?? 1.0;
      const confidence = relInfo?.confidence ?? 1.0;

      // entity overlap
      const bridgeEntities = bridgeEntitySets.get(bridgeId) ?? new Set<string>();
      const rawFactEntities = (fact as { entityIds?: string[] }).entityIds ?? [];
      const factEntities = resolver
        ? rawFactEntities.map((e) => resolver.resolve(e).toLowerCase())
        : rawFactEntities.map((e) => e.toLowerCase());
      let entityOverlap = 0;
      for (const e of factEntities) {
        if (bridgeEntities.has(e)) entityOverlap += 1;
      }

      // cePrior (tie-breaker)
      const cePrior = ceScores.get(rId) ?? 0;

      // total score
      const total =
        relationWeight * Math.max(0, Math.min(1, confidence)) +
        1 * 1 + // temporalPass=1 (已过滤)
        entityOverlap * 0.5 +
        cePrior * 0.1;

      candidates.push({
        fromFactId: bridgeId,
        toFactId: rId,
        relationType,
        relationWeight,
        temporalPass: 1,
        entityOverlap,
        cePrior,
        total,
      });
    }
  }

  // best-first 排序 (total 降序)
  candidates.sort((a, b) => b.total - a.total);
  const topCandidates = candidates.slice(0, maxExpansion);

  // 构造 trace
  const selectedEdges: SelectedEdge[] = topCandidates.map((c) => ({
    fromFactId: c.fromFactId,
    toFactId: c.toFactId,
    relationType: c.relationType,
    scoreBreakdown: {
      relationWeight: c.relationWeight,
      temporalPass: c.temporalPass,
      entityOverlap: c.entityOverlap,
      ...(c.cePrior > 0 ? { cePrior: c.cePrior } : {}),
      total: c.total,
    },
  }));

  // relationType 直方图
  const relationTypeHistogram: Record<string, number> = {};
  for (const c of topCandidates) {
    relationTypeHistogram[c.relationType] =
      (relationTypeHistogram[c.relationType] ?? 0) + 1;
  }

  const expansionFactIds = topCandidates.map((c) => c.toFactId);

  return { expansionFactIds, selectedEdges, relationTypeHistogram };
}

/**
 * 从 relationMap 用 BFS 获取相关 fact IDs (内部工具).
 * 与 memory-chained-retrieval.ts 的 getRelatedFactIds 等价, 但避免循环依赖.
 */
function getRelatedFactIdsFromMap(
  factId: string,
  relationMap: Map<string, string[]>,
  maxDepth: number,
): string[] {
  const result: string[] = [];
  const visited = new Set<string>([factId]);
  let frontier = [factId];

  for (let depth = 0; depth < maxDepth; depth++) {
    const nextFrontier: string[] = [];
    for (const fid of frontier) {
      const related = relationMap.get(fid) ?? [];
      for (const rId of related) {
        if (visited.has(rId)) continue;
        visited.add(rId);
        result.push(rId);
        nextFrontier.push(rId);
      }
    }
    frontier = nextFrontier;
    if (frontier.length === 0) break;
  }
  return result;
}
