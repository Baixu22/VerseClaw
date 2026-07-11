import {
  DEFAULT_RUNTIME_MEMORY_TYPE,
  findRuntimeMemoryFacts,
  isRuntimeMemoryAcceptedVerificationStatus,
  isRuntimeMemoryEpisodeRecord,
  isRuntimeMemoryInvalidationProposal,
  isRuntimeMemoryRelationType,
  isRuntimeMemoryTemporalFact,
  isRuntimeMemoryTemporalFactCandidate,
  sanitizeRuntimeMemoryEpisodeRecord,
  sanitizeRuntimeMemoryInvalidationProposal,
  sanitizeRuntimeMemoryTemporalFact,
  sanitizeRuntimeMemoryTemporalFactCandidate,
  summarizeRuntimeMemoryFacts,
  type RuntimeMemoryEpisodeRecord,
  type RuntimeMemoryFactQuery,
  type RuntimeMemoryFactRelation,
  type RuntimeMemoryInputRejection,
  type RuntimeMemoryInvalidationProposal,
  type RuntimeMemoryQueryableFact,
  type RuntimeMemoryRawInputRejectionReason,
  type RuntimeMemoryRelationType,
  type RuntimeMemorySummary,
  type RuntimeMemoryTemporalFact,
  type RuntimeMemoryTemporalFactCandidate,
  type RuntimeMemoryType,
  type RuntimeMemoryVerificationStatus,
} from "./memory-context.js";
import type { EvidenceRef } from "./evidence.js";
import type { RecallTrace } from "./memory-trace.js";

export const RUNTIME_MEMORY_STORE_DEFAULT_MAX_EPISODES = 256;
export const RUNTIME_MEMORY_STORE_DEFAULT_MAX_FACTS = 512;
export const RUNTIME_MEMORY_STORE_DEFAULT_MAX_INVALIDATIONS = 256;

/**
 * Type-aware eviction weights (Phase 4.2). Each memory type has a different
 * blend of importance / recency / usage signals, reflecting how each type
 * should be retained under capacity pressure:
 *
 * - `semantic`: importance-driven (0.7). Stable facts survive if they are
 *   well-evidenced; recency matters little.
 * - `episodic`: recency-driven (0.6). Time-bound events fade as they age —
 *   old episodes are the first to go.
 * - `procedural`: importance-dominant (0.8). Learned behaviors are the most
 *   expensive to re-derive (require user feedback), so they are retained
 *   unless truly low-quality.
 *
 * Weights sum to 1.0 per type so the overall score stays in [0, 1].
 */
export const EVICTION_WEIGHTS_BY_TYPE: Record<
  RuntimeMemoryType,
  { importance: number; recency: number; usage: number }
> = {
  semantic: { importance: 0.7, recency: 0.1, usage: 0.2 },
  episodic: { importance: 0.3, recency: 0.6, usage: 0.1 },
  procedural: { importance: 0.8, recency: 0.05, usage: 0.15 },
};

export type RuntimeMemoryReadonly<T> = T extends readonly (infer Item)[]
  ? readonly RuntimeMemoryReadonly<Item>[]
  : T extends object
    ? { readonly [Key in keyof T]: RuntimeMemoryReadonly<T[Key]> }
    : T;

export type RuntimeMemoryStoreOptions = {
  maxEpisodes?: number;
  maxFacts?: number;
  maxInvalidations?: number;
  /**
   * Eviction policy when fact capacity is exceeded.
   * - "fifo": evict oldest by insertion order. Original behavior.
   * - "importance" (default): evict by lowest eviction score (importance +
   *   recency + usage), batch-evicting ~15% to avoid boundary churn.
   */
  evictionPolicy?: "fifo" | "importance";
  now?: () => number;
  /**
   * COMPASS 2.0: Eviction compliance hook (REDACT 合规门).
   *
   * 当 fact 被驱逐时调用. 调用方可在 hook 内检查 fact.sensitivity:
   *   - secret / secret_adjacent: 触发 REDACT 事件 (合规删除)
   *   - normal: silent eviction (默认行为, 无需额外操作)
   *
   * hook 在 invalidateFact 之前调用, 确保 REDACT 事件先于 invalidation 记录.
   * 未提供时, 所有 fact 走 silent eviction (向后兼容).
   */
  evictionComplianceHook?: EvictionComplianceHook;
  /**
   * COMPASS 2.0 v2: 启用成本感知驱逐 v2 (value 用 U_decision).
   * 默认 false. 启用后 computeEvictionScore 的 value 来源切换到 U_decision
   * (当 recallTrace 可用时).
   */
  enableCostAwareEvictionV2?: boolean;
};

