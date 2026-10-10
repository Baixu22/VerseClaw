---
lifecycleStatus: archived
id: runtime-lifecycle-governance
title: Runtime lifecycle governance — one program for session cleanup, goal durable process wake, and quantitative acceptance gates
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Deliver one bounded development program that closes session/goal lifecycle gaps with explicit phases, hard scope boundaries, and quantitative acceptance gates. It merges session lifecycle governance and goal loop durable process wake into a single executable spec.
touchedAreas:
  - harness/specs/tasks/runtime-lifecycle-governance.md
  - scripts/check-runtime-lifecycle-audit.mjs
  - harness/specs/rules/runtime-lifecycle-governance-boundary.md
  - openclaw_runtime/src/sessions/session-admission-registry.ts
  - openclaw_runtime/src/gateway/session-delete-operation-journal.ts
  - openclaw_runtime/src/gateway/session-reset-service.ts
  - openclaw_runtime/src/gateway/server-methods/sessions.lifecycle.ts
  - openclaw_runtime/src/gateway/server-methods/chat.ts
  - openclaw_runtime/src/gateway/server-methods/session-activity.ts
  - openclaw_runtime/src/agents/bash-process-registry.ts
  - openclaw_runtime/src/process/supervisor/supervisor.ts
  - openclaw_runtime/src/process/supervisor/types.ts
  - openclaw_runtime/src/config/sessions/store-sqlite.ts
  - openclaw_runtime/src/state/openclaw-agent-schema.sql
  - openclaw_runtime/src/state/openclaw-state-schema.sql
  - openclaw_runtime/packages/gateway-protocol/src/schema/sessions.ts
  - openclaw_runtime/src/tasks/task-flow-cas.ts
  - openclaw_runtime/src/tasks/task-flow-registry.ts
  - openclaw_runtime/src/tasks/task-flow-registry.store.sqlite.ts
  - openclaw_runtime/src/tasks/task-registry.ts
  - openclaw_runtime/src/tasks/task-registry.store.sqlite.ts
  - openclaw_runtime/src/tasks/task-registry.maintenance.ts
  - openclaw_runtime/src/agents/mission-control/controller.ts
  - openclaw_runtime/src/agents/mission-control/store.ts
  - openclaw_runtime/src/agents/goal-wake-controller.ts
  - openclaw_runtime/src/agents/process-run-reconciler.ts
  - openclaw_runtime/src/agents/goal-wake-helper-protocol.ts
  - openclaw_runtime/src/agents/goal-wake-helper-entry.ts
  - openclaw_runtime/src/agents/goal-wake-helper-host.ts
  - openclaw_runtime/src/agents/goal-wake-recovery.ts
  - openclaw_runtime/src/agents/goal-wake-durable-cleanup.ts
  - openclaw_runtime/src/agents/goal-wake-helper-protocol.test.ts
  - openclaw_runtime/src/agents/process-run-reconciler.test.ts
  - openclaw_runtime/src/agents/goal-wake-helper-host.test.ts
  - openclaw_runtime/src/agents/goal-wake-durable-cleanup.test.ts
  - openclaw_runtime/src/agents/bash-tools.exec.durable-helper.test.ts
  - openclaw_runtime/src/agents/goal-wake-recovery.test.ts
  - openclaw_runtime/src/entry.ts
  - openclaw_runtime/src/gateway/server.impl.ts
  - artifacts/runtime-lifecycle-governance/phase4-loc-accounting.mjs
  - artifacts/runtime-lifecycle-governance/dead-code-caller-map-phase4.json
  - artifacts/runtime-lifecycle-governance/phase4-timing-baseline.json
  - openclaw_runtime/src/agents/tools/goal-wait-tool.ts
  - openclaw_runtime/src/agents/tools/sessions-yield-tool.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.sessions-yield.ts
  - electron/services/sessions-api.ts
  - electron/services/session-activity-api.ts
  - electron/services/terminal-session-manager.ts
  - electron/services/terminal-api.ts
  - electron/gateway/manager.ts
  - shared/host-api/contract.ts
  - shared/types/session-activity.ts
  - src/stores/session-activity.ts
  - tests/unit/runtime-lifecycle-governance.test.ts
  - vitest.config.ts
  - tests/e2e/runtime-lifecycle-governance.spec.ts
  - docs/dev/runtime-lifecycle-governance/README.zh-CN.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - Session reset/delete never races new sends, queue drains, subagent spawns, process spawns, goal waits, or terminal opens for the same session generation.
  - Session delete is fail-closed and returns a committed receipt only after the per-agent SQLite transaction committed.
  - Switching conversations keeps user-started terminals; explicit End/delete/reset/permission/workspace/quit closes them.
  - Goal-owned background processes can sleep a mission and wake the next tick without process polling; duplicate wake delivery produces no duplicate side effects.
  - Ordinary Chat and default exec/process behavior remain unchanged unless explicit feature gates enable the new paths.
