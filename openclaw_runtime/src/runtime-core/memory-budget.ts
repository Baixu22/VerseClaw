// Week 6 v2: LLM call budget + degradation strategy.
//
// Source: memory-arch-roadmap.md §D4, E.2 #13, Week 6
//
// 核心设计:
//   - 每 100 turns 允许 X 次 LLM 调用 (默认 X=5)
//   - 超预算时降级为纯规则决策 (不调用 LLM, 不中断服务)
//   - 滑动窗口: 保留最近 100 turns 的调用记录, 老化掉窗口外的
//   - 多类型预算: reconcile / regenerate / critique / redact-decide
//
// 与 Hindsight 区别:
//   - Hindsight: 每次 add 都调 LLM (CREATE/UPDATE/DELETE), 无预算控制
//   - ClawX: 严格预算 + 降级策略, 成本可预测
//
// 验收门槛 (roadmap E.2 #13):
//   - 超预算后降级为纯规则决策, 不调用 LLM (verified by tryAcquire 返回 false)

// === 类型定义 ===

/**
 * LLM 调用类型. 不同类型有独立预算 (避免单一类型耗尽影响其他).
 */
export type LLMCallType =
  | "reconcile" // AUDN 冲突解决 LLM 决策
  | "regenerate" // Reflect agent 再生成
  | "critique" // Reflect agent 评判
  | "redact_decide"; // REDACT 决策 (合规删除是否允许)

export type BudgetConfig = {
  /** 窗口大小 (turns), 默认 100 */
  windowSize: number;
  /** 每窗口各类型的限额 */
  limits: Record<LLMCallType, number>;
};

export const DEFAULT_BUDGET_CONFIG: BudgetConfig = {
  windowSize: 100,
  limits: {
    reconcile: 5, // roadmap §D4: 默认 X=5
    regenerate: 30, // Reflect agent: 30% 题目可触发再生 (与 ReflectBudget.maxReRetrieveRate 对齐)
    critique: 50, // critique 是 cheap, 但仍需限额
    redact_decide: 5, // REDACT 决策: 罕见但需要 LLM
  },
};

/**
 * 单次 LLM 调用记录.
 */
export type LLMCallRecord = {
  callType: LLMCallType;
  turnIndex: number; // 在窗口内的 turn 编号
  timestamp: number;
  /** 是否成功 (false 表示降级后绕过 LLM, 仅记录尝试) */
  succeeded: boolean;
  /** 调用前的剩余预算 (用于审计) */
  remainingBefore: number;
};

/**
 * 预算使用统计.
 */
export type BudgetStats = {
  /** 当前窗口大小 */
  windowSize: number;
  /** 各类型: 已用 / 限额 / 剩余 / 是否降级 */
  usage: Record<
    LLMCallType,
    { used: number; limit: number; remaining: number; degraded: boolean }
  >;
  /** 当前窗口起始 turn */
  windowStartTurn: number;
  /** 当前 turn */
  currentTurn: number;
  /** 总调用次数 (含降级绕过) */
  totalAttempts: number;
  /** 降级次数 (被预算拒绝的次数) */
  totalDegraded: number;
};

export type BudgetCheckResult = {
  /** 是否允许调用 LLM */
  allowed: boolean;
  /** 调用前剩余预算 (allowed=false 时为 0) */
  remaining: number;
  /** 是否处于降级状态 */
  degraded: boolean;
  /** 拒绝原因 (allowed=false 时填充) */
  reason?: string;
};

// === 预算控制器 ===

/**
 * LLM 调用预算控制器.
 *
 * 滑动窗口算法:
 *   - 维护每个 callType 的调用记录列表
 *   - 当前 turn - record.turnIndex >= windowSize 的记录从窗口剔除
 *   - 窗口内记录数 < limit 时允许调用
 *
 * 用法:
 *   const budget = new LLMCallBudget();
 *   for (let turn = 0; turn < 200; turn++) {
 *     const check = budget.check("reconcile", turn);
 *     if (check.allowed) {
 *       // 调用 LLM
 *       budget.recordCall("reconcile", turn, true);
 *     } else {
 *       // 降级为纯规则决策
 *     }
 *   }
 */
