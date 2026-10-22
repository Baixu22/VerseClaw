---
lifecycleStatus: planned
id: versegit-product-e2-receipt-verification
title: 在冻结候选上运行 VerseShell 验证并重建权威收据
program: versegit-product-integration
taskKey: E2
phase: E
scenario: gateway-backend-communication
scenarios:
  - versegit-validation-layer-extension
taskType: runtime-bridge
intent: 把用户测试/构建验证绑定到实际候选与盘上执行证据，拒绝自报或过期收据。
contractIndex: harness/specs/tasks/versegit-product-integration-node-contracts.md
dependsOnTasks:
  - E1
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
  - harness/specs/tasks/versegit-product-e2-receipt-verification.md
  - electron/services/versegit-receipt-bridge.ts
  - electron/services/versegit-receipt-evidence.ts
  - openclaw_runtime/src/agents/verseshell/governed-process.ts
  - openclaw_runtime/src/agents/verseshell/governed-exec.ts
  - shared/types/versegit.ts
  - tests/unit/versegit-candidate-receipts.test.ts
  - harness/specs/fixtures/versegit-product-integration/e2/**
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
  - harness/specs/tasks/versegit-product-e3-host-apply.md
  - harness/specs/tasks/versegit-product-f1-completion-contract.md
  - harness/specs/tasks/versegit-product-f2-cleanup-barrier.md
  - harness/specs/tasks/versegit-product-f3-sidecar-delivery.md
  - harness/specs/tasks/versegit-product-f4-controlled-stability.md
  - harness/specs/tasks/versegit-product-f5-global-acceptance.md
expectedUserBehavior:
  - 把用户测试/构建验证绑定到实际候选与盘上执行证据，拒绝自报或过期收据。
  - 实际 user code/tests/build 只经 VerseShell governed ACI，固定 plan/deadline/owner/argv/cwd/env/output bounds，不调用 native verification fallback。
  - 从 host 保留的 plan/input manifest/observation/process/stdout/stderr 重建 receipt；VG 自己的绿色报告不产生 execution authority。
  - selected/partial 测试不得冒充 full requiredTests，failed receipt 与 continuation 是不同不可覆盖的事实。
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
  - pnpm exec vitest run tests/unit/versegit-candidate-receipts.test.ts
  - pnpm contract:check
  - pnpm harness validate --spec harness/specs/tasks/versegit-product-e2-receipt-verification.md
acceptance:
  - 真实冻结 candidate 的指定完整 requiredTests 成功/失败及 cleanup 均可复验，receipt 绑定 plan/candidate/check/owner/epoch/input/artifact。
  - missing/fake/self-reported/wrong candidate/old epoch/input drift/revoked grant/partial scope/tampered artifact 逐项拒绝。
  - 执行失败候选无写回，failure-before-continuation 原始证据保留，所有 managed process 最终可确认退出。
docs:
  required: true
  files:
    - harness/specs/tasks/versegit-product-integration-node-contracts.md
---

**E2 · 在冻结候选上运行 VerseShell 验证并重建权威收据**

把用户测试/构建验证绑定到实际候选与盘上执行证据，拒绝自报或过期收据。

本规格为待执行合同。节点创建、静态校验或 dry-run 均不表示功能已实现。依赖与状态以 repo-local Task Forest 为准；本文件定义验收，不维护第二份进度。

先完成 E1；不得为了当前任务提前实施下游 leaf。

对应六阶段规划：阶段五：验证组合候选后再由宿主写回。统一权限、模式、证据与收口约束见 [节点合同索引](./versegit-product-integration-node-contracts.md)。

**实施入口**

- electron/services/versegit-receipt-bridge.ts
- electron/services/versegit-receipt-evidence.ts
- openclaw_runtime/src/agents/verseshell/governed-process.ts
- openclaw_runtime/src/agents/verseshell/governed-exec.ts
- shared/types/versegit.ts
- tests/unit/versegit-candidate-receipts.test.ts

实现前运行：

`pnpm harness context --spec harness/specs/tasks/versegit-product-e2-receipt-verification.md`

新测试/runner 路径是该节点应交付的源文件，尚未生成；开始实现时按实际 seam 缩小 touchedAreas，shared contract/adapter 变更仍须保持兼容。不得把未来 tests 名称的存在当作通过。

**验收执行**

- 真实 VerseShell candidate plan/receipt 验证
- 盘上权威与篡改负向 tests
- scope 与失败/continuation 顺序检查

通信改动运行 comms:replay 与 comms:compare；visible interaction 改动须有同一变更集的真实 Electron E2E。harness run --dry-run 只检查所选 formal profile，不代替 requiredTests 或盘上证据。

**产物与独立复核**

- harness/specs/fixtures/versegit-product-integration/e2/plans.json
- harness/specs/fixtures/versegit-product-integration/e2/execution-receipts.json
- harness/specs/fixtures/versegit-product-integration/e2/receipt-negative.json
- harness/specs/fixtures/versegit-product-integration/e2/execution-cleanup.json

原始运行进入 ignored artifact run；curated evidence 仅按精确文件加入 retained inventory。报告记录 source commit/tree、candidate/input identity、actor、执行命令/exit/计数、失败与未测项；源码进入同一变更集，历史 Task Forest 与 handoff 留在本地。至少一条根因负向例与实际 production caller 必须复核；缺失、过期、矛盾或只有结构证据不能收口。

**执行提示**

- 复用现有 FileVerseShellReceiptAuthority 和 receipt bridge；不接受 caller realVerseshell=true 自证。

**共同边界**

- 本目标只推进明确 opt-in 的 Windows 并发开发闭环，保持 defaultOn/liveReady/productApproved 和 M4 原有冻结值。
- 所有操作和 verdict 由脚本或 agent 自动执行，产物标 driven_by: agent 与实际 actor；不新增真人操作/真人数据前置。
- 节点开始实现前先运行其 pnpm harness context；production caller、错误/权限/清理负向检查与盘上 artifact 是收口条件。
- 一次只执行本 lane 的一个 ready leaf；保护共享工作树其他 dirty 内容，不 reset/stash/clean、不代其提交。
- 大体积临时日志/fixture/trace 写 D 盘或仓库已忽略目录，任何不可观测结果保持 unmeasured/partial。

- 不变更默认值、产品锁、发布/公开范围或授予 M4
- 不整仓复制 VerseGit，不建立第二 executor/task graph/approval/write journal/registry
- 不以历史 PASS、脚本 fixture 或节点创建代替当前产品验收
