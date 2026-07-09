// Week 3 v2: Observation 索引化 + 增量物化 + rebuild 双入口.
//
// Source: memory-arch-roadmap.md §C.1, §C.2, Week 3
//
// 核心设计 (v2 工程化):
//   - Observation = 检索单元 + 证据指针 (不是给 LLM 看的长 summary)
//   - 字段: observationId / key / entityIds[] / timeSpan / supportFactIds[] /
//           canonicalFactId? / stats / summary?(≤200 chars, 默认不注入 prompt)
//   - 双入口:
//     * 在线: updateObservationsIncremental(newEvents[]) — 快, 但可能漂移
//     * 离线: rebuildObservationsFromScratch(events[])  — debug/回归
//   - 一致性: 增量物化必须与 rebuild 等价 (单元测试验证)
//   - fallback: 增量漂移时降级为 rebuild (牺牲延迟)
//
// 与 tests/unit/helpers/memory-observation-consolidation.ts 的关系:
//   - 那是 LLM-based 跨会话 fact merging (产生长 summary)
//   - 本模块是 deterministic 索引化 (产生指针结构, 不调 LLM)
//   - 两者互补: LLM consolidation 产出 ObservationFact, 本模块包装成索引化
//     Observation (加 observationId / key / timeSpan / stats 等字段)
//
// 关键约束 (v2):
//   - 生成端默认不直接塞 observation summary 到 prompt
//   - 只拿 canonicalFactId 对应的短 fact + 需要时展开 supportFactIds 的 top-K
//   - summary ≤200 chars, 仅用于 UI 或 bridge discovery 辅助

// === Observation 索引化 schema ===

/**
 * Observation 索引化结构. 检索单元 + 证据指针.
 *
 * 不存储长文本 summary (避免 prompt 注入退步). 生成端只拿 canonicalFactId
 * 对应的短 fact + 需要时展开 supportFactIds 的 top-K.
 */
export type Observation = {
  /** 唯一 ID (deterministic: hash of key + timeSpan.start) */
  observationId: string;
  /** 快速定位键: subject+predicate / entity_set_hash / topic+subTopic+timeBucket */
  key: string;
  /** 实体 IDs (用于 entity join) */
  entityIds: string[];
  /** 时间跨度: {start, end} (用于 hard filter) */
  timeSpan: {
    start: number;
    end: number;
  };
  /** 证据集合 (atomic fact 指针) */
  supportFactIds: string[];
  /** 代表性事实 (短文本/短三元组), 默认取 supportFactIds[0] */
  canonicalFactId?: string;
  /** 统计信息 */
  stats: {
    /** 支持该 observation 的 evidence 数量 */
    supportCount: number;
    /** 冲突数量 (与该 observation 矛盾的 fact 数) */
    conflictCount: number;
    /** 最后证据时间 (Unix ms) */
    lastEvidenceAt: number;
    /** 使用次数 (被 recall 命中的次数, 用于热度统计) */
    usageCount: number;
  };
  /** 可选 summary, 严格限长 ≤200 chars, 仅用于 UI 或 bridge discovery 辅助 */
  summary?: string;
  /**
   * COMPASS 2.0: Structured fidelity (四级保真度之 Structured 层).
   *
   * 紧凑 JSON 三元组: {"s":"<subject>","p":"<predicate>","k":"<key>"}
   * 限长 ≤150 chars. 确定性模板生成 (非 LLM).
   */
  structuredSummary?: string;
};

// === Memory Mutation Event (Week 6 完整实现, 这里最小化) ===

/**
 * 内存变更事件 (Week 6 完整实现 hash chain + REDACT, 这里最小化 schema).
 *
 * 用于 updateObservationsIncremental 的输入. 调用方从 event log 读取事件,
 * 传给本模块更新 observation 物化表.
 */
