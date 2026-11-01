---
lifecycleStatus: active
id: session-start-injection-wiring
title: Session-start injection wiring with byte-identical flag-off parity
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: ab2f7c75d
intent: Route start-of-session context through the one Context Orchestrator candidate protocol on a dedicated session_start channel, so a start-of-session turn is deduplicated, charged, budgeted and lineage-explained like every other injection, while the default (flag off) keeps every turn's prompt byte-identical.
touchedAreas:
  - harness/specs/tasks/session-start-injection-wiring.md
  - shared/types/session-start-injection.ts
  - openclaw_runtime/src/context-engine/turn-injection-budget.ts
  - openclaw_runtime/src/context-engine/injection-budget.ts
  - openclaw_runtime/src/context-engine/session-start-injection.ts
  - openclaw_runtime/src/context-engine/context-orchestrator.ts
  - openclaw_runtime/src/config/types.openclaw.ts
  - openclaw_runtime/src/config/zod-schema.ts
  - openclaw_runtime/src/config/runtime-feature-leaves.ts
  - openclaw_runtime/src/config/schema.labels.ts
  - openclaw_runtime/src/config/schema.help.ts
  - shared/dcs/component-disposition-catalog.ts
  - openclaw_runtime/src/auto-reply/reply/get-reply-run.ts
  - openclaw_runtime/src/auto-reply/reply/queue/types.ts
  - openclaw_runtime/src/auto-reply/reply/followup-runner.ts
  - openclaw_runtime/src/auto-reply/reply/agent-runner-execution.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/run/params.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/run.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts
  - tests/unit/session-start-injection-wiring.test.ts
  - tests/unit/session-start-injection-parity.test.ts
  - tests/unit/session-start-injection-shadow.test.ts
  - docs/modules/context-and-memory.md
expectedUserBehavior:
  - With the flag off (default) nothing changes - no new text, no new charge, no new stored state.
  - With the flag on, a new session's first turn receives the same runtime-loaded startup context, bounded and explained instead of silently spliced into the user message.
  - With the flag on but an unproven or continued stage, nothing is injected (fail-closed).
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
  - pnpm exec vitest run tests/unit/session-start-injection-wiring.test.ts --maxWorkers=1
  - pnpm exec vitest run tests/unit/session-start-injection-parity.test.ts --maxWorkers=1
  - pnpm exec vitest run tests/unit/session-start-injection-plan.test.ts --maxWorkers=1
  - pnpm run typecheck
acceptance:
  - session_start is a declared turn-injection channel in TURN_INJECTION_PRECEDENCE and TURN_INJECTION_CHANNEL_POLICY, ordered between knowledge and working_memory.
  - Flag off (default) is byte-identical to the feature being absent: the same input with and without a session-start request yields identical system prompt and message arrays, and no candidate charges the ledger.
  - Flag off records a flag-off source decision on the session_start channel, so why nothing was injected is auditable rather than absent.
  - Flag on injects start-of-session content as system-prompt candidates on the session_start channel and the orchestrator lineage carries the plan with per-source requested/applied/dropped and reasons.
  - Flag on is bounded: an over-budget source is carried as budget-partial with a cut size, and the injected text is exactly the plan's charsApplied prefix.
  - An unknown or continued stage injects nothing even when the flag is on and facts exist.
  - The context-enhancement kill switch cuts session-start injection as well as the other enhancement channels.
  - Malformed flag config or env resolves to off (fail-closed) and never throws into the turn.
docs:
  required: true
  readmeTranslations: not-required
  note: Internal injection path; no user-facing flow, interface, or default changes. Docs state the single-assembly boundary and that LoopContextPack/startup-context are providers, not authorities.
  files:
    - docs/modules/context-and-memory.md
---

# Session-start injection wiring

A2a produced the plan. This leaf wires it - and the first rule of the wiring is
that **off means byte-identical to not existing**.

## What the turn now does

Two paths stop being two.

1. **Flag off (default).** `get-reply-run` keeps the startup prelude in the user
   body exactly as before and sends no session-start request. The orchestrator
   records a single `flag-off` decision on the `session_start` channel so an
   operator can see the channel was considered and skipped, not forgotten.
2. **Flag on.** `get-reply-run` stops splicing the prelude into the user body and
   hands the same owner-rendered text down as a `SessionStartInjectionRequest`.
   The Context Orchestrator turns the plan into `ContextCandidate/v1` entries on
   the `session_start` channel: deduplicated by content digest, charged against
   the one turn ledger, truncated by the plan's `charsApplied`, and projected
   into the system prompt.

Both paths deliver the same information. Only the flag decides whether it is an
unbudgeted splice or a bounded candidate.

## Why the channel has to be real

`session_start` is a declared channel in `TURN_INJECTION_PRECEDENCE`, placed
between `knowledge` and `working_memory`: start-of-session context is
correctness-bearing (the model must know this is a fresh session with loaded
memory), but it is smaller and less volatile than per-turn working memory. A
channel that only exists as a string inside one module would not appear in the
ledger, the policy table, or the decay resolver - which is how the "fourth
injection path" grew in the first place.

## Fail-closed rules

| condition | outcome |
|---|---|
| flag off | no candidate; `flag-off` decision recorded |
| kill switch engaged | no candidate; `kill-switch` decision recorded |
| stage `unknown` | empty plan, every source `fail-closed-unknown-stage` |
| stage `continued` | empty plan, every source `stage-excluded` |
| source over budget | `budget-partial`, injected text = `charsApplied` prefix |
| flag config unreadable | treated as off |

## Non-goals

- No new store, table, or write path: the plan is lineage, not state.
- No prompt-content redesign: flag-on moves the same text to the system prompt.
- No change to compaction timing, the turn-injection total, or the DCS channels.
- The CLI runner path is not wired; it carries no session-start request, so its
  behaviour stays byte-identical.