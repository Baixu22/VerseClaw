---
lifecycleStatus: planned
id: long-session-delegation-admission
title: 按授权和隔离规则委派独立会话并记录接收回执
program: long-session-development-20261022
taskKey: C2
phase: C
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: 完成 coordinator 到 worker 的真实接线，使每项独立工作有 scope、role、checkout、权限和 accepted receipt。
contractIndex: harness/specs/tasks/long-session-development-plan.md
dependsOnTasks:
  - C1
touchedAreas:
  - harness/specs/tasks/long-session-delegation-admission.md
  - harness/specs/tasks/long-session-development-plan.md
  - openclaw_runtime/src/agents/role-spawn.ts
  - openclaw_runtime/src/agents/orchestrator-run-observed.ts
  - openclaw_runtime/src/agents/orchestration-resource-scheduler.ts
  - openclaw_runtime/src/agents/worktree-service.ts
  - openclaw_runtime/src/agents/tools/sessions-spawn-tool.ts
  - openclaw_runtime/src/gateway/server-methods/role-orchestration-methods.ts
  - openclaw_runtime/src/gateway/server-methods/sessions.lifecycle.ts
  - electron/services/sessions-api.ts
  - shared/host-api/contract.ts
  - tests/unit/long-session-delegation-admission.test.ts
  - harness/specs/fixtures/long-session-development/c2/**
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
  - 完成 coordinator 到 worker 的真实接线，使每项独立工作有 scope、role、checkout、权限和 accepted receipt。
  - 创建本合同不代表功能已实现；结果、配置、授权和任务完成仍归现有 owner，未知状态如实保留。
requiredTests:
  - pnpm exec vitest run tests/unit/orchestration-resource-scheduler.test.ts tests/unit/role-orchestration-methods.test.ts tests/unit/workspace-session.test.ts --maxWorkers=1
  - pnpm exec vitest run tests/unit/long-session-delegation-admission.test.ts --maxWorkers=1
  - pnpm run typecheck
  - pnpm run contract:check
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm harness validate --spec harness/specs/tasks/long-session-delegation-admission.md
  - git diff --check
plannedTests:
  - tests/unit/long-session-delegation-admission.test.ts
acceptance:
  - 使用既有 session/role/orchestration 入口提交 worker，receipt 绑定 coordinator revision/generation、task ref、child session/run、backend、environment binding 和工具授权；accepted 不等于 running/completed。
  - 不复用过期/撤销 grant，不允许 child 超过 parent 权限；未知 worker、不支持的 backend 与拒绝启动不产生 phantom completion。
  - 使用实际 isolation backend（真实 Git checkout 或 inprocess）并明确标注；写入并行仅限已验证 checkout 或写集证明，否则按既有调度延迟/串行。TF-0510 的非阻塞处置可作为依据。
  - 重复提交、reset/stop 与 admission 竞争、同 owner 重启重试均有幂等/负向产物；不创建第二 executor 或无限并发默认。
docs:
  required: true
  files:
    - harness/specs/tasks/long-session-development-plan.md
---

**C2 · 按授权和隔离规则委派独立会话并记录接收回执**

完成 coordinator 到 worker 的真实接线，使每项独立工作有 scope、role、checkout、权限和 accepted receipt。

本规格为待执行合同。任务状态、前置与下一 ready 由 repo-local Task Forest 管理。节点创建、文件存在、静态 validate 或 dry-run 不是功能证据。只有硬前置任务/阶段的盘上验收完整后才开始；非阻塞的处置依据缺失时按合同 fallback。

所属阶段三：交付单工作区长期协调入口。统一边界见[规划合同索引](./long-session-development-plan.md)。

**前置与读入**

- C1：回读其当前合同与输出，不根据旧 summary 推断通过。
- TF-0510（非阻塞依据）：若已有可用处置则回读其结果；安全 fallback 与串行路径足以完成本节点，不设置硬等待。

实现前运行：`pnpm harness context --spec harness/specs/tasks/long-session-delegation-admission.md`。

**实现和核验入口**

- openclaw_runtime/src/agents/role-spawn.ts
- openclaw_runtime/src/agents/orchestrator-run-observed.ts
- openclaw_runtime/src/agents/orchestration-resource-scheduler.ts
- openclaw_runtime/src/agents/worktree-service.ts
- openclaw_runtime/src/agents/tools/sessions-spawn-tool.ts
- openclaw_runtime/src/gateway/server-methods/role-orchestration-methods.ts
- openclaw_runtime/src/gateway/server-methods/sessions.lifecycle.ts
- electron/services/sessions-api.ts
- shared/host-api/contract.ts

这些是当前 source/owner 定位。新产物与测试在本节点实现时交付；开始前按真实 seam 缩小 touchedAreas，不添加第二 writer/executor/context/memory/scheduler。已完成或已退休依赖以其真实输出为准，不擅自改既有状态。

**必须满足的负向与正向验收**

1. 使用既有 session/role/orchestration 入口提交 worker，receipt 绑定 coordinator revision/generation、task ref、child session/run、backend 和工具授权；accepted 不等于 running/completed。
2. 不复用过期/撤销 grant，不允许 child 超过 parent 权限；未知 worker、不支持的 backend 与拒绝启动不产生 phantom completion。
3. 使用实际 isolation backend（真实 Git checkout 或 inprocess）并明确标注；写入并行仅限已验证 checkout 或写集证明，否则按既有调度延迟/串行。TF-0510 的非阻塞处置可作为依据。receipt 必须绑定 checkout/worktree canonical root、branch/detached 状态、父会话 environment revision、进程/后台终端预算；不支持的 worktree、branch 已占用或资源预算不足时拒绝或排队，不产生 phantom worker。
4. 重复提交、reset/stop 与 admission 竞争、同 owner 重启重试均有幂等/负向产物；不创建第二 executor 或无限并发默认。

**门禁与待交付检查**

- `pnpm exec vitest run tests/unit/orchestration-resource-scheduler.test.ts tests/unit/role-orchestration-methods.test.ts tests/unit/workspace-session.test.ts --maxWorkers=1`
- `pnpm exec vitest run tests/unit/long-session-delegation-admission.test.ts --maxWorkers=1`
- `pnpm run typecheck`
- `pnpm run contract:check`
- `pnpm run comms:replay`
- `pnpm run comms:compare`
- `pnpm harness validate --spec harness/specs/tasks/long-session-delegation-admission.md`
- `git diff --check`

plannedTests 尚未实现；上述命令只有在交付对应测试后才构成验收，测试选择未命中必须失败。

E2E 要求真实 built Electron 与隔离 userData/run root。界面 host mocks 仅证明交互，功能接线必须回读 actual Host/Gateway/owner receipts。所有通信改动运行 comms replay/compare，cached typecheck 不替代 uncached 全门。

**可回读产物**

- harness/specs/fixtures/long-session-development/c2/delegation-admission-receipts.json
- harness/specs/fixtures/long-session-development/c2/scope-permission-isolation-matrix.json

另生成同目录 SHA256SUMS。报告含 schema、driven_by: agent、actor、candidate/source/input identity、commands/exit/counts、原始结果引用、negative cases、cleanup/remaining/recovery_required 和未测范围。原始临时文件写 D 盘或已忽略目录；精选证据逐文件登记保留清单，不重签历史 artifacts。reviewer/agent 独立核验必须读原件，不能只读 stdout 或最终回答。

**执行提示与退出**

- TF-0510 可以以明确 internal/retired/unavailable 处置交付，本任务接受安全 fallback；不复活被退休 isolation backend。
- 同一批写任务不能仅靠提示词约定隔离，actual backend/checkout identity 必须入回执。
- 模型只能经现有 sessions_spawn/role/orchestration 入口发起委派，不得直接调用 git worktree 或把 shell 当作第二生命周期 API；宿主负责选中环境绑定和回收策略。
- 一次一个 ready leaf；发生 scope/source/dependency 漂移时重读图与合同，不默认 --allow-stale 或修改别人的 dirty 内容。
- 验收条目全满足且证据一致后保存 proposal，base_graph_hash 匹配再 apply/validate/export；缺技术证据保持未完成并记录具体 gap。
- 不要求所有者真人操作、真人数据或 verdict；自动模拟/独立 agent 审查如实标记。没有 live-provider 数据不能包装为质量推广证据。
- 产品锁、冻结默认值、公开发布、重大独立 Project/执行环境范围决定不由本节点自动生效。