requiredProfiles:
  - fast
  - comms
  - e2e
requiredRules:
  - runtime-lifecycle-governance-boundary
  - backend-communication-boundary
  - renderer-main-boundary
  - api-client-transport-policy
  - contract-first-boundary
  - runtime-local-ecosystem-boundary
  - chat-loop-boundary
  - active-config-guards
  - comms-regression
  - docs-sync
requiredTests:
  - pnpm exec vitest run tests/unit/runtime-lifecycle-governance.test.ts
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.agents.config.ts src/sessions/session-admission-registry.test.ts src/gateway/session-delete-operation-journal.test.ts src/tasks/task-flow-cas.test.ts src/agents/mission-control/goal-wake.test.ts
  - pnpm run typecheck
  - pnpm --dir openclaw_runtime test:coverage:changed
  - pnpm run contract:check
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm run test:e2e:run tests/e2e/runtime-lifecycle-governance.spec.ts
acceptance:
  - The 50-cycle leak gate measures retained heap after explicit GC in Node workers, fails if GC is unavailable, and keeps the 2 MiB limit plus registry/timer/process checks; allocation-pressure minima are not treated as completed collection.
  - Every phase below has entry criteria, exit criteria, not-in-scope list, and quantitative audit numbers. No phase may start before the previous phase's audit report is green and validates with `scripts/check-runtime-lifecycle-audit.mjs`.
  - New runtime modules meet coverage, cycle, dead-code, and line budget gates defined in the Quantitative Audit System.
  - No universal resource ledger, no desired-state controller, no second lifecycle writer is introduced.
  - Duplicate wake delivery does not duplicate side effects; process restart never replays commands; session delete never sweeps after failure or unknown RPC outcome.
  - All product locks remain unchanged.
docs:
  required: true
  files:
    - docs/dev/runtime-lifecycle-governance/README.zh-CN.md
    - docs/dev/session-lifecycle-control-plane/DESIGN.zh-CN.md
    - docs/dev/session-lifecycle-control-plane/EVIDENCE-CHAIN.zh-CN.md
    - docs/dev/goal-loop-durable-process-wake-design.md
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
---

# Runtime Lifecycle Governance

This is the single executable development spec for session lifecycle governance and goal durable
process wake. It replaces the former two separate task specs. The boundary rule
`harness/specs/rules/runtime-lifecycle-governance-boundary.md` is the hard contract for every phase.

## Scope And Non-Goals

In scope:

- Session admission, cleanup finalizer, delete operation journal, terminal lifecycle, read model.
- Goal-owned durable process runs, goal waits, mission fencing, same-gateway wake loop, restart
  reconciliation.
- Quantitative acceptance and dead-code/coverage/performance evidence.

Not in scope (do not implement in any phase unless a later approved spec adds it):

- Universal resource ledger, desired-state controller, or reconciliation loop for chat sessions.
- Multi-dependency goal waits, command chains, timer waits, agent-turn continuation beyond mission
  tick.
- Renderer/UI changes before Phase 5.
- Cross-machine or multi-process scale-out guarantees.
- VerseShell default-on, GA, or product-lock changes.

## Phase 0 — Shared Foundation

Entry criteria:

