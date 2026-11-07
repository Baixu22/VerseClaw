---
lifecycleStatus: active
id: process-tree-metrics-calibration-20261107
title: 校准进程树 CPU、内存和快照有效期
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: d78ca54c835e54cfe86b2c8ad8cda7de05c5667f
intent: 完成 TF-0831 / G13–G16，按进程身份聚合物理占用并让降载消费有效进程树采样。
expectedUserBehavior:
  - Gateway or tool CPU pressure is reflected even when Main is idle.
  - Overlapping process trees count each process once and stale measurements cannot affect current admission.
touchedAreas:
  - shared/types/resources.ts
  - openclaw_runtime/src/process/process-tree-sampler.ts
  - openclaw_runtime/src/resources/resource-envelope.ts
  - openclaw_runtime/src/resources/resource-envelope-snapshot-store.ts
  - openclaw_runtime/src/resources/background-work-gate.ts
  - openclaw_runtime/src/gateway/server/event-loop-health.ts
  - openclaw_runtime/src/agents/resource-leases.ts
  - electron/services/resource-envelope.ts
  - electron/services/efficiency-orchestrator.ts
  - tests/unit/process-tree-sampler.test.ts
  - tests/unit/resource-envelope.test.ts
  - tests/unit/resource-metrics-calibration.test.ts
  - tests/unit/resource-metrics-owner.test.ts
  - tests/unit/background-work-gate.test.ts
  - harness/specs/tasks/process-tree-metrics-calibration-20261107.md
  - harness/specs/rules/process-metrics-identity-and-freshness.md
  - harness/specs/fixtures/process-tree-metrics-calibration-20261107/**
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - process-metrics-identity-and-freshness
  - comms-regression
  - docs-sync
  - disk-temp-policy
  - repository-artifact-retention
  - task-forest-autoclose-and-roles
requiredTests:
  - node node_modules/vitest/vitest.mjs run tests/unit/process-tree-sampler.test.ts tests/unit/resource-envelope.test.ts tests/unit/resource-envelope-api.test.ts tests/unit/resource-metrics-calibration.test.ts tests/unit/resource-metrics-owner.test.ts tests/unit/background-work-gate.test.ts --maxWorkers=1
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/process-tree-metrics-calibration-20261107.md
  - node harness/src/cli.mjs run --spec harness/specs/tasks/process-tree-metrics-calibration-20261107.md --dry-run
  - node scripts/comms/replay.mjs
  - node scripts/comms/compare.mjs
  - git diff --check
acceptance:
  - Main/Gateway overlap is deduplicated by PID and creation token; new generations replace old measurements and CPU baselines.
  - CPU rates use individual process counter deltas; first, stale, failed or identity-changed samples remain unknown until a valid interval exists.
  - Physical RSS/working set, private committed bytes, machine physical availability and logical leases remain distinct fields.
  - The existing background-work gate consumes fresh process-tree CPU and memory, including Gateway activity; unknown samples do not act as zero-load evidence.
  - Expired, future, malformed and superseded owner snapshots do not contribute stale occupancy; producer epochs and sample times survive merge.
  - Positive and negative fixed-input regressions plus a live local process sample pass, with clean candidate/source hashes and machine-readable evidence read from disk.
docs:
  required: true
  readmeTranslations: not-required
  paths:
    - harness/specs/rules/process-metrics-identity-and-freshness.md
---

TF-0831 是性能与资源治理开发包 D。采样与聚合继续使用现有 ProcessTreeSampler、
ResourceEnvelopeLedger 和 BackgroundWorkGate，不新增调度器或资源事实库。

采样按 30 秒有效期判定，保留现有采样节拍、活动容量、压力阈值和产品开关。
未知 CPU 不能解除由 CPU 压力触发的等待；工作集与私有提交量分别报告。
README 三语操作流程和配置接口不变，度量合同记录在配套规则中。
