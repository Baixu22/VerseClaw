---
lifecycleStatus: active
id: long-session-coordinator-binding
title: 绑定稳定主会话、任务引用与长期工作范围
program: long-session-development-20261022
taskKey: C1
phase: C
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: 让一个明确 Workspace/Assistant 的长期对话承接后续工作，同时保留 Task Ledger 对任务事实的唯一权威。
contractIndex: harness/specs/tasks/long-session-development-plan.md
dependsOnTasks:
  - B2
touchedAreas:
  - harness/specs/tasks/long-session-coordinator-binding.md
  - harness/specs/tasks/long-session-development-plan.md
  - shared/types/workspace.ts
  - shared/types/project.ts
  - shared/types/task-ledger.ts
  - electron/services/workspaces-api.ts
  - electron/services/task-ledger-api.ts
  - electron/services/sessions-api.ts
  - electron/services/chat-api.ts
  - electron/main/ipc-handlers.ts
  - electron/services/terminal-session-manager.ts
  - openclaw_runtime/src/agents/worktree-service.ts
  - src/lib/workspace-session.ts
  - src/stores/chat.ts
  - shared/host-api/contract.ts
  - src/lib/host-api.ts
  - tests/unit/long-session-coordinator-binding.test.ts
  - tests/unit/workspace-session.test.ts
  - tests/unit/chat-api-workspace-fingerprint.test.ts
  - tests/unit/long-session-lifecycle-barrier.test.ts
  - tests/e2e/long-session-coordinator-binding.spec.ts
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - docs/clawx-product-semantics.md
  - harness/specs/fixtures/long-session-development/c1/**
requiredRules:
  - runtime-lifecycle-governance-boundary
  - identity-scope-boundary
  - backend-communication-boundary
  - comms-regression
  - docs-sync
  - task-forest-autoclose-and-roles
  - repository-artifact-retention
  - disk-temp-policy
requiredProfiles:
  - fast
  - comms
expectedUserBehavior:
  - 让一个明确 Workspace/Assistant 的长期对话承接后续工作，同时保留 Task Ledger 对任务事实的唯一权威。
  - 创建本合同不代表功能已实现；结果、配置、授权和任务完成仍归现有 owner，未知状态如实保留。
requiredTests:
  - pnpm exec vitest run tests/unit/workspace-session.test.ts tests/unit/project-projection.test.ts tests/unit/identity-scope.test.ts --maxWorkers=1
  - pnpm exec vitest run tests/unit/long-session-coordinator-binding.test.ts --maxWorkers=1
  - pnpm run typecheck
  - pnpm run contract:check
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm run build:vite
  - pnpm run test:e2e:run tests/e2e/long-session-coordinator-binding.spec.ts
  - pnpm harness validate --spec harness/specs/tasks/long-session-coordinator-binding.md
  - git diff --check
plannedTests:
  - tests/unit/long-session-coordinator-binding.test.ts
acceptance:
  - 稳定协调入口绑定一个真实 Workspace、Assistant 与 SessionKey，关联 existing Task Ledger refs；最小 binding metadata 由现有 owner 持久化，不建立新 Project/task/goal store。
  - 新增会话级环境绑定：sessionKey/generation 指向 local checkout 或 managed worktree，记录 canonical root、backend、branch/detached HEAD、setup profile、binding revision 和 archive 后的 restore policy；模型不可凭 cwd 文本自行切换环境。
  - UI 关闭、应用重启、会话重命名/交接后绑定可从盘上恢复；删除/reset/归档使旧 generation 的协调绑定明确失效或暂停。
  - 普通 Chat 不自动承担长期调度，显式进入长期协作才建立该范围；独立多仓 Project 生命周期仍在本 lane 之外。
  - 跨 Workspace、缺 owner、binding revision 冲突、绑定已删会话一律拒绝，任务完成状态只通过 Task Ledger 的正式接口更新。
docs:
  required: true
  files:
    - harness/specs/tasks/long-session-development-plan.md
---

**C1 · 绑定稳定主会话、任务引用与长期工作范围**

让一个明确 Workspace/Assistant 的长期对话承接后续工作，同时保留 Task Ledger 对任务事实的唯一权威。

本规格为待执行合同。任务状态、前置与下一 ready 由 repo-local Task Forest 管理。节点创建、文件存在、静态 validate 或 dry-run 不是功能证据。只有前置任务/阶段的盘上验收完整后才开始。

所属阶段三：交付单工作区长期协调入口。统一边界见[规划合同索引](./long-session-development-plan.md)。

**前置与读入**

- B2：回读其当前合同与输出，不根据旧 summary 推断通过。

实现前运行：`pnpm harness context --spec harness/specs/tasks/long-session-coordinator-binding.md`。

**实现和核验入口**

- shared/types/workspace.ts
- shared/types/project.ts
- shared/types/task-ledger.ts
- electron/services/workspaces-api.ts
- electron/services/task-ledger-api.ts
- electron/services/sessions-api.ts
- electron/services/terminal-session-manager.ts
- openclaw_runtime/src/agents/worktree-service.ts
- src/lib/workspace-session.ts
- src/stores/chat.ts
- shared/host-api/contract.ts
- src/lib/host-api.ts

这些是当前 source/owner 定位。新产物与测试在本节点实现时交付；开始前按真实 seam 缩小 touchedAreas，不添加第二 writer/executor/context/memory/scheduler。已完成或已退休依赖以其真实输出为准，不擅自改既有状态。

**必须满足的负向与正向验收**

1. 稳定协调入口绑定一个真实 Workspace、Assistant 与 SessionKey，关联 existing Task Ledger refs；最小 binding metadata 由现有 owner 持久化，不建立新 Project/task/goal store。
2. UI 关闭、应用重启、会话重命名/交接后绑定可从盘上恢复；删除/reset/归档使旧 generation 的协调绑定明确失效或暂停。
3. 普通 Chat 不自动承担长期调度，显式进入长期协作才建立该范围；独立多仓 Project 生命周期仍在本 lane 之外。
4. 跨 Workspace、缺 owner、binding revision 冲突、绑定已删会话一律拒绝，任务完成状态只通过 Task Ledger 的正式接口更新。

5. 环境绑定的创建/切换/handoff 只走 typed host-api 与既有 worktree owner；同一 branch 不能被两个 checkout 同时检出，绑定已失效或环境已删除时 recovery 状态可解释。archive/delete 与环境清理分离，清理前保存可恢复快照或明确 retention=none；reset 只重绑 generation，不能留下旧 generation 的迟到 run 写入新环境。

**门禁与待交付检查**

- `pnpm exec vitest run tests/unit/workspace-session.test.ts tests/unit/project-projection.test.ts tests/unit/identity-scope.test.ts --maxWorkers=1`
- `pnpm exec vitest run tests/unit/long-session-coordinator-binding.test.ts --maxWorkers=1`
- `pnpm run typecheck`
- `pnpm run contract:check`
- `pnpm run comms:replay`
- `pnpm run comms:compare`
- `pnpm harness validate --spec harness/specs/tasks/long-session-coordinator-binding.md`
- `git diff --check`

`tests/unit/long-session-coordinator-binding.test.ts` 与 `tests/e2e/long-session-coordinator-binding.spec.ts` 已由本节点交付；测试选择未命中必须失败。

E2E 要求真实 built Electron 与隔离 userData/run root。界面 host mocks 仅证明交互，功能接线必须回读 actual Host/Gateway/owner receipts。所有通信改动运行 comms replay/compare，cached typecheck 不替代 uncached 全门。

**可回读产物**

- harness/specs/fixtures/long-session-development/c1/coordinator-binding.json
- harness/specs/fixtures/long-session-development/c1/scope-and-recovery-matrix.json

另生成同目录 SHA256SUMS。报告含 schema、driven_by: agent、actor、candidate/source/input identity、commands/exit/counts、原始结果引用、negative cases、cleanup/remaining/recovery_required 和未测范围。原始临时文件写 D 盘或已忽略目录；精选证据逐文件登记保留清单，不重签历史 artifacts。reviewer/agent 独立核验必须读原件，不能只读 stdout 或最终回答。

**执行提示与退出**

- ProjectView 目前仅类型/投影；不把它当已挂载执行 owner。
- 依 A1 选择现有 metadata 存储 seam，新增字段不代表创建新的数据权威。
- 一次一个 ready leaf；发生 scope/source/dependency 漂移时重读图与合同，不默认 --allow-stale 或修改别人的 dirty 内容。
- 验收条目全满足且证据一致后保存 proposal，base_graph_hash 匹配再 apply/validate/export；缺技术证据保持未完成并记录具体 gap。
- 不要求所有者真人操作、真人数据或 verdict；自动模拟/独立 agent 审查如实标记。没有 live-provider 数据不能包装为质量推广证据。
- 产品锁、冻结默认值、公开发布、重大独立 Project/执行环境范围决定不由本节点自动生效。