- Spec and rule validate with `pnpm harness validate --spec ... --no-diff`.
- `harness context` read list is confirmed.
- Current baseline evidence captured: targeted test timing, coverage numbers where available,
  import-cycle report (both checkers, with the 9 pre-existing madge components recorded as the
  baseline allowlist), and a dead-code caller map for touched areas (`deadcode:report` is not
  runnable and must not be used as a gate).

Scope:

- `SessionAdmissionRegistry` process-level singleton with `acquirePermit`, `fence`, `removeFence`;
  identity is `agentId + canonicalSessionKey + expectedSessionId`.
- Permit checks at every side-effect entry point listed in the boundary rule.
- `flow_runs` SQL CAS writer for `controller_id="goal-wake"` with the legal transition graph and
  required indexes.
- Mission fencing columns and CAS/fence writes: `revision`, `active_tick_id`, `last_wake_id`.
- Operation journal primitive (types and transaction helper only; no delete behavior yet).

Exit criteria:

- Unit tests pass for admission races, fence-vs-spawn TOCTOU, flow CAS transitions, and mission
  stale-writer rejection.
- No user-visible behavior changes; all new paths default-off.
- Quantitative audit report for this phase is green.

Not in scope: cleanup implementation, Electron changes, durable helper, UI.

## Phase 1 — Session Cleanup Finalizer And Drain

Entry criteria:

- Phase 0 exit green.

Scope:

- Extend `cleanupSessionBeforeMutation` with fixed order: fence -> clear queues -> abort parent ->
  recursive abort children -> waitForEmbeddedAgentRunEnd -> drainScope -> other owners -> mutation.
- Implement drainScope with owner wait + OS containment check + registry no-new-records check.
- Cover native supervisor processes and subagent child sessions.
- `sessions.stop` uses the same pipeline without mutation.

Exit criteria:

- Fixture process trees are fully terminated after reset/delete; timeout/unknown rejects mutation.
- No agent-wide kill fallback exists.
- 50-cycle create/stop leak test: active process registry and supervisor active set are empty;
  timers are cleared; heap delta <= 2 MB as measured by the leak fixture in
  `tests/unit/runtime-lifecycle-governance.test.ts`.
- Quantitative audit report green.

Not in scope: delete journal behavior, goal-owned durable processes, UI.

## Phase 2 — Session Delete Operation Journal And Terminal Gate

Entry criteria:

- Phase 1 exit green.

Scope:

- Caller-generated durable `operationId`; immutable manifest with `expectedSessionId` and
  deterministic archive plan.
- Content-sensitive idempotency and generation conflict.
- `cache_entries` delete + `store_committed` journal in one per-agent SQLite immediate transaction.
- Retry state machine `intent -> store_committed -> runtime_committed` and `partial_committed`.
- Electron mirror gate driven by operationId; terminal closes only after committed receipt.
- Terminal lifecycle: keep-on-leave, explicit close set, idleTtlMs=0, cap=null, global list fix.

Exit criteria:

- Runtime failure and RPC unknown produce zero file sweeps and keep the mirror gate closed.
- `partial_committed` retry does not duplicate archive or terminal close.
- Session delete closes its terminal after commit; conversation switch keeps terminals.
- E2E covers delete, switch, failure, and retry paths.
- Quantitative audit report green.

Not in scope: goal wake loop, durable helper, read-model expansion.

## Phase 3 — Same-Gateway Goal Wake Loop

Entry criteria:

- Phase 2 exit green.

Scope:

- ArmTransaction: `task_runs(queued,runtime=process) + flow_runs(waiting,controller_id=goal-wake)
  + mission(sleeping,activeWaitFlowIds)` in one immediate transaction, spawn after commit, terminal
  level-check after commit.
- Turn barrier with persisted `turnBarrier` and ack after full run idle.
- `goal_wait` tool restricted to mission owner/lead top-level turns with context-bound identity and
  single-process dependency.
- `exec(background=true, wait="none"|"session"|"goal")`; `goal` path is default-off.
- Process exit finalizes task_runs; level-check resumes flow; mission tick wakes once per effect
  ACK with at-least-once dedupe.
- Budgets: max active goal waits, max flows, tick failure backoff.

