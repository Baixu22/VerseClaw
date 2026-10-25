---
lifecycleStatus: completed
id: versegit-product-e3-host-apply
title: 把验证前置到写回入口并拒绝目标或授权漂移
program: versegit-product-integration
taskKey: E3
phase: E
scenario: gateway-backend-communication
scenarios:
  - versegit-validation-layer-extension
taskType: runtime-bridge
intent: 修正当前 worker completion→merge→verifier 的顺序，只有宿主许可的同一已验证候选才能写回。
contractIndex: harness/specs/tasks/versegit-product-integration-node-contracts.md
dependsOnTasks:
  - E2
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
  - scripts/versegit-product-e1-evidence.mts
  - scripts/verify-versegit-product-e1-evidence.mts
  - electron/gateway/versegit-bridge.ts
  - electron/main/ipc-handlers.ts
  - electron/services/versegit-api.ts
  - electron/services/versegit-fact-adapter.ts
  - electron/services/versegit-module.ts
  - electron/services/versegit-observation.ts
  - harness/specs/fixtures/versegit-product-integration/a1/SHA256SUMS
  - harness/specs/fixtures/versegit-product-integration/a1/current-input-manifest.json
  - harness/specs/fixtures/versegit-product-integration/a1/current-verification.json
  - harness/specs/fixtures/versegit-product-integration/a1/historical-evidence-index.json
  - harness/specs/fixtures/versegit-product-integration/a1/independent-review.json
  - harness/specs/fixtures/versegit-product-integration/a1/negative-checks.json
  - harness/specs/fixtures/versegit-product-integration/a2/SHA256SUMS
  - harness/specs/fixtures/versegit-product-integration/a2/build-identity.json
  - harness/specs/fixtures/versegit-product-integration/a2/cleanup.json
  - harness/specs/fixtures/versegit-product-integration/a2/electron-startup.json
  - harness/specs/fixtures/versegit-product-integration/a2/independent-review.json
  - harness/specs/fixtures/versegit-product-integration/a2/negative-checks.json
  - harness/specs/fixtures/versegit-product-integration/a2/smoke-results.json
  - harness/specs/fixtures/versegit-product-integration/b1/SHA256SUMS
  - harness/specs/fixtures/versegit-product-integration/b1/adapter-differential.json
  - harness/specs/fixtures/versegit-product-integration/b1/authority-negative.json
  - harness/specs/fixtures/versegit-product-integration/b1/independent-review.json
  - harness/specs/fixtures/versegit-product-integration/b1/mode-effect-matrix.json
  - harness/specs/fixtures/versegit-product-integration/b2/SHA256SUMS
  - harness/specs/fixtures/versegit-product-integration/b2/diagnostic-contract.json
  - harness/specs/fixtures/versegit-product-integration/b2/host-invoke.json
  - harness/specs/fixtures/versegit-product-integration/b2/independent-review.json
  - harness/specs/fixtures/versegit-product-integration/b2/negative-host-requests.json
  - harness/specs/fixtures/versegit-product-integration/c1/SHA256SUMS
  - harness/specs/fixtures/versegit-product-integration/c1/binding-negative.json
  - harness/specs/fixtures/versegit-product-integration/c1/bridge-events.jsonl
  - harness/specs/fixtures/versegit-product-integration/c1/independent-review.json
  - harness/specs/fixtures/versegit-product-integration/c1/runtime-bindings.json
  - harness/specs/fixtures/versegit-product-integration/c2/SHA256SUMS
  - harness/specs/fixtures/versegit-product-integration/c2/basis-race-cases.json
  - harness/specs/fixtures/versegit-product-integration/c2/coverage.json
  - harness/specs/fixtures/versegit-product-integration/c2/independent-review.json
  - harness/specs/fixtures/versegit-product-integration/c2/observation-links.json
  - harness/specs/fixtures/versegit-product-integration/d1/SHA256SUMS
  - harness/specs/fixtures/versegit-product-integration/d1/feedback-delivery.json
  - harness/specs/fixtures/versegit-product-integration/d1/independent-review.json
  - harness/specs/fixtures/versegit-product-integration/d1/next-call-binding.json
  - harness/specs/fixtures/versegit-product-integration/d1/transcript-index.json
  - harness/specs/fixtures/versegit-product-integration/d2/SHA256SUMS
  - harness/specs/fixtures/versegit-product-integration/d2/behavior-evidence.json
  - harness/specs/fixtures/versegit-product-integration/d2/independent-review.json
  - harness/specs/fixtures/versegit-product-integration/d2/paired-input-manifest.json
  - harness/specs/fixtures/versegit-product-integration/d2/paired-results.json
  - harness/specs/tasks/versegit-product-a1-evidence-baseline.md
  - harness/specs/tasks/versegit-product-a2-runtime-baseline.md
  - harness/specs/tasks/versegit-product-b1-fact-adapter.md
  - harness/specs/tasks/versegit-product-b2-host-diagnostics.md
  - harness/specs/tasks/versegit-product-c1-runtime-bindings.md
  - harness/specs/tasks/versegit-product-c2-observation-basis.md
  - harness/specs/tasks/versegit-product-d1-feedback-delivery.md
  - harness/specs/tasks/versegit-product-d2-paired-agent-evaluation.md
  - openclaw_runtime/src/agents/embedded-agent-runner/extensions.ts
  - openclaw_runtime/src/agents/harness/versegit-feedback-delivery.ts
  - openclaw_runtime/src/agents/harness/versegit-feedback-marker.ts
  - openclaw_runtime/src/agents/harness/versegit-tool-observation.ts
  - openclaw_runtime/src/agents/orchestrator-run-observed.ts
  - openclaw_runtime/src/agents/session-tool-result-guard-wrapper.ts
  - openclaw_runtime/src/agents/sessions/tools/edit.ts
  - openclaw_runtime/src/agents/sessions/tools/read.test.ts
  - openclaw_runtime/src/agents/sessions/tools/read.ts
  - openclaw_runtime/src/agents/sessions/tools/tool-contracts.ts
  - openclaw_runtime/src/agents/sessions/tools/versegit-tool-basis.ts
  - openclaw_runtime/src/agents/sessions/tools/write.ts
  - openclaw_runtime/src/agents/subagent-registry.ts
  - openclaw_runtime/src/plugin-sdk/versegit-binding-port.ts
  - openclaw_runtime/src/plugin-sdk/versegit-binding-registry.ts
  - openclaw_runtime/src/plugin-sdk/versegit-observation-port.ts
  - scripts/verify-versegit-product-c1-evidence.mts
  - scripts/verify-versegit-product-c2-evidence.mts
  - scripts/verify-versegit-product-d1-evidence.mts
  - scripts/verify-versegit-product-d2-evidence.mts
  - scripts/versegit-feedback-delivery-probe.mts
  - scripts/versegit-product-a1-evidence.d.mts
  - scripts/versegit-product-a1-evidence.mjs
  - scripts/versegit-product-a2-evidence.d.mts
  - scripts/versegit-product-a2-evidence.mjs
  - scripts/versegit-product-b1-evidence.mts
  - scripts/versegit-product-b2-evidence.mts
  - scripts/versegit-product-c1-evidence.mts
  - scripts/versegit-product-c2-evidence.mts
  - scripts/versegit-product-d1-evidence.mts
  - scripts/versegit-product-d2-evidence.mts
  - scripts/versegit-product-paired-evaluation.mts
  - scripts/versegit-runtime-bindings-probe.mts
  - shared/host-api/contract.ts
  - shared/versegit-runtime-contract.ts
  - src/lib/host-api.ts
  - tests/e2e/app-smoke.spec.ts
  - tests/e2e/versegit-diagnostics.spec.ts
  - tests/e2e/versegit-feedback-delivery.spec.ts
  - tests/e2e/versegit-feedback-paired.spec.ts
  - tests/e2e/versegit-runtime-bindings.spec.ts
  - tests/unit/versegit-fact-adapter.test.ts
  - tests/unit/versegit-feedback-delivery.test.ts
  - tests/unit/versegit-host-api.test.ts
  - tests/unit/versegit-observation-basis.test.ts
  - tests/unit/versegit-paired-evaluation.test.ts
  - tests/unit/versegit-product-a1-evidence.test.ts
  - tests/unit/versegit-product-a2-evidence.test.ts
  - tests/unit/versegit-runtime-bindings.test.ts
  - tests/unit/versegit-wp6-closeout.test.ts
  - tests/unit/versegit-wp8-review.test.ts
  - tests/unit/versegit-wp9-global-acceptance.test.ts
  - openclaw_runtime/src/agents/orchestration-candidate.ts
  - openclaw_runtime/src/agents/orchestration-worktree-merge.ts
  - openclaw_runtime/src/agents/worktree-service.ts
  - tests/unit/versegit-candidate-freeze.test.ts
  - harness/specs/fixtures/versegit-product-integration/e1/SHA256SUMS
  - harness/specs/fixtures/versegit-product-integration/e1/candidate-manifest.json
  - harness/specs/fixtures/versegit-product-integration/e1/candidate-negative.json
  - harness/specs/fixtures/versegit-product-integration/e1/independent-review.json
  - harness/specs/fixtures/versegit-product-integration/e1/target-before-after.json
  - scripts/versegit-product-e2-evidence.mts
  - scripts/verify-versegit-product-e2-evidence.mts
  - openclaw_runtime/src/agents/patch-flow.ts
  - openclaw_runtime/src/agents/orchestration-candidate-apply.ts
  - openclaw_runtime/src/agents/subagent-registry.types.ts
  - electron/services/versegit-receipt-evidence.ts
  - scripts/versegit-candidate-apply-probe.mts
  - scripts/versegit-product-e3-evidence.mts
  - scripts/verify-versegit-product-e3-evidence.mts
  - tests/unit/versegit-host-apply.test.ts
  - tests/e2e/versegit-candidate-apply.spec.ts
  - openclaw_runtime/src/agents/verseshell/governed-process.ts
  - shared/types/versegit.ts
  - tests/unit/versegit-candidate-receipts.test.ts
  - harness/specs/fixtures/versegit-product-integration/e2/SHA256SUMS
  - harness/specs/fixtures/versegit-product-integration/e2/execution-cleanup.json
  - harness/specs/fixtures/versegit-product-integration/e2/execution-receipts.json
  - harness/specs/fixtures/versegit-product-integration/e2/independent-review.json
  - harness/specs/fixtures/versegit-product-integration/e2/plans.json
  - harness/specs/fixtures/versegit-product-integration/e2/receipt-negative.json
