---
id: harness-gap-external-write-boundary
title: 工作区外写入的来源与路径边界核验（S03）
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: S03 核验 write/edit/apply_patch 的工作区外写入边界：非法来源的写必须无副作用修改，合法（trusted/operator）外写保留原语义，路径逃逸（父目录/绝对/别名/大小写）被拒且文件不变；只核实既有单一边界，不新建第二套策略。
touchedAreas:
  - openclaw_runtime/src/agents/agent-tools.workspace-boundary.test.ts
  - harness/specs/tasks/harness-gap-external-write-boundary.md
  - docs/dev/harness-gap-closure/s03-external-write-boundary.md
  - docs/dev/harness-gap-closure/s03-acceptance.json
  - docs/dev/harness-gap-closure/S03-SHA256SUMS
ownedPaths:
  - openclaw_runtime/src/agents/agent-tools.workspace-boundary.test.ts
  - harness/specs/tasks/harness-gap-external-write-boundary.md
  - docs/dev/harness-gap-closure/s03-external-write-boundary.md
  - docs/dev/harness-gap-closure/s03-acceptance.json
  - docs/dev/harness-gap-closure/S03-SHA256SUMS
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
  - openclaw_runtime/src/agents/workspace-external-write-provenance-policy.test.ts
  - openclaw_runtime/src/agents/agent-tools.workspace-boundary.test.ts
  - openclaw_runtime/src/agents/apply-patch-consistency.test.ts
  - openclaw_runtime/src/agents/sessions/tools/write.test.ts
  - openclaw_runtime/src/agents/sessions/tools/edit.test.ts
  - tests/unit/external-content-provenance.test.ts
acceptance:
  - 非法（external/derived/invalid/missing）来源对工作区外目标 write/edit/apply_patch 必须在文件系统操作前拒绝，且目标文件字节不变。
  - 合法（trusted system / direct operator）外写保留既有语义：写入成功且内容精确一致。
  - 路径逃逸矩阵（父目录 ..、绝对外部路径、已存在别名 symlink/junction、硬链接、win32 大小写变体）对非法来源一律拒绝且目标不变。
  - 只复用既有单一边界（workspace-external-write-provenance-policy + fs-safe 别名解析）；不新建第二套策略、不改 in-workspace 写语义。
  - 残余（UNC / device-namespace 路径）在本机无法确定性触发，显式记为 residual，不冒充已覆盖。
  - 干净候选定向测试、runtime core 类型、scoped lint、harness validate/dry-run、comms replay/compare 通过，凭据扫描 0 命中，SHA256SUMS 可回读。
expectedUserBehavior:
  - 外部/未知来源内容无法把 write/edit/apply_patch 静默重定向到工作区外。
  - 直接 operator / trusted system 的外写仍按既有受控路径生效。
docs:
  required: true
  files:
    - docs/dev/harness-gap-closure/s03-external-write-boundary.md
---

# S03 冻结实施边界

S03 核验既有工作区外写入边界，不新增策略。策略仍是 `openclaw_runtime/src/agents/workspace-external-write-provenance-policy.ts`（由 `agent-tools.ts` 为 write/edit/apply_patch 统一接线），别名解析复用既有 `fs-safe`（symlink/junction/hardlink）。仅对“解析后落在工作区外”的目标做来源相关判定。

路径逃逸矩阵在 `openclaw_runtime/src/agents/agent-tools.workspace-boundary.test.ts` 的真实文件系统路径上断言：非法来源拒绝且文件不变；trusted operator 外写内容精确一致。
