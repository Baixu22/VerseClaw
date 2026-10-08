---
id: session-ecosystem-lifecycle-ledger-acceptance
title: Session ecosystem lifecycle ledger, activity projection and real closed-loop acceptance
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Close the TF-0084 gap where each lifecycle owner (session store, run registry, mission, goal-wake flow, goal-owned task, bash registry, supervisor, durable helper, subagent registry, Electron terminal) records its own transitions but nothing joins them into one read-only ledger with owner and generation, so "the code exists" cannot be separated from "the lifecycle really closes" on the current HEAD.
touchedAreas:
  - harness/specs/tasks/session-ecosystem-lifecycle-ledger-acceptance.md
  - openclaw_runtime/src/gateway/server-methods/session-lifecycle-owner-views.ts
  - openclaw_runtime/src/gateway/server-methods/session-lifecycle-ledger.ts
  - openclaw_runtime/src/gateway/server-methods/session-lifecycle-ledger.test.ts
  - openclaw_runtime/src/gateway/server-methods/session-lifecycle-consistency.test.ts
  - openclaw_runtime/src/gateway/server-methods/sessions.run-control.ts
  - openclaw_runtime/src/gateway/server-methods/session-activity-projection.ts
  - openclaw_runtime/src/gateway/server-methods/session-activity-projection.test.ts
  - openclaw_runtime/src/gateway/server-methods.ts
  - openclaw_runtime/src/gateway/methods/core-descriptors.ts
  - openclaw_runtime/src/gateway/session-ecosystem-lifecycle-reachability.test.ts
  - scripts/tf0084-build-candidate.mjs
  - scripts/tf0084-candidate-inherited.json
  - scripts/tf0084-converge-candidate.mjs
  - openclaw_runtime/packages/gateway-protocol/src/schema/sessions.ts
  - openclaw_runtime/packages/gateway-protocol/src/schema/protocol-schemas.ts
  - openclaw_runtime/packages/gateway-protocol/src/schema/types.ts
  - openclaw_runtime/packages/gateway-protocol/src/index.ts
  - tests/e2e/runtime-lifecycle-governance.spec.ts
  - artifacts/session-ecosystem-lifecycle-ledger-acceptance/report.json
  - docs/dev/handoffs/LATEST.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - Every projected session/run/task/flow/helper/terminal/subagent transition names the owner that recorded it and either carries the generation the owner pinned or states why that owner records none; unexplained transitions are 0.
  - The read-only lifecycle ledger is reachable over the real production Gateway registry (handler, descriptor, advertised scope) and is not a test-only helper.
  - The session activity projection and the lifecycle ledger agree with the owning registries; neither invents a record the owner does not have, and neither hides an owner record without an explicit reason.
  - The acceptance report binds every claim to a command, exit code, test count, artifact path and the HEAD it ran on, and never reuses an earlier audit number as a current result.
  - Engineering acceptance stays separated from human, live and product approval; synthetic fixtures are never reported as live-ready.
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
  - pnpm harness context --spec harness/specs/tasks/session-ecosystem-lifecycle-ledger-acceptance.md
  - pnpm harness validate --spec harness/specs/tasks/session-ecosystem-lifecycle-ledger-acceptance.md
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.gateway-methods.config.ts src/gateway/server-methods/session-lifecycle-ledger.test.ts src/gateway/server-methods/session-lifecycle-consistency.test.ts src/gateway/server-methods/session-activity-projection.test.ts
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.gateway.config.ts src/gateway/session-ecosystem-lifecycle-reachability.test.ts src/gateway/session-ecosystem-production-reachability.test.ts src/gateway/session-ecosystem-reclamation-cycle.test.ts
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.process.config.ts src/process/supervisor/restart-reconciliation.test.ts
  - node scripts/runtime-lifecycle-goal-wake-canary.mjs
  - node scripts/verify-runtime-lifecycle-packaged-electron.mjs
  - pnpm run typecheck
  - pnpm run contract:check
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm run build:runtime
  - pnpm run test:e2e:run tests/e2e/runtime-lifecycle-governance.spec.ts
  - git diff --check
acceptance:
  - One read-only lifecycle ledger joins the existing owners for a session and reports, per entry, the owner, the subject kind, the transition, the correlation ref, and either the pinned generation or a declared structural reason for its absence.
  - The ledger census reports unexplainedTransitions=0 on real owner data; an owner that silently records neither generation nor reason makes the census fail rather than pass.
  - The ledger introduces no writer, no second session identity source, and no universal resource ledger; it only reads owner read models.
  - Every lifecycle Gateway method declared by this workstream resolves to a real handler plus an advertised core descriptor with the intended scope, proven by dispatching through the production registry.
  - The full scoped acceptance report is reproducible from a clean or detached candidate at the recorded HEAD, and any environment blocker is recorded as blocked/review_needed instead of being counted as a pass.
  - The report separates engineering acceptance from human, live and product approval and keeps liveReady=false, productApproved=false, formalAcceptance=false.
  - TF-0010 and TF-0077 history plus the successor boundary stay consistent across the handoff, Task Forest, this spec and the docs.
