---
lifecycleStatus: active
id: mixed-resource-acceptance-20261108
title: 冻结并执行多窗口多智能体混合负载对照
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: 431144c6fda4b74a623160453c0cf8279f72297f
intent: 完成 TF-0838 / G33，固定旧基线和整合候选，在真实Electron中执行相同混合工作及输入滚动测量。
expectedUserBehavior:
  - Identical mixed work is measured at one and two windows with one, four and eight agent-driven workers.
  - Raw completion, input, scrolling, process and memory observations support paired throughput and tail-latency decisions.
touchedAreas:
  - tests/e2e/resource-mixed-load.spec.ts
  - tests/unit/resource-mixed-measurement.test.ts
  - scripts/verify-resource-mixed-load.mjs
  - scripts/capture-resource-builds.mjs
  - scripts/lib/resource-mixed-measurement.mjs
  - playwright.resource-governance.config.ts
  - harness/specs/tasks/mixed-resource-acceptance-20261108.md
  - harness/specs/rules/resource-mixed-measurement.md
  - harness/specs/fixtures/resource-mixed-load-20261108/**
  - docs/modules/resources-and-observability.md
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - resource-mixed-measurement
  - disk-temp-policy
  - repository-artifact-retention
  - task-forest-autoclose-and-roles
  - comms-regression
requiredTests:
  - node node_modules/vitest/vitest.mjs run tests/unit/resource-mixed-measurement.test.ts --maxWorkers=1
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/mixed-resource-acceptance-20261108.md
  - node harness/src/cli.mjs run --spec harness/specs/tasks/mixed-resource-acceptance-20261108.md --dry-run
  - node scripts/comms/replay.mjs
  - node scripts/comms/compare.mjs
  - git diff --check
acceptance:
  - Freeze baseline c7573ec11095b541f3a4a9c5470bf4e0727489bc and the integrated source candidate, shared test driver and fixture hashes; record installed dependency reuse, machine resources, command order and build provenance.
  - Run ABBA at each combination of one/two actual Electron windows and one/four/eight scripted workers on the existing Fabric owner. Complete identical remote-wait, retrieval, Git, log-output and heavy execution work with receipt checks.
  - Measure native renderer keyboard-to-frame latency, scrolling and long tasks during the mixed workload; preserve draft, visible result and screenshot evidence.
  - Retain raw queued/service/end-to-end timings, throughput, CPU/RSS/private/system commit, child spawn/exit and Windows handles; recompute P50/P95 and comparisons independently.
  - Retain every failed attempt, timeouts, unavailable observations and rejected configurations. Accept benefit or an explicit measured reject decision without changing product defaults.
  - Run the driver on a clean candidate, focused tests/types/lint/comms/Harness, read every final report and manifest, and merge before Task Forest closure.
docs:
  required: true
  readmeTranslations: not-needed
  paths:
    - docs/modules/resources-and-observability.md
---

模拟agent使用真实Main ResourceFabric account和租户，执行固定本地工作；UI使用冻结历史和stream输入。
远端等待由本地HTTP延迟服务自动模拟，标driven_by: agent。测量受控并发、窗口与资源治理行为。
副窗口使用已有可见浏览器入口；主窗口继续输入和滚动。独立验收目录、端口与profile全部写D:。
