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
- **Native harness**: `harness/selection.ts` retains the same ledger through `context-engine-lifecycle.ts`; SDK assembly admits new messages and system additions before plugin rendering. Identical startup retries reuse the admitted projection. Embedded child runs leave the native scope. The scope is shared across source/built module instances, while admission calls back into the original attempt owner so the SDK cannot charge a separate collection or ledger. See `docs/dev/tf0013-native-wire-20261001.md` for native-process development evidence and its limits.
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

## TF-0493 closure

VToken remains a stateless internal packing strategy behind the Context Orchestrator. The host bridge is an internal diagnostics/test boundary only; Settings has no VToken bridge toggle or independent VToken product panel. C6 remains an explicit internal assembler request API for bounded lifecycle/pressure selection rather than a permanent user opt-in. Context/request receipts remain per actual model call and are paired through the existing RC-03 seal owner.

## Prompt contribution authority (TF-0737)

The admitting host passes a `PromptContributionAdmission` as the third argument of
`collectContextCandidate` or `collectContextOrchestratorCandidate`. Its declaration names
`source` (equal to candidate.sourceId), `authority`, exact `scope` and a nonempty `reason`.
Content authority object IDs and digests continue to identify content; they grant no rights.
Core sources have an explicit registry matching real projection operations. Registered
authorities/scopes are fixed before seeing a requested target; data producers cannot
upgrade themselves to history replacement. Dynamic Memory/session-start source families
retain system-append scope only. This is declaration governance, not source authentication
against a malicious in-process plugin.

| Candidate target | Required authority |
|---|---|
| message | append_data |
| system_prompt (appends to the existing prompt) | append_instruction |
| message_replacement | replace_messages |

With `mode: "enforce"`, an undeclared source may append data only. Source/scope/authority
mismatches reject before collection and budget charging with
`PromptContributionAuthorityError` (`PROMPT_CONTRIBUTION_AUTHORITY_DENIED`). Rejection
does not append the replacement as data or alter the original history. A host must supply
the declaration separately from untrusted candidate content.

The host can select enforce with `OPENCLAW_PROMPT_AUTHORITY_MODE=enforce`; an explicit
admission mode wins. An unknown environment mode rejects. Existing callers retain warn
mode by default. High-authority violations emit warnings and surviving
candidate lineage records `promptAuthority: "warned"`; declared and default-data admissions
are also distinguished. This is not global production enforcement. These checks govern
declared mutation surfaces and do not classify the semantics of appended data. Native
assembly, budget accounting after orchestration and RC-03 coverage remain separate tasks.

## Prompt accounting (TF-0738)

Optional RC-03 admission and the flag-independent final snapshot report their
coverage separately through `sealCoverage`; see [RC-03 seal coverage](rc03-seal-coverage.md).

The 6000-character limit governs **managed injection**, including its existing
precedence, drops and truncation. It does not limit the base system prompt, separate
post-orchestrator instructions or the provider's total token window. Those token limits
and the provider's structured usage records remain separate; no character-to-token
conversion is used for billing or provider-usage claims.

`composePostOrchestratorPrompt` preserves the existing filtered join and records
Runtime Intensity/degradation additions and their separators in a separate bucket on
the same turn ledger. The embedded runner uses `createTrackedSystemPromptSetter` for
its actual system-prompt writes. It records successful changes, including provider,
hook, media, model-identity, runtime-context and capability updates. Whole replacements
retire prior base/post system attribution. Hook data appends use the corresponding
message observation. Repeated composition/cached projection replaces an observation,
rather than billing it again.

`ContextFinalSnapshot.budgetCoverage` exposes:

| Field | Meaning |
|---|---|
| managedChars | Cumulative characters applied by the existing turn injection budget |
| postOrchestratorChars | Separately attributed system/message changes and joining characters |
| totalPromptChars | Observed full system-prompt length plus turn message-injection charges |
| basePromptChars | Base component observed before later managed/post contributions |
| unaccountedChars | Positive observed injection footprint not covered by managed/post accounting |
| overaccountedChars | Attributed footprint exceeding the observation; exposes double counting |
| unbudgeted | A turn/baseline observation is unavailable |

`accounted_char_ratio = (managedChars + postOrchestratorChars) /
(totalPromptChars - basePromptChars)` for a nonempty observed injection footprint.
Complete coverage requires zero unaccounted and zero overaccounted characters. The
empty-footprint convention is 1.0. Ordinary history, user input and tool outputs are
not part of this character footprint; the field is not the complete provider request
or wire-serialization size. Managed/message counts remain the turn's applied charges,
not a fresh token estimate for each model call.

No-turnId composition reports `unbudgeted` in returned and retained orchestrator
diagnostics. Normal embedded attempts initialize the observed baseline and snapshots
are readable through the existing snapshot getters. Ledger observations are copied
when summarized, so later model calls cannot rewrite earlier snapshots.

## Product boundaries

- Does not enable default-on memory/VToken (see `docs/dev/default-config-matrix.md`)
- Does not replace BlockStore / SEKB writeback / TF-0004 E2E
- Does not implement VToken MemStore/WAL/worker-pool or estimate semantics (TF-0014/UAS-03)
- Does not graduate Runtime Memory, enable SEKB automatic writeback, or change live/product/default-on locks

## COMPASS pre-reply budget (2026-09-30)

Embedded ContextEngine `assemble().messages` replacements are collected as atomic `message_replacement` candidates in `cvk_addition`. Exact deep equality with multiplicity exempts retained history, including cloned or windowed messages; rewritten summaries and extra copies are charged by their serialized new-message length (including structural metadata). This conservative character accounting bounds structured payloads without splitting tool pairs. A rejected replacement retains the original history. Plugins receive a cloned input so mutation followed by failure cannot change the live transcript. Assembly follows orphan repair and heartbeat filtering. The existing projection preparation admits the replacement before overflow estimation; the runner materializes it once, and cached context callbacks never reapply it after replay normalization. Optional source read failures are isolated from prompt submission. Subsequent model calls retain the materialized history, current prompt and tool results; RC-03 attributes the selected producer and seals the resulting payload. This covers embedded execution only; native plugin-owned assembly needs separate verification.

SSP and retrieval are no longer appended directly to the pre-reply system prompt. Preparation checks the enhancement kill switch before SSP or fact loading; execution rechecks source flags before collecting both as knowledge candidates. Immediate, queued, CLI and native harness runs carry the same serializable context input. The existing owner performs sorting, identity deduplication and budget projection; no new budget or product flag is introduced.

Seal attribution uses the projected text, including truncation, instead of matching the original over-budget text. Memory fact receipts and post-reply efficiency only count fully projected retrieval groups; partial bytes remain visible in candidate lineage without claiming that every fact survived. Runtime source tests intercept the actual provider request and pair its digest with v1 receipts. This is scoped development evidence, not a new RC acceptance verdict.
