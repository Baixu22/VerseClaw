// Phase 2.2: Background consolidation (Cognee memify + Letta v2 sleep-time).
//
// Runs periodically (not in the write path) to improve stored fact quality:
//   1. Prune: invalidate low-importance facts that haven't been accessed recently.
//   2. Merge: invalidate near-duplicate facts (same subject, high 3-gram cosine
//      similarity), keeping the higher-confidence survivor.
//   3. Strengthen: identify high-usage facts for importance boost (the boost is
//      already applied implicitly through usage-aware eviction scoring; this step
//      reports which facts qualify so callers can log/observe it).
//
// All operations use store.invalidateFact() — no destructive deletes. The store
// remains append-only; consolidation just marks facts as expired/superseded.

import {
  isRuntimeMemoryTemporalFact,
  type RuntimeMemoryInvalidationProposal,
  type RuntimeMemoryInvalidationReason,
  type RuntimeMemoryQueryableFact,
} from "./memory-context.js";
import type { RuntimeMemoryStore } from "./memory-store.js";
import {
  computeObservationKey,
  type ObservationStore,
} from "./memory-observation-store.js";
import { triggerSSPVersionBump } from "./memory-pre-reply-injection.js";

export type ConsolidationConfig = {
  /** Facts with importance below this are prune candidates. Default 0.15. */
  pruneImportanceThreshold: number;
  /** Prune candidates not accessed in this many days. Default 14. */
  pruneStaleDays: number;
  /** Character 3-gram cosine similarity above this triggers merge. Default 0.88. */
  mergeSimilarityThreshold: number;
  /** Max facts processed in a single run. Default 256. */
  batchSize: number;
};

export const DEFAULT_CONSOLIDATION_CONFIG: ConsolidationConfig = {
  pruneImportanceThreshold: 0.2,
  pruneStaleDays: 14,
  mergeSimilarityThreshold: 0.88,
  batchSize: 256,
};

export type ConsolidationMergePair = {
  survivorId: string;
  absorbedId: string;
  similarity: number;
};

export type ConsolidationResult = {
  prunedFactIds: string[];
  mergedPairs: ConsolidationMergePair[];
  strengthenedFactIds: string[];
  durationMs: number;
  /** COMPASS 2.0 诊断: 更新了多少个 observation 的 structuredSummary */
  structuredSummaryUpdated?: number;
  /** COMPASS 2.0 诊断: 是否触发了 SSP version++ */
  versionBumpTriggered?: boolean;
};

/**
 * COMPASS 2.0: Consolidation 可选参数.
 *
 * - observationStore + factsById: merge 后为受影响 observation 重新生成 structuredSummary
 * - sessionKey: consolidation 末尾触发 SSP version++ (fire-and-forget)
 * - hooks: COMPASS 2.0 hook 集合, 优先级高于上述兼容字段
 */
export type ConsolidationOptions = {
  /** @deprecated-migrate-to-hooks 请通过 hooks.afterPruneAndMerge 注入 */
  observationStore?: ObservationStore;
  /** @deprecated-migrate-to-hooks 请通过 hooks.afterPruneAndMerge 注入 */
  factsById?: ReadonlyMap<string, RuntimeMemoryQueryableFact>;
  /** @deprecated-migrate-to-hooks 请通过 hooks.afterConsolidation 注入 */
  sessionKey?: string;
  /** COMPASS 2.0 hooks, 优先级高于上述三个兼容字段 */
  hooks?: ConsolidationHooks;
};

/** consolidation 统计, 用于 hook 判断是否有实质变更 */
export interface ConsolidationStats {
  prunedCount: number;
  mergedPairCount: number;
  strengthenedCount: number;
  hadChanges: boolean;
}

/**
 * COMPASS 2.0 向 consolidation 注入的 hook 集合.
 * 基础设施层不感知 COMPASS 的具体逻辑, 只负责在正确时机调用 hook.
 *
 * 设计原则: hook 失败不应中断 consolidation 主流程 (实现层需 try/catch).
 */