/**
 * COMPASS 2.0: Eviction compliance hook.
 *
 * 调用方传入此 hook, 在 fact 被驱逐时检查 sensitivity 并触发 REDACT.
 * hook 接收被驱逐的 fact, 不返回值 (副作用: 触发 REDACT 事件).
 */
export type EvictionComplianceHook = (fact: RuntimeMemoryQueryableFact) => void;

export type RuntimeMemoryStoreRejectionReason =
  | RuntimeMemoryRawInputRejectionReason
  | "invalid_episode"
  | "invalid_fact"
  | "invalid_invalidation";

export type RuntimeMemoryStoreRejection = {
  accepted: false;
  reason: RuntimeMemoryStoreRejectionReason;
  message: string;
};

export type RuntimeMemoryStoreAppendResult<T> =
  | RuntimeMemoryStoreRejection
  | {
      accepted: true;
      stored: boolean;
      duplicate: boolean;
      value: RuntimeMemoryReadonly<T>;
    };

type RuntimeMemoryStoreSanitizedFactResult =
  | RuntimeMemoryStoreRejection
  | {
      accepted: true;
      value: RuntimeMemoryQueryableFact;
    };

export type RuntimeMemoryStoreFactQuery = RuntimeMemoryFactQuery & {
  factId?: string;
  file?: string;
  symbol?: string;
  status?: RuntimeMemoryVerificationStatus;
  verificationStatus?: RuntimeMemoryVerificationStatus;
  time?: number;
};

export type RuntimeMemoryStoreSummaryQuery = RuntimeMemoryStoreFactQuery & {
  tokenBudget?: number;
};

export type RuntimeMemoryStoreStats = {
  episodes: number;
  facts: number;
  invalidations: number;
  maxEpisodes: number;
  maxFacts: number;
  maxInvalidations: number;
};

const USAGE_HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000;
const USAGE_NORMALIZATION_COUNT = 5;

export type RuntimeMemoryUsageStat = {
  factId: string;
  count: number;
  lastAccessedAt: number | undefined;
};

export class RuntimeMemoryStore {
  private readonly maxEpisodes: number;
  private readonly maxFacts: number;
  private readonly maxInvalidations: number;
  private readonly evictionPolicy: "fifo" | "importance";
  private readonly now: () => number;
  // COMPASS 2.0: Eviction compliance hook (REDACT 合规门)
  private readonly evictionComplianceHook?: EvictionComplianceHook;
  // COMPASS 2.0 v2: 成本感知驱逐 v2 (value 用 U_decision)
  private readonly enableCostAwareEvictionV2: boolean;
  private readonly episodesById = new Map<string, RuntimeMemoryEpisodeRecord>();
  private readonly episodeIdByIdempotencyKey = new Map<string, string>();
  private readonly episodeOrder: string[] = [];
  private readonly factsById = new Map<string, RuntimeMemoryQueryableFact>();
  private readonly factOrder: string[] = [];
  private readonly invalidationsById = new Map<
    string,
    RuntimeMemoryInvalidationProposal
  >();
  private readonly invalidationOrder: string[] = [];
  private readonly usageCounts = new Map<string, number>();
  private readonly lastAccessedAt = new Map<string, number>();
  private lastWriteAt = 0;
  private readonly relationsById = new Map<string, RuntimeMemoryFactRelation>();
  private readonly relationOrder: string[] = [];

  constructor(options: RuntimeMemoryStoreOptions = {}) {
    this.maxEpisodes = normalizeBound(
      options.maxEpisodes,
      RUNTIME_MEMORY_STORE_DEFAULT_MAX_EPISODES,
    );
    this.maxFacts = normalizeBound(
      options.maxFacts,
      RUNTIME_MEMORY_STORE_DEFAULT_MAX_FACTS,
    );
    this.maxInvalidations = normalizeBound(
      options.maxInvalidations,
      RUNTIME_MEMORY_STORE_DEFAULT_MAX_INVALIDATIONS,
    );
    this.evictionPolicy = options.evictionPolicy === "fifo"
      ? "fifo"
      : "importance";
    this.now = options.now ?? Date.now;
    // COMPASS 2.0: 保存 eviction compliance hook (可选)
    this.evictionComplianceHook = options.evictionComplianceHook;
    // COMPASS 2.0 v2: 成本感知驱逐 v2 (默认 false)
    this.enableCostAwareEvictionV2 = options.enableCostAwareEvictionV2 ?? false;
  }

