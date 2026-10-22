---
lifecycleStatus: planned
id: versegit-product-d2-paired-agent-evaluation
title: 用配对自动化任务验证风险反馈与重读返工行为
program: versegit-product-integration
taskKey: D2
phase: D
scenario: versegit-validation-layer-extension
taskType: planning
intent: 用同一因果场景衡量 VG 是否改变错误的组合行为，区分反馈送达和真实收益。
contractIndex: harness/specs/tasks/versegit-product-integration-node-contracts.md
dependsOnTasks:
  - D1
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
  - scripts/versegit-product-d2-evidence.mts
  - scripts/verify-versegit-product-d2-evidence.mts
touchedAreas:
  - harness/specs/tasks/versegit-product-d2-paired-agent-evaluation.md
  - scripts/versegit-product-paired-evaluation.mts
  - tests/e2e/versegit-feedback-paired.spec.ts
  - tests/unit/versegit-paired-evaluation.test.ts
  - harness/specs/fixtures/versegit-product-integration/d2/**
  - harness/specs/tasks/versegit-product-integration-node-contracts.md
  - harness/specs/tasks/versegit-product-a1-evidence-baseline.md
  - harness/specs/tasks/versegit-product-a2-runtime-baseline.md
  - harness/specs/tasks/versegit-product-b1-fact-adapter.md
  - harness/specs/tasks/versegit-product-b2-host-diagnostics.md
  - harness/specs/tasks/versegit-product-c1-runtime-bindings.md
  - harness/specs/tasks/versegit-product-c2-observation-basis.md
  - harness/specs/tasks/versegit-product-d1-feedback-delivery.md
  - harness/specs/tasks/versegit-product-e1-candidate-freeze.md
  - harness/specs/tasks/versegit-product-e2-receipt-verification.md
  - harness/specs/tasks/versegit-product-e3-host-apply.md
  - harness/specs/tasks/versegit-product-f1-completion-contract.md
  - harness/specs/tasks/versegit-product-f2-cleanup-barrier.md
  - harness/specs/tasks/versegit-product-f3-sidecar-delivery.md
  - harness/specs/tasks/versegit-product-f4-controlled-stability.md
  - harness/specs/tasks/versegit-product-f5-global-acceptance.md
expectedUserBehavior:
  - 用同一因果场景衡量 VG 是否改变错误的组合行为，区分反馈送达和真实收益。
  - 使用相同初始仓库、任务、版本依据和约束配对 VG off/on，选择已支持语言；操作和 verdict 一律脚本或 agent 驱动。
  - 优先复用已有可用 agent runner/端点；模拟 agent 与实际模型运行分别标注，成本不虚构，不要求真人操作或真人数据。
  - 不以 .cjs 宿主反例声明 VG 全语言覆盖；不以 transcript presence 声称 behavior-shift。
requiredRules:
  - versegit-validation-layer-extension-boundary
  - task-forest-autoclose-and-roles
  - repository-artifact-retention
  - disk-temp-policy
requiredProfiles:

requiredTests:
  - pnpm exec vitest run tests/unit/versegit-paired-evaluation.test.ts
  - pnpm exec playwright test tests/e2e/versegit-feedback-paired.spec.ts
  - pnpm harness validate --spec harness/specs/tasks/versegit-product-d2-paired-agent-evaluation.md
acceptance:
  - 至少一组可复跑的正例和一组无关改动负例，盘上记录 VG off/on 的观察、实际交付、agent 重读/重验/返工与组合结果。
  - 错误旧依据被纠正且未增加跨 owner 误报，或如实记录无收益/未测而不能宣称该业务路径成熟。
  - 实验报告包含 actor、模拟与实际执行类别、输入 hashes、试次数、成功/失败与不可测界限，配对因果可回读。
docs:
  required: true
  files:
    - harness/specs/tasks/versegit-product-integration-node-contracts.md
---

**D2 · 用配对自动化任务验证风险反馈与重读返工行为**

用同一因果场景衡量 VG 是否改变错误的组合行为，区分反馈送达和真实收益。

本规格为待执行合同。节点创建、静态校验或 dry-run 均不表示功能已实现。依赖与状态以 repo-local Task Forest 为准；本文件定义验收，不维护第二份进度。

先完成 D1；不得为了当前任务提前实施下游 leaf。

对应六阶段规划：阶段四：让风险进入 agent 上下文并验证作用。统一权限、模式、证据与收口约束见 [节点合同索引](./versegit-product-integration-node-contracts.md)。

**实施入口**

- scripts/versegit-product-paired-evaluation.mts
- tests/e2e/versegit-feedback-paired.spec.ts
- tests/unit/versegit-paired-evaluation.test.ts

实现前运行：

`pnpm harness context --spec harness/specs/tasks/versegit-product-d2-paired-agent-evaluation.md`

新测试/runner 路径是该节点应交付的源文件，尚未生成；开始实现时按实际 seam 缩小 touchedAreas，shared contract/adapter 变更仍须保持兼容。不得把未来 tests 名称的存在当作通过。

**验收执行**

- 配对 agent 自动任务 runner
- 正/负例输入一致性与 transcript 对拍
- 重复运行的稳定 normalized outcome 检查

通信改动运行 comms:replay 与 comms:compare；visible interaction 改动须有同一变更集的真实 Electron E2E。harness run --dry-run 只检查所选 formal profile，不代替 requiredTests 或盘上证据。

**产物与独立复核**

- harness/specs/fixtures/versegit-product-integration/d2/paired-input-manifest.json
- harness/specs/fixtures/versegit-product-integration/d2/paired-results.json
- harness/specs/fixtures/versegit-product-integration/d2/behavior-evidence.json

原始运行进入 ignored artifact run；curated evidence 仅按精确文件加入 retained inventory。报告记录 source commit/tree、candidate/input identity、actor、执行命令/exit/计数、失败与未测项；源码进入同一变更集，历史 Task Forest 与 handoff 留在本地。至少一条根因负向例与实际 production caller 必须复核；缺失、过期、矛盾或只有结构证据不能收口。

**执行提示**

- 真实模型凭据/端点只在确有资源缺口时向所有者索取一次；既有授权资源直接自动化，不新增真人等待项。

**共同边界**

- 本目标只推进明确 opt-in 的 Windows 并发开发闭环，保持 defaultOn/liveReady/productApproved 和 M4 原有冻结值。
- 所有操作和 verdict 由脚本或 agent 自动执行，产物标 driven_by: agent 与实际 actor；不新增真人操作/真人数据前置。
- 节点开始实现前先运行其 pnpm harness context；production caller、错误/权限/清理负向检查与盘上 artifact 是收口条件。
- 一次只执行本 lane 的一个 ready leaf；保护共享工作树其他 dirty 内容，不 reset/stash/clean、不代其提交。
- 大体积临时日志/fixture/trace 写 D 盘或仓库已忽略目录，任何不可观测结果保持 unmeasured/partial。

- 不变更默认值、产品锁、发布/公开范围或授予 M4
- 不整仓复制 VerseGit，不建立第二 executor/task graph/approval/write journal/registry
- 不以历史 PASS、脚本 fixture 或节点创建代替当前产品验收