export interface ConsolidationHooks {
  /**
   * Step 4 hook: 在 prune/merge 完成后, 对受影响的 observations 执行额外处理.
   * COMPASS 用途: 更新 structuredSummary + bootstrapCanonicalFactId.
   */
  afterPruneAndMerge?: (affectedObservationIds: ReadonlySet<string>) => Promise<void>;
  /**
   * Step 5 hook: 在 consolidation 产生实质变更后触发.
   * COMPASS 用途: triggerSSPVersionBump, 强制下一轮 pre-reply I-frame 刷新.
   */
  afterConsolidation?: (stats: ConsolidationStats) => Promise<void>;
}

/**
 * COMPASS 2.0: 生成 Structured fidelity 级别的紧凑 JSON 三元组.
 *
 * 确定性模板 (非 LLM), 限长 ≤150 chars.
 * - 完整模式: {"s":"<subject>","p":"<predicate>","k":"<key>"}
 * - 降级模式 (无 subject/predicate): {"k":"<key>","n":<supportCount>}
 */
export function generateStructuredSummary(params: {
  subject?: string;
  predicate?: string;
  key: string;
  supportCount?: number;
}): string {
  const { subject, predicate, key, supportCount } = params;
  let json: string;
  if (subject && predicate) {
    json = JSON.stringify({ s: subject, p: predicate, k: key });
  } else {
    json = JSON.stringify({ k: key, n: supportCount ?? 0 });
  }
  // 限长 ≤150 chars, 超长截断
  if (json.length <= 150) return json;
  return json.slice(0, 147) + "...";
}

/**
 * Run background consolidation against a store. Mutates the store by adding
 * invalidation proposals for pruned and merged facts. Returns a report of
 * what was done.
 */
