---
id: harness-gap-working-context-single-source
title: Working Context 账本作为唯一活任务读写源（L01）
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: L01 核验 Working Context 复用既有 workspace Task Ledger JSONL（append/read/projection）作为唯一活任务读写源：提交事件回放得一致视图，无第二存储/守护进程，批次幂等不重复，写入失败可观察且不误报成功。
touchedAreas:
  - tests/unit/task-ledger-working-context-single-source.test.ts
  - harness/specs/tasks/harness-gap-working-context-single-source.md
  - docs/dev/harness-gap-closure/l01-working-context-single-source.md
  - docs/dev/harness-gap-closure/l01-acceptance.json
  - docs/dev/harness-gap-closure/L01-SHA256SUMS
ownedPaths:
  - tests/unit/task-ledger-working-context-single-source.test.ts
  - harness/specs/tasks/harness-gap-working-context-single-source.md
  - docs/dev/harness-gap-closure/l01-working-context-single-source.md
  - docs/dev/harness-gap-closure/l01-acceptance.json
  - docs/dev/harness-gap-closure/L01-SHA256SUMS
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
  - tests/unit/task-ledger-working-context-single-source.test.ts
  - tests/unit/context-control-plane-stage3-contracts.test.ts
acceptance:
  - 单一来源：Working Context 只复用既有 workspace Task Ledger JSONL（append/read/projection），不新增表/快照文件/守护进程/第二存储。
  - 一致视图：提交事件→从 ledger 读取→projection，pending/accepted 等视图与写入一致；projection 是 ledger 的派生而非第二真源。
  - 幂等：同一 batchIdempotencyKey 重放不追加重复事件，projection 完全一致。
  - 可观察失败：ledger 目录不可写时 append 抛错（不静默返回成功）；读取缺失 ledger 返回空视图而非伪造事件。
  - 隔离：不同 workspaceId 落在各自 ledger，互不串数据。
  - 干净候选定向测试、类型、scoped lint、harness validate/dry-run、comms replay/compare 通过，凭据扫描 0 命中，SHA256SUMS 可回读。
expectedUserBehavior:
  - 维护者能从单一 JSONL ledger 回放到与提交一致的活动任务视图，不依赖第二份状态。
  - 重放同一批次不会产生重复事件；写入失败会显式报错。
docs:
  required: true
  files:
    - docs/dev/harness-gap-closure/l01-working-context-single-source.md
---

# L01 冻结实施边界

L01 只核验既有 Working Context 适配器（`electron/services/task-ledger-working-context.ts` → `appendTaskLedgerEvents`/`readTaskLedgerEvents` + `shared/task-ledger-working-context.ts` 的 projection）。不新增数据库、快照文件、守护进程或第二真源；不改变 Stage 3 事件契约。幂等由既有 batchIdempotencyKey + 事件 id 去重保证；写入失败由 append 直接抛出。
