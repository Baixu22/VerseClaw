# Context Orchestrator (TF-0002)

> Status: Active
> Updated: 2026-07-30 (TF-0013/UAS-02)
> Single final selection, deduplication, budget, projection, and lineage authority for production context enhancement.

## Entry

```ts
import {
  collectContextOrchestratorCandidate,
  computeContextExtraSystemPrompt,
  finalizeContextOrchestratorTurn,
  getLastContextOrchestratorLineage,
} from "./context-orchestrator.js";
```

- **Module**: `openclaw_runtime/src/context-engine/context-orchestrator.ts`
- **Production source collection**: `run/attempt.ts` (Memory, VToken, CVK) and `extensions.ts` (DCS context-block)
- **Production finalization**: `extensions.ts` before the provider request; `attempt.ts` and `compact.ts` both provide a turn identity and clean up the candidate collection and ledger
- **Gateway** (`server-methods/agent.ts`): passes base `extraSystemPrompt` through; does **not** inject memory/VToken

## Candidate protocol and stable order

Every covered source produces `ContextCandidate/v1` with:

- a stable candidate id for source/channel/target lineage;
- a dedup key derived from authority object id, authority version, and deterministic content digest;
- an explicit target (`system_prompt` or `message`) and turn-injection channel.

Final precedence is:

1. `knowledge` (compass or role-memory)
2. `working_memory`
3. `tool_registry`
4. `cvk_addition`
5. `vtoken`
6. `memory_pilot`

Candidates are collected first, sorted and deduplicated second, then charged once against the existing turn ledger. Lifecycle call order and the former DCS reservation no longer determine the result. Duplicate authority objects are dropped before any charge.

All sources honor `VERSE_CONTEXT_ENHANCEMENT_KILL_SWITCH` / `runtime.contextEnhancement.killSwitch` fail-closed. Source flags and the master kill switch stop source queries before candidate production. VToken DCS-memory loading is lazy and is omitted when the same enabled DCS sources project directly.

## Lineage diagnostics

After each turn orchestration:

- `getLastContextOrchestratorLineage()` → turn/session/run/request/workspace, source and candidate identity, channel/target, disposition, requested/applied chars, reason, budget, and diagnostics
- `dcsObservability.snapshot()` counters: `contextOrchestratorCalls`, `contextOrchestratorKillSwitchHits`, `contextOrchestratorCharsAdded`

## Acceptance map

| Criterion | Evidence |
|---|---|
| Production path only 1 final authority | `tests/unit/context-orchestrator-entry-scan.test.ts` |
| Stable identity, precedence, pre-charge dedup, budget dispositions | `context-candidate.test.ts` |
| Flag/kill off = zero source query, candidate, charge, injection | `context-orchestrator.test.ts`, `assembler.test.ts` |
| Six-channel combined production boundary | `extensions.knowledge.test.ts` |
| Diagnostics sources+budget | candidate lineage + DCS observability |

## Non-goals

- Does not enable default-on memory/VToken (see `docs/dev/default-config-matrix.md`)
- Does not replace BlockStore / SEKB writeback / TF-0004 E2E
- Does not implement VToken MemStore/WAL/worker-pool or estimate semantics (TF-0014/UAS-03)
- Does not graduate Runtime Memory, enable SEKB automatic writeback, or change live/product/default-on locks

## COMPASS pre-reply budget (2026-09-30)

SSP and retrieval are no longer appended directly to the pre-reply system prompt. Preparation checks the enhancement kill switch before SSP or fact loading; execution rechecks source flags before collecting both as knowledge candidates. Immediate, queued, CLI and native harness runs carry the same serializable context input. The existing owner performs sorting, identity deduplication and budget projection; no new budget or product flag is introduced.

Seal attribution uses the projected text, including truncation, instead of matching the original over-budget text. Memory fact receipts and post-reply efficiency only count fully projected retrieval groups; partial bytes remain visible in candidate lineage without claiming that every fact survived. Runtime source tests intercept the actual provider request and pair its digest with v1 receipts. This is scoped development evidence, not a new RC acceptance verdict.
