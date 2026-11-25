---
lifecycleStatus: active
id: resource-scheduling-review-fixes-20261125
title: 修复资源调度的执行占用、排队和压力保护
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: 526645345fac24c0ecb0f7e4170d920e57d37153
intent: 修复 2026-11-25 资源调度审查确认的六项缺陷并整合到主线。
expectedUserBehavior:
  - Timed-out execution keeps its global and session slots until the execution owner finishes.
  - Agent queues reject overload and settle cancellation or wait expiration promptly.
  - Main and Gateway managed processes share the host budget and contract admission under resource pressure.
  - Disabling diagnostic samples preserves resource protection and bounded idle-resource reclamation.
touchedAreas:
  - openclaw_runtime/src/process/command-queue*
  - openclaw_runtime/src/agents/embedded-agent-runner/run.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/lanes.ts
  - openclaw_runtime/src/agents/resource-leases.ts
  - openclaw_runtime/src/agents/model-fallback.ts
  - openclaw_runtime/src/agents/model-fallback.loop-termination.test.ts
  - openclaw_runtime/src/agents/sessions/tools/bash.ts
  - openclaw_runtime/src/agents/sessions/tools/bounded-waiting-lease.test.ts
  - openclaw_runtime/src/agents/verseshell/managed-process*
  - openclaw_runtime/test/vitest/vitest.resource-budget.config.ts
  - shared/resources/drf-share.ts
  - shared/i18n/locales/*/settings.json
  - electron/services/resource-fabric.ts
  - electron/services/efficiency-orchestrator.ts
  - electron/services/efficiency-api.ts
  - electron/services/resource-tracker.ts
  - electron/services/git-api.ts
  - electron/main/index.ts
  - tests/unit/**
  - tests/e2e/settings-efficiency-sampling.spec.ts
  - harness/specs/tasks/resource-scheduling-review-fixes-20261125.md
  - harness/specs/rules/resource-execution-lifecycle.md
  - harness/specs/rules/adaptive-resource-pressure.md
  - harness/specs/scenarios/resource-pressure-protection.md
  - harness/specs/fixtures/resource-scheduling-review-fixes/20261125/**
  - docs/modules/resources-and-observability.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - resource-execution-lifecycle
  - resource-bounded-waiting
  - adaptive-resource-pressure
  - comms-regression
  - docs-sync
  - disk-temp-policy
  - repository-artifact-retention
  - task-forest-autoclose-and-roles
requiredTests:
  - node scripts/comms/replay.mjs
  - node scripts/comms/compare.mjs
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/resource-scheduling-review-fixes-20261125.md
  - node harness/src/cli.mjs run --spec harness/specs/tasks/resource-scheduling-review-fixes-20261125.md --dry-run
  - git diff --check
acceptance:
  - A lane with concurrency one never runs two task owners after timeout or recovery reset; nested session/global lanes retain both reservations until terminal settlement.
  - The actual embedded-agent entry supplies finite waiting capacity, one shared waiting deadline and its AbortSignal to both queue layers; host queue failures do not switch provider/model.
  - Queued abort, expiration, clear and grant clean up their timers and listeners, settle once and never execute cancelled work; zero waiting capacity still allows immediate admission.
  - Host capacity contracts without dropping existing owners; Main/Gateway process admissions use the same SQLite capacity owner, including Git and terminal execution.
  - Diagnostic sampling can stop and restart without removing pressure or visibility protection; explicit application shutdown detaches the protection observer.
  - Idle managed-resource reclamation continues under sustained pressure or hidden windows with bounded probe concurrency and overlapping-heartbeat exclusion.
  - Preserve old-source failures and read final focused test reports, cross-process/native receipts, type/lint/build results, Electron settings regression and communication reports from disk on the named candidate.
  - Complete WorkBuddy review, hash-bound evidence, Task Forest validation/export and mainline integration.
docs:
  required: true
  readmeTranslations: required
  paths:
    - docs/modules/resources-and-observability.md
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
---

来源会话：01a211a5-fc1d-7241-90c5-734ef627316c。原审查候选为
526645345；完整报告及原始探针保留在
D:/tmp/clawx-resource-review-20261125-6387a1。开发只推进资源治理的一项补修节点。

复用既有 command lanes、ResourceFabric、workspace leases、managed-process SQLite
owner 和 TimerAligner。Main 正常调度保留已有 64 槽位；显式受管进程容量和未配置容量的
默认语义保持。主机压力在共享进程 owner 上收缩准入，保留原占用及 unknown 执行，
恢复由新鲜低压信号和既有驻留期决定。
诊断记录与持续的资源保护分开控制。验证使用 agent 驱动的本地执行和隔离数据目录。
