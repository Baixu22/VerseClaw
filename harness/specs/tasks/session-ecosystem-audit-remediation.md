---
lifecycleStatus: archived
id: session-ecosystem-audit-remediation
title: Session ecosystem audit remediation (TF-0086 milestone)
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Declare the audit-remediation work of the TF-0086 milestone (created 2026-08-23 after the independent health audit of the TF-0079..TF-0084 chain). Step 1 (TF-0087) added the backgrounded-exec exit-notification generation guard and declared the accepted cross-generation semantics of detached task notifications. Step 2 (TF-0088) completed ownership declarations (the TF-0083 spec plus touchedAreas additions), recharacterized the TF-0084 inherited-dependency list, and re-verified the scoped candidate on the new declaration set.
touchedAreas:
  - harness/specs/tasks/session-ecosystem-audit-remediation.md
  - harness/specs/tasks/session-ecosystem-goal-wake-continuation.md
  - openclaw_runtime/src/agents/bash-tools.exec-runtime.ts
  - openclaw_runtime/src/agents/bash-tools.exec-generation-guard.test.ts
  - openclaw_runtime/src/agents/bash-tools.exec.ts
  - openclaw_runtime/src/gateway/methods/core-descriptors.ts
  - openclaw_runtime/src/gateway/session-ecosystem-lifecycle-reachability.test.ts
  - openclaw_runtime/src/gateway/session-ecosystem-descriptor-guard.test.ts
  - openclaw_runtime/src/gateway/session-reset-service.ts
  - openclaw_runtime/scripts/check-ts-max-loc.ts
  - harness/specs/tasks/session-ecosystem-resource-reclamation.md
  - scripts/tf0084-build-candidate.mjs
  - scripts/tf0084-candidate-inherited.json
  - docs/dev/handoffs/LATEST.md
  - artifacts/tf0078-generation-injection-remediation/report.json
expectedUserBehavior:
  - A backgrounded exec pinned to an old session generation never injects its exit notification or heartbeat wake into a post-reset/forked generation; missing pins and unresolved current generations keep legacy delivery (fail-open).
  - Accepted cross-generation semantics (detached task notifications, announce requester-agent handoff, restart-sentinel degraded wake, ACP parent-stream relay) are declared in the cross-session-control spec, never silently assumed.
  - Every chain-owned file is covered by a spec touchedAreas declaration, so the scoped candidate rebuilds and passes diff-aware harness validation on the declared boundary.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - runtime-lifecycle-governance-boundary
  - backend-communication-boundary
  - docs-sync
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/session-ecosystem-audit-remediation.md
  - pnpm harness validate --spec harness/specs/tasks/session-ecosystem-audit-remediation.md
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.agents-core.config.ts src/agents/bash-tools.exec-generation-guard.test.ts src/agents/subagent-announce-generation-pin.test.ts src/agents/subagent-announce-delivery.visible-reply.test.ts
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.gateway.config.ts src/gateway/session-ecosystem-lifecycle-reachability.test.ts src/gateway/session-ecosystem-descriptor-guard.test.ts src/gateway/session-ecosystem-production-reachability.test.ts
  - pnpm --dir openclaw_runtime run tsgo:core
  - pnpm --dir openclaw_runtime run check:import-cycles
  - pnpm run contract:check
  - pnpm run comms:replay
  - pnpm run comms:compare
  - git diff --check
acceptance:
  - The exit-notification generation guard is regression-fenced - its tests pass on the current tree and fail when the guard is removed (probe evidence recorded in the step report).
  - No existing guard is loosened; no product lock or default-off boundary is flipped.
  - Chain-owned files have zero undeclared ownership gaps on the current tree; the inherited list contains only genuine other-workstream dependencies.
  - The scoped candidate rebuilt from the new declaration set passes diff-aware harness validation.
docs:
  required: true
  files:
    - docs/dev/Sustained-Development-Playbook.md
---

# Session ecosystem audit remediation (TF-0086)

## Historical candidate tools

The `scripts/tf0084-build-candidate.mjs`, `scripts/tf0084-converge-candidate.mjs`
and `scripts/tf0084-candidate-inherited.json` paths identify the original
one-off candidate-building bundle. Keep them together in the local historical
archive; they are not current executable prerequisites of `requiredTests`.
The declarations and history below preserve their original ownership context.
Do not run the archived reset/clean/rebuild tools as part of artifact cleanup
or treat the historical candidate's result as current-head acceptance.

Declared boundary notes:

- `openclaw_runtime/src/agents/bash-tools.exec.ts` is a multi-workstream file: the chain
  owns exactly the one-line `sessionStore: defaults?.sessionStore` pass-through added by
  TF-0087; the remaining dirty hunks belong to the exec provenance-policy workstream.
- `scripts/tf0084-candidate-inherited.json` was recharacterized by TF-0088: it now lists
  only genuine other-workstream dependencies (TF-0072 lineage chain, DCS/SEKB bridges,
  git-api, session-activity-sidebar, content-provenance). The 26 formerly listed
  chain-owned files moved into spec `touchedAreas`; the stale `subagent-control.ts` entry
  (zero diff vs HEAD, already declared) was removed.
- Remediation steps never commit, push, or modify other workstreams' code.

## Dead-surface and no-UI decisions (TF-0091)

- `sessions.lifecycleLedger` is a read-only diagnostic RPC with **no UI planned**;
  this mirrors the documented `sessions.yieldState` precedent. A panel, if ever
  wanted, is a separate product decision.
- Deferred product surfaces (data layer stays ready): `yielded` row rendering and
  i18n keys, rendering of the Electron-supplemented `snapshot.terminals`, and any
  `idleClassification` consumer. The `CLAWX_TERMINAL_*_IDLE_MS` /
  `OPENCLAW_BASH_RUNNING_IDLE_MS` thresholds stay as the classification config
  surface (test-only path today, recorded honestly).
- Goal-wake child/timer arm surfaces (`fireGoalWaitChild`, `armGoalWaitTimer`,
  ledger lookups) stay intentionally unmounted; the mount point needs a
  generation-semantics decision by the owner (TF-0083 deviations). Goal-wake and
  durable helper remain default-off.
- Cleaned: the chain-introduced dead wrapper `archiveSessionTranscriptsForSession`
  (zero callers; the `Detailed` variant it wrapped has real callers and stays).
- Kept as-is: pre-existing dead code that is not chain-owned
  (`readLatestSessionUsageFromTranscript`, `readRecentSessionMessagesWithStats`,
  `clearSessionTranscriptIndexCache`, the `'verified'` subagent status), test-seam
  exports, the `task_kind='goal-owned-*'` durable marker, and the entry-level
  `lineage` ref wire surface.