export type MemoryMutationEvent = {
  eventId: string;
  timestamp: number;
  eventType: "ADD" | "SUPERSEDE" | "INVALIDATE" | "MERGE" | "PRUNE";
  payload: {
    factId: string;
    subject: string;
    predicate: string;
    objectSummary: string;
    /** 实体 IDs (LLM 抽取或 regex 抽取) */
    entityIds?: string[];
    /** valid_at 时间 (Unix ms) */
    validAt: number;
    /** 失效时间 (SUPERSEDE/INVALIDATE 事件用) */
    invalidAt?: number;
    /** 被 supersede 的旧 factId (SUPERSEDE 事件用) */
    supersededFactId?: string;
    /** 合并的 factIds (MERGE 事件用) */
    mergedFactIds?: string[];
  };
};

// === ObservationStore: 物化表 ===

/**
 * Observation 物化表. 维护 key → Observation 的映射.
 *
 * 在线路径: updateObservationsIncremental(newEvents[]) 增量更新.
 * 离线路径: rebuildObservationsFromScratch(allEvents[]) 全量重建.
 *
 * 一致性保证: 增量与 rebuild 等价 (单元测试验证).
 */
export class ObservationStore {
  private observations = new Map<string, Observation>();
  /** factId → observationKey 反向索引 (快速找到包含某 fact 的 observation) */
  private factToObservation = new Map<string, string>();

  /**
   * 在线路径: 增量更新 observation 物化表.
   *
   * 算法 (per event):
   *   - ADD: 找 key (subject+predicate) 匹配的 observation
   *     * 找到: 追加 supportFactIds, 更新 timeSpan/stats
   *     * 未找到: 创建新 observation
   *   - SUPERSEDE: 旧 fact 从 supportFactIds 移除, 新 fact 加入
   *   - INVALIDATE: 旧 fact 从 supportFactIds 移除, 若 supportFactIds 空 → 删除 observation
   *   - MERGE: 合并多个 fact 的 supportFactIds 到一个 observation
   *   - PRUNE: 删除 observation
   *
   * @param newEvents 新事件列表 (按 timestamp 排序)
   */
  updateObservationsIncremental(newEvents: readonly MemoryMutationEvent[]): void {
    for (const event of newEvents) {
      this.applyEvent(event);
    }
  }

  /**
   * 离线路径: 从全部事件全量重建 observation 物化表.
   *
   * 算法: 清空当前状态 → 按顺序 apply 所有事件.
   * 用于 debug/回归测试/增量漂移修复.
   */
  rebuildObservationsFromScratch(allEvents: readonly MemoryMutationEvent[]): void {
    this.observations.clear();
    this.factToObservation.clear();
    for (const event of allEvents) {
      this.applyEvent(event);
    }
  }

  /**
   * 查询: 按 key 获取 observation.
   */
  getByKey(key: string): Observation | undefined {
    return this.observations.get(key);
  }

  /**
   * 查询: 按 observationId 获取.
   */
  getById(observationId: string): Observation | undefined {
    for (const obs of this.observations.values()) {
      if (obs.observationId === observationId) return obs;
    }
    return undefined;
  }

  /**
   * 查询: 按 factId 找到包含该 fact 的 observation.
   */
  getByFactId(factId: string): Observation | undefined {
    const key = this.factToObservation.get(factId);
    if (key === undefined) return undefined;
    return this.observations.get(key);
  }

  /**
   * 查询: 按 entityId 找到所有包含该实体的 observations.
   */
  getByEntityId(entityId: string): Observation[] {
    const result: Observation[] = [];
    for (const obs of this.observations.values()) {
      if (obs.entityIds.includes(entityId)) result.push(obs);
    }
    return result;
  }

  /**
   * 查询: 按时间跨度筛选 (与 timeSpan 有交集).
   */
  getByTimeSpan(start: number, end: number): Observation[] {
    const result: Observation[] = [];
    for (const obs of this.observations.values()) {
      if (obs.timeSpan.start <= end && obs.timeSpan.end >= start) {
        result.push(obs);
      }
    }
    return result;
  }

