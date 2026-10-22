---
lifecycleStatus: planned
id: versegit-product-f3-sidecar-delivery
title: 固定可复建的 VG sidecar 交付与消费身份
program: versegit-product-integration
taskKey: F3
phase: F
scenario: gateway-backend-communication
scenarios:
  - versegit-validation-layer-extension
taskType: runtime-bridge
intent: 消除本机 target/debug 路径依赖，为受控产品验证提供可独立消费的二进制包。
contractIndex: harness/specs/tasks/versegit-product-integration-node-contracts.md
dependsOnTasks:
  - F2
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
  - harness/specs/tasks/versegit-product-f3-sidecar-delivery.md
  - scripts/versegit-sidecar-package.mjs
  - scripts/bundle-main-runtime.mjs
  - electron/services/versegit-binary-resolver.ts
  - electron-builder.yml
  - harness/specs/fixtures/versegit-product-integration/f3/**
  - tests/unit/versegit-sidecar-delivery.test.ts
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
  - harness/specs/tasks/versegit-product-f4-controlled-stability.md
  - harness/specs/tasks/versegit-product-f5-global-acceptance.md
expectedUserBehavior:
  - 消除本机 target/debug 路径依赖，为受控产品验证提供可独立消费的二进制包。
  - 从明确 source snapshot/commit/residual patches、lockfile 和 build recipe 构建固定 artifact；不删除 provider 用户脏文件，不复制整仓源码。
  - binary/version/platform/capability/schema/contract/golden identity 绑定；packaged resolution 不依赖 D:/Projects 或 target/debug。
  - local package/build 仅用于自动验收，不发布、不改变仓库可见性或 release eligibility 锁。
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
  - pnpm exec vitest run tests/unit/versegit-sidecar-delivery.test.ts
  - pnpm contract:check
  - pnpm harness validate --spec harness/specs/tasks/versegit-product-f3-sidecar-delivery.md
acceptance:
  - 独立构建/消费身份与 golden differential 可回读；是否达到 byte-identical reproducibility 明确记录，未达声明要求不得称可复建交付完成。
  - artifact missing/mismatch/unsupported schema/未授权 profile 均拒绝，不回退到旧 binary 或裸机器路径。
  - 支持平台只列实际构建/执行过的目标，license/provenance/retention 与 manifest 校验完整。
docs:
  required: true
  files:
    - harness/specs/tasks/versegit-product-integration-node-contracts.md
---

**F3 · 固定可复建的 VG sidecar 交付与消费身份**

消除本机 target/debug 路径依赖，为受控产品验证提供可独立消费的二进制包。

本规格为待执行合同。节点创建、静态校验或 dry-run 均不表示功能已实现。依赖与状态以 repo-local Task Forest 为准；本文件定义验收，不维护第二份进度。

先完成 F2；不得为了当前任务提前实施下游 leaf。

对应六阶段规划：阶段六：完成持久生命周期、交付与最终验收。统一权限、模式、证据与收口约束见 [节点合同索引](./versegit-product-integration-node-contracts.md)。

**实施入口**

- scripts/versegit-sidecar-package.mjs
- scripts/bundle-main-runtime.mjs
- electron/services/versegit-binary-resolver.ts
- electron-builder.yml
- tests/unit/versegit-sidecar-delivery.test.ts

实现前运行：

`pnpm harness context --spec harness/specs/tasks/versegit-product-f3-sidecar-delivery.md`

新测试/runner 路径是该节点应交付的源文件，尚未生成；开始实现时按实际 seam 缩小 touchedAreas，shared contract/adapter 变更仍须保持兼容。不得把未来 tests 名称的存在当作通过。

**验收执行**

- 明确 source snapshot 的 release build 与重复 identity 对照
- sidecar package verifier + negative artifact identity
- 受控 package resolution tests

通信改动运行 comms:replay 与 comms:compare；visible interaction 改动须有同一变更集的真实 Electron E2E。harness run --dry-run 只检查所选 formal profile，不代替 requiredTests 或盘上证据。

**产物与独立复核**

- harness/specs/fixtures/versegit-product-integration/f3/sidecar-package-manifest.json
- harness/specs/fixtures/versegit-product-integration/f3/build-provenance.json
- harness/specs/fixtures/versegit-product-integration/f3/package-negative.json

原始运行进入 ignored artifact run；curated evidence 仅按精确文件加入 retained inventory。报告记录 source commit/tree、candidate/input identity、actor、执行命令/exit/计数、失败与未测项；源码进入同一变更集，历史 Task Forest 与 handoff 留在本地。至少一条根因负向例与实际 production caller 必须复核；缺失、过期、矛盾或只有结构证据不能收口。

**执行提示**

- provider source freeze 在其合法资产边界完成；预存 debug binary 可用于开发，但不能作为已交付的最终证据。

**共同边界**

- 本目标只推进明确 opt-in 的 Windows 并发开发闭环，保持 defaultOn/liveReady/productApproved 和 M4 原有冻结值。
- 所有操作和 verdict 由脚本或 agent 自动执行，产物标 driven_by: agent 与实际 actor；不新增真人操作/真人数据前置。
- 节点开始实现前先运行其 pnpm harness context；production caller、错误/权限/清理负向检查与盘上 artifact 是收口条件。
- 一次只执行本 lane 的一个 ready leaf；保护共享工作树其他 dirty 内容，不 reset/stash/clean、不代其提交。
- 大体积临时日志/fixture/trace 写 D 盘或仓库已忽略目录，任何不可观测结果保持 unmeasured/partial。

- 不变更默认值、产品锁、发布/公开范围或授予 M4
- 不整仓复制 VerseGit，不建立第二 executor/task graph/approval/write journal/registry
- 不以历史 PASS、脚本 fixture 或节点创建代替当前产品验收