Exit criteria:

- End-to-end test proves no `process poll` is called on the goal-wake path.
- Duplicate wake delivery produces no duplicate tick or duplicate side effect.
- Flag-off path behaves byte-for-byte as before for default exec/background behavior.
- No renderer, host-api, or Electron packaging change is introduced.
- Quantitative audit report green.

Not in scope: cross-Gateway durable helper, multi-dependency waits, command chains, UI.

## Phase 4 — Durable Helper And Restart Recovery

Entry criteria:

- Phase 3 exit green.

Scope:

- Durable helper protocol: `intent.json -> started.json -> exit.json`, heartbeat/control files,
  bounded runDir layout and permissions.
- ProcessRunReconciler and startup/sweep recovery; no spawn replay.
- Windows detached process and Electron packaging viability for helper.
- Owner epoch invalidation on session reset/delete.
- RunDir quota, redaction, and cleanup.

Exit criteria:

- Crash-matrix tests cover: after arm commit, before/after spawn, before/after started, before/after
  exit, before/after flow resume, before/after tick claim.
- `intent` without `started` and no live helper resolves `lost`; no command auto-restart.
- Persisted metadata contains zero raw command/env/secret fields.
- Session delete cancels helper, finalizes task/flow, removes runDir.
- Windows helper behavior is either proven or explicitly reported as blocked with a fail-closed
  fallback.
- Quantitative audit report green.

Not in scope: multi-dependency flows, command chains, timer waits, scale-out.

## Phase 5 — Read Model And UI Projection

Entry criteria:

- Phase 4 exit green.

Scope:

- Extend `session.activitySnapshot` with goal, process, lineage.
- Extend Electron SessionActivity service and renderer store/types as a read-only projection.
- Terminal global listing fix if not completed in Phase 2.

Exit criteria:

- The read model has no write path; snapshot changes do not mutate session, process, flow, or goal
  state.
- UI renders goal/process/lineage from snapshot only.
- E2E covers the new panel states.
- i18n and contract checks pass; comms replay/compare pass.
- Quantitative audit report green.

Not in scope: new lifecycle actions in UI, model tool expansion beyond existing tools.

## Phase 6 — Production Audit And Closeout

Entry criteria:

- Phases 0-5 all green.

Scope:

- Run the full Quantitative Audit System below and record the audit report.
- Delete superseded scratch paths and temporary specs; keep only the canonical spec, rule, design,
  evidence, and test artifacts.
- Update task forest (user-confirmed), handoff LATEST, READMEs.

Quantitative audit numbers for this phase: every hard gate below passes; weighted score >= 85;
`audit-0.json` through `audit-6.json` all validate with `pnpm run runtime-lifecycle-audit --phase all`.

Not in scope: new runtime or UI behavior, new lifecycle actions, reopening any frozen Phase 0-5
scope, adding metrics/tools not defined below, and any code change beyond closeout evidence and
documentation updates.

Exit criteria:

- All previous phase evidence remains reproducible.
- Dead-code, cycle, coverage, type, lint, and contract gates are green.
- Efficiency budgets are met or deviations are explicitly accepted with reason.
- Handoff records exact next-step and residual list.


## Quantitative Audit System

Every phase must produce `artifacts/runtime-lifecycle-governance/audit-<phase>.json` with the
fields below, then validate it with:

```bash
pnpm run runtime-lifecycle-audit --phase <phase>
```

A phase is green only when the validator exits 0, every applicable hard gate passes, and the
weighted score is >= 85.

### Required Report Fields

