---
lifecycleStatus: active
id: adaptive-resource-pressure-20261108
title: 按执行类别和有效压力调节并发
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: c0868c76f7a583b7d8c809dff905f3ad29a0784f
intent: 完成 TF-0837 / G30-G32，修复 backlog 正反馈，隔离延迟基线并接通新鲜压力与冷账户回收。
expectedUserBehavior:
  - Rising execution latency contracts admission despite backlog, and stable demand recovers gradually.
  - Read, execution and remote-wait feedback remain separate while sharing the existing account and fairness budget.
touchedAreas:
  - .gitignore
  - shared/resources/adaptive-limit.ts
  - shared/resources/index.ts
  - shared/types/resources.ts
  - electron/services/resource-fabric.ts
  - electron/services/terminal-api.ts
  - electron/services/efficiency-orchestrator.ts
  - electron/services/resource-envelope.ts
  - openclaw_runtime/src/process/process-tree-sampler.ts
  - openclaw_runtime/src/resources/resource-envelope.ts
  - tests/unit/resource-*.test.ts
  - tests/unit/process-tree-sampler.test.ts
  - tests/unit/terminal-api.test.ts
  - scripts/verify-adaptive-resource-pressure.mjs
  - harness/specs/tasks/adaptive-resource-pressure-20261108.md
  - harness/specs/rules/adaptive-resource-pressure.md
  - harness/specs/fixtures/adaptive-resource-pressure-20261108/**
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - docs/modules/resources-and-observability.md
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - adaptive-resource-pressure
  - resource-bounded-waiting
  - disk-temp-policy
  - repository-artifact-retention
  - task-forest-autoclose-and-roles
  - comms-regression
  - docs-sync
requiredTests:
  - node node_modules/vitest/vitest.mjs run tests/unit/resource-adaptive-pressure.test.ts tests/unit/resource-fabric-primitives.test.ts tests/unit/resource-fabric-invariants.test.ts tests/unit/resource-fabric-bounded-waiting.test.ts tests/unit/resource-fabric-workspace-exec.test.ts tests/unit/resource-window-lifecycle.test.ts tests/unit/resource-metrics-calibration.test.ts tests/unit/process-tree-sampler.test.ts --maxWorkers=1
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/adaptive-resource-pressure-20261108.md
  - node harness/src/cli.mjs run --spec harness/specs/tasks/adaptive-resource-pressure-20261108.md --dry-run
  - node scripts/comms/replay.mjs
  - node scripts/comms/compare.mjs
  - git diff --check
acceptance:
  - Preserve the old latency-plus-backlog counterexample and prove contraction, bounded growth, category isolation and recovery hysteresis.
  - Use the existing observation cadence for fresh physical-memory, available Windows commit and event-loop signals. Missing or stale observations cannot prove recovery; CPU activity alone is not congestion.
  - Pressure changes admission only; active leases retain ownership. Reclaim only idle, empty accounts and rebuild them on demand.
  - Retain fixed-input pressure traces and paired real read/execution/wait throughput and latency curves, with effective and unavailable signals visible.
  - Keep default initial/min/max limits, queue length, deadlines, QoS and global DRF capacity unchanged; run fairness and cancellation regressions.
  - Freeze a clean candidate, retain first failures, run targeted types/lint/comms/Harness, then verify artifacts and hashes before main integration and closure.
docs:
  required: true
  readmeTranslations: required
  paths:
    - harness/specs/rules/adaptive-resource-pressure.md
    - docs/modules/resources-and-observability.md
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
---

工作树为 resource-waiting-recovery/ClawX；权威任务图为 D:/ClawX。
自动化证据标记 driven_by: agent，临时输出写 D:/tmp/tf0837。
执行类别来自已有调用语义：history/read、terminal permission risk read/network/other。
provider quota 继续由原 owner 管理，远端等待不作为本地执行拥塞样本。
I/O 反馈使用同类实际读操作的服务延迟；没有可靠整机 I/O 等待计数时明确记为未启用。
