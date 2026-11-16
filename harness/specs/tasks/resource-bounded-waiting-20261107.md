---
lifecycleStatus: active
id: resource-bounded-waiting-20261107
title: 资源等待队列有界、可取消并使用绝对截止时间
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: e6155185dbfc488080ee432f37e20929080a8b27
intent: 在既有 Fabric 和 runtime 租约 owner 内落实 G06、G07，释放失效等待项且保持执行所有权。
expectedUserBehavior:
  - Saturated resource queues reject excess waiting requests immediately.
  - Cancelled or expired requests never start after waiting; execution uses the remaining deadline.
touchedAreas:
  - electron/services/resource-fabric.ts
  - electron/services/terminal-api.ts
  - shared/resources/**
  - openclaw_runtime/src/agents/resource-leases.ts
  - openclaw_runtime/src/agents/sessions/tools/bash.ts
  - openclaw_runtime/src/agents/sessions/tools/find.ts
  - openclaw_runtime/src/agents/sessions/tools/grep.ts
  - openclaw_runtime/src/agents/sessions/tools/file-mutation-queue.ts
  - openclaw_runtime/src/agents/sessions/tools/edit.ts
  - openclaw_runtime/src/agents/sessions/tools/write.ts
  - openclaw_runtime/src/agents/resource-leases*.test.ts
  - openclaw_runtime/src/agents/sessions/tools/*lease*.test.ts
  - openclaw_runtime/test/vitest/vitest.resource-waiting.config.ts
  - tests/unit/resource-fabric*.test.ts
  - tests/unit/terminal-api.test.ts
  - harness/specs/tasks/resource-bounded-waiting-20261107.md
  - harness/specs/rules/resource-bounded-waiting.md
  - harness/specs/fixtures/resource-bounded-waiting-20261107/**
  - scripts/verify-resource-bounded-waiting.mjs
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - resource-bounded-waiting
  - comms-regression
  - docs-sync
  - disk-temp-policy
  - repository-artifact-retention
  - task-forest-autoclose-and-roles
requiredTests:
  - node harness/src/cli.mjs context --spec harness/specs/tasks/resource-bounded-waiting-20261107.md
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/resource-bounded-waiting-20261107.md
  - node harness/src/cli.mjs run --spec harness/specs/tasks/resource-bounded-waiting-20261107.md --dry-run
  - node scripts/verify-resource-bounded-waiting.mjs --output D:/tmp/tf0829/acceptance --baseline-types D:/tmp/tf0829/baseline-runtime-types.log --negative D:/tmp/tf0829/negative.json
  - node scripts/comms/replay.mjs
  - node scripts/comms/compare.mjs
  - git diff --check
acceptance:
  - queueLength counts waiting requests only and is enforced before enqueue; immediate grants use active capacity and queueLength zero permits them.
  - Pre-aborted, queued-aborted and grant-racing requests settle once; no cancelled or expired callback starts.
  - Absolute deadlines are checked at admission and grant and during waiting; bash and terminal/history RPC execution receive only the remaining budget.
  - A shared request isolates each waiting caller's cancellation; all subscribers leaving cancels pending admission without releasing an unknown running execution.
  - Release, rejection, cancellation, expiration and exceptions remove owned waiters, timers and listeners exactly once; running work holds capacity until its owner settles.
  - A 200-request workload classifies every request as success, rejection, cancellation or timeout, records bounded active/waiting peaks and ends at the resource baseline.
  - Old-source negative regressions fail; existing QoS/FIFO/idempotency and pressure assertions remain covered.
  - A clean committed candidate has disk-read test counts, command exits, targeted lint/types, full runtime diagnostics compared against the start commit, comms checks, dependency provenance, SHA-256 manifest and zero-hit credential scan.
docs:
  required: true
  readmeTranslations: not-required
  paths:
    - harness/specs/rules/resource-bounded-waiting.md
---

# 有界等待合同

TF-0829，所属 TF-0823 / TF-0822，开发包 B（G06、G07）。
即时执行不占等待额度。Fabric 保持既有 64 等待项默认值；runtime 在既有 owner
内使用同样的 64 项等待边界，保留原有活动容量与路径冲突/FIFO 规则。
`timeoutMs` 继续表示准入等待上限；`deadline` 是 Unix 毫秒绝对时间，跨准入和执行
共用。直接执行适配器有总超时时，在入口转换为 deadline，并在执行前计算剩余时间。
运行中取消交给实际执行 owner；等待层不通过 Promise.race 提前归还运行中租约。

README.md、README.zh-CN.md、README.ja-JP.md 的操作方式与配置接口不变；内部等待、
拒绝及截止时间合同由配套规则说明，readmeTranslations 决定为 not-required。
