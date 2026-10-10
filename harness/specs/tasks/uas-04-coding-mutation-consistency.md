---
lifecycleStatus: archived
id: uas-04-coding-mutation-consistency
title: UAS-04 Coding write consistency and recovery
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Eliminate silent partial mutation from multi-file apply_patch by introducing a preflight precompute phase, deterministic lease-ordered batch apply, an explicit prepared/committed/rolled_back/recovery_required state machine, and crash-recovery semantics that reuse the existing write journal without creating a second journal authority.
ownedPaths:
  - harness/specs/tasks/uas-04-coding-mutation-consistency.md
  - harness/specs/rules/coding-mutation-consistency-boundary.md
  - openclaw_runtime/src/agents/apply-patch.ts
  - openclaw_runtime/src/agents/apply-patch-batch-lock.ts
  - openclaw_runtime/src/agents/apply-patch-types.ts
  - openclaw_runtime/src/agents/apply-patch-update.ts
  - openclaw_runtime/src/agents/apply-patch-preflight.ts
  - openclaw_runtime/src/agents/apply-patch.test.ts
  - openclaw_runtime/src/agents/apply-patch-consistency.test.ts
  - openclaw_runtime/src/agents/tools/write-journal.ts
  - openclaw_runtime/src/agents/tools/write-journal.test.ts
  - openclaw_runtime/src/agents/agent-tools.ts
  - tests/unit/uas-04-coding-mutation-consistency.test.ts
  - docs/dev/unified-agent-system/DEVELOPMENT-LOG.zh-CN.md
  - docs/dev/unified-agent-system/DEVELOPMENT-STRATEGY.zh-CN.md
  - docs/dev/unified-agent-system/CAPABILITY-INTEGRATION-AUDIT-AND-ROADMAP.zh-CN.md
  - docs/dev/handoffs/LATEST.md
touchedAreas:
  - harness/specs/**
  - openclaw_runtime/src/agents/**
  - tests/unit/**
  - docs/dev/unified-agent-system/**
  - docs/dev/handoffs/LATEST.md
expectedUserBehavior:
  - A multi-file apply_patch that fails on the Nth hunk leaves zero partial mutation on disk when rollback succeeds.
  - When rollback of a failed batch is itself incomplete, the result exposes recovery_required with a recoveryRef pointing to the retained journal entries.
  - The apply_patch result lists every file that was modified, added, or deleted along with the batch state.
  - Concurrent apply_patch calls targeting overlapping files are serialized by a per-file lease acquired in preflight before any mutation.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - comms-regression
  - docs-sync
  - coding-runtime-workspace-dcs-producer-boundary
forbiddenPatterns:
  - silent partial mutation — a failed multi-file patch that leaves earlier hunks' writes on disk without rollback or recovery_required
  - a second write journal, run journal, or mutation authority competing with the existing write-journal.ts
  - migrating the write journal into VerseShell or any non-Coding authority
  - claiming cross-filesystem true atomic transactions — only application-level prepare/commit/rollback is in scope
  - verify outcomes rolling back a successful committed mutation — verify remains post-mutation evidence only
  - changing Coding default destructive tier, liveReady, productApproved, defaultOn, TF-0006, TF-0009, or TF-0018 ownership
  - implementing TF-0016, TF-0017, TF-0018, TF-0019, FP-P4-03, or product graduation
featureFlags:
  - No new runtime flag is added by UAS-04.
  - The preflight phase is always active for apply_patch; there is no opt-out to the old inline apply loop.
  - runtime.writeJournal.enabled and runtime.symbolLease.enabled remain independent opt-in gates; UAS-04 adds an internal batch lease that does not depend on the symbolLease flag.
rollback:
  - Revert apply-patch.ts to the inline serial loop and remove the preflight module.
  - No data migration is required; journal entries created by the new code remain readable by the unchanged rehydrate path.
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/uas-04-coding-mutation-consistency.md
  - pnpm harness validate --spec harness/specs/tasks/uas-04-coding-mutation-consistency.md
  - pnpm --dir openclaw_runtime exec vitest run src/agents/apply-patch.test.ts src/agents/apply-patch-consistency.test.ts src/agents/tools/write-journal.test.ts
  - pnpm exec vitest run tests/unit/uas-04-coding-mutation-consistency.test.ts
  - pnpm run typecheck
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - A preflight phase parses, resolves, pre-reads, and pre-computes every hunk before any filesystem mutation; a preflight failure returns an error with zero files touched.
  - A multi-file patch that fails on a later hunk rolls back all previously applied hunks using their pre-computed original content; if rollback fully succeeds the batch state is rolled_back and disk matches the pre-patch state.
  - When rollback cannot fully restore a file, the batch state is recovery_required and the result includes a recoveryRef identifying the retained journal entries.
  - The apply_patch result lists all added, modified, and deleted files plus the batch state (committed/rolled_back/recovery_required).
  - A per-file batch lease is acquired in path-sorted order during preflight and released after commit or rollback; overlapping concurrent patches are serialized, not interleaved.
  - The existing write journal remains the single mutation evidence authority; UAS-04 adds no second journal.
  - The producer-boundary rule is respected: post-write verify failure never rolls back a committed mutation; only failed-batch partial mutations are rolled back.
  - Crash-recovery tests prove that a prepared-but-uncommitted journal entry can be detected after a simulated restart.
  - Default OFF, kill-switch, product locks, TF-0006 blocked state, TF-0009 review state, and TF-0018 ownership remain unchanged.
docs:
  required: true
  files:
    - docs/dev/unified-agent-system/DEVELOPMENT-LOG.zh-CN.md
    - docs/dev/unified-agent-system/DEVELOPMENT-STRATEGY.zh-CN.md
    - docs/dev/unified-agent-system/CAPABILITY-INTEGRATION-AUDIT-AND-ROADMAP.zh-CN.md
    - docs/dev/Sustained-Development-Playbook.md
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
  notes:
    - Document the preflight phase, batch state machine, lease ordering, and recovery contract.
    - Review README variants under docs-sync; update only if a user-visible flow or public interface changed.
---

# UAS-04 Coding Write Consistency and Recovery

This task implements Task Forest node `TF-0015/UAS-04` only. It eliminates the silent partial
mutation hazard in multi-file `apply_patch` by introducing a preflight precompute phase, a
deterministic batch apply with per-file lease ordering, an explicit
`prepared/committed/rolled_back/recovery_required` state machine, and crash-recovery semantics
that reuse the existing write journal.

Coding remains the single file-mutation authority. The write journal remains the single mutation
evidence authority. UAS-04 adds no second journal, no second mutation authority, and no claim of
cross-filesystem true atomic transactions — only application-level prepare/commit/rollback.

The producer-boundary rule is respected: post-write verify failure never rolls back a committed
mutation. Only failed-batch partial mutations (hunks applied before a later hunk failed) are
rolled back, because within a failed batch those writes are uncommitted partial state, not
successful mutations.

UAS-04 does not authorize default-on behavior, product graduation, VerseShell routing, canary
expansion, Memory writes, ROI claims, or any Task Forest status change outside the normal
confirmed closeout proposal.
