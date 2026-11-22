---
id: autonomy-reverse-attribution-spine
title: TF-0891 / V1a 建立结果到目标的六级逆向归因追溯底座
lifecycleStatus: active
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: 1b325ded8
intent: 作为 TF-0688 的最高优前置子叶，在不等待跨项目 S2/S3 完成的前提下先行打通结果、验收、候选、执行回执、计划修订与原始目标的磁盘可重建逆向归因索引，支撑规划质量因果归因。
requiredRules:
  - autonomy-object-owner-boundary
  - autonomy-task-completion-boundary
  - identity-scope-boundary
  - durable-task-system-boundary
  - trace-cost-sampling-boundary
  - backend-communication-boundary
  - contract-first-boundary
  - api-client-transport-policy
  - comms-regression
  - task-forest-autoclose-and-roles
  - repository-artifact-retention
  - portable-spec-commands
  - disk-temp-policy
  - docs-sync
requiredProfiles:
  - fast
  - comms
expectedUserBehavior:
  - 给定任意交付产物或任务完成记录，可通过单一只读查询一键反查对应的验收裁决、固定候选摘要、运行与工具回执、计划修订/Research/Solver 决策及原始目标。
  - 证据断链、候选篡改过期、重复计费或未知单价均以明确状态码暴露，绝不静默丢弃或用 0 掩盖未知成本。
touchedAreas:
  - harness/specs/guides/reasoning-planning-convergence-gap-plan.md
  - harness/specs/guides/autonomous-project-system-plan.md
  - harness/specs/tasks/autonomy-reverse-attribution-spine.md
  - shared/task-system/reverse-attribution-index.ts
  - shared/task-system/event-store.ts
  - shared/task-system/artifact-retention.ts
  - shared/task-system/types.ts
  - shared/types/observability.ts
  - shared/types/evidence.ts
  - shared/types/session-activity.ts
  - shared/host-api/contract.ts
  - src/lib/host-api.ts
  - electron/services/task-attribution-query.ts
  - electron/services/task-system-service.ts
  - electron/services/observability-graph.ts
  - electron/services/observability-trajectory.ts
  - electron/services/host-trace-diagnostics.ts
  - openclaw_runtime/src/runtime-core/event-log.ts
  - openclaw_runtime/src/observability/correlation-ids.ts
  - tests/unit/autonomy-reverse-attribution-spine.test.ts
  - harness/specs/fixtures/autonomous-project-system/v1a/**
  - docs/modules/resources-and-observability.md
requiredTests:
  - pnpm exec vitest run tests/unit/autonomy-reverse-attribution-spine.test.ts tests/unit/durable-task-event-store.test.ts tests/unit/observability-graph.test.ts tests/unit/harness-gap-trace-cost-sampling.test.ts --maxWorkers=1
  - pnpm run typecheck
  - pnpm run contract:check
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm harness validate --spec harness/specs/tasks/autonomy-reverse-attribution-spine.md
  - pnpm harness run --spec harness/specs/tasks/autonomy-reverse-attribution-spine.md --dry-run
  - git diff --check
acceptance:
  - 单次逆向查询确定性串联 Result/Artifact -> VerifierVerdict -> CandidateDigest -> ScopedRun/EffectReceipt -> PlanRevision/PrePlanInput -> Goal，且预留 Research、Solver 与 FormalVerdict 引用槽位。
  - 索引层不持有独立事实权威，删除缓存索引文件后可 100% 从既有 TaskSystem 事件、运行轨迹与验收回执在磁盘上无损重建。
  - 父子会话与同操作重试的 token/金额按唯一请求与 attempt 身份去重；未知单价或缺失 usage 严格标 unknown。
  - 负例覆盖伪造无源回执、候选字节变更使旧验收链路标 stale、删除普通聊天会话后受保护任务产物的反查完好性。
  - 全部归因快照脱敏且标 driven_by:agent，原始跑次写 D:/tmp。
docs:
  required: true
  files:
    - harness/specs/guides/reasoning-planning-convergence-gap-plan.md
    - harness/specs/guides/autonomous-project-system-plan.md
    - docs/modules/resources-and-observability.md
---

# TF-0891 / V1a 六级逆向归因追溯底座规范

本文件为规划阶段新建的任务规范（对应 `reasoning-planning-convergence-gap-plan.md` 中的 `TF-0891 / V1a`），当前尚未执行实现或验收。

## 范围与复用边界

- **直接前置**：`TF-0678`、`TF-0673`，并作为既有 `TF-0688`（`V1`）与新增 `TF-0892`（`V2a`）的直接前置。按“统一追溯 > 预算化 Research > 长程验证”最高优先级先行实施。
- **既有路径复用**：`shared/task-system/event-store.ts`、`shared/task-system/artifact-retention.ts`、`shared/task-system/types.ts`、`shared/types/observability.ts`、`shared/types/evidence.ts`、`shared/types/session-activity.ts`、`shared/host-api/contract.ts`、`src/lib/host-api.ts`、`electron/services/task-system-service.ts`、`electron/services/observability-graph.ts`、`electron/services/observability-trajectory.ts`、`electron/services/host-trace-diagnostics.ts`、`openclaw_runtime/src/runtime-core/event-log.ts`、`openclaw_runtime/src/observability/correlation-ids.ts`。
- **拟新增路径**：`shared/task-system/reverse-attribution-index.ts`（拟新增）、`electron/services/task-attribution-query.ts`（拟新增）、`tests/unit/autonomy-reverse-attribution-spine.test.ts`（拟新增）、`harness/specs/fixtures/autonomous-project-system/v1a/**`（拟新增）。
- **回退策略**：关闭逆向聚合查询接口后，各既有 owner 的事件、轨迹与保留产物原样保留，不丢失任何原始记录。
