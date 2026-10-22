---
lifecycleStatus: planned
id: versegit-product-b1-fact-adapter
title: 实现有界异步 VG 事实适配器与模式校验
program: versegit-product-integration
taskKey: B1
phase: B
scenario: gateway-backend-communication
scenarios:
  - versegit-validation-layer-extension
taskType: runtime-bridge
intent: 把脚本里的受限事实调用提取成宿主可复用的小入口，同时维持执行权威与身份边界。
contractIndex: harness/specs/tasks/versegit-product-integration-node-contracts.md
dependsOnTasks:
  - A2
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
  - harness/specs/tasks/versegit-product-b1-fact-adapter.md
  - electron/services/versegit-module.ts
  - electron/services/versegit-fact-adapter.ts
  - electron/services/resource-tracker.ts
  - shared/types/versegit.ts
  - tests/unit/versegit-fact-adapter.test.ts
  - harness/specs/fixtures/versegit-product-integration/b1/**
  - harness/specs/tasks/versegit-product-integration-node-contracts.md
  - harness/specs/tasks/versegit-product-a1-evidence-baseline.md
  - harness/specs/tasks/versegit-product-a2-runtime-baseline.md
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
  - harness/specs/tasks/versegit-product-f4-controlled-stability.md
  - harness/specs/tasks/versegit-product-f5-global-acceptance.md
expectedUserBehavior:
  - 把脚本里的受限事实调用提取成宿主可复用的小入口，同时维持执行权威与身份边界。
  - 复用既有身份、capability、resource envelope 和固定 argv 语义；不导入整个 WP7 fixture 脚本或 provider 内部源码。
  - M0 零调用，M1 只读诊断且 write_domain_state=false；init/session/observe 只能在 M2 明确 provider-domain grant 下执行。
  - 使用有界异步 execFile 及现有资源治理，拒绝任意 argv/shell/env/binary override 和未知 delivery 的 effect 重试。
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
  - pnpm exec vitest run tests/unit/versegit-fact-adapter.test.ts
  - pnpm contract:check
  - pnpm harness validate --spec harness/specs/tasks/versegit-product-b1-fact-adapter.md
acceptance:
  - matching identity 才允许附着；missing/digest/schema/capability/owner/epoch/expired/revoked grant 负向例在产生副作用前拒绝或报告不可用。
  - 每次调用记录 binary、argv/cwd role、pid、exit、deadline 和有界输出摘要；超时/取消后无自有进程残留。
  - disabled 或缺少并发触发时 VG process/provider state 写入均为零；VG 可用性事实不改变 host harness verdict。
docs:
  required: true
  files:
    - harness/specs/tasks/versegit-product-integration-node-contracts.md
---

**B1 · 实现有界异步 VG 事实适配器与模式校验**

把脚本里的受限事实调用提取成宿主可复用的小入口，同时维持执行权威与身份边界。

本规格为待执行合同。节点创建、静态校验或 dry-run 均不表示功能已实现。依赖与状态以 repo-local Task Forest 为准；本文件定义验收，不维护第二份进度。

先完成 A2；不得为了当前任务提前实施下游 leaf。

对应六阶段规划：阶段二：接通宿主诊断与受限事实调用。统一权限、模式、证据与收口约束见 [节点合同索引](./versegit-product-integration-node-contracts.md)。

**实施入口**

- electron/services/versegit-module.ts
- electron/services/versegit-fact-adapter.ts
- electron/services/resource-tracker.ts
- shared/types/versegit.ts
- tests/unit/versegit-fact-adapter.test.ts

实现前运行：

`pnpm harness context --spec harness/specs/tasks/versegit-product-b1-fact-adapter.md`

新测试/runner 路径是该节点应交付的源文件，尚未生成；开始实现时按实际 seam 缩小 touchedAreas，shared contract/adapter 变更仍须保持兼容。不得把未来 tests 名称的存在当作通过。

**验收执行**

- typed adapter 单测与真实固定 binary 对照
- pnpm run typecheck
- effect matrix / 模式和撤销负向检查

通信改动运行 comms:replay 与 comms:compare；visible interaction 改动须有同一变更集的真实 Electron E2E。harness run --dry-run 只检查所选 formal profile，不代替 requiredTests 或盘上证据。

**产物与独立复核**

- harness/specs/fixtures/versegit-product-integration/b1/adapter-differential.json
- harness/specs/fixtures/versegit-product-integration/b1/mode-effect-matrix.json
- harness/specs/fixtures/versegit-product-integration/b1/authority-negative.json

原始运行进入 ignored artifact run；curated evidence 仅按精确文件加入 retained inventory。报告记录 source commit/tree、candidate/input identity、actor、执行命令/exit/计数、失败与未测项；源码进入同一变更集，历史 Task Forest 与 handoff 留在本地。至少一条根因负向例与实际 production caller 必须复核；缺失、过期、矛盾或只有结构证据不能收口。

**执行提示**

- 当前 execFileSync/spawnSync 不直接接 Main 热路径；只实现已证明的 version/capabilities/doctor/session/observe/check seam。

**共同边界**

- 本目标只推进明确 opt-in 的 Windows 并发开发闭环，保持 defaultOn/liveReady/productApproved 和 M4 原有冻结值。
- 所有操作和 verdict 由脚本或 agent 自动执行，产物标 driven_by: agent 与实际 actor；不新增真人操作/真人数据前置。
- 节点开始实现前先运行其 pnpm harness context；production caller、错误/权限/清理负向检查与盘上 artifact 是收口条件。
- 一次只执行本 lane 的一个 ready leaf；保护共享工作树其他 dirty 内容，不 reset/stash/clean、不代其提交。
- 大体积临时日志/fixture/trace 写 D 盘或仓库已忽略目录，任何不可观测结果保持 unmeasured/partial。

- 不变更默认值、产品锁、发布/公开范围或授予 M4
- 不整仓复制 VerseGit，不建立第二 executor/task graph/approval/write journal/registry
- 不以历史 PASS、脚本 fixture 或节点创建代替当前产品验收
