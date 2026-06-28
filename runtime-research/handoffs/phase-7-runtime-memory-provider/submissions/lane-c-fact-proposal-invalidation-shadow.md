# lane-c-fact-proposal-invalidation-shadow: Default-off fact proposal and invalidation shadow

## Scope Confirmation

- Lane: `lane-c-fact-proposal-invalidation-shadow`
- Output file: `runtime-research/handoffs/phase-7-runtime-memory-provider/submissions/lane-c-fact-proposal-invalidation-shadow.md`
- Lane-owned file only: yes; `runtime-core/index.ts` was already modified by prior accepted lanes, and Lane C only added the `memory-proposal-shadow` export.
- Implementation paths touched: `openclaw_runtime/src/runtime-core/memory-proposal-shadow.ts`; `openclaw_runtime/src/runtime-core/index.ts`
- Test paths touched: `tests/unit/runtime-memory-proposal-shadow.test.ts`
- Commands run: harness context/validate via direct `node`; focused memory tests; node typecheck; raw-retention scan; service/exporter scan; renderer bypass scan; production authority/provider/persistence scans; README docs-sync search.
- Required reading completed: `C:\Users\27933\.codex\RTK.md`; `AGENTS.md`; `openclaw_runtime/AGENTS.md`; Phase 7 task spec and handoff docs; Lane A accepted submission; selected harness scenario/rules/layers from `harness context`; `runtime-research/agent-runtime-index.md`; Phase 7 roadmap/Stage 8 migration/core-spec refs; Phase 6 synthesis; Graphiti temporal/mapping/useful-tests/extraction docs.

## Executive Summary

- Added a pure runtime-core proposal shadow helper in `memory-proposal-shadow.ts`.
- Candidate fact proposal is enabled only when both `runtime.memory.shadow` and `runtime.memory.proposeFacts` are literal `true`.
- Flag-off mode returns no candidates, no invalidation proposals, no rejected-input echoes, and no accepted facts.
- Proposal inputs are accepted only from event/tool/test/verifier/trace summaries, explicit human confirmation, or deterministic rules.
- Raw proposal inputs are rejected before candidate construction; unsupported `other` sources, accepted-fact-shaped inputs, and invalid shapes are rejected.
- Candidate facts always remain `verificationStatus: "candidate"` and the result's `acceptedFacts` surface is always an empty array.
- Conflicting candidate facts produce candidate invalidation proposals for current accepted facts without mutating or overwriting the accepted facts.
- No TaskLoop, Gateway, Main, renderer, provider registry, store, persistence, or provider ordering code was changed.

## Evidence Table

| Claim | Evidence Type | Path / Command | Symbol / Lines | Notes |
|---|---|---|---|---|
| Proposal source allowlist excludes `other` | file | `openclaw_runtime/src/runtime-core/memory-proposal-shadow.ts` | `RUNTIME_MEMORY_FACT_PROPOSAL_INPUT_SOURCES` line 34 | Allows task/tool/test/verifier/trace summaries, human confirmation, deterministic rules only. |
| Shadow helper is gated by both memory flags | file | `openclaw_runtime/src/runtime-core/memory-proposal-shadow.ts` | `buildRuntimeMemoryFactProposalShadow` line 102 | Returns disabled empty result unless `shadow && proposeFacts`. |
| Proposal inputs reject raw/unsupported/accepted-fact/invalid shapes | file | `openclaw_runtime/src/runtime-core/memory-proposal-shadow.ts` | `sanitizeRuntimeMemoryFactProposalInput` line 138 | Calls Lane A raw-input rejection before candidate construction. |
| Conflict behavior creates invalidation proposals only | file | `openclaw_runtime/src/runtime-core/memory-proposal-shadow.ts` | `proposeRuntimeMemoryInvalidations` line 186 | Uses current-valid accepted facts and returns candidate invalidation records. |
| Runtime-core export added | file | `openclaw_runtime/src/runtime-core/index.ts` | line 15 | Barrel export only. |
| Flag-off parity and proposal-only behavior covered | test | `tests/unit/runtime-memory-proposal-shadow.test.ts` | tests line 41 and line 73 | Disabled mode returns empty output; enabled mode returns candidates only. |
| Raw rejection and invalidation behavior covered | test | `tests/unit/runtime-memory-proposal-shadow.test.ts` | tests line 105 and line 144 | Raw trace summary rejected; conflicting accepted fact yields invalidation proposal. |

## Required Evidence Matrix

