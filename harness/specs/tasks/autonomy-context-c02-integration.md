---
lifecycleStatus: active
id: autonomy-context-c02-integration
title: 集成上下文基线与已验收的语义状态保真
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: 917a71cba7b2dfc8aedbdb3b75b7b693e3900f1e
intent: 将冻结基线和已独立验收的C02变更合入当前主线，核对源文件一致性并验证合并候选。
touchedAreas:
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - electron/services/chat-api.ts
  - electron/services/sessions-api.ts
  - shared/types/context-item.ts
  - shared/task-ledger-working-context.ts
  - shared/long-session-continuity.ts
  - shared/long-session-paired-evaluation.ts
  - shared/host-api/contract.ts
  - openclaw_runtime/packages/agent-core/src/harness/compaction/compression-artifact.ts
  - openclaw_runtime/src/agents/agent-hooks/compaction-addressability.ts
  - scripts/verify-autonomy-context-baseline.mjs
  - tests/unit/autonomy-context-baseline.test.ts
  - tests/unit/autonomy-context-semantic-state.test.ts
  - tests/unit/compression-artifact.test.ts
  - tests/unit/long-session-continuity-context.test.ts
  - tests/unit/fixtures/autonomy-context-baseline.v2.json
  - tests/unit/fixtures/autonomy-context-c02-predecessor.json
  - tests/e2e/long-session-continuity-context.spec.ts
  - harness/specs/guides/autonomy-context-system-design.md
  - harness/specs/rules/autonomy-context-system-contract.md
  - harness/specs/scenarios/autonomy-context-system.md
  - harness/specs/tasks/autonomy-context-system-plan.md
  - harness/specs/tasks/autonomy-context-baseline.md
  - harness/specs/tasks/autonomy-context-c02.md
  - harness/specs/tasks/autonomy-context-c02-integration.md
  - harness/specs/fixtures/autonomy-context-system/**
requiredRules:
  - autonomy-context-system-contract
  - backend-communication-boundary
  - api-client-transport-policy
  - context-family-boundary
  - durable-task-system-boundary
  - comms-regression
  - docs-sync
  - disk-temp-policy
  - repository-artifact-retention
  - task-forest-autoclose-and-roles
requiredProfiles:
  - fast
  - comms
expectedUserBehavior:
  - 主线压缩和交接保留来源状态、否定极性、适用范围和逐项证据，关键来源失联明确拒绝续行。
  - 原任务、权限、归档和后端职责按既有owner执行。
requiredTests:
  - pnpm harness validate --spec harness/specs/tasks/autonomy-context-c02-integration.md
  - pnpm harness run --spec harness/specs/tasks/autonomy-context-c02-integration.md --dry-run
  - pnpm exec vitest run tests/unit/autonomy-context-semantic-state.test.ts tests/unit/compression-artifact.test.ts tests/unit/long-session-continuity-context.test.ts tests/unit/task-ledger-working-context-single-source.test.ts tests/unit/memory-tf0500-retirement.test.ts tests/unit/memory-tf0500-persistence-retirement.test.ts --maxWorkers=1 --no-file-parallelism
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm run build:vite
  - pnpm run build:runtime
  - pnpm exec playwright test tests/e2e/long-session-continuity-context.spec.ts --workers=1
  - pnpm run harness:ci
acceptance:
  - C02运行源码与独立验收候选205be98dc逐文件一致；合并候选有独立提交、树、无未提交源的前后身份记录。
  - 集成定向回归、相关类型、通信、桌面与Runtime构建、Electron旅程通过；主线既有失败保留可复算的基线对照。
  - C01历史报告继续绑定其原候选；C02独立验收、集成回执和源码摘要分别保留。
  - 完成私有主线合并并核对实际合并提交；Task Forest依据完整证据更新并导出。
docs:
  required: true
  readmeTranslations: required
  files:
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
---

集成基线为主线917a71cba，C02独立源码候选为205be98dc，精选证据提交为704f56523。三份README自动合并，其余C02运行源码保持原候选内容。每次集成执行另记新候选与回执，不改签原有验收报告。
