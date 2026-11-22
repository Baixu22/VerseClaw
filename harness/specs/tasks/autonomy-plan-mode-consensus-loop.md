---
id: autonomy-plan-mode-consensus-loop
title: TF-0887 / P5 交付 Ask/Plan/Autopilot 会话收敛协议与写前确认闭环
lifecycleStatus: active
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: 1b325ded8
intent: 在现有会话任务范围与协调器持久计划之上补齐 Ask、Plan、Autopilot 三态会话收敛协议与写前结构化计划确认闭环，不复活已废弃的 WorkModeId 权限耦合，不重开 TF-0675。
requiredRules:
  - autonomy-object-owner-boundary
  - autonomy-session-task-scope-boundary
  - identity-scope-boundary
  - durable-task-system-boundary
  - renderer-main-boundary
  - backend-communication-boundary
  - contract-first-boundary
  - api-client-transport-policy
  - comms-regression
  - i18n-locale-coverage
  - task-forest-autoclose-and-roles
  - repository-artifact-retention
  - portable-spec-commands
  - disk-temp-policy
  - docs-sync
requiredProfiles:
  - fast
  - comms
  - e2e
expectedUserBehavior:
  - 会话显式区分 Ask（只读问答，不建写任务）、Plan（先落盘结构化计划草案并挂起写副作用，确认或修订后再执行）与 Autopilot（授权范围内自动推进，仅重大决策升级）。
  - Plan 卡片展示目标拆解、Research 依据引用、预计写集、预算上限与回退方案，修订后旧版确认自动失效。
  - 四语（en/zh/ja/ru）文案与设计令牌一致，所有后端交互仅走 host-api 单一通道。
touchedAreas:
  - harness/specs/guides/reasoning-planning-convergence-gap-plan.md
  - harness/specs/guides/autonomous-project-system-plan.md
  - harness/specs/tasks/autonomy-plan-mode-consensus-loop.md
  - shared/task-system/types.ts
  - shared/task-system/store.ts
  - shared/task-system/session-convergence-mode.ts
  - shared/host-api/contract.ts
  - src/lib/host-api.ts
  - electron/services/task-system-service.ts
  - electron/services/sessions-api.ts
  - openclaw_runtime/src/agents/tools/persistent-task-tool.ts
  - openclaw_runtime/src/agents/tools/update-plan-tool.ts
  - src/pages/Chat/index.tsx
  - src/pages/Chat/ChatInput.tsx
  - src/pages/Chat/SessionTaskDock.tsx
  - src/pages/Chat/PlanConsensusCard.tsx
  - shared/i18n/locales/en/taskLedger.json
  - shared/i18n/locales/zh/taskLedger.json
  - shared/i18n/locales/ja/taskLedger.json
  - shared/i18n/locales/ru/taskLedger.json
  - tests/unit/autonomy-plan-mode-consensus.test.ts
  - tests/e2e/autonomy-plan-mode-consensus.spec.ts
  - harness/specs/fixtures/autonomous-project-system/p5/**
  - docs/modules/multi-agent-and-tasks.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - README.ru-RU.md
requiredTests:
  - pnpm exec vitest run tests/unit/autonomy-plan-mode-consensus.test.ts tests/unit/durable-task-session-scope.test.ts tests/unit/host-api-facade.test.ts --maxWorkers=1
  - pnpm run typecheck
  - pnpm run contract:check
  - pnpm run i18n:lint
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm run build:vite
  - pnpm exec playwright test tests/e2e/autonomy-plan-mode-consensus.spec.ts --workers=1
  - pnpm harness validate --spec harness/specs/tasks/autonomy-plan-mode-consensus-loop.md
  - pnpm harness run --spec harness/specs/tasks/autonomy-plan-mode-consensus-loop.md --dry-run
  - git diff --check
acceptance:
  - Ask 模式下连续对话与工具探测保持零业务写副作用；Plan 模式下未获绑定当前 planRevisionDigest 的确认回执前，任何写文件、终端写命令或派发请求均被准入层拦截。
  - 计划修订产生新 revision 与新 digest，旧确认回执无法放行新修订计划；Autopilot 仅在既有授权包络内自动签发 agent 确认，重大决策仍显式升级。
  - Renderer 仅经 host-api 读取与提交计划审阅动作，不重新启用已废弃的 WorkModeId 权限推导，en/zh/ja/ru 四语与明暗窄窗 E2E 验证齐备。
  - 全部交互审阅、驳回修订与确认推进在测试与验收中由脚本/agent 自动模拟执行，产物如实标注 driven_by:agent，不以真人点击为验收前置。
docs:
  required: true
  files:
    - harness/specs/guides/reasoning-planning-convergence-gap-plan.md
    - harness/specs/guides/autonomous-project-system-plan.md
    - docs/modules/multi-agent-and-tasks.md
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
    - README.ru-RU.md
---

# TF-0887 / P5 Ask/Plan/Autopilot 会话收敛协议与写前确认闭环规范

本文件为规划阶段新建的任务规范（对应 `reasoning-planning-convergence-gap-plan.md` 中的 `TF-0887 / P5`），当前尚未执行实现或验收。

## 范围与复用边界

- **直接前置**：`TF-0675`、`TF-0886`、`TF-0662`。复用 `TF-0675` 已落地的协调器持久计划与修订模型，补齐面向会话的用户可见“规划—确认/修订—执行”受控闸口。
- **既有路径复用**：`shared/task-system/types.ts`、`shared/task-system/store.ts`、`shared/host-api/contract.ts`、`src/lib/host-api.ts`、`electron/services/task-system-service.ts`、`electron/services/sessions-api.ts`、`openclaw_runtime/src/agents/tools/persistent-task-tool.ts`、`openclaw_runtime/src/agents/tools/update-plan-tool.ts`、`src/pages/Chat/index.tsx`、`src/pages/Chat/ChatInput.tsx`、`src/pages/Chat/SessionTaskDock.tsx`、`shared/i18n/locales/{en,zh,ja,ru}/taskLedger.json`。明确不复用已标 `@deprecated` 的 `shared/types/work-mode.ts` 作为权限或任务状态源。
- **拟新增路径**：`shared/task-system/session-convergence-mode.ts`（拟新增）、`src/pages/Chat/PlanConsensusCard.tsx`（拟新增）、`tests/unit/autonomy-plan-mode-consensus.test.ts`（拟新增）、`tests/e2e/autonomy-plan-mode-consensus.spec.ts`（拟新增）、`harness/specs/fixtures/autonomous-project-system/p5/**`（拟新增）。
- **回退策略**：关闭会话写前挂起模式开关，恢复既有默认讨论/自动任务准入流，保留已落盘计划草案与审阅事件只读可查。