| Required Evidence | Path / Command | Result | Gap / Not Applicable Reason |
|---|---|---|---|
| Path/function evidence for changed surfaces | `memory-proposal-shadow.ts`; `index.ts`; `runtime-memory-proposal-shadow.test.ts` | pass | See evidence table. |
| Flag-off legacy parity | `buildRuntimeMemoryFactProposalShadow`; focused test line 41 | pass | Flags off returns no output and does not inspect/echo raw input. No legacy runtime path touched. |
| Sanitization/redaction coverage | `sanitizeRuntimeMemoryFactProposalInput`; existing `runtime-memory-context-contracts.test.ts` | pass | Lane C rejects raw proposal input before candidate construction; Lane A contract tests still cover redaction helpers. |
| Raw chat-log rejection | `runtime-memory-context-contracts.test.ts`; Lane C raw-input path | pass | Existing contract suite covers raw chat; Lane C uses the same raw classifier for full input objects. |
| Raw trace-dump rejection | `runtime-memory-proposal-shadow.test.ts` line 105 | pass | Raw trace summary rejected with `raw_trace_dump`. |
| Raw-retention scan | `rg -n 'rawChat|raw chat|transcript|jsonl|rawTrace|trace dump|prompt dump|toolArgs|toolOutput|stdout|stderr|process\.env|secret|apiKey|api[-_]?key|authorization|password|baggage|tracestate' openclaw_runtime/src/runtime-core/memory-proposal-shadow.ts tests/unit/runtime-memory-proposal-shadow.test.ts` | pass/reviewed | Matches are test fixtures proving disabled no-retention and raw rejection; production file has no matches. |
| Source episode/evidence refs present | `isRuntimeMemoryFactProposalInput`; focused tests | pass | Proposal input guard requires non-empty source episode refs and evidence refs. |
| Durable fact promotion requires verifier/human/deterministic-rule evidence | `buildRuntimeMemoryFactProposalShadow`; `RuntimeMemoryTemporalFact` Lane A tests | pass | Lane C emits no accepted facts; durable fact contract still requires promotion evidence. |
| valid_at / invalid_at / expired_at / reference_time behavior | `proposeRuntimeMemoryInvalidations`; contract tests | pass | Conflict lookup is current-valid at candidate `valid_at`; existing tests cover historical/current filtering. |
| Idempotent duplicate episode handling | `runtime-memory-context-contracts.test.ts` | pass | Lane C does not add episode writes; existing duplicate episode contract test remains green. |
| Current-valid query excludes invalid/rejected/unverified facts | `findRuntimeMemoryFacts`; focused invalidation tests | pass | Lane C invalidation proposals only target current accepted facts; existing query tests remain green. |
| Token-budget summary behavior | `runtime-memory-context-contracts.test.ts` | pass | Lane C adds no summary surface; existing summary contract tests remain green. |
| Touched-file service/exporter scan | `rg -n 'createServer\(|listen\(|WebSocketServer|new WebSocket\(|OTLP|Collector|opentelemetry.*export|@opentelemetry/exporter|@temporalio|express\(' openclaw_runtime/src/runtime-core/memory-proposal-shadow.ts tests/unit/runtime-memory-proposal-shadow.test.ts` | pass | No matches. |
| Renderer IPC/Gateway bypass scan | `rg -n 'window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789|new WebSocket\(' src/pages src/components` | pass | No matches; `rg` exit 1/no output. |
| Comms replay/compare if Main/Gateway paths changed | not run | not-applicable | No Main, Gateway, runtime send/receive, delivery, or fallback paths changed. |

## Implementation Summary

Current code:
- `memory-proposal-shadow.ts` defines the Lane C proposal source allowlist, rejection taxonomy, proposal input/result contracts, and pure helpers.
- `buildRuntimeMemoryFactProposalShadow` resolves Lane A flags and returns an empty disabled result unless both `runtime.memory.shadow` and `runtime.memory.proposeFacts` are enabled.
- `sanitizeRuntimeMemoryFactProposalInput` rejects raw input objects, accepted-fact-shaped inputs, unsupported sources, and invalid shapes before building a sanitized candidate.
- `proposeRuntimeMemoryInvalidations` compares candidates against current-valid accepted facts and returns candidate invalidation proposals with `replacementFactId`; it does not mutate facts.
- `index.ts` exports the new module.

Tests:
- `runtime-memory-proposal-shadow.test.ts` covers allowlists, flag-off parity, enabled proposal-only candidates, rejection behavior, invalidation proposal behavior, no invalidation for identical/already-invalid facts, and deterministic sanitization.
- `runtime-memory-context-contracts.test.ts` was rerun to prove Lane A contracts still pass.

