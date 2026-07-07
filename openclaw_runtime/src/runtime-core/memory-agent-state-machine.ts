// Week 5 v2: Agent state-machine (8-12 步强约束 + 结构化状态增量).
//
// Source: memory-arch-roadmap.md §B5, Week 5
//
// 决策: 从 max 150 re-retrievals 收紧到 8-12 步强约束序列,
//   每步必须产生结构化状态增量 (MemoryReasoningStateDelta).
//
// 与 Hindsight 区别:
//   - Hindsight: forced sequence mental_models → observations → recall (3 层固定)
//   - ClawX: state-machine 按类别条件触发 + 结构化状态增量
//     1. recall (必选): 单次 hybrid retrieval
//     2. bridge_probe (条件): 仅 multi_hop 类别触发, 1-2 次
//     3. evidence_expand (条件): 仅当 bridge 命中, 1 次
//     4. reconcile (条件): 仅当冲突检测, 1 次 LLM
//
// 硬约束:
//   - 总步数 8-12 (超过 12 强制终止)
//   - 禁止重复 recall 超过 2 次 (防止 8 次重复 recall)
//   - 每步必须输出 stateDelta (hypotheses/constraints/missingInfo/nextAction)
//
// 工程优势:
//   - 状态增量可写入 trace, 支持可回放
//   - 按类别条件触发 (非 multi_hop 不跑 bridge_probe), 成本低

// === Schema ===

/**
 * State-machine 步骤类型. 从白名单中选.
 */
export type AgentStepType =
  | "recall" // 单次 hybrid retrieval (必选, 最多 2 次)
  | "bridge_probe" // 桥发现 (仅 multi_hop, 1-2 次)
  | "evidence_expand" // 从桥 fact 扩张 (仅 bridge 命中, 1 次)
  | "reconcile" // LLM 冲突调和 (仅冲突检测, 1 次)
  | "generate" // LLM 生成答案 (必选, 1 次)
  | "finalize"; // 终止 (必选, 1 次)

/**
 * 结构化状态增量 (每步必须输出).
 *
 * 写入 recall trace.agentSteps, 支持可回放/可调试.
 */
export type MemoryReasoningStateDelta = {
  /** 当前可能的桥实体/桥 observation */
  hypotheses?: string[];
  /** 时间、实体、关系类型约束 */
  constraints?: {
    temporalPolicy?: "strict_current" | "include_history_ranked" | "as_of";
    entities?: string[];
    relationTypes?: string[];
    maxSteps?: number;
  };
  /** 还差哪段证据 (null = 已足够) */
  missingInfo: string | null;
  /** 下一步动作 (从白名单选) */
  nextAction: AgentStepType | "done";
  /**
   * 重复 recall 计数 (硬约束: 禁止 > 2).
   * state-machine 自动维护, 调用方只读.
   */
  repeatedRecallCount?: number;
};

/**
 * 单步执行记录.
 */
export type AgentStepRecord = {
  /** 步骤序号 (0-based) */
  stepIndex: number;
  /** 步骤类型 */
  stepType: AgentStepType;
  /** 状态增量 */
  stateDelta: MemoryReasoningStateDelta;
  /** 步骤耗时 (ms) */
  durationMs?: number;
  /** 步骤产出 (fact IDs / answer text) */
  output?: {
    recalledFactIds?: string[];
    bridgeFactIds?: string[];
    expansionFactIds?: string[];
    answer?: string;
  };
};

/**
 * State-machine 配置.
 */
export type StateMachineConfig = {
  /** 最大步数 (默认 12) */
  maxSteps?: number;
  /** 最小步数 (默认 8, 低于此数不允许 finalize, 除非 done) */
  minSteps?: number;
  /** 最大 recall 次数 (默认 2, 硬约束) */
  maxRecallCount?: number;
  /** 最大 bridge_probe 次数 (默认 2) */
  maxBridgeProbeCount?: number;
  /** 最大 evidence_expand 次数 (默认 1) */
  maxEvidenceExpandCount?: number;
  /** 最大 reconcile 次数 (默认 1) */
  maxReconcileCount?: number;
  /** 问题类别 (控制条件触发) */
  category?: "temporal" | "open_domain" | "single_hop" | "multi_hop" | "unknown";
};

/**
 * State-machine 状态.
 */
