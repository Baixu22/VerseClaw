// Week 6 v2: Memory governance signals + auto-trigger rules.
//
// Source: memory-arch-roadmap.md §D3, Week 6
//
// 核心设计:
//   - 4 信号监控: conflictDensity / driftScore / staleRatio / hotSpotCount
//   - 自动触发规则 (避免误触发, 阈值来自 roadmap §D3):
//     - conflictDensity > 0.15 → 触发 LLM reconcile
//     - driftScore > 0.3       → 触发 observation rebuild
//     - staleRatio > 0.4       → 触发 prune
//   - 阈值与默认值集中常量化, 便于 A/B 调参
//
// 与 Hindsight 区别:
//   - Hindsight: background consolidation 无差别全量跑 (无信号)
//   - ClawX: 信号驱动按需触发, 成本可控
//
// 误触发防护 (roadmap: 误触发率 ≤5%):
//   - driftScore 使用 KL 散度, 对零样本/低样本数返回 0 (不触发)
//   - conflictDensity/staleRatio 在总 fact 数 < 10 时返回 0 (避免小样本噪声)
//   - hotSpotCount 不触发任何动作, 仅作为观测指标

// === 类型定义 ===

/**
 * 治理信号输入: fact 列表 + 可选分布数据.
 *
 * fact 字段说明:
 *   - invalidAt 有值: 该 fact 被取代/失效 (用于 conflictDensity)
 *   - lastAccessedAt: 最后访问时间 (用于 staleRatio)
 *   - accessCount: 访问次数 (用于 hotSpotCount)
 *   - subject/predicate: 用于 driftScore 分布
 */
export type GovernanceFactInput = {
  factId: string;
  invalidAt?: number;
  lastAccessedAt?: number;
  accessCount?: number;
  subject: string;
  predicate: string;
};

export type GovernanceInput = {
  facts: GovernanceFactInput[];
  /** 最近 N turns (driftScore 用), 默认 100 */
  recentTurnCount?: number;
  /** 参考时间 (默认 Date.now()) */
  referenceTime?: number;
  /** 陈旧阈值天数 (默认 30) */
  pruneStaleDays?: number;
  /** 热点访问阈值 (默认 5 次) */
  hotSpotThreshold?: number;
  /**
   * 最近 N turns 的 fact 分布 (subject → count).
   * 若未提供, driftScore 返回 0.
   */
  recentFactDistribution?: Map<string, number>;
  /**
   * 历史分布 (subject → count).
   * 若未提供, driftScore 返回 0.
   */
  historicalFactDistribution?: Map<string, number>;
};

/**
 * 治理信号计算结果.
 */
export type GovernanceSignals = {
  /** 冲突 fact 占比 (0-1) */
  conflictDensity: number;
  /** 最近 vs 历史的 KL 散度 (0-∞, 0 表示无漂移或样本不足) */
  driftScore: number;
  /** 陈旧 fact 占比 (0-1) */
  staleRatio: number;
  /** 高频访问 fact 数量 */
  hotSpotCount: number;
  /** 总 fact 数 */
  totalFacts: number;
  /** 冲突 fact 数 */
  conflictCount: number;
  /** 陈旧 fact 数 */
  staleCount: number;
  /** 计算时间戳 */
  computedAt: number;
};

export type GovernanceActionType = "reconcile" | "rebuild" | "prune" | "none";

/**
 * 治理决策: 单条触发.
 */
export type GovernanceDecision = {
  action: GovernanceActionType;
  /** 触发信号 */
  trigger: "conflictDensity" | "driftScore" | "staleRatio" | "none";
  /** 信号值 */
  value: number;
  /** 阈值 */
  threshold: number;
};

// === 阈值常量 (roadmap §D3) ===

export const GOVERNANCE_THRESHOLDS = {
  conflictDensity: 0.15,
  driftScore: 0.3,
  staleRatio: 0.4,
} as const;

