// 会话运行时干预策略（runtime 侧实现）。
//
// 与 shared/types/long-task-control.ts 的 interventionPolicyForInputMode
// 保持同构（openclaw_runtime 源码不跨 shared 包边界，见 AGENTS.md 的
// runtime-local-ecosystem-boundary 约定）；两侧一致性由 tests/unit 的
// long-task-control 测试锁定（shared 侧）与 chat-send-input-mode 测试
// （runtime 侧）共同保证。
//
// 使用方：gateway/server-methods/chat.ts 的 inputMode 分支——策略字段驱动
// checkpoint 写入内容（resumeTrigger / recordsDeviation / reviewRequired）
// 与干预事件审计标注（confirmationRequired / reviewRequired）。
// 注意：checkpointRequired 当前对全部四种模式均为 true，chat.ts 因而
// 无条件写 checkpoint；若未来某模式改为不要求检查点，消费方需按此字段门控。

import type { LongTaskInputMode, ResumeCheckpointTrigger } from "./store.js";

export type LongTaskInterventionDelivery =
  | "restart_now"
  | "steer_active_run"
  | "follow_up_after_run";

export type LongTaskTaskLedgerEffect = "none" | "evidence" | "deviation" | "followup";

export type LongTaskInterventionPolicy = {
  mode: LongTaskInputMode;
  delivery: LongTaskInterventionDelivery;
  mutatesCompletionState: boolean;
  shouldAbortActiveRun: boolean;
  checkpointRequired: boolean;
  recordsSteeringEvidence: boolean;
  recordsDeviation: boolean;
  reviewRequired: boolean;
  confirmationRequired: boolean;
  resumeTrigger?: ResumeCheckpointTrigger;
  taskLedgerEffect: LongTaskTaskLedgerEffect;
  description: string;
};

export type LongTaskInterventionOptions = {
  highRisk?: boolean;
  clawGraphNodeActive?: boolean;
};

export function interventionPolicyForInputMode(
  mode: LongTaskInputMode,
  options: LongTaskInterventionOptions = {},
): LongTaskInterventionPolicy {
  if (mode === "revise-goal") {
    return {
      mode,
      delivery: "restart_now",
      mutatesCompletionState: false,
      shouldAbortActiveRun: true,
      checkpointRequired: true,
      recordsSteeringEvidence: false,
      recordsDeviation: true,
      reviewRequired: true,
      confirmationRequired: Boolean(options.clawGraphNodeActive),
      resumeTrigger: "revise_goal",
      taskLedgerEffect: "deviation",
      description:
        "Checkpoint the active run, record a goal-revision deviation, and restart from the revised user goal.",
    };
  }

  if (mode === "interrupt") {
    return {
      mode,
      delivery: "restart_now",
      mutatesCompletionState: false,
      shouldAbortActiveRun: true,
      checkpointRequired: true,
      recordsSteeringEvidence: false,
      recordsDeviation: true,
      reviewRequired: Boolean(options.highRisk),
      confirmationRequired: Boolean(options.clawGraphNodeActive),
      resumeTrigger: "interrupt",
      taskLedgerEffect: "deviation",
      description:
        "Abort the active run, retain partial evidence, and restart from a resume checkpoint.",
    };
  }

  if (mode === "queue") {
    return {
      mode,
      delivery: "follow_up_after_run",
      mutatesCompletionState: false,
      shouldAbortActiveRun: false,
      checkpointRequired: true,
      recordsSteeringEvidence: false,
      recordsDeviation: false,
      reviewRequired: false,
      confirmationRequired: false,
      resumeTrigger: "queue_drain",
      taskLedgerEffect: "followup",
      description:
        "Keep the active run intact and deliver the user message as an associated follow-up turn.",
    };
  }

  return {
    mode,
    delivery: "steer_active_run",
    mutatesCompletionState: false,
    shouldAbortActiveRun: false,
    checkpointRequired: true,
    recordsSteeringEvidence: true,
    recordsDeviation: false,
    reviewRequired: Boolean(options.highRisk),
    confirmationRequired: false,
    resumeTrigger: "guide",
    taskLedgerEffect: "evidence",
    description:
      "Inject non-disruptive guidance into the active run and record it as steering evidence.",
  };
}