docs:
  required: true
  files:
    - docs/dev/Sustained-Development-Playbook.md
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
---

# Session ecosystem lifecycle ledger, activity projection and real closed-loop acceptance

The TF-0084 `build-candidate`, `converge-candidate` and inherited-dependency
files listed in `touchedAreas` are a historical, local-only reconstruction
bundle, not a current gate entrypoint. Preserve their original bytes together
for explicit historical replay. Current validation uses the maintained
`requiredTests` above; it must not run the archived worktree reset/clean scripts
or reuse their candidate-bound verdicts for a new checkout.

This is the TF-0084 milestone: the final node under TF-0078. TF-0079 made the
lifecycle RPCs production-reachable, TF-0080 fenced the safety gates, TF-0081
reclaimed terminal/process/subagent resources, TF-0082 unified cross-session
control and lineage, and TF-0083 closed goal/loop conditional wake, cancel
cascade and timer continuation. What is still missing is a single read-only view
that proves the transitions those owners record actually join up, plus a fresh
acceptance report bound to the current HEAD.

## Scope

Existing owners stay the only writers. Nothing here creates a lifecycle writer,
a second identity source, or a universal resource ledger (the TF-0081 non-goal).

- Owner path 1: read-only lifecycle ledger. A new projection joins the session
  entry generation, mission runs, goal-wake flow runs, goal-owned task runs, the
  bash process registry, the process supervisor, and the subagent registry into
  one ordered list of transitions. Each entry names its owner and carries the
  `SessionActivityLineageRef` correlation shape from TF-0082. The generation is
  copied from the owner that pinned it; when an owner records none, the entry
  declares the structural reason instead, so the census can assert
  `unexplainedTransitions=0` without hiding a real gap. Exposed as
  `sessions.lifecycleLedger` (`operator.read`), modelled on the TF-0082
  `sessions.yieldState` read surface: no arm, no mutation, fail-closed on a
  generation mismatch.
- Owner path 2: lifecycle method registry census and owner-snapshot gap probe.
  Generalises the TF-0079 reachability probe from one method to the whole
  lifecycle surface, and asserts the ledger, the activity projection and the
  owning registries describe the same set of records.
- Owner path 3: fresh acceptance evidence matrix on the current HEAD — real
  registry reachability, real OS process tree, records/timers/PID drain,
  restart/cancel/unknown-RPC matrix, Cron-triggered continuation and duplicate
  wake — written to
  `artifacts/session-ecosystem-lifecycle-ledger-acceptance/report.json` with
  command, exit code, test count, artifact path and HEAD/base/tree state per
  claim.
- Owner path 4: evidence grading and history consistency. The report keeps
  engineering acceptance separate from human/live/product approval, and the
  TF-0010/TF-0077 history and successor boundary stay consistent across the
  handoff, Task Forest, this spec and the docs.

## Failure matrix

The focused matrix must cover, at minimum:

| Case | Required result |
| --- | --- |
| owner records a generation pin (bash/supervisor/subagent/mission) | entry carries that generation verbatim, not derived from another id |
| owner records no generation (goal-wake flow, goal-owned task) | entry declares the structural reason; census still counts it as explained |
| owner records neither generation nor a declared reason | census reports it as unexplained and the assertion fails |
| terminal owner lives outside the runtime process | entry is declared out-of-process rather than silently dropped |
| legacy subagent run with no spawn-time pin | declared as legacy-unpinned, never reported as pinned |
| ledger request with a stale `expectedSessionId` | fail closed with `generation-mismatch`; no owner read is reported |
| read model throws mid-collection | degrades to an empty/partial census, never a fabricated entry |
| lifecycle RPC declared without handler, descriptor or advertisement | reachability census fails |
| overlong or empty correlation id | dropped instead of projected |

## Non-goals

- No lifecycle writer, no second session identity source, no universal resource
  ledger.
- No arm/cancel mutation surface added for yield, goal-wait or continuation.
- No default-on flip for goal-wake or durable helper.
- No real channel, human recovery cohort, or product approval; no synthetic
  fixture upgraded to live-ready.
- No cleanup of unrelated dirty-worktree changes owned by other workstreams.