  /**
   * 获取所有 observations (用于遍历/统计).
   */
  getAll(): Observation[] {
    return [...this.observations.values()];
  }

  /**
   * 统计: 当前 observation 数量.
   */
  size(): number {
    return this.observations.size;
  }

  /**
   * 增加使用次数 (recall 命中时调用).
   */
  incrementUsage(observationKey: string): void {
    const obs = this.observations.get(observationKey);
    if (obs) obs.stats.usageCount += 1;
  }

  /**
   * 设置 summary (限长 ≤200 chars).
   * 超长的截断到 200 chars 并加 "..." 后缀.
   */
  setSummary(observationKey: string, summary: string): void {
    const obs = this.observations.get(observationKey);
    if (!obs) return;
    const trimmed = summary.trim();
    if (trimmed.length <= 200) {
      obs.summary = trimmed;
    } else {
      obs.summary = trimmed.slice(0, 197) + "...";
    }
  }

  /**
   * COMPASS 2.0: 设置 structuredSummary (Structured fidelity, 限长 ≤150 chars).
   *
   * 用于四级保真度之 Structured 层: 紧凑 JSON 三元组.
   * 超长的截断到 150 chars 并加 "..." 后缀.
   */
  setStructuredSummary(observationKey: string, structuredSummary: string): void {
    const obs = this.observations.get(observationKey);
    if (!obs) return;
    const trimmed = structuredSummary.trim();
    if (trimmed.length <= 150) {
      obs.structuredSummary = trimmed;
    } else {
      obs.structuredSummary = trimmed.slice(0, 147) + "...";
    }
  }

  /**
   * COMPASS 2.0: 冷启动 — 为缺少 canonicalFactId 的 observation 加权分配.
   *
   * 按 confidence/sum(confidence) 加权分配 (确定性: 取累积概率 >= 0.5 的第一个).
   * 仅在 canonicalFactId 未设置且 supportFactIds 非空时执行.
   *
   * @param observationKey observation 键
   * @param factsById fact ID → fact 映射 (用于查询 confidence)
   */
  bootstrapCanonicalFactId(
    observationKey: string,
    factsById: ReadonlyMap<string, { confidence?: number }>,
  ): void {
    const obs = this.observations.get(observationKey);
    if (!obs) return;
    if (obs.canonicalFactId || obs.supportFactIds.length === 0) return;

    // 按 confidence/sum(confidence) 加权分配
    const facts = obs.supportFactIds
      .map((id) => factsById.get(id))
      .filter((f): f is { confidence?: number } => f !== undefined);

    if (facts.length === 0) {
      obs.canonicalFactId = obs.supportFactIds[0];
      return;
    }

    const totalConf = facts.reduce(
      (sum, f) => sum + (typeof f.confidence === "number" ? f.confidence : 0),
      0,
    );

    if (totalConf <= 0) {
      obs.canonicalFactId = obs.supportFactIds[0];
      return;
    }

    // 确定性: 取累积概率 >= 0.5 的第一个
    let cumulative = 0;
    for (let i = 0; i < facts.length; i++) {
      const conf = typeof facts[i].confidence === "number" ? facts[i].confidence! : 0;
      cumulative += conf / totalConf;
      if (cumulative >= 0.5) {
        obs.canonicalFactId = obs.supportFactIds[i];
        return;
      }
    }
    // fallback: 取第一个
    obs.canonicalFactId = obs.supportFactIds[0];
  }

  // === 内部: apply 单个事件 ===

  private applyEvent(event: MemoryMutationEvent): void {
    switch (event.eventType) {
      case "ADD":
        this.applyAdd(event);
        break;
      case "SUPERSEDE":
        this.applySupersede(event);
        break;
      case "INVALIDATE":
        this.applyInvalidate(event);
        break;
      case "MERGE":
        this.applyMerge(event);
        break;
      case "PRUNE":
        this.applyPrune(event);
        break;
    }
  }

