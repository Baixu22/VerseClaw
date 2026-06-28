# Phase 9 Lane C: Retention Redaction Rollback

## Scope

- Lane: `lane-c-retention-redaction-rollback`
- Output file: `runtime-research/handoffs/phase-9-runtime-memory-persistence-foundation/submissions/lane-c-retention-redaction-rollback.md`
- Runtime behavior changed: no production behavior changed.
- Files changed:
  - `tests/unit/runtime-memory-store.test.ts`
  - `runtime-research/handoffs/phase-9-runtime-memory-persistence-foundation/submissions/lane-c-retention-redaction-rollback.md`
- Main/Gateway/host-api/api-client/provider transport paths changed: no.
- Comms replay/compare required: no.
- Worktree note: the checkout already contained many unrelated dirty/untracked files. Lane C worked only on the focused memory-store test and this submission.

## Files Reviewed

- `AGENTS.md`
- `C:\Users\27933\.codex\RTK.md`
- `openclaw_runtime/AGENTS.md`
- `runtime-research/agent-runtime-index.md`
- `harness/specs/tasks/phase-9-runtime-memory-persistence-foundation.md`
- `runtime-research/handoffs/phase-9-runtime-memory-persistence-foundation/README.md`
- `runtime-research/handoffs/phase-9-runtime-memory-persistence-foundation/parallel-lanes.md`
- `runtime-research/handoffs/phase-9-runtime-memory-persistence-foundation/submissions/lane-a-persistence-spec-boundary.md`
- `runtime-research/handoffs/phase-8-runtime-memory-cutover-readiness/synthesis.md`
- `runtime-research/handoffs/phase-8-runtime-memory-cutover-readiness/README.md`
- `runtime-research/handoffs/phase-8-runtime-memory-cutover-readiness/parallel-lanes.md`
- `harness/specs/tasks/phase-8-runtime-memory-cutover-readiness.md`
- `runtime-research/handoffs/phase-7-runtime-memory-provider/synthesis.md`
- `harness/specs/tasks/phase-7-runtime-memory-provider.md`
- `openclaw_runtime/src/runtime-core/memory-context.ts`
- `openclaw_runtime/src/runtime-core/memory-store.ts`
- `openclaw_runtime/src/runtime-core/memory-persistence.ts`
- `openclaw_runtime/src/runtime-core/memory-proposal-shadow.ts`
- `openclaw_runtime/src/context-engine/memory-context-provider.ts`
- `openclaw_runtime/src/config/types.openclaw.ts`
- `tests/unit/runtime-memory-context-contracts.test.ts`
- `tests/unit/runtime-memory-store.test.ts`
- `tests/unit/runtime-memory-persistence.test.ts`
- `tests/unit/runtime-memory-proposal-shadow.test.ts`
- `tests/unit/runtime-memory-context-provider.test.ts`
- `tests/unit/context-provider-registry.test.ts`

## Decision Boundary

Lane C accepts the current default-off retention/redaction/invalidation/rollback proof for the Phase 9 foundation. The current Phase 9 surface includes a local SQLite persistence proof in `openclaw_runtime/src/runtime-core/memory-persistence.ts`, but it remains a standalone, explicit `runtime.memory.persist` gated API. This lane does not accept runtime cutover: no TaskLoop, Gateway, provider ordering, verifier, tool policy, renderer, or service path is authorized to treat persisted memory as runtime authority.

## Retained Field Proof

| Record | Allowed retained fields | Evidence |
|---|---|---|
| Episode | `schemaVersion`, `episodeId`, `taskId`, `kind`, `reference_time`, `idempotencyKey`, `boundedSummary`, `sourceRefs`, `evidenceRefs`, sanitized `metadata`, `redactionStatus: "sanitized"` | Lane A retained-field table; `RuntimeMemoryEpisodeRecord` at `openclaw_runtime/src/runtime-core/memory-context.ts:157`; sanitizer emits only this shape at `memory-context.ts:742`. |
| Candidate fact | `schemaVersion`, `factId`, optional `taskId`, `subject`, `predicate`, `objectSummary`, `confidence`, `source`, `verificationStatus`, `valid_at`, optional `invalid_at`, optional `expired_at`, `reference_time`, `sourceEpisodeRefs`, `evidenceRefs`, `proposedAt`, sanitized `metadata` | Lane A retained-field table; `RuntimeMemoryTemporalFactCandidate` at `memory-context.ts:185`; sanitizer emits bounded text/metadata at `memory-context.ts:772`. |
| Durable fact | Candidate fields plus accepted `verificationStatus`, `acceptedAt`, and `promotion` evidence | Lane A retained-field table; `RuntimeMemoryTemporalFact` at `memory-context.ts:201`; durable sanitizer preserves accepted status and promotion at `memory-context.ts:820`. |
| Invalidation | `schemaVersion`, `invalidationId`, `factId`, `reason`, `invalid_at`, `reference_time`, `proposedBy`, `verificationStatus`, `sourceEpisodeRefs`, `evidenceRefs`, optional `replacementFactId`, sanitized `metadata` | Lane A retained-field table; `RuntimeMemoryInvalidationProposal` at `memory-context.ts:210`; sanitizer emits this shape at `memory-context.ts:841`. |

