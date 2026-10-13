---
lifecycleStatus: completed
id: harness-gap-sink-ledger
title: 敏感 sink 覆盖台账与残余出口钉板（S02）
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: S02 对既有的敏感 sink provenance 分类做执行化核对，逐 sink 记录 enforced/partial/residual，并显式列出 network-send 未接入 cross-context 闸门的残余出口；不新建第二套 provenance 引擎，不把单条路径通过或 classification-only 当成全网强制。
touchedAreas:
  - docs/dev/harness-gap-closure/s02-sink-ledger.md
  - tests/unit/sensitive-sink-residual-ledger.test.ts
  - harness/specs/tasks/harness-gap-sink-ledger.md
  - harness/specs/rules/sensitive-sink-ledger-boundary.md
  - docs/dev/harness-gap-closure/s02-acceptance.json
  - docs/dev/harness-gap-closure/S02-SHA256SUMS
ownedPaths:
  - docs/dev/harness-gap-closure/s02-sink-ledger.md
  - tests/unit/sensitive-sink-residual-ledger.test.ts
  - harness/specs/tasks/harness-gap-sink-ledger.md
  - harness/specs/rules/sensitive-sink-ledger-boundary.md
  - docs/dev/harness-gap-closure/s02-acceptance.json
  - docs/dev/harness-gap-closure/S02-SHA256SUMS
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - docs-sync
  - sensitive-sink-ledger-boundary
  - task-forest-autoclose-and-roles
  - repository-artifact-retention
humanEvidence: not-required
requiredTests:
  - tests/unit/sensitive-sink-enforcement-drift.test.ts
  - tests/unit/sensitive-sink-residual-ledger.test.ts
acceptance:
  - 逐 sink 记录 enforcement（narrow / source-dependent / classification-only）与 policyFile/导出符号/生产调用点/拒绝形态，来源为权威代码而非自述。
  - 显式列出 network-send 未接入 provenance 闸门的残余出口（outbound-send-service / message-action-dispatch / cli-runtime outbound / sessions send-policy / auto-reply send-policy / server-broadcast），并以可执行测试钉住。
  - 不把“某条路径会拒绝”或 classification-only 推导成全网强制；台账明确写出“不是全网强制”。
  - 既有 drift guard 仍通过（登记点必须真实存在/被调用），新增 provenance 闸门会被反向扫描要求登记。
  - 干净候选定向测试、类型、scoped lint、harness validate/dry-run 通过，凭据扫描 0 命中，SHA256SUMS 可回读。
  - 不改产品默认值/锁/approval，不新建第二套 engine；已复核 README 四语：无用户可见接口变化，故不改。
expectedUserBehavior:
  - 维护者能从一份台账看清每个敏感 sink 实际接到哪一步，以及哪些出口仍是残余（未强制）。
  - 当有人给残余出口接上 provenance 闸门时，测试会失败并提示先更新台账。
docs:
  required: true
  files:
    - docs/dev/harness-gap-closure/s02-sink-ledger.md
---

# S02 冻结实施边界

S02 是对既有 `shared/security/content-provenance.ts` 分类的**核对与台账化**，不新增代码闸门。`tests/unit/sensitive-sink-enforcement-drift.test.ts` 已验证“每条登记点真实存在且被调用”；本包补上另一半：`tests/unit/sensitive-sink-residual-ledger.test.ts` 钉住**未接入闸门的残余出口**，并校验台账文档齐全。

台账只陈述事实：`narrow` 表示某条生产路径会拒绝，`command-exec` 是 `source-dependent`（收紧既有 security/ask 底线），其余未接入的出口记为 residual / classification-only。任何“全网强制”的说法都属于越权。