export async function runConsolidation(
  store: RuntimeMemoryStore,
  config: ConsolidationConfig = DEFAULT_CONSOLIDATION_CONFIG,
  now: number = Date.now(),
  options?: ConsolidationOptions,
): Promise<ConsolidationResult> {
  const startTime = Date.now();

  const allFacts = store.queryFacts() as readonly RuntimeMemoryQueryableFact[];
  const usageStats = store.getUsageStats();
  const usageByFactId = new Map(usageStats.map((s) => [s.factId, s]));

  const batch = allFacts.slice(0, config.batchSize);

  const prunedFactIds: string[] = [];
  const mergedPairs: ConsolidationMergePair[] = [];
  const strengthenedFactIds: string[] = [];
  const absorbedIds = new Set<string>();

  // === Step 1: Prune low-importance stale facts ===
  const staleMs = config.pruneStaleDays * 24 * 60 * 60 * 1000;
  const survivorFacts: RuntimeMemoryQueryableFact[] = [];

  for (const fact of batch) {
    const importance = computeImportance(fact);
    const usage = usageByFactId.get(fact.factId);
    const lastRelevant = usage?.lastAccessedAt ?? getLastRelevantTime(fact, now);
    const isStale = now - lastRelevant > staleMs;

    if (importance < config.pruneImportanceThreshold && isStale) {
      const proposal = buildConsolidationInvalidation(
        fact.factId,
        "expired",
        now,
      );
      store.invalidateFact(proposal);
      prunedFactIds.push(fact.factId);
    } else {
      survivorFacts.push(fact);
    }
  }

  // === Step 2: Merge near-duplicate facts within same subject ===
  const bySubject = new Map<string, RuntimeMemoryQueryableFact[]>();
  for (const fact of survivorFacts) {
    if (absorbedIds.has(fact.factId)) continue;
    const group = bySubject.get(fact.subject) ?? [];
    group.push(fact);
    bySubject.set(fact.subject, group);
  }

  for (const group of bySubject.values()) {
    if (group.length < 2) continue;

    const vectors = group.map((f) => ({
      fact: f,
      vec: tfidfVector(characterNgrams(f.objectSummary ?? "")),
    }));

    for (let i = 0; i < vectors.length; i++) {
      if (absorbedIds.has(vectors[i].fact.factId)) continue;
      for (let j = i + 1; j < vectors.length; j++) {
        if (absorbedIds.has(vectors[j].fact.factId)) continue;

        const sim = cosine(vectors[i].vec, vectors[j].vec);
        if (sim < config.mergeSimilarityThreshold) continue;

        const a = vectors[i].fact;
        const b = vectors[j].fact;
        const [survivor, absorbed] =
          (a.confidence ?? 0) >= (b.confidence ?? 0) ? [a, b] : [b, a];

        const proposal = buildConsolidationInvalidation(
          absorbed.factId,
          "superseded",
          now,
          survivor.factId,
        );
        store.invalidateFact(proposal);
        absorbedIds.add(absorbed.factId);
        mergedPairs.push({
          survivorId: survivor.factId,
          absorbedId: absorbed.factId,
          similarity: sim,
        });

        if (absorbed.factId === vectors[i].fact.factId) break;
      }
    }
  }

  // === Step 3: Identify high-usage facts for strengthening ===
  const activeSurvivors = survivorFacts.filter(
    (f) => !absorbedIds.has(f.factId),
  );
  const counts = activeSurvivors
    .map((f) => usageByFactId.get(f.factId)?.count ?? 0)
    .sort((a, b) => a - b);

  if (counts.length > 0) {
    const p75 = counts[Math.floor(counts.length * 0.75)];
    for (const fact of activeSurvivors) {
      const usage = usageByFactId.get(fact.factId);
      if (usage && usage.count > p75 && usage.count > 0) {
        strengthenedFactIds.push(fact.factId);
      }
    }
  }

  // === COMPASS 2.0 Step 4: Generate structuredSummary for affected observations ===
  let structuredSummaryUpdated = 0;

  // 收集受影响 observation keys (pruned + merged 的 subject → observation key)
  const affectedObsKeys = new Set<string>();
  if (options?.factsById) {
    for (const fid of prunedFactIds) {
      const f = options.factsById.get(fid);
      if (f) affectedObsKeys.add(computeObservationKey(f.subject, f.predicate));
    }
    for (const pair of mergedPairs) {
      const f = options.factsById.get(pair.survivorId);
      if (f) affectedObsKeys.add(computeObservationKey(f.subject, f.predicate));
    }
  }

  if (options?.hooks?.afterPruneAndMerge && affectedObsKeys.size > 0) {
    // Hook 模式: COMPASS 通过 hook 注入处理逻辑
    try {
      await options.hooks.afterPruneAndMerge(affectedObsKeys);
      structuredSummaryUpdated = affectedObsKeys.size;
    } catch {
      // hook 失败不中断 consolidation 主流程
    }
  } else if (options?.observationStore && options?.factsById && mergedPairs.length > 0) {
    // 兼容旧调用方式 (COMPASS 2.0 过渡期)
    const obsStore = options.observationStore;
    const factsById = options.factsById;
    // 收集受影响 subject (mergedPairs 中 survivor 对应的 fact)
    const affectedSubjects = new Set<string>();
    for (const pair of mergedPairs) {
      const survivorFact = factsById.get(pair.survivorId);
      if (survivorFact) affectedSubjects.add(survivorFact.subject);
    }
    // 为每个受影响 subject 对应的 observation 重新生成 structuredSummary
    for (const subject of affectedSubjects) {
      for (const fact of activeSurvivors) {
        if (fact.subject !== subject) continue;
        const key = computeObservationKey(fact.subject, fact.predicate);
        const obs = obsStore.getByKey(key);
        if (!obs) continue;
        const structured = generateStructuredSummary({
          subject: fact.subject,
          predicate: fact.predicate,
          key: obs.key,
          supportCount: obs.supportFactIds.length,
        });
        obsStore.setStructuredSummary(obs.key, structured);
        // 冷启动修复: 若 canonicalFactId 缺失, 加权分配
        obsStore.bootstrapCanonicalFactId(obs.key, factsById);
        structuredSummaryUpdated += 1;
        break; // 每个 subject 只处理第一个匹配 fact
      }
    }
  }

  // === COMPASS 2.0 Step 5: Projection Cache invariant — trigger SSP version++ ===
  let versionBumpTriggered = false;
  const consolidationStats: ConsolidationStats = {
    prunedCount: prunedFactIds.length,
    mergedPairCount: mergedPairs.length,
    strengthenedCount: strengthenedFactIds.length,
    hadChanges: prunedFactIds.length > 0 || mergedPairs.length > 0,
  };

  if (options?.hooks?.afterConsolidation) {
    // Hook 模式: COMPASS 通过 hook 注入 version bump 逻辑
    try {
      await options.hooks.afterConsolidation(consolidationStats);
      versionBumpTriggered = consolidationStats.hadChanges;
    } catch {
      // hook 失败不中断 consolidation 主流程
    }
  } else if (options?.sessionKey && consolidationStats.hadChanges) {
    // 兼容旧调用方式 (COMPASS 2.0 过渡期)
    // fire-and-forget: version++ 是 best-effort 信号, 失败时 pre-reply 使用现有 version
    void triggerSSPVersionBump(options.sessionKey).catch(() => {
      // 错误吞咽: 不阻断 consolidation 流程
    });
    versionBumpTriggered = true;
  }

  return {
    prunedFactIds,
    mergedPairs,
    strengthenedFactIds,
    durationMs: Date.now() - startTime,
    ...(structuredSummaryUpdated > 0 ? { structuredSummaryUpdated } : {}),
    ...(versionBumpTriggered ? { versionBumpTriggered } : {}),
  };
}

