---
id: autonomy-cloud-async-delegation
title: TF-0890 / R5 交付远端分支与 Draft PR 异步受控委托及脱机重连对账
lifecycleStatus: active
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: 1b325ded8
intent: 在保持产品锁（liveReady=false、defaultOn=false、Agent merge OFF）不变的前提下，建立跨本机生命周期的受控远端分支/Draft PR 异步委托与重连回执对账协议，解除本机休眠或关机即停限制。
requiredRules:
  - remote-forge-expansion-boundary
  - autonomy-worktree-integration
  - autonomy-host-readiness-boundary
  - autonomy-object-owner-boundary
  - identity-scope-boundary
  - renderer-main-boundary
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
  - 已确认范围与预算的任务可委托至显式配置的远端受管执行器，在隔离分支后台运行并维护 Draft PR，本机 UI 关闭或离线期间推进不中断。
  - 本机恢复连接后自动对账拉取远端候选摘要、日志、费用与检查状态，经本地既有核验门禁复验前绝不标记业务任务完成，且远端执行器无权自动合入目标分支。
touchedAreas:
  - harness/specs/guides/reasoning-planning-convergence-gap-plan.md
  - harness/specs/guides/autonomous-project-system-plan.md
  - harness/specs/tasks/autonomy-cloud-async-delegation.md
  - shared/types/async-cloud-delegation.ts
  - shared/types/remote-tasks.ts
  - shared/types/remote-forge.ts
  - shared/types/session-delegation.ts
  - shared/host-api/contract.ts
  - src/lib/host-api.ts
  - electron/services/async-cloud-delegation-api.ts
  - electron/services/remote-tasks-api.ts
  - electron/services/remote-forge-api.ts
  - electron/services/git-api.ts
  - electron/services/session-delegation-admission.ts
  - electron/services/workspace-preflight.ts
  - openclaw_runtime/src/agents/goal-wake-recovery.ts
  - openclaw_runtime/src/agents/worktree-service.ts
  - tests/unit/autonomy-cloud-async-delegation.test.ts
  - harness/specs/fixtures/autonomous-project-system/r5/**
  - docs/modules/workspace-and-coding.md
requiredTests:
  - pnpm exec vitest run tests/unit/autonomy-cloud-async-delegation.test.ts tests/unit/remote-tasks-api.test.ts tests/unit/remote-forge-expansion-decision.test.ts --maxWorkers=1
  - pnpm run typecheck
  - pnpm run contract:check
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm harness validate --spec harness/specs/tasks/autonomy-cloud-async-delegation.md
  - pnpm harness run --spec harness/specs/tasks/autonomy-cloud-async-delegation.md --dry-run
  - git diff --check
acceptance:
  - 委托请求必须绑定显式 TaskRef、session generation、固定基线提交、隔离远端分支名、幂等 operationKey 与预算上限；凭据仅驻留 Main 安全边界且日志全程脱敏。
  - 离线模拟验证中，本机宿主退出期间独立远端 runner 持续推进受控 bare Git/Forge fixture 分支并更新 Draft PR，重连后经 TF-0677 generation fence 与 TF-0682 整合规则完成幂等对账。
  - 严守 remote-forge-expansion-boundary：保持 liveReady=false、productApproved=false、defaultOn=false 与 Agent merge OFF，任何远端直接 merge、改写保护分支或跨 generation 僵尸写入均被 fail-closed 拒绝。
  - 远端返回的 exit 0 或 PR 创建回执仅作进度事件，必须经本地固定新 candidate 并通过既有 EvidenceVerifier 复验后才允许提交任务收口。
  - 全部测试与模拟产物标 driven_by:agent，不要求真人手工值守云端流水线。
docs:
  required: true
  files:
    - harness/specs/guides/reasoning-planning-convergence-gap-plan.md
    - harness/specs/guides/autonomous-project-system-plan.md
    - docs/modules/workspace-and-coding.md
---

# TF-0890 / R5 远端分支与 Draft PR 异步受控委托规范

本文件为规划阶段新建的任务规范（对应 `reasoning-planning-convergence-gap-plan.md` 中的 `TF-0890 / R5`），当前尚未执行实现或验收。

## 范围与复用边界

- **直接前置**：`TF-0677`、`TF-0682`、`TF-0674`。针对现有 `remote-tasks-api.ts` 仅支持 `message | doctor | settingsPatch` 且执行强绑定本机的缺口，在受控开关下扩展异步编码任务委托协议。
- **既有路径复用**：`shared/types/remote-tasks.ts`、`shared/types/remote-forge.ts`、`shared/types/session-delegation.ts`、`shared/host-api/contract.ts`、`src/lib/host-api.ts`、`electron/services/remote-tasks-api.ts`、`electron/services/remote-forge-api.ts`、`electron/services/git-api.ts`、`electron/services/session-delegation-admission.ts`、`electron/services/workspace-preflight.ts`、`openclaw_runtime/src/agents/goal-wake-recovery.ts`、`openclaw_runtime/src/agents/worktree-service.ts`。
- **拟新增路径**：`shared/types/async-cloud-delegation.ts`（拟新增）、`electron/services/async-cloud-delegation-api.ts`（拟新增）、`tests/unit/autonomy-cloud-async-delegation.test.ts`（拟新增）、`harness/specs/fixtures/autonomous-project-system/r5/**`（拟新增）。
- **回退策略**：保持 `defaultOn=false`；关闭开关时停止一切新远端委托派发，保留远端隔离分支与本地任务对账快照只读可查，执行退回本机受控工作树路径。