touchedAreas:
  - harness/specs/tasks/versegit-product-e3-host-apply.md
  - openclaw_runtime/src/agents/subagent-registry.ts
  - openclaw_runtime/src/agents/orchestration-worktree-merge.ts
  - openclaw_runtime/src/agents/worktree-service.ts
  - openclaw_runtime/src/agents/orchestration-patch-flow.ts
  - shared/permission-effect-contract.ts
  - tests/unit/versegit-host-apply.test.ts
  - tests/e2e/versegit-candidate-apply.spec.ts
  - harness/specs/fixtures/versegit-product-integration/e3/**
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
  - harness/specs/tasks/versegit-product-f1-completion-contract.md
  - harness/specs/tasks/versegit-product-f2-cleanup-barrier.md
  - harness/specs/tasks/versegit-product-f3-sidecar-delivery.md
  - harness/specs/tasks/versegit-product-f4-controlled-stability.md
  - harness/specs/tasks/versegit-product-f5-global-acceptance.md
expectedUserBehavior:
  - 修正当前 worker completion→merge→verifier 的顺序，只有宿主许可的同一已验证候选才能写回。
  - 仅在明确 opt-in 并发流程中改为 completion→candidate freeze→verify→host apply；现有 task/approval/write journal 与 Git owner 不变。
  - 写回前复核当前 base/target/input/owner/epoch/grant/revocation 和 receipt；任一漂移旧验证失效并要求重组/重验。
  - 复用现有最终 permission/effect checkpoint 与 mutation journal；VG 不调用 land/admit，不拥有 ref CAS 或审批裁决。
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
  - pnpm exec vitest run tests/unit/versegit-host-apply.test.ts
  - pnpm exec playwright test tests/e2e/versegit-candidate-apply.spec.ts
  - pnpm contract:check
  - pnpm harness validate --spec harness/specs/tasks/versegit-product-e3-host-apply.md
acceptance:
  - 真实两个 worker 各自通过而组合失败时主工作区/ref 零写回；同一成功候选只有宿主 permit 后可写回。
  - 验证后 base、目标未提交内容、candidate、epoch 或撤销变化均在副作用前拒绝；故障/未知 delivery 不自动重试 apply。
  - write journal/结果持久化/恢复与既有共享编码路径保持兼容；真实 runtime 的顺序 trace 显示验证确实早于首次写入。
docs:
  required: true
  files:
    - harness/specs/tasks/versegit-product-integration-node-contracts.md
---

**E3 · 把验证前置到写回入口并拒绝目标或授权漂移**

修正当前 worker completion→merge→verifier 的顺序，只有宿主许可的同一已验证候选才能写回。

本规格为待执行合同。节点创建、静态校验或 dry-run 均不表示功能已实现。依赖与状态以 repo-local Task Forest 为准；本文件定义验收，不维护第二份进度。

先完成 E2；不得为了当前任务提前实施下游 leaf。

对应六阶段规划：阶段五：验证组合候选后再由宿主写回。统一权限、模式、证据与收口约束见 [节点合同索引](./versegit-product-integration-node-contracts.md)。

**实施入口**

- openclaw_runtime/src/agents/subagent-registry.ts
- openclaw_runtime/src/agents/orchestration-worktree-merge.ts
- openclaw_runtime/src/agents/worktree-service.ts
- openclaw_runtime/src/agents/orchestration-patch-flow.ts
- shared/permission-effect-contract.ts
- tests/unit/versegit-host-apply.test.ts
- tests/e2e/versegit-candidate-apply.spec.ts

实现前运行：

`pnpm harness context --spec harness/specs/tasks/versegit-product-e3-host-apply.md`

新测试/runner 路径是该节点应交付的源文件，尚未生成；开始实现时按实际 seam 缩小 touchedAreas，shared contract/adapter 变更仍须保持兼容。不得把未来 tests 名称的存在当作通过。

**验收执行**

- 真实 runtime completion/verify/apply E2E
- 权限撤销与 TOCTOU 负向 tests
- 现有 worktree/patch-flow/journal 回归
- pnpm run comms:replay
- pnpm run comms:compare

通信改动运行 comms:replay 与 comms:compare；visible interaction 改动须有同一变更集的真实 Electron E2E。harness run --dry-run 只检查所选 formal profile，不代替 requiredTests 或盘上证据。

**产物与独立复核**

- harness/specs/fixtures/versegit-product-integration/e3/apply-decision.json
- harness/specs/fixtures/versegit-product-integration/e3/ordering-trace.json
- harness/specs/fixtures/versegit-product-integration/e3/toctou-negative.json
- harness/specs/fixtures/versegit-product-integration/e3/write-journal-index.json

原始运行进入 ignored artifact run；curated evidence 仅按精确文件加入 retained inventory。报告记录 source commit/tree、candidate/input identity、actor、执行命令/exit/计数、失败与未测项；源码进入同一变更集，历史 Task Forest 与 handoff 留在本地。至少一条根因负向例与实际 production caller 必须复核；缺失、过期、矛盾或只有结构证据不能收口。

**执行提示**

- Git expected-old OID 只保护 ref 更新，不能替代用户工作区内容或权限检查；不得简单保留逐文件 cpSync 后宣称已验证写回。

**共同边界**

- 本目标只推进明确 opt-in 的 Windows 并发开发闭环，保持 defaultOn/liveReady/productApproved 和 M4 原有冻结值。
- 所有操作和 verdict 由脚本或 agent 自动执行，产物标 driven_by: agent 与实际 actor；不新增真人操作/真人数据前置。
- 节点开始实现前先运行其 pnpm harness context；production caller、错误/权限/清理负向检查与盘上 artifact 是收口条件。
- 一次只执行本 lane 的一个 ready leaf；保护共享工作树其他 dirty 内容，不 reset/stash/clean、不代其提交。
- 大体积临时日志/fixture/trace 写 D 盘或仓库已忽略目录，任何不可观测结果保持 unmeasured/partial。

- 不变更默认值、产品锁、发布/公开范围或授予 M4
- 不整仓复制 VerseGit，不建立第二 executor/task graph/approval/write journal/registry
- 不以历史 PASS、脚本 fixture 或节点创建代替当前产品验收