  recordFactAccess(factId: string): void {
    if (!this.factsById.has(factId)) return;
    this.usageCounts.set(factId, (this.usageCounts.get(factId) ?? 0) + 1);
    this.lastAccessedAt.set(factId, this.now());
  }

  recordFactsAccess(factIds: readonly string[]): void {
    for (const factId of factIds) this.recordFactAccess(factId);
  }

  getUsageStats(): RuntimeMemoryUsageStat[] {
    return this.factOrder.map((factId) => ({
      factId,
      count: this.usageCounts.get(factId) ?? 0,
      lastAccessedAt: this.lastAccessedAt.get(factId),
    }));
  }

  getLastWriteAt(): number {
    return this.lastWriteAt;
  }

  appendEpisode(
    episode: RuntimeMemoryEpisodeRecord,
  ): RuntimeMemoryStoreAppendResult<RuntimeMemoryEpisodeRecord> {
    if (!isRuntimeMemoryEpisodeRecord(episode)) {
      return makeStoreRejection("invalid_episode");
    }

    const sanitized = sanitizeRuntimeMemoryEpisodeRecord(episode);
    if (!sanitized.accepted) {
      return fromInputRejection(sanitized);
    }

    const existingId =
      this.episodeIdByIdempotencyKey.get(sanitized.value.idempotencyKey) ??
        (this.episodesById.has(sanitized.value.episodeId)
          ? sanitized.value.episodeId
          : undefined);
    if (existingId !== undefined) {
      const existing = this.episodesById.get(existingId);
      if (existing !== undefined) {
        const merged = mergeEpisodeEvidence(existing, sanitized.value);
        this.episodesById.set(existingId, merged);
        this.episodeIdByIdempotencyKey.set(
          sanitized.value.idempotencyKey,
          existingId,
        );
        return {
          accepted: true,
          stored: false,
          duplicate: true,
          value: readonlyClone(merged),
        };
      }
    }

    const stored = cloneMutable(sanitized.value);
    this.episodesById.set(stored.episodeId, stored);
    this.episodeIdByIdempotencyKey.set(stored.idempotencyKey, stored.episodeId);
    this.episodeOrder.push(stored.episodeId);
    this.trimEpisodes();
    return {
      accepted: true,
      stored: true,
      duplicate: false,
      value: readonlyClone(stored),
    };
  }

  appendFact(
    fact: RuntimeMemoryTemporalFact | RuntimeMemoryTemporalFactCandidate,
  ): RuntimeMemoryStoreAppendResult<RuntimeMemoryQueryableFact> {
    const sanitized = sanitizeQueryableFactForStore(fact);
    if (!sanitized.accepted) {
      return sanitized;
    }

    const existing = this.factsById.get(sanitized.value.factId);
    if (existing !== undefined) {
      return {
        accepted: true,
        stored: false,
        duplicate: true,
        value: readonlyClone(existing),
      };
    }

    const stored = cloneMutable(sanitized.value);
    this.factsById.set(stored.factId, stored);
    this.factOrder.push(stored.factId);
    this.lastWriteAt = this.now();
    this.trimFacts();
    return {
      accepted: true,
      stored: true,
      duplicate: false,
      value: readonlyClone(stored),
    };
  }

  invalidateFact(
    proposal: RuntimeMemoryInvalidationProposal,
  ): RuntimeMemoryStoreAppendResult<RuntimeMemoryInvalidationProposal> {
    if (!isRuntimeMemoryInvalidationProposal(proposal)) {
      return makeStoreRejection("invalid_invalidation");
    }

    const sanitized = sanitizeRuntimeMemoryInvalidationProposal(proposal);
    if (!sanitized.accepted) {
      return fromInputRejection(sanitized);
    }

    const existing = this.invalidationsById.get(sanitized.value.invalidationId);
    if (existing !== undefined) {
      return {
        accepted: true,
        stored: false,
        duplicate: true,
        value: readonlyClone(existing),
      };
    }

    const stored = cloneMutable(sanitized.value);
    this.invalidationsById.set(stored.invalidationId, stored);
    this.invalidationOrder.push(stored.invalidationId);
    this.lastWriteAt = this.now();
    this.trimInvalidations();
    return {
      accepted: true,
      stored: true,
      duplicate: false,
      value: readonlyClone(stored),
    };
  }

  getEpisodeById(
    episodeId: string,
  ): RuntimeMemoryReadonly<RuntimeMemoryEpisodeRecord> | undefined {
    const episode = this.episodesById.get(episodeId);
    return episode === undefined ? undefined : readonlyClone(episode);
  }