Feature flags:
- `runtime.memory.shadow`: default false; required for this helper to emit anything.
- `runtime.memory.proposeFacts`: default false; required for this helper to emit anything.
- `runtime.memory.provider` and `runtime.memory.persist`: untouched and unused.

Docs/index:
- README translation search found existing Knowledge/Memory proposal docs only. No README update required because Lane C adds internal default-off runtime-core helper behavior and no UI, RPC, or user-visible flow.
- `runtime-research/agent-runtime-index.md` not updated; Phase 7 synthesis/Lane E owns accepted phase pointer updates.

## Memory Contract Surface

| Surface | Contract / Adapter | Shadow / Readonly / Proposal Boundary | Feature Flag | Evidence |
|---|---|---|---|---|
| Proposal input source allowlist | `RuntimeMemoryFactProposalInput` | proposal-only | `runtime.memory.shadow` + `runtime.memory.proposeFacts` | `memory-proposal-shadow.ts` line 34 |
| Proposal shadow result | `RuntimeMemoryFactProposalShadowResult` | readonly/proposal-only; `acceptedFacts: []` | both flags default false | `memory-proposal-shadow.ts` line 102; test line 73 |
| Candidate fact construction | `sanitizeRuntimeMemoryFactProposalInput` | candidate-only | both flags default false through caller | `memory-proposal-shadow.ts` line 138 |
| Invalidation proposals | `proposeRuntimeMemoryInvalidations` | proposal-only; no fact mutation | both flags default false through caller | `memory-proposal-shadow.ts` line 186; test line 144 |

## Legacy Behavior Preservation

| Legacy Path | Current Behavior | Preservation Evidence | Risk |
|---|---|---|---|
| TaskLoop completion | Unchanged | No TaskLoop files touched; production authority scan no matches | Low |
| tools.invoke | Unchanged | No Gateway/tool files touched; production provider/transport scan no matches | Low |
| approval waiting/retry/error mapping | Unchanged | No runtime execution files touched | Low |
| event-log/checkpoint/resume | Unchanged | No event-log/checkpoint/resume files touched | Low |
| Evidence Verifier | Unchanged | Evidence refs are passive proposal provenance; no verifier authority code | Low |
| Trace Context Provider | Unchanged | Trace summaries can be proposal sources only; no trace provider files touched | Low |
| Provider ordering | Unchanged | No provider registry/context-engine files touched | Low |

## Safety / Retention Audit

| Focus | Result | Evidence | Gap |
|---|---|---|---|
| No raw chat-log/transcript memory | pass | Lane A contract test plus Lane C full-object raw classifier use | None |
| No raw trace-dump memory | pass | Focused raw trace rejection test line 105 | None |
| No raw prompts/full payload persistence | pass | No persistence APIs; persistence scan no matches | None |
| No full memory dump exposed by default | pass | Helper returns candidates/proposals only when both flags enabled | None |
| Automatic/LLM extraction remains proposal-only | pass | Result `acceptedFacts` is always empty; accepted-fact inputs are rejected | None |
| Durable facts require verifier/human/deterministic evidence | pass | Lane C emits no durable facts; Lane A accepted fact guard unchanged | None |
| Token-budgeted summaries | pass | Existing Lane A summary tests pass; Lane C adds no summary output | None |
| Source refs do not replace verifier evidence | pass | Proposal inputs require source episode refs and evidence refs; verifier code untouched | None |

## Tests And Harness Evidence

| Check | Command / File | Result | Covers | Gap |
|---|---|---|---|---|
| Harness context | `node harness/src/cli.mjs context --spec harness/specs/tasks/phase-7-runtime-memory-provider.md` | pass | Phase 7 routing/read list | `rtk` was not available on PATH; direct node CLI used. |
| Harness validate | `node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-7-runtime-memory-provider.md` | pass | Task spec validity | None |
| Focused proposal shadow test | `node node_modules/vitest/vitest.mjs run tests/unit/runtime-memory-proposal-shadow.test.ts` | pass, 1 file / 7 tests | Flag-off parity, proposal-only behavior, raw/source rejection, invalidation proposals | None |
| Focused memory tests | `node node_modules/vitest/vitest.mjs run tests/unit/runtime-memory-context-contracts.test.ts tests/unit/runtime-memory-proposal-shadow.test.ts` | pass, 2 files / 15 tests | Lane A contracts plus Lane C proposal shadow | None |
| Node typecheck | `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false` | pass | Node/runtime TypeScript surface | None |
| Raw-retention scan | See Required Evidence Matrix | pass/reviewed | No production raw retention; test fixtures classified | None |
| Service/exporter scan | See Required Evidence Matrix | pass/no matches | No service/listener/exporter additions | None |
| Renderer bypass scan | See Required Evidence Matrix | pass/no matches | No renderer direct IPC/Gateway HTTP/WS | None |
| Production authority scan | `rg -n 'completion gate|security policy|retry policy|tool policy|permission|approval|tools\.invoke|provider ordering|authorize|authority|execute|spawn\(' openclaw_runtime/src/runtime-core/memory-proposal-shadow.ts` | pass/no matches | No runtime authority hooks | None |
| Provider/persistence scans | `rg` scans for provider registration, Gateway/IPC, persist/file/sqlite/jsonl/transcript terms over touched files | pass/no matches | No provider ordering, comms, or persistence cutover | None |
| README docs-sync search | `rg -n 'Runtime Memory|runtime memory|memory provider|proposal|invalidation|temporal fact|valid_at|invalid_at' README*.md` | reviewed/pass | Existing Knowledge/Memory proposal docs only | No README change required. |

