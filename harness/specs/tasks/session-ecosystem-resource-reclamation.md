---
id: session-ecosystem-resource-reclamation
title: Session ecosystem resource reclamation (terminal, process, subagent)
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Close the TF-0081 gaps where terminals, background processes, and subagent records survive reset/delete/restart without a unified owner, idle, TTL, or reconciliation policy, while never killing resources with real child activity.
touchedAreas:
  - harness/specs/tasks/session-ecosystem-resource-reclamation.md
  - openclaw_runtime/src/process/os-containment.ts
  - openclaw_runtime/src/process/supervisor/supervisor.ts
  - openclaw_runtime/src/process/supervisor/types.ts
  - openclaw_runtime/src/process/supervisor/registry.ts
  - openclaw_runtime/src/process/supervisor/run-manifest.ts
  - openclaw_runtime/src/process/supervisor/reconcile.ts
  - openclaw_runtime/src/process/supervisor/restart-reconciliation.test.ts
  - openclaw_runtime/src/agents/bash-process-registry.ts
  - openclaw_runtime/src/agents/bash-process-registry.idle-classification.test.ts
  - openclaw_runtime/src/agents/subagent-registry.ts
  - openclaw_runtime/src/gateway/session-drain-service.ts
  - openclaw_runtime/src/gateway/session-reset-service.ts
  - openclaw_runtime/src/gateway/server.impl.ts
  - openclaw_runtime/src/gateway/server-methods/session-activity-projection.ts
  - openclaw_runtime/src/gateway/server-methods/session-activity-projection.test.ts
  - openclaw_runtime/src/gateway/session-ecosystem-reclamation-cycle.test.ts
  - electron/services/terminal-session-manager.ts
  - electron/services/terminal-api.ts
  - electron/services/sessions-api.ts
  - electron/services/session-activity-api.ts
  - tests/unit/terminal-session-manager.test.ts
  - tests/unit/r0-3-terminal-session-reclaim.test.ts
  - tests/e2e/runtime-lifecycle-governance.spec.ts
  - artifacts/session-ecosystem-resource-reclamation/report.json
  - docs/dev/handoffs/LATEST.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - Sessions cycled through create/stop/reset/delete leave zero active records, timers, owned PIDs, PTY records, and child links across bash registry, supervisor, subagent registry, and Electron terminals.
  - An idle policy distinguishes running process, interactive terminal, completed record, and orphaned record; wall-clock inactivity never kills a terminal with real child-process activity.
  - Completed/failed records are bounded (TTL or count) so long idle sessions do not leak memory, handles, PTYs, or run records.
  - Gateway restart reconciles previously-active runs fail-closed; unverifiable OS containment never widens to PID fallback.
  - The session activity snapshot only projects real owner-registry state and never shows recycled resources.
  - Keep-mode subagent records and VerseShell ownership boundaries are preserved unchanged.
requiredProfiles:
  - fast
  - comms
  - e2e
requiredRules:
  - runtime-lifecycle-governance-boundary
  - backend-communication-boundary
  - comms-regression
  - docs-sync
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/session-ecosystem-resource-reclamation.md
  - pnpm harness validate --spec harness/specs/tasks/session-ecosystem-resource-reclamation.md
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.gateway.config.ts src/gateway/session-ecosystem-reclamation-cycle.test.ts src/gateway/session-drain-service.test.ts
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.process.config.ts src/process/supervisor/restart-reconciliation.test.ts
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.agents-core.config.ts src/agents/bash-process-registry.idle-classification.test.ts
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.gateway-methods.config.ts src/gateway/server-methods/session-activity-projection.test.ts
  - pnpm exec vitest run tests/unit/terminal-session-manager.test.ts tests/unit/r0-3-terminal-session-reclaim.test.ts tests/unit/terminal-api.test.ts --maxWorkers=1
  - pnpm run typecheck
  - pnpm run contract:check
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm run test:e2e:run tests/e2e/runtime-lifecycle-governance.spec.ts
  - git diff --check
acceptance:
  - A 50-cycle create/spawn/stop/reset/delete fixture reports zero active records, live timers, owned PIDs, PTY records, and child links after the final cycle, reproducible on Windows.
  - Idle classification exists for running process, interactive terminal, completed record, and orphaned record, and is configurable without code changes where a policy value is involved.
  - A terminal whose child process still produces output is never reclaimed by wall-clock inactivity alone (false kill = 0).
  - Supervisor exited records and bash finished records stay bounded; no unbounded finished-record growth across cycles.
  - Restart reconciliation of previously-active runs fails closed when OS containment is unverifiable and never expands scope via PID fallback.
  - The session activity projection matches the owning registries and never lists reclaimed resources.
  - No universal resource ledger is introduced; keep-mode subagent records and VerseShell owner boundaries remain unchanged.
docs:
  required: true
  files:
    - docs/dev/handoffs/LATEST.md
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
---

# Session ecosystem resource reclamation (terminal, process, subagent)

This is the single TF-0081 implementation slice. It unifies owner, activity, TTL,
exit, restart, and session-drain semantics for terminal PTYs, ordinary exec
processes, supervisor runs, and subagent records. It does not build a universal
resource ledger, does not close terminals immediately on session switch, and
does not replace VerseShell ownership.

## Scope

- Existing owners stay the single writers: Electron `TerminalSessionManager`,
  runtime process supervisor, bash process registry, subagent registry sweeper,
  and the Phase 1 cleanup finalizer / drain pipeline.
- Add a 50-cycle reclamation fixture that cycles sessions through
  create/spawn/stop/reset/delete and asserts zero active residual across owners.
- Classify terminal/process records (running, interactive, completed, orphaned)
  without reclaiming anything with real child activity.
- Reconcile supervisor runs after runtime restart fail-closed, reusing the
  drain service's OS containment verification rather than PID fallback.

## Failure matrix

The focused matrix must cover, at minimum:

| Case | Required result |
| --- | --- |
| 50-cycle create/spawn/stop/reset/delete | active records, timers, owned PIDs, PTY records, child links all zero |
| terminal idle beyond TTL, no child activity | classified idle; any policy action is explicit and configurable |
| terminal idle but child still producing output | never reclaimed (running process) |
| completed/failed bash record | TTL-bounded removal (default 30min) |
| supervisor exited records | bounded by count/TTL, no unbounded growth |
| gateway restart with previously-active runs | orphan reconciliation, fail-closed |
| OS containment unverifiable | fail closed with reason; no PID fallback expansion |
| keep-mode subagent record | preserved (boundary, not a leak) |

## Non-goals

- No universal resource ledger.
- No immediate terminal close on session switch (keep-on-leave stays).
- No VerseShell owner replacement.
- No Goal-wake/durable-helper implementation change beyond reading existing state.

## Measurement bounds (TF-0092 formal decision)

The 50-cycle reclamation fixture asserts active records, live timers, owned PIDs
(including descendants), and bounded finished/diagnostics records. Two
dimensions named in the original TF-0081 requirement text are formally
out-of-scope for this spec, with reasons:

- File-descriptor / handle leaks: measuring FD counts requires OS-level
  instrumentation outside the runtime gate surface (no portable Node API).
  The residual dimensions the fixture does assert (records, timers, owned
  PIDs) cover the reclamation contract; FD risk remains bounded by the
  finished-record caps the fixture verifies. Re-open only if an FD leak is
  observed in production evidence.
- RSS-level memory growth: only bounded finished-record growth is asserted;
  long-horizon RSS sampling is a soak-test concern, not a per-change gate.

Both exclusions are recorded here as the formal decision (previously they were
listed as "not covered" in reports without a spec-level ruling).
