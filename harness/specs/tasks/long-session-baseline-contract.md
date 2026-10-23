---
lifecycleStatus: active
id: long-session-baseline-contract
title: 固定长期会话身份、动作合同与故障基线
program: long-session-development-20261022
taskKey: A1
phase: A
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: 重新核读当前实现，固定长期工作范围和动作语义，避免把旧调研、历史 PASS 或文件夹存在当作新能力。
contractIndex: harness/specs/tasks/long-session-development-plan.md
dependsOnTasks:

touchedAreas:
  - .gitignore
  - harness/specs/tasks/long-session-baseline-contract.md
  - harness/specs/tasks/long-session-development-plan.md
  - docs/clawx-product-semantics.md
  - shared/types/identity-scope.ts
  - shared/types/workspace.ts
  - shared/types/project.ts
  - electron/services/sessions-api.ts
  - openclaw_runtime/src/gateway/session-reset-service.ts
  - openclaw_runtime/extensions/codex/src/app-server/thread-lifecycle.ts
  - openclaw_runtime/extensions/anthropic/cli-backend.ts
  - tests/unit/workspace-session.test.ts
  - tests/unit/chat-session-continuity.test.ts
  - electron/services/resource-tracker.ts
  - openclaw_runtime/src/sessions/session-admission-registry.ts
  - openclaw_runtime/src/gateway/session-drain-service.ts
  - openclaw_runtime/src/agents/tools/sessions-spawn-tool.ts
  - tests/unit/long-session-action-contract.test.ts
  - harness/specs/fixtures/long-session-development/a1/**
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
  - 重新核读当前实现，固定长期工作范围和动作语义，避免把旧调研、历史 PASS 或文件夹存在当作新能力。
  - 创建本合同不代表功能已实现；结果、配置、授权和任务完成仍归现有 owner，未知状态如实保留。
requiredTests:
  - pnpm exec vitest run tests/unit/workspace-session.test.ts tests/unit/chat-session-continuity.test.ts tests/unit/handoff-depth.test.ts --maxWorkers=1
  - pnpm exec vitest run tests/unit/long-session-action-contract.test.ts --maxWorkers=1
  - pnpm run typecheck
  - pnpm run contract:check
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm harness validate --spec harness/specs/tasks/long-session-baseline-contract.md
  - git diff --check
plannedTests:
  - tests/unit/long-session-action-contract.test.ts
acceptance:
  - 合同区分 Workspace、Project 投影、Assistant、SessionKey、物理 sessionId、native thread、Turn/Run/Task 和 resource owner；不新增独立 Project 或任务状态 owner。合同明确分出人类 CLI/斜杠命令面、宿主 app-server/host-api 面与模型工具面；resume/fork/archive/delete/worktree/handoff 由宿主控制面发起，模型只能调用现有受限工具，不能把 shell CLI 当作第二生命周期 API。
  - abort、session stop、archive、restore、reset、delete、fork、handoff、schedule pause 的可见行为、继承/不继承、前置、失败/unknown 与恢复路径逐项有当前代码入口。
  - 以隔离 agent fixture 固定运行中归档、重复/迟到 completion、generation 变化、后端切换、授权撤销、跨工作区与重启的负向清单；未实跑项明确 unmeasured。
  - 固定候选、输入、指标口径和后续验收预算；旧 124 项测试与性能样本只作历史依据，当前基线生成新回执。
docs:
  required: true
  files:
    - harness/specs/tasks/long-session-development-plan.md
---

**A1 · 固定长期会话身份、动作合同与故障基线**

重新核读当前实现，固定长期工作范围和动作语义，避免把旧调研、历史 PASS 或文件夹存在当作新能力。

本规格为待执行合同。任务状态、前置与下一 ready 由 repo-local Task Forest 管理。节点创建、文件存在、静态 validate 或 dry-run 不是功能证据。这是本 lane 唯一初始 ready 执行任务。

所属阶段一：统一会话动作并建立故障基线。统一边界见[规划合同索引](./long-session-development-plan.md)。

**前置与读入**

- 当前仓库与本计划规划记录；刷新 HEAD/diff/实际 source callers。

实现前运行：`pnpm harness context --spec harness/specs/tasks/long-session-baseline-contract.md`。

**实现和核验入口**

- docs/clawx-product-semantics.md
- shared/types/identity-scope.ts
- shared/types/workspace.ts
- shared/types/project.ts
- electron/services/sessions-api.ts
- openclaw_runtime/src/gateway/session-reset-service.ts
- openclaw_runtime/extensions/codex/src/app-server/thread-lifecycle.ts
- openclaw_runtime/extensions/anthropic/cli-backend.ts
- tests/unit/workspace-session.test.ts
- tests/unit/chat-session-continuity.test.ts

这些是当前 source/owner 定位。新产物与测试在本节点实现时交付；开始前按真实 seam 缩小 touchedAreas，不添加第二 writer/executor/context/memory/scheduler。已完成或已退休依赖以其真实输出为准，不擅自改既有状态。

**必须满足的负向与正向验收**

1. 合同区分 Workspace、Project 投影、Assistant、SessionKey、物理 sessionId、native thread、Turn/Run/Task 和 resource owner；不新增独立 Project 或任务状态 owner。
2. abort、session stop、archive、restore、reset、delete、fork、handoff、schedule pause 的可见行为、继承/不继承、前置、失败/unknown 与恢复路径逐项有当前代码入口。
3. 以隔离 agent fixture 固定运行中归档、重复/迟到 completion、generation 变化、后端切换、授权撤销、跨工作区与重启的负向清单；未实跑项明确 unmeasured。
4. 固定候选、输入、指标口径和后续验收预算；旧 124 项测试与性能样本只作历史依据，当前基线生成新回执。

**门禁与待交付检查**

- `pnpm exec vitest run tests/unit/workspace-session.test.ts tests/unit/chat-session-continuity.test.ts tests/unit/handoff-depth.test.ts --maxWorkers=1`
- `pnpm exec vitest run tests/unit/long-session-action-contract.test.ts --maxWorkers=1`
- `pnpm run typecheck`
- `pnpm run contract:check`
- `pnpm run comms:replay`
- `pnpm run comms:compare`
- `pnpm harness validate --spec harness/specs/tasks/long-session-baseline-contract.md`
- `git diff --check`

plannedTests 尚未实现；上述命令只有在交付对应测试后才构成验收，测试选择未命中必须失败。

E2E 要求真实 built Electron 与隔离 userData/run root。界面 host mocks 仅证明交互，功能接线必须回读 actual Host/Gateway/owner receipts。所有通信改动运行 comms replay/compare，cached typecheck 不替代 uncached 全门。

**可回读产物**

- harness/specs/fixtures/long-session-development/a1/action-and-inheritance-contract.json
- harness/specs/fixtures/long-session-development/a1/current-baseline.json
- harness/specs/fixtures/long-session-development/a1/negative-scenario-index.json

另生成同目录 SHA256SUMS。报告含 schema、driven_by: agent、actor、candidate/source/input identity、commands/exit/counts、原始结果引用、negative cases、cleanup/remaining/recovery_required 和未测范围。原始临时文件写 D 盘或已忽略目录；精选证据逐文件登记保留清单，不重签历史 artifacts。reviewer/agent 独立核验必须读原件，不能只读 stdout 或最终回答。

**执行提示与退出**

- 本 lane 唯一初始 ready leaf；先运行 harness context，再据当前实现缩小后续 source scope。
- 合同是现有权威的行为对照，不实现新 SessionReconciler、通用资源表或云执行环境。
- 参照 Codex app-server 的控制面分层，但不要把 Codex 的 thread/turn/goal 字段复制成 ClawX 第二权威；把它转译成现有 owner 的 source anchor、负向案例与验收。
- 一次一个 ready leaf；发生 scope/source/dependency 漂移时重读图与合同，不默认 --allow-stale 或修改别人的 dirty 内容。
- 验收条目全满足且证据一致后保存 proposal，base_graph_hash 匹配再 apply/validate/export；缺技术证据保持未完成并记录具体 gap。
- 不要求所有者真人操作、真人数据或 verdict；自动模拟/独立 agent 审查如实标记。没有 live-provider 数据不能包装为质量推广证据。
- 产品锁、冻结默认值、公开发布、重大独立 Project/执行环境范围决定不由本节点自动生效。

