---
lifecycleStatus: planned
id: versegit-product-d1-feedback-delivery
title: 把 VG 风险经现有工具结果送入 agent 下一次上下文
program: versegit-product-integration
taskKey: D1
phase: D
scenario: gateway-backend-communication
scenarios:
  - versegit-validation-layer-extension
taskType: runtime-bridge
intent: 补齐“报告产生”到“正在工作 agent 确实收到”的接线，保持原工具结果语义。
contractIndex: harness/specs/tasks/versegit-product-integration-node-contracts.md
dependsOnTasks:
  - C2
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
  - harness/specs/tasks/versegit-product-d1-feedback-delivery.md
  - openclaw_runtime/src/agents/embedded-agent-runner/extensions.ts
  - openclaw_runtime/src/agents/harness/tool-result-middleware.ts
  - openclaw_runtime/src/agents/harness/versegit-feedback-delivery.ts
  - openclaw_runtime/src/agents/harness/versegit-feedback-marker.ts
  - openclaw_runtime/src/agents/session-tool-result-guard-wrapper.ts
  - openclaw_runtime/src/plugins/agent-tool-result-middleware-types.ts
  - openclaw_runtime/src/plugin-sdk/versegit-observation-port.ts
  - electron/gateway/versegit-bridge.ts
  - electron/services/versegit-observation.ts
  - shared/versegit-runtime-contract.ts
  - scripts/versegit-feedback-delivery-probe.mts
  - tests/unit/versegit-feedback-delivery.test.ts
  - tests/e2e/versegit-feedback-delivery.spec.ts
  - harness/specs/fixtures/versegit-product-integration/d1/**
  - harness/specs/tasks/versegit-product-integration-node-contracts.md
  - harness/specs/tasks/versegit-product-a1-evidence-baseline.md
  - harness/specs/tasks/versegit-product-a2-runtime-baseline.md
  - harness/specs/tasks/versegit-product-b1-fact-adapter.md
  - harness/specs/tasks/versegit-product-b2-host-diagnostics.md
  - harness/specs/tasks/versegit-product-c1-runtime-bindings.md
  - harness/specs/tasks/versegit-product-c2-observation-basis.md
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
  - 补齐“报告产生”到“正在工作 agent 确实收到”的接线，保持原工具结果语义。
  - 复用 async tool-result middleware / before_prompt_build，对晚到事实进行有界交付；不把 requester completion queue 当作任意 worker 总线。
  - 保留原 content/error/status、scope 与 payload limits；VG 只附加事实，返工由 agent/ClawX 决定。
  - 记录 produced/host-delivered/transcript-confirmed，只有实际下一次模型请求/上下文中存在同一 evidence id 才升级送达等级。
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
  - pnpm exec vitest run tests/unit/versegit-feedback-delivery.test.ts
  - pnpm exec playwright test tests/e2e/versegit-feedback-delivery.spec.ts
  - pnpm contract:check
  - pnpm harness validate --spec harness/specs/tasks/versegit-product-d1-feedback-delivery.md
acceptance:
  - 真实工具结果与 transcript 在下一次调用前含同一风险 evidence id、basis/candidate 身份和 declared coverage；交付位置、时序可回读。
  - 重复反馈只交付一次，跨 owner、旧 epoch、晚到已结束会话、超时与撤销不覆盖新上下文或复制副作用。
  - VG 不可用时工具原结果保持合法可解释；没有为了展示风险新增独立 agent loop/steering bus。
docs:
  required: true
  files:
    - harness/specs/tasks/versegit-product-integration-node-contracts.md
---

**D1 · 把 VG 风险经现有工具结果送入 agent 下一次上下文**

补齐“报告产生”到“正在工作 agent 确实收到”的接线，保持原工具结果语义。

本规格为待执行合同。节点创建、静态校验或 dry-run 均不表示功能已实现。依赖与状态以 repo-local Task Forest 为准；本文件定义验收，不维护第二份进度。

先完成 C2；不得为了当前任务提前实施下游 leaf。

对应六阶段规划：阶段四：让风险进入 agent 上下文并验证作用。统一权限、模式、证据与收口约束见 [节点合同索引](./versegit-product-integration-node-contracts.md)。

**实施入口**

- openclaw_runtime/src/agents/embedded-agent-runner/extensions.ts
- openclaw_runtime/src/agents/harness/tool-result-middleware.ts
- openclaw_runtime/src/agents/session-tool-result-guard-wrapper.ts
- openclaw_runtime/src/plugins/agent-tool-result-middleware-types.ts
- electron/gateway/versegit-bridge.ts
- tests/unit/versegit-feedback-delivery.test.ts
- tests/e2e/versegit-feedback-delivery.spec.ts

实现前运行：

`pnpm harness context --spec harness/specs/tasks/versegit-product-d1-feedback-delivery.md`

新测试/runner 路径是该节点应交付的源文件，尚未生成；开始实现时按实际 seam 缩小 touchedAreas，shared contract/adapter 变更仍须保持兼容。不得把未来 tests 名称的存在当作通过。

**验收执行**

- 真实 runtime transcript 与 model request payload 交付检查
- 工具成功/失败语义守恒与重复反馈负向测试
- pnpm run comms:replay
- pnpm run comms:compare

通信改动运行 comms:replay 与 comms:compare；visible interaction 改动须有同一变更集的真实 Electron E2E。harness run --dry-run 只检查所选 formal profile，不代替 requiredTests 或盘上证据。

**产物与独立复核**

- harness/specs/fixtures/versegit-product-integration/d1/feedback-delivery.json
- harness/specs/fixtures/versegit-product-integration/d1/transcript-index.json
- harness/specs/fixtures/versegit-product-integration/d1/next-call-binding.json

原始运行进入 ignored artifact run；curated evidence 仅按精确文件加入 retained inventory。报告记录 source commit/tree、candidate/input identity、actor、执行命令/exit/计数、失败与未测项；源码进入同一变更集，历史 Task Forest 与 handoff 留在本地。至少一条根因负向例与实际 production caller 必须复核；缺失、过期、矛盾或只有结构证据不能收口。

**执行提示**

- 先验证已有 runner 的 ctx/session identity 如何注入；当前 generic runner 并非自动具有所有 owner 字段。

**共同边界**

- 本目标只推进明确 opt-in 的 Windows 并发开发闭环，保持 defaultOn/liveReady/productApproved 和 M4 原有冻结值。
- 所有操作和 verdict 由脚本或 agent 自动执行，产物标 driven_by: agent 与实际 actor；不新增真人操作/真人数据前置。
- 节点开始实现前先运行其 pnpm harness context；production caller、错误/权限/清理负向检查与盘上 artifact 是收口条件。
- 一次只执行本 lane 的一个 ready leaf；保护共享工作树其他 dirty 内容，不 reset/stash/clean、不代其提交。
- 大体积临时日志/fixture/trace 写 D 盘或仓库已忽略目录，任何不可观测结果保持 unmeasured/partial。

- 不变更默认值、产品锁、发布/公开范围或授予 M4
- 不整仓复制 VerseGit，不建立第二 executor/task graph/approval/write journal/registry
- 不以历史 PASS、脚本 fixture 或节点创建代替当前产品验收