  getFactById(
    factId: string,
  ): RuntimeMemoryReadonly<RuntimeMemoryQueryableFact> | undefined {
    const fact = this.factsById.get(factId);
    return fact === undefined ? undefined : readonlyClone(fact);
  }

  listEpisodes(): readonly RuntimeMemoryReadonly<RuntimeMemoryEpisodeRecord>[] {
    return readonlyCloneArray(
      this.episodeOrder.flatMap((episodeId) => {
        const episode = this.episodesById.get(episodeId);
        return episode === undefined ? [] : [episode];
      }),
    );
  }

  listInvalidations(): readonly RuntimeMemoryReadonly<RuntimeMemoryInvalidationProposal>[] {
    return readonlyCloneArray(
      this.invalidationOrder.flatMap((invalidationId) => {
        const proposal = this.invalidationsById.get(invalidationId);
        return proposal === undefined ? [] : [proposal];
      }),
    );
  }

  queryFacts(
    query: RuntimeMemoryStoreFactQuery = {},
  ): readonly RuntimeMemoryReadonly<RuntimeMemoryQueryableFact>[] {
    return readonlyCloneArray(this.findFacts(query));
  }

  summarizeFacts(query: RuntimeMemoryStoreSummaryQuery = {}): RuntimeMemoryReadonly<RuntimeMemorySummary> {
    const facts = this.findFacts({ ...query, limit: undefined });
    const summary = summarizeRuntimeMemoryFacts(facts, {
      ...toRuntimeFactQuery(query),
      limit: query.limit,
      tokenBudget: query.tokenBudget,
    });
    return readonlyClone(summary);
  }

  stats(): RuntimeMemoryStoreStats {
    return {
      episodes: this.episodesById.size,
      facts: this.factsById.size,
      invalidations: this.invalidationsById.size,
      maxEpisodes: this.maxEpisodes,
      maxFacts: this.maxFacts,
      maxInvalidations: this.maxInvalidations,
    };
  }

  private findFacts(
    query: RuntimeMemoryStoreFactQuery = {},
  ): RuntimeMemoryQueryableFact[] {
    const runtimeQuery = toRuntimeFactQuery(query);
    const matched = findRuntimeMemoryFacts(this.factsWithInvalidations(), {
      ...runtimeQuery,
      limit: undefined,
    })
      .filter((fact) => queryAllowsFactShape(fact, query))
      .filter((fact) => this.matchesStoreQuery(fact, query));
    return applyLimit(matched, query.limit);
  }

  private factsWithInvalidations(): RuntimeMemoryQueryableFact[] {
    const invalidatedAtByFactId = new Map<string, number>();
    for (const proposal of this.invalidationsById.values()) {
      if (!isRuntimeMemoryAcceptedVerificationStatus(proposal.verificationStatus)) {
        continue;
      }
      const current = invalidatedAtByFactId.get(proposal.factId);
      if (current === undefined || proposal.invalid_at < current) {
        invalidatedAtByFactId.set(proposal.factId, proposal.invalid_at);
      }
    }

    return Array.from(this.factsById.values(), (fact) => {
      const invalidAt = invalidatedAtByFactId.get(fact.factId);
      if (invalidAt === undefined) {
        return fact;
      }
      if (fact.invalid_at !== undefined && fact.invalid_at <= invalidAt) {
        return fact;
      }
      return { ...fact, invalid_at: invalidAt };
    });
  }

  private matchesStoreQuery(
    fact: RuntimeMemoryQueryableFact,
    query: RuntimeMemoryStoreFactQuery,
  ): boolean {
    if (query.factId !== undefined && fact.factId !== query.factId) {
      return false;
    }
    if (query.taskId !== undefined && !this.matchesTask(fact, query.taskId)) {
      return false;
    }
    if (
      query.sourceEpisodeId !== undefined &&
      !fact.sourceEpisodeRefs.some((ref) => ref.episodeId === query.sourceEpisodeId)
    ) {
      return false;
    }
    if (
      query.evidenceRef !== undefined &&
      !this.matchesEvidence(fact, query.evidenceRef)
    ) {
      return false;
    }
    if (query.file !== undefined && !this.matchesFile(fact, query.file)) {
      return false;
    }
    if (query.symbol !== undefined && !this.matchesSymbol(fact, query.symbol)) {
      return false;
    }
    return true;
  }