## Boundary Audit

| Boundary | Result | Evidence |
|---|---|---|
| No default-on memory recording/provider/persistence/extraction/promotion | pass | Both `shadow` and `proposeFacts` required; no provider/persist code. |
| No raw chat-log/raw trace memory | pass | Raw classifier rejects proposal inputs; raw scan reviewed. |
| No observability platform/collector/exporter/database service | pass | Touched-file service/exporter scan no matches. |
| No second runtime service/listener/Gateway/Temporal | pass | No service/listener/Gateway files touched; scan no matches. |
| No renderer direct IPC | pass | Renderer bypass scan no matches. |
| No renderer direct Gateway HTTP/WS | pass | Renderer bypass scan no matches. |
| No runtime authority/completion gate/security/retry/tool policy from memory provider | pass | Production authority scan no matches; helper is pure data construction. |
| Comms replay/compare when Main/Gateway paths changed | not-applicable | No Main/Gateway/comms paths changed. |
| UI changes have E2E and i18n | not-applicable | No UI/user-facing text changed. |

## Design Conflicts

| Conflict | Current Evidence | Design Target | Proposed Resolution |
|---|---|---|---|
| Strict raw-input rejection vs metadata redaction | Lane C rejects raw proposal input before candidate construction; Lane A still redacts metadata in contract helpers | Accept only sanitized deterministic inputs | Keep Lane C strict; callers must pass bounded summaries/refs only. |
| Lane B store not present in this worktree | Search found no `runtime-core/memory-store.ts`; Lane C did not require store use | Keep candidates separate from durable facts | Return proposal arrays only; future store lane can consume them behind the same flags. |
| Existing `index.ts` dirty from prior lanes | Git diff includes Lane A/Phase 5/6 exports already present before Lane C | Avoid reverting user/prior-lane work | Lane C added only `export * from "./memory-proposal-shadow.js";`. |

## Status

```text
Status: accepted
```

## Recommended Next Slice

```text
Slice: lane-d-memory-context-provider-summary
New code path: openclaw_runtime/src/context-engine/memory-context-provider.ts
Legacy path wrapped: none by default
Shadow / readonly / proposal boundary: readonly budgeted provider over accepted facts only; candidates only on explicit request
Feature flag: runtime.memory.provider remains default false
Tests: provider disabled flag-off test, readonly context item budget test, no full memory dump/raw retention test
Harness: reuse phase-7-runtime-memory-provider spec
Rollback: disable/omit runtime.memory.provider; provider ordering remains unchanged
Done when: provider output is source-linked, token-budgeted, readonly, default-off, and absent from default provider ordering
```

## Open Questions

| Question | Why It Matters | Who Can Decide | Blocking |
|---|---|---|---|
| Should future store integration reject raw proposal inputs exactly as Lane C does, or allow Lane A redaction for some metadata-only fields? | Store retention policy should be consistent before any persistence or durable queue exists. | maintainer / synthesis owner | no |
| Should conflicting proposals be task-scoped only when both facts carry the same task id, or should all subject/predicate conflicts be global? | Current helper avoids conflicts across different explicit task ids but catches global facts. | maintainer / synthesis owner | no |

## Handoff Notes

- Lane C intentionally does not call or create a memory store. It returns sanitized candidates and invalidation proposals for future lanes to consume explicitly.
- Invalidation proposals are not fact mutation. Accepted facts are used only as readonly comparison input and are not emitted or changed.
- Automatic extraction remains candidate-only. Any durable promotion still requires the Lane A accepted fact contract with verifier, human, or deterministic-rule promotion evidence.
- Comms replay/compare was not run because this lane touched no Main, Gateway, runtime send/receive, delivery, or fallback path.