export type StateMachineState = {
  /** 当前步数 (0-based) */
  currentStep: number;
  /** 已执行步骤记录 */
  steps: AgentStepRecord[];
  /** recall 次数 (硬约束: ≤ maxRecallCount) */
  recallCount: number;
  /** bridge_probe 次数 */
  bridgeProbeCount: number;
  /** evidence_expand 次数 */
  evidenceExpandCount: number;
  /** reconcile 次数 */
  reconcileCount: number;
  /** generate 次数 */
  generateCount: number;
  /** 是否已 finalize */
  finalized: boolean;
  /** 终止原因 */
  terminationReason?: "completed" | "max_steps_exceeded" | "constraint_violation";
};

// === State-machine 主类 ===

/**
 * Agent state-machine.
 *
 * 用法:
 *   const sm = new AgentStateMachine({ category: "multi_hop" });
 *   sm.start();
 *   sm.executeStep("recall", stateDelta);
 *   sm.executeStep("bridge_probe", stateDelta);  // multi_hop 才允许
 *   sm.executeStep("evidence_expand", stateDelta);  // bridge 命中才允许
 *   sm.executeStep("generate", stateDelta);
 *   sm.finalize(stateDelta);
 */
export class AgentStateMachine {
  private state: StateMachineState;
  private readonly config: Required<Omit<StateMachineConfig, "category">> & {
    category: NonNullable<StateMachineConfig["category"]>;
  };

  constructor(config: StateMachineConfig = {}) {
    this.config = {
      maxSteps: config.maxSteps ?? 12,
      minSteps: config.minSteps ?? 8,
      maxRecallCount: config.maxRecallCount ?? 2,
      maxBridgeProbeCount: config.maxBridgeProbeCount ?? 2,
      maxEvidenceExpandCount: config.maxEvidenceExpandCount ?? 1,
      maxReconcileCount: config.maxReconcileCount ?? 1,
      category: config.category ?? "unknown",
    };
    this.state = {
      currentStep: 0,
      steps: [],
      recallCount: 0,
      bridgeProbeCount: 0,
      evidenceExpandCount: 0,
      reconcileCount: 0,
      generateCount: 0,
      finalized: false,
    };
  }

  /**
   * 启动 state-machine. 初始化第一步.
   */
  start(): void {
    if (this.state.currentStep !== 0) {
      throw new Error("StateMachine already started");
    }
    this.state.currentStep = 1;
  }

  /**
   * 执行一步. 检查硬约束, 违反则抛错.
   *
   * @param stepType 步骤类型
   * @param stateDelta 状态增量 (必须包含 nextAction)
   * @param output 步骤产出 (可选)
   * @returns 步骤记录
   */
  executeStep(
    stepType: AgentStepType,
    stateDelta: MemoryReasoningStateDelta,
    output?: AgentStepRecord["output"],
  ): AgentStepRecord {
    if (this.state.finalized) {
      throw new Error("StateMachine already finalized");
    }
    if (this.state.currentStep > this.config.maxSteps) {
      this.state.terminationReason = "max_steps_exceeded";
      throw new Error(
        `Max steps exceeded: ${this.config.maxSteps} (constraint violation)`,
      );
    }

    // 检查硬约束
    this.validateStep(stepType, stateDelta);

    // 更新计数器
    this.incrementCounter(stepType);

    // 记录步骤
    const record: AgentStepRecord = {
      stepIndex: this.state.steps.length,
      stepType,
      stateDelta: {
        ...stateDelta,
        repeatedRecallCount: this.state.recallCount,
      },
      output,
    };
    this.state.steps.push(record);
    this.state.currentStep += 1;

    return record;
  }

  /**
   * 终止 state-machine.
   */
  finalize(stateDelta: MemoryReasoningStateDelta): AgentStepRecord {
    if (this.state.finalized) {
      throw new Error("StateMachine already finalized");
    }

    // finalize 前必须有 generate
    if (this.state.generateCount === 0) {
      throw new Error(
        "Cannot finalize: generate step is required before finalize",
      );
    }

    const record: AgentStepRecord = {
      stepIndex: this.state.steps.length,
      stepType: "finalize",
      stateDelta: {
        ...stateDelta,
        nextAction: "done",
        repeatedRecallCount: this.state.recallCount,
      },
    };
    this.state.steps.push(record);
    this.state.finalized = true;
    this.state.terminationReason = "completed";
    return record;
  }

  /**
   * 获取当前状态 (只读).
   */
  getState(): Readonly<StateMachineState> {
    return this.state;
  }

  /**
   * 获取所有步骤记录 (只读).
   */
  getSteps(): readonly AgentStepRecord[] {
    return this.state.steps;
  }

  /**
   * 检查是否可以执行某步骤 (不实际执行).
   */
  canExecute(stepType: AgentStepType): boolean {
    // 未 start 时拒绝执行
    if (this.state.currentStep === 0) {
      return false;
    }
    // 已 finalized 时拒绝执行
    if (this.state.finalized) {
      return false;
    }
    try {
      this.validateStep(stepType, {
        missingInfo: null,
        nextAction: "done",
      });
      return true;
    } catch {
      return false;
    }
  }

