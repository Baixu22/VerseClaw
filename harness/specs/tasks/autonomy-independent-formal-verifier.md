---
id: autonomy-independent-formal-verifier
title: TF-0889 / P7 在既有完成权威内接入非模型自证的确定性形式化核验
lifecycleStatus: active
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: 1b325ded8
intent: 在不新建第二套 verifier 权威或独立 decision store 的前提下，向既有 EvidenceVerifier 与 VerifierCompletionVerdict 接入确定性形式化不变量与反例生成适配层，阻断模型自证放行。
requiredRules:
  - autonomy-task-completion-boundary
  - autonomy-object-owner-boundary
  - identity-scope-boundary
  - durable-task-system-boundary
  - backend-communication-boundary
  - contract-first-boundary
  - comms-regression
  - agent-engineering-acceptance-boundary
  - task-forest-autoclose-and-roles
  - repository-artifact-retention
  - portable-spec-commands
  - disk-temp-policy
  - docs-sync
requiredProfiles:
  - fast
  - comms
expectedUserBehavior:
  - 声明了形式化前后置条件、轨迹约束或结构不变量的任务，必须通过非 LLM 的确定性核验器校验后方可进入自动完成提交。
  - 即使模型或子代理 reviewer 给出通过评语，只要确定性不变量违背即一票否决并输出可重放最小反例供修复循环消费。
touchedAreas:
  - harness/specs/guides/reasoning-planning-convergence-gap-plan.md
  - harness/specs/guides/autonomous-project-system-plan.md
  - harness/specs/tasks/autonomy-independent-formal-verifier.md
  - shared/types/formal-verification.ts
  - openclaw_runtime/src/runtime-core/evidence-verifier.ts
  - openclaw_runtime/src/runtime-core/evidence-verifier-collectors.ts
  - openclaw_runtime/src/runtime-core/verifier-completion-verdict.ts
  - openclaw_runtime/src/runtime-core/task-completion-claim.ts
  - openclaw_runtime/src/runtime-core/formal-invariant-verifier.ts
  - openclaw_runtime/src/agents/task-loop-controller.ts
  - openclaw_runtime/src/agents/persistent-task-acceptance.ts
  - electron/services/task-ledger-service.ts
  - tests/unit/autonomy-independent-formal-verifier.test.ts
  - harness/specs/fixtures/autonomous-project-system/p7/**
  - docs/modules/multi-agent-and-tasks.md
requiredTests:
  - pnpm exec vitest run tests/unit/autonomy-independent-formal-verifier.test.ts tests/unit/runtime-evidence-verifier-contracts.test.ts tests/unit/durable-task-acceptance.test.ts --maxWorkers=1
  - pnpm run typecheck
  - pnpm run contract:check
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm harness validate --spec harness/specs/tasks/autonomy-independent-formal-verifier.md
  - pnpm harness run --spec harness/specs/tasks/autonomy-independent-formal-verifier.md --dry-run
  - git diff --check
acceptance:
  - 严格复用既有 evaluateEvidenceVerifier 与 resolveVerifierCompletionVerdict 单一完成权威，不新增第二个 CompletionDecision 服务或独立存储。
  - 支持计划轨迹前后置状态约束、写集越界形式化断言及结构化后置属性检查，结果绑定同一 taskId、candidateDigest 与 generation。
  - 不变量违背时生成包含失败断言编码与最小反例摘要的确定性 finding，任何 LLM 文本评语或子代理 approved 回执均不能覆盖该拒绝结论。
  - 负例覆盖 implementer 与 reviewer 共谋自证、候选文件变动后复用旧形式化证明、核验器超时或缺失规则时静默放行（必须 fail-closed）。
  - 全部验证产物标 driven_by:agent，支持离线确定性重算，不以真人裁决为前置。
docs:
  required: true
  files:
    - harness/specs/guides/reasoning-planning-convergence-gap-plan.md
    - harness/specs/guides/autonomous-project-system-plan.md
    - docs/modules/multi-agent-and-tasks.md
---

# TF-0889 / P7 独立确定性形式化核验适配层规范

本文件为规划阶段新建的任务规范（对应 `reasoning-planning-convergence-gap-plan.md` 中的 `TF-0889 / P7`），当前尚未执行实现或验收。

## 范围与复用边界

- **直接前置**：`TF-0678`、`TF-0672`。不重开已在分支封存的 `TF-0678`，遵守 `autonomy-task-completion-boundary` 第四条硬约束，仅作为确定性 check provider 注入既有 `EvidenceVerifier`。
- **既有路径复用**：`openclaw_runtime/src/runtime-core/evidence-verifier.ts`、`openclaw_runtime/src/runtime-core/evidence-verifier-collectors.ts`、`openclaw_runtime/src/runtime-core/verifier-completion-verdict.ts`、`openclaw_runtime/src/runtime-core/task-completion-claim.ts`、`openclaw_runtime/src/agents/task-loop-controller.ts`、`openclaw_runtime/src/agents/persistent-task-acceptance.ts`、`electron/services/task-ledger-service.ts`。
- **拟新增路径**：`shared/types/formal-verification.ts`（拟新增）、`openclaw_runtime/src/runtime-core/formal-invariant-verifier.ts`（拟新增）、`tests/unit/autonomy-independent-formal-verifier.test.ts`（拟新增）、`harness/specs/fixtures/autonomous-project-system/p7/**`（拟新增）。
- **回退策略**：移除形式化核验 check provider 注册后，恢复既有 `EvidenceVerifier` 工程测试与哈希校验集合，未决任务保持 `review` 状态不误标 `done`。
