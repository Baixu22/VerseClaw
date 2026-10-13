---
lifecycleStatus: active
id: runtime-event-log-unwired-asset
title: Runtime event-log / dual-read resume is a built-but-unwired asset (option B)
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: >-
  The runtime event-log + controlled dual-read resume pilot is ~72KB of code whose
  four feature flags all default off, with no replay consumer wired. Reading the
  module suggests event-level recovery is available; it is not. Issue #177 asked
  for the A/B/C decision to be recorded and the asset state marked so nobody
  assumes it is live. The decision is B (mark and freeze), recorded here per the
  issue's acceptance criteria.
touchedAreas:
  - harness/specs/tasks/runtime-event-log-unwired-asset.md
  - openclaw_runtime/src/runtime-core/event-log.ts
  - tests/unit/runtime-event-log-unwired-asset.test.ts
expectedUserBehavior:
  - A session recovery never claims event-level replay; it uses the compaction/checkpoint paths that are actually wired.
  - Reading the event-log module tells an engineer it is built-but-unwired, not a live recovery path.
requiredProfiles:
  - fast
  - comms
requiredTests:
  - tests/unit/runtime-event-log-unwired-asset.test.ts
acceptance:
  - The A/B/C decision is recorded (option B) and the asset is explicitly marked built-but-unwired.
  - `executeReplayRollback` cannot reach `replayEventLog` expecting success while the capability is unimplemented.
  - A unit guard asserts every event-log flag defaults off and maps to its documented config path, so a default cannot be flipped silently.
  - No frozen default is flipped and no behaviour change is introduced.
docs:
  required: false
---

# Runtime event-log / dual-read resume: built-but-unwired asset

## The three options (from issue #177)

- **A. Delete** the event-log family (~72KB) if product will never do event-level recovery.
- **B. Mark and freeze** (chosen) — keep the code, mark it built-but-unwired, and guard the
  defaults so it cannot be quietly assumed live.
- **C. Wire it up** — enable `eventLogPersist` + `resumeReplayShadow` and complete the
  pilot → cutover → product path, which needs real crash/disconnect recovery evidence.

## Decision (agent-driven)

**Option B.** Option C is the eventual goal but is blocked on recovery-correctness evidence
(per the #143 lesson: a shadow run is not a cutover). Option A deletes an asset the roadmap
still references. B records the truth without changing behaviour.

## What "built-but-unwired" means here (authoritative facts)

- `DEFAULT_RUNTIME_EVENT_LOG_FEATURE_FLAGS` is all `false`
  (`openclaw_runtime/src/runtime-core/event-log.ts`).
- `sessions.restoreCheckpoint` hard-gates the replay pilot off and falls back to the legacy
  checkpoint path.
- `checkpoint-rollback-executor.ts` answers `replayEventLog` with
  `ok:false, reason:"event_log_replay_not_implemented: …"`, and `ReplayRollbackTarget` carries
  an `@unimplemented` `event_log` variant.
- The module is **not** dead code: the event-log *writers* are imported by
  `agent-run-event-spine`, `event-log-persistence`, `state-reducer`, `resume-shadow`,
  `grounding`, and `event-log-operator-inspection`. Only *replay consumption* is unwired.

## Guards

`tests/unit/runtime-event-log-unwired-asset.test.ts` asserts that every flag defaults off and
that each flag still maps to its documented schema path. Flipping a default, or dropping the
capability without updating the STATUS note, fails that guard.