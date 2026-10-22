---
lifecycleStatus: planned
id: versegit-product-f1-completion-contract
title: 持久化宿主完成事实并校正 VG 会话终态语义
program: versegit-product-integration
taskKey: F1
phase: F
scenario: gateway-backend-communication
scenarios:
  - versegit-validation-layer-extension
taskType: runtime-bridge
intent: 在真实持久仓库里区分完成、取消和废弃，避免把 provider abandoned 伪称成功落地。
contractIndex: harness/specs/tasks/versegit-product-integration-node-contracts.md
dependsOnTasks:
  - E3
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
  - scripts/versegit-product-f1-evidence.mts
  - scripts/verify-versegit-product-f1-evidence.mts
touchedAreas:
  - harness/specs/tasks/versegit-product-f1-completion-contract.md
  - shared/types/versegit.ts
  - electron/services/versegit-lifecycle.ts
  - electron/services/versegit-api.ts
  - openclaw_runtime/src/agents/subagent-registry.ts
  - tests/unit/versegit-completion-lifecycle.test.ts
  - harness/specs/fixtures/versegit-product-integration/f1/**
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
  - harness/specs/tasks/versegit-product-f2-cleanup-barrier.md
  - harness/specs/tasks/versegit-product-f3-sidecar-delivery.md
  - harness/specs/tasks/versegit-product-f4-controlled-stability.md
  - harness/specs/tasks/versegit-product-f5-global-acceptance.md
expectedUserBehavior:
  - 在真实持久仓库里区分完成、取消和废弃，避免把 provider abandoned 伪称成功落地。
  - provider session end 只代表 abandoned/non-landed；不能把 host 成功整合一律 end 后声称 provider landed。
  - 优先 host-owned versioned completion fact 与公开 provider contract；若需 provider 改动，独立最小 seam 与 differential，不能赋予 M4。
  - outcome 与 exact candidate/effect identity 持久化，崩溃后 unknown/lost/recovery_required 不能隐式变成功。
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
  - pnpm exec vitest run tests/unit/versegit-completion-lifecycle.test.ts
  - pnpm contract:check
  - pnpm harness validate --spec harness/specs/tasks/versegit-product-f1-completion-contract.md
acceptance:
  - host applied/not-applied/unknown 与 provider active/abandoned/host-completed 映射有版本契约且准确，成功/cancel/failure 分别可回读。
  - restart、重复完成、late epoch 与未确认 apply 不重复落地，不污染活跃 session 风险投影。
  - 旧会话与 schema backward compatibility 实跑；未调用 VG land/admit 或修改冻结 owner/default。
docs:
  required: true
  files:
    - harness/specs/tasks/versegit-product-integration-node-contracts.md
---

**F1 · 持久化宿主完成事实并校正 VG 会话终态语义**

在真实持久仓库里区分完成、取消和废弃，避免把 provider abandoned 伪称成功落地。

本规格为待执行合同。节点创建、静态校验或 dry-run 均不表示功能已实现。依赖与状态以 repo-local Task Forest 为准；本文件定义验收，不维护第二份进度。

先完成 E3；不得为了当前任务提前实施下游 leaf。

对应六阶段规划：阶段六：完成持久生命周期、交付与最终验收。统一权限、模式、证据与收口约束见 [节点合同索引](./versegit-product-integration-node-contracts.md)。

**实施入口**

- shared/types/versegit.ts
- electron/services/versegit-lifecycle.ts
- electron/services/versegit-api.ts
- openclaw_runtime/src/agents/subagent-registry.ts
- tests/unit/versegit-completion-lifecycle.test.ts

实现前运行：

`pnpm harness context --spec harness/specs/tasks/versegit-product-f1-completion-contract.md`

新测试/runner 路径是该节点应交付的源文件，尚未生成；开始实现时按实际 seam 缩小 touchedAreas，shared contract/adapter 变更仍须保持兼容。不得把未来 tests 名称的存在当作通过。

**验收执行**

- 成功/取消/崩溃/restart lifecycle 对拍
- 版本与 duplicate completion 负向 tests
- 公开 provider contract 差异检查

通信改动运行 comms:replay 与 comms:compare；visible interaction 改动须有同一变更集的真实 Electron E2E。harness run --dry-run 只检查所选 formal profile，不代替 requiredTests 或盘上证据。

**产物与独立复核**

- harness/specs/fixtures/versegit-product-integration/f1/completion-contract.json
- harness/specs/fixtures/versegit-product-integration/f1/persisted-outcomes.json
- harness/specs/fixtures/versegit-product-integration/f1/restart-lifecycle.json

原始运行进入 ignored artifact run；curated evidence 仅按精确文件加入 retained inventory。报告记录 source commit/tree、candidate/input identity、actor、执行命令/exit/计数、失败与未测项；源码进入同一变更集，历史 Task Forest 与 handoff 留在本地。至少一条根因负向例与实际 production caller 必须复核；缺失、过期、矛盾或只有结构证据不能收口。

**执行提示**

- 阅读 provider crates/vg-cli session end 与 vg-schema SessionEnded 语义；选择的 host completion seam 先在本节点spec登记。

**共同边界**

- 本目标只推进明确 opt-in 的 Windows 并发开发闭环，保持 defaultOn/liveReady/productApproved 和 M4 原有冻结值。
- 所有操作和 verdict 由脚本或 agent 自动执行，产物标 driven_by: agent 与实际 actor；不新增真人操作/真人数据前置。
- 节点开始实现前先运行其 pnpm harness context；production caller、错误/权限/清理负向检查与盘上 artifact 是收口条件。
- 一次只执行本 lane 的一个 ready leaf；保护共享工作树其他 dirty 内容，不 reset/stash/clean、不代其提交。
- 大体积临时日志/fixture/trace 写 D 盘或仓库已忽略目录，任何不可观测结果保持 unmeasured/partial。

- 不变更默认值、产品锁、发布/公开范围或授予 M4
- 不整仓复制 VerseGit，不建立第二 executor/task graph/approval/write journal/registry
- 不以历史 PASS、脚本 fixture 或节点创建代替当前产品验收