  private matchesTask(fact: RuntimeMemoryQueryableFact, taskId: string): boolean {
    return (
      fact.taskId === taskId ||
      fact.sourceEpisodeRefs.some((ref) => ref.taskId === taskId) ||
      this.sourceEpisodesFor(fact).some((episode) => episode.taskId === taskId)
    );
  }

  private matchesEvidence(
    fact: RuntimeMemoryQueryableFact,
    evidenceRef: string,
  ): boolean {
    return (
      fact.evidenceRefs.some((ref) => ref.ref === evidenceRef) ||
      this.sourceEpisodesFor(fact).some((episode) =>
        episode.evidenceRefs.some((ref) => ref.ref === evidenceRef)
      )
    );
  }

  private matchesFile(fact: RuntimeMemoryQueryableFact, file: string): boolean {
    return (
      fact.evidenceRefs.some((ref) => evidenceRefMatchesFile(ref, file)) ||
      this.sourceEpisodesFor(fact).some((episode) =>
        episode.sourceRefs.some((ref) => ref.file === file || (
          ref.type === "file" && ref.ref === file
        ))
      )
    );
  }

  private matchesSymbol(
    fact: RuntimeMemoryQueryableFact,
    symbol: string,
  ): boolean {
    return this.sourceEpisodesFor(fact).some((episode) =>
      episode.sourceRefs.some((ref) =>
        ref.symbol === symbol || (ref.type === "symbol" && ref.ref === symbol)
      )
    );
  }

  private sourceEpisodesFor(
    fact: RuntimeMemoryQueryableFact,
  ): RuntimeMemoryEpisodeRecord[] {
    return fact.sourceEpisodeRefs.flatMap((ref) => {
      const episode = this.episodesById.get(ref.episodeId);
      return episode === undefined ? [] : [episode];
    });
  }

  private trimEpisodes(): void {
    while (this.episodeOrder.length > this.maxEpisodes) {
      const episodeId = this.episodeOrder.shift();
      if (episodeId === undefined) {
        return;
      }
      const episode = this.episodesById.get(episodeId);
      this.episodesById.delete(episodeId);
      if (episode !== undefined) {
        this.episodeIdByIdempotencyKey.delete(episode.idempotencyKey);
      }
    }
  }

  private trimFacts(): void {
    if (this.evictionPolicy === "importance") {
      this.trimFactsByImportance();
      return;
    }
    while (this.factOrder.length > this.maxFacts) {
      const factId = this.factOrder.shift();
      if (factId === undefined) {
        return;
      }
      this.factsById.delete(factId);
      this.usageCounts.delete(factId);
      this.lastAccessedAt.delete(factId);
    }
  }

  /**
   * Importance-aware eviction (Module C). When capacity is exceeded, evict the
   * lowest-scoring ~15% of facts in one batch (avoids boundary churn). Score =
   * importance(0.60) + recency-sigmoid(0.25) + usage(0.15). High-confidence,
   * well-evidenced, recently-accepted facts survive; the FIFO tail is no
   * longer blindly dropped.
   *
   * COMPASS 2.0 v2: 当 recallTrace 提供且 enableCostAwareEvictionV2=true 时,
   * value 用 U_decision (决策效用). 无 trace 时降级到 v1 (importance-based).
   */
  private trimFactsByImportance(recallTrace?: RecallTrace): void {
    if (this.factOrder.length <= this.maxFacts) return;
    const targetSize = Math.floor(this.maxFacts * 0.85);
    const toEvict = this.factOrder.length - targetSize;
    if (toEvict <= 0) return;

    const now = this.now();
    const scored = this.factOrder
      .map((factId) => {
        const fact = this.factsById.get(factId);
        if (!fact) return { factId, score: -1, fact: undefined };
        return { factId, score: this.computeEvictionScore(fact, now, recallTrace), fact };
      })
      .sort((a, b) => a.score - b.score);

    for (let i = 0; i < toEvict; i++) {
      const { factId, fact } = scored[i];
      // COMPASS 2.0: REDACT 合规门 — 在驱逐前调用 compliance hook.
      // hook 检查 fact.sensitivity, 若为 secret/secret_adjacent 则触发 REDACT 事件.
      if (fact && this.evictionComplianceHook) {
        try {
          this.evictionComplianceHook(fact);
        } catch {
          // 合规 hook 失败不阻断驱逐流程
        }
      }
      this.factsById.delete(factId);
      this.usageCounts.delete(factId);
      this.lastAccessedAt.delete(factId);
      const idx = this.factOrder.indexOf(factId);
      if (idx !== -1) this.factOrder.splice(idx, 1);
    }
  }

