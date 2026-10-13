---
lifecycleStatus: archived
id: a6-long-running-persistence-pilot
title: A6 Long-Running Persistence — Active Pilot Gate
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Promote the A6 resume contract verifier from shadow to active pilot, gated by verifier pass rate and zero volatile mislabels.
touchedAreas:
  - openclaw_runtime/src/agents/long-task-control/file-fingerprint.ts
  - openclaw_runtime/src/agents/long-task-control/persisted-resume-shadow.ts
  - openclaw_runtime/src/runtime-core/resume-shadow.ts
  - openclaw_runtime/src/observability/deprecation-counters.ts
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - comms-regression
expectedUserBehavior:
  - With the A6 pilot gate enabled, resume cycles verify their contract and any volatile mislabel blocks graduation instead of being averaged away.
  - A resume that followed a rollback is marked `requiresReverification=true` rather than trusted as a clean continuation.
  - The fingerprint lease is committed before the checkpoint, so a resumed run cannot adopt a stale fingerprint.
  - When a volatile mislabel appears or the verifier failure rate exceeds 5%, the pilot responds with `degrade_to_full_reverification`.
  - With the pilot flag off, pause/resume behaviour is unchanged.
requiredTests:
  - tests/unit/deprecation-counters.test.ts
  - openclaw_runtime/src/observability/deprecation-counters.test.ts
  - tests/unit/performance-budgets.test.ts
  - tests/unit/file-fingerprint.test.ts
  - tests/unit/runtime-resume-shadow.test.ts
  - tests/unit/long-task-checkpoint-builder.test.ts
  - tests/unit/long-task-control.test.ts
  - tests/unit/a06-a6-gate-coverage.test.ts
acceptance:
  - A6 deprecation counter `volatileMislabelCount` MUST be 0 (CRITICAL gate)
  - A6 deprecation counter `verifierFailCount` rate ≤ 5% over resume cycles
  - A6 p99 ≤ 300ms (criterion 4.9)
  - `ResumeContractVerifier` marks `requiresReverification=true` when rollback occurred (criterion 3.3)
  - `FingerprintLeaseCoordinator` commits lease before checkpoint (criterion 3.8, Blocker 4)
  - Budget violation response `degrade_to_full_reverification` triggers on any volatile mislabel OR fail rate > 5%
docs:
  required: true
---

## Graduation gate

A6 graduates from shadow to active pilot when ALL of the following hold:

1. **Zero volatile mislabels**: `volatileMislabelCount === 0` (CRITICAL — any non-zero value blocks graduation permanently until resolved).
2. **Verifier pass rate** ≥ 95%: `verifierPassCount / (pass + fail) ≥ 0.95`.
3. **Performance**: p99 ≤ 300ms for 10 pause/resume cycles (criterion 4.9).
4. **Rollback detection**: `ResumeContractVerifier` marks `requiresReverification=true` when rollback occurred (criterion 3.3).
5. **Blocker 4 (lease/checkpoint ordering)**: `FingerprintLeaseCoordinator` commits lease before checkpoint, no I/O race (criterion 3.8).
6. **Budget violation response**: `degrade_to_full_reverification` triggers on mislabel or high fail rate (criterion 4.14).

## Out of scope

- Targeted re-verification (OQ-006, Stage 5 — full re-verification ships in Stage 4).
- Checkpoint migration / compact (Stage 5).
