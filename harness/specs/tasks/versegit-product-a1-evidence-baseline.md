---
lifecycleStatus: completed
id: versegit-product-a1-evidence-baseline
title: 重建当前 VG 验证基线并保留历史候选证据
program: versegit-product-integration
taskKey: A1
phase: A
scenario: versegit-validation-layer-extension
taskType: planning
intent: 解决旧源码摘要和绝对执行路径造成的当前复验失败，建立可继续开发的真实基线。
contractIndex: harness/specs/tasks/versegit-product-integration-node-contracts.md
dependsOnTasks:

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
  - harness/specs/tasks/versegit-product-a1-evidence-baseline.md
  - scripts/versegit-product-a1-evidence.mjs
  - scripts/versegit-wp6-closeout.mjs
  - scripts/verify-versegit-wp6.mjs
  - scripts/versegit-wp7-host-vertical.mts
  - scripts/verify-versegit-wp7.mts
  - scripts/verify-versegit-wp8.mjs
  - scripts/versegit-wp9-global-acceptance.mjs
  - scripts/verify-versegit-wp9.mjs
  - tests/unit/versegit*.test.ts
  - tests/unit/versegit-product-a1-evidence.test.ts
  - harness/specs/fixtures/versegit-product-integration/a1/**
  - harness/specs/tasks/versegit-product-integration-node-contracts.md
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
  - harness/specs/tasks/versegit-product-f4-controlled-stability.md
  - harness/specs/tasks/versegit-product-f5-global-acceptance.md
expectedUserBehavior:
  - 解决旧源码摘要和绝对执行路径造成的当前复验失败，建立可继续开发的真实基线。
  - 历史 reviewer verdict、candidate id 与 SHA256SUMS 继续绑定旧候选；当前验证生成新 run/candidate 身份，禁止仅改 hash 继承旧 PASS。
  - 修复当前测试对机器绝对路径和忽略区旧 artifact 的依赖；保持候选、收据、清理、篡改负向检查。
requiredRules:
  - versegit-validation-layer-extension-boundary
  - task-forest-autoclose-and-roles
  - repository-artifact-retention
  - disk-temp-policy
requiredProfiles:

requiredTests:
  - pnpm exec vitest run tests/unit/versegit
  - pnpm harness validate --spec harness/specs/tasks/versegit-product-a1-evidence-baseline.md
acceptance:
  - 新 evidence manifest 绑定当前 source/test/binary/contract 输入并能从盘上重新计算，记录相对执行角色与真实运行身份。
  - 当前声明范围内 VG 测试与 current-candidate verifier 全部通过；历史 verifier 对旧候选可复验或明确报告 historical/stale，禁止弱化断言、跳过失败或重签旧证据。
  - fresh evidence generation、独立复核、输入篡改拒绝及新旧证据对应关系都有独立盘上产物。
docs:
  required: true
  files:
    - harness/specs/tasks/versegit-product-integration-node-contracts.md
---

**A1 · 重建当前 VG 验证基线并保留历史候选证据**

解决旧源码摘要和绝对执行路径造成的当前复验失败，建立可继续开发的真实基线。

本规格为待执行合同。节点创建、静态校验或 dry-run 均不表示功能已实现。依赖与状态以 repo-local Task Forest 为准；本文件定义验收，不维护第二份进度。

这是本 lane 唯一初始 ready 执行任务。开始前刷新当前 HEAD、diff 与依赖，保留旧证据身份。

对应六阶段规划：阶段一：重建当前证据与运行基线。统一权限、模式、证据与收口约束见 [节点合同索引](./versegit-product-integration-node-contracts.md)。

**实施入口**

- scripts/versegit-wp6-closeout.mjs
- scripts/verify-versegit-wp6.mjs
- scripts/versegit-wp7-host-vertical.mts
- scripts/verify-versegit-wp7.mts
- scripts/verify-versegit-wp8.mjs
- scripts/versegit-wp9-global-acceptance.mjs
- scripts/verify-versegit-wp9.mjs
- tests/unit/versegit*.test.ts

实现前运行：

`pnpm harness context --spec harness/specs/tasks/versegit-product-a1-evidence-baseline.md`

新测试/runner 路径是该节点应交付的源文件，尚未生成；开始实现时按实际 seam 缩小 touchedAreas，shared contract/adapter 变更仍须保持兼容。不得把未来 tests 名称的存在当作通过。

**验收执行**

- pnpm exec vitest run tests/unit/versegit
- 当前候选 evidence verifier + 输入摘要篡改负向检查

通信改动运行 comms:replay 与 comms:compare；visible interaction 改动须有同一变更集的真实 Electron E2E。harness run --dry-run 只检查所选 formal profile，不代替 requiredTests 或盘上证据。

**产物与独立复核**

- harness/specs/fixtures/versegit-product-integration/a1/current-input-manifest.json
- harness/specs/fixtures/versegit-product-integration/a1/current-verification.json
- harness/specs/fixtures/versegit-product-integration/a1/historical-evidence-index.json

原始运行进入 ignored artifact run；curated evidence 仅按精确文件加入 retained inventory。报告记录 source commit/tree、candidate/input identity、actor、执行命令/exit/计数、失败与未测项；源码进入同一变更集，历史 Task Forest 与 handoff 留在本地。至少一条根因负向例与实际 production caller 必须复核；缺失、过期、矛盾或只有结构证据不能收口。

**执行提示**

- 先回读上一轮 99/103、WP6/WP7/WP8/WP9 失败与摘要诊断；重新采样当前 HEAD，不把旧计数作为验收通过数。

**共同边界**

- 本目标只推进明确 opt-in 的 Windows 并发开发闭环，保持 defaultOn/liveReady/productApproved 和 M4 原有冻结值。
- 所有操作和 verdict 由脚本或 agent 自动执行，产物标 driven_by: agent 与实际 actor；不新增真人操作/真人数据前置。
- 节点开始实现前先运行其 pnpm harness context；production caller、错误/权限/清理负向检查与盘上 artifact 是收口条件。
- 一次只执行本 lane 的一个 ready leaf；保护共享工作树其他 dirty 内容，不 reset/stash/clean、不代其提交。
- 大体积临时日志/fixture/trace 写 D 盘或仓库已忽略目录，任何不可观测结果保持 unmeasured/partial。

- 不变更默认值、产品锁、发布/公开范围或授予 M4
- 不整仓复制 VerseGit，不建立第二 executor/task graph/approval/write journal/registry
- 不以历史 PASS、脚本 fixture 或节点创建代替当前产品验收
