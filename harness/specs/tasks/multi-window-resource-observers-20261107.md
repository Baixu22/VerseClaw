---
lifecycleStatus: active
id: multi-window-resource-observers-20261107
title: 多窗口可见性与资源观察者生命周期
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: 5ad905b44c2822caf6037df9278a8a260a27d3f9
intent: 完成 TF-0832 / G17–G18，聚合窗口可见性并按观察者引用释放轮询，保留后台执行所有权。
expectedUserBehavior:
  - Hiding one window does not put another visible window into background shedding.
  - Closing a resource panel releases its observation while other observers and running tasks continue.
touchedAreas:
  - electron/services/efficiency-orchestrator.ts
  - openclaw_runtime/src/resources/background-work-gate.ts
  - src/lib/poll-scheduler.ts
  - src/stores/resource-tracker.ts
  - src/components/chat/ResourceChip.tsx
  - tests/unit/resource-window-lifecycle.test.ts
  - tests/unit/resource-observer-lifecycle.test.ts
  - tests/unit/resource-p1-schedulers.test.ts
  - tests/unit/runtime-efficiency-api.test.ts
  - tests/unit/resource-metrics-owner.test.ts
  - tests/e2e/resource-window-lifecycle.spec.ts
  - harness/specs/tasks/multi-window-resource-observers-20261107.md
  - harness/specs/rules/resource-observer-lifetime.md
  - harness/specs/fixtures/multi-window-resource-observers-20261107/**
requiredProfiles:
  - fast
  - comms
  - e2e
requiredRules:
  - backend-communication-boundary
  - resource-observer-lifetime
  - docs-sync
  - comms-regression
  - disk-temp-policy
  - repository-artifact-retention
  - task-forest-autoclose-and-roles
requiredTests:
  - node node_modules/vitest/vitest.mjs run tests/unit/resource-window-lifecycle.test.ts tests/unit/resource-observer-lifecycle.test.ts tests/unit/resource-p1-schedulers.test.ts tests/unit/runtime-efficiency-api.test.ts tests/unit/resource-metrics-owner.test.ts --maxWorkers=1
  - node node_modules/@playwright/test/cli.js test tests/e2e/resource-window-lifecycle.spec.ts --workers=1
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/multi-window-resource-observers-20261107.md
  - node harness/src/cli.mjs run --spec harness/specs/tasks/multi-window-resource-observers-20261107.md --dry-run
  - node scripts/comms/replay.mjs
  - node scripts/comms/compare.mjs
acceptance:
  - After integrating TF-0821, real Electron main and browser windows pass hide, show, minimize, restore, close and reopen coverage.
  - Visibility is aggregated across live windows; one hidden window cannot override another visible window, and closed windows remove their own listeners.
  - Start/stop/restart keeps one set of power listeners and polling owners, and late async results from a stopped generation cannot alter current state.
  - Resource panel observers share one poll per renderer, each release is idempotent, and the last release removes timers and listeners without stopping execution.
  - Hidden surfaces issue no polling or shed-status reads; restored surfaces refresh; rejected tasks do not poison subsequent polling.
  - Native Electron evidence records subscriber, poll and control-request counts and proves an existing background run survives observer release.
  - A clean candidate records positive and old-source negative tests, lint, types, communication checks, dependency provenance, source hashes and a zero-hit credential scan.
docs:
  required: true
  readmeTranslations: not-required
  paths:
    - harness/specs/rules/resource-observer-lifetime.md
---

本节点延续既有 EfficiencyPowerPolicy、TimerAligner、renderer poll scheduler 和 ResourceStore。
TF-0821 的整合与真实主窗/浏览器窗验收是收口条件。单元回归完成后先提交可审阅代码；
完整候选与 Electron 证据齐备后更新节点完成状态。
界面文案、配置默认值和用户操作入口保持既有合同，内部生命周期写入配套规则。