  private applyAdd(event: MemoryMutationEvent): void {
    const { factId, subject, predicate, entityIds, validAt } = event.payload;
    const key = computeObservationKey(subject, predicate);

    const existing = this.observations.get(key);
    if (existing) {
      // 追加到已有 observation
      if (!existing.supportFactIds.includes(factId)) {
        existing.supportFactIds.push(factId);
      }
      existing.stats.supportCount = existing.supportFactIds.length;
      existing.stats.lastEvidenceAt = Math.max(existing.stats.lastEvidenceAt, validAt);
      existing.timeSpan.start = Math.min(existing.timeSpan.start, validAt);
      existing.timeSpan.end = Math.max(existing.timeSpan.end, validAt);
      // union entityIds
      for (const e of entityIds ?? []) {
        if (!existing.entityIds.includes(e)) existing.entityIds.push(e);
      }
      this.factToObservation.set(factId, key);
    } else {
      // 创建新 observation
      const observation: Observation = {
        observationId: computeObservationId(key, validAt),
        key,
        entityIds: [...(entityIds ?? [])],
        timeSpan: { start: validAt, end: validAt },
        supportFactIds: [factId],
        canonicalFactId: factId,
        stats: {
          supportCount: 1,
          conflictCount: 0,
          lastEvidenceAt: validAt,
          usageCount: 0,
        },
      };
      this.observations.set(key, observation);
      this.factToObservation.set(factId, key);
    }
  }

  private applySupersede(event: MemoryMutationEvent): void {
    const { factId, subject, predicate, entityIds, validAt, supersededFactId } =
      event.payload;
    if (!supersededFactId) return;

    // 1. 从旧 observation 移除 supersededFactId
    const oldKey = this.factToObservation.get(supersededFactId);
    if (oldKey) {
      const oldObs = this.observations.get(oldKey);
      if (oldObs) {
        oldObs.supportFactIds = oldObs.supportFactIds.filter(
          (id) => id !== supersededFactId,
        );
        oldObs.stats.supportCount = oldObs.supportFactIds.length;
        this.factToObservation.delete(supersededFactId);
        // 若 supportFactIds 空 → 删除 observation
        if (oldObs.supportFactIds.length === 0) {
          this.observations.delete(oldKey);
        } else if (oldObs.canonicalFactId === supersededFactId) {
          // 重新选 canonicalFactId
          oldObs.canonicalFactId = oldObs.supportFactIds[0];
        }
      }
    }

    // 2. 把新 fact 加入 (同 ADD 逻辑)
    const key = computeObservationKey(subject, predicate);
    const existing = this.observations.get(key);
    if (existing) {
      if (!existing.supportFactIds.includes(factId)) {
        existing.supportFactIds.push(factId);
      }
      existing.stats.supportCount = existing.supportFactIds.length;
      existing.stats.lastEvidenceAt = Math.max(existing.stats.lastEvidenceAt, validAt);
      existing.timeSpan.start = Math.min(existing.timeSpan.start, validAt);
      existing.timeSpan.end = Math.max(existing.timeSpan.end, validAt);
      for (const e of entityIds ?? []) {
        if (!existing.entityIds.includes(e)) existing.entityIds.push(e);
      }
      this.factToObservation.set(factId, key);
    } else {
      const observation: Observation = {
        observationId: computeObservationId(key, validAt),
        key,
        entityIds: [...(entityIds ?? [])],
        timeSpan: { start: validAt, end: validAt },
        supportFactIds: [factId],
        canonicalFactId: factId,
        stats: {
          supportCount: 1,
          conflictCount: 0,
          lastEvidenceAt: validAt,
          usageCount: 0,
        },
      };
      this.observations.set(key, observation);
      this.factToObservation.set(factId, key);
    }
  }