  // === 内部: 硬约束校验 ===

  private validateStep(
    stepType: AgentStepType,
    stateDelta: MemoryReasoningStateDelta,
  ): void {
    // 1. nextAction 必须在白名单
    const validNextActions: AgentStepType[] = [
      "recall",
      "bridge_probe",
      "evidence_expand",
      "reconcile",
      "generate",
      "finalize",
    ];
    if (
      stateDelta.nextAction !== "done" &&
      !validNextActions.includes(stateDelta.nextAction)
    ) {
      throw new Error(
        `Invalid nextAction: ${stateDelta.nextAction}. Must be one of: ${validNextActions.join(", ")}, done`,
      );
    }

    // 2. recall 硬约束: ≤ maxRecallCount
    if (stepType === "recall" && this.state.recallCount >= this.config.maxRecallCount) {
      throw new Error(
        `recall constraint violation: maxRecallCount=${this.config.maxRecallCount} exceeded (禁止重复 recall 超过 ${this.config.maxRecallCount} 次)`,
      );
    }

    // 3. bridge_probe 条件触发: 仅 multi_hop 类别
    if (stepType === "bridge_probe") {
      if (this.config.category !== "multi_hop") {
        throw new Error(
          `bridge_probe condition violation: only allowed for multi_hop category (current: ${this.config.category})`,
        );
      }
      if (this.state.bridgeProbeCount >= this.config.maxBridgeProbeCount) {
        throw new Error(
          `bridge_probe constraint violation: maxBridgeProbeCount=${this.config.maxBridgeProbeCount} exceeded`,
        );
      }
    }

    // 4. evidence_expand 条件触发: 仅当 bridge_probe 命中 (bridgeProbeCount > 0)
    if (stepType === "evidence_expand") {
      if (this.state.bridgeProbeCount === 0) {
        throw new Error(
          "evidence_expand condition violation: requires bridge_probe to have run first",
        );
      }
      if (this.state.evidenceExpandCount >= this.config.maxEvidenceExpandCount) {
        throw new Error(
          `evidence_expand constraint violation: maxEvidenceExpandCount=${this.config.maxEvidenceExpandCount} exceeded`,
        );
      }
    }

    // 5. reconcile 条件触发: 仅 1 次
    if (stepType === "reconcile") {
      if (this.state.reconcileCount >= this.config.maxReconcileCount) {
        throw new Error(
          `reconcile constraint violation: maxReconcileCount=${this.config.maxReconcileCount} exceeded`,
        );
      }
    }

    // 6. generate: 仅 1 次 (在 finalize 前)
    if (stepType === "generate") {
      if (this.state.generateCount >= 1) {
        throw new Error(
          "generate constraint violation: generateCount=1 exceeded (only 1 generate allowed)",
        );
      }
    }
  }

  private incrementCounter(stepType: AgentStepType): void {
    switch (stepType) {
      case "recall":
        this.state.recallCount += 1;
        break;
      case "bridge_probe":
        this.state.bridgeProbeCount += 1;
        break;
      case "evidence_expand":
        this.state.evidenceExpandCount += 1;
        break;
      case "reconcile":
        this.state.reconcileCount += 1;
        break;
      case "generate":
        this.state.generateCount += 1;
        break;
    }
  }
}

// === 工厂函数: 按 category 创建推荐的 state-machine ===

/**
 * 按 category 创建推荐的 state-machine 配置.
 *
 * - multi_hop: 允许 bridge_probe + evidence_expand
 * - 其他: 禁止 bridge_probe / evidence_expand (条件触发不满足)
 */
export function createRecommendedStateMachine(
  category: StateMachineConfig["category"],
): AgentStateMachine {
  return new AgentStateMachine({ category });
}

/**
 * 推荐的步骤序列 (按 category).
 *
 * multi_hop:
 *   recall → bridge_probe → evidence_expand → (reconcile?) → generate → finalize
 *
 * 其他:
 *   recall → (reconcile?) → generate → finalize
 *
 * 注意: 这是推荐序列, 不是硬约束. 调用方可根据 stateDelta.missingInfo 动态调整.
 */
export function getRecommendedSequence(
  category: StateMachineConfig["category"],
): AgentStepType[] {
  if (category === "multi_hop") {
    return [
      "recall",
      "bridge_probe",
      "evidence_expand",
      "generate",
      "finalize",
    ];
  }
  return ["recall", "generate", "finalize"];
}