export class LLMCallBudget {
  private config: BudgetConfig;
  private records: Map<LLMCallType, LLMCallRecord[]> = new Map();
  private currentTurn = 0;
  private totalAttempts = 0;
  private totalDegraded = 0;

  constructor(config: Partial<BudgetConfig> = {}) {
    this.config = {
      windowSize: config.windowSize ?? DEFAULT_BUDGET_CONFIG.windowSize,
      limits: { ...DEFAULT_BUDGET_CONFIG.limits, ...config.limits },
    };
    // 初始化各类型的记录列表
    for (const ct of Object.keys(this.config.limits) as LLMCallType[]) {
      this.records.set(ct, []);
    }
  }

  /**
   * 检查指定类型是否可调用 LLM (不消耗预算).
   *
   * 注意: 此方法不消耗预算, 仅检查. 实际调用后必须 recordCall().
   * 这样设计是为了: 如果 LLM 调用失败, 不会消耗预算.
   *
   * @param callType LLM 调用类型
   * @param turnIndex 当前 turn 编号 (可选, 默认使用内部 currentTurn)
   */
  check(
    callType: LLMCallType,
    turnIndex?: number,
  ): BudgetCheckResult {
    const turn = turnIndex ?? this.currentTurn;
    if (turn > this.currentTurn) {
      this.currentTurn = turn;
    }
    this.evictOldRecords(turn);

    const limit = this.config.limits[callType];
    const records = this.records.get(callType) ?? [];
    const used = records.length;
    const remaining = limit - used;

    if (remaining <= 0) {
      return {
        allowed: false,
        remaining: 0,
        degraded: true,
        reason: `budget_exhausted: ${callType} ${used}/${limit} in last ${this.config.windowSize} turns`,
      };
    }

    return {
      allowed: true,
      remaining,
      degraded: false,
    };
  }

  /**
   * 记录一次 LLM 调用 (消耗预算).
   *
   * @param callType LLM 调用类型
   * @param turnIndex 当前 turn 编号
   * @param succeeded 是否成功 (false 表示尝试了但失败)
   */
  recordCall(
    callType: LLMCallType,
    turnIndex?: number,
    succeeded = true,
  ): LLMCallRecord {
    const turn = turnIndex ?? this.currentTurn;
    this.totalAttempts += 1;
    const checkResult = this.check(callType, turn);
    const remainingBefore = checkResult.remaining;

    const record: LLMCallRecord = {
      callType,
      turnIndex: turn,
      timestamp: Date.now(),
      succeeded,
      remainingBefore,
    };

    if (!checkResult.allowed) {
      // 降级: 不记录到预算中, 但增加 totalDegraded 计数
      this.totalDegraded += 1;
      return record;
    }

    const records = this.records.get(callType) ?? [];
    records.push(record);
    this.records.set(callType, records);
    return record;
  }

  /**
   * 便捷方法: 检查并记录 (原子操作).
   *
   * 如果允许调用, 自动记录; 否则返回 degraded.
   * 适用于: 调用 LLM 前不需要 pre-check 的简单场景.
   *
   * @returns allowed=true 表示已消耗预算 (remaining 为消耗后的剩余), allowed=false 表示降级
   */
  tryAcquire(
    callType: LLMCallType,
    turnIndex?: number,
  ): BudgetCheckResult {
    const check = this.check(callType, turnIndex);
    if (!check.allowed) {
      this.totalAttempts += 1;
      this.totalDegraded += 1;
      return check;
    }
    this.recordCall(callType, turnIndex, true);
    // 返回消耗后的状态: remaining - 1
    return {
      allowed: true,
      remaining: check.remaining - 1,
      degraded: false,
    };
  }

  /**
   * 推进 turn (无操作时也调用, 维护窗口).
   */
  advanceTurn(): void {
    this.currentTurn += 1;
    this.evictOldRecords(this.currentTurn);
  }

