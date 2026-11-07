---
lifecycleStatus: active
id: autonomy-resource-admission
title: TF-0679 工具占用与预算的既有 owner 准入
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: 807cbb833e7e4a5de792d7c08161cb335d0a1463
intent: 在既有 Fabric、资源租约、worktree、进程和 provider owner 内预留与核销资源，统一层只保留可重建投影，避免跨会话超额和过期双 writer。
expectedUserBehavior:
  - 并发工作受实际 owner 容量约束，等待与未知成本有可回读原因，控制和取消仍可执行。
  - 工作树隔离取实际 owner 和 Git 证据；旧租约失效不等于旧执行已停止。
requiredProfiles:
  - fast
  - comms
touchedAreas:
  - shared/task-ledger-process.ts
  - tests/unit/task-ledger-process.test.ts
  - shared/resources/drf-share.ts
  - shared/dcs/component-disposition-catalog.ts
  - tests/unit/component-disposition-catalog.test.ts
  - tests/unit/component-authority-manifest.test.ts
  - shared/resources/priority-queue.ts
  - shared/types/resources.ts
  - shared/types/session-delegation.ts
  - shared/long-session-resource-reclamation.ts
  - electron/services/resource-fabric.ts
  - electron/services/resource-tracker.ts
  - electron/services/resource-envelope.ts
  - electron/services/resource-envelope-api.ts
  - electron/main/ipc-handlers.ts
  - electron/gateway/supervisor.ts
  - electron/gateway/process-launcher.ts
  - tests/unit/gateway-supervisor.test.ts
  - tests/unit/autonomy-owner-projection.test.ts
  - tests/unit/long-session-runtime-resource-inventory.test.ts
  - tests/e2e/autonomy-owner-projection.spec.ts
  - electron/services/terminal-api.ts
  - electron/services/sessions-api.ts
  - tests/unit/r0-3-terminal-session-reclaim.test.ts
  - tests/unit/r0-2-sessions-delete-fail.test.ts
  - tests/unit/long-session-owner-reclamation-adapter.test.ts
  - electron/services/gateway-api.ts
  - tests/unit/gateway-permissions-api.test.ts
  - openclaw_runtime/src/gateway/server-methods/chat.ts
  - openclaw_runtime/src/gateway/server-methods/role-orchestration-methods.ts
  - electron/services/terminal-session-manager.ts
  - tests/unit/terminal-session-manager.test.ts
  - tests/unit/long-session-resource-reclamation.test.ts
  - electron/services/session-delegation-admission.ts
  - electron/services/long-session-resource-reclamation.ts
  - openclaw_runtime/src/resources/resource-envelope.ts
  - openclaw_runtime/src/agents/resource-leases.ts
  - openclaw_runtime/src/agents/sessions/tools/bash.ts
  - openclaw_runtime/src/agents/sessions/tools/bash-workspace-lease.test.ts
  - openclaw_runtime/src/agents/sessions/tools/grep.ts
  - openclaw_runtime/src/agents/sessions/tools/find.ts
  - openclaw_runtime/src/agents/sessions/tools/edit.ts
  - openclaw_runtime/src/agents/sessions/tools/write.ts
  - openclaw_runtime/src/agents/sessions/tools/file-mutation-queue.ts
  - openclaw_runtime/src/agents/orchestration-resource-scheduler.ts
  - openclaw_runtime/src/agents/orchestration-synthesizer.ts
  - openclaw_runtime/src/agents/long-session-delegation-receipt.ts
  - openclaw_runtime/src/agents/orchestration-token-budget.ts
  - openclaw_runtime/src/agents/orchestrator-run-observed.ts
  - openclaw_runtime/src/agents/handoff-artifacts.ts
  - tests/unit/handoff-artifacts.test.ts
  - openclaw_runtime/src/agents/worktree-service.ts
  - openclaw_runtime/src/agents/checkpoint-rollback-executor.ts
  - openclaw_runtime/src/agents/checkpoint-rollback-executor.test.ts
  - openclaw_runtime/src/agents/provider-outbound-budget.ts
  - openclaw_runtime/src/agents/provider-spend-budget.ts
  - openclaw_runtime/src/agents/provider-spend-context.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/stream-resolution.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts
  - openclaw_runtime/src/agents/command/attempt-execution.ts
  - openclaw_runtime/src/config/sessions/types.ts
  - openclaw_runtime/src/plugins/session-entry-slot-keys.ts
  - openclaw_runtime/src/config/types.openclaw.ts
  - openclaw_runtime/src/config/zod-schema.ts
  - openclaw_runtime/src/config/runtime-feature-leaves.ts
  - openclaw_runtime/src/config/schema.help.ts
  - openclaw_runtime/src/config/schema.labels.ts
  - openclaw_runtime/src/state/openclaw-state-schema.sql
  - openclaw_runtime/src/state/openclaw-state-schema.generated.ts
  - openclaw_runtime/src/state/openclaw-state-db.generated.d.ts
  - tests/unit/autonomy-provider-spend.test.ts
  - tests/unit/fixtures/autonomy-provider-spend-worker.mts
  - openclaw_runtime/src/infra/bounded-concurrency.ts
  - openclaw_runtime/src/infra/bounded-concurrency.test.ts
  - openclaw_runtime/src/agents/provider-transport-fetch.ts
  - openclaw_runtime/src/agents/verseshell/managed-process-capacity.ts
  - openclaw_runtime/src/agents/subagent-registry.ts
  - openclaw_runtime/src/agents/subagent-registry-state.ts
  - openclaw_runtime/src/agents/subagent-registry.store.sqlite.ts
  - tests/unit/autonomy-subagent-persistence.test.ts
  - tests/unit/fixtures/autonomy-subagent-reservation-worker.mts
  - openclaw_runtime/src/agents/subagent-registry-run-manager.ts
  - openclaw_runtime/src/agents/subagent-registry-dispatch.ts
  - openclaw_runtime/src/agents/role-spawn.ts
  - openclaw_runtime/src/agents/subagent-registry-lifecycle.ts
  - openclaw_runtime/src/agents/subagent-registry-helpers.ts
  - openclaw_runtime/src/agents/subagent-registry-queries.ts
  - openclaw_runtime/src/agents/subagent-registry-queries.quota.test.ts
  - openclaw_runtime/src/agents/subagent-spawn.ts
  - tests/unit/autonomy-subagent-admission.test.ts
  - tests/unit/autonomy-orchestration-waves.test.ts
  - openclaw_runtime/src/agents/subagent-registry.types.ts
  - openclaw_runtime/src/gateway/session-resource-inventory.ts
  - openclaw_runtime/src/context-engine/factstore/symbol-lease.ts
  - openclaw_runtime/src/agents/symbol-lease-guard.ts
  - tests/unit/autonomy-resource-admission.test.ts
  - tests/unit/autonomy-worktree-owner.test.ts
  - tests/unit/autonomy-worktree-native.test.ts
  - tests/unit/fixtures/autonomy-worktree-owner-worker.mts
  - tests/unit/role-spawn.test.ts
  - tests/unit/autonomy-provider-budget.test.ts
  - tests/unit/autonomy-provider-transport.test.ts
  - tests/unit/autonomy-resource-lease-owner.test.ts
  - tests/unit/coding-controls-tf0510-symbol-lease-benchmark.test.ts
  - tests/unit/fixtures/autonomy-resource-lease-worker.mts
  - tests/unit/resource-fabric-primitives.test.ts
  - tests/unit/resource-fabric-invariants.test.ts
  - tests/unit/resource-fabric-workspace-exec.test.ts
  - tests/unit/orchestration-resource-scheduler.test.ts
  - tests/unit/long-session-delegation-admission.test.ts
  - tests/unit/orchestration-worktree-merge.test.ts
  - openclaw_runtime/src/agents/resource-leases.test.ts
  - openclaw_runtime/src/agents/orchestration-token-budget.test.ts
  - openclaw_runtime/src/agents/provider-outbound-budget.test.ts
  - openclaw_runtime/src/agents/verseshell/managed-process-capacity.test.ts
  - openclaw_runtime/src/context-engine/factstore/symbol-lease.test.ts
  - openclaw_runtime/src/agents/symbol-lease-guard.test.ts
  - tests/unit/fixtures/coding-controls-tf0510/symbol-lease-worker.mts
  - tests/e2e/autonomy-resource-admission.spec.ts
  - tests/e2e/role-orchestration-synthesis.spec.ts
  - src/components/agents/RolesOrchestrationPanel.tsx
  - shared/i18n/locales/en/agents.json
  - shared/i18n/locales/zh/agents.json
  - shared/i18n/locales/ja/agents.json
  - shared/i18n/locales/ru/agents.json
  - tests/unit/orchestration-synthesizer.test.ts
  - tests/unit/roles-orchestration-panel.test.tsx
  - tests/e2e/fixtures/fp-p1-harness.ts
  - tests/e2e/fixtures/electron.ts
  - harness/specs/tasks/autonomy-resource-admission.md
  - harness/specs/rules/autonomy-resource-owner-admission.md
  - harness/specs/scenarios/autonomy-resource-admission.md
  - harness/specs/fixtures/autonomous-project-system/r1/**
  - docs/modules/resources-and-observability.md
  - docs/modules/multi-agent-and-tasks.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
requiredRules:
  - autonomy-resource-owner-admission
  - autonomy-object-owner-boundary
  - identity-scope-boundary
  - backend-communication-boundary
  - contract-first-boundary
  - api-client-transport-policy
  - task-forest-autoclose-and-roles
  - repository-artifact-retention
  - disk-temp-policy
  - docs-sync
requiredTests:
  - pnpm exec vitest run tests/unit/task-ledger-process.test.ts --maxWorkers=1
  - pnpm exec vitest run tests/unit/gateway-supervisor.test.ts --maxWorkers=1
  - pnpm exec vitest run tests/unit/r0-2-sessions-delete-fail.test.ts tests/unit/long-session-owner-reclamation-adapter.test.ts --maxWorkers=1
  - pnpm exec vitest run tests/unit/component-disposition-catalog.test.ts tests/unit/component-authority-manifest.test.ts --maxWorkers=1
  - pnpm exec vitest run tests/unit/r0-3-terminal-session-reclaim.test.ts tests/unit/terminal-session-manager.test.ts tests/unit/long-session-resource-reclamation.test.ts --maxWorkers=1
  - pnpm exec vitest run tests/unit/gateway-permissions-api.test.ts --maxWorkers=1
  - pnpm exec vitest run tests/unit/terminal-session-manager.test.ts tests/unit/autonomy-owner-projection.test.ts --maxWorkers=1
  - pnpm exec vitest run tests/unit/autonomy-owner-projection.test.ts tests/unit/long-session-runtime-resource-inventory.test.ts tests/unit/autonomy-resource-admission.test.ts tests/unit/autonomy-provider-spend.test.ts --maxWorkers=1
  - pnpm test:e2e:run tests/e2e/autonomy-owner-projection.spec.ts --workers=1
  - pnpm exec vitest run tests/unit/handoff-artifacts.test.ts tests/unit/autonomy-orchestration-waves.test.ts --maxWorkers=1
  - pnpm exec vitest run tests/unit/autonomy-subagent-persistence.test.ts tests/unit/autonomy-subagent-admission.test.ts tests/unit/autonomy-orchestration-waves.test.ts --maxWorkers=1
  - pnpm exec vitest run tests/unit/autonomy-orchestration-waves.test.ts tests/unit/orchestration-resource-scheduler.test.ts tests/unit/orchestration-synthesizer.test.ts tests/unit/long-session-delegation-admission.test.ts tests/unit/roles-orchestration-panel.test.tsx --maxWorkers=1
  - pnpm test:e2e:run tests/e2e/role-orchestration-synthesis.spec.ts --workers=1
  - pnpm exec vitest run tests/unit/autonomy-provider-spend.test.ts tests/unit/config-schema-parity.test.ts --maxWorkers=1
  - pnpm --dir openclaw_runtime exec node scripts/generate-kysely-types.mjs --verify
  - pnpm --dir openclaw_runtime exec node --import tsx scripts/generate-base-config-schema.ts --check
  - pnpm exec vitest run tests/unit/autonomy-orchestration-waves.test.ts tests/unit/autonomy-subagent-admission.test.ts tests/unit/orchestration-resource-scheduler.test.ts --maxWorkers=1
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs src/agents/resource-leases.test.ts src/agents/sessions/tools/bash-workspace-lease.test.ts --maxWorkers=1
  - pnpm exec vitest run tests/unit/autonomy-subagent-admission.test.ts --maxWorkers=1
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs src/agents/subagent-registry-queries.quota.test.ts --maxWorkers=1
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs src/agents/worktree-service.test.ts src/agents/checkpoint-rollback-executor.test.ts --maxWorkers=1
  - pnpm exec vitest run tests/unit/autonomy-worktree-native.test.ts --maxWorkers=1
  - pnpm exec vitest run tests/unit/autonomy-worktree-owner.test.ts tests/unit/orchestration-worktree-merge.test.ts tests/unit/versegit-cleanup-barrier.test.ts tests/unit/orchestration-resource-scheduler.test.ts tests/unit/role-spawn.test.ts tests/unit/long-session-delegation-admission.test.ts --maxWorkers=1
  - pnpm exec vitest run tests/unit/autonomy-provider-budget.test.ts tests/unit/autonomy-provider-transport.test.ts --maxWorkers=1
  - pnpm exec vitest run tests/unit/autonomy-resource-lease-owner.test.ts tests/unit/coding-controls-tf0510-symbol-lease-benchmark.test.ts --maxWorkers=1
  - pnpm exec vitest run tests/unit/autonomy-resource-admission.test.ts tests/unit/resource-fabric-primitives.test.ts tests/unit/resource-fabric-invariants.test.ts tests/unit/resource-fabric-workspace-exec.test.ts tests/unit/resource-fabric-chat-history.test.ts tests/unit/resource-fabric-pressure.test.ts tests/unit/orchestration-resource-scheduler.test.ts --maxWorkers=1
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs src/agents/resource-leases.test.ts src/agents/orchestration-token-budget.test.ts src/agents/provider-outbound-budget.test.ts src/agents/verseshell/managed-process-capacity.test.ts src/context-engine/factstore/symbol-lease.test.ts src/agents/symbol-lease-guard.test.ts --maxWorkers=1
  - pnpm typecheck
  - pnpm contract:check
  - pnpm comms:replay
  - pnpm comms:compare
  - pnpm build:runtime
  - pnpm build:vite
  - pnpm test:e2e:run tests/e2e/autonomy-resource-admission.spec.ts --workers=1
  - pnpm harness validate --spec harness/specs/tasks/autonomy-resource-admission.md
  - pnpm harness run --spec harness/specs/tasks/autonomy-resource-admission.md --dry-run
  - git diff --check
acceptance:
  - writeSet缺失仍推迟；隔离证明从实际worktree owner获得，不信调用者bool。
  - 并发预留无宿主/项目/会话超额双花；unknown成本单列，等待可归因且无饥饿。
  - 租约过期先fence并确认旧执行隔离，再重分配；占用与effective cap可回读。
  - TTL过期双writer、未测上限被当无限安全、多资源死锁均由真实反例验证拒绝或明确诊断。
  - 同干净候选保留actor、输入配置、命令exit/count、真实owner记录、hash、负例及未测范围。
  - 统一层只保留envelope、相关ID与可重建索引；清空缓存后从owner重建，缓存或TTL不能释放真实占用。
docs:
  required: true
  readmeTranslations: required
  files:
    - docs/modules/resources-and-observability.md
    - docs/modules/multi-agent-and-tasks.md
    - harness/specs/rules/autonomy-resource-owner-admission.md
    - harness/specs/scenarios/autonomy-resource-admission.md
---

完整合同以 canonical TF-0679 的原5项要求、6项验收为准，不能以原语单测替代端到端 owner 证据。
当前既有 owner：Main ResourceFabric、runtime ResourceLeaseManager、WorktreeService、
ManagedProcessCapacity/ProcessSupervisor、ProviderOutboundBudget。ResourceEnvelopeLedger
继续为 shadow 投影，不成为租约、调度、效果或预算事实库。

实现可按生产入口逐段推进，未验证的合同保持未完成；不得据定向用例提前收口。
既有 provider/process 未配置时的产品默认保持不变，未测能力必须明确未知。

工作树使用隔离的已安装依赖视图时，pnpm 11 的自动依赖重建可能进入 install；
开发验证可在该进程设置 pnpm_config_verify_deps_before_run=false，并如实记录所用依赖
版本与链接来源。它只关闭启动前的自动重建，不跳过上述测试、类型或验收门禁，
也不代表完整全新安装通过。README 的产品入口与默认未改变，本叶同步资源模块说明。

启用预算后的模型发送从既有 SessionEntry 回读 workspace 与 session generation；首个
可信 workspace 在该 generation 内绑定，漂移或 owner 缺失拒绝发送。子代理创建通过
原会话存储继承逻辑 workspace，agent 执行从同一记录取值；不从磁盘目录推导项目身份。

派发阶段的 result bundle 与 synthesis 保持 pending；规划的 scheduled 数与真实
registry completed 数分开。运行/排队/未知只读取原owner，accepted 不提升完成或核验。
