---
lifecycleStatus: planned
id: versegit-product-f4-controlled-stability
title: 验证安装布局中的并发闭环与有界稳定性
program: versegit-product-integration
taskKey: F4
phase: F
scenario: versegit-validation-layer-extension
taskType: planning
intent: 证明同一产品路径在独立消费、重复运行、失败与恢复中持续正确，同时记录成本。
contractIndex: harness/specs/tasks/versegit-product-integration-node-contracts.md
dependsOnTasks:
  - F3
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
  - harness/specs/tasks/versegit-product-f4-controlled-stability.md
  - scripts/versegit-product-stability.mts
  - tests/e2e/versegit-packaged-flow.spec.ts
  - tests/unit/versegit-stability-report.test.ts
  - harness/specs/fixtures/versegit-product-integration/f4/**
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
  - harness/specs/tasks/versegit-product-f2-cleanup-barrier.md
  - harness/specs/tasks/versegit-product-f3-sidecar-delivery.md
  - harness/specs/tasks/versegit-product-f5-global-acceptance.md
expectedUserBehavior:
  - 证明同一产品路径在独立消费、重复运行、失败与恢复中持续正确，同时记录成本。
  - 测试使用固定候选与 package layout，覆盖实际 renderer/host/runtime/tool/receipt/apply 路径；不得只直接调用 module。
  - 至少 3 次冷启动、10 个完整任务闭环、一次 active interruption/restart 和一次撤销/取消；预算来源在运行前冻结，新增阈值不能事后调低。
  - 大型日志/trace 放 D 盘，记录 P50/P95、call count、RSS 与原始计数；无既有 hard budget 的指标只做观测，不伪造通过阈值。
requiredRules:
  - versegit-validation-layer-extension-boundary
  - task-forest-autoclose-and-roles
  - repository-artifact-retention
  - disk-temp-policy
requiredProfiles:

requiredTests:
  - pnpm exec vitest run tests/unit/versegit-stability-report.test.ts
  - pnpm exec playwright test tests/e2e/versegit-packaged-flow.spec.ts
  - pnpm harness validate --spec harness/specs/tasks/versegit-product-f4-controlled-stability.md
acceptance:
  - 安装布局无需 provider source tree 或 debug 绝对路径即可运行；闭环结果与源构建一致，风险反馈和组合候选验证真实发生。
  - 重复、强杀、恢复、撤销和取消不重复 apply、不丢 failure outcome；每轮有 artifact 与 owned resource 清理核验。
  - 稳定性成功/失败次数、timing/cost/coverage 原始样本与报告吻合，非 Windows/模型/语言未测项明确。
docs:
  required: true
  files:
    - harness/specs/tasks/versegit-product-integration-node-contracts.md
---

**F4 · 验证安装布局中的并发闭环与有界稳定性**

证明同一产品路径在独立消费、重复运行、失败与恢复中持续正确，同时记录成本。

本规格为待执行合同。节点创建、静态校验或 dry-run 均不表示功能已实现。依赖与状态以 repo-local Task Forest 为准；本文件定义验收，不维护第二份进度。

先完成 F3；不得为了当前任务提前实施下游 leaf。

对应六阶段规划：阶段六：完成持久生命周期、交付与最终验收。统一权限、模式、证据与收口约束见 [节点合同索引](./versegit-product-integration-node-contracts.md)。

**实施入口**

- scripts/versegit-product-stability.mts
- tests/e2e/versegit-packaged-flow.spec.ts
- tests/unit/versegit-stability-report.test.ts

实现前运行：

`pnpm harness context --spec harness/specs/tasks/versegit-product-f4-controlled-stability.md`

新测试/runner 路径是该节点应交付的源文件，尚未生成；开始实现时按实际 seam 缩小 touchedAreas，shared contract/adapter 变更仍须保持兼容。不得把未来 tests 名称的存在当作通过。

**验收执行**

- packaged-flow Electron E2E
- bounded stability runner 与 restart/revocation 注入
- raw metrics aggregation 对拍

通信改动运行 comms:replay 与 comms:compare；visible interaction 改动须有同一变更集的真实 Electron E2E。harness run --dry-run 只检查所选 formal profile，不代替 requiredTests 或盘上证据。

**产物与独立复核**

- harness/specs/fixtures/versegit-product-integration/f4/packaged-flow.json
- harness/specs/fixtures/versegit-product-integration/f4/stability-samples.jsonl
- harness/specs/fixtures/versegit-product-integration/f4/stability-report.json
- harness/specs/fixtures/versegit-product-integration/f4/resource-survivors.json

原始运行进入 ignored artifact run；curated evidence 仅按精确文件加入 retained inventory。报告记录 source commit/tree、candidate/input identity、actor、执行命令/exit/计数、失败与未测项；源码进入同一变更集，历史 Task Forest 与 handoff 留在本地。至少一条根因负向例与实际 production caller 必须复核；缺失、过期、矛盾或只有结构证据不能收口。

**执行提示**

- 若事前真实预算失败，做 focused 修复并换新candidate重跑；不通过增加skip/retry/timeout或缩减覆盖回填成功。

**共同边界**

- 本目标只推进明确 opt-in 的 Windows 并发开发闭环，保持 defaultOn/liveReady/productApproved 和 M4 原有冻结值。
- 所有操作和 verdict 由脚本或 agent 自动执行，产物标 driven_by: agent 与实际 actor；不新增真人操作/真人数据前置。
- 节点开始实现前先运行其 pnpm harness context；production caller、错误/权限/清理负向检查与盘上 artifact 是收口条件。
- 一次只执行本 lane 的一个 ready leaf；保护共享工作树其他 dirty 内容，不 reset/stash/clean、不代其提交。
- 大体积临时日志/fixture/trace 写 D 盘或仓库已忽略目录，任何不可观测结果保持 unmeasured/partial。

- 不变更默认值、产品锁、发布/公开范围或授予 M4
- 不整仓复制 VerseGit，不建立第二 executor/task graph/approval/write journal/registry
- 不以历史 PASS、脚本 fixture 或节点创建代替当前产品验收