export const GOVERNANCE_DEFAULTS = {
  recentTurnCount: 100,
  pruneStaleDays: 30,
  hotSpotThreshold: 5,
  /** 小样本保护: 总 fact 数 < 此值时 conflictDensity/staleRatio 返回 0 */
  minSampleSize: 10,
  /** driftScore KL 散度中, 概率为 0 的项使用的平滑值 */
  klSmoothingEpsilon: 1e-6,
} as const;

// === 核心函数 ===

/**
 * 计算 4 治理信号.
 *
 * 算法:
 *   - conflictDensity = (有 invalidAt 的 fact 数) / 总 fact 数
 *   - driftScore = KL(recent || historical), 无分布时返回 0
 *   - staleRatio = (lastAccessedAt 距 referenceTime > pruneStaleDays 的 fact 数) / 总 fact 数
 *   - hotSpotCount = accessCount >= hotSpotThreshold 的 fact 数
 *
 * 小样本保护:
 *   - 总 fact 数 < 10 时, conflictDensity/staleRatio 返回 0 (避免噪声)
 *   - driftScore 在分布样本数 < 10 时返回 0
 */
export function computeGovernanceSignals(
  input: GovernanceInput,
): GovernanceSignals {
  const referenceTime = input.referenceTime ?? Date.now();
  const pruneStaleDays = input.pruneStaleDays ?? GOVERNANCE_DEFAULTS.pruneStaleDays;
  const hotSpotThreshold =
    input.hotSpotThreshold ?? GOVERNANCE_DEFAULTS.hotSpotThreshold;
  const minSampleSize = GOVERNANCE_DEFAULTS.minSampleSize;

  const totalFacts = input.facts.length;

  // conflictDensity: 有 invalidAt 的 fact 数 / 总 fact 数
  let conflictCount = 0;
  for (const f of input.facts) {
    if (f.invalidAt !== undefined && f.invalidAt !== null) {
      conflictCount += 1;
    }
  }
  const conflictDensity =
    totalFacts >= minSampleSize ? conflictCount / totalFacts : 0;

  // staleRatio: (referenceTime - lastAccessedAt) > pruneStaleDays 的 fact 数 / 总 fact 数
  const staleThresholdMs = pruneStaleDays * 24 * 60 * 60 * 1000;
  let staleCount = 0;
  for (const f of input.facts) {
    if (f.lastAccessedAt === undefined || f.lastAccessedAt === null) {
      // 从未访问的 fact 视为陈旧 (未产生访问记录)
      staleCount += 1;
      continue;
    }
    if (referenceTime - f.lastAccessedAt > staleThresholdMs) {
      staleCount += 1;
    }
  }
  const staleRatio = totalFacts >= minSampleSize ? staleCount / totalFacts : 0;

  // hotSpotCount: accessCount >= hotSpotThreshold 的 fact 数
  let hotSpotCount = 0;
  for (const f of input.facts) {
    if ((f.accessCount ?? 0) >= hotSpotThreshold) {
      hotSpotCount += 1;
    }
  }

  // driftScore: KL(recent || historical)
  const driftScore = computeKlDivergence(
    input.recentFactDistribution,
    input.historicalFactDistribution,
  );

  return {
    conflictDensity,
    driftScore,
    staleRatio,
    hotSpotCount,
    totalFacts,
    conflictCount,
    staleCount,
    computedAt: referenceTime,
  };
}

/**
 * 根据信号决策触发的单个最高优先级动作.
 *
 * 优先级 (高 → 低): reconcile > rebuild > prune
 * (冲突解决优先于漂移修复, 漂移修复优先于清理)
 *
 * 阈值 (roadmap §D3):
 *   - conflictDensity > 0.15 → reconcile
 *   - driftScore > 0.3       → rebuild
 *   - staleRatio > 0.4       → prune
 */
export function decideGovernanceAction(
  signals: GovernanceSignals,
): GovernanceDecision {
  // 多信号同时触发时, 选优先级最高的返回
  const decisions = applyGovernanceRules(signals);
  if (decisions.length === 0) {
    return {
      action: "none",
      trigger: "none",
      value: 0,
      threshold: 0,
    };
  }
  // 优先级排序: reconcile > rebuild > prune
  const priority: Record<GovernanceActionType, number> = {
    reconcile: 3,
    rebuild: 2,
    prune: 1,
    none: 0,
  };
  decisions.sort((a, b) => priority[b.action] - priority[a.action]);
  return decisions[0];
}