  private applyInvalidate(event: MemoryMutationEvent): void {
    const { factId } = event.payload;
    const key = this.factToObservation.get(factId);
    if (!key) return;
    const obs = this.observations.get(key);
    if (!obs) return;

    obs.supportFactIds = obs.supportFactIds.filter((id) => id !== factId);
    obs.stats.supportCount = obs.supportFactIds.length;
    this.factToObservation.delete(factId);

    if (obs.supportFactIds.length === 0) {
      this.observations.delete(key);
    } else if (obs.canonicalFactId === factId) {
      obs.canonicalFactId = obs.supportFactIds[0];
    }
  }

  private applyMerge(event: MemoryMutationEvent): void {
    const { factId, subject, predicate, entityIds, validAt, mergedFactIds } =
      event.payload;
    if (!mergedFactIds || mergedFactIds.length === 0) return;

    // 合并多个 fact 的 supportFactIds 到一个 observation
    const key = computeObservationKey(subject, predicate);

    // 收集所有被合并 fact 的 evidence
    const allSupportFactIds = new Set<string>([factId]);
    for (const mergedId of mergedFactIds) {
      allSupportFactIds.add(mergedId);
      // 从被合并 fact 的旧 observation 移除
      const oldKey = this.factToObservation.get(mergedId);
      if (oldKey && oldKey !== key) {
        const oldObs = this.observations.get(oldKey);
        if (oldObs) {
          oldObs.supportFactIds = oldObs.supportFactIds.filter(
            (id) => id !== mergedId,
          );
          oldObs.stats.supportCount = oldObs.supportFactIds.length;
          if (oldObs.supportFactIds.length === 0) {
            this.observations.delete(oldKey);
          } else if (oldObs.canonicalFactId === mergedId) {
            oldObs.canonicalFactId = oldObs.supportFactIds[0];
          }
        }
      }
      this.factToObservation.delete(mergedId);
    }

    // 创建或更新合并后的 observation
    let minTime = validAt;
    let maxTime = validAt;
    const allEntityIds = new Set<string>(entityIds ?? []);
    for (const mergedId of mergedFactIds) {
      const oldKey = this.factToObservation.get(mergedId);
      if (oldKey) {
        const oldObs = this.observations.get(oldKey);
        if (oldObs) {
          minTime = Math.min(minTime, oldObs.timeSpan.start);
          maxTime = Math.max(maxTime, oldObs.timeSpan.end);
          for (const e of oldObs.entityIds) allEntityIds.add(e);
        }
      }
    }

    const observation: Observation = {
      observationId: computeObservationId(key, minTime),
      key,
      entityIds: [...allEntityIds],
      timeSpan: { start: minTime, end: maxTime },
      supportFactIds: [...allSupportFactIds],
      canonicalFactId: factId,
      stats: {
        supportCount: allSupportFactIds.size,
        conflictCount: 0,
        lastEvidenceAt: maxTime,
        usageCount: 0,
      },
    };
    this.observations.set(key, observation);
    for (const id of allSupportFactIds) {
      this.factToObservation.set(id, key);
    }
  }

  private applyPrune(_event: MemoryMutationEvent): void {
    // PRUNE 删除整个 observation (按 key). 这里 event.payload.factId
    // 实际是 observationKey (调用方约定).
    const key = _event.payload.subject; // 约定: PRUNE 时 subject 字段存 key
    const obs = this.observations.get(key);
    if (obs) {
      for (const id of obs.supportFactIds) {
        this.factToObservation.delete(id);
      }
      this.observations.delete(key);
    }
  }
}

// === 工具函数 ===

/**
 * 计算 observation key: subject+predicate (normalized lowercase).
 */
export function computeObservationKey(
  subject: string,
  predicate: string,
): string {
  return `${subject.toLowerCase()}|${predicate.toLowerCase()}`;
}

/**
 * 计算 observation ID: hash of key + timeSpan.start.
 * Deterministic: 同一 key + 同一开始时间 → 同一 ID.
 */
