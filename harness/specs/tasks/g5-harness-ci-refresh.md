---
lifecycleStatus: active
id: g5-harness-ci-refresh
title: 恢复 G5 的 Agent Dev 与 Harness CI 门禁
taskType: repository-maintenance
diffBase: 0cdf7d197
intent: 接入主线的契约扫描与编译调度修补，并在相同阈值下刷新候选的证据。
ownedPaths: &paths
  - harness/specs/tasks/g5-harness-ci-refresh.md
  - harness/specs/rules/agent-dev-conformance-evidence.md
  - harness/specs/rules/contract-first-boundary.md
  - package.json
  - scripts/agent-dev-deep-test.mjs
  - scripts/contract-check.mjs
  - scripts/typecheck-agent-dev.mjs
  - tests/unit/contract-check.test.ts
  - tests/unit/typecheck-gate.test.ts
  - artifacts/agent-dev-workbench/evidence.json
  - artifacts/agent-dev-deep-test/report.json
  - artifacts/agent-dev-deep-test/report.md
  - artifacts/agent-dev-deep-test/history.json
  - artifacts/agent-dev-quality/report.json
  - harness/specs/fixtures/g5-ci-refresh/20261118/**
touchedAreas: *paths
requiredRules:
  - contract-first-boundary
  - agent-dev-conformance-evidence
  - repository-artifact-retention
  - disk-temp-policy
requiredProfiles:
  - fast
acceptance:
  - 批量契约测试保留每条 fixture 的实际单独裁决，验明单独运行等价和隔离。
  - 不使用缓存的类型检查覆盖 node、web 与 test；缓存输入变更会触发复验。
  - 以原性能硬限验证 Agent Dev，区分历史失败、本次测量和编译或运行环境中止。
  - 运行完整 Harness CI；产品冻结候选的基础验收与本次维护的命令和报告分别绑定。
requiredTests:
  - pnpm exec vitest run tests/unit/typecheck-gate.test.ts --maxWorkers=1
  - pnpm agent-dev:deep-test
  - pnpm harness validate --spec harness/specs/tasks/g5-harness-ci-refresh.md
  - pnpm run harness:ci
---

契约批处理、扫描缓存和类型检查改动来自主线 `e8d17d510` 至 `47303b189`
之间的 CI 文件增量。沿用既有 fixture、扫描范围及性能预算。