```json
{
  "phase": "0",
  "createdAt": "<iso>",
  "gitBase": "<phase-start sha>",
  "programBase": "<program-base sha from audit-0; equals gitBase in audit-0>",
  "changedPaths": ["..."],
  "nonTestLocAdded": 0,
  "nonTestLocRemoved": 0,
  "testLocAdded": 0,
  "maxModuleNonTestLoc": 0,
  "deadCodeFindings": [],
  "importCycleDelta": { "added": 0, "resolved": 0 },
  "duplicateModuleDelta": { "added": 0, "resolved": 0 },
  "coverage": { "statements": 0, "branches": 0, "functions": 0 },
  "typecheckErrors": 0,
  "lintErrors": 0,
  "contractErrors": 0,
  "comms": { "lost": 0, "duplicate": 0, "reordered": 0 },
  "performance": {
    "admissionPermitP95Ms": null,
    "deleteCommitTxCount": null,
    "armTxCount": null,
    "processPollToolCalls": null,
    "periodicHotPathPolling": false,
    "leak50CycleHeapDeltaMb": null,
    "leak50CycleActiveRecords": null
  },
  "phaseExitChecklist": {
    "entryCriteria": true,
    "exitCriteria": true,
    "notInScopeRespected": true
  },
  "failedAcceptanceItems": 0,
  "scopeCreepFiles": 0,
  "missingEvidenceCommands": 0,
  "score": 0,
  "failedGates": [],
  "commands": ["..."]
}
```

Fields that do not apply to a phase are `null` and are excluded from hard gates and score.
Applicability:

| Field | Required from | Measurement source |
|---|---|---|
| `performance.admissionPermitP95Ms` | Phase 0 | benchmark block in `openclaw_runtime/src/sessions/session-admission-registry.test.ts` |
| `performance.periodicHotPathPolling` | Phase 0 | static grep command listed in Hard Gates |
| `performance.leak50CycleHeapDeltaMb`, `leak50CycleActiveRecords` | Phase 1 | leak fixture in `tests/unit/runtime-lifecycle-governance.test.ts` |
| `performance.deleteCommitTxCount` | Phase 2 | named test in `openclaw_runtime/src/gateway/session-delete-operation-journal.test.ts` |
| `performance.armTxCount`, `performance.processPollToolCalls` | Phase 3 | named goal-wake test and E2E tool-call trace listed in Hard Gates |

`failedAcceptanceItems` is the count of acceptance criteria in the frontmatter plus phase exit
checklist items that did not pass. `scopeCreepFiles` is the count of changed paths outside
`touchedAreas` that have no justification in the phase report. `missingEvidenceCommands` is the
count of applicable Hard Gates verification commands missing from the audit `commands` list.

Phase 6 is evidence-only closeout: it may copy `coverage` and `performance` measurements from the
latest phase that executed the corresponding capability, but `commands` must cite the source audit
file and all prior audit files must remain reproducible.

### Hard Gates (any failure blocks the phase)

