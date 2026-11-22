---
lifecycleStatus: active
id: g5-foundation-current-acceptance
title: 在当前候选上复验自治基础与共同旅程
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: 177ee7ed214979b82c4615fca6ddfda3b400a6b3
intent: 保留五个基础叶的原始验收条件，更新本次复验的变更基线与精确写集，并修补共同旅程的实际控件操作。
ownedPaths: &paths
  - harness/specs/tasks/g5-foundation-current-acceptance.md
  - harness/specs/tasks/autonomy-object-owner-contract.md
  - harness/specs/tasks/autonomy-task-completion.md
  - harness/specs/tasks/autonomy-session-task-scope.md
  - harness/specs/tasks/autonomy-host-readiness.md
  - harness/specs/tasks/durable-task-owner-acceptance.md
  - tests/e2e/u6-interaction-metrics.final.spec.ts
touchedAreas: *paths
requiredRules:
  - backend-communication-boundary
  - identity-scope-boundary
  - comms-regression
  - docs-sync
  - disk-temp-policy
  - repository-artifact-retention
requiredProfiles:
  - fast
  - comms
  - e2e
expectedUserBehavior:
  - 自治对象、任务写入、验收、会话绑定和宿主能力由当前 owner 的实际结果验证。
  - 现状与候选的共同旅程操作真实控件，记录所有选择、确认和恢复结果。
acceptance:
  - TF-0670 至 TF-0674 的原始 27 条条件、负例和实际 owner 断言保持完整；完成结果绑定同一干净候选与输入哈希。
  - 历史规范保留先前声明的验证基线；本次 Harness 以复验前的 Git 提交检查真实变更，其他复验文件按精确 residualPaths 声明。
  - 六旅程两侧使用相同测试源与辅助文件，保留原时限，实际点击和输入计入操作负担。
  - 测试结果、配置观察、候选构建、owner 回执和原生进程退出从磁盘回读；缺失或冲突使对应检查失败。
  - 基础验收与 TF-0867 的整链和收益结果分别记录，历史失败与基线不支持的槽保留原状态。
requiredTests:
  - pnpm exec vitest run --config vitest.task-system.config.ts --maxWorkers=1 --no-file-parallelism
  - pnpm exec vitest run tests/unit/autonomy-object-owner-contract.test.ts tests/unit/autonomy-task-completion.test.ts tests/unit/session-task-scope.test.ts tests/unit/autonomy-host-readiness.test.ts tests/unit/task-ledger-service.test.ts --maxWorkers=1 --no-file-parallelism
  - pnpm run typecheck
  - pnpm run typecheck:test
  - pnpm run contract:check
  - node scripts/check-semantic-authority.mjs
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm exec playwright test tests/e2e/durable-task-system.spec.ts tests/e2e/durable-task-lifecycle.spec.ts tests/e2e/session-task-scope-completion.spec.ts tests/e2e/session-task-scope-derivation.spec.ts tests/e2e/autonomy-runtime-readiness.spec.ts tests/e2e/autonomy-host-readiness.spec.ts --workers=1 --retries=0
  - pnpm harness validate --spec harness/specs/tasks/g5-foundation-current-acceptance.md
  - pnpm harness run --spec harness/specs/tasks/g5-foundation-current-acceptance.md --dry-run
  - git diff --check
docs:
  required: true
  readmeTranslations: not-required
  reason: 复验规范与测试驱动适配，产品能力沿用启动修补后的文档。
  files:
    - harness/specs/tasks/g5-foundation-current-acceptance.md
---

本次复验从 `177ee7ed2` 开始。五份历史任务规范的 `previousValidationDiffBase`
保留先前已声明的基线，`diffBase` 检查本次规范和测试驱动的真实变更。
对应 `residualPaths` 只列出本复验中其他文件的精确路径，原验收条件保持不变。

基础完成依据当前候选的逐项结果；六旅程、并发整链和负载收益各自保留结果与来源。
原始运行记录和 Task Forest 历史保存在本地，精选最终证据按仓库产物保留规则保存。
