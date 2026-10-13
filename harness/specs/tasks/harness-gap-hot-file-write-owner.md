---
id: harness-gap-hot-file-write-owner
title: 热点文件只有一个可验证的写入归属（L06）
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: L06 在既有 per-file mutation queue（同一 FIFO/容量/超时内核）之上加一层可验证的写归属：CAS 式 owner 认领让第二个 owner 成为显式冲突（或经队列串行化），同 owner 重入幂等，释放/回滚保证可恢复；不新建第二个调度器。
touchedAreas:
  - openclaw_runtime/src/agents/hot-file-write-owner.ts
  - openclaw_runtime/src/agents/hot-file-write-owner.test.ts
  - harness/specs/tasks/harness-gap-hot-file-write-owner.md
  - docs/dev/harness-gap-closure/l06-hot-file-write-owner.md
  - docs/dev/harness-gap-closure/l06-acceptance.json
  - docs/dev/harness-gap-closure/L06-SHA256SUMS
ownedPaths:
  - openclaw_runtime/src/agents/hot-file-write-owner.ts
  - openclaw_runtime/src/agents/hot-file-write-owner.test.ts
  - harness/specs/tasks/harness-gap-hot-file-write-owner.md
  - docs/dev/harness-gap-closure/l06-hot-file-write-owner.md
  - docs/dev/harness-gap-closure/l06-acceptance.json
  - docs/dev/harness-gap-closure/L06-SHA256SUMS
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - comms-regression
  - docs-sync
  - sensitive-sink-ledger-boundary
  - task-forest-autoclose-and-roles
  - repository-artifact-retention
humanEvidence: not-required
requiredTests:
  - openclaw_runtime/src/agents/hot-file-write-owner.test.ts
acceptance:
  - 同一热点文件同一时刻只有一个可验证写 owner；第二个不同 owner 得到显式 conflict（holder 可读），不是静默并发写。
  - 同 owner 重入（re-claim）是幂等（reentrant），不记为冲突。
  - 释放必须 token 匹配；不匹配 token 不释放；释放后另一 owner 可认领（冲突可恢复/回滚）。
  - 并发同文件写经既有 mutation queue 串行化（start/end 不交错）；写抛错时 owner claim 回滚（不泄漏）。
  - 不新建第二个调度器/平台；复用既有 fileMutation lease 内核（issue #167）。
  - 干净候选定向测试、runtime core 类型、scoped lint、harness validate/dry-run、comms replay/compare 通过，凭据扫描 0 命中，SHA256SUMS 可回读。
expectedUserBehavior:
  - 热点文件写入有单一可验证归属；冲突显式可见并可恢复；崩溃/失败后归属不泄漏。
docs:
  required: true
  files:
    - docs/dev/harness-gap-closure/l06-hot-file-write-owner.md
---

# L06 冻结实施边界

L06 只在既有 per-file mutation queue 之上加一层可验证写归属（CAS 式 claim），串行化仍由 `withFileMutationQueue` -> `fileMutation` lease 内核（issue #167）提供；不新建第二个调度器/平台。claim 是进程内协调提示，token 匹配才能释放；写失败/抛出时 finally 释放，冲突可恢复。
