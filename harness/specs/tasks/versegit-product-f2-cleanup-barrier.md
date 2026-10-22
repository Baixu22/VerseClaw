---
lifecycleStatus: planned
id: versegit-product-f2-cleanup-barrier
title: 把证据封存和解除 VG 引用接入所有清理路径
program: versegit-product-integration
taskKey: F2
phase: F
scenario: gateway-backend-communication
scenarios:
  - versegit-validation-layer-extension
taskType: runtime-bridge
intent: 让正常、取消、故障、删除和 stale pruning 共用一个安全屏障，避免仍被引用的 worktree 被删除。
contractIndex: harness/specs/tasks/versegit-product-integration-node-contracts.md
dependsOnTasks:
  - F1
residualPaths:
  - docs/architecture-overview.md
  - openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/run/params.ts
  - openclaw_runtime/src/auto-reply/reply/agent-runner-utils.ts
  - openclaw_runtime/src/auto-reply/reply/get-reply-run.ts
  - openclaw_runtime/src/auto-reply/reply/queue/types.ts
  - openclaw_runtime/src/auto-reply/templating.ts
  - openclaw_runtime/src/gateway/server-methods/chat.ts
  - harness/specs/tasks/model-capability-effective-runtime-state.md
  - openclaw_runtime/src/agents/runtime-effective-capability.ts
  - tests/unit/runtime-effective-capability.test.ts
