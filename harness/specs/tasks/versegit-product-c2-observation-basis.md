---
lifecycleStatus: completed
id: versegit-product-c2-observation-basis
title: 在实际工具边界记录读写范围与读取时的版本依据
program: versegit-product-integration
taskKey: C2
phase: C
scenario: gateway-backend-communication
scenarios:
  - versegit-validation-layer-extension
taskType: runtime-bridge
intent: 把无法反推路径的摘要事件升级为可验证的最小实时 observation，让 stale-read 分析基于真实读取。
contractIndex: harness/specs/tasks/versegit-product-integration-node-contracts.md
dependsOnTasks:
  - C1
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
  - scripts/versegit-product-c2-evidence.mts
  - scripts/verify-versegit-product-c2-evidence.mts
  - electron/main/ipc-handlers.ts
  - electron/services/versegit-api.ts
  - electron/services/versegit-module.ts
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
  - harness/specs/tasks/versegit-product-a1-evidence-baseline.md
  - harness/specs/tasks/versegit-product-a2-runtime-baseline.md
  - harness/specs/tasks/versegit-product-b1-fact-adapter.md
  - harness/specs/tasks/versegit-product-b2-host-diagnostics.md
  - harness/specs/tasks/versegit-product-c1-runtime-bindings.md
  - openclaw_runtime/src/agents/orchestrator-run-observed.ts
  - openclaw_runtime/src/agents/subagent-registry.ts
  - openclaw_runtime/src/plugin-sdk/versegit-binding-port.ts
  - openclaw_runtime/src/plugin-sdk/versegit-binding-registry.ts
  - scripts/verify-versegit-product-c1-evidence.mts
  - scripts/versegit-product-a1-evidence.d.mts
  - scripts/versegit-product-a1-evidence.mjs
  - scripts/versegit-product-a2-evidence.d.mts
  - scripts/versegit-product-a2-evidence.mjs
  - scripts/versegit-product-b1-evidence.mts
  - scripts/versegit-product-b2-evidence.mts
  - scripts/versegit-product-c1-evidence.mts
  - scripts/versegit-runtime-bindings-probe.mts
  - shared/host-api/contract.ts
  - src/lib/host-api.ts
  - tests/e2e/app-smoke.spec.ts
  - tests/e2e/versegit-diagnostics.spec.ts
  - tests/e2e/versegit-runtime-bindings.spec.ts
  - tests/unit/versegit-fact-adapter.test.ts
  - tests/unit/versegit-host-api.test.ts
  - tests/unit/versegit-product-a1-evidence.test.ts
  - tests/unit/versegit-product-a2-evidence.test.ts
  - tests/unit/versegit-runtime-bindings.test.ts
  - tests/unit/versegit-wp6-closeout.test.ts
  - tests/unit/versegit-wp8-review.test.ts
  - tests/unit/versegit-wp9-global-acceptance.test.ts