## Redaction And Rejection Proof

| Boundary | Evidence |
|---|---|
| Raw chat, transcript/jsonl, trace dump, prompt, full payload, full tool args/output, env, secret, baggage, and tracestate inputs are rejected before memory text is accepted. | `RUNTIME_MEMORY_RAW_INPUT_REJECTION_REASONS` and `RAW_TEXT_PATTERNS` at `memory-context.ts:99` and `memory-context.ts:336`; `rejectRawRuntimeMemoryInput` at `memory-context.ts:710`; `sanitizeRuntimeMemoryText` at `memory-context.ts:717`; contract tests at `tests/unit/runtime-memory-context-contracts.test.ts` reject each raw fixture. |
| Sensitive metadata keys are redacted, not retained raw. | `SENSITIVE_METADATA_KEY_PATTERN` at `memory-context.ts:390`; `classifySensitiveKey` at `memory-context.ts:1406`; metadata sanitizer at `memory-context.ts:1427` and `memory-context.ts:1452`; tests in `runtime-memory-context-contracts.test.ts` and `runtime-memory-store.test.ts` assert raw tool output is absent and `[redacted]` remains. |
| Store append paths cannot retain rejected raw episode/fact bodies. | `RuntimeMemoryStore.appendEpisode` sanitizes via `sanitizeRuntimeMemoryEpisodeRecord`; `appendFact` sanitizes via `sanitizeQueryableFactForStore`; `tests/unit/runtime-memory-store.test.ts:97` rejects raw chat and raw tool-output retention on append. |

## Retention Proof

| Requirement | Evidence |
|---|---|
| Episode retention is no larger than 256. | `DEFAULT_MAX_EPISODES = 256` at `openclaw_runtime/src/runtime-core/memory-store.ts:26`; `trimEpisodes` removes oldest records at `memory-store.ts:406`; new test `tests/unit/runtime-memory-store.test.ts:126` appends 257 and proves only 256 remain. |
| Fact retention is no larger than 512. | `DEFAULT_MAX_FACTS = 512` at `memory-store.ts:27`; `trimFacts` removes oldest records at `memory-store.ts:420`; new test at `tests/unit/runtime-memory-store.test.ts:126` appends 513 and proves only 512 remain. |
| Invalidation retention is no larger than 256. | `DEFAULT_MAX_INVALIDATIONS = 256` at `memory-store.ts:28`; `trimInvalidations` removes oldest records at `memory-store.ts:430`; new test at `tests/unit/runtime-memory-store.test.ts:126` appends 257 and proves only 256 remain. |

## Invalidation Proof

| Requirement | Evidence |
|---|---|
| Only accepted invalidations affect current-valid query behavior. | `RuntimeMemoryStore.factsWithInvalidations` skips proposals unless `isRuntimeMemoryAcceptedVerificationStatus` returns true at `memory-store.ts:300`; new test `tests/unit/runtime-memory-store.test.ts:294` proves candidate and rejected invalidations do not hide the current fact, then accepted invalidation does. |
| Candidate, rejected, invalidated, expired, and unpromoted facts are excluded by default. | `matchesVerification` at `memory-context.ts:1176`; temporal validity checks at `memory-context.ts:900`; existing store test `tests/unit/runtime-memory-store.test.ts` covers candidate/rejected/expired/unpromoted exclusion by default. |
| Historical/current query does not overwrite durable truth. | Store invalidation applies as a query-time view; `getFactById` retains the original fact without mutating `invalid_at`; existing store test proves historical time queries and invalidated view behavior. |

