---
lifecycleStatus: active
id: agent-first-operational
title: Agent First 冻结包、OAT 与长程恢复验收
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: 完成 TF-0594，以真实 Electron/Gateway 执行源运行 OAT、provider 故障恢复和可选 packaged parity，保留可复核的故障、恢复、诊断和清理证据。
diffBase: 4078af22c
touchedAreas:
  - harness/specs/tasks/agent-first-operational.md
  - tests/e2e/agent-first-operational.spec.ts
  - tests/e2e/fixtures/electron.ts
  - tests/e2e/fixtures/space-bunny-responses.ts
  - tests/e2e/product-acceptance-space-bunny.spec.ts
  - scripts/agent-first-operational-check.mjs
  - scripts/agent-first-operational-check.d.mts
  - tests/unit/agent-first-operational.test.ts
  - harness/specs/fixtures/agent-first-system/oat/**
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - comms-regression
  - repository-artifact-retention
  - task-forest-autoclose-and-roles
  - docs-sync
  - disk-temp-policy
humanEvidence: not-required
requiredTests:
  - pnpm exec vitest run tests/unit/agent-first-operational.test.ts --maxWorkers=1
  - node scripts/agent-first-operational-check.mjs --acceptance harness/specs/fixtures/agent-first-system/oat/acceptance.json
  - pnpm run typecheck
  - pnpm harness validate --spec harness/specs/tasks/agent-first-operational.md
  - git diff --check
acceptance:
  - Source OAT 在真实 Electron/Gateway 中覆盖 Gateway loss、Gateway startup failure/恢复、provider timeout/cancel、restart、crash recovery、diagnostics、write failure 和 bounded shutdown，且每项故障后有正常 follow-up 或明确恢复终端。
  - 进程、端口、临时数据和 app exit 的最终状态可回读；崩溃或取消不能以缺失观测冒充清理完成。
  - Provider timeout/cancel 由实际产品 fault suite 产生，故障请求数、bounded retry、可见失败和无副作用，以及后续正常回复均有 receipt。
  - 若提供 frozen packaged app，则 source 与 packaged 核心 journey 必须一致；未提供时 distribution 明确为 not-run，绝不从 source/green OAT 外推。
  - 证据报告标记 driven_by=agent、actor、candidate，且 realHuman/releaseApproved/signedInstaller/crossPlatform 均为 false。
  - 精选 acceptance、operational 与 provider-fault receipt 有 SHA256 绑定，checker 可拒绝篡改、缺 drill 和未恢复样本。
docs:
  required: true
  files:
    - harness/specs/tasks/agent-first-operational.md
readmeUpdates: not-required
expectedUserBehavior:
  - 维护者可从磁盘定位每个故障的观测、恢复和最终清理状态。
  - 没有 packaged artifact 时仍可得到诚实的 operational verdict 与独立 distribution not-run。
---
# TF-0594

源运行 OAT 使用真实 Electron、真实 local Gateway 和隔离 profile：`Gateway loss`、占用端口导致的启动失败、重启持久化、Gateway child crash、诊断快照、support-bundle 写入失败/恢复、取消任务和最终端口/进程清理。Provider timeout/cancel 复用 `product-acceptance-space-bunny.spec.ts` 的本地故障代理，只通过 `CLAWX_SPACE_BUNNY_FAULTS=timeout,cancel` 缩短 drill 集。

packaged parity 通过 `CLAWX_AGENT_FIRST_PACKAGED_APP` 提供 win-unpacked 可执行文件时启用；没有该输入时报告 `distribution=not-run`，不以 source 证据外推 package/install 结果。