// === Importance computation (mirrors RuntimeMemoryStore.computeImportanceScore) ===

function computeImportance(fact: RuntimeMemoryQueryableFact): number {
  let score = typeof fact.confidence === "number" ? fact.confidence : 0;

  const statusBonus: Record<string, number> = {
    human_approved: 0.3,
    deterministic_rule: 0.25,
    verified: 0.1,
  };
  score += statusBonus[fact.verificationStatus] ?? 0;

  const sourceBonus: Record<string, number> = {
    human_confirmation: 0.2,
    deterministic_rule: 0.15,
    verifier_summary: 0.1,
    test_output: 0.05,
    tool_result: 0.05,
  };
  score += sourceBonus[fact.source] ?? 0;

  if (fact.evidenceRefs && fact.evidenceRefs.length > 0) {
    score += Math.min(fact.evidenceRefs.length * 0.05, 0.15);
  }

  return Math.min(score, 1.0);
}

function getLastRelevantTime(
  fact: RuntimeMemoryQueryableFact,
  fallback: number,
): number {
  if (isRuntimeMemoryTemporalFact(fact) && typeof fact.acceptedAt === "number") {
    return fact.acceptedAt;
  }
  return typeof fact.valid_at === "number" ? fact.valid_at : fallback;
}

// === Invalidation proposal builder ===

function buildConsolidationInvalidation(
  factId: string,
  reason: RuntimeMemoryInvalidationReason,
  now: number,
  replacementFactId?: string,
): RuntimeMemoryInvalidationProposal {
  return {
    schemaVersion: 1,
    invalidationId: `consolidation-${factId}-${reason}-${now}`,
    factId,
    reason,
    invalid_at: now,
    reference_time: now,
    proposedBy: "deterministic_rule",
    verificationStatus: "deterministic_rule",
    sourceEpisodeRefs: [],
    evidenceRefs: [],
    ...(replacementFactId !== undefined ? { replacementFactId } : {}),
  };
}

// === Character 3-gram vector utilities (mirrors memory-hybrid-retrieval.ts) ===

function characterNgrams(text: string): string[] {
  const normalized = text
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  if (normalized.length < 3) return normalized.length > 0 ? [normalized] : [];
  const padded = ` ${normalized} `;
  const grams: string[] = [];
  for (let i = 0; i + 3 <= padded.length; i++) {
    const g = padded.slice(i, i + 3);
    if (!/^\s+$/.test(g)) grams.push(g);
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