/**
 * 应用所有触发规则, 返回所有被触发的决策列表 (可能有多个).
 */
export function applyGovernanceRules(
  signals: GovernanceSignals,
): GovernanceDecision[] {
  const decisions: GovernanceDecision[] = [];

  if (
    signals.conflictDensity > GOVERNANCE_THRESHOLDS.conflictDensity
  ) {
    decisions.push({
      action: "reconcile",
      trigger: "conflictDensity",
      value: signals.conflictDensity,
      threshold: GOVERNANCE_THRESHOLDS.conflictDensity,
    });
  }

  if (signals.driftScore > GOVERNANCE_THRESHOLDS.driftScore) {
    decisions.push({
      action: "rebuild",
      trigger: "driftScore",
      value: signals.driftScore,
      threshold: GOVERNANCE_THRESHOLDS.driftScore,
    });
  }

  if (signals.staleRatio > GOVERNANCE_THRESHOLDS.staleRatio) {
    decisions.push({
      action: "prune",
      trigger: "staleRatio",
      value: signals.staleRatio,
      threshold: GOVERNANCE_THRESHOLDS.staleRatio,
    });
  }

  return decisions;
}

// === 内部工具: KL 散度 ===

/**
 * 计算 KL 散度 D(P || Q) = Σ P(i) * log(P(i) / Q(i)).
 *
 * P = recent, Q = historical.
 * 使用 add-ε 平滑避免 log(0) / 除零.
 *
 * 小样本保护:
 *   - 任一分布样本数 < 10 → 返回 0 (避免小样本噪声误触发)
 *   - 无分布输入 → 返回 0
 */
export function computeKlDivergence(
  recent?: Map<string, number>,
  historical?: Map<string, number>,
): number {
  if (!recent || !historical) return 0;
  if (recent.size === 0 || historical.size === 0) return 0;

  // 样本总数
  let recentTotal = 0;
  for (const v of recent.values()) recentTotal += v;
  let histTotal = 0;
  for (const v of historical.values()) histTotal += v;
  if (recentTotal < GOVERNANCE_DEFAULTS.minSampleSize) return 0;
  if (histTotal < GOVERNANCE_DEFAULTS.minSampleSize) return 0;

  const eps = GOVERNANCE_DEFAULTS.klSmoothingEpsilon;
  const allKeys = new Set<string>([
    ...recent.keys(),
    ...historical.keys(),
  ]);

  let kl = 0;
  for (const key of allKeys) {
    const p = (recent.get(key) ?? 0) / recentTotal;
    const q = (historical.get(key) ?? 0) / histTotal;
    // add-ε 平滑
    const pSmooth = p + eps;
    const qSmooth = q + eps;
    if (p > 0) {
      kl += p * Math.log(pSmooth / qSmooth);
    }
  }
  // 数值稳定性: KL 应 ≥ 0, 负值来自浮点误差, 截断到 0
  return Math.max(0, kl);
}

// === 治理面板 API (返回 JSON-serializable) ===

/**
 * 治理面板输出 (GET /memory/health?userId=X).
 */
export type GovernanceHealthReport = {
  userId: string;
  signals: GovernanceSignals;
  triggeredActions: GovernanceDecision[];
  topDecision: GovernanceDecision;
  thresholds: typeof GOVERNANCE_THRESHOLDS;
};

/**
 * 生成治理健康报告.
 */
export function buildHealthReport(
  userId: string,
  input: GovernanceInput,
): GovernanceHealthReport {
  const signals = computeGovernanceSignals(input);
  const triggeredActions = applyGovernanceRules(signals);
  const topDecision = decideGovernanceAction(signals);
  return {
    userId,
    signals,
    triggeredActions,
    topDecision,
    thresholds: GOVERNANCE_THRESHOLDS,
  };
}