touchedAreas:
  - harness/specs/tasks/versegit-product-c2-observation-basis.md
  - electron/services/versegit-observation.ts
  - electron/services/versegit-fact-adapter.ts
  - electron/gateway/versegit-bridge.ts
  - shared/versegit-runtime-contract.ts
  - openclaw_runtime/src/agents/harness/tool-result-middleware.ts
  - openclaw_runtime/src/agents/harness/versegit-tool-observation.ts
  - openclaw_runtime/src/plugin-sdk/versegit-observation-port.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/extensions.ts
  - openclaw_runtime/src/agents/sessions/tools/**
  - tests/unit/versegit-observation-basis.test.ts
  - openclaw_runtime/src/agents/sessions/tools/read.test.ts
  - harness/specs/fixtures/versegit-product-integration/c2/**
  - harness/specs/tasks/versegit-product-integration-node-contracts.md
  - harness/specs/tasks/versegit-product-a1-evidence-baseline.md
  - harness/specs/tasks/versegit-product-a2-runtime-baseline.md
  - harness/specs/tasks/versegit-product-b1-fact-adapter.md
  - harness/specs/tasks/versegit-product-b2-host-diagnostics.md
  - harness/specs/tasks/versegit-product-c1-runtime-bindings.md
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
  - 把无法反推路径的摘要事件升级为可验证的最小实时 observation，让 stale-read 分析基于真实读取。
  - 保留最小规范化相对路径、实际读行范围、读取时 base/input identity 与工具完成状态；长日志仍只存脱敏摘要。
  - 必要观察按 repo/session 有界序列化；provider 后读文件已变时不能把旧读取伪记成新依据，无法证明则 explicit partial/stale。
  - Bash/direct-fs/任意 MCP/network 未观测面保持 declared unobserved，失败工具不冒充成功写入。
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
  - pnpm exec vitest run tests/unit/versegit-observation-basis.test.ts
  - pnpm contract:check
  - pnpm harness validate --spec harness/specs/tasks/versegit-product-c2-observation-basis.md
acceptance:
  - 已支持语言的 producer-consumer stale-read/API drift 正例准确触发；own-write 与无关文件负例不误关联。
  - 工具参数→normalized event→provider fact 的 identity/digest 与 path/range 可从盘上逐步重算；不靠 inputDigest 反推明文。
  - duplicate/late/old epoch/wrong owner/read-then-file-change/bounded queue/drop/cancel 均有可运行负向例与 coverage 记录。
docs:
  required: true
  files:
    - harness/specs/tasks/versegit-product-integration-node-contracts.md
---

**C2 · 在实际工具边界记录读写范围与读取时的版本依据**

把无法反推路径的摘要事件升级为可验证的最小实时 observation，让 stale-read 分析基于真实读取。

本规格为待执行合同。节点创建、静态校验或 dry-run 均不表示功能已实现。依赖与状态以 repo-local Task Forest 为准；本文件定义验收，不维护第二份进度。

先完成 C1；不得为了当前任务提前实施下游 leaf。

对应六阶段规划：阶段三：绑定运行时会话并记录实际读写依据。统一权限、模式、证据与收口约束见 [节点合同索引](./versegit-product-integration-node-contracts.md)。

**实施入口**

- electron/services/versegit-observation.ts
- electron/services/versegit-fact-adapter.ts
- shared/versegit-runtime-contract.ts
- openclaw_runtime/src/agents/harness/tool-result-middleware.ts
- openclaw_runtime/src/agents/embedded-agent-runner/extensions.ts
- openclaw_runtime/src/agents/sessions/tools/**
- tests/unit/versegit-observation-basis.test.ts

实现前运行：

`pnpm harness context --spec harness/specs/tasks/versegit-product-c2-observation-basis.md`

新测试/runner 路径是该节点应交付的源文件，尚未生成；开始实现时按实际 seam 缩小 touchedAreas，shared contract/adapter 变更仍须保持兼容。不得把未来 tests 名称的存在当作通过。

**验收执行**

- 工具输入到 provider 的真实投影检查
- read basis race / dedupe / owner 负向测试
- pnpm run comms:replay
- pnpm run comms:compare

通信改动运行 comms:replay 与 comms:compare；visible interaction 改动须有同一变更集的真实 Electron E2E。harness run --dry-run 只检查所选 formal profile，不代替 requiredTests 或盘上证据。

**产物与独立复核**

- harness/specs/fixtures/versegit-product-integration/c2/observation-links.json
- harness/specs/fixtures/versegit-product-integration/c2/basis-race-cases.json
- harness/specs/fixtures/versegit-product-integration/c2/coverage.json

原始运行进入 ignored artifact run；curated evidence 仅按精确文件加入 retained inventory。报告记录 source commit/tree、candidate/input identity、actor、执行命令/exit/计数、失败与未测项；源码进入同一变更集，历史 Task Forest 与 handoff 留在本地。至少一条根因负向例与实际 production caller 必须复核；缺失、过期、矛盾或只有结构证据不能收口。

**执行提示**

- 复用已有 tool result middleware 持有的 input/result/cwd；不要靠 Main 的 renderer 事件回传路径。

**共同边界**

- 本目标只推进明确 opt-in 的 Windows 并发开发闭环，保持 defaultOn/liveReady/productApproved 和 M4 原有冻结值。
- 所有操作和 verdict 由脚本或 agent 自动执行，产物标 driven_by: agent 与实际 actor；不新增真人操作/真人数据前置。
- 节点开始实现前先运行其 pnpm harness context；production caller、错误/权限/清理负向检查与盘上 artifact 是收口条件。
- 一次只执行本 lane 的一个 ready leaf；保护共享工作树其他 dirty 内容，不 reset/stash/clean、不代其提交。
- 大体积临时日志/fixture/trace 写 D 盘或仓库已忽略目录，任何不可观测结果保持 unmeasured/partial。

- 不变更默认值、产品锁、发布/公开范围或授予 M4
- 不整仓复制 VerseGit，不建立第二 executor/task graph/approval/write journal/registry
- 不以历史 PASS、脚本 fixture 或节点创建代替当前产品验收