| Gate | Threshold | Verification |
|---|---|---|
| Phase exit checklist | all three booleans true | `scripts/check-runtime-lifecycle-audit.mjs` validates the audit JSON |
| Type errors | 0 | `pnpm run typecheck` |
| Lint errors | 0 | `pnpm run lint:check` (full-repo lint; no touched-file exception) |
| Contract drift | 0 | `pnpm contract:check` |
| Comms regression | 0 lost / duplicate / reorder | `pnpm run comms:replay && pnpm run comms:compare` when event paths change |
| New import cycles | 0 added | `pnpm --dir openclaw_runtime check:import-cycles` must exit 0; capture `pnpm --dir openclaw_runtime check:madge-import-cycles > artifacts/runtime-lifecycle-governance/madge-current.txt 2>&1 || true` and compare cycle components against the audit-0 baseline. The 9 pre-existing madge components recorded on 2026-08-16 are baseline-allowed. |
| New dead-code findings | 0 for touched modules | `pnpm run typecheck` (unused locals/parameters) plus a caller map in the phase report: every new non-test export/module must list its production caller; each missing caller is one `deadCodeFindings` entry. `deadcode:report` is intentionally not used: its `config/knip.config.ts` is missing and its current `ts-prune`/`ts-unused` subcommands are not runnable. |
| New duplicate module groups | 0 added for touched modules | run `pnpm --dir openclaw_runtime dup:check:json || true` (it writes `.artifacts/jscpd/*.json` and may exit nonzero for pre-existing duplicates); compare duplicate groups for touched paths against the audit-0 baseline |
| Coverage (new/changed runtime code) | statements >= 90, branches >= 80, functions >= 90 | `pnpm --dir openclaw_runtime test:coverage:changed` (existing package script) |
| Per-module non-test lines | <= 700 | `wc -l` on each new/changed module |
| Total non-test LOC added (whole program) | <= 6000 | `git diff --numstat <programBase>..HEAD` summed over non-test `.ts`/`.tsx` files |
| Test-to-production LOC ratio | >= 0.8 | same `git diff --numstat` command, `testLocAdded / nonTestLocAdded` |
| Lifecycle leak test | active records = 0, timers = 0, heap delta <= 2 MB | named leak fixture in `tests/unit/runtime-lifecycle-governance.test.ts` (Phase 1+) |
| Delete commit transaction count | exactly 1 immediate transaction for row delete + `store_committed` | named test in `openclaw_runtime/src/gateway/session-delete-operation-journal.test.ts` (Phase 2+) |
| Arm transaction count | exactly 1 immediate transaction | named test in `openclaw_runtime/src/agents/mission-control/goal-wake.test.ts` (Phase 3+) |
| Goal wake polling | 0 `process.poll` tool calls on wake path | `tests/e2e/runtime-lifecycle-governance.spec.ts` asserts the recorded tool-call trace (Phase 3+) |
| Hot-path periodic polling | false | `git diff --unified=0 <gitBase> -- openclaw_runtime/src electron src | grep -nE '^\+.*(setInterval\s*\(|\.poll\s*\()'` must have no hot-path matches |
| Secret persistence | 0 raw command/env/secret fields | redaction assertions in the named goal-wake test (Phase 4+) |
| Scope guard | every changed path is in `touchedAreas` or explicitly justified; `scopeCreepFiles` = 0 | audit JSON `changedPaths` versus frontmatter `touchedAreas` |
| Rollout locks | unchanged | static diff check on VerseShell flags |
| Audit validator | exit 0 and `failedGates` matches recomputation | `pnpm run runtime-lifecycle-audit --phase <phase>` |

### Score

```
score = max(0, 100
      - failedAcceptanceItems * 5
      - coverageGapPoints * 1
      - deadCodeFindings * 5
      - importCycleDelta.added * 10
      - duplicateModuleDelta.added * 5
      - scopeCreepFiles * 3
      - missingEvidenceCommands * 5)
```

Coverage gap points = `(90 - statements) + (80 - branches) + (90 - functions)`, each clamped to 0.
Negative deltas (resolved cycles/duplicates) are recorded as positive evidence in
`importCycleDelta.resolved` / `duplicateModuleDelta.resolved` and are not subtracted. The validator
recomputes the score and compares it with the recorded `score`; `score >= 85` and no hard-gate
failure => green.

### Efficiency Rules

- Each phase records before/after targeted suite duration from the Vitest reporter output in the
  phase report. From Phase 1 onward, heap/RSS values are also recorded by the leak fixture in
  `tests/unit/runtime-lifecycle-governance.test.ts`.
- A duration regression > 20% on the same machine against the previous phase requires a written
  justification in the phase report; it is not an automatic fail if the justification is accepted.
- A phase that adds non-test LOC without removing or consolidating an existing path must explain
  why the new path is not dead weight. No new abstraction may be introduced speculatively.
- Any module or function added for "future use" without a current caller is a dead-code finding and
  fails the dead-code gate.
- Any config/env flag added by this program must be default-off with a kill switch and documented
  under `active-config-guards`.

### Phase Freeze Rule

Once a phase is green, its scope is frozen. New ideas discovered during later phases are written
to `artifacts/runtime-lifecycle-governance/future-work.json`; they do not reopen the closed phase
and do not enter the current program without a new spec.

## Final Closeout Checklist

1. One canonical spec and one boundary rule remain; no split task specs.
2. All seven audit JSON files (`audit-0.json` through `audit-6.json`) exist, are reproducible from
   recorded commands, and pass `pnpm run runtime-lifecycle-audit --phase all`.
3. `future-work.json` is present and explicit about deferred items.
4. Task forest proposal applied only after user confirmation.
5. Handoff LATEST and READMEs are updated.
6. `git diff --check` is clean.