touchedAreas:
  - harness/specs/tasks/versegit-product-f2-cleanup-barrier.md
  - electron/services/versegit-lifecycle.ts
  - electron/services/versegit-receipt-evidence.ts
  - openclaw_runtime/src/agents/worktree-service.ts
  - openclaw_runtime/src/agents/subagent-registry.ts
  - tests/unit/versegit-cleanup-barrier.test.ts
  - tests/e2e/versegit-lifecycle-cleanup.spec.ts
  - harness/specs/fixtures/versegit-product-integration/f2/**
  - harness/specs/tasks/versegit-product-integration-node-contracts.md
  - harness/specs/tasks/versegit-product-a1-evidence-baseline.md
  - harness/specs/tasks/versegit-product-a2-runtime-baseline.md
  - harness/specs/tasks/versegit-product-b1-fact-adapter.md
  - harness/specs/tasks/versegit-product-b2-host-diagnostics.md
  - harness/specs/tasks/versegit-product-c1-runtime-bindings.md
  - harness/specs/tasks/versegit-product-c2-observation-basis.md
  - harness/specs/tasks/versegit-product-d1-feedback-delivery.md
  - harness/specs/tasks/versegit-product-d2-paired-agent-evaluation.md
  - harness/specs/tasks/versegit-product-e1-candidate-freeze.md
  - harness/specs/tasks/versegit-product-e2-receipt-verification.md
  - harness/specs/tasks/versegit-product-e3-host-apply.md
  - harness/specs/tasks/versegit-product-f1-completion-contract.md
  - harness/specs/tasks/versegit-product-f3-sidecar-delivery.md
  - harness/specs/tasks/versegit-product-f4-controlled-stability.md
  - harness/specs/tasks/versegit-product-f5-global-acceptance.md
expectedUserBehavior:
  - 让正常、取消、故障、删除和 stale pruning 共用一个安全屏障，避免仍被引用的 worktree 被删除。
  - 严格执行 stop accepting→drain/cancel→seal evidence→detach VG→verify owner/epoch/reference→delete disposable worktree。
  - 覆盖正常完成、失败、超时、取消、用户删除、stale pruning 与 restart recovery；失败保留资源并报告 recovery_required。
  - VG 不删除宿主 worktree；清理仅 agent-owned disposable 资源，未提交用户内容和保留证据不能被删。
requiredRules:
  - versegit-validation-layer-extension-boundary
  - task-forest-autoclose-and-roles
  - repository-artifact-retention
  - disk-temp-policy
  - renderer-main-boundary
  - backend-communication-boundary
  - comms-regression
  - docs-sync
requiredProfiles:
  - fast
  - comms
requiredTests:
  - pnpm exec vitest run tests/unit/versegit-cleanup-barrier.test.ts
  - pnpm exec playwright test tests/e2e/versegit-lifecycle-cleanup.spec.ts
  - pnpm contract:check
  - pnpm harness validate --spec harness/specs/tasks/versegit-product-f2-cleanup-barrier.md
acceptance:
  - 每条实际删除入口都经过同一 barrier，晚到 event 不能覆盖已 seal outcome 或复活会话。
  - barrier 各阶段故障注入均保留正确资源/证据，owner/epoch/ref 不符不能删除。
  - 正常及 failure/continuation 的 process/manager/worktree/temp survivor 均实际核验为零；未能观测不宣称零。
docs:
  required: true
  files:
    - harness/specs/tasks/versegit-product-integration-node-contracts.md
---

**F2 · 把证据封存和解除 VG 引用接入所有清理路径**

让正常、取消、故障、删除和 stale pruning 共用一个安全屏障，避免仍被引用的 worktree 被删除。

本规格为待执行合同。节点创建、静态校验或 dry-run 均不表示功能已实现。依赖与状态以 repo-local Task Forest 为准；本文件定义验收，不维护第二份进度。

先完成 F1；不得为了当前任务提前实施下游 leaf。

对应六阶段规划：阶段六：完成持久生命周期、交付与最终验收。统一权限、模式、证据与收口约束见 [节点合同索引](./versegit-product-integration-node-contracts.md)。

**实施入口**

- electron/services/versegit-lifecycle.ts
- electron/services/versegit-receipt-evidence.ts
- openclaw_runtime/src/agents/worktree-service.ts
- openclaw_runtime/src/agents/subagent-registry.ts
- tests/unit/versegit-cleanup-barrier.test.ts
- tests/e2e/versegit-lifecycle-cleanup.spec.ts

实现前运行：

`pnpm harness context --spec harness/specs/tasks/versegit-product-f2-cleanup-barrier.md`

新测试/runner 路径是该节点应交付的源文件，尚未生成；开始实现时按实际 seam 缩小 touchedAreas，shared contract/adapter 变更仍须保持兼容。不得把未来 tests 名称的存在当作通过。

**验收执行**

- 真实 Windows worktree 与 owned-PID 清理 E2E
- barrier 各阶段故障/取消注入
- 用户修改保留与 stale pruning negative

通信改动运行 comms:replay 与 comms:compare；visible interaction 改动须有同一变更集的真实 Electron E2E。harness run --dry-run 只检查所选 formal profile，不代替 requiredTests 或盘上证据。

**产物与独立复核**

- harness/specs/fixtures/versegit-product-integration/f2/cleanup-barrier.json
- harness/specs/fixtures/versegit-product-integration/f2/resource-inventory.json
- harness/specs/fixtures/versegit-product-integration/f2/recovery-required.json

原始运行进入 ignored artifact run；curated evidence 仅按精确文件加入 retained inventory。报告记录 source commit/tree、candidate/input identity、actor、执行命令/exit/计数、失败与未测项；源码进入同一变更集，历史 Task Forest 与 handoff 留在本地。至少一条根因负向例与实际 production caller 必须复核；缺失、过期、矛盾或只有结构证据不能收口。

**执行提示**

- 已有工具策略拒绝删除记录保持；不能换工具绕过策略以制造 zero-survivor。

**共同边界**

- 本目标只推进明确 opt-in 的 Windows 并发开发闭环，保持 defaultOn/liveReady/productApproved 和 M4 原有冻结值。
- 所有操作和 verdict 由脚本或 agent 自动执行，产物标 driven_by: agent 与实际 actor；不新增真人操作/真人数据前置。
- 节点开始实现前先运行其 pnpm harness context；production caller、错误/权限/清理负向检查与盘上 artifact 是收口条件。
- 一次只执行本 lane 的一个 ready leaf；保护共享工作树其他 dirty 内容，不 reset/stash/clean、不代其提交。
- 大体积临时日志/fixture/trace 写 D 盘或仓库已忽略目录，任何不可观测结果保持 unmeasured/partial。

- 不变更默认值、产品锁、发布/公开范围或授予 M4
- 不整仓复制 VerseGit，不建立第二 executor/task graph/approval/write journal/registry
- 不以历史 PASS、脚本 fixture 或节点创建代替当前产品验收
