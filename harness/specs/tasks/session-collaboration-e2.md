---
lifecycleStatus: active
id: session-collaboration-e2
title: E2 在分支、接力和执行迁移中保留协作材料来源
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: e57aff2ef3cfc6207e182aa7e50369689b28b953
intent: 复用既有的分支、接力和迁移 owner，让后继会话准确回读允许继承的材料及操作状态。
touchedAreas:
  - electron/services/sessions-api.ts
  - electron/services/workspaces-api.ts
  - electron/services/execution-migration.ts
  - openclaw_runtime/src/agents/execution-task-authority.ts
  - openclaw_runtime/src/gateway/server-methods/sessions.lifecycle.ts
  - shared/task-system/runtime.ts
  - shared/task-system/store.ts
  - shared/types/session-handoff.ts
  - shared/types/execution-migration.ts
  - shared/host-api/contract.ts
  - src/lib/host-api.ts
  - src/pages/Chat/session-continuity.ts
  - src/components/agents/SessionCollaborationPanel.tsx
  - shared/i18n/locales/**/agents.json
  - shared/i18n/locales/**/chat.json
  - tests/unit/session-handoff-recovery.test.ts
  - tests/e2e/session-collaboration-continuity.spec.ts
  - harness/specs/tasks/session-collaboration-e2.md
  - harness/specs/scenarios/session-collaboration-center.md
  - harness/specs/fixtures/session-collaboration-center/E2/**
  - docs/modules/sessions.md
  - docs/modules/multi-agent-and-tasks.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - shared/types/session-collaboration-continuity.ts
  - shared/types/session-collaboration-hints.ts
  - openclaw_runtime/src/gateway/server-methods/session-collaboration-hints.ts
  - openclaw_runtime/src/gateway/server-methods/session-collaboration-material.ts
  - src/components/agents/SessionCollaborationContinuity.tsx
  - src/components/agents/SessionCollaborationHints.tsx
  - src/components/agents/SessionCollaborationMaterials.tsx
  - tests/unit/session-collaboration-continuity.test.ts
  - tests/unit/session-collaboration-context-host.test.ts
  - tests/unit/session-collaboration-hints-view.test.tsx
  - tests/unit/session-collaboration-material-view.test.tsx
  - tests/unit/execution-migration.test.ts
  - harness/specs/rules/session-collaboration-center-contract.md
  - harness/specs/fixtures/session-collaboration-center/E2-development-20261128/**
requiredRules:
  - session-collaboration-center-contract
  - identity-scope-boundary
  - durable-task-system-boundary
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - comms-regression
  - disk-temp-policy
  - repository-artifact-retention
  - docs-sync
requiredProfiles:
  - fast
  - comms
expectedUserBehavior:
  - 分支会话可打开来源范围允许的只读材料和任务引用，写入与资源资格由原 owner 授予。
  - 接力草稿、目标创建、首发和执行迁移分别显示原操作、来源和当前阶段。
  - 连接中断或响应丢失后，按原操作 ID 回读同一个目标、草稿与已确认的材料。
requiredTests:
  - node node_modules/vitest/vitest.mjs run tests/unit/session-collaboration-continuity.test.ts tests/unit/session-handoff-recovery.test.ts --maxWorkers=1 --no-file-parallelism
  - node scripts/contract-check.mjs
  - node scripts/i18n-lint.mjs
  - node scripts/comms/replay.mjs
  - node scripts/comms/compare.mjs
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/session-collaboration-e2.md
  - node harness/src/cli.mjs run --spec harness/specs/tasks/session-collaboration-e2.md --dry-run
acceptance:
  - Fork 以确切的来源会话代次和材料版本记录只读引用。回读子会话的 claim、权限及 lease 授予事实。
  - 接力保留草稿、原 operationId、目标代次和首发状态，引用的材料可回到原 TaskSystem 版本和证据。
  - 同逻辑会话迁移按旧、新代次和执行树核对消息及用量。验证旧代请求拒绝及原 run、检出和回执的归属。
  - 在持久化创建或迁移后模拟响应丢失，再沿原 operationId 恢复。目标创建和首发各自可复算，草稿和受保护证据可回读。
  - 保留输入、源码、候选、产物哈希、退出码、运行 actor 和负例。自动证据标记 driven_by 为 agent。
docs:
  required: true
  files:
    - docs/modules/sessions.md
    - docs/modules/multi-agent-and-tasks.md
---

# E2 协作材料连续性

前置为 E1、`TF-0866` 与 `TF-0908`。开工时按 E1 的验收候选和当前主线重新固定差异范围。

- Fork 沿原会话生命周期继承路径记录 TaskSystem 只读引用，访问材料时校验来源代次、版本和敏感性。
- 接力复用 `prepareHandoff`、`createHandoff` 及已有首发追踪。用持久操作 ID 查询创建与首发回执。
- 执行迁移复用 `workspaces.migrateExecution` 及其读取入口，保留源回执和目标发布阶段。将使用归因绑定原 run 和执行树。
- 回退时恢复原入口展示，并按原 owner 回读已有操作状态。

精选证据写入 `harness/specs/fixtures/session-collaboration-center/E2/`，原始跑次存放在 D 盘。

延续开发优先安排：本轮执行定向单测、契约、四语、通信、Harness 和 Electron 用例收集；D5 裁定、完整类型检查、构建、Electron 实跑及 CI 保留后续验收。
