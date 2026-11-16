---
lifecycleStatus: active
id: verseshell-concurrent-acquisition-20261107
title: VerseShell 并发获取与启动失败容量回收
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: c7573ec11095b541f3a4a9c5470bf4e0727489bc
intent: 修复同 key 重复创建、创建中超额、shutdown 期间迟到创建和确定未启动的容量泄漏。
expectedUserBehavior:
  - Concurrent tool calls in one workspace share an executor only after its startup contract succeeds.
  - Stopping a workspace or the app prevents a pending executor from appearing later.
  - An executor that failed before payload start does not consume the next tool request's process slot.
touchedAreas:
  - openclaw_runtime/src/agents/verseshell/process-manager.ts
  - openclaw_runtime/src/agents/verseshell/process-manager.test.ts
  - openclaw_runtime/src/agents/verseshell/governed-process.ts
  - openclaw_runtime/src/agents/verseshell/governed-process.test.ts
  - openclaw_runtime/src/agents/verseshell/managed-process-capacity.test.ts
  - openclaw_runtime/src/agents/verseshell/concurrent-acquisition.integration.test.ts
  - openclaw_runtime/test/vitest/vitest.verseshell.config.ts
  - harness/specs/rules/verseshell-process-lifecycle-boundary.md
  - harness/specs/tasks/verseshell-concurrent-acquisition-20261107.md
  - harness/specs/tasks/performance-resource-governance-20261107.md
  - harness/specs/fixtures/verseshell-concurrent-acquisition-20261107/**
  - scripts/repository-artifacts.json
  - scripts/verify-verseshell-acquisition.mjs
  - .gitignore
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - verseshell-process-lifecycle-boundary
  - comms-regression
  - docs-sync
  - disk-temp-policy
  - repository-artifact-retention
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/verseshell-concurrent-acquisition-20261107.md
  - pnpm harness validate --spec harness/specs/tasks/verseshell-concurrent-acquisition-20261107.md
  - pnpm --dir openclaw_runtime exec vitest run --config test/vitest/vitest.verseshell.config.ts --maxWorkers=1
  - pnpm run comms:replay
  - pnpm run comms:compare
  - git diff --check
  - node scripts/verify-verseshell-acquisition.mjs --output D:/tmp/verseshell-acquisition-acceptance --baseline-types D:/tmp/clawx-performance-research/typecheck-runtime-baseline.log
acceptance:
  - Same-key concurrent getClient shares one startup and never returns a client before its handshake succeeds; all waiters observe startup failure and later retry succeeds.
  - Concurrent distinct keys cannot exceed maxProcesses, including pending binary resolution and handshake.
  - shutdownAll, shutdownWorkspace, shutdownProcess and kill switch cannot be followed by a late managed spawn or ready publication from an acquisition already in progress.
  - Executor acquisition or approval-client acquisition failure before process.start dispatch returns the reserved managed slot; rejected startup permits a later request.
  - Unknown effectful process.start delivery or unknown running exit keeps capacity reserved and never replays process.start; confirmed terminal state releases once.
  - Regression tests include deterministic interleavings and real Node child processes implementing the declared ACI handshake; closing the manager leaves zero owned test child PIDs.
  - Same clean candidate has readable test JSON, command exit codes, source/dependency provenance, evidence hashes and a zero-hit credential scan; README.md, README.zh-CN.md and README.ja-JP.md are reviewed for behavior documentation.
docs:
  required: true
  readmeTranslations: not-required
  paths:
    - harness/specs/tasks/performance-resource-governance-20261107.md
    - harness/specs/rules/verseshell-process-lifecycle-boundary.md
---

# 获取与启动的所有权合同

本节点承接性能缺口 G01–G05，复用现有 manager 与 managed capacity。
Task Forest：`TF-0828`，父阶段 `TF-0823`，总目标 `TF-0822`。
README.md、README.zh-CN.md、README.ja-JP.md 已复核：本次修复内部获取/失败补偿，公开操作方式和配置不变；契约更新写入生命周期规则。
单飞表与创建预留只保护 executor 的创建；工具进程容量由既有 managed-process-capacity 持有。
确定未发送 `process.start` 时才执行未启动补偿。发送结果不明时继续保留占用，并由既有
终态观察或 reconciliation 处理。真实 Node 子进程测试证明宿主 manager 的所有权和退出；
VerseShell Rust payload、真实模型吞吐和多窗口性能由后续节点测量。