  /**
   * COMPASS 2.0 v2: 带 recallTrace 的主动驱逐.
   *
   * 当 enableCostAwareEvictionV2=true 时, value 用 U_decision (决策效用).
   * 无 trace 中无该 fact 时降级到 v1 (importance-based).
   * 供外部 post-retrieval 主动驱逐调用.
   */
  trimFactsWithTrace(recallTrace: RecallTrace): void {
    this.trimFactsByImportance(recallTrace);
  }

  private computeImportanceScore(
    fact: RuntimeMemoryQueryableFact,
  ): number {
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

  private computeEvictionScore(
    fact: RuntimeMemoryQueryableFact,
    now: number,
    recallTrace?: RecallTrace,
  ): number {
    const importance = this.computeImportanceScore(fact);

    const temporalAnchor = isRuntimeMemoryTemporalFact(fact)
      ? fact.valid_at
      : (fact as RuntimeMemoryTemporalFactCandidate).proposedAt ?? now;
    const ageMs = Math.max(0, now - temporalAnchor);
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    const recencyScore = 1 / (1 + Math.exp((ageDays - 7) * 0.3));

    const usageScore = this.computeUsageScore(fact.factId, now);

    const weights = EVICTION_WEIGHTS_BY_TYPE[
      fact.memoryType ?? DEFAULT_RUNTIME_MEMORY_TYPE
    ];
    // COMPASS 2.0: 成本感知驱逐
    //   keep_score = value_of_keeping / cost_to_keep
    //   cost = tokenCost × expectedRemainingTurns
    //   tokenCost ≈ objectSummary.length / 4 (近似)
    //   expectedRemainingTurns 基于 usageCount 衰减
    //
    //   v1 (默认): value = importance + recency + usage (加权 score)
    //   v2 (enableCostAwareEvictionV2=true 且 recallTrace 可用):
    //     value = U_decision (决策效用, 从 recallTrace 派生)
    //     无 trace 中无此 fact 时降级到 v1
    const v2UDecision =
      this.enableCostAwareEvictionV2 && recallTrace
        ? this.computeUDecisionFromTrace(fact.factId, recallTrace)
        : undefined;
    const valueScore =
      v2UDecision !== undefined
        ? v2UDecision
        : importance * weights.importance +
          recencyScore * weights.recency +
          usageScore * weights.usage;
    const tokenCost = Math.max(1, Math.ceil((fact.objectSummary?.length ?? 0) / 4));
    const expectedRemainingTurns = this.estimateRemainingTurns(fact, now);
    // COMPASS 2.0: 成本感知驱逐
    //   keep_score = value_of_keeping / cost_to_keep
    //   value = valueScore × expectedRemainingTurns (预期使用次数是收益)
    //   cost  = tokenCost (仅 token 占用是成本)
    //
    //   修复: 原公式 valueScore / (tokenCost × expectedRemainingTurns) 把 usage
    //   信号反向 — 高 usage → 高 expectedRemainingTurns → 高 cost → 低 score →
    //   被优先驱逐. expectedRemainingTurns 代表"预期还会被用几次", 是保留价值
    //   (收益) 而非成本. 改为乘数后: 高 usage → 高 value → 保留.
    const value = valueScore * expectedRemainingTurns;
    return tokenCost > 0 ? value / tokenCost : value;
  }

  /**
   * COMPASS 2.0 v2: 从 recallTrace 中查找 fact 的 U_decision.
   * @returns U_decision 值, 或 undefined (trace 中无此 fact 或无 uDecision)
   */
  private computeUDecisionFromTrace(
    factId: string,
    recallTrace: RecallTrace,
  ): number | undefined {
    for (const recalled of recallTrace.recalledFacts) {
      if (recalled.factId === factId) {
        return typeof recalled.uDecision === "number"
          ? recalled.uDecision
          : undefined;
      }
    }
    return undefined;
  }

  /**
   * COMPASS 2.0: 估算 fact 的预期剩余使用轮次.
   *
   * 基于 usageCount 衰减: 高使用频率的 fact 预期还会被使用更多次.
   * v1 简化模型: max(1, 10 - proofCount) 或基于 usageCount 推算.
   * 最近访问的 fact (在 USAGE_HALF_LIFE_MS 内) 额外 +1 轮次.
   */
  private estimateRemainingTurns(
    fact: RuntimeMemoryQueryableFact,
    now: number,
  ): number {
    const usageCount = this.usageCounts.get(fact.factId) ?? 0;
    const proofCount = typeof fact.proofCount === "number" ? fact.proofCount : 0;
    // 高 proofCount 的 fact 更稳定, 预期剩余轮次更多
    const baseTurns = Math.max(1, 10 - Math.min(proofCount, 8));
    // 高 usageCount 的 fact 近期被频繁使用, 预期还会被使用
    const usageBonus = Math.min(usageCount, 5);
    // 最近访问的 fact (在半衰期内) 预期还会被使用, 额外 +1
    const lastAccess = this.lastAccessedAt.get(fact.factId);
    const recencyBonus =
      lastAccess !== undefined && now - lastAccess < USAGE_HALF_LIFE_MS ? 1 : 0;
    return baseTurns + usageBonus + recencyBonus;
  }

  private computeUsageScore(factId: string, now: number): number {
    const count = this.usageCounts.get(factId) ?? 0;
    if (count === 0) return 0.5;
    const lastAccess = this.lastAccessedAt.get(factId) ?? now;
    const ageSinceAccess = Math.max(0, now - lastAccess);
    const decay = Math.exp(-ageSinceAccess / USAGE_HALF_LIFE_MS);
    const countScore = Math.min(1, count / USAGE_NORMALIZATION_COUNT);
    return 0.5 + 0.5 * countScore * decay;
  }

  private trimInvalidations(): void {
    while (this.invalidationOrder.length > this.maxInvalidations) {
      const invalidationId = this.invalidationOrder.shift();
      if (invalidationId === undefined) {
        return;
      }
      this.invalidationsById.delete(invalidationId);
    }
  }

  // === Relation chain (Phase 6) ===

  appendRelation(
    relation: Omit<RuntimeMemoryFactRelation, "relationId" | "createdAt">,
  ): string {
    if (!isRuntimeMemoryRelationType(relation.relationType)) {
      throw new Error(
        `Invalid relation type: ${String(relation.relationType)}`,
      );
    }
    const now = this.now();
    const relationId = `${relation.sourceFactId}:${relation.targetFactId}:${relation.relationType}`;
    const existing = this.relationsById.get(relationId);
    if (existing) {
      const updated: RuntimeMemoryFactRelation = {
        ...existing,
        confidence: relation.confidence,
        metadata: relation.metadata,
      };
      this.relationsById.set(relationId, updated);
      return relationId;
    }
    const stored: RuntimeMemoryFactRelation = {
      relationId,
      sourceFactId: relation.sourceFactId,
      targetFactId: relation.targetFactId,
      relationType: relation.relationType,
      confidence: relation.confidence,
      metadata: relation.metadata,
      createdAt: now,
    };
    this.relationsById.set(relationId, stored);
    this.relationOrder.push(relationId);
    this.trimRelationsForFact(relation.sourceFactId);
    return relationId;
  }

  queryRelations(
    factId: string,
    type?: RuntimeMemoryRelationType,
  ): RuntimeMemoryFactRelation[] {
    const results: RuntimeMemoryFactRelation[] = [];
    for (const relation of this.relationsById.values()) {
      if (relation.sourceFactId !== factId) continue;
      if (type !== undefined && relation.relationType !== type) continue;
      results.push({ ...relation });
    }
    return results;
  }

  queryReverseRelations(
    factId: string,
    type?: RuntimeMemoryRelationType,
  ): RuntimeMemoryFactRelation[] {
    const results: RuntimeMemoryFactRelation[] = [];
    for (const relation of this.relationsById.values()) {
      if (relation.targetFactId !== factId) continue;
      if (type !== undefined && relation.relationType !== type) continue;
      results.push({ ...relation });
    }
    return results;
  }

  listAllRelations(): readonly RuntimeMemoryFactRelation[] {
    return Array.from(this.relationsById.values(), (r) => ({ ...r }));
  }

  private trimRelationsForFact(sourceFactId: string): void {
    const MAX_OUTGOING = 10;
    const outgoing = this.relationOrder
      .map((id) => this.relationsById.get(id))
      .filter(
        (r): r is RuntimeMemoryFactRelation =>
          r !== undefined && r.sourceFactId === sourceFactId,
      );
    if (outgoing.length <= MAX_OUTGOING) return;
    outgoing.sort((a, b) => b.confidence - a.confidence);
    const toRemove = outgoing.slice(MAX_OUTGOING);
    for (const relation of toRemove) {
      this.relationsById.delete(relation.relationId);
      const idx = this.relationOrder.indexOf(relation.relationId);
      if (idx >= 0) this.relationOrder.splice(idx, 1);
    }
  }
}

function sanitizeQueryableFactForStore(
  fact: RuntimeMemoryTemporalFact | RuntimeMemoryTemporalFactCandidate,
): RuntimeMemoryStoreSanitizedFactResult {
  if (isRuntimeMemoryTemporalFact(fact)) {
    const sanitized = sanitizeRuntimeMemoryTemporalFact(fact);
    return sanitized.accepted
      ? {
          accepted: true,
          value: sanitized.value,
        }
      : fromInputRejection(sanitized);
  }
  if (isRuntimeMemoryTemporalFactCandidate(fact)) {
    const sanitized = sanitizeRuntimeMemoryTemporalFactCandidate(fact);
    return sanitized.accepted
      ? {
          accepted: true,
          value: sanitized.value,
        }
      : fromInputRejection(sanitized);
  }
  return makeStoreRejection("invalid_fact");
}

function toRuntimeFactQuery(
  query: RuntimeMemoryStoreFactQuery,
): RuntimeMemoryFactQuery {
  const verificationStatuses =
    query.verificationStatuses ??
      (query.status !== undefined
        ? [query.status]
        : query.verificationStatus !== undefined
          ? [query.verificationStatus]
          : undefined);
  return {
    subject: query.subject,
    predicate: query.predicate,
    reference_time: query.reference_time ?? query.time,
    includeCandidates: query.includeCandidates,
    includeRejected: query.includeRejected,
    includeInvalidated: query.includeInvalidated,
    includeExpired: query.includeExpired,
    verificationStatuses,
  };
}

function queryAllowsFactShape(
  fact: RuntimeMemoryQueryableFact,
  query: RuntimeMemoryStoreFactQuery,
): boolean {
  if (isRuntimeMemoryTemporalFact(fact)) {
    return true;
  }
  if (explicitlyRequestsStatus(query, fact.verificationStatus)) {
    return true;
  }
  if (fact.verificationStatus === "candidate") {
    return query.includeCandidates === true;
  }
  if (fact.verificationStatus === "rejected") {
    return query.includeRejected === true;
  }
  if (fact.verificationStatus === "invalidated") {
    return query.includeInvalidated === true;
  }
  return false;
}

function explicitlyRequestsStatus(
  query: RuntimeMemoryStoreFactQuery,
  status: RuntimeMemoryVerificationStatus,
): boolean {
  return (
    query.status === status ||
    query.verificationStatus === status ||
    query.verificationStatuses?.includes(status) === true
  );
}

function applyLimit<T>(values: readonly T[], limit: number | undefined): T[] {
  if (limit === undefined) {
    return [...values];
  }
  return Number.isInteger(limit) && limit >= 0 ? values.slice(0, limit) : [...values];
}

function mergeEpisodeEvidence(
  existing: RuntimeMemoryEpisodeRecord,
  incoming: RuntimeMemoryEpisodeRecord,
): RuntimeMemoryEpisodeRecord {
  return {
    ...existing,
    sourceRefs: mergeUnique(existing.sourceRefs, incoming.sourceRefs),
    evidenceRefs: mergeUnique(existing.evidenceRefs, incoming.evidenceRefs),
  };
}

function mergeUnique<T>(left: readonly T[], right: readonly T[]): T[] {
  const seen = new Set(left.map(stableKey));
  const merged = [...left];
  for (const item of right) {
    const key = stableKey(item);
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(item);
    }
  }
  return merged.map(cloneMutable);
}

function evidenceRefMatchesFile(ref: EvidenceRef, file: string): boolean {
  return ref.type === "file" && ref.ref === file;
}

function normalizeBound(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && value !== undefined && value > 0
    ? value
    : fallback;
}

function makeStoreRejection(
  reason: RuntimeMemoryStoreRejectionReason,
): RuntimeMemoryStoreRejection {
  return {
    accepted: false,
    reason,
    message: `Runtime memory store input rejected: ${reason}.`,
  };
}

function fromInputRejection(
  rejection: RuntimeMemoryInputRejection,
): RuntimeMemoryStoreRejection {
  return {
    accepted: false,
    reason: rejection.reason,
    message: rejection.message,
  };
}

function readonlyCloneArray<T>(
  values: readonly T[],
): readonly RuntimeMemoryReadonly<T>[] {
  return readonlyClone([...values]);
}

function readonlyClone<T>(value: T): RuntimeMemoryReadonly<T> {
  return deepFreeze(cloneMutable(value));
}

function cloneMutable<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function deepFreeze<T>(value: T): RuntimeMemoryReadonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value as RuntimeMemoryReadonly<T>;
}

function stableKey(value: unknown): string {
  return JSON.stringify(value);
}
