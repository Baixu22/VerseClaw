---
lifecycleStatus: active
id: session-stage-readonly-projection
title: Read-only SessionStage projection
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: 12c17c935
intent: Derive one auditable SessionStage value for a session from facts the runtime already persists, expose it as a read-only projection on the activity snapshot, and prove it never influences prompt text, injection budget, or compaction timing.
touchedAreas:
  - harness/specs/tasks/session-stage-readonly-projection.md
  - shared/types/session-stage.ts
  - shared/types/session-activity.ts
  - openclaw_runtime/src/gateway/server-methods/session-stage-projection.ts
  - openclaw_runtime/src/gateway/server-methods/session-activity.ts
  - openclaw_runtime/src/gateway/server-methods/session-activity-projection.test.ts
  - tests/unit/session-stage-projection.test.ts
  - tests/unit/session-stage-no-execution-coupling.test.ts
  - docs/modules/sessions.md
expectedUserBehavior:
  - A session's stage is readable from the activity snapshot with the facts that produced it.
  - Unknown or missing facts surface as unknown instead of a guessed stage.
  - Nothing about prompts, injection budget, compaction timing, or stored state changes.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - runtime-lifecycle-governance-boundary
  - identity-scope-boundary
  - context-family-boundary
  - context-runtime-kit-boundary
  - docs-sync
  - disk-temp-policy
requiredTests:
  - pnpm exec vitest run tests/unit/session-stage-projection.test.ts --maxWorkers=1
  - pnpm run typecheck
acceptance:
  - a pure deriveSessionStage returns one of fresh/continued/compacted/forked/handedOff/restored/resumed/unknown from existing persisted fields only.
  - identity is agentId + canonicalSessionKey + expectedSessionId, never scopeKey.
  - missing or contradictory facts return unknown with stageEvidence naming the missing inputs rather than a guessed stage.
  - session.activitySnapshot carries stage plus stageEvidence and stays backward compatible for existing consumers.
  - a negative test proves no prompt, injection budget, or compaction decision reads the stage value.
docs:
  required: true
  readmeTranslations: not-required
  note: Read-only diagnostics reachable through session.activitySnapshot; no user-facing flow, interface, or default changes.
  files:
    - docs/modules/sessions.md
---

# Read-only SessionStage projection

Session stage is a projection, not an owner of any state. It answers "what kind of
session am I looking at" so later work can choose an injection recipe per stage
without re-deriving the answer in five places from five different fields.

## Boundary

- Inputs are facts that already persist: `forkedFromParent`, `parentSessionKey`,
  `spawnedBy`, `forkedFromLeafId`, `forkedFromTimestamp`, `compactionCount`,
  `compactionCheckpoints`, `sessionStartedAt`, `usageFamilyKey`,
  `usageFamilySessionIds`.
- Outputs are diagnostics only. No caller may branch prompt assembly, injection
  budget, compaction timing, or storage on the stage value in this change set.
- A stage that cannot be proven from those facts is `unknown`. Guessing from a
  session title, label, or model name is forbidden.

## Precedence

Later stages only win when their proof is stronger than the earlier one:

1. `forked` — `forkedFromParent` or a non-empty fork triple proves a branch.
2. `handedOff` — `parentSessionKey` without fork fields proves a handoff lineage.
3. `restored` — `usageFamilySessionIds` holds a previous session id for this key.
4. `compacted` — `compactionCount` > 0 or a compaction checkpoint exists.
5. `resumed` — `sessionStartedAt` is older than the newest transcript activity.
6. `continued` — the session has transcript activity but no rotation proof.
7. `fresh` — nothing above applies and the session has no activity yet.
8. `unknown` — facts are missing or contradictory.

## Non-goals

- No new session table, no `SessionDesiredState`, no reconciler.
- No change to fork, handoff, restore, reset, or compaction behavior.
