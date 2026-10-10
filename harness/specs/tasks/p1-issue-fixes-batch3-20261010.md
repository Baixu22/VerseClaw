---
id: p1-issue-fixes-batch3-20261010
title: P1 issue batch 3 - fork, worktree risk and context archive cleanup
taskType: runtime-bridge
scenario: gateway-backend-communication
intent: Close P1 issues #100, #101 and #148 with fail-closed lifecycle boundaries and isolated regression coverage.
expectedUserBehavior:
  - A fork whose parent branch has no assistant tail returns failure instead of a successful path to an unwritten child transcript.
  - Shell worktree lifecycle operations match the structured git-api risk level for external add, remove --force and prune.
  - Permanent delete and empty-archive remove the session context archive and retain the archive index as a retry locator when cleanup is partial.
touchedAreas:
  - electron/services/workspace-permissions.ts
  - electron/services/sessions-api.ts
  - openclaw_runtime/src/auto-reply/reply/session-fork.runtime.ts
  - tests/unit/workspace-permissions.test.ts
  - tests/unit/r0-2-sessions-delete-fail.test.ts
  - tests/unit/session-fork-empty-tail.test.ts
  - harness/specs/tasks/p1-issue-fixes-batch3-20261010.md
  - docs/dev/p1-issue-fixes-batch3-20261010.md
requiredRules:
  - backend-communication-boundary
  - docs-sync
requiredProfiles:
  - fast
  - comms
requiredTests:
  - node node_modules/vitest/vitest.mjs run tests/unit/session-fork-empty-tail.test.ts tests/unit/workspace-permissions.test.ts tests/unit/r0-2-sessions-delete-fail.test.ts --maxWorkers=1
  - pnpm run typecheck
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/p1-issue-fixes-batch3-20261010.md
  - node scripts/comms/replay.mjs
  - node scripts/comms/compare.mjs
acceptance:
  - Issue #148 - a parent transcript with only a user/tool tail yields null from forkSessionFromParent and no child file is created or marked forked.
  - Issue #100 - git worktree add with an absolute/traversing target is external-write, remove/force and prune are destructive, and worktree list remains read-only.
  - Issue #101 - permanentDelete and emptyArchive both invoke context-archive cleanup; partial cleanup keeps the archive index entry and returns a retryable failure.
  - Verification is synthetic/agent-driven with temporary files and no real user archives or worktree deletion.
docs:
  required: true
  paths:
    - docs/dev/p1-issue-fixes-batch3-20261010.md
---

# P1 issue batch 3

Three lifecycle boundaries are tightened: a fork cannot claim success when no
assistant-tail branch was written, shell worktree commands cannot silently
downgrade structured git-api risk, and recycle-bin deletion cannot forget the
context archive or erase the only retry locator on partial cleanup.
