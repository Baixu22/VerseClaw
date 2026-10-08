---
id: runtime-lifecycle-governance-ga-hardening
title: Runtime Lifecycle Governance GA hardening — packaged Electron proof, real-process canary, and RLG-only clean acceptance
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Close the RLG-only engineering gaps that remain after Phase 0-6 closeout: prove the durable helper entry inside a real Electron binary, repeat the real-process goal-wake trace as a canary, and produce an RLG-only acceptance that is not conditioned on other workstreams' dirty files. No default-on flip and no product-lock change is authorized here.
touchedAreas:
  - harness/specs/tasks/runtime-lifecycle-governance-ga-hardening.md
  - scripts/verify-runtime-lifecycle-packaged-electron.mjs
  - scripts/runtime-lifecycle-goal-wake-canary.mjs
  - package.json
  - artifacts/runtime-lifecycle-governance/future-work.json
  - artifacts/runtime-lifecycle-governance/ga-acceptance.json
  - artifacts/runtime-lifecycle-governance/ga-acceptance.md
  - docs/dev/runtime-lifecycle-governance/README.zh-CN.md
  - docs/dev/handoffs/LATEST.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - Ordinary Chat and `background=true` default behavior remain byte-for-byte unchanged.
  - goal-wake and durable-helper flags remain default-off with their existing kill switches.
  - VerseShell locks remain `default-off`, `liveReady=false`, `productApproved=false`.
  - The durable helper can be launched by the built runtime entry inside a real Electron binary in `ELECTRON_RUN_AS_NODE` mode, and still fail-closes when the entry cannot be resolved.
  - Ten repeated real OS process cycles through the goal-wake arm/spawn/finalize/wake path record zero `process.poll` calls, one tick for two duplicate deliveries, and flag-off parity on every cycle.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - runtime-lifecycle-governance-boundary
  - backend-communication-boundary
  - renderer-main-boundary
  - contract-first-boundary
  - active-config-guards
  - comms-regression
  - docs-sync
forbiddenPatterns:
  - Flipping goal-wake, durable-helper, or mission-fencing defaults on.
  - Modifying liveReady, productApproved, defaultOn, or any VerseShell product lock.
  - Reopening frozen Phase 0-5 scope or modifying runtime/UI behavior.
  - Cleaning or modifying other workstreams' dirty WIP.
  - Persisting raw command, argv, cwd, env, or secret text in the durable helper protocol.
  - Claiming joint-system GA or presenting synthetic evidence as human/live canary evidence.
featureFlags:
  - RUNTIME_LIFECYCLE_MISSION_FENCING_ENABLED
  - RUNTIME_LIFECYCLE_GOAL_WAKE_ENABLED
  - RUNTIME_LIFECYCLE_DURABLE_HELPER_ENABLED
  - Existing flags remain opt-in and independently fail-closed.
rollback:
  - The only executable changes in this spec are verification scripts and evidence; removing or disabling the new package scripts restores the prior state with no runtime effect.
  - Flag-off path parity remains asserted by the goal-wake trace on every canary cycle.
requiredTests:
  - pnpm harness validate --spec harness/specs/tasks/runtime-lifecycle-governance-ga-hardening.md --no-diff
  - pnpm run build:runtime
  - pnpm run build:vite
  - node scripts/verify-runtime-lifecycle-packaged-electron.mjs
  - node scripts/runtime-lifecycle-goal-wake-canary.mjs
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.agents.config.ts src/agents/mission-control/goal-wake.test.ts src/agents/goal-wake-runtime.test.ts src/agents/tools/goal-wait-tool.test.ts src/agents/bash-tools.exec.goal-wait.test.ts src/agents/mission-control/fenced-tick-wiring.test.ts
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.agents.config.ts src/agents/process-run-reconciler.test.ts src/agents/goal-wake-helper-protocol.test.ts src/agents/goal-wake-helper-host.test.ts src/agents/goal-wake-durable-cleanup.test.ts src/agents/goal-wake-recovery.test.ts src/agents/bash-tools.exec.durable-helper.test.ts
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.gateway-methods.config.ts src/gateway/server-methods/session-activity.test.ts src/gateway/server-methods/session-activity-projection.test.ts
  - pnpm exec vitest run tests/unit/runtime-lifecycle-governance.test.ts --maxWorkers=1
  - unset ELECTRON_RUN_AS_NODE && pnpm run test:e2e:run tests/e2e/runtime-lifecycle-governance.spec.ts
  - pnpm exec vitest run tests/unit/session-activity-panel.test.tsx --maxWorkers=1
  - pnpm run runtime-lifecycle-audit --phase all
  - pnpm run typecheck
  - pnpm run lint:check
  - pnpm run contract:check
  - pnpm run comms:replay
  - pnpm run comms:compare
  - git diff --check
