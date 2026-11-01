---
lifecycleStatus: active
id: session-derivation-lineage-projection
title: Read-only derivation lineage projection
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: 3d7562b37
intent: Answer "where did this session come from, and can each hop be proven?" from facts fork, handoff, and spawn already persist, without adding a lineage table, a receipt store, or a second derivation source.
touchedAreas:
  - harness/specs/tasks/session-derivation-lineage-projection.md
  - shared/types/session-derivation.ts
  - shared/types/session-activity.ts
  - openclaw_runtime/src/gateway/server-methods/session-derivation-projection.ts
  - openclaw_runtime/src/gateway/server-methods/session-activity.ts
  - tests/unit/session-derivation-lineage.test.ts
  - docs/modules/sessions.md
expectedUserBehavior:
  - A derived session reports its parent chain with each hop's proof.
  - A missing parent entry reads as parent-missing rather than as "no parent".
  - A cyclic or over-long chain stops at a bound and says so.
  - Nothing about fork, handoff, spawn, restore, or stored state changes.
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
  - pnpm exec vitest run tests/unit/session-derivation-lineage.test.ts --maxWorkers=1
  - pnpm run typecheck
acceptance:
  - a pure deriveSessionLineage walks parent hop chains using only parentSessionKey, spawnedBy, and the persisted fork fields.
  - each hop carries a kind (fork/handoff/spawn/unknown) and a status (resolved/parent-missing/cycle/bound-exceeded).
  - a missing parent entry yields parent-missing with parentFound false; a fabricated root is not acceptable.
  - depth is bounded and a bound stop is reported as truncated rather than silently cut.
  - session.activitySnapshot carries derivation and remains backward compatible; a lineage read failure cannot fail the snapshot.
  - no lineage table, receipt store, or write path is added.
docs:
  required: true
  readmeTranslations: not-required
  note: Read-only diagnostics reachable through session.activitySnapshot; no user-facing flow, interface, or default changes.
  files:
    - docs/modules/sessions.md
---

# Read-only derivation lineage projection

The chain a session came from is already recorded — as `parentSessionKey`,
`spawnedBy`, and the fork triple. What was missing was one place that reads
those facts and states honestly which hops are provable.

## Boundary

- No `session_derivations` table, no receipt row, no new writer.
- `fork`, `handoff`, `spawn`, `restore`, and `reset` behavior is unchanged.
- The derivation is a diagnostic. Task Ledger, ClawGraph, and goal truth remain
  the only authorities for what work exists.

## Honesty rules

1. A hop exists only when the child names its parent. A child that names no
   parent is a root, not an unknown gap.
2. A named parent that cannot be read is `parent-missing`, never a root.
3. A cycle stops with `cycle`; an over-long chain stops with `bound-exceeded`
   and `truncated: true`. Neither is silently cut.

## Non-goals

- No goal migration on fork or handoff.
- No cross-machine lineage sync.
- No inheritance-policy change: transcript-only stays the default.
