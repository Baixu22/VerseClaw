---
lifecycleStatus: active
id: session-start-injection-plan-shadow
title: Single shadow plan for start-of-session injection
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: 809872832
intent: Produce one plan that ranks every start-of-session source by a fixed precedence against one character budget, records why each source was included, cut or dropped, and changes no turn's sent content because it is not wired into assembly.
touchedAreas:
  - harness/specs/tasks/session-start-injection-plan-shadow.md
  - shared/types/session-start-injection.ts
  - openclaw_runtime/src/context-engine/session-start-injection-facts.ts
  - tests/unit/session-start-injection-plan.test.ts
  - tests/unit/session-start-injection-shadow.test.ts
  - docs/modules/context-and-memory.md
expectedUserBehavior:
  - Nothing changes for a user: no prompt, no injection, no stored state.
  - Diagnostics can name one plan with per-source reasons instead of four unrelated budgets.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - runtime-lifecycle-governance-boundary
  - context-family-boundary
  - context-runtime-kit-boundary
  - docs-sync
  - disk-temp-policy
requiredTests:
  - pnpm exec vitest run tests/unit/session-start-injection-plan.test.ts --maxWorkers=1
  - pnpm exec vitest run tests/unit/session-start-injection-shadow.test.ts --maxWorkers=1
  - pnpm run typecheck
acceptance:
  - buildSessionStartInjectionPlan returns SessionStartInjectionPlan/v1 with budget, per-source include/drop, reason and charsRequested/charsApplied.
  - source selection is stage-driven, and an unknown stage returns an empty plan with fail-closed-unknown-stage for every source.
  - an over-budget source is either budget-dropped or budget-partial with the cut size in detail; it is never silently shortened.
  - owner detail survives into every outcome branch, so a stale or partial owner read is visible in the plan.
  - a negative test proves no prompt owner references the plan module.
  - wiring status is declared: this leaf does not inject; A2b owns wiring and flag-off parity.
docs:
  required: true
  readmeTranslations: not-required
  note: Diagnostics-only contract; no user-facing flow, interface, or default changes.
  files:
    - docs/modules/context-and-memory.md
---

# Single shadow plan for start-of-session injection

Four owners can feed a session's first context — startup memory, the long-session
continuity pack, a handoff draft, and inherited fork context — and today each has
its own budget and its own diagnostics. This leaf creates the one plan that
ranks them, and deliberately stops there.

## Why it stops there

Wiring the plan into assembly is a behaviour change: it can grow a prompt. That
change needs a byte-identical flag-off parity gate, which needs the plan to exist
first. So the order is: plan (this leaf), then wiring (A2b) measured against it.

**Wiring status: not wired.** No prompt owner imports this module; the negative
test enforces that. This is a declared unwired contract, not an accidental one.

## Precedence

`continuity-pack` → `handoff-draft` → `startup-memory` → `fork-inheritance`.

Correctness-bearing context charges first; convenience context is what loses the
budget. The ladder mirrors the existing turn-injection precedence so operators do
not learn a second one.

## Stage selection

| stage | sources consulted |
|---|---|
| fresh / compacted / restored | continuity pack + startup memory |
| forked | continuity pack + inherited context |
| handedOff | continuity pack + handoff draft |
| resumed | continuity pack |
| continued | none — the session already has history |
| unknown | none — fail-closed |

## Non-goals

- No injection, no budget change, no store write.
- No new source; every value names an owner that already exists.
- No change to compaction timing or the turn-injection ledger.
