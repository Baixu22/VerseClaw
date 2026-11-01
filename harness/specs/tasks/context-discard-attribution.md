---
lifecycleStatus: active
id: context-discard-attribution
title: Context discard attribution with turn identity
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: 67fbaffe5
intent: Make "what did this turn drop, and why" re-readable after the fact by writing one bounded attribution row per discard, carrying the turn identity (turnId/attemptIndex/modelCallIndex) that today dies with the attempt, and by writing no payload text at all.
touchedAreas:
  - harness/specs/tasks/context-discard-attribution.md
  - openclaw_runtime/src/context-engine/discard-attribution.ts
  - openclaw_runtime/src/context-engine/context-orchestrator.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts
  - openclaw_runtime/src/agents/agent-hooks/compaction-safeguard.ts
  - tests/unit/context-discard-attribution.test.ts
  - docs/modules/context-and-memory.md
expectedUserBehavior:
  - A dropped candidate, a limit-history cut or a compaction chunk drop leaves one row naming the class, the reason, the size and where it happened.
  - Nothing that is kept changes; no decision, budget or threshold is touched by writing the row.
  - No message text, summary text or credential ever reaches the file.
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
  - pnpm exec vitest run tests/unit/context-discard-attribution.test.ts --maxWorkers=1
  - pnpm run typecheck
acceptance:
  - DiscardAttribution/v1 declares the five discard classes (compaction, budget-drop, limitHistoryTurns, archived, skipChannels), each built by one pure builder.
  - Every row carries discardClass, reason, unitRef, charsRequested/charsApplied/charsDropped, at, and whatever turn identity the producer has (turnId, attemptIndex, modelCallIndex, sessionKey, sessionId).
  - Candidate-lineage drops and skips are written with the full turn identity at orchestrator finalize; the history-limit cut and the compaction chunk drop are written with their own counts.
  - A turn with nothing dropped writes zero rows.
  - A written row contains no message payload and matches none of the credential patterns the sensitivity scan looks for.
  - Writing never throws into the turn and never exceeds the per-turn record cap; the sink is an append-only JSONL under the state dir with an env kill switch.
  - The leaf changes no discard decision, no budget and no compaction threshold.
docs:
  required: true
  readmeTranslations: not-required
  note: Diagnostics-only persistence under the local state dir; no user-facing flow, interface or default changes.
  files:
    - docs/modules/context-and-memory.md
---

# Context discard attribution

TF-0138 proved the gap: the runtime already decides five kinds of drop and already
carries a nine-value reason for each candidate - and then throws the table away
when the attempt ends. The only persisted carrier (`runtime_receipts`) is keyed by
`turnId` / `attemptIndex` / `modelCallIndex` and had zero rows in production.

This leaf writes the rows, and nothing else.

## Five classes, one shape

| class | producer wired here | what the row says |
|---|---|---|
| `budget-drop` | orchestrator candidate lineage (disposition drop/truncate) | channel, reason, requested/applied chars |
| `skipChannels` | orchestrator candidate lineage (recorded skips) | channel, reason (`flag-off` / `kill-switch` / `empty`) |
| `limitHistoryTurns` | embedded attempt history cut | messages before/after and the user-turn limit |
| `compaction` | compaction safeguard chunk drop | chunks, messages, tokens, kept/total budget |
| `archived` | none (zero production instances, see TF-0138 §4) | builder only; a real producer would be inventing behaviour |

## Rules

1. **Attribution only.** No decision, budget, threshold or prompt byte changes.
   A row is written after the decision, from data the decision already produced.
2. **No payload.** Rows carry counts, enum reasons, ids and digests already
   present in the lineage (`candidateId` includes a content digest). Message text
   is never written, so the sensitivity scan cannot find it.
3. **Turn identity is the point.** A row without `turnId` (plus `attemptIndex`
   and `modelCallIndex` when they exist) cannot be joined to anything and is not
   worth writing.
4. **Fail-safe.** A write failure is swallowed: diagnostics never break a turn.
   Rows are capped per turn and the sink stops growing past a size guard.
5. **Off is a switch, not a rewrite.** `VERSE_CONTEXT_DISCARD_ATTRIBUTION=0`
   disables the sink; with it off the turn is byte-identical and writes nothing.

## Non-goals

- No automatic re-injection of anything that was dropped.
- No change to any compaction trigger or tier threshold.
- No revival of the retired TF-0129 scope.