export function computeObservationId(
  key: string,
  startTime: number,
): string {
  // 简单 hash (djb2) — 不需要加密强度, 只需 deterministic
  const input = `${key}@${startTime}`;
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) & 0xffffffff;
  }
  // 转 hex (无符号)
  const hex = (hash >>> 0).toString(16);
  return `obs_${hex}`;
}

/**
 * 验证 summary 限长 ≤200 chars.
 * 超长返回截断版本 (197 + "..."), 否则原样返回.
 */
export function enforceSummaryLimit(summary: string): string {
  const trimmed = summary.trim();
  if (trimmed.length <= 200) return trimmed;
  return trimmed.slice(0, 197) + "...";
}

/**
 * 验证两个 ObservationStore 状态等价 (用于增量 vs rebuild 一致性测试).
 *
 * 比较:
 *   - observation 数量
 *   - 每个 observation 的 key / supportFactIds / timeSpan / stats
 *   - 反向索引 factToObservation
 */
export function assertStoresEqual(
  storeA: ObservationStore,
  storeB: ObservationStore,
): { equal: boolean; diffs: string[] } {
  const diffs: string[] = [];
  const allA = storeA.getAll();
  const allB = storeB.getAll();

  if (allA.length !== allB.length) {
    diffs.push(
      `observation count mismatch: A=${allA.length} B=${allB.length}`,
    );
  }

  // 按 key 比较
  const keysA = new Set(allA.map((o) => o.key));
  const keysB = new Set(allB.map((o) => o.key));
  for (const k of keysA) {
    if (!keysB.has(k)) diffs.push(`key "${k}" only in A`);
  }
  for (const k of keysB) {
    if (!keysA.has(k)) diffs.push(`key "${k}" only in B`);
  }

  // 对每个共同 key 比较内容
  for (const obsA of allA) {
    const obsB = storeB.getByKey(obsA.key);
    if (!obsB) continue;

    if (obsA.observationId !== obsB.observationId) {
      diffs.push(
        `key "${obsA.key}" observationId mismatch: A=${obsA.observationId} B=${obsB.observationId}`,
      );
    }
    if (obsA.supportFactIds.length !== obsB.supportFactIds.length) {
      diffs.push(
        `key "${obsA.key}" supportFactIds length: A=${obsA.supportFactIds.length} B=${obsB.supportFactIds.length}`,
      );
    }
    const setA = new Set(obsA.supportFactIds);
    const setB = new Set(obsB.supportFactIds);
    for (const id of setA) {
      if (!setB.has(id)) diffs.push(`key "${obsA.key}" factId ${id} only in A`);
    }
    for (const id of setB) {
      if (!setA.has(id)) diffs.push(`key "${obsA.key}" factId ${id} only in B`);
    }
    if (obsA.timeSpan.start !== obsB.timeSpan.start) {
      diffs.push(
        `key "${obsA.key}" timeSpan.start: A=${obsA.timeSpan.start} B=${obsB.timeSpan.start}`,
      );
    }
    if (obsA.timeSpan.end !== obsB.timeSpan.end) {
      diffs.push(
        `key "${obsA.key}" timeSpan.end: A=${obsA.timeSpan.end} B=${obsB.timeSpan.end}`,
      );
    }
    if (obsA.stats.supportCount !== obsB.stats.supportCount) {
      diffs.push(
        `key "${obsA.key}" stats.supportCount: A=${obsA.stats.supportCount} B=${obsB.stats.supportCount}`,
      );
    }
    if (obsA.stats.lastEvidenceAt !== obsB.stats.lastEvidenceAt) {
      diffs.push(
        `key "${obsA.key}" stats.lastEvidenceAt: A=${obsA.stats.lastEvidenceAt} B=${obsB.stats.lastEvidenceAt}`,
      );
    }
    if (obsA.canonicalFactId !== obsB.canonicalFactId) {
      diffs.push(
        `key "${obsA.key}" canonicalFactId: A=${obsA.canonicalFactId} B=${obsB.canonicalFactId}`,
      );
    }
  }

  return { equal: diffs.length === 0, diffs };
}