## Rollback Proof

| Boundary | Evidence |
|---|---|
| `runtime.memory.persist` is default false. | `DEFAULT_RUNTIME_MEMORY_FEATURE_FLAGS` at `memory-context.ts:129`; strict flag resolution keeps absent/non-boolean values false; `runtime-memory-persistence.test.ts:31` covers explicit false. |
| Flag false stops new durable writes. | `memory-persistence.ts:342`, `memory-persistence.ts:361`, `memory-persistence.ts:378`, `memory-persistence.ts:395`, and `memory-persistence.ts:409` return skipped/disabled before opening SQLite; `runtime-memory-persistence.test.ts:31` injects a throwing opener and proves `openCalls` stays `0`. |
| Rollback preserves user data and does not default-delete. | Disabling `runtime.memory.persist` stops new persistence migration/read/write/open calls and returns an empty in-memory store; no rollback path drops, unlinks, or deletes persisted memory rows. |
| TaskLoop, tools, event-log/checkpoint/resume, Evidence Verifier, Trace Provider, RuntimeMemoryProvider readonly behavior, and provider ordering remain authoritative. | Lane C changed no production paths. RuntimeMemoryProvider remains `enabledByDefault: false`, `shadowOnly: true`, and `noCompletionAuthority`/`noVerifierAuthority`/`noRuntimeAuthority` at `memory-context-provider.ts:65` and `memory-context-provider.ts:79`; provider registry tests passed and default registry excludes memory unless explicitly supplied. |

## Validation

| Command | Result | Notes |
|---|---|---|
| `rtk ...` | blocked | `rtk` was not available on this PowerShell PATH (`rtk` not recognized). |
| `pnpm harness context --spec harness/specs/tasks/phase-9-runtime-memory-persistence-foundation.md` | failed before harness | Bare `pnpm` hit `ERR_PNPM_IGNORED_BUILDS`; per instruction, equivalent commands were rerun with `corepack pnpm`. |
| `corepack pnpm harness context --spec harness/specs/tasks/phase-9-runtime-memory-persistence-foundation.md` | passed | Returned Phase 9 read order. |
| `corepack pnpm harness validate --spec harness/specs/tasks/phase-9-runtime-memory-persistence-foundation.md` | passed | Phase 9 spec valid. |
| `corepack pnpm harness validate --spec harness/specs/tasks/phase-8-runtime-memory-cutover-readiness.md` | passed | Phase 8 spec valid. |
| `corepack pnpm harness validate --spec harness/specs/tasks/phase-7-runtime-memory-provider.md` | passed | Phase 7 prerequisite spec valid. |
| `corepack pnpm test tests/unit/runtime-memory-context-contracts.test.ts tests/unit/runtime-memory-store.test.ts` | passed | 2 files / 15 tests; includes the new retention and invalidation tests. |
| `corepack pnpm test tests/unit/runtime-memory-context-contracts.test.ts tests/unit/runtime-memory-store.test.ts tests/unit/runtime-memory-proposal-shadow.test.ts tests/unit/runtime-memory-context-provider.test.ts tests/unit/context-provider-registry.test.ts` | passed | 5 files / 33 tests; covers proposal-only behavior, provider default-off behavior, and registry ordering. |
| `corepack pnpm run typecheck` | passed | Node and web TypeScript checks passed after the test change. |
| Raw-retention scan over Lane C touched files | passed/reviewed | Matches are negative store-test fixtures plus this submission's proof/forbidden-language text; no raw retention path was added. |
| Service/exporter/database/listener scan over Lane C touched files | passed/reviewed | Matches are only this submission's proof/forbidden-language text; no service/exporter/database/listener code was added. |

## Non-Accepted Claims

- No default-on persistence is accepted.
- No raw chat/transcript/trace/prompt/payload/checkpoint/tool/env/secret/raw trace context retention is accepted.
- No unbounded source body retention is accepted.
- No service, exporter, database service, daemon, or listener is accepted.
- No memory runtime authority is accepted.
- No persistence runtime cutover is accepted. The local SQLite persistence proof may proceed to synthesis only as a default-off, sanitized, non-authoritative foundation with owner/schema, migration, idempotency, no-read/no-write flag-off parity, and rollback proof.

Status: accepted
