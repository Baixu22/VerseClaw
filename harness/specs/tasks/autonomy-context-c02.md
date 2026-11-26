---
lifecycleStatus: active
id: autonomy-context-c02
title: 贯通自治上下文的语义状态和来源
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: af93c1e311f997f3e52b56f0a1d9ddb63fbfc0b0
intent: 复用现有语义原子，将原owner状态、极性、scope与逐项证据传过Main和continuity，旧输入继续可读。
touchedAreas:
  - shared/types/context-item.ts
  - shared/task-ledger-working-context.ts
  - shared/long-session-continuity.ts
  - shared/host-api/contract.ts
  - electron/services/chat-api.ts
  - electron/services/sessions-api.ts
  - openclaw_runtime/packages/agent-core/src/harness/compaction/compression-artifact.ts
  - openclaw_runtime/src/agents/agent-hooks/compaction-addressability.ts
  - tests/unit/autonomy-context-semantic-state.test.ts
  - tests/unit/fixtures/autonomy-context-c02-predecessor.json
  - tests/unit/long-session-continuity-context.test.ts
  - tests/unit/compression-artifact.test.ts
  - tests/e2e/long-session-continuity-context.spec.ts
  - harness/specs/tasks/autonomy-context-c02.md
  - harness/specs/fixtures/autonomy-context-system/semantic-state/**
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
requiredRules:
  - autonomy-context-system-contract
  - context-family-boundary
  - context-runtime-kit-boundary
  - identity-scope-boundary
  - durable-task-system-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - comms-regression
  - disk-temp-policy
  - repository-artifact-retention
  - task-forest-autoclose-and-roles
  - docs-sync
requiredProfiles:
  - fast
  - comms
expectedUserBehavior:
  - 压缩和接力保留原来源状态、否定极性、约束范围和逐项引用，已接受内容显示其原负责人状态。
  - 无法确认当前轮次的临时约束保留为历史记录，不继续进入后续轮次的活跃上下文。
requiredTests:
  - pnpm exec vitest run tests/unit/autonomy-context-semantic-state.test.ts tests/unit/long-session-continuity-context.test.ts tests/unit/compression-artifact.test.ts tests/unit/task-ledger-working-context-single-source.test.ts --maxWorkers=1 --no-file-parallelism
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm exec playwright test tests/e2e/long-session-continuity-context.spec.ts --workers=1
  - pnpm harness validate --spec harness/specs/tasks/autonomy-context-c02.md --since af93c1e311f997f3e52b56f0a1d9ddb63fbfc0b0
  - pnpm harness run --spec harness/specs/tasks/autonomy-context-c02.md --since af93c1e311f997f3e52b56f0a1d9ddb63fbfc0b0 --dry-run
acceptance:
  - 原owner状态映射可复算，保留scope、polarity、验证状态、supersedes/conflicts和逐项引用。
  - 需求修订、否定结论、临时偏好经过至少三次连续压缩、RPC转换和恢复仍保持原意。
  - owner接受、confirmed、agent_approved和旧字符串字段不提升为独立verified；未知状态保留原值和unknown映射。
  - 旧格式读取与渲染兼容，无破坏迁移；retired Runtime Memory flags保持退役。
  - 证据写入semantic-state-mapping.json、state-preservation-cases.json、legacy-read-parity.json，绑定实际源码、输入、命令和资源回执。
docs:
  required: true
  readmeTranslations: required
  files:
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
---

C02 承接 C01 的极性和临时scope缺口。Main compressionInputFromRpc 是已证实的丢字段边界，列入本叶必要写集。CompressionArtifact继续拥有语义原子，ContextItem只携带状态投影，TaskSystem继续拥有目标和完成事实。

本叶修正现有语义内容的传递与呈现，不注册context_update。旧压缩输入没有semanticAtoms时保留原文本结构；Working Context把原trust显式投影为来源状态。语义标签计入预算。需求修订保留旧原子及替代关系，不能通过同ID覆盖改变历史。Main在新消息发送前重建continuity，没有owner签发的当前turn身份，因此turn范围原子保留在原产物，按unknown-scope排除出活跃工作视图；恢复呈现标记其适用性尚未确认。

C01输入、oracle及报告保留在原提交af93c1e31。C02使用独立新跑次和证据目录；当前源码变化不改签C01文件摘要。后续策略仍由各自叶子验证。
