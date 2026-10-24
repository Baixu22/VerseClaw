---
lifecycleStatus: completed
id: long-session-continuity-context
title: 从唯一记忆控制面读取已接受事实与会话交接依据
program: long-session-development-20261022
taskKey: D1
phase: D
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: 让长期入口记住必要约束、决策与未完成依赖，消费既有记忆/知识 owner，不把全部历史再做一份记忆。
contractIndex: harness/specs/tasks/long-session-development-plan.md
diffBase: a2b6c4b39
dependsOnTasks:
  - C4
  - TF-0493
  - TF-0497
  - TF-0498
touchedAreas:
  - harness/specs/tasks/long-session-continuity-context.md
  - harness/specs/tasks/long-session-development-plan.md
  - openclaw_runtime/src/context-engine/context-orchestrator.ts
  - openclaw_runtime/src/context-engine/turn-injection-budget.ts
  - openclaw_runtime/src/context-engine/role-memory-context-provider.ts
  - openclaw_runtime/src/agents/role-spawn.ts
  - electron/services/sessions-api.ts
  - electron/services/knowledge-api.ts
  - shared/types/task-ledger.ts
  - shared/types/memory.ts
  - shared/long-session-continuity.ts
  - shared/host-api/contract.ts
  - src/lib/host-api.ts
  - electron/services/chat-api.ts
  - tests/unit/long-session-continuity-context.test.ts
  - tests/e2e/long-session-continuity-context.spec.ts
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - README.ru-RU.md
  - harness/specs/fixtures/long-session-development/d1/**
requiredRules:
  - runtime-lifecycle-governance-boundary
  - identity-scope-boundary
  - backend-communication-boundary
  - comms-regression
  - docs-sync
  - task-forest-autoclose-and-roles
  - repository-artifact-retention
  - disk-temp-policy
  - context-family-boundary
  - context-runtime-kit-boundary
requiredProfiles:
  - fast
  - comms
expectedUserBehavior:
  - 让长期入口记住必要约束、决策与未完成依赖，消费既有记忆/知识 owner，不把全部历史再做一份记忆。
  - 创建本合同不代表功能已实现；结果、配置、授权和任务完成仍归现有 owner，未知状态如实保留。
requiredTests:
  - pnpm exec vitest run tests/unit/role-memory-context-provider.test.ts tests/unit/tf0018-cross-workspace-session-isolation.test.ts tests/unit/tf0018-correction-propagation.test.ts tests/unit/memory-dual-gate-p3-003.test.ts --maxWorkers=1
  - pnpm exec vitest run tests/unit/long-session-continuity-context.test.ts --maxWorkers=1
  - pnpm run build:vite
  - pnpm run test:e2e:run tests/e2e/long-session-continuity-context.spec.ts
  - pnpm run typecheck
  - pnpm run contract:check
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm harness validate --spec harness/specs/tasks/long-session-continuity-context.md
  - git diff --check
plannedTests:
  - tests/unit/long-session-continuity-context.test.ts
  - tests/e2e/long-session-continuity-context.spec.ts
acceptance:
  - 消费 TF-0493/0497/0498 的唯一装配与 memory UI/owner 输出，复用 Task Ledger、accepted memory/knowledge refs 和 CompressionArtifact，不建新 memory database 或注入链。
  - 关键约束、否定决策、open dependencies、next action 与 evidence refs 有来源、freshness、scope、预算和未知状态；未验证模型叙述不升级为事实。
  - 已删除/过期/撤销/被 supersede 的事实不再注入，跨 Workspace/role/agent 泄漏数为 0；roleMemory master 与 native backend 条件被真实遵守。
  - fork/handoff/compact/restart 后 recovery 能按需回读旧证据，原始历史与本轮有界上下文分别表示；scope 和 kill/rollback 用例实跑。
docs:
  required: true
  files:
    - harness/specs/tasks/long-session-development-plan.md
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
    - README.ru-RU.md
---

**D1 · 从唯一记忆控制面读取已接受事实与会话交接依据**

让长期入口记住必要约束、决策与未完成依赖，消费既有记忆/知识 owner，不把全部历史再做一份记忆。

本规格为待执行合同。任务状态、前置与下一 ready 由 repo-local Task Forest 管理。节点创建、文件存在、静态 validate 或 dry-run 不是功能证据。只有前置任务/阶段的盘上验收完整后才开始。

所属阶段四：保持上下文连续性并评测策略。统一边界见[规划合同索引](./long-session-development-plan.md)。

**前置与读入**

- C4：回读其当前合同与输出，不根据旧 summary 推断通过。
- TF-0493：回读其当前合同与输出，不根据旧 summary 推断通过。
- TF-0497：回读其当前合同与输出，不根据旧 summary 推断通过。
- TF-0498：回读其当前合同与输出，不根据旧 summary 推断通过。

实现前运行：`pnpm harness context --spec harness/specs/tasks/long-session-continuity-context.md`。

**实现和核验入口**

- openclaw_runtime/src/context-engine/context-orchestrator.ts
- openclaw_runtime/src/context-engine/turn-injection-budget.ts
- openclaw_runtime/src/context-engine/role-memory-context-provider.ts
- openclaw_runtime/src/agents/role-spawn.ts
- electron/services/sessions-api.ts
- electron/services/knowledge-api.ts
- shared/types/task-ledger.ts
- shared/types/memory.ts

这些是当前 source/owner 定位。新产物与测试在本节点实现时交付；开始前按真实 seam 缩小 touchedAreas，不添加第二 writer/executor/context/memory/scheduler。已完成或已退休依赖以其真实输出为准，不擅自改既有状态。

**必须满足的负向与正向验收**

1. 消费 TF-0493/0497/0498 的唯一装配与 memory UI/owner 输出，复用 Task Ledger、accepted memory/knowledge refs 和 CompressionArtifact，不建新 memory database 或注入链。
2. 关键约束、否定决策、open dependencies、next action 与 evidence refs 有来源、freshness、scope、预算和未知状态；未验证模型叙述不升级为事实。
3. 已删除/过期/撤销/被 supersede 的事实不再注入，跨 Workspace/role/agent 泄漏数为 0；roleMemory master 与 native backend 条件被真实遵守。
4. fork/handoff/compact/restart 后 recovery 能按需回读旧证据，原始历史与本轮有界上下文分别表示；scope 和 kill/rollback 用例实跑。

**门禁与待交付检查**

- `pnpm exec vitest run tests/unit/role-memory-context-provider.test.ts tests/unit/tf0018-cross-workspace-session-isolation.test.ts tests/unit/tf0018-correction-propagation.test.ts tests/unit/memory-dual-gate-p3-003.test.ts --maxWorkers=1`
- `pnpm exec vitest run tests/unit/long-session-continuity-context.test.ts --maxWorkers=1`
- `pnpm run typecheck`
- `pnpm run contract:check`
- `pnpm run comms:replay`
- `pnpm run comms:compare`
- `pnpm harness validate --spec harness/specs/tasks/long-session-continuity-context.md`
- `git diff --check`

plannedTests 尚未实现；上述命令只有在交付对应测试后才构成验收，测试选择未命中必须失败。

E2E 要求真实 built Electron 与隔离 userData/run root。界面 host mocks 仅证明交互，功能接线必须回读 actual Host/Gateway/owner receipts。所有通信改动运行 comms replay/compare，cached typecheck 不替代 uncached 全门。

**可回读产物**

- harness/specs/fixtures/long-session-development/d1/continuity-context-pack.json
- harness/specs/fixtures/long-session-development/d1/fact-provenance-and-revocation.json
- harness/specs/fixtures/long-session-development/d1/cross-scope-negative.json

另生成同目录 SHA256SUMS。报告含 schema、driven_by: agent、actor、candidate/source/input identity、commands/exit/counts、原始结果引用、negative cases、cleanup/remaining/recovery_required 和未测范围。原始临时文件写 D 盘或已忽略目录；精选证据逐文件登记保留清单，不重签历史 artifacts。reviewer/agent 独立核验必须读原件，不能只读 stdout 或最终回答。

**执行提示与退出**

- 既有毕业节点若输出 internal/retired 结论，使用明确不可用与 transcript/ledger fallback，不复制其旧实现或扩张写入权限。
- 记忆可被 agent 自动评审验收，但自动验收不等于修改被冻结的写回/注入默认值。
- 一次一个 ready leaf；发生 scope/source/dependency 漂移时重读图与合同，不默认 --allow-stale 或修改别人的 dirty 内容。
- 验收条目全满足且证据一致后保存 proposal，base_graph_hash 匹配再 apply/validate/export；缺技术证据保持未完成并记录具体 gap。
- 不要求所有者真人操作、真人数据或 verdict；自动模拟/独立 agent 审查如实标记。没有 live-provider 数据不能包装为质量推广证据。
- 产品锁、冻结默认值、公开发布、重大独立 Project/执行环境范围决定不由本节点自动生效。