  /**
   * 获取预算统计.
   */
  getStats(): BudgetStats {
    this.evictOldRecords(this.currentTurn);
    const usage = {} as BudgetStats["usage"];
    for (const ct of Object.keys(this.config.limits) as LLMCallType[]) {
      const limit = this.config.limits[ct];
      const used = (this.records.get(ct) ?? []).length;
      const remaining = Math.max(0, limit - used);
      usage[ct] = {
        used,
        limit,
        remaining,
        degraded: remaining === 0,
      };
    }
    return {
      windowSize: this.config.windowSize,
      usage,
      windowStartTurn: Math.max(0, this.currentTurn - this.config.windowSize + 1),
      currentTurn: this.currentTurn,
      totalAttempts: this.totalAttempts,
      totalDegraded: this.totalDegraded,
    };
  }

  /**
   * 重置预算 (用于测试或人工干预).
   */
  reset(): void {
    for (const ct of Object.keys(this.config.limits) as LLMCallType[]) {
      this.records.set(ct, []);
    }
    this.currentTurn = 0;
    this.totalAttempts = 0;
    this.totalDegraded = 0;
  }

  // === 内部: 滑动窗口老化 ===

  /**
   * 剔除窗口外的旧记录.
   * 窗口定义: [currentTurn - windowSize + 1, currentTurn]
   * 即: turnIndex < currentTurn - windowSize + 1 的记录被剔除
   */
  private evictOldRecords(currentTurn: number): void {
    const windowStart = currentTurn - this.config.windowSize + 1;
    for (const [ct, records] of this.records.entries()) {
      const fresh = records.filter((r) => r.turnIndex >= windowStart);
      if (fresh.length !== records.length) {
        this.records.set(ct, fresh);
      }
    }
  }
}

// === 降级策略 ===

/**
 * 降级决策: 当 LLM 预算耗尽时, 选择降级路径.
 *
 * 各 callType 的降级策略:
 *   - reconcile: 降级为纯规则决策 (AUDN 四层的前三层, 不进 LLM 层)
 *     → 默认决策: SUPERSEDE (规则层匹配) 或 ADD (无匹配)
 *   - regenerate: 降级为保持原答案 (不重新生成)
 *   - critique: 降级为跳过 critique (信任原答案)
 *   - redact_decide: 降级为允许 redact (合规优先, 不阻塞删除)
 */
export type DegradationStrategy = {
  callType: LLMCallType;
  /** 降级时采取的动作 */
  fallback: "rule_only" | "keep_original" | "skip" | "allow";
  /** 降级原因 */
  reason: string;
};

export const DEGRADATION_STRATEGIES: Record<LLMCallType, DegradationStrategy> =
  {
    reconcile: {
      callType: "reconcile",
      fallback: "rule_only",
      reason: "AUDN LLM layer degraded to rule-only (layer 1-3)",
    },
    regenerate: {
      callType: "regenerate",
      fallback: "keep_original",
      reason: "Reflect regeneration skipped, keeping initial answer",
    },
    critique: {
      callType: "critique",
      fallback: "skip",
      reason: "Reflect critique skipped, trusting initial answer",
    },
    redact_decide: {
      callType: "redact_decide",
      fallback: "allow",
      reason: "REDACT decision auto-allowed (compliance priority over budget)",
    },
  };

/**
 * 获取降级策略.
 */
export function getDegradationStrategy(
  callType: LLMCallType,
): DegradationStrategy {
  return DEGRADATION_STRATEGIES[callType];
}

/**
 * 预算面板输出 (GET /memory/budget?userId=X).
 */
export type BudgetReport = {
  userId: string;
  stats: BudgetStats;
  degradationStrategies: Record<LLMCallType, DegradationStrategy>;
  config: BudgetConfig;
};

/**
 * 生成预算报告.
 */
export function buildBudgetReport(
  userId: string,
  budget: LLMCallBudget,
): BudgetReport {
  return {
    userId,
    stats: budget.getStats(),
    degradationStrategies: DEGRADATION_STRATEGIES,
    config: {
      windowSize: DEFAULT_BUDGET_CONFIG.windowSize,
      limits: DEFAULT_BUDGET_CONFIG.limits,
    },
  };
}