acceptance:
  - Packaged-Electron proof passes both normal-exit and cancel cycles; started.json/exit.json/control.json/heartbeat.json contain no raw payload text; the script exits 0.
  - The ten-cycle canary exits 0; every cycle has processPollToolCalls=0, duplicateWakeTickCount=1, flagOffGoalWaitBlocked=true, flagOffBackgroundDefaultUnchanged=true.
  - RLG-only changed paths pass scoped whitespace and write-path checks; no unrelated worktree file is claimed as RLG evidence.
  - audit-0..6 all remain PASS score=100.
  - future-work.json moves packaged-electron-live-verification to deliveredItems with the new evidence and leaves frozen phases untouched.
  - All product locks and default-off flags are byte-identical after the work.
docs:
  required: true
  files:
    - docs/dev/runtime-lifecycle-governance/README.zh-CN.md
    - docs/dev/Sustained-Development-Playbook.md
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
---

# Runtime Lifecycle Governance GA Hardening

本包只做 RLG 自身的 GA 证据硬化，不重开 Phase 0-5，不翻 default-on，不碰 VerseShell
产品锁。它回答三个缺口：

1. Phase 4 的 durable helper 在 packaged Electron / `ELECTRON_RUN_AS_NODE` 下的真实入口
   还没有独立证据。
2. goal-wake 的真进程 trace 只跑过一次，缺少重复周期的 canary 证据。
3. 全量验收带 `PASS_WITH_RESIDUAL` 是因为共享脏工作树里其它 workstream 的文件；RLG-only
   验收需要把范围收窄到本程序文件集合并单独证明干净。

## Scope

- 新增 `scripts/verify-runtime-lifecycle-packaged-electron.mjs`：用仓库安装的 Electron
  二进制以 `ELECTRON_RUN_AS_NODE=1` 启动 `openclaw_runtime/dist/entry.js
  goal-wake-helper-run <runId>`，执行 normal-exit 与 cancel 两个真实周期，并校验文件协议
  不落盘 raw argv/env/cwd/secret。
- 新增 `scripts/runtime-lifecycle-goal-wake-canary.mjs`：串行重跑现有
  `openclaw_runtime/scripts/goal-wake-e2e-trace.ts` 十个周期，聚合每个周期的
  `processPollToolCalls` / `duplicateWakeTickCount` / flag-off parity 审计行。
- 更新 `package.json` 的 `verify:runtime-lifecycle-ga` 组合入口。
- 更新 `future-work.json`、RLG README、handoff LATEST 和三份 README 的 RLG 状态行。

## Not in scope

- 不把 goal-wake / durable-helper / mission-fencing 改为默认开启。
- 不修改 liveReady / productApproved / defaultOn。
- 不实现 multi-dependency waits、command chains、timer waits、cross-gateway recovery、
  incremental push、panel actions 或其它 deferred items。
- 不清理或评价其它 workstream 的 WIP。

## Acceptance evidence

- `artifacts/runtime-lifecycle-governance/ga-acceptance.json`
- `artifacts/runtime-lifecycle-governance/ga-acceptance.md`
