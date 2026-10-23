---
lifecycleStatus: planned
id: versegit-product-f5-global-acceptance
title: 逐项聚合 VG 产品接入验收并同步能力声明
program: versegit-product-integration
taskKey: F5
phase: F
scenario: versegit-validation-layer-extension
taskType: planning
intent: 让当前产品接线与成熟使用声明都由同一候选证据支持，防止局部通过代替完整闭环。
contractIndex: harness/specs/tasks/versegit-product-integration-node-contracts.md
dependsOnTasks:
  - F4
residualPaths:
  - harness/specs/tasks/model-capability-effective-runtime-state.md
  - openclaw_runtime/src/agents/runtime-effective-capability.ts
  - tests/unit/runtime-effective-capability.test.ts
touchedAreas:
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - docs/clawx-product-semantics.md
  - docs/dev/versegit-validation-layer/README.md
  - electron-builder.yml
  - electron/gateway/versegit-bridge.ts
  - electron/main/ipc-handlers.ts
  - electron/services/versegit-*.ts
  - harness/specs/fixtures/versegit-product-integration/**
  - harness/specs/tasks/versegit-product-*.md
  - harness/specs/tasks/versegit-product-integration-node-contracts.md
  - openclaw_runtime/src/agents/embedded-agent-runner/extensions.ts
  - openclaw_runtime/src/agents/harness/versegit-*.ts
  - openclaw_runtime/src/agents/orchestration-*.ts
  - openclaw_runtime/src/agents/orchestrator-run-observed.ts
  - openclaw_runtime/src/agents/patch-flow.ts
  - openclaw_runtime/src/agents/session-tool-result-guard-wrapper.ts
  - openclaw_runtime/src/agents/sessions/tools/*.ts
  - openclaw_runtime/src/agents/subagent-*.ts
  - openclaw_runtime/src/agents/verseshell/governed-process.ts
  - openclaw_runtime/src/agents/worktree-service.ts
  - openclaw_runtime/src/plugin-sdk/versegit-*.ts
  - resources/versegit/**
  - scripts/bundle-main-runtime.mjs
  - scripts/verify-versegit-product-*.mts
  - scripts/verify-versegit-product-integration.d.mts
  - scripts/verify-versegit-product-integration.mjs
  - scripts/versegit-*.mjs
  - scripts/versegit-*.mts
  - scripts/versegit-sidecar-package.mjs
  - shared/component-authority-manifest.ts
  - shared/host-api/contract.ts
  - shared/types/versegit.ts
  - shared/versegit-*.ts
  - src/lib/host-api.ts
  - tests/e2e/app-smoke.spec.ts
  - tests/e2e/versegit-*.spec.ts
  - tests/unit/versegit-*.test.ts
expectedUserBehavior:
  - 让当前产品接线与成熟使用声明都由同一候选证据支持，防止局部通过代替完整闭环。
  - 每条目标 acceptance 绑定当前候选 source/binary/contract/build/trace/receipt/cleanup 证据，并由独立 verifier 回读；所有必需 leaf 已done或有明确且获授权的范围变更。
  - 模型/产品 effective capability 表达实际 enabled/available/mode/coverage，disabled/unavailable 不自述已能调用；不改 shared capability 主线 owner。
  - 保持 defaultOff/non-GA/M4-unauthorized 与发布决定边界；全部产物标 agent，任何模拟不声称 real-human。
requiredRules:
  - versegit-validation-layer-extension-boundary
  - task-forest-autoclose-and-roles
  - repository-artifact-retention
  - disk-temp-policy
requiredProfiles:

requiredTests:
  - pnpm exec vitest run tests/unit/versegit-product-acceptance.test.ts
  - node scripts/verify-versegit-product-integration.mjs
  - pnpm harness validate --spec harness/specs/tasks/versegit-product-f5-global-acceptance.md
acceptance:
  - 当前目标的风险观察、agent反馈、候选前置验证、host writeback、持久结果、cleanup、package 和有界稳定性全部有可重算映射。
  - 独立 verifier 对 current candidate 得到 P0=0/P1=0，未跑/残余 P2 明确；不能以后续节点存在代替本目标缺失功能。
  - README三语言、产品/模型能力与真实调用者/证据一致；Task Forest仅在盘上门禁完备与base_graph_hash匹配后自动收口，validate/export通过。
docs:
  required: true
  files:
    - harness/specs/tasks/versegit-product-integration-node-contracts.md
---

**F5 · 逐项聚合 VG 产品接入验收并同步能力声明**

让当前产品接线与成熟使用声明都由同一候选证据支持，防止局部通过代替完整闭环。

本规格为待执行合同。节点创建、静态校验或 dry-run 均不表示功能已实现。依赖与状态以 repo-local Task Forest 为准；本文件定义验收，不维护第二份进度。

先完成 F4；不得为了当前任务提前实施下游 leaf。

对应六阶段规划：阶段六：完成持久生命周期、交付与最终验收。统一权限、模式、证据与收口约束见 [节点合同索引](./versegit-product-integration-node-contracts.md)。

**实施入口**

- scripts/verify-versegit-product-integration.mjs
- tests/unit/versegit-product-acceptance.test.ts
- docs/dev/versegit-validation-layer/README.md
- README.md
- README.zh-CN.md
- README.ja-JP.md
- shared/component-authority-manifest.ts

实现前运行：

`pnpm harness context --spec harness/specs/tasks/versegit-product-f5-global-acceptance.md`

新测试/runner 路径是该节点应交付的源文件，尚未生成；开始实现时按实际 seam 缩小 touchedAreas，shared contract/adapter 变更仍须保持兼容。不得把未来 tests 名称的存在当作通过。

**验收执行**

- current candidate 全目标 independent verifier
- planned child evidence inventory + hash/credential scan
- harness validate/dry-run 与节点完整性核验
- README/effective capability claims 对拍

通信改动运行 comms:replay 与 comms:compare；visible interaction 改动须有同一变更集的真实 Electron E2E。harness run --dry-run 只检查所选 formal profile，不代替 requiredTests 或盘上证据。

**产物与独立复核**

- harness/specs/fixtures/versegit-product-integration/f5/global-acceptance.json
- harness/specs/fixtures/versegit-product-integration/f5/criterion-evidence-index.json
- harness/specs/fixtures/versegit-product-integration/f5/independent-verdict.json
- harness/specs/fixtures/versegit-product-integration/f5/SHA256SUMS

原始运行进入 ignored artifact run；curated evidence 仅按精确文件加入 retained inventory。报告记录 source commit/tree、candidate/input identity、actor、执行命令/exit/计数、失败与未测项；源码进入同一变更集，历史 Task Forest 与 handoff 留在本地。至少一条根因负向例与实际 production caller 必须复核；缺失、过期、矛盾或只有结构证据不能收口。

**执行提示**

- 当某项没有收益或没有实际产品caller，明确失败/剩余缺口，不能写“已有结构可后续接线”后关闭产品目标。

**共同边界**

- 本目标只推进明确 opt-in 的 Windows 并发开发闭环，保持 defaultOn/liveReady/productApproved 和 M4 原有冻结值。
- 所有操作和 verdict 由脚本或 agent 自动执行，产物标 driven_by: agent 与实际 actor；不新增真人操作/真人数据前置。
- 节点开始实现前先运行其 pnpm harness context；production caller、错误/权限/清理负向检查与盘上 artifact 是收口条件。
- 一次只执行本 lane 的一个 ready leaf；保护共享工作树其他 dirty 内容，不 reset/stash/clean、不代其提交。
- 大体积临时日志/fixture/trace 写 D 盘或仓库已忽略目录，任何不可观测结果保持 unmeasured/partial。

- 不变更默认值、产品锁、发布/公开范围或授予 M4
- 不整仓复制 VerseGit，不建立第二 executor/task graph/approval/write journal/registry
- 不以历史 PASS、脚本 fixture 或节点创建代替当前产品验收